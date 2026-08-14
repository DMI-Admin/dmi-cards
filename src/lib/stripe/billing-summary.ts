import "server-only";

import type Stripe from "stripe";
import { ApiRouteError } from "@/lib/api/responses";
import { normalizeDmiPlan, type DmiPlan } from "@/lib/entitlements";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  dmiPlanForStripePrice,
  normalizeStripeSubscriptionStatus,
  stripeSubscriptionCurrentPeriodEnd,
  stripeSubscriptionItemForBilling,
  stripeTimestampToIso,
  type StripeBillingInterval,
  type StripeSubscriptionStatus,
} from "@/lib/stripe/billing-state";
import { getStripeServerClient } from "@/lib/stripe/config";

export type BillingSummaryPaymentMethod = {
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
};

export type BillingSummaryInvoice = {
  number: string;
  createdAt: string | null;
  amountPaid: number | null;
  amountDue: number | null;
  currency: string | null;
  status: string | null;
  hostedInvoiceUrl: string | null;
  invoicePdfUrl: string | null;
};

export type BillingSubscriptionSummary = {
  hasSubscription: boolean;
  plan: DmiPlan;
  status: StripeSubscriptionStatus | "none";
  billingInterval: StripeBillingInterval | null;
  recurringAmount: number | null;
  currency: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  cancellationEffectiveAt: string | null;
  paymentMethod: BillingSummaryPaymentMethod | null;
  invoices: BillingSummaryInvoice[];
};

type BillingSubscriptionRow = {
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
  stripe_subscription_status?: string | null;
  stripe_price_id?: string | null;
  dmi_plan?: string | null;
  current_period_end?: string | null;
  cancel_at_period_end?: boolean | null;
  updated_at?: string | null;
};

export async function getBillingSummaryForUser(
  userId: string
): Promise<BillingSubscriptionSummary> {
  const billingRow = await resolveBillingSubscriptionRow(userId);

  if (!billingRow?.stripe_subscription_id || !billingRow.stripe_customer_id) {
    return freeBillingSummary();
  }

  try {
    return await loadStripeBillingSummary(billingRow);
  } catch (error) {
    console.error("[DMI billing] Stripe billing summary failed", {
      userId,
      name: error instanceof Error ? error.name : "UnknownError",
    });

    throw new ApiRouteError(
      500,
      "INTERNAL_ERROR",
      "Could not load Stripe billing details. Please try again."
    );
  }
}

export async function setSubscriptionCancelAtPeriodEndForUser({
  userId,
  cancelAtPeriodEnd,
}: {
  userId: string;
  cancelAtPeriodEnd: boolean;
}): Promise<BillingSubscriptionSummary> {
  const billingRow = await resolveBillingSubscriptionRow(userId);

  if (!billingRow?.stripe_subscription_id || !billingRow.stripe_customer_id) {
    throw new ApiRouteError(
      404,
      "NOT_FOUND",
      "No Stripe subscription is available for this account."
    );
  }

  if (!canMutateSubscription(billingRow)) {
    throw new ApiRouteError(
      409,
      "CONFLICT",
      "This subscription cannot be updated in its current state."
    );
  }

  try {
    await getStripeServerClient().subscriptions.update(
      billingRow.stripe_subscription_id,
      {
        cancel_at_period_end: cancelAtPeriodEnd,
      }
    );

    return await getBillingSummaryForUser(userId);
  } catch (error) {
    console.error("[DMI billing] Stripe subscription update failed", {
      userId,
      action: cancelAtPeriodEnd ? "cancel_at_period_end" : "resume",
      name: error instanceof Error ? error.name : "UnknownError",
    });

    throw new ApiRouteError(
      500,
      "INTERNAL_ERROR",
      "Could not update the Stripe subscription. Please try again."
    );
  }
}

async function resolveBillingSubscriptionRow(userId: string) {
  const supabaseAdmin = createSupabaseAdminClient();
  const { data, error } = await supabaseAdmin
    .from("billing_subscriptions")
    .select(
      [
        "stripe_customer_id",
        "stripe_subscription_id",
        "stripe_subscription_status",
        "stripe_price_id",
        "dmi_plan",
        "current_period_end",
        "cancel_at_period_end",
        "updated_at",
      ].join(", ")
    )
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(10);

  if (error) {
    console.error("[DMI billing] billing subscription lookup failed", {
      userId,
      code: error.code,
    });

    throw new ApiRouteError(
      500,
      "INTERNAL_ERROR",
      "Could not load billing subscription state."
    );
  }

  const rows = (data || []) as BillingSubscriptionRow[];

  return (
    rows.find((row) =>
      ["active", "trialing", "past_due", "unpaid", "incomplete"].includes(
        row.stripe_subscription_status || ""
      )
    ) ||
    rows.find((row) => row.stripe_subscription_id && row.stripe_customer_id) ||
    null
  );
}

