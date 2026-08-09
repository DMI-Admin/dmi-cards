import "server-only";

import type Stripe from "stripe";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  dmiPlanForStripePrice,
  normalizeStripeSubscriptionStatus,
  stripeCustomerId,
  stripeSubscriptionPriceId,
  stripeTimestampToIso,
  trustedPlanForStripeSubscription,
} from "@/lib/stripe/billing-state";
import { getStripeServerClient } from "@/lib/stripe/config";

type SupabaseAdmin = ReturnType<typeof createSupabaseAdminClient>;

type WebhookHandleResult = {
  handled: boolean;
  skipped?: boolean;
  reason?: string;
};

const handledEventTypes = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_failed",
]);

export async function handleStripeWebhookEvent(
  event: Stripe.Event
): Promise<WebhookHandleResult> {
  const supabaseAdmin = createSupabaseAdminClient();

  if (!(await recordStripeWebhookEvent(supabaseAdmin, event))) {
    return { handled: true, skipped: true, reason: "duplicate_event" };
  }

  if (!handledEventTypes.has(event.type)) {
    await markStripeWebhookEventProcessed(supabaseAdmin, event.id);
    return { handled: false, reason: "unhandled_event_type" };
  }

  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutSessionCompleted(
        supabaseAdmin,
        event.data.object as Stripe.Checkout.Session
      );
      break;
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await upsertStripeSubscriptionState(
        supabaseAdmin,
        event.data.object as Stripe.Subscription
      );
      break;
    case "invoice.payment_failed":
      await handleInvoicePaymentFailed(
        supabaseAdmin,
        event.data.object as Stripe.Invoice
      );
      break;
  }

  await markStripeWebhookEventProcessed(supabaseAdmin, event.id);

  return { handled: true };
}

async function handleCheckoutSessionCompleted(
  supabaseAdmin: SupabaseAdmin,
  session: Stripe.Checkout.Session
) {
  const subscriptionId =
    typeof session.subscription === "string" ? session.subscription : session.subscription?.id;

  if (!subscriptionId) {
    return;
  }

  const subscription = await getStripeServerClient().subscriptions.retrieve(
    subscriptionId,
    {
      expand: ["items.data.price"],
    }
  );

  await upsertStripeSubscriptionState(
    supabaseAdmin,
    subscription,
    session.client_reference_id || undefined,
    session.id
  );
}

async function handleInvoicePaymentFailed(
  supabaseAdmin: SupabaseAdmin,
  invoice: Stripe.Invoice
) {
  const invoiceRecord = invoice as Stripe.Invoice & {
    subscription?: string | Stripe.Subscription | null;
  };
  const subscriptionId =
    typeof invoiceRecord.subscription === "string"
      ? invoiceRecord.subscription
      : invoiceRecord.subscription?.id;

  if (!subscriptionId) {
    return;
  }

  const subscription = await getStripeServerClient().subscriptions.retrieve(
    subscriptionId,
    {
      expand: ["items.data.price"],
    }
  );

  await upsertStripeSubscriptionState(supabaseAdmin, subscription);
}

async function upsertStripeSubscriptionState(
  supabaseAdmin: SupabaseAdmin,
  subscription: Stripe.Subscription,
  fallbackUserId?: string,
  checkoutSessionId?: string
) {
  const subscriptionId = subscription.id;
  const customerId = stripeCustomerId(subscription.customer);
  const priceId = stripeSubscriptionPriceId(subscription);
  const status = normalizeStripeSubscriptionStatus(subscription.status);
  const userId =
    fallbackUserId ||
    subscription.metadata?.dmi_user_id ||
    (await userIdForExistingBillingRecord(supabaseAdmin, subscriptionId, customerId));

  if (!userId) {
    console.warn("[DMI stripe] subscription sync skipped", {
      reason: "MISSING_DMI_USER_ID",
      eventSubject: subscriptionId,
    });
    return;
  }

  const latestInvoiceId = latestInvoiceIdentifier(subscription.latest_invoice);
  const currentPeriodEnd =
    "current_period_end" in subscription
      ? stripeTimestampToIso(
          (subscription as Stripe.Subscription & { current_period_end?: number | null })
            .current_period_end
        )
      : null;

  const { error } = await supabaseAdmin.from("billing_subscriptions").upsert(
    {
      user_id: userId,
      profile_id: userId,
      stripe_customer_id: customerId,
      stripe_subscription_id: subscriptionId,
      stripe_subscription_status: status,
      stripe_price_id: priceId || null,
      dmi_plan: trustedPlanForStripeSubscription({ status, priceId }),
      current_period_end: currentPeriodEnd,
      cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
      latest_invoice_id: latestInvoiceId,
      checkout_session_id: checkoutSessionId || null,
      updated_at: new Date().toISOString(),
    },
    {
      onConflict: "stripe_subscription_id",
    }
  );

  if (error) {
    throw new Error(`Stripe subscription sync failed: ${error.code || "UNKNOWN"}`);
  }
}

async function userIdForExistingBillingRecord(
  supabaseAdmin: SupabaseAdmin,
  subscriptionId: string,
  customerId: string
) {
  const { data } = await supabaseAdmin
    .from("billing_subscriptions")
    .select("user_id")
    .or(
      `stripe_subscription_id.eq.${subscriptionId},stripe_customer_id.eq.${customerId}`
    )
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (data as { user_id?: string | null } | null)?.user_id || "";
}

async function recordStripeWebhookEvent(
  supabaseAdmin: SupabaseAdmin,
  event: Stripe.Event
) {
  const { error } = await supabaseAdmin.from("stripe_webhook_events").insert({
    stripe_event_id: event.id,
    event_type: event.type,
  });

  if (!error) {
    return true;
  }

  if (error.code === "23505") {
    return false;
  }

  throw new Error(`Stripe webhook event record failed: ${error.code || "UNKNOWN"}`);
}

async function markStripeWebhookEventProcessed(
  supabaseAdmin: SupabaseAdmin,
  eventId: string
) {
  const { error } = await supabaseAdmin
    .from("stripe_webhook_events")
    .update({ processed_at: new Date().toISOString() })
    .eq("stripe_event_id", eventId);

  if (error) {
    throw new Error(`Stripe webhook event update failed: ${error.code || "UNKNOWN"}`);
  }
}

function latestInvoiceIdentifier(invoice: Stripe.Subscription["latest_invoice"]) {
  if (typeof invoice === "string") return invoice;
  return invoice?.id || null;
}

export function planForStripePriceEnvironment(priceId: string | null | undefined) {
  return dmiPlanForStripePrice(priceId);
}
