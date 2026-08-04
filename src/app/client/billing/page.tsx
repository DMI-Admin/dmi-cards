import type { LucideIcon } from "lucide-react";
import {
  ArrowUpRight,
  BadgeCheck,
  CalendarDays,
  Check,
  CircleDollarSign,
  CreditCard,
  Download,
  Lock,
  ReceiptText,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import ClientSidebar from "@/components/ClientSidebar";

const currentPlan = "free";

const invoices = [
  {
    invoice: "INV-2026-001",
    date: "May 1, 2026",
    amount: "GBP 0.00",
    status: "Active",
  },
  {
    invoice: "INV-2026-000",
    date: "Apr 1, 2026",
    amount: "GBP 0.00",
    status: "Active",
  },
  {
    invoice: "INV-2025-012",
    date: "Dec 1, 2025",
    amount: "GBP 0.00",
    status: "Trial",
  },
];

const freeFeatures = [
  "1 digital card",
  "Free Classic template",
  "QR code",
  "Wallet",
  "Public page",
  "Limited colours",
];

const plans = [
  {
    name: "Free",
    price: "GBP 0",
    description: "Start with one public digital card.",
    features: ["1 card", "QR code", "Wallet", "Public page", "Free colours"],
    active: true,
  },
  {
    name: "Individual Pro",
    price: "Upgrade",
    description: "Unlock premium personal branding and lead tools.",
    features: [
      "premium templates",
      "tap to share",
      "contacts",
      "analytics",
      "integrations",
      "advanced QR",
      "custom colours/fonts",
    ],
    highlighted: true,
  },
  {
    name: "Business / Enterprise",
    price: "Talk to DMI",
    description: "Manage teams, staff cards, reporting, and admin controls.",
    features: [
      "staff cards",
      "company branding",
      "bulk upload",
      "team analytics",
      "CRM reports",
      "admin controls",
    ],
  },
];

export default function ClientBillingPage() {
  return (
    <main className="flex min-h-screen bg-[#070B1A] text-white">
      <ClientSidebar />

      <section className="flex-1 p-10">
        <div className="mb-8 flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#AC00FF]">
              Client Portal
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <h1 className="text-4xl font-bold">Billing</h1>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-white/60">
                {currentPlan} plan
              </span>
            </div>
            <p className="mt-3 max-w-3xl text-white/50">
              Manage your subscription, invoices, and payment details.
            </p>
          </div>

          <button
            type="button"
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#AC00FF] to-[#6C2CFF] px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-purple-500/25 transition hover:shadow-purple-400/35"
          >
            <Sparkles className="h-4 w-4" />
            Upgrade to Individual Pro
          </button>
        </div>

        <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <SummaryCard
            label="Current Plan"
            value="Free"
            caption="1 card included"
            icon={BadgeCheck}
          />
          <SummaryCard
            label="Billing Status"
            value="Active"
            caption="No payment required"
            icon={ShieldCheck}
          />
          <SummaryCard
            label="Next Payment"
            value="None"
            caption="Upgrade to start billing"
            icon={CalendarDays}
          />
          <SummaryCard
            label="Payment Method"
            value="Not added"
            caption="Stripe coming soon"
            icon={CreditCard}
          />
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="space-y-6">
            <section className="rounded-3xl border border-white/10 bg-[#101935]/70 p-6 shadow-2xl shadow-black/20">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <SectionTitle
                    title="Current Plan"
                    description="Your active subscription and included features."
                  />
                  <div className="mt-5 flex flex-wrap gap-2">
                    <BillingBadge status="Active" />
                    <span className="rounded-full border border-[#AC00FF]/25 bg-[#AC00FF]/10 px-3 py-1 text-xs font-semibold text-purple-100">
                      Free Plan
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#AC00FF] px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-purple-500/20 transition hover:bg-[#BE35FF]"
                >
                  Upgrade to Individual Pro
                  <ArrowUpRight className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-6 rounded-3xl border border-[#AC00FF]/25 bg-gradient-to-br from-[#AC00FF]/15 via-white/[0.04] to-[#101935] p-6">
                <div className="flex items-start gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#AC00FF]/20 text-purple-100">
                    <CircleDollarSign className="h-6 w-6" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-semibold">Free Plan</h2>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-white/55">
                      A simple starting plan for publishing your first DMI Cards
                      digital business card.
                    </p>
                  </div>
                </div>

                <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {freeFeatures.map((feature) => (
                    <FeaturePill key={feature}>{feature}</FeaturePill>
                  ))}
                </div>
              </div>
            </section>

            <section className="rounded-3xl border border-white/10 bg-[#101935]/70 p-6 shadow-2xl shadow-black/20">
              <SectionTitle
                title="Plan Comparison"
                description="Choose the right level of access for your card workflow."
              />

              <div className="mt-6 grid gap-4 lg:grid-cols-3">
                {plans.map((plan) => (
                  <PlanCard key={plan.name} {...plan} />
                ))}
              </div>
            </section>

            <section className="rounded-3xl border border-white/10 bg-[#101935]/70 shadow-2xl shadow-black/20">
              <div className="flex flex-col gap-4 border-b border-white/10 p-6 lg:flex-row lg:items-center lg:justify-between">
                <SectionTitle
                  title="Invoices"
                  description="Mock invoice history. Stripe invoice sync will be added later."
                />
                <button
                  type="button"
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white/70 transition hover:border-[#AC00FF]/50 hover:bg-[#AC00FF]/15 hover:text-white"
                >
                  <Download className="h-4 w-4" />
                  Download All
                </button>
              </div>

              <div className="overflow-x-auto">
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
                    {invoices.map((invoice) => (
                      <tr
                        key={invoice.invoice}
                        className="border-t border-white/5 hover:bg-white/[0.03]"
                      >
                        <td className="px-6 py-5">
                          <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/5 text-purple-100">
                              <ReceiptText className="h-5 w-5" />
                            </div>
                            <span className="font-semibold">{invoice.invoice}</span>
                          </div>
                        </td>
                        <td className="px-6 py-5 text-white/65">{invoice.date}</td>
                        <td className="px-6 py-5 text-white/65">{invoice.amount}</td>
                        <td className="px-6 py-5">
                          <BillingBadge status={invoice.status} />
                        </td>
                        <td className="px-6 py-5">
                          <button
                            type="button"
                            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white/65 transition hover:border-[#AC00FF]/50 hover:text-white"
                            aria-label={`Download ${invoice.invoice}`}
                          >
                            <Download className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          <aside className="space-y-6 xl:sticky xl:top-8 xl:self-start">
            <section className="rounded-3xl border border-white/10 bg-[#101935]/70 p-6 shadow-2xl shadow-black/20">
              <SectionTitle
                title="Payment Method"
                description="Payment cards and direct debit details will appear here."
              />

              <div className="mt-6 rounded-3xl border border-dashed border-white/15 bg-white/[0.03] p-6 text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-3xl bg-white/5 text-white/55">
                  <CreditCard className="h-7 w-7" />
                </div>
                <h3 className="mt-5 text-lg font-semibold">
                  No payment method added
                </h3>
                <p className="mt-2 text-sm leading-6 text-white/45">
                  Add a payment method when you upgrade to a paid DMI Cards
                  plan.
                </p>
                <button
                  type="button"
                  className="mt-5 inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white/70 transition hover:border-[#AC00FF]/50 hover:bg-[#AC00FF]/15 hover:text-white"
                >
                  Add Payment Method
                </button>
              </div>
            </section>

            <section className="rounded-3xl border border-[#AC00FF]/25 bg-[#AC00FF]/10 p-6 shadow-lg shadow-purple-950/15">
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#AC00FF]/20">
                  <Lock className="h-6 w-6 text-purple-100" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold">
                    Stripe billing coming soon
                  </h2>
                  <p className="mt-3 text-sm leading-6 text-white/60">
                    Billing will be securely managed through Stripe. Payment
                    actions on this page are placeholders for now.
                  </p>
                </div>
              </div>
            </section>

            <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
              <SectionTitle
                title="Billing Status Logic"
                description="Future statuses that Finance/Stripe will control."
              />
              <div className="mt-5 flex flex-wrap gap-2">
                {["Active", "Trial", "Past Due", "Suspended"].map((status) => (
                  <BillingBadge key={status} status={status} />
                ))}
              </div>
            </section>
          </aside>
        </div>
      </section>
    </main>
  );
}

function SummaryCard({
  label,
  value,
  caption,
  icon: Icon,
}: {
  label: string;
  value: string;
  caption: string;
  icon: LucideIcon;
}) {
  return (
    <div className="min-h-36 rounded-3xl border border-white/10 bg-white/5 p-5 shadow-lg shadow-black/10">
      <div className="flex items-center justify-between gap-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/35">
          {label}
        </p>
        <Icon className="h-5 w-5 text-purple-200" />
      </div>
      <p className="mt-5 text-3xl font-semibold tracking-tight">{value}</p>
      <p className="mt-3 text-sm text-white/45">{caption}</p>
    </div>
  );
}

function PlanCard({
  name,
  price,
  description,
  features,
  active = false,
  highlighted = false,
}: {
  name: string;
  price: string;
  description: string;
  features: string[];
  active?: boolean;
  highlighted?: boolean;
}) {
  return (
    <article
      className={`flex min-h-[420px] flex-col rounded-3xl border p-5 transition ${
        highlighted
          ? "border-[#AC00FF]/55 bg-[#AC00FF]/12 shadow-lg shadow-purple-500/15"
          : "border-white/10 bg-white/5"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-xl font-semibold">{name}</h3>
          <p className="mt-2 text-sm leading-6 text-white/45">{description}</p>
        </div>
        {active && (
          <span className="rounded-full bg-green-500/15 px-3 py-1 text-xs font-semibold text-green-200">
            Current
          </span>
        )}
      </div>

      <p className="mt-5 text-2xl font-semibold">{price}</p>

      <div className="mt-5 flex-1 space-y-3">
        {features.map((feature) => (
          <div key={feature} className="flex items-start gap-3 text-sm text-white/65">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-purple-200" />
            <span>{feature}</span>
          </div>
        ))}
      </div>

      <button
        type="button"
        className={`mt-6 inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold transition ${
          highlighted
            ? "bg-[#AC00FF] text-white shadow-lg shadow-purple-500/20 hover:bg-[#BE35FF]"
            : "border border-white/10 bg-white/5 text-white/70 hover:border-[#AC00FF]/50 hover:bg-[#AC00FF]/15 hover:text-white"
        }`}
      >
        {active ? "Current Plan" : "Select Plan"}
      </button>
    </article>
  );
}

function FeaturePill({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/70">
      <Check className="h-4 w-4 text-purple-200" />
      {children}
    </div>
  );
}

function BillingBadge({ status }: { status: string }) {
  const styles =
    status === "Active"
      ? "bg-green-500/15 text-green-200 border-green-400/20"
      : status === "Trial"
      ? "bg-blue-500/15 text-blue-200 border-blue-400/20"
      : status === "Past Due"
      ? "bg-yellow-500/15 text-yellow-100 border-yellow-300/20"
      : "bg-red-500/15 text-red-200 border-red-400/20";

  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${styles}`}
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
