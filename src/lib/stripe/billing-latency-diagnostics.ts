import "server-only";
import { BILLING_WORK_DATABASE, BILLING_WORK_PROJECT } from "./billing-work-config";

export type LatencySource = "webhook_kick" | "automatic_endpoint" | "activation";
export type LatencyEvent = {
  stage: "runner_start" | "runner_end" | "execution_start" | "execution_end" | "lane_stop" | "runner_skip" | "idle_recheck_scheduled" | "idle_recheck_start" | "idle_recheck_end" | "idle_recheck_skipped" | "activation_start" | "activation_end" | "acknowledgement_start" | "acknowledgement_end" | "readiness_start" | "readiness_end";
  consumer?: "finance" | "entitlement";
  ordinal?: number;
  outcome?: "disabled" | "bound" | "completed" | "idle" | "retry_wait" | "dependency_wait" | "needs_attention" | "stopped" | "payment_acknowledged" | "payment_unconfirmed" | "pro_ready" | "pro_not_ready" | "safe_error";
  reason?: "outcome_stop" | "insufficient_headroom" | "execution_limit" | "configuration_disabled" | "invalid_budget" | "runtime_unavailable";
  category?: "lease_busy" | "dependency_unresolved" | "ownership_conflict" | "ownership_stale" | "ambiguous_outcome" | "provider_unavailable" | "store_unavailable" | "invalid_evidence" | "worker_expired" | "retry_exhausted" | "routing_unresolved";
  duration_ms?: number;
  remaining_ms?: number;
  minimum_start_ms?: number;
  delay_ms?: number;
};
export type LatencyObserver = (event: LatencyEvent) => void;
const stages = ["runner_start", "runner_end", "execution_start", "execution_end", "lane_stop", "runner_skip", "idle_recheck_scheduled", "idle_recheck_start", "idle_recheck_end", "idle_recheck_skipped", "activation_start", "activation_end", "acknowledgement_start", "acknowledgement_end", "readiness_start", "readiness_end"];
const outcomes = ["disabled", "bound", "completed", "idle", "retry_wait", "dependency_wait", "needs_attention", "stopped", "payment_acknowledged", "payment_unconfirmed", "pro_ready", "pro_not_ready", "safe_error"];
const reasons = ["outcome_stop", "insufficient_headroom", "execution_limit", "configuration_disabled", "invalid_budget", "runtime_unavailable"];
const categories = ["lease_busy", "dependency_unresolved", "ownership_conflict", "ownership_stale", "ambiguous_outcome", "provider_unavailable", "store_unavailable", "invalid_evidence", "worker_expired", "retry_exhausted", "routing_unresolved"];

// Request grouping is supplied by Vercel. No identifiers, headers, errors or
// caller-provided strings enter records. Production has no logging enablement.
export function createBillingLatencyObserver(source: LatencySource, env: Record<string, string | undefined> = process.env,
  sink: (line: string) => void | PromiseLike<void> = line => { console.info(line); }): LatencyObserver | undefined {
  try {
    if (!["webhook_kick", "automatic_endpoint", "activation"].includes(source) ||
      env.VERCEL_ENV !== "preview" || env.VERCEL_TARGET_ENV !== "staging" ||
      env.VERCEL_PROJECT_ID !== BILLING_WORK_PROJECT || env.NEXT_PUBLIC_SUPABASE_URL !== BILLING_WORK_DATABASE) return undefined;
  } catch { return undefined; }
  return event => {
    try {
      const stage = event.stage;
      if (!stages.includes(stage)) return;
      const record: Record<string, string | number> = { component: "billing_latency", source, stage, at: new Date().toISOString() };
      const fields: ReadonlyArray<readonly ["consumer" | "outcome" | "reason" | "category", readonly string[]]> = [["consumer", ["finance", "entitlement"]], ["outcome", outcomes], ["reason", reasons], ["category", categories]];
      for (const [key, allowed] of fields) {
        const value = event[key];
        if (value !== undefined) { if (!allowed.includes(value)) return; record[key] = value; }
      }
      const ordinal = event.ordinal;
      if (ordinal !== undefined) {
        if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > 8) return;
        record.ordinal = ordinal;
      }
      for (const key of ["duration_ms", "remaining_ms", "minimum_start_ms", "delay_ms"] as const) {
        const value = event[key];
        if (value !== undefined) {
          if (!Number.isFinite(value) || value < (key === "remaining_ms" ? -240_000 : 0) || value > 86_400_000) return;
          record[key] = Math.round(value);
        }
      }
      const pending = sink(JSON.stringify(record));
      if (pending) void Promise.resolve(pending).catch(() => {});
    } catch { /* Diagnostics and hostile diagnostic values never affect billing. */ }
  };
}
