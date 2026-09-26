import "server-only";
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { requireAdminAccess } from "@/lib/admin-auth";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { isSupportPublished, supportPublicPath, type SupportCard } from "@/lib/admin-card-support";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" };
const pageSize = 25;
// Explicit FK joins from existing migrations. Empty filtered embeds let PostgREST
// search/filter relationships without materializing whole client/card inventories.
const relations = "client:clients!cards_client_id_fkey(id,full_name,company_name,account_type,subscription_plan),business:clients!cards_client_id_fkey(),individual:clients!cards_client_id_fkey(),matched_client:clients!cards_client_id_fkey()";
const columns = `id,user_id,client_id,template_id,card_name,full_name,company_name,slug,status,is_published,created_at,updated_at,template:templates(id,name,status,is_published),${relations}`;
type Row = Record<string, unknown>;
function text(value: unknown): string | null { return typeof value === "string" && value ? value : null; }
function related(value: unknown): Row | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Row : null; }

export function projectSupportCard(row: Row): SupportCard {
  const client = related(row.client), template = related(row.template);
  const accountType = client?.account_type === "business" || client?.account_type === "enterprise" ? "business"
    : client?.account_type === "individual" || (!row.client_id && row.user_id) ? "individual" : "unknown";
  const publicPath = supportPublicPath(row, template);
  return {
    id: String(row.id), userId: text(row.user_id), clientId: text(row.client_id),
    name: text(row.card_name) || text(row.full_name) || "Unnamed card", ownerName: text(row.full_name),
    company: text(client?.company_name) || (accountType === "business" ? text(client?.full_name) : null) || text(row.company_name),
    accountType, templateId: text(row.template_id), templateName: text(template?.name),
    recordedPlan: text(client?.subscription_plan), status: text(row.status), published: isSupportPublished(row),
    slug: text(row.slug), publicPath,
    unavailableReason: publicPath ? null : !isSupportPublished(row) ? "Card is unpublished" : !template || !isSupportPublished(template) ? "Template is unavailable publicly" : "No valid public slug",
    createdAt: text(row.created_at), updatedAt: text(row.updated_at),
  };
}

export async function readAdminCardSupport(request: Request) {
  let access;
  try { access = await requireAdminAccess(await auth()); }
  catch { return NextResponse.json({ error: "Admin authorization could not be verified." }, { status: 503, headers }); }
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status, headers });
  const params = new URL(request.url).searchParams;
  const pageValue = params.get("page") || "1", search = (params.get("search") || "").trim();
  const account = params.get("account") || "all", publication = params.get("publication") || "all";
  if ([...params.keys()].some(key => !["page", "search", "account", "publication"].includes(key) || params.getAll(key).length !== 1)
    || !/^[1-9]\d{0,3}$/.test(pageValue) || search.length > 80
    || !["all", "individual", "business", "unknown"].includes(account) || !["all", "published", "unpublished"].includes(publication)
    || (search && !/^[\p{L}\p{N} '\-_.]+$/u.test(search))) {
    return NextResponse.json({ error: "Invalid filter. Search accepts letters, numbers, spaces, apostrophes, dots, hyphens and underscores (up to 80 characters)." }, { status: 400, headers });
  }
  try {
    const db = createSupabaseAdminClient();
    const base = (head = false) => db.from("cards").select(head ? `id,${relations}` : columns, { count: "exact", head })
      .in("business.account_type", ["business", "enterprise"]).eq("individual.account_type", "individual");
    type Query = ReturnType<typeof base>;
    const filterAccount = (q: Query, kind: string): Query => kind === "business" ? q.not("business", "is", null)
      : kind === "individual" ? q.or("individual.not.is.null,and(client_id.is.null,user_id.not.is.null)")
      : kind === "unknown" ? q.is("business", null).is("individual", null).or("client_id.not.is.null,user_id.is.null") : q;
    const filterPublication = (q: Query, state: string): Query => state === "published" ? q.or("status.eq.published,is_published.eq.true")
      : state === "unpublished" ? q.or("status.neq.published,status.is.null").or("is_published.eq.false,is_published.is.null") : q;
    let query = filterPublication(filterAccount(base(), account), publication);
    if (search) {
      // Escape SQL LIKE wildcard '_' after validating PostgREST grammar characters.
      const pattern = `*${search.replaceAll("_", "\\_")}*`;
      query = query.or(`full_name.ilike.${pattern},company_name.ilike.${pattern}`, { referencedTable: "matched_client" })
        .or(`card_name.ilike.${pattern},full_name.ilike.${pattern},company_name.ilike.${pattern},slug.ilike.${pattern},matched_client.not.is.null`);
    }
    const page = Number(pageValue), offset = (page - 1) * pageSize;
    // Counts are global, explicitly labelled as such in the UI. No full-row scan in JS.
    const results = await Promise.all([
      query.order("updated_at", { ascending: false, nullsFirst: false }).order("id", { ascending: true }).range(offset, offset + pageSize - 1),
      base(true), filterPublication(base(true), "published"), filterAccount(base(true), "business"), filterAccount(base(true), "individual"),
    ]);
    if (results.some(result => result.error || result.count === null)) throw new Error("Support inventory read failed");
    const [list, all, published, business, individual] = results;
    return NextResponse.json({ cards: (list.data || []).map(row => projectSupportCard(row as unknown as Row)), page, pageSize, total: list.count,
      summary: { total: all.count, published: published.count, unpublished: Math.max(0, all.count! - published.count!), business: business.count, individual: individual.count } }, { headers });
  } catch {
    return NextResponse.json({ error: "Card support inventory could not be loaded. Please retry." }, { status: 500, headers });
  }
}
