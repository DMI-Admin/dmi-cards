import "server-only";

import {
  DMI_STRIPE_APP_METADATA_KEY,
  DMI_STRIPE_APP_NAMESPACE,
} from "@/lib/stripe/app-namespace";
import { getStripeServerClient } from "@/lib/stripe/config";
import type {
  CheckoutBillingPlan,
  StripeBillingInterval,
} from "@/lib/stripe/billing-state";

type CheckoutSessionInput = {
  userId: string;
  email: string | null;
  plan: CheckoutBillingPlan;
  billingInterval: StripeBillingInterval;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  customerId?: string | null;
};

type BillingPortalSessionInput = {
  customerId: string;
  returnUrl: string;
};

export async function createStripeCheckoutSession({
  userId,
  email,
  plan,
  billingInterval,
  priceId,
  successUrl,
  cancelUrl,
  customerId,
}: CheckoutSessionInput) {
  const stripe = getStripeServerClient();

  return stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId || undefined,
    customer_email: customerId ? undefined : email || undefined,
    client_reference_id: userId,
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    metadata: {
      [DMI_STRIPE_APP_METADATA_KEY]: DMI_STRIPE_APP_NAMESPACE,
      dmi_user_id: userId,
      dmi_plan: plan,
      billing_interval: billingInterval,
    },
    subscription_data: {
      metadata: {
        [DMI_STRIPE_APP_METADATA_KEY]: DMI_STRIPE_APP_NAMESPACE,
        dmi_user_id: userId,
        dmi_plan: plan,
        billing_interval: billingInterval,
      },
    },
    success_url: successUrl,
    cancel_url: cancelUrl,
  });
}

export async function createStripeBillingPortalSession({
  customerId,
  returnUrl,
}: BillingPortalSessionInput) {
  const stripe = getStripeServerClient();

  return stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });
}
