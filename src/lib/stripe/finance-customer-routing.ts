import "server-only";
import { reviewedFinanceEvent } from "./finance-event-evidence";
import type { EventEvidence } from "./finance-contract";

// Separate, unused routing contract. Never changes the live reviewed event projection.
export const financeRoutingEvents = {
  "customer.subscription.created": "subscription", "customer.subscription.updated": "subscription",
  "customer.subscription.deleted": "subscription", "invoice.finalized": "invoice",
  "invoice.updated": "invoice", "invoice.paid": "invoice", "invoice.payment_failed": "invoice",
  "invoice.voided": "invoice", "invoice.marked_uncollectible": "invoice",
  "charge.succeeded": "charge", "charge.failed": "charge", "charge.captured": "charge",
  "charge.refunded": "charge", "charge.refund.updated": "refund",
  "refund.created": "refund", "refund.updated": "refund", "refund.failed": "refund",
} as const;
type Subject = "subscription" | "invoice" | "charge" | "refund";
/** Caller-supplied, scope-verified existing relationships. At most two rows/hops.
 * This type does not prove provenance: a future trusted adapter must verify it.
 * No lookup is performed here; missing rows must never trigger a guessed key.
 */
export type RoutingRelationship = { scope: string; kind: Subject; subject: string; related: string };
export type CustomerRouting =
  | { status: "routed"; partition: { scope: string; customer: string }; basis: "verified_snapshot" | "verified_relationship" }
  | { status: "unroutable"; reason: "unsupported_event" | "invalid_evidence" | "missing_relationship" | "conflicting_ownership" };
const prefixes = { subscription: "sub", invoice: "in", charge: "ch", refund: "re" };
function id(value: unknown, prefix: string): string | undefined {
  if (typeof value === "object" && value && !Array.isArray(value)) value = (value as {id?: unknown}).id;
  return typeof value === "string" && value.length <= 255 && new RegExp(`^${prefix}_[A-Za-z0-9]+$`).test(value) ? value : undefined;
}
/** Only signature-verified snapshots + independently verified scope may enter.
 * Output contains an internal customer key: never log or return it to a browser.
 * This is a routing candidate, not authorization to write a customer graph.
 */
export function routeFinanceCustomer(scope: string, event: EventEvidence, relationships: readonly RoutingRelationship[] = []): CustomerRouting {
  const fail = (reason: Exclude<CustomerRouting, {status: "routed"}>["reason"]): CustomerRouting => ({status: "unroutable", reason});
  try {
    reviewedFinanceEvent(event);
    if (!/^acct_[A-Za-z0-9]+:(test|live)$/.test(scope) || event.livemode !== scope.endsWith(":live") ||
        (event.account !== undefined && event.account !== scope.split(":")[0])) return fail("invalid_evidence");
    if (!Object.hasOwn(financeRoutingEvents, event.type)) return fail("unsupported_event");
    const kind = financeRoutingEvents[event.type as keyof typeof financeRoutingEvents];
    const raw = event.data.object;
    const subject = id(raw.id, prefixes[kind]);
    if (!subject || !Array.isArray(relationships) || relationships.length > 2) return fail("invalid_evidence");
    const direct = kind !== "refund" && raw.customer != null ? id(raw.customer, "cus") : undefined;
    if (kind !== "refund" && raw.customer != null && !direct) return fail("invalid_evidence");
    // Refund customer fields are not a supported ownership source.
    if (kind === "refund" && raw.customer != null) return fail("invalid_evidence");
    let charge = kind === "refund" && raw.charge != null ? id(raw.charge, "ch") : undefined;
    if (kind === "refund" && raw.charge != null && !charge) return fail("invalid_evidence");
    let linked: string | undefined;
    for (const row of relationships) {
      if (!row || row.scope !== scope || !Object.hasOwn(prefixes, row.kind) || !id(row.subject, prefixes[row.kind as Subject])) return fail("invalid_evidence");
      if (row.kind === "refund" && kind === "refund" && row.subject === subject) {
        const next = id(row.related, "ch");
        if (!next) return fail("invalid_evidence");
        if (charge && charge !== next) return fail("conflicting_ownership");
        charge = next;
      }
    }
    for (const row of relationships) {
      if (row.kind === "refund" && kind === "refund" && row.subject === subject) continue;
      if (row.kind !== (kind === "refund" ? "charge" : kind) || row.subject !== (kind === "refund" ? charge : subject)) return fail("invalid_evidence");
      const next = id(row.related, "cus");
      if (!next) return fail("invalid_evidence");
      if (linked && linked !== next) return fail("conflicting_ownership");
      linked = next;
    }
    if (direct && linked && direct !== linked) return fail("conflicting_ownership");
    const customer = direct ?? linked;
    if (!customer) return fail("missing_relationship");
    return {status: "routed", partition: {scope, customer}, basis: direct ? "verified_snapshot" : "verified_relationship"};
  } catch { return fail("invalid_evidence"); }
}
