export const onboardingStatuses = ["draft", "awaiting_information", "awaiting_payment", "ready_to_activate"] as const;
export const accessTypes = ["invoice", "trial", "complimentary"] as const;
export const statusLabels: Record<string, string> = { draft: "Draft", awaiting_information: "Awaiting Customer Information", awaiting_payment: "Awaiting Payment", ready_to_activate: "Ready to Activate" };
export const textFields = ["company_name", "legal_company_name", "registration_number", "country_code", "website", "address", "contact_first_name", "contact_last_name", "contact_email", "contact_phone", "access_type", "contract_start", "contract_end", "billing_frequency", "invoice_reference", "po_reference"] as const;
export type OnboardingInput = Record<typeof textFields[number], string | null> & { requested_seats: number | null; status: typeof onboardingStatuses[number] };
export type OnboardingRecord = OnboardingInput & { id: string; revision: number; updated_at: string; created_at: string; onboarding_method: "dmi_managed"; create_request_id: string };
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export class OnboardingError extends Error { constructor(message: string, public status = 400) { super(message); } }
export function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new OnboardingError("Invalid request body.");
  return value as Record<string, unknown>;
}
export function validateOnboarding(value: unknown): OnboardingInput {
  const body = objectBody(value);
  const allowed = new Set<string>([...textFields, "requested_seats", "status"]);
  if (Object.keys(body).some(k => !allowed.has(k))) throw new OnboardingError("Unsupported onboarding field.");
  const result = {} as OnboardingInput;
  for (const key of textFields) {
    const v = body[key];
    if (v !== undefined && v !== null && typeof v !== "string") throw new OnboardingError(`Invalid ${key.replaceAll("_", " ")}.`);
    const text = typeof v === "string" ? v.trim() : "";
    if (text.length > 2000 || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text)) throw new OnboardingError("Text exceeds the permitted format or length.");
    result[key] = text || null;
  }
  if (!result.company_name) throw new OnboardingError("Company / Trading Name is required.");
  if (result.country_code && !/^[A-Z]{2}$/.test(result.country_code)) throw new OnboardingError("Country must be a two-letter uppercase country code, e.g. GB.");
  if (result.contact_email && (result.contact_email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.contact_email))) throw new OnboardingError("Enter a valid work email.");
  if (result.website) {
    try { const u = new URL(result.website); if (!["http:", "https:"].includes(u.protocol) || !u.hostname || u.username || u.password) throw Error(); }
    catch { throw new OnboardingError("Website must be an HTTP(S) URL without credentials."); }
  }
  for (const key of ["contract_start", "contract_end"] as const) {
    const d = result[key];
    if (d && (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !Number.isFinite(Date.parse(d)) || new Date(d).toISOString().slice(0,10) !== d || d < "0001-01-01")) throw new OnboardingError("Enter a valid contract date.");
  }
  if (result.contract_start && result.contract_end && result.contract_end < result.contract_start) throw new OnboardingError("Contract end cannot precede start.");
  if (result.access_type && !accessTypes.includes(result.access_type as typeof accessTypes[number])) throw new OnboardingError("Invalid access type.");
  if (result.billing_frequency && (result.access_type !== "invoice" || !["annual", "quarterly"].includes(result.billing_frequency))) throw new OnboardingError("Billing frequency applies only to invoice terms.");
  const seats = body.requested_seats ?? null;
  if (seats !== null && (typeof seats !== "number" || !Number.isInteger(seats) || seats < 1 || seats > 2147483647)) throw new OnboardingError("Requested seats must be a positive whole number.");
  result.requested_seats = seats as number | null;
  if (!onboardingStatuses.includes(body.status as typeof onboardingStatuses[number])) throw new OnboardingError("Invalid onboarding status.");
  result.status = body.status as OnboardingInput["status"];
  return result;
}
export function onboardingListOptions(url: string) {
  const p = new URL(url).searchParams;
  if ([...p.keys()].some(k => !["page", "search", "status", "access_type"].includes(k) || p.getAll(k).length !== 1)) throw new OnboardingError("Invalid list filters.");
  const rawPage = p.get("page") || "1";
  if (!/^[1-9][0-9]{0,4}$/.test(rawPage)) throw new OnboardingError("Invalid page.");
  const search = (p.get("search") || "").trim();
  if (search.length > 100 || /[\x00-\x1f]/.test(search)) throw new OnboardingError("Search is too long or invalid.");
  const status = p.get("status") || ""; const access = p.get("access_type") || "";
  if (status && !onboardingStatuses.includes(status as typeof onboardingStatuses[number])) throw new OnboardingError("Invalid status filter.");
  if (access && !accessTypes.includes(access as typeof accessTypes[number])) throw new OnboardingError("Invalid access filter.");
  // A quoted PostgREST operand, with LIKE metacharacters escaped; no filter injection.
  const operand = '"%' + search.replace(/[\\%_*]/g, c => "\\" + c).replace(/"/g, '\\"') + '%"';
  return { page: Number(rawPage), search, operand, status, access, pageSize: 25 };
}
