"use client";

import { useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  ContactRound,
  Download,
  FileSpreadsheet,
  Globe2,
  Lock,
  PieChart,
  QrCode,
  Radio,
  Share2,
  UsersRound,
  WalletCards,
} from "lucide-react";
import ClientSidebar from "@/components/ClientSidebar";
import { ClientAuthRequiredError, getCurrentUser } from "@/lib/client-auth";
import { supabase } from "@/lib/supabase";
import { useClientPlan } from "@/lib/use-client-plan";

const mockCard = {
  name: "Primary Digital Card",
};

const summaryStats = [
  { label: "Total Views", value: "12,842", change: "+18.4%", trend: "up", icon: BarChart3 },
  { label: "QR Scans", value: "3,284", change: "+9.7%", trend: "up", icon: QrCode },
  { label: "Wallet Opens", value: "1,946", change: "+12.1%", trend: "up", icon: WalletCards },
  { label: "Tap to Share Uses", value: "742", change: "+4.3%", trend: "up", icon: Radio },
  { label: "Contacts Captured", value: "386", change: "-2.8%", trend: "down", icon: ContactRound },
  { label: "Conversion Rate", value: "18.4%", change: "+1.6%", trend: "up", icon: PieChart },
];

const engagementSeries = [
  { label: "Views", value: 88, colour: "bg-[#AC00FF]" },
  { label: "Shares", value: 56, colour: "bg-blue-400" },
  { label: "Contact captures", value: 42, colour: "bg-green-400" },
  { label: "QR scans", value: 68, colour: "bg-yellow-300" },
];

const trafficSources = [
  { label: "QR Code", value: 34, icon: QrCode },
  { label: "Wallet", value: 22, icon: WalletCards },
  { label: "Tap to Share", value: 18, icon: Radio },
  { label: "Public Page", value: 16, icon: Globe2 },
  { label: "Direct Link", value: 10, icon: Share2 },
];

const devices = [
  { label: "iPhone", value: 46 },
  { label: "Android", value: 31 },
  { label: "Desktop", value: 17 },
  { label: "Tablet", value: 6 },
];

const activityFeed = [
  "John Smith scanned your QR code",
  "New lead captured from Wallet",
  "Tap to Share used on iPhone 16 Pro",
  "Public card viewed from London",
  "Direct link opened from email",
];

export default function ClientAnalyticsPage() {
  const { isPaid } = useClientPlan();
  const [mounted, setMounted] = useState(false);
  const [cardName, setCardName] = useState(mockCard.name);

  useEffect(() => {
    let ignore = false;

    async function loadCardName() {
      try {
        const user = await getCurrentUser();

        if (!user) {
          throw new ClientAuthRequiredError();
        }
        const { data, error } = await supabase
          .from("cards")
          .select("card_name")
          .eq("user_id", user.id)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (ignore) return;

        if (error) {
          console.error("Analytics card fetch failed", error);
          return;
        }

        if (data?.card_name) {
          setCardName(data.card_name);
        }
      } catch (error) {
        if (!(error instanceof ClientAuthRequiredError)) {
          console.error("Analytics card load failed", error);
        }
      } finally {
        if (!ignore) setMounted(true);
      }
    }

    void loadCardName();

    return () => {
      ignore = true;
    };
  }, []);

  const cardOptions = mounted ? ["All Cards", cardName] : ["All Cards"];

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
              <h1 className="text-4xl font-bold">Analytics</h1>
              {isPaid && (
                <span className="rounded-full border border-yellow-300/25 bg-yellow-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-yellow-100">
                  Dev mode: Pro preview
                </span>
              )}
            </div>
            <p className="mt-3 max-w-4xl text-white/50">
              Track views, scans, shares, and lead generation performance from
              your digital business card.
            </p>
          </div>

          <div className="grid gap-3 sm:flex sm:flex-wrap">
            <ActionButton icon={Download}>Export PDF</ActionButton>
            <ActionButton icon={FileSpreadsheet}>Export CSV</ActionButton>
            <ActionButton icon={CalendarDays}>Schedule Monthly Report</ActionButton>
          </div>
        </div>

        <section className="relative">
          {!isPaid && <LockedOverlay />}

          <div className={!isPaid ? "pointer-events-none blur-[2px]" : ""}>
            <div className="mb-6 rounded-3xl border border-white/10 bg-[#101935]/70 p-5 shadow-2xl shadow-black/20">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <FilterSelect label="Date range" options={["Last 30 days", "Last 7 days", "This month", "This year"]} />
                <FilterSelect label="Card" options={cardOptions} />
                <FilterSelect label="Traffic source" options={["All sources", "QR Code", "Wallet", "Tap to Share", "Public Page", "Direct Link"]} />
                <FilterSelect label="Device" options={["All devices", "iPhone", "Android", "Desktop", "Tablet"]} />
              </div>
            </div>

            <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-6">
              {summaryStats.map((stat) => (
                <SummaryCard key={stat.label} {...stat} />
              ))}
            </div>

            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)]">
              <div className="space-y-6">
                <EngagementOverview />

                <div className="grid gap-6 lg:grid-cols-2">
                  <TrafficSources />
                  <DeviceBreakdown />
                </div>

                <EnterprisePreview />
              </div>

              <aside className="space-y-6 xl:sticky xl:top-8 xl:self-start">
                <TopCard cardName={cardName} />
                <GeoInsights />
                <CrmAnalytics />
                <LiveActivity />
              </aside>
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}

