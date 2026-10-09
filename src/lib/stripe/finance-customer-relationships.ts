import "server-only";
import { routeFinanceCustomer, type CustomerRouting } from "./finance-customer-routing";
import type { EventEvidence } from "./finance-contract";

export const RELATIONSHIP_DEADLINE_MS = 2_000;
export const relationshipColumns = {
 subscriptions: ["stripe_scope", "stripe_object_id", "stripe_customer_id"],
 items: ["stripe_scope", "stripe_object_id", "stripe_subscription_id"],
 invoices: ["stripe_scope", "stripe_object_id", "stripe_customer_id", "stripe_subscription_id"],
 payments: ["stripe_scope", "stripe_object_id", "stripe_customer_id", "stripe_payment_intent_id"],
 refunds: ["stripe_scope", "stripe_object_id", "stripe_charge_id"],
 allocations: ["stripe_scope", "stripe_object_id", "stripe_invoice_id", "stripe_charge_id", "stripe_payment_intent_id"],
 attempts: ["stripe_scope", "attempt_key", "stripe_customer_id", "stripe_charge_id"],
 activity: ["stripe_scope", "activity_key", "stripe_customer_id", "object_type", "object_id"],
} as const;
export type RelationshipResource = keyof typeof relationshipColumns;
export type Partition = {scope: string; customer: string};
export type RelationshipResult = {status: "resolved"; partition: Partition} |
 {status: "unresolved"; reason: "invalid_evidence" | "missing_relationship" | "conflicting_ownership" | "lookup_unavailable" | "lookup_timeout_ambiguous" | "lookup_cancelled_ambiguous" | "hop_limit"};
/** Trusted implementation must enforce exact equality filters and the requested projection.
 * No mutation, list or provider method is exposed. Caller must not log requests/results.
 */
export interface RelationshipStorage {
 readExact(request: {resource: RelationshipResource; scope: string; id: string;
  columns: readonly string[]; signal: AbortSignal}): Promise<Record<string, unknown> | null>;
}
export function safeId(value: unknown, prefix: string): value is string {
 return typeof value === "string" && value.length <= 255 && new RegExp(`^${prefix}_[A-Za-z0-9]+$`).test(value);
}
export function validPartition(p: Partition): boolean {
 return /^acct_[A-Za-z0-9]+:(test|live)$/.test(p.scope) && p.scope.length <= 255 && safeId(p.customer, "cus");
}
const prefixes = {subscriptions:"sub", items:"si", invoices:"in", payments:"ch", refunds:"re", allocations:"inpay"};
function validKey(resource: RelationshipResource, key: unknown): key is string {
 if (resource === "attempts") return typeof key === "string" && key.startsWith("charge:") && safeId(key.slice(7), "ch");
 if (resource === "activity") return typeof key === "string" && key.length <= 400 && /^[A-Za-z0-9_:.-]+$/.test(key);
 return safeId(key, prefixes[resource]);
}
class ResolutionFailure extends Error {
 constructor(readonly reason: Extract<RelationshipResult, {status:"unresolved"}>["reason"]) {super("FINANCE_RELATIONSHIP_UNRESOLVED");}
}
/** One invocation, <=2 exact reads and a shared monotonic deadline. No retries.
 * Abort cannot prove a sent request was cancelled; timeout/cancellation stays ambiguous.
 */
