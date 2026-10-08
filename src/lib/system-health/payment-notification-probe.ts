import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { MonitorObservation } from "./monitoring-core";

export const PAYMENT_NOTIFICATION_SAMPLE_LIMIT = 20;
// Approved Phase 1 operational monitoring threshold, not a billing contract or lease duration.
export const PAYMENT_NOTIFICATION_GRACE_MS = 10 * 60 * 1_000;
export const PAYMENT_NOTIFICATION_RECENT_WINDOW_MS = 24 * 60 * 60 * 1_000;
const projection = "state,created_at,processed_at";
const states = new Set(["received", "processing", "processed", "failed"]);

// Scope comes from the existing non-secret Finance STRIPE_ACCOUNT_SCOPE configuration.
// Never discover account identity via Stripe or infer it from customer/ledger records.
export async function checkPaymentNotifications(
  database: SupabaseClient,
  scope: string | undefined,
  signal: AbortSignal,
  now = Date.now()
): Promise<MonitorObservation> {
  if (typeof scope !== "string" || !/^acct_[A-Za-z0-9]+:test$/.test(scope) ||
    !Number.isSafeInteger(now) || now < PAYMENT_NOTIFICATION_RECENT_WINDOW_MS) {
    throw new Error("PAYMENT_NOTIFICATION_SCOPE_OR_CLOCK_INVALID");
  }
  // Exactly two scoped reads, no pagination/retries/count scans. The second read catches
  // unresolved work older than the recent window. Neither read selects identity or payloads.
  const [recent, unresolved] = await Promise.all([
    database.from("stripe_webhook_events").select(projection).eq("stripe_scope", scope)
      .gte("created_at", new Date(now - PAYMENT_NOTIFICATION_RECENT_WINDOW_MS).toISOString())
      .order("created_at", { ascending: false }).limit(PAYMENT_NOTIFICATION_SAMPLE_LIMIT).abortSignal(signal).retry(false),
    database.from("stripe_webhook_events").select(projection).eq("stripe_scope", scope)
      .neq("state", "processed").order("created_at", { ascending: true })
      .limit(PAYMENT_NOTIFICATION_SAMPLE_LIMIT).abortSignal(signal).retry(false),
  ]);
  if (signal.aborted || recent.error || unresolved.error ||
    !Array.isArray(recent.data) || !Array.isArray(unresolved.data) ||
    recent.data.length > PAYMENT_NOTIFICATION_SAMPLE_LIMIT || unresolved.data.length > PAYMENT_NOTIFICATION_SAMPLE_LIMIT) {
    throw new Error("PAYMENT_NOTIFICATION_READ_FAILED");
  }
  const recentRows = recent.data.map(row => validateRow(row, now));
  const unresolvedRows = unresolved.data.map(row => validateRow(row, now));
  if (recentRows.some(row => row.created < now - PAYMENT_NOTIFICATION_RECENT_WINDOW_MS) ||
    unresolvedRows.some(row => row.state === "processed")) {
    throw new Error("PAYMENT_NOTIFICATION_ROWS_INVALID");
  }
  // Rows can occur in both samples. sampled_rows is read volume, not unique events.
  // Each issue count is the maximum observed in either sample, not a global total.
  const failed = Math.max(...[recentRows, unresolvedRows].map(rows => rows.filter(row => row.state === "failed").length));
  const overdue = Math.max(...[recentRows, unresolvedRows].map(rows => rows.filter(row =>
    (row.state === "received" || row.state === "processing") && now - row.created > PAYMENT_NOTIFICATION_GRACE_MS
  ).length));
  const sampleLimitReached = recentRows.length === PAYMENT_NOTIFICATION_SAMPLE_LIMIT ||
    unresolvedRows.length === PAYMENT_NOTIFICATION_SAMPLE_LIMIT;
  const evidence = {
    sampled_rows: recentRows.length + unresolvedRows.length,
    failed_count: failed,
    overdue_count: overdue,
    sample_limit_reached: sampleLimitReached,
    query_bounded: true,
  };
  if (failed || overdue) {
    return {
      status: "degraded", severity: "warning", verified: true,
      reasonCode: "payment_notification_processing_problem",
      safeSummary: "A bounded Stripe webhook ledger read found failed or overdue processing. This does not establish a complete service outage.",
      evidence,
    };
  }
  if (sampleLimitReached) {
    return {
      status: "unknown", severity: "info", verified: false,
      reasonCode: "payment_notification_sample_incomplete",
      safeSummary: "The Stripe webhook sample reached its fixed limit. Monitoring evidence is incomplete; no service failure is established.",
      evidence,
    };
  }
  return {
    status: "operational", severity: "none", verified: true, reasonCode: null,
    safeSummary: "Recent Stripe webhook processing records show no failed or overdue processing in the bounded sample.",
    evidence,
  };
}

function validateRow(value: unknown, now: number): { state: string; created: number } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("PAYMENT_NOTIFICATION_ROWS_INVALID");
  const row = value as Record<string, unknown>;
  const created = timestamp(row.created_at);
  const processed = row.processed_at === null ? null : timestamp(row.processed_at);
  if (typeof row.state !== "string" || !states.has(row.state) || created > now ||
    (row.state === "processed" ? processed === null || processed < created || processed > now : processed !== null)) {
    throw new Error("PAYMENT_NOTIFICATION_ROWS_INVALID");
  }
  return { state: row.state, created };
}

function timestamp(value: unknown): number {
  const match = typeof value === "string" && /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  const stamp = typeof value === "string" ? Date.parse(value) : NaN;
  if (!match || !Number.isFinite(stamp) || Number(match[2]) < 1 || Number(match[2]) > 12 ||
    Number(match[3]) < 1 || Number(match[3]) > new Date(Date.UTC(Number(match[1]), Number(match[2]), 0)).getUTCDate() ||
    Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6]) > 59) {
    throw new Error("PAYMENT_NOTIFICATION_ROWS_INVALID");
  }
  return stamp;
}
