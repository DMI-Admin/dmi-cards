import "server-only";
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { requireAdminAccess } from "@/lib/admin-auth";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { companyReport, type CompanyReportCard } from "@/lib/admin-company-report";

type ReportRow = CompanyReportCard & { id: string; company_name: string | null; template: { name: string | null } | null };

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" };
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });
export async function readCompanyReport(request: Request) {
  let access;
  try { access = await requireAdminAccess(await auth()); }
  catch { return reply({ error: "Admin authorization could not be verified." }, 503); }
  if (!access.authorized) return reply({ error: access.error }, access.status);
  const params = new URL(request.url).searchParams;
  const clientId = params.get("clientId"), search = (params.get("search") || "").trim().toLowerCase();
  if (!clientId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId) || search.length > 80
    || [...params.keys()].some(key => !["clientId", "search"].includes(key) || params.getAll(key).length !== 1)) {
    return reply({ error: "Invalid company export request." }, 400);
  }
  try {
    const db = createSupabaseAdminClient();
    const client = await db.from("clients").select("id,full_name,company_name,account_type").eq("id", clientId).maybeSingle();
    if (client.error) throw new Error("Company lookup failed");
    if (!client.data || !["business", "enterprise"].includes(client.data.account_type)) return reply({ error: "Business company not found." }, 404);
    const company = client.data;
    // Narrow legacy report columns, not the broad Admin inventory DTO. Page past
    // PostgREST's row cap, but fail explicitly rather than download a partial CSV.
    const cards: ReportRow[] = [];
    for (let offset = 0; ;) {
      const result = await db.from("cards").select("id,card_name,full_name,email,company_name,slug,status,is_published,created_at,template:templates(name)")
        .eq("client_id", clientId).order("created_at", { ascending: false, nullsFirst: false }).order("id", { ascending: true }).range(offset, offset + 499).returns<ReportRow[]>();
      if (result.error || !result.data) throw new Error("Company cards failed");
      cards.push(...result.data);
      if (cards.length > 10000) return reply({ error: "Company export exceeds 10,000 cards. No partial export was produced." }, 413);
      if (result.data.length === 0) break;
      offset += result.data.length;
    }
    // Preserve Public Pages search semantics; export is company-wide across
    // inventory pages and all publication states, never the current page alone.
    const matching = cards.filter(card => !search || [card.card_name, card.full_name, card.company_name, company.company_name, card.email, card.template?.name, card.slug]
      .some(value => (value || "").toLowerCase().includes(search)));
    const companyName = company.company_name || matching[0]?.company_name || company.full_name || "Unnamed company";
    return reply(companyReport(companyName, matching));
  } catch { return reply({ error: "Company export could not be loaded. Please retry." }, 500); }
}