export async function resolveFinanceRelationship(storage: RelationshipStorage, scope: string,
 resource: RelationshipResource, key: string, options: {signal?: AbortSignal} = {}): Promise<RelationshipResult> {
 const controller = new AbortController(), started = performance.now();
 let reads = 0, timer: ReturnType<typeof setTimeout> | undefined;
 let interrupted: "lookup_timeout_ambiguous" | "lookup_cancelled_ambiguous" | undefined;
 const cancelled = new Promise<never>((_, reject) => {
  const stop = (reason: typeof interrupted) => {interrupted = reason; controller.abort(); reject(new ResolutionFailure(reason!));};
  timer = setTimeout(() => stop("lookup_timeout_ambiguous"), RELATIONSHIP_DEADLINE_MS);
  controller.signal.addEventListener("abort", () => {if (!interrupted) {interrupted = "lookup_cancelled_ambiguous"; reject(new ResolutionFailure(interrupted));}}, {once:true});
 });
 const abort = () => controller.abort();
 options.signal?.addEventListener("abort", abort, {once:true});
 if (options.signal?.aborted) abort();
 async function read(kind: RelationshipResource, id: string) {
  if (interrupted) throw new ResolutionFailure(interrupted);
  if (++reads > 2) throw new ResolutionFailure("hop_limit");
  if (!Object.hasOwn(relationshipColumns, kind) || !validKey(kind, id)) throw new ResolutionFailure("invalid_evidence");
  const row = await storage.readExact({resource:kind, scope, id, columns:relationshipColumns[kind], signal:controller.signal});
  if (performance.now() - started >= RELATIONSHIP_DEADLINE_MS) throw new ResolutionFailure("lookup_timeout_ambiguous");
  if (!row) throw new ResolutionFailure("missing_relationship");
  const keyColumn = kind === "attempts" ? "attempt_key" : kind === "activity" ? "activity_key" : "stripe_object_id";
  if (row.stripe_scope !== scope || row[keyColumn] !== id) throw new ResolutionFailure("invalid_evidence");
  return row;
 }
 async function owner(kind: RelationshipResource, id: string): Promise<string> {
  const row = await read(kind, id);
  if (["subscriptions", "invoices", "payments"].includes(kind)) {
   if (!safeId(row.stripe_customer_id, "cus")) throw new ResolutionFailure("missing_relationship");
   if (kind === "invoices" && row.stripe_subscription_id != null) {
    const parent = await owner("subscriptions",String(row.stripe_subscription_id));
    if (parent !== row.stripe_customer_id) throw new ResolutionFailure("conflicting_ownership");
   }
   return row.stripe_customer_id;
  }
  if (kind === "items") return owner("subscriptions", String(row.stripe_subscription_id));
  if (kind === "refunds") return owner("payments", String(row.stripe_charge_id));
  // Routing candidate only: the pure ownership validator must prove BOTH ends.
  if (kind === "allocations") return row.stripe_charge_id != null
   ? owner("payments",String(row.stripe_charge_id)) : owner("invoices",String(row.stripe_invoice_id));
  if (!safeId(row.stripe_customer_id, "cus")) throw new ResolutionFailure("missing_relationship");
  const related = kind === "attempts" ? await owner("payments", String(row.stripe_charge_id)) :
   await owner(({attempt:"attempts"} as Record<string,RelationshipResource>)[String(row.object_type)] ?? row.object_type as RelationshipResource, String(row.object_id));
  if (related !== row.stripe_customer_id) throw new ResolutionFailure("conflicting_ownership");
  return related;
 }
 try {
  if (!validPartition({scope,customer:"cus_validation"})) throw new ResolutionFailure("invalid_evidence");
  const customer = await Promise.race([owner(resource,key), cancelled]);
  if (interrupted) throw new ResolutionFailure(interrupted);
  return {status:"resolved",partition:{scope,customer}};
 } catch (error) {
  return {status:"unresolved",reason:interrupted ?? (error instanceof ResolutionFailure ? error.reason : error instanceof Error && error.name === "AbortError" ? "lookup_cancelled_ambiguous" : "lookup_unavailable")};
 } finally {
  if (timer !== undefined) clearTimeout(timer);
  options.signal?.removeEventListener("abort",abort);
 }
}
/** Isolated adapter: signature verification and trusted scope are caller prerequisites.
 * Direct evidence wins only if any independently stored evidence supplied agrees.
 */
export async function resolveFinanceEventCustomer(storage: RelationshipStorage, scope: string, event: EventEvidence,
 options: {signal?: AbortSignal} = {}): Promise<CustomerRouting | RelationshipResult> {
 const direct = routeFinanceCustomer(scope,event);
 if (direct.status === "unroutable" && direct.reason !== "missing_relationship") return direct;
 const type = event.type;
 const resource: RelationshipResource = type.startsWith("customer.subscription.") ? "subscriptions" :
  type.startsWith("invoice.") ? "invoices" : type === "charge.refund.updated" || type.startsWith("refund.") ? "refunds" : "payments";
 const raw = event.data.object;
 if (direct.status === "routed") {
  const persisted = await resolveFinanceRelationship(storage,scope,resource,String(raw.id),options);
  if (persisted.status === "unresolved") return persisted.reason === "missing_relationship" ? direct : persisted;
  if (persisted.partition.customer !== direct.partition.customer) return {status:"unresolved",reason:"conflicting_ownership"};
  return direct;
 }
 if (resource === "refunds" && raw.charge != null) {
  const charge = typeof raw.charge === "string" ? raw.charge : (raw.charge as {id?:unknown}).id;
  if (!safeId(charge,"ch")) return {status:"unresolved",reason:"invalid_evidence"};
  return resolveFinanceRelationship(storage,scope,"payments",charge,options);
 }
 return resolveFinanceRelationship(storage,scope,resource,String(raw.id),options);
}
