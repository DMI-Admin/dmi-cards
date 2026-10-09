import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { relationshipColumns, RELATIONSHIP_DEADLINE_MS, resolveFinanceRelationship, safeId, validPartition,
 type RelationshipStorage, type RelationshipResult } from "./finance-customer-relationships";
import { financeRoutingEvents, routeFinanceCustomer, type CustomerRouting } from "./finance-customer-routing";
import type { VerifiedFinanceRoutingEvidence } from "./finance-routing-evidence";

const tables = {subscriptions: "billing_finance_subscriptions", invoices: "billing_invoices",
 payments: "billing_payments", refunds: "billing_refunds"} as const;
const prefixes = {subscriptions: "sub", invoices: "in", payments: "ch", refunds: "re"} as const;
type RoutingResource = keyof typeof tables;
/** Inject a trusted server client. Construction performs no I/O and reads no environment.
 * Only exact primary-key reads exist: no provider, list, mutation or retry path.
 */
export function createFinanceRelationshipAdapter(db: Pick<SupabaseClient, "from">): RelationshipStorage {
 return {async readExact(request) {
  const {resource, scope, id, columns, signal} = request;
  if (!Object.hasOwn(tables, resource) || !validPartition({scope, customer: "cus_validation"}) ||
   !safeId(id, prefixes[resource as RoutingResource]) ||
   columns.join(",") !== relationshipColumns[resource].join(",")) throw new Error("FINANCE_RELATIONSHIP_INPUT");
  if (signal.aborted) throw new Error("FINANCE_RELATIONSHIP_CANCELLED");
  try {
   const {data, error} = await db.from(tables[resource as RoutingResource]).select(columns.join(","))
    .eq("stripe_scope", scope).eq("stripe_object_id", id).abortSignal(signal).maybeSingle();
   if (signal.aborted) throw new Error();
   if (error) throw new Error();
   if (data === null) return null;
   if (!data || Array.isArray(data) || typeof data !== "object") throw new Error();
   // Return only requested relationship fields, even if a mock/transport adds extras.
   const row = data as Record<string, unknown>;
   return Object.fromEntries(columns.map(column => [column, row[column]]));
  } catch {throw new Error("FINANCE_RELATIONSHIP_UNAVAILABLE");}
 }};
}
/** Server-internal composition. Routing establishes a candidate, never financial-write authority.
 * Both initial lookup and any fallback share <=2 reads / 2 seconds. No provider fallback.
 */
export async function resolveVerifiedFinanceRouting(db: Pick<SupabaseClient, "from">, scope: string,
 evidence: VerifiedFinanceRoutingEvidence, options: {signal?: AbortSignal} = {}): Promise<CustomerRouting | RelationshipResult> {
 const candidate = routeFinanceCustomer(scope, evidence);
 if (candidate.status === "unroutable" && candidate.reason !== "missing_relationship") return candidate;
 const kind = financeRoutingEvents[evidence.type as keyof typeof financeRoutingEvents];
 const resource: RoutingResource = {subscription: "subscriptions", invoice: "invoices", charge: "payments", refund: "refunds"}[kind] as RoutingResource;
 const raw = evidence.data.object, base = createFinanceRelationshipAdapter(db);
 const controller = new AbortController(), start = performance.now();
 let reads = 0, conflict = false, rootMissing = false;
 let interruption: "lookup_timeout_ambiguous" | "lookup_cancelled_ambiguous" | undefined;
 const unresolved = (reason: Extract<RelationshipResult, {status: "unresolved"}>["reason"]): RelationshipResult => ({status: "unresolved", reason});
 const abort = () => {interruption ??= "lookup_cancelled_ambiguous"; controller.abort();};
 let stop!: () => void;
 const cancelled = new Promise<RelationshipResult>(resolve => {stop = () => resolve(unresolved(interruption!));});
 controller.signal.addEventListener("abort", () => stop(), {once: true});
 const timer = setTimeout(() => {interruption = "lookup_timeout_ambiguous"; controller.abort();}, RELATIONSHIP_DEADLINE_MS);
 options.signal?.addEventListener("abort", abort, {once: true});
 if (options.signal?.aborted) abort();
 const storage: RelationshipStorage = {async readExact(request) {
  if (controller.signal.aborted || performance.now() - start >= RELATIONSHIP_DEADLINE_MS) throw new Error("FINANCE_RELATIONSHIP_CANCELLED");
  if (++reads > 2) throw new Error("FINANCE_RELATIONSHIP_HOP_LIMIT");
  const row = await base.readExact({...request, signal: controller.signal});
  if (controller.signal.aborted) throw new Error("FINANCE_RELATIONSHIP_CANCELLED");
  if (reads === 1 && row === null) rootMissing = true;
  if (row && request.resource === "refunds" && raw.charge != null && row.stripe_charge_id !== raw.charge) {
   conflict = true; throw new Error("FINANCE_RELATIONSHIP_CONFLICT");
  }
  return row;
 }};
 async function resolve(): Promise<CustomerRouting | RelationshipResult> {
  if (controller.signal.aborted) return unresolved(interruption!);
  let persisted = await resolveFinanceRelationship(storage, scope, resource, String(raw.id), {signal: controller.signal});
  if (controller.signal.aborted) return unresolved(interruption!);
  if (conflict) return unresolved("conflicting_ownership");
  if (reads > 2) return unresolved("hop_limit");
  if (persisted.status === "unresolved") {
   if (persisted.reason !== "missing_relationship") return persisted;
   if (candidate.status === "routed") return rootMissing ? candidate : persisted;
   if (kind !== "refund" || raw.charge == null) return persisted;
   if (reads >= 2) return unresolved("hop_limit");
   persisted = await resolveFinanceRelationship(storage, scope, "payments", String(raw.charge), {signal: controller.signal});
   if (controller.signal.aborted) return unresolved(interruption!);
   if (reads > 2) return unresolved("hop_limit");
  }
  if (persisted.status === "resolved" && candidate.status === "routed" && persisted.partition.customer !== candidate.partition.customer)
   return unresolved("conflicting_ownership");
  return persisted;
 }
 try {return await Promise.race([resolve(), cancelled]);}
 finally {clearTimeout(timer); options.signal?.removeEventListener("abort", abort);}
}
