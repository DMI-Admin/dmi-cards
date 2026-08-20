"use client";

import {
  ArrowUpRight,
  CreditCard,
  Download,
  ExternalLink,
  ReceiptText,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { useEffect, useState } from "react";
import ClientSidebar from "@/components/ClientSidebar";
import UpgradeToProButton from "@/components/UpgradeToProButton";
import type { DmiPlan } from "@/lib/entitlements";
import { supabase } from "@/lib/supabase";
import { useClientPlan } from "@/lib/use-client-plan";

type BillingSubscriptionSummary = {
  hasSubscription: boolean;
  plan: DmiPlan;
  status:
    | "active"
    | "trialing"
    | "past_due"
    | "unpaid"
    | "canceled"
    | "incomplete"
    | "incomplete_expired"
    | "paused"
    | "unknown"
    | "none";
  billingInterval: "monthly" | "annual" | null;
  recurringAmount: number | null;
  currency: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  cancellationEffectiveAt: string | null;
  paymentMethod: {
    brand: string;
    last4: string;
    expMonth: number;
    expYear: number;
  } | null;
  invoices: Array<{
    number: string;
    createdAt: string | null;
    amountPaid: number | null;
    amountDue: number | null;
    currency: string | null;
    status: string | null;
    hostedInvoiceUrl: string | null;
    invoicePdfUrl: string | null;
  }>;
};

type BillingApiState =
  | { status: "loading"; data: null; error: "" }
  | { status: "ready"; data: BillingSubscriptionSummary; error: "" }
  | { status: "error"; data: null; error: string };

const billingSectionClass =
  "rounded-3xl border border-white/10 bg-[#101935]/70 p-6 shadow-[0_18px_48px_rgba(0,0,0,0.18)] transition-[border-color,box-shadow,transform] duration-200 ease-out md:hover:border-[#AC00FF]/25 md:hover:shadow-[0_18px_46px_rgba(172,0,255,0.12)] motion-safe:md:hover:-translate-y-0.5";
const billingPillClass =
  "inline-flex min-h-8 items-center justify-center whitespace-nowrap rounded-full border px-3 py-0 text-xs font-semibold leading-none align-middle";

export default function ClientBillingPage() {
  const { plan, isPaid } = useClientPlan();
  const [billingState, setBillingState] = useState<BillingApiState>({
    status: "loading",
    data: null,
    error: "",
  });
  const [portalLoading, setPortalLoading] = useState(false);
  const [portalError, setPortalError] = useState("");
  const [subscriptionPanelOpen, setSubscriptionPanelOpen] = useState(false);
  const [subscriptionActionLoading, setSubscriptionActionLoading] = useState(false);
  const [subscriptionActionError, setSubscriptionActionError] = useState("");
  const billing = billingState.data;
  const currentPlan = (billing?.plan || plan || "free") as DmiPlan;
  const planName = currentPlan === "pro" ? "Individual Pro" : currentPlan === "enterprise" ? "Enterprise" : "Free";
  const statusDisplay = billing
    ? customerStatusLabel(billing)
    : { title: "Loading", caption: "Checking Stripe billing" };
  const nextPayment = nextPaymentDisplay(billing);

  useEffect(() => {
    void loadBillingSummary();
  }, []);

  async function loadBillingSummary() {
    setBillingState({ status: "loading", data: null, error: "" });

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Please sign in again to view billing details.");
      }

      const response = await fetch("/api/v1/billing/subscription", {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok || !payload?.data) {
        const message =
          typeof payload?.error?.message === "string"
            ? payload.error.message
            : "Could not load billing details.";
        throw new Error(message);
      }

      setBillingState({ status: "ready", data: payload.data, error: "" });
    } catch (error) {
      setBillingState({
        status: "error",
        data: null,
        error:
          error instanceof Error
            ? error.message
            : "Could not load billing details.",
      });
    }
  }

  async function updateSubscriptionCancellation(cancelAtPeriodEnd: boolean) {
    if (subscriptionActionLoading) return;

    setSubscriptionActionLoading(true);
    setSubscriptionActionError("");

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Please sign in again before managing your subscription.");
      }

      const response = await fetch(
        cancelAtPeriodEnd
          ? "/api/v1/billing/subscription/cancel"
          : "/api/v1/billing/subscription/resume",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        }
      );
      const payload = await response.json().catch(() => null);

      if (!response.ok || !payload?.data) {
        const message =
          typeof payload?.error?.message === "string"
            ? payload.error.message
            : "Could not update your subscription.";
        throw new Error(message);
      }

      setBillingState({ status: "ready", data: payload.data, error: "" });
      setSubscriptionPanelOpen(false);
    } catch (error) {
      setSubscriptionActionError(
        error instanceof Error
          ? error.message
          : "Could not update your subscription."
      );
    } finally {
      setSubscriptionActionLoading(false);
    }
  }

  async function openBillingPortal() {
    if (portalLoading) return;

    setPortalLoading(true);
    setPortalError("");

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Please sign in again before managing your subscription.");
      }

      const response = await fetch("/api/stripe/portal", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });
      const payload = await response.json().catch(() => null);
      const portalUrl =
        typeof payload?.url === "string"
          ? payload.url
          : typeof payload?.data?.url === "string"
            ? payload.data.url
            : "";

      if (!response.ok || !portalUrl) {
        const message =
          typeof payload?.error?.message === "string"
            ? payload.error.message
            : "Could not open subscription management.";
        throw new Error(message);
      }

      window.location.assign(portalUrl);
    } catch (error) {
      setPortalError(
        error instanceof Error
          ? error.message
          : "Could not open subscription management."
      );
      setPortalLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen bg-[#070B1A] text-white">
      <ClientSidebar />

      <section className="flex-1 p-6 sm:p-8 lg:p-10">
        <div className="mb-8 flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-4xl font-bold">Billing</h1>
            </div>
            <p className="mt-3 max-w-3xl text-white/50">
              Manage your subscription, payment method and invoices.
            </p>
          </div>

          {!isPaid && (
            <UpgradeToProButton className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#AC00FF] to-[#6C2CFF] px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-purple-500/25 transition hover:shadow-purple-400/35 sm:w-auto">
              <Sparkles className="h-4 w-4" />
              Upgrade to Individual Pro
            </UpgradeToProButton>
          )}
        </div>

        {billingState.status === "error" && (
          <BillingErrorState message={billingState.error} onRetry={loadBillingSummary} />
        )}

        <div className="space-y-6">
            <section className={billingSectionClass}>
              <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <SectionTitle
                    title="Current Plan"
                    description="View your current subscription and billing details."
                  />
                </div>

                {!isPaid && (
                  <UpgradeToProButton className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#AC00FF] px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-purple-500/20 transition hover:bg-[#BE35FF] sm:w-auto">
                    Upgrade to Individual Pro
                    <ArrowUpRight className="h-4 w-4" />
                  </UpgradeToProButton>
                )}
              </div>

              <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                <div>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <h2 className="text-2xl font-semibold">{planName} Plan</h2>
                    <div className="flex flex-wrap gap-2 sm:justify-end">
                      <BillingBadge status={statusDisplay.title} />
                      {billing?.billingInterval && (
                        <span className={`${billingPillClass} border-white/10 bg-white/5 text-white/65`}>
                          {billingIntervalLabel(billing.billingInterval)}
                        </span>
                      )}
                      {billing && canManageNativeSubscription(billing) && (
                        subscriptionActionLoading ? (
                          <button
                            type="button"
                            disabled
                            className={`${billingPillClass} cursor-not-allowed border-white/10 bg-white/5 text-white/45 opacity-70`}
                          >
                            Updating...
                          </button>
                        ) : billing.cancelAtPeriodEnd ? (
                          <button
                            type="button"
                            onClick={() => updateSubscriptionCancellation(false)}
                            className={`${billingPillClass} border-white/10 bg-white/5 text-white/75 transition hover:border-[#AC00FF]/40 hover:bg-[#AC00FF]/10 hover:text-white`}
                          >
                            Keep my subscription
                          </button>
                        ) : !subscriptionPanelOpen ? (
                          <button
                            type="button"
                            onClick={() => {
                              setSubscriptionPanelOpen(true);
                              setSubscriptionActionError("");
                            }}
                            className={`${billingPillClass} border-white/10 bg-white/5 text-white/75 transition hover:border-[#AC00FF]/40 hover:bg-[#AC00FF]/10 hover:text-white`}
                          >
                            Manage subscription
                          </button>
                        ) : null
                      )}
                    </div>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-white/55">
                    {subscriptionDescription(billing)}
                  </p>

                  <div className="mt-6 grid gap-4 rounded-2xl border border-white/10 bg-white/[0.035] p-4 sm:grid-cols-2 xl:grid-cols-4">
                    <PlanDetail label="Status" value={statusDisplay.title} caption={statusDisplay.caption} />
                    <PlanDetail
                      label="Billing interval"
                      value={billingIntervalLabel(billing?.billingInterval || null)}
                      caption={currentPlan === "pro" ? "Recurring Stripe subscription" : "No paid billing interval"}
                    />
                    <PlanDetail
                      label="Subscription price"
                      value={subscriptionPriceDisplay(billing)}
                      caption={billing?.billingInterval ? `Per ${billing.billingInterval === "annual" ? "year" : "month"}` : "No recurring charge"}
                    />
                    <PlanDetail
                      label={billing?.cancelAtPeriodEnd ? "Subscription ends" : "Next payment"}
                      value={renewalDateDisplay(billing)}
                      caption={nextPayment.caption}
                    />
                  </div>

                  {subscriptionPanelOpen && billing && !billing.cancelAtPeriodEnd && (
                    <SubscriptionManagementPanel
                      billing={billing}
                      loading={subscriptionActionLoading}
                      error={subscriptionActionError}
                      onKeep={() => {
                        setSubscriptionPanelOpen(false);
                        setSubscriptionActionError("");
                      }}
                      onCancelAtPeriodEnd={() => updateSubscriptionCancellation(true)}
                    />
                  )}
                </div>
              </div>
            </section>

            <PaymentMethodPanel
              billing={billing}
              loading={billingState.status === "loading"}
              onOpenPortal={openBillingPortal}
              portalLoading={portalLoading}
              portalError={portalError}
            />

            <InvoicesSection invoices={billing?.invoices || []} loading={billingState.status === "loading"} />
        </div>
      </section>
    </main>
  );
}

function BillingErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="mb-6 rounded-3xl border border-red-400/20 bg-red-500/10 p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-semibold text-red-100">Billing details could not be loaded</h2>
          <p className="mt-2 text-sm leading-6 text-red-50/65">{message}</p>
        </div>
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-red-100/15 bg-white/5 px-4 py-2 text-sm font-semibold text-red-50 transition hover:bg-white/10"
        >
          <RefreshCw className="h-4 w-4" />
          Retry
        </button>
      </div>
    </div>
  );
}

function SubscriptionManagementPanel({
  billing,
  loading,
  error,
  onKeep,
  onCancelAtPeriodEnd,
}: {
  billing: BillingSubscriptionSummary;
  loading: boolean;
  error: string;
  onKeep: () => void;
  onCancelAtPeriodEnd: () => void;
}) {
  const renewalDate = renewalDateDisplay(billing);

  return (
    <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.025] p-4">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h3 className="text-base font-semibold">Cancel Individual Pro?</h3>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-white/55">
            Your Pro features will remain active until {renewalDate}. You will
            not be charged again after that date.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center md:justify-end">
          {loading ? (
            <button
              type="button"
              disabled
              className="inline-flex min-h-10 w-full items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/45 opacity-70 sm:w-auto"
            >
              Updating...
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onKeep}
                className="inline-flex min-h-10 w-full items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/70 transition hover:border-[#AC00FF]/40 hover:bg-[#AC00FF]/10 hover:text-white sm:w-auto"
              >
                Back
              </button>
              <button
                type="button"
                onClick={onCancelAtPeriodEnd}
                className="inline-flex min-h-10 w-full items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/70 transition hover:border-red-300/30 hover:text-red-100 sm:w-auto"
              >
                Cancel subscription
              </button>
            </>
          )}
        </div>
      </div>

      {error && <p className="mt-3 text-sm leading-6 text-red-200">{error}</p>}
    </div>
  );
}