async function loadStripeBillingSummary(
  row: BillingSubscriptionRow
): Promise<BillingSubscriptionSummary> {
  const stripe = getStripeServerClient();
  const subscription = await stripe.subscriptions.retrieve(
    row.stripe_subscription_id || "",
    {
      expand: [
        "items.data.price",
        "default_payment_method",
        "latest_invoice",
      ],
    }
  );
  const subscriptionItem = stripeSubscriptionItemForBilling(
    subscription,
    row.stripe_price_id
  );
  const price = subscriptionItem?.price || null;
  const priceId = price?.id || row.stripe_price_id || null;
  const status = normalizeStripeSubscriptionStatus(subscription.status);
  const customerId = customerIdentifier(subscription.customer) || row.stripe_customer_id || "";
  const paymentMethod =
    paymentMethodFromStripeValue(subscription.default_payment_method) ||
    (customerId ? await defaultPaymentMethodForCustomer(customerId) : null);
  const invoices = customerId ? await recentInvoicesForCustomer(customerId) : [];
  const currentPeriodEnd =
    stripeSubscriptionCurrentPeriodEnd(subscription, row.stripe_price_id) ||
    row.current_period_end ||
    null;

  return {
    hasSubscription: true,
    plan: dmiPlanForStripePrice(priceId) || normalizeDmiPlan(row.dmi_plan),
    status,
    billingInterval: billingIntervalFromPrice(price),
    recurringAmount: price?.unit_amount ?? null,
    currency: price?.currency || null,
    currentPeriodEnd,
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
    cancellationEffectiveAt: subscription.cancel_at_period_end ? currentPeriodEnd : null,
    paymentMethod,
    invoices,
  };
}

async function defaultPaymentMethodForCustomer(customerId: string) {
  const customer = await getStripeServerClient().customers.retrieve(customerId, {
    expand: ["invoice_settings.default_payment_method"],
  });

  if (customer.deleted) return null;

  return paymentMethodFromStripeValue(customer.invoice_settings.default_payment_method);
}

async function recentInvoicesForCustomer(customerId: string) {
  const invoiceList = await getStripeServerClient().invoices.list({
    customer: customerId,
    limit: 12,
  });

  return invoiceList.data.map((invoice) => ({
    number: invoice.number || invoice.id,
    createdAt: stripeTimestampToIso(invoice.created),
    amountPaid: invoice.amount_paid ?? null,
    amountDue: invoice.amount_due ?? null,
    currency: invoice.currency || null,
    status: invoice.status || null,
    hostedInvoiceUrl: invoice.hosted_invoice_url || null,
    invoicePdfUrl: invoice.invoice_pdf || null,
  }));
}

function freeBillingSummary(): BillingSubscriptionSummary {
  return {
    hasSubscription: false,
    plan: "free",
    status: "none",
    billingInterval: null,
    recurringAmount: null,
    currency: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    cancellationEffectiveAt: null,
    paymentMethod: null,
    invoices: [],
  };
}

function customerIdentifier(
  customer: string | Stripe.Customer | Stripe.DeletedCustomer | null
) {
  if (typeof customer === "string") return customer;
  return customer?.id || "";
}

function billingIntervalFromPrice(
  price: Stripe.Price | null
): StripeBillingInterval | null {
  if (price?.recurring?.interval === "month") return "monthly";
  if (price?.recurring?.interval === "year") return "annual";

  return null;
}

function paymentMethodFromStripeValue(
  value: string | Stripe.PaymentMethod | null
): BillingSummaryPaymentMethod | null {
  if (!value || typeof value === "string") return null;

  if (value.type !== "card" || !value.card) return null;

  return {
    brand: value.card.brand || "card",
    last4: value.card.last4 || "",
    expMonth: value.card.exp_month,
    expYear: value.card.exp_year,
  };
}

function canMutateSubscription(row: BillingSubscriptionRow) {
  return ["active", "trialing", "past_due", "unpaid"].includes(
    row.stripe_subscription_status || ""
  );
}
