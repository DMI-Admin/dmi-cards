import "server-only";

import type Stripe from "stripe";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { hasDmiStripeAppNamespace } from "@/lib/stripe/app-namespace";
import {
  dmiPlanForStripePrice,
  normalizeStripeSubscriptionStatus,
  stripeSubscriptionCurrentPeriodEnd,
  stripeCustomerId,
  stripeSubscriptionPriceId,
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
      return await handleCheckoutSessionCompleted(
        supabaseAdmin,
        event.id,
        event.data.object as Stripe.Checkout.Session
      );
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      return await upsertStripeSubscriptionState(
        supabaseAdmin,
        event.id,
        event.data.object as Stripe.Subscription
      );
    case "invoice.payment_failed":
      return await handleInvoicePaymentFailed(
        supabaseAdmin,
        event.id,
        event.data.object as Stripe.Invoice
      );
  }

  await markStripeWebhookEventProcessed(supabaseAdmin, event.id);

  return { handled: true };
}

async function handleCheckoutSessionCompleted(
  supabaseAdmin: SupabaseAdmin,
  eventId: string,
  session: Stripe.Checkout.Session
): Promise<WebhookHandleResult> {
  if (!hasDmiStripeAppNamespace(session.metadata)) {
    await markStripeWebhookEventProcessed(supabaseAdmin, eventId);
    return {
      handled: true,
      skipped: true,
      reason: "app_namespace_mismatch",
    };
  }

  const subscriptionId =
    typeof session.subscription === "string" ? session.subscription : session.subscription?.id;

  if (!subscriptionId) {
    await markStripeWebhookEventProcessed(supabaseAdmin, eventId);
    return { handled: true, skipped: true, reason: "missing_subscription_id" };
  }

  const subscription = await getStripeServerClient().subscriptions.retrieve(
    subscriptionId,
    {
      expand: ["items.data.price"],
    }
  );

  return await upsertStripeSubscriptionState(
    supabaseAdmin,
    eventId,
    subscription,
    session.client_reference_id || undefined,
    session.id
  );
}

async function handleInvoicePaymentFailed(
  supabaseAdmin: SupabaseAdmin,
  eventId: string,
  invoice: Stripe.Invoice
): Promise<WebhookHandleResult> {
  const invoiceRecord = invoice as Stripe.Invoice & {
    subscription?: string | Stripe.Subscription | null;
  };
  const subscriptionId =
    typeof invoiceRecord.subscription === "string"
      ? invoiceRecord.subscription
      : invoiceRecord.subscription?.id;

  if (!subscriptionId) {
    await markStripeWebhookEventProcessed(supabaseAdmin, eventId);
    return { handled: true, skipped: true, reason: "missing_subscription_id" };
  }

  const subscription = await getStripeServerClient().subscriptions.retrieve(
    subscriptionId,
    {
      expand: ["items.data.price"],
    }
  );

  return await upsertStripeSubscriptionState(supabaseAdmin, eventId, subscription);
}

async function upsertStripeSubscriptionState(
  supabaseAdmin: SupabaseAdmin,
  eventId: string,
  subscription: Stripe.Subscription,
  fallbackUserId?: string,
  checkoutSessionId?: string
): Promise<WebhookHandleResult> {
  if (!hasDmiStripeAppNamespace(subscription.metadata)) {
    await markStripeWebhookEventProcessed(supabaseAdmin, eventId);
    return {
      handled: true,
      skipped: true,
      reason: "app_namespace_mismatch",
    };
  }

  const subscriptionId = subscription.id;
  const customerId = stripeCustomerId(subscription.customer);
  const priceId = stripeSubscriptionPriceId(subscription);
  const status = normalizeStripeSubscriptionStatus(subscription.status);
  const userId =
    fallbackUserId ||
    subscription.metadata?.dmi_user_id ||
    (await userIdForExistingBillingRecord(supabaseAdmin, subscriptionId, customerId));
  const profileId = subscription.metadata?.dmi_profile_id || userId;

  if (!userId) {
    console.warn("[DMI stripe] subscription sync skipped", {
      reason: "MISSING_DMI_USER_ID",
      eventSubject: subscriptionId,
    });
    await markStripeWebhookEventProcessed(supabaseAdmin, eventId);
    return { handled: true, skipped: true, reason: "missing_dmi_user_id" };
  }

  const latestInvoiceId = latestInvoiceIdentifier(subscription.latest_invoice);
  const currentPeriodEnd = stripeSubscriptionCurrentPeriodEnd(subscription, priceId);

  const { error } = await supabaseAdmin.from("billing_subscriptions").upsert(
    {
      user_id: userId,
      profile_id: profileId,
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

  await markStripeWebhookEventProcessed(supabaseAdmin, eventId);
  return { handled: true };
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