function PaymentMethodPanel({
  billing,
  loading,
  onOpenPortal,
  portalLoading,
  portalError,
}: {
  billing: BillingSubscriptionSummary | null;
  loading: boolean;
  onOpenPortal: () => void;
  portalLoading: boolean;
  portalError: string;
}) {
  const paymentMethod = billing?.paymentMethod;
  const canManagePayment = Boolean(billing?.hasSubscription);

  return (
    <section className={billingSectionClass}>
      <SectionTitle
        title="Payment Method"
        description="Manage the payment method Stripe uses for your subscription."
      />

      <div className="mt-6 flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/5 text-white/55">
            <CreditCard className="h-7 w-7" />
          </div>

        {loading ? (
          <div>
            <h3 className="text-lg font-semibold">Loading payment method</h3>
            <p className="mt-1 text-sm leading-6 text-white/45">
              Checking Stripe for your current billing details.
            </p>
          </div>
        ) : paymentMethod ? (
          <div>
            <h3 className="text-lg font-semibold">
              {formatCardBrand(paymentMethod.brand)} •••• {paymentMethod.last4}
            </h3>
            <p className="mt-1 text-sm leading-6 text-white/45">
              Expires {formatExpiry(paymentMethod.expMonth, paymentMethod.expYear)}
            </p>
          </div>
        ) : billing?.hasSubscription ? (
          <div>
            <h3 className="text-lg font-semibold">No saved payment method found</h3>
            <p className="mt-1 text-sm leading-6 text-white/45">
              Stripe did not return a usable default card for this subscription.
            </p>
          </div>
        ) : (
          <div>
            <h3 className="text-lg font-semibold">No payment method required</h3>
            <p className="mt-1 text-sm leading-6 text-white/45">
              Free plans do not require a Stripe subscription or payment method.
            </p>
          </div>
        )}
        </div>

        {canManagePayment && (
          <button
            type="button"
            onClick={onOpenPortal}
            disabled={portalLoading}
            className="inline-flex w-full shrink-0 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white/70 transition hover:border-[#AC00FF]/50 hover:bg-[#AC00FF]/15 hover:text-white disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
          >
            <ExternalLink className="h-4 w-4" />
            {portalLoading ? "Opening Stripe..." : "Update payment method"}
          </button>
        )}

      </div>

      {portalError && (
        <p className="mt-3 text-sm leading-6 text-red-200">{portalError}</p>
      )}
    </section>
  );
}

