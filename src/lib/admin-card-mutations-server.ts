import "server-only";
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { emailFromClerkUser, requireAdminAccess } from "@/lib/admin-auth";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { cardSeedFields, type CardCreationResult } from "@/lib/admin-card-mutations";

type DB = ReturnType<typeof createSupabaseAdminClient>;
type Body = Record<string, unknown>;
class Failure extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
function object(value: unknown): Body {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Failure("A JSON object is required.");
  return value as Body;
}
function keys(body: Body, allowed: readonly string[]) {
  if (Object.keys(body).some(key => !allowed.includes(key))) throw new Failure("Unsupported input field.");
}
function uuid(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new Failure("A valid UUID is required.");
  return value.toLowerCase();
}
function stableId(value: string) {
  const hex = createHash("sha256").update(value).digest("hex");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
}
async function bulk(db: DB, body: Body) {
  keys(body, ["clientId", "templateId", "operationId", "staff"]);
  const clientId = uuid(body.clientId), templateId = uuid(body.templateId), operationId = uuid(body.operationId);
  if (!Array.isArray(body.staff) || !body.staff.length || body.staff.length > 100) throw new Failure("Select between 1 and 100 staff members.");
  const staff = body.staff.map(value => {
    const row = object(value); keys(row, ["staffId", "seed"]);
    const seed = object(row.seed ?? {}); keys(seed, cardSeedFields);
    for (const value of Object.values(seed)) if (typeof value !== "string" || value.length > 4000) throw new Failure("Seed values must be text of at most 4000 characters.");
    return { staffId: uuid(row.staffId), seed };
  });
  if (new Set(staff.map(row => row.staffId)).size !== staff.length) throw new Failure("Duplicate staff selection.");
  const company = await db.from("clients").select("id,company_name,full_name,account_type").eq("id", clientId).maybeSingle();
  const template = await db.from("templates").select("id,is_published,access_level").eq("id", templateId).maybeSingle();
  if (company.error || template.error) throw new Failure("Company/template lookup failed.", 500);
  if (!company.data || !["business", "enterprise"].includes(company.data.account_type)) throw new Failure("Select an existing company.");
  if (!template.data?.is_published) throw new Failure("Select an existing published template.");
  const results: CardCreationResult[] = [];
  for (const selection of staff) {
    const { staffId, seed } = selection;
    try {
      const lookup = await db.from("client_users").select("id,client_id,user_id,full_name,job_title,email,phone,website,address,whatsapp,linkedin,instagram,facebook,youtube,booking_link,custom_url").eq("id", staffId).maybeSingle();
      if (lookup.error) throw new Failure("Staff lookup failed. Retry this row.", 500);
      const person = lookup.data;
      if (!person || person.client_id !== clientId) {
        results.push({ staffId, status: "ineligible", message: "Staff record does not belong to this company." }); continue;
      }
      if (!person.user_id) {
        results.push({ staffId, status: "ineligible", message: "Not ready — user has not activated a Client Portal account." }); continue;
      }
      const owner = uuid(person.user_id);
      const linked = await db.from("client_users").select("id").eq("user_id", owner).limit(2);
      if (linked.error) throw new Failure("Ownership verification failed. Retry this row.", 500);
      if (linked.data?.length !== 1 || linked.data[0].id !== staffId) {
        results.push({ staffId, status: "ineligible", message: "Conflicting staff/account linkage. Resolve before creating a card." }); continue;
      }
      const account = await db.auth.admin.getUserById(owner);
      if (account.error && account.error.status !== 404) throw new Failure("Auth account verification unavailable. Retry this row.", 500);
      if (!account.data.user || account.data.user.id !== owner) {
        results.push({ staffId, status: "ineligible", message: "Not ready — linked Client Portal account does not exist." }); continue;
      }
      const id = stableId(`admin-card:${operationId}:${clientId}:${staffId}:${templateId}`);
      const existing = await db.from("cards").select("id,user_id,client_id,template_id").eq("id", id).maybeSingle();
      if (existing.error) throw new Failure("Retry lookup failed.", 500);
      if (existing.data) {
        if (existing.data.user_id !== owner || existing.data.client_id !== clientId || existing.data.template_id !== templateId) throw new Failure("Retry conflicts with existing card ownership.");
        results.push({ staffId, status: "created", cardId: id, message: "Already created by this operation; no duplicate inserted." }); continue;
      }
      const inventory = await db.from("cards").select("card_slot").eq("user_id", owner).in("card_slot", [1,2,3]);
      if (inventory.error) throw new Failure("Slot availability could not be checked.", 500);
      if (new Set(inventory.data?.map(row => row.card_slot)).size >= 3) throw new Failure("No available slot: this owner already occupies all three card slots.");
      const content: Body = {};
      for (const field of cardSeedFields) content[field] = String(seed[field] ?? person[field] ?? "").trim();
      if (!content.full_name) throw new Failure("Full name is required.");
      const inserted = await db.from("cards").insert({
        ...content, id, user_id: owner, client_id: clientId, template_id: templateId,
        card_name: `${content.full_name} Digital Card`, slug: `card-${id}`,
        company_name: company.data.company_name || company.data.full_name,
        show_dmi_branding: template.data.access_level === "free",
        status: "published", is_published: true,
      });
      if (inserted.error) throw new Failure(inserted.error.message.includes("CARD_SLOT") ? "Card slot unavailable. Refresh and retry." : "Creation was not confirmed. Retry this same batch safely.", 500);
      results.push({ staffId, status: "created", cardId: id, message: "Created and published." });
    } catch (error) {
      results.push({ staffId, status: "failed", message: error instanceof Failure ? error.message : "Outcome unknown. Retry this same batch safely." });
    }
  }
  return { results };
}

export async function adminCardMutation(request: Request, operation: "create" | "publish" | "delete", cardId?: string) {
  const access = await requireAdminAccess(await auth(), async () => emailFromClerkUser(await currentUser()));
  if (!access.authorized) return reply({ error: access.error, code: "AUTHORIZATION_ERROR" }, access.status);
  try {
    let body: Body = {};
    if (operation !== "delete") {
      const raw = await request.text();
      if (raw.length > 1_000_000) throw new Failure("Request is too large.");
      try { body = object(JSON.parse(raw)); } catch { throw new Failure("A valid JSON object is required."); }
    }
    const db = createSupabaseAdminClient();
    if (operation === "create") return reply(await bulk(db, body));
    const id = uuid(cardId);
    if (operation === "publish") {
      keys(body, ["operation"]);
      if (body.operation !== "publish" && body.operation !== "unpublish") throw new Failure("Choose publish or unpublish.");
    }
    const existing = await db.from("cards").select("id").eq("id", id).maybeSingle();
    if (existing.error) throw new Failure("Card lookup failed.", 500);
    if (!existing.data) throw new Failure("Card not found.", 404);
    const published = body.operation === "publish";
    const query = operation === "delete" ? db.from("cards").delete() : db.from("cards").update({ status: published ? "published" : "draft", is_published: published });
    const result = await query.eq("id", id).select("id").maybeSingle();
    if (result.error) throw new Failure("Card operation failed. Refresh to confirm its current state.", 500);
    if (!result.data) throw new Failure("Card not found.", 404);
    return reply({ id, success: true });
  } catch (error) {
    const status = error instanceof Failure ? error.status : 500;
    return reply({ error: error instanceof Failure ? error.message : "Card operation could not be confirmed. Refresh or retry the same batch.", code: status === 400 ? "VALIDATION_ERROR" : status === 404 ? "NOT_FOUND" : "DATABASE_ERROR" }, status);
  }
}
