import "server-only";
import {billingWorkAutomaticConfiguration} from "./billing-work-auto-config";
import {createBillingLatencyObserver, type LatencyObserver} from "./billing-latency-diagnostics";
import {createBillingWorkerStore, type BillingWorkerStore, type WorkRpc} from "./billing-work-store";

export const CLAIM_REASONS = ["no_eligible_candidate", "scope_lock_unavailable", "candidate_missing", "routing_capacity_reached", "candidate_row_locked_or_changed", "routing_lease_active", "partition_capacity_unavailable", "partition_unavailable", "dependency_fallback_selected", "dependency_fallback_unavailable", "routing_claimed", "consumer_claimed"] as const;

// Only this projection may enter diagnostics. Work items retain the existing
// private RPC contract and are never passed to an observer or serialized here.
function observeClaim(value: unknown, observe: LatencyObserver): void {
  try {
    if (!value || typeof value !== "object" || !("decisions" in value) || !Array.isArray(value.decisions) || value.decisions.length > 3) return;
    for (const decision of value.decisions) {
      if (!decision || typeof decision !== "object") continue;
      const {phase, reason} = decision;
      if ((phase !== "ordinary" && phase !== "dependency_fallback") || !CLAIM_REASONS.includes(reason)) continue;
      observe({stage: "claim_decision", consumer: "entitlement", claim_phase: phase, reason});
    }
  } catch { /* Observability cannot affect worker results. */ }
}

export function entitlementClaimDiagnosticStore(store: BillingWorkerStore, db: WorkRpc,
  env: Record<string, string | undefined> = process.env): BillingWorkerStore {
  // Separate opt-in keeps pre-migration deployments on legacy RPCs. Existing
  // trusted Staging/project/database/test-scope/credential guards still apply.
  if (env.BILLING_WORK_CLAIM_DIAGNOSTICS_ENABLED !== "true" || billingWorkAutomaticConfiguration("run", env).state !== "enabled") return store;
  const observe = createBillingLatencyObserver("scheduler", env);
  if (!observe) return store;
  const diagnostic = createBillingWorkerStore({rpc: async (name, args) => {
    const claim = name === "billing_consumer_worker_claim_entitlement";
    const settle = name === "billing_consumer_worker_settle_entitlement";
    const response = await db.rpc(claim ? "billing_consumer_worker_claim_entitlement_diagnostic" : settle ? "billing_consumer_worker_settle_entitlement_diagnostic" : name, args);
    // Preserve error/throw identity and the existing store's failure mapping.
    // Never retry a mutation via a legacy RPC after an ambiguous response.
    if (response.error || (!claim && !settle)) return response;
    const envelope = response.data;
    if (claim) observeClaim(envelope, observe);
    if (settle) {
      try {
        if (envelope && typeof envelope === "object" && "other_bound_due" in envelope && typeof envelope.other_bound_due === "boolean") {
          observe({stage: "dependency_due_bound", consumer: "entitlement", other_bound_due: envelope.other_bound_due});
        }
      } catch { /* Logging failure is harmless. */ }
    }
    return {...response, data: envelope && typeof envelope === "object" ? (claim ? ("items" in envelope ? envelope.items : undefined) : ("result" in envelope ? envelope.result : undefined)) : undefined};
  }});
  return {...store,
    claim: (scope, consumer, event) => consumer === "entitlement" && event === undefined ? diagnostic.claim(scope, consumer) : store.claim(scope, consumer, event),
    settle: (work, fence, action, input = {}) => work.consumer === "entitlement" && work.execution_kind === "routing" && action === "dependency_wait" && input.failure_category === "routing_unresolved"
      ? diagnostic.settle(work, fence, action, input) : store.settle(work, fence, action, input),
  };
}
