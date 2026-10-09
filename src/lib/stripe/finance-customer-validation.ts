import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Bundle, EventEvidence, Graph } from "./finance-contract";
import { projectVerifiedFinanceRouting } from "./finance-routing-evidence";
import { resolveVerifiedFinanceRouting } from "./finance-customer-relationship-adapter";
import { validateFinanceGraphOwnership, validateFinanceBundleOwnership, type StoredOwnership } from "./finance-customer-ownership";
import { assertPartitionOwners, type Partition } from "./finance-partition-protocol";

export type FinanceCustomerValidationReason = "MALFORMED_EVIDENCE" | "ROUTING_UNRESOLVED" |
 "RELATIONSHIP_UNAVAILABLE" | "RELATIONSHIP_TIMEOUT_AMBIGUOUS" | "RELATIONSHIP_CANCELLED_AMBIGUOUS" |
 "ROUTING_OWNERSHIP_CONFLICT" | "GRAPH_OWNERSHIP_REJECTED" | "BUNDLE_OWNERSHIP_REJECTED" | "STORED_IDENTITY_CONFLICT";
export type FinanceCustomerValidationResult = {status: "approved"; partition: Readonly<Partition>} |
 {status: "rejected"; reason: FinanceCustomerValidationReason};

/** UNUSED, server-internal ownership composition. Signature verification and trusted
 * stored-row provenance are caller prerequisites. Receives an already fetched graph
 * and final prepared bundle; never retrieves provider data, prepares writes or commits.
 * Approval is ownership-only, NOT a lease or write authorization. Existing monetary,
 * tax, attribution, revision, freshness and terminal checks remain required unchanged.
 * Never return this result to browsers, diagnostics, System Health or AI prompts.
 */
export async function validateFinanceCustomerPreparation(input: {
 db: Pick<SupabaseClient, "from">; scope: string; verifiedEvent: EventEvidence;
 graph: Graph; bundle: Bundle; stored?: StoredOwnership; signal?: AbortSignal;
}): Promise<FinanceCustomerValidationResult> {
 const reject = (reason: FinanceCustomerValidationReason): FinanceCustomerValidationResult => ({status: "rejected", reason});
 try {
  // Snapshot all supplied evidence before awaiting I/O; validation must not mix
  // caller-mutated graphs/bundles/identities from different points in time.
  const {verifiedEvent, graph, bundle, stored} = structuredClone({verifiedEvent: input.verifiedEvent,
   graph: input.graph, bundle: input.bundle, stored: input.stored ?? {}});
  const evidence = projectVerifiedFinanceRouting(input.scope, verifiedEvent);
  const routing = await resolveVerifiedFinanceRouting(input.db, input.scope, evidence, {signal: input.signal});
  if (routing.status === "unroutable" || routing.status === "unresolved") {
   switch (routing.reason) {
    case "invalid_evidence": return reject("MALFORMED_EVIDENCE");
    case "conflicting_ownership": return reject("ROUTING_OWNERSHIP_CONFLICT");
    case "lookup_unavailable": return reject("RELATIONSHIP_UNAVAILABLE");
    case "lookup_timeout_ambiguous": return reject("RELATIONSHIP_TIMEOUT_AMBIGUOUS");
    case "lookup_cancelled_ambiguous": return reject("RELATIONSHIP_CANCELLED_AMBIGUOUS");
    default: return reject("ROUTING_UNRESOLVED");
   }
  }
  const partition = routing.partition;
  assertPartitionOwners(partition, []); // Reuse protocol partition validity only; no mode/claim operation.
  const graphCheck = validateFinanceGraphOwnership(partition, graph);
  if (!graphCheck.valid) return reject("GRAPH_OWNERSHIP_REJECTED");
  const storedGraphCheck = validateFinanceGraphOwnership(partition, graph, stored);
  if (!storedGraphCheck.valid) return reject("STORED_IDENTITY_CONFLICT");
  const bundleCheck = validateFinanceBundleOwnership(partition, bundle, stored);
  if (!bundleCheck.valid) {
   // Reuse the same rules to distinguish a stored identity conflict where the
   // standalone bundle is otherwise valid; indirect/retired rows still use stored.
   if (bundleCheck.code === "FINANCE_OWNERSHIP_CONFLICT" && validateFinanceBundleOwnership(partition, bundle).valid)
    return reject("STORED_IDENTITY_CONFLICT");
   return reject("BUNDLE_OWNERSHIP_REJECTED");
  }
  return {status: "approved", partition: Object.freeze({...partition})};
 } catch {return reject("MALFORMED_EVIDENCE");}
}