function SummaryCard({
  label,
  value,
  change,
  trend,
  icon: Icon,
}: {
  label: string;
  value: string;
  change: string;
  trend: string;
  icon: LucideIcon;
}) {
  const positive = trend === "up";

  return (
    <div className="min-h-36 rounded-3xl border border-white/10 bg-white/5 p-5 shadow-lg shadow-black/10">
      <div className="flex items-center justify-between gap-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/35">
          {label}
        </p>
        <Icon className="h-5 w-5 text-purple-200" />
      </div>
      <p className="mt-5 text-3xl font-semibold tracking-tight">{value}</p>
      <div
        className={`mt-4 inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold ${
          positive
            ? "bg-green-500/15 text-green-200"
            : "bg-red-500/15 text-red-200"
        }`}
      >
        {positive ? (
          <ArrowUpRight className="h-3.5 w-3.5" />
        ) : (
          <ArrowDownRight className="h-3.5 w-3.5" />
        )}
        {change} vs last 30 days
      </div>
    </div>
  );
}

function EngagementOverview() {
  return (
    <section className="rounded-3xl border border-white/10 bg-[#101935]/70 p-6 shadow-2xl shadow-black/20">
      <SectionTitle
        title="Engagement Overview"
        description="Mock trend area for views, shares, contact captures, and QR scans."
      />

      <div className="mt-6 rounded-3xl border border-[#AC00FF]/20 bg-[#070B1A]/70 p-5">
        <div className="flex h-72 items-end gap-3">
          {Array.from({ length: 18 }, (_, index) => {
            const height = 26 + ((index * 17) % 64);
            return (
              <div key={index} className="flex flex-1 flex-col justify-end gap-1">
                <div
                  className="rounded-t-xl bg-gradient-to-t from-[#AC00FF] to-purple-200/80 shadow-lg shadow-purple-500/10"
                  style={{ height: `${height}%` }}
                />
              </div>
            );
          })}
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {engagementSeries.map((item) => (
            <div key={item.label} className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">{item.label}</p>
                <span className={`h-3 w-3 rounded-full ${item.colour}`} />
              </div>
              <div className="mt-3 h-2 rounded-full bg-white/10">
                <div className={`h-2 rounded-full ${item.colour}`} style={{ width: `${item.value}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function TrafficSources() {
  return (
    <section className="rounded-3xl border border-white/10 bg-[#101935]/70 p-6 shadow-2xl shadow-black/20">
      <SectionTitle title="Traffic Sources" description="Percentage split by source." />
      <div className="mt-6 space-y-4">
        {trafficSources.map((source) => {
          const Icon = source.icon;
          return (
            <div key={source.label}>
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 font-semibold">
                  <Icon className="h-4 w-4 text-purple-200" />
                  {source.label}
                </span>
                <span className="text-white/55">{source.value}%</span>
              </div>
              <div className="h-2 rounded-full bg-white/10">
                <div className="h-2 rounded-full bg-[#AC00FF]" style={{ width: `${source.value}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function DeviceBreakdown() {
  return (
    <section className="rounded-3xl border border-white/10 bg-[#101935]/70 p-6 shadow-2xl shadow-black/20">
      <SectionTitle title="Device Breakdown" description="Mock audience device mix." />
      <div className="mt-6 grid gap-3">
        {devices.map((device) => (
          <div key={device.label} className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-center justify-between">
              <p className="font-semibold">{device.label}</p>
              <p className="text-sm text-white/55">{device.value}%</p>
            </div>
            <div className="mt-3 h-2 rounded-full bg-white/10">
              <div className="h-2 rounded-full bg-gradient-to-r from-[#AC00FF] to-[#6C2CFF]" style={{ width: `${device.value}%` }} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function TopCard({ cardName }: { cardName: string }) {
  return (
    <section className="rounded-3xl border border-white/10 bg-[#101935]/70 p-6 shadow-2xl shadow-black/20">
      <SectionTitle title="Top Performing Card" description={cardName} />
      <div className="mt-5 grid gap-3">
        <MetricRow label="Total views" value="8,420" />
        <MetricRow label="Total captures" value="286" />
        <MetricRow label="QR scans" value="2,104" />
        <MetricRow label="Conversion rate" value="21.2%" />
      </div>
    </section>
  );
}

function GeoInsights() {
  return (
    <section className="rounded-3xl border border-white/10 bg-[#101935]/70 p-6 shadow-2xl shadow-black/20">
      <div className="flex items-start justify-between gap-4">
        <SectionTitle title="Geographic Insights" description="Top countries and cities." />
        <span className="rounded-full border border-yellow-300/20 bg-yellow-400/10 px-3 py-1 text-xs font-semibold text-yellow-100">
          Coming soon
        </span>
      </div>
      <div className="mt-5 grid gap-3">
        <MetricRow label="Top country" value="United Kingdom" />
        <MetricRow label="Top city" value="London" />
        <MetricRow label="Next city" value="Manchester" />
      </div>
    </section>
  );
}

function CrmAnalytics() {
  return (
    <section className="rounded-3xl border border-white/10 bg-[#101935]/70 p-6 shadow-2xl shadow-black/20">
      <SectionTitle title="CRM Sync Analytics" description="Mock integration health." />
      <div className="mt-5 grid gap-3">
        <MetricRow label="Total synced leads" value="214" />
        <MetricRow label="Failed syncs" value="7" />
        <MetricRow label="Pending syncs" value="18" />
        <MetricRow label="Most used CRM" value="HubSpot" />
      </div>
    </section>
  );
}

function LiveActivity() {
  return (
    <section className="rounded-3xl border border-white/10 bg-[#101935]/70 p-6 shadow-2xl shadow-black/20">
      <SectionTitle title="Live Activity" description="Recent mock activity." />
      <div className="mt-5 space-y-3">
        {activityFeed.map((item) => (
          <div key={item} className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
            {item}
          </div>
        ))}
      </div>
    </section>
  );
}

function EnterprisePreview() {
  const items = [
    "team analytics",
    "staff comparisons",
    "lead attribution",
    "scheduled executive reports",
    "CRM performance insights",
  ];

  return (
    <section className="rounded-3xl border border-[#AC00FF]/25 bg-[#AC00FF]/10 p-6 shadow-lg shadow-purple-950/15">
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#AC00FF]/20">
          <UsersRound className="h-6 w-6 text-purple-100" />
        </div>
        <div>
          <h2 className="text-xl font-semibold">Enterprise reporting includes:</h2>
          <div className="mt-4 flex flex-wrap gap-2">
            {items.map((item) => (
              <span key={item} className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm text-white/65">
                {item}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 p-4">
      <span className="text-sm text-white/50">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}

function FilterSelect({ label, options }: { label: string; options: string[] }) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-white/45">
        {label}
      </span>
      <select className="h-12 w-full rounded-2xl border border-white/10 bg-[#070B1A]/75 px-4 text-sm font-medium text-white shadow-inner shadow-white/5 outline-none transition hover:border-white/20 hover:bg-[#0B1024] focus:border-[#AC00FF]/70 focus:shadow-lg focus:shadow-purple-500/20">
        {options.map((option) => (
          <option key={option} className="bg-[#070B1A] text-white">
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function ActionButton({
  icon: Icon,
  children,
}: {
  icon: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white/75 transition hover:border-[#AC00FF]/50 hover:bg-[#AC00FF]/15 hover:text-white sm:w-auto"
    >
      <Icon className="h-4 w-4" />
      {children}
    </button>
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

function LockedOverlay() {
  return (
    <div className="absolute inset-0 z-20 flex items-start justify-center rounded-3xl bg-[#070B1A]/55 p-4 pt-8 backdrop-blur-[1px] sm:items-center sm:p-6">
      <div className="w-full max-w-xl rounded-3xl border border-[#AC00FF]/30 bg-[#101935]/95 p-6 text-center shadow-2xl shadow-purple-950/40 sm:p-8">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-3xl bg-[#AC00FF]/20">
          <Lock className="h-7 w-7 text-purple-100" />
        </div>
        <h2 className="mt-5 text-2xl font-semibold sm:text-3xl">Unlock Analytics</h2>
        <p className="mt-3 text-sm leading-6 text-white/60">
          Upgrade to Individual Pro to unlock performance analytics, lead
          attribution, device breakdowns, and reporting exports.
        </p>
      </div>
    </div>
  );
}
