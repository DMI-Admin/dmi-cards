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
  | "individual_pro"
  | "business"
  | "enterprise";

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

const paidStatuses = new Set<StripeSubscriptionStatus>(["active", "trialing"]);

export function dmiPlanForStripePrice(priceId: string | null | undefined): TrustedBillingPlan {
  const value = priceId?.trim() || "";

  if (value && value === process.env.STRIPE_PRICE_INDIVIDUAL_PRO?.trim()) {
    return "individual_pro";
  }

  if (value && value === process.env.STRIPE_PRICE_BUSINESS?.trim()) {
    return "business";
  }

  if (value && value === process.env.STRIPE_PRICE_ENTERPRISE?.trim()) {
    return "enterprise";
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
  return subscription.items.data[0]?.price?.id || "";
}

export function stripeTimestampToIso(timestamp: number | null | undefined) {
  return timestamp ? new Date(timestamp * 1000).toISOString() : null;
}
