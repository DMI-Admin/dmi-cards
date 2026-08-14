import "server-only";

import type Stripe from "stripe";
import {
  defaultClientPlan,
  getEntitlementsForPlan,
  type DmiEntitlementSet,
  type DmiPlan,
} from "@/lib/entitlements";

export type TrustedBillingPlan =
  | "free"
  | "pro"
  | "enterprise";

export type StripeBillingInterval = "monthly" | "annual";

export type StripeSubscriptionStatus =
  | "active"
  | "trialing"
  | "past_due"
  | "unpaid"
  | "canceled"
  | "incomplete"
  | "incomplete_expired"
  | "paused"
  | "unknown";

export type TrustedBillingState = {
  plan: DmiPlan;
  entitlements: DmiEntitlementSet;
  source: "stripe_billing" | "temporary_free_cap";
};

export type CheckoutBillingPlan = "pro";

const paidStatuses = new Set<StripeSubscriptionStatus>(["active", "trialing"]);

export function isCheckoutBillingPlan(plan: string): plan is CheckoutBillingPlan {
  return plan === "pro";
}

export function isStripeBillingInterval(
  interval: string
): interval is StripeBillingInterval {
  return interval === "monthly" || interval === "annual";
}

export function stripePriceForCheckoutPlan(
  plan: CheckoutBillingPlan,
  billingInterval: StripeBillingInterval
) {
  if (plan !== "pro") return "";

  const priceIdByInterval: Record<StripeBillingInterval, string | undefined> = {
    monthly: process.env.STRIPE_PRICE_PRO_MONTHLY,
    annual: process.env.STRIPE_PRICE_PRO_ANNUAL,
  };

  return priceIdByInterval[billingInterval]?.trim() || "";
}

export function dmiPlanForStripePrice(priceId: string | null | undefined): TrustedBillingPlan {
  const value = priceId?.trim() || "";

  if (
    value &&
    (value === process.env.STRIPE_PRICE_PRO_MONTHLY?.trim() ||
      value === process.env.STRIPE_PRICE_PRO_ANNUAL?.trim())
  ) {
    return "pro";
  }

  return "free";
}

export function normalizeStripeSubscriptionStatus(
  status: string | null | undefined
): StripeSubscriptionStatus {
  if (
    status === "active" ||
    status === "trialing" ||
    status === "past_due" ||
    status === "unpaid" ||
    status === "canceled" ||
    status === "incomplete" ||
    status === "incomplete_expired" ||
    status === "paused"
  ) {
    return status;
  }

  return "unknown";
}

export function trustedPlanForStripeSubscription({
  status,
  priceId,
}: {
  status: string | null | undefined;
  priceId: string | null | undefined;
}): DmiPlan {
  const normalizedStatus = normalizeStripeSubscriptionStatus(status);

  if (!paidStatuses.has(normalizedStatus)) {
    return defaultClientPlan;
  }

  return dmiPlanForStripePrice(priceId);
}

export function entitlementsForTrustedBillingState({
  status,
  priceId,
}: {
  status: string | null | undefined;
  priceId: string | null | undefined;
}): TrustedBillingState {
  const plan = trustedPlanForStripeSubscription({ status, priceId });

  return {
    plan,
    entitlements: getEntitlementsForPlan(plan),
    source: plan === "free" ? "temporary_free_cap" : "stripe_billing",
  };
}

export function stripeCustomerId(value: Stripe.Customer | Stripe.DeletedCustomer | string | null) {
  if (typeof value === "string") return value;
  return value?.id || "";
}

export function stripeSubscriptionPriceId(subscription: Stripe.Subscription) {
  return stripeSubscriptionItemForBilling(subscription)?.price?.id || "";
}

export function stripeSubscriptionItemForBilling(
  subscription: Stripe.Subscription,
  storedPriceId?: string | null
) {
  const configuredPriceIds = [
    process.env.STRIPE_PRICE_PRO_MONTHLY?.trim(),
    process.env.STRIPE_PRICE_PRO_ANNUAL?.trim(),
  ].filter((value): value is string => Boolean(value));

  return (
    subscription.items.data.find(
      (item) => item.price?.id && storedPriceId && item.price.id === storedPriceId
    ) ||
    subscription.items.data.find(
      (item) =>
        item.price?.id &&
        configuredPriceIds.includes(item.price.id) &&
        dmiPlanForStripePrice(item.price.id) !== "free"
    ) ||
    subscription.items.data[0] ||
    null
  );
}

export function stripeSubscriptionCurrentPeriodEnd(
  subscription: Stripe.Subscription,
  storedPriceId?: string | null
) {
  return stripeTimestampToIso(
    stripeSubscriptionItemForBilling(subscription, storedPriceId)?.current_period_end
  );
}

export function stripeTimestampToIso(timestamp: number | null | undefined) {
  return timestamp ? new Date(timestamp * 1000).toISOString() : null;
}
