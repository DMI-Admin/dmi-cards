import "server-only";
import { billingRuntime, BillingFailure, synchronizeSubscription, verifiedCustomerForUser, withAccount, type BillingRuntime } from "@/lib/stripe/reliability";
export type ReconciliationInput = { mode: "dry_run" | "repair"; userId?: string; after?: string };
function outcomeFor(error: unknown) {
  if (!(error instanceof BillingFailure)) return "retryable_failure";
  if (/IDENTITY|MULTIPLE|SCOPE/.test(error.reason)) return "identity_conflict";
  if (/UNKNOWN_PRICE/.test(error.reason)) return "unknown_price";
  if (/MISSING_OBJECT|CUSTOMER_UNAVAILABLE/.test(error.reason)) return "missing_object";
  return "retryable_failure";
}
export async function reconcileBilling(input: ReconciliationInput, actor: string, runtime?: BillingRuntime) {
  const r = runtime || await billingRuntime();
  const subjects: { id: string; userId: string; subscriptionId: string }[] = [];
  let next: string | null = null;
  if (input.userId) {
    const customer = await withAccount(r, input.userId, account => verifiedCustomerForUser(r, account, false));
    if (!customer) return { results: [], next: null, outcome: "missing_object" };
    const page = await r.stripe.subscriptions.list({ customer, status: "all", limit: 20, ...(input.after ? { starting_after: input.after } : {}) });
    for (const sub of page.data) subjects.push({ id: sub.id, userId: input.userId, subscriptionId: sub.id });
    if (page.has_more) next = page.data.at(-1)?.id || null;
  } else {
    let query = r.db.from("billing_subscriptions").select("id,user_id,stripe_subscription_id").or(`stripe_scope.is.null,stripe_scope.eq.${r.scope}`).order("id").limit(21);
    if (input.after) query = query.gt("id", input.after);
    const { data, error } = await query;
    if (error || !data) throw new BillingFailure("MIRROR_UNAVAILABLE");
    for (const row of data.slice(0,20)) subjects.push({ id: row.id, userId: row.user_id, subscriptionId: row.stripe_subscription_id });
    if (data.length > 20) next = subjects.at(-1)?.id || null;
  }
  const results = [];
  for (const subject of subjects) {
    let outcome: string, before: number | null = null, after: number | null = null, errorCode: string | null = null;
    try {
      const result = await synchronizeSubscription(r, subject.subscriptionId, { userId: subject.userId, dryRun: input.mode === "dry_run" });
      outcome = result.outcome; before = result.beforeRevision; after = result.revision;
    } catch (error) { outcome = outcomeFor(error); errorCode = error instanceof BillingFailure ? error.reason : "RETRYABLE_FAILURE"; }
    const { error } = await r.db.from("billing_sync_runs").insert({ stripe_scope: r.scope, user_id: subject.userId, subscription_id: subject.subscriptionId, trigger: "reconciliation", actor, mode: input.mode, outcome, before_revision: before, after_revision: after, error_code: errorCode });
    if (error) throw new BillingFailure("AUDIT_UNAVAILABLE");
    results.push({ subscriptionId: subject.subscriptionId, outcome, beforeRevision: before, revision: after, errorCode });
  }
  return { results, next };
}
// Future system callers must supply their own authenticated server identity.
// No scheduled endpoint, background automation or Stripe mutation is introduced.
export function isSubscriptionId(value: string) { return /^sub_[A-Za-z0-9]+$/.test(value); }