function InvoicesSection({
  invoices,
  loading,
}: {
  invoices: BillingSubscriptionSummary["invoices"];
  loading: boolean;
}) {
  return (
    <section className={billingSectionClass}>
      <div className="mb-6">
        <SectionTitle
          title="Invoices"
          description="Recent invoices generated by Stripe for this account."
        />
      </div>

      {loading ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-sm text-white/45">
          Loading invoice history...
        </div>
      ) : invoices.length === 0 ? (
        <div>
          <div className="rounded-2xl border border-dashed border-white/15 bg-white/[0.03] p-6 text-center">
            <ReceiptText className="mx-auto h-8 w-8 text-white/35" />
            <h3 className="mt-4 text-lg font-semibold">No invoices yet</h3>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-white/45">
              Stripe invoice history will appear here after a paid subscription
              creates invoices for this account.
            </p>
          </div>
        </div>
      ) : (
        <div className="max-w-full overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.03]">
          <table className="w-full min-w-[720px]">
            <thead className="bg-[#0B1024] text-left text-xs uppercase tracking-[0.14em] text-white/40">
              <tr>
                <th className="px-6 py-4">Invoice</th>
                <th className="px-6 py-4">Date</th>
                <th className="px-6 py-4">Amount</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Download</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((invoice) => {
                const actionUrl = invoice.invoicePdfUrl || invoice.hostedInvoiceUrl;

                return (
                  <tr
                    key={`${invoice.number}-${invoice.createdAt || "invoice"}`}
                    className="border-t border-white/5 hover:bg-white/[0.03]"
                  >
                    <td className="px-6 py-5">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/5 text-purple-100">
                          <ReceiptText className="h-5 w-5" />
                        </div>
                        <span className="font-semibold">{invoice.number}</span>
                      </div>
                    </td>
                    <td className="px-6 py-5 text-white/65">
                      {formatDate(invoice.createdAt)}
                    </td>
                    <td className="px-6 py-5 text-white/65">
                      {formatMoney(invoice.amountPaid ?? invoice.amountDue, invoice.currency)}
                    </td>
                    <td className="px-6 py-5">
                      <BillingBadge status={invoiceStatusLabel(invoice.status)} />
                    </td>
                    <td className="px-6 py-5">
                      {actionUrl ? (
                        <a
                          href={actionUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white/65 transition hover:border-[#AC00FF]/50 hover:text-white"
                          aria-label={`Download ${invoice.number}`}
                        >
                          <Download className="h-4 w-4" />
                        </a>
                      ) : (
                        <span className="text-sm text-white/35">Unavailable</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function PlanDetail({
  label,
  value,
  caption,
}: {
  label: string;
  value: string;
  caption: string;
}) {
  return (
    <div>
      <p className="text-sm font-medium text-white/55">
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold text-white">{value}</p>
      <p className="mt-1 text-sm leading-5 text-white/45">{caption}</p>
    </div>
  );
}

function BillingBadge({ status }: { status: string }) {
  const styles =
    status === "Active" || status === "Paid" || status === "Succeeded"
      ? "bg-green-500/15 text-green-200 border-green-400/20"
      : status === "Trialing"
        ? "bg-blue-500/15 text-blue-200 border-blue-400/20"
        : status === "Cancelling"
          ? "bg-white text-red-600 border-red-200"
          : status === "Past due"
          ? "bg-yellow-500/15 text-yellow-100 border-yellow-300/20"
          : status === "No subscription"
            ? "bg-white/5 text-white/55 border-white/10"
            : "bg-red-500/15 text-red-200 border-red-400/20";

  return (
    <span
      className={`${billingPillClass} ${styles}`}
    >
      {status}
    </span>
  );
}

function SectionTitle({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div>
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-white/45">{description}</p>
    </div>
  );
}

function customerStatusLabel(billing: BillingSubscriptionSummary) {
  if (!billing.hasSubscription) {
    return {
      title: "No subscription",
      caption: "No payment required",
    };
  }

  if (billing.cancelAtPeriodEnd) {
    return {
      title: "Cancelling",
      caption: `Cancels on ${formatDate(billing.cancellationEffectiveAt)}`,
    };
  }

  const statusMap: Record<string, { title: string; caption: string }> = {
    active: { title: "Active", caption: "Stripe subscription active" },
    trialing: { title: "Trialing", caption: "Stripe trial subscription" },
    past_due: { title: "Past due", caption: "Payment requires attention" },
    unpaid: { title: "Unpaid", caption: "Payment has not been completed" },
    canceled: { title: "Canceled", caption: "Subscription is no longer active" },
    incomplete: { title: "Incomplete", caption: "Checkout or payment is incomplete" },
    incomplete_expired: {
      title: "Expired",
      caption: "Incomplete subscription expired",
    },
    paused: { title: "Paused", caption: "Subscription is paused in Stripe" },
    unknown: { title: "Unknown", caption: "Stripe status unavailable" },
  };

  return statusMap[billing.status] || statusMap.unknown;
}

function canManageNativeSubscription(billing: BillingSubscriptionSummary | null) {
  return Boolean(
    billing?.hasSubscription &&
      billing.plan === "pro" &&
      (billing.status === "active" || billing.status === "trialing")
  );
}

function nextPaymentDisplay(billing: BillingSubscriptionSummary | null) {
  if (!billing) {
    return { value: "Loading", caption: "Checking Stripe billing" };
  }

  if (!billing.hasSubscription) {
    return { value: "None", caption: "Free plan has no renewal date" };
  }

  if (billing.cancelAtPeriodEnd) {
    return {
      value: formatDate(billing.cancellationEffectiveAt),
      caption: "Features remain available until this date",
    };
  }

  const amount = formatMoney(billing.recurringAmount, billing.currency);
  const date = billing.currentPeriodEnd ? `Due ${formatDate(billing.currentPeriodEnd)}` : "";

  return {
    value: amount === "Unavailable" ? "Not available" : amount,
    caption: date || "Stripe did not return a renewal date",
  };
}

function subscriptionDescription(billing: BillingSubscriptionSummary | null) {
  if (!billing) return "Loading subscription details.";
  if (!billing.hasSubscription) return "No Stripe subscription required.";
  if (billing.billingInterval === "annual") return "Annual subscription.";
  if (billing.billingInterval === "monthly") return "Monthly subscription.";

  return "Stripe subscription.";
}

function subscriptionPriceDisplay(billing: BillingSubscriptionSummary | null) {
  if (!billing?.hasSubscription) return "None";

  return formatMoney(billing.recurringAmount, billing.currency);
}

function renewalDateDisplay(billing: BillingSubscriptionSummary | null) {
  if (!billing) return "Loading";
  if (!billing.hasSubscription) return "None";
  if (billing.cancelAtPeriodEnd) return formatDate(billing.cancellationEffectiveAt);

  return billing.currentPeriodEnd ? formatDate(billing.currentPeriodEnd) : "Not available";
}

function billingIntervalLabel(interval: BillingSubscriptionSummary["billingInterval"]) {
  if (interval === "monthly") return "Monthly";
  if (interval === "annual") return "Annual";

  return "No billing interval";
}

function invoiceStatusLabel(status: string | null) {
  if (!status) return "Unknown";

  return status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatMoney(amount: number | null | undefined, currency: string | null | undefined) {
  if (typeof amount !== "number" || !currency) return "Unavailable";

  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amount / 100);
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Unavailable";

  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(value));
}

function formatExpiry(month: number, year: number) {
  return `${String(month).padStart(2, "0")}/${String(year).slice(-2)}`;
}

function formatCardBrand(brand: string) {
  return brand
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
