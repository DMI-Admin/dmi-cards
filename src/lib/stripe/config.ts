import "server-only";

import Stripe from "stripe";

let stripeClient: Stripe | null = null;

export function getStripeServerClient() {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();

  if (!secretKey) {
    throw new Error("Stripe server client is not configured.");
  }

  stripeClient ||= new Stripe(secretKey);

  return stripeClient;
}

export function getStripeWebhookSecret() {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();

  if (!webhookSecret) {
    throw new Error("Stripe webhook secret is not configured.");
  }

  return webhookSecret;
}

export function constructStripeWebhookEvent({
  payload,
  signature,
}: {
  payload: string;
  signature: string | null;
}) {
  if (!signature) {
    throw new Error("Missing Stripe-Signature header.");
  }

  return getStripeServerClient().webhooks.constructEvent(
    payload,
    signature,
    getStripeWebhookSecret()
  );
}

// Read-only account/mode discovery shared by billing and the temporary diagnostic.
export async function resolveStripeAccountScope() {
  const stripe = getStripeServerClient();
  const [account, balance] = await Promise.all([
    stripe.accounts.retrieve(null),
    stripe.balance.retrieve(),
  ]);
  return {
    accountId: account.id,
    livemode: balance.livemode,
    stripeScope: `${account.id}:${balance.livemode ? "live" : "test"}`,
  };
}
