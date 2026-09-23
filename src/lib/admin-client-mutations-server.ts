import "server-only";
import { createHash } from "node:crypto";
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/admin-auth";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

type Operation = "create-client" | "update-client" | "status" | "create-staff" | "update-staff" | "delete-staff" | "import";
type Body = Record<string, unknown>;
class Invalid extends Error { constructor(message: string, readonly status = 400) { super(message); } }
const clientFields = ["full_name", "company_name", "email", "phone", "job_title", "account_type"];
const staffFields = ["full_name", "email", "phone", "job_title", "website", "address", "whatsapp", "linkedin", "instagram", "facebook", "youtube", "booking_link", "custom_url", "status"];
function object(value: unknown): Body {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Invalid("Expected an object.");
  return value as Body;
}
function keys(body: Body, allowed: string[]) {
  if (Object.keys(body).some(key => !allowed.includes(key))) throw new Invalid("Unsupported field. Identity, billing and stored card totals cannot be edited here.");
}
function uuid(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new Invalid("Invalid record ID.");
  return value.toLowerCase();
}
function fields(value: unknown, staff: boolean, create: boolean): Body {
  const body = object(value); keys(body, staff ? staffFields : create ? [...clientFields, "status"] : clientFields);
  const result: Body = {};
  for (const [key, value] of Object.entries(body)) {
    if (typeof value !== "string" || value.length > 2000) throw new Invalid("Invalid field value.");
    result[key] = value.trim();
  }
  if ((create || "full_name" in body) && !result.full_name) throw new Invalid("Full name is required.");
  if ((create && !staff) || "email" in body) {
    if ((!staff || result.email) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(result.email || ""))) throw new Invalid("A valid email is required.");
  }
  if ("account_type" in result && !["individual", "business", "enterprise"].includes(String(result.account_type))) throw new Invalid("Invalid account type.");
  if ("status" in result && !(staff ? ["active", "suspended"] : ["active", "pending", "suspended"]).includes(String(result.status))) throw new Invalid("Invalid staff status.");
  if (!staff && create) {
    result.account_type ??= "individual";
    result.subscription_plan = result.account_type === "individual" ? "free" : "paid";
    result.billing_status = result.subscription_plan; // Legacy display labels only; never entitlement.
    result.status ??= "active";
  }
  if (!Object.keys(result).length) throw new Invalid("No changes supplied.");
  return result;
}
function stableId(seed: string) {
  const hex = createHash("sha256").update(seed).digest("hex");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
}

export async function adminClientMutation(request: Request, operation: Operation, recordId?: string) {
  const access = await requireAdminAccess(await auth());
  const headers = { "Cache-Control": "private, no-store" };
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: 403, headers });
  try {
    // Same-origin cookie authentication: deny cross-origin mutation requests.
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) throw new Invalid("Cross-origin mutation denied.", 403);
    const text = operation === "delete-staff" ? "{}" : await request.text();
    if (text.length > 500_000) throw new Invalid("Request too large.");
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { throw new Invalid("Invalid JSON."); }
    const body = object(parsed);
    const id = recordId === undefined ? undefined : uuid(recordId);
    const db = createSupabaseAdminClient();
    if (operation === "import") {
      keys(body, ["operationId", "companies"]);
      const operationId = uuid(body.operationId);
      if (!Array.isArray(body.companies) || !body.companies.length || body.companies.length > 50) throw new Invalid("Import requires 1–50 companies.");
      let total = 0;
      const companies = body.companies.map((entry, index) => {
        const company = object(entry); keys(company, ["client", "staff"]);
        const client = fields(company.client, false, true);
        if (!["business", "enterprise"].includes(String(client.account_type))) throw new Invalid("Import requires company accounts.");
        if (!Array.isArray(company.staff) || (total += company.staff.length) > 200) throw new Invalid("Import is limited to 200 staff.");
        const clientId = stableId(`${operationId}:company:${index}`);
        return { client: { ...client, id: clientId }, staff: company.staff.map((person, staffIndex) => ({
          ...fields(person, true, true), ...(client.status === "suspended" ? { status: "suspended" } : {}), id: stableId(`${operationId}:company:${index}:staff:${staffIndex}`), client_id: clientId,
        })) };
      });
      const { error } = await db.rpc("admin_import_client_accounts", { p_companies: companies });
      if (error) throw new Invalid("Import was not confirmed. Retry the unchanged import; committed rows will not be duplicated.", 409);
    } else if (operation === "status") {
      keys(body, ["status"]);
      if (!["active", "suspended"].includes(String(body.status))) throw new Invalid("Invalid account status.");
      const { error } = await db.rpc("admin_set_client_status", { p_client_id: id, p_status: body.status });
      if (error) throw new Invalid("Account status update failed; no partial status change was committed.", 409);
    } else if (operation === "delete-staff") {
      // Membership removal for activated users requires a separate deprovisioning design.
      // Delete only unlinked contacts. FK identities stay protected even in concurrent requests.
      const { data, error } = await db.from("client_users").delete().eq("id", id).is("user_id", null).is("profile_id", null).select("id");
      if (error || !data?.length) throw new Invalid("Only unlinked staff contacts can be deleted here. Linked accounts require a deprovisioning workflow.", 409);
    } else if (operation === "create-staff") {
      keys(body, ["client_id", ...staffFields]);
      const clientId = uuid(body.client_id);
      const content = fields(Object.fromEntries(Object.entries(body).filter(([key]) => key !== "client_id")), true, true);
      // RPC locks the parent against a concurrent suspension and inherits its state.
      const { error } = await db.rpc("admin_create_client_staff", { p_client_id: clientId, p_staff: content });
      if (error) throw new Invalid("Could not add staff to this company.", 409);
    } else if (operation === "update-staff") {
      const content = fields(body, true, false);
      const { error } = await db.rpc("admin_update_client_staff", { p_staff_id: id, p_staff: content });
      if (error) throw new Invalid("Staff update failed. Check the company status and refresh before retrying.", 409);
    } else {
      const content = fields(body, false, operation === "create-client");
      const query = operation === "create-client" ? db.from("clients").insert(content) : db.from("clients").update(content).eq("id", id);
      const { data, error } = await query.select("id");
      if (error || !data?.length) throw new Invalid("The record could not be saved. Refresh before retrying.", 409);
    }
    return NextResponse.json({ ok: true }, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Invalid ? error.message : "Admin operation unavailable. Refresh before retrying." }, { status: error instanceof Invalid ? error.status : 500, headers });
  }
}
