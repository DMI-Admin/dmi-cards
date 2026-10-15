import "server-only";

import { ApiRouteError } from "@/lib/api/responses";
import { hasDmiStripeAppNamespace } from "@/lib/stripe/app-namespace";
import { billingRuntime, objectId } from "@/lib/stripe/reliability";
import { dmiPlanForStripePrice } from "@/lib/stripe/billing-state";

export function validActivationSessionId(value: string) {
  return /^cs_(?:test_|live_)?[A-Za-z0-9]{1,240}$/.test(value);
}

// Read-only acknowledgement. This does not grant Pro, synchronize billing,
// claim an account lease, or invoke a worker.
export async function acknowledgeCheckout(userId: string, sessionId: string, signal: AbortSignal) {
  if (!validActivationSessionId(sessionId)) {
    throw new ApiRouteError(400, "INVALID_REQUEST", "This checkout link is not valid.");
  }
  const runtime = await billingRuntime();
  const session = await runtime.stripe.checkout.sessions.retrieve(sessionId, undefined, {
    timeout: 8000, maxNetworkRetries: 0,
  });
  if (session.client_reference_id !== userId ||
      session.metadata?.dmi_user_id !== userId ||
      !hasDmiStripeAppNamespace(session.metadata) ||
      session.livemode !== runtime.live || session.mode !== "subscription") {
    throw new ApiRouteError(404, "NOT_FOUND", "This checkout is not available for your account.");
  }
  const { data: account, error } = await runtime.db.from("billing_accounts")
    .select("stripe_customer_id,verified_at")
    .eq("stripe_scope", runtime.scope).eq("user_id", userId).abortSignal(signal).maybeSingle();
  if (error) throw new ApiRouteError(503, "INTERNAL_ERROR", "Could not confirm checkout. Please try again.");
  if (!account?.verified_at || !account.stripe_customer_id ||
      account.stripe_customer_id !== objectId(session.customer)) {
    throw new ApiRouteError(404, "NOT_FOUND", "This checkout is not available for your account.");
  }
  return { paymentReceived: session.status === "complete" && session.payment_status === "paid" };
}

// The existing entitlement decision remains authoritative. The activation UX
// additionally waits for an explicitly verified mirror in the current scope,
// with a currently approved entitlement price. No provider reads per poll.
export async function verifiedProReady(userId: string, authoritativePro: boolean, signal: AbortSignal) {
  if (!authoritativePro) return false;
  const runtime = await billingRuntime();
  const { data: rows, error } = await runtime.db.from("billing_subscriptions")
    .select("stripe_price_id")
    .eq("user_id", userId).eq("stripe_scope", runtime.scope).eq("terminal", false)
    .not("verified_at", "is", null).in("stripe_subscription_status", ["active", "trialing"])
    .limit(10).abortSignal(signal);
  if (error) throw new ApiRouteError(503, "INTERNAL_ERROR", "Could not check activation. Please try again.");
  const prices = (rows || []).map(row => row.stripe_price_id)
    .filter((price): price is string => typeof price === "string" && dmiPlanForStripePrice(price) === "pro");
  if (!prices.length) return false;
  const { data: approved, error: priceError } = await runtime.db.from("billing_approved_prices")
    .select("stripe_price_id").eq("stripe_scope", runtime.scope)
    .eq("entitlement_enabled", true).in("stripe_price_id", prices).limit(1).abortSignal(signal);
  if (priceError) throw new ApiRouteError(503, "INTERNAL_ERROR", "Could not check activation. Please try again.");
  return Boolean(approved?.length);
}
