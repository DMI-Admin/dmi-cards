import "server-only";
import { reviewedFinanceEvent } from "./finance-event-evidence";
import { financeRoutingEvents, routeFinanceCustomer } from "./finance-customer-routing";
import type { EventEvidence } from "./finance-contract";

// Internal routing data only. Signature verification MUST precede this projection.
// Schema checks cannot establish signature authenticity. Never log/serialize to clients.
declare const verifiedRouting: unique symbol;
export type VerifiedFinanceRoutingEvidence = EventEvidence & {readonly [verifiedRouting]: true};
export function projectVerifiedFinanceRouting(scope: string, verifiedEvent: EventEvidence): VerifiedFinanceRoutingEvidence {
 try {
  const reviewed = reviewedFinanceEvent(verifiedEvent);
  if (!Object.hasOwn(financeRoutingEvents, reviewed.type)) throw new Error();
  const kind = financeRoutingEvents[reviewed.type as keyof typeof financeRoutingEvents];
  const raw = verifiedEvent.data.object;
  if (raw.object != null && raw.object !== kind) throw new Error();
  const object: Record<string, unknown> = {id: reviewed.data.object.id};
  const identifier = (value: unknown): unknown => {
   const result = value && typeof value === "object" && !Array.isArray(value) ? (value as {id?: unknown}).id : value;
   if (typeof result !== "string") throw new Error();
   return result;
  };
  if (kind === "refund") {
   if (raw.customer != null) throw new Error(); // Not documented refund ownership evidence.
   if (raw.charge != null) object.charge = identifier(raw.charge);
  } else if (raw.customer != null) object.customer = identifier(raw.customer);
  // Required existing validation evidence for the signed charge.failed snapshot.
  if (reviewed.type === "charge.failed") for (const field of ["status", "paid", "amount_captured", "livemode"])
   object[field] = reviewed.data.object[field];
  const projected = {...reviewed, data: {object}};
  const checked = routeFinanceCustomer(scope, projected);
  if (checked.status === "unroutable" && checked.reason !== "missing_relationship") throw new Error();
  return projected as VerifiedFinanceRoutingEvidence;
 } catch {throw new Error("FINANCE_ROUTING_EVIDENCE_INVALID");}
}
