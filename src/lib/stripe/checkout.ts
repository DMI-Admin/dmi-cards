import "server-only";

import { getStripeServerClient } from "@/lib/stripe/config";

type CheckoutSessionInput = {
  userId: string;
  email: string | null;
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
      dmi_user_id: userId,
    },
    subscription_data: {
      metadata: {
        dmi_user_id: userId,
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
