"use client";

import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  ArrowRightLeft,
  Clock3,
  FileSpreadsheet,
  Lock,
  Mail,
  MessageSquare,
  Plug,
  RefreshCw,
  Settings2,
  Sparkles,
  Table2,
  Workflow,
  Zap,
} from "lucide-react";
import ClientSidebar from "@/components/ClientSidebar";

const currentPlan = "pro" as
  | "free"
  | "pro"
  | "individual_pro"
  | "business"
  | "enterprise";
const isPaid = currentPlan !== "free";

type IntegrationStatus = "connected" | "not_connected" | "failed" | "coming_soon";
type SyncStatus = "synced" | "pending" | "failed";

type Integration = {
  name: string;
  description: string;
  status: IntegrationStatus;
  icon: LucideIcon;
};

const integrations: Integration[] = [
  {
    name: "Zapier",
    description: "Send leads to thousands of automation workflows.",
    status: "connected",
    icon: Zap,
  },
  {
    name: "HubSpot",
    description: "Sync captured contacts to your HubSpot CRM.",
    status: "connected",
    icon: Workflow,
  },
  {
    name: "Salesforce",
    description: "Create leads and contacts in Salesforce.",
    status: "failed",
    icon: ArrowRightLeft,
  },
  {
    name: "Zoho CRM",
    description: "Push new card leads into Zoho CRM.",
    status: "not_connected",
    icon: Plug,
  },
  {
    name: "Pipedrive",
    description: "Create people and deals from captured contacts.",
    status: "not_connected",
    icon: Workflow,
  },
  {
    name: "GoHighLevel",
    description: "Sync contacts into campaigns and pipelines.",
    status: "coming_soon",
    icon: Workflow,
  },
  {
    name: "Google Sheets",
    description: "Append each new contact to a spreadsheet.",
    status: "not_connected",
    icon: Table2,
  },
  {
    name: "Microsoft Excel",
    description: "Export and sync contacts to Excel workflows.",
    status: "coming_soon",
    icon: FileSpreadsheet,
  },
  {
    name: "Mailchimp",
    description: "Add captured contacts to email audiences.",
    status: "not_connected",
    icon: Mail,
  },
  {
    name: "Slack",
    description: "Notify your team when new leads arrive.",
    status: "not_connected",
    icon: MessageSquare,
  },
];

const syncActivity = [
  {
    contact: "Aisha Patel",
    destination: "HubSpot",
    status: "synced" as SyncStatus,
    date: "13 May 2026",
    message: "Contact created successfully",
  },
  {
    contact: "Daniel Brooks",
    destination: "Zapier",
    status: "pending" as SyncStatus,
    date: "13 May 2026",
    message: "Queued for next sync",
  },
  {
    contact: "Mia Chen",
    destination: "Salesforce",
    status: "failed" as SyncStatus,
    date: "12 May 2026",
    message: "Missing required field: company",
  },
  {
    contact: "Owen Clarke",
    destination: "HubSpot",
    status: "synced" as SyncStatus,
    date: "11 May 2026",
    message: "Lead updated",
  },
];

export default function ClientIntegrationsPage() {
  const [autoSync, setAutoSync] = useState(true);
  const [syncNotes, setSyncNotes] = useState(true);
  const [syncTags, setSyncTags] = useState(true);
  const [duplicatePrevention, setDuplicatePrevention] = useState(true);
  const [message, setMessage] = useState("");

  function placeholder(action: string) {
    setMessage(`${action} is a placeholder until integrations are connected.`);
  }

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
              <h1 className="text-4xl font-bold">Integrations</h1>
              {isPaid && (
                <span className="rounded-full border border-yellow-300/25 bg-yellow-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-yellow-100">
                  Dev mode: Pro preview
                </span>
              )}
            </div>
            <p className="mt-3 max-w-4xl text-white/50">
              Connect your CRM and automation tools to automatically sync
              captured contacts.
            </p>
          </div>

          <button
            type="button"
            onClick={() => placeholder("Manual sync")}
            className="inline-flex w-fit items-center gap-2 rounded-2xl bg-gradient-to-r from-[#AC00FF] to-[#6C2CFF] px-5 py-3 text-sm font-semibold shadow-lg shadow-purple-500/20 transition hover:shadow-purple-500/35"
          >
            <RefreshCw className="h-4 w-4" />
            Sync Contacts Now
          </button>
        </div>

        {message && (
          <div className="mb-6 rounded-2xl border border-[#AC00FF]/25 bg-[#AC00FF]/10 px-5 py-4 text-sm text-purple-100">
            {message}
          </div>
        )}

        <section className="relative">
          {!isPaid && <LockedOverlay />}

          <div className={!isPaid ? "pointer-events-none blur-[2px]" : ""}>
            <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <SummaryCard label="Connected Apps" value="2" icon={Plug} />
              <SummaryCard label="Syncs This Month" value="1,284" icon={RefreshCw} />
              <SummaryCard label="Failed Syncs" value="7" icon={AlertTriangle} />
              <SummaryCard label="Last Sync" value="13 May, 10:42" icon={Clock3} />
            </div>

            <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_420px]">
              <div className="space-y-6">
                <section className="rounded-3xl border border-white/10 bg-[#101935]/70 p-6 shadow-2xl shadow-black/20">
                  <SectionTitle
                    title="Available Integrations"
                    description="Connect the tools that should receive your captured contacts."
                  />

                  <div className="mt-6 grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
                    {integrations.map((integration) => (
                      <IntegrationCard
                        key={integration.name}
                        integration={integration}
                        onAction={() => placeholder(`${integration.name} connection`)}
                      />
                    ))}
                  </div>
                </section>

                <section className="rounded-3xl border border-white/10 bg-[#101935]/70 p-6 shadow-2xl shadow-black/20">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                    <SectionTitle
                      title="Sync Activity"
                      description="Recent mock contact sync events."
                    />
                    <button
                      type="button"
                      onClick={() => placeholder("Retry failed syncs")}
                      className="inline-flex w-fit items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white/70 transition hover:border-[#AC00FF]/45 hover:bg-[#AC00FF]/10"
                    >
                      <RefreshCw className="h-4 w-4" />
                      Retry Failed
                    </button>
                  </div>

                  <div className="mt-6 overflow-hidden rounded-3xl border border-white/10">
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[860px] text-sm">
                        <thead className="bg-[#070B1A] text-left text-white/45">
                          <tr>
                            <th className="p-4">Contact</th>
                            <th className="p-4">Destination</th>
                            <th className="p-4">Status</th>
                            <th className="p-4">Date</th>
                            <th className="p-4">Error/Message</th>
                            <th className="p-4">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {syncActivity.map((row) => (
                            <tr key={`${row.contact}-${row.destination}`} className="border-t border-white/5">
                              <td className="p-4 font-semibold">{row.contact}</td>
                              <td className="p-4 text-white/65">{row.destination}</td>
                              <td className="p-4">
                                <SyncBadge status={row.status} />
                              </td>
                              <td className="p-4 text-white/65">{row.date}</td>
                              <td className="p-4 text-white/65">{row.message}</td>
                              <td className="p-4">
                                <button
                                  type="button"
                                  onClick={() => placeholder("Sync row action")}
                                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/60 transition hover:border-[#AC00FF]/45 hover:text-white"
                                >
                                  View
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </section>
              </div>

              <aside className="space-y-6 xl:sticky xl:top-8 xl:self-start">
                <section className="rounded-3xl border border-white/10 bg-[#101935]/70 p-6 shadow-2xl shadow-black/20">
                  <SectionTitle
                    title="CRM Sync Settings"
                    description="Configure how contacts should sync once connected."
                  />

                  <div className="mt-6 space-y-3">
                    <ToggleRow label="Auto-sync new contacts" enabled={autoSync} onClick={() => setAutoSync(!autoSync)} />
                    <ToggleRow label="Sync notes" enabled={syncNotes} onClick={() => setSyncNotes(!syncNotes)} />
                    <ToggleRow label="Sync tags" enabled={syncTags} onClick={() => setSyncTags(!syncTags)} />
                    <ToggleRow label="Duplicate prevention" enabled={duplicatePrevention} onClick={() => setDuplicatePrevention(!duplicatePrevention)} />
                  </div>

                  <label className="mt-5 block">
                    <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-white/40">
                      Default pipeline / stage
                    </span>
                    <select className="h-12 w-full rounded-2xl border border-white/10 bg-[#070B1A]/75 px-4 text-sm font-medium text-white outline-none transition focus:border-[#AC00FF]/70 focus:shadow-lg focus:shadow-purple-500/20">
                      <option className="bg-[#070B1A]">New lead</option>
                      <option className="bg-[#070B1A]">Qualified lead</option>
                      <option className="bg-[#070B1A]">Follow-up required</option>
                    </select>
                  </label>
                </section>

                <section className="rounded-3xl border border-[#AC00FF]/25 bg-[#AC00FF]/10 p-6 shadow-lg shadow-purple-950/15">
                  <div className="flex items-start gap-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#AC00FF]/20">
                      <Settings2 className="h-6 w-6 text-purple-100" />
                    </div>
                    <div>
                      <h2 className="text-xl font-semibold">How sync works</h2>
                      <p className="mt-2 text-sm leading-6 text-white/60">
                        Once connected, contacts captured from QR, Wallet, Tap
                        to Share, and public pages will automatically sync to
                        your selected CRM.
                      </p>
                    </div>
                  </div>
                </section>
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
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
}) {
  return (
    <div className="min-h-32 rounded-3xl border border-white/10 bg-white/5 p-5 shadow-lg shadow-black/10">
      <div className="flex items-center justify-between gap-4">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/35">
          {label}
        </p>
        <Icon className="h-5 w-5 text-purple-200" />
      </div>
      <p className="mt-5 break-words text-2xl font-semibold tracking-tight">
        {value}
      </p>
    </div>
  );
}

function IntegrationCard({
  integration,
  onAction,
}: {
  integration: Integration;
  onAction: () => void;
}) {
  const Icon = integration.icon;
  const buttonLabel =
    integration.status === "connected"
      ? "Manage"
      : integration.status === "coming_soon"
      ? "Coming Soon"
      : "Connect";

  return (
    <article className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 transition hover:border-[#AC00FF]/35 hover:bg-white/[0.06]">
      <div className="flex items-start justify-between gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#AC00FF]/20 text-purple-100">
          <Icon className="h-6 w-6" />
        </div>
        <IntegrationStatusBadge status={integration.status} />
      </div>
      <h3 className="mt-5 text-xl font-semibold">{integration.name}</h3>
      <p className="mt-2 min-h-12 text-sm leading-6 text-white/50">
        {integration.description}
      </p>
      <button
        type="button"
        disabled={integration.status === "coming_soon"}
        onClick={onAction}
        className="mt-5 inline-flex w-full items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white/75 transition hover:border-[#AC00FF]/45 hover:bg-[#AC00FF]/10 disabled:cursor-not-allowed disabled:opacity-45"
      >
        {buttonLabel}
      </button>
    </article>
  );
}

function IntegrationStatusBadge({ status }: { status: IntegrationStatus }) {
  const labels: Record<IntegrationStatus, string> = {
    connected: "Connected",
    not_connected: "Not Connected",
    failed: "Failed",
    coming_soon: "Coming Soon",
  };
  const dot: Record<IntegrationStatus, string> = {
    connected: "bg-green-300",
    not_connected: "bg-white/35",
    failed: "bg-red-300",
    coming_soon: "bg-yellow-300",
  };

  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-white/65">
      <span className={`h-2 w-2 rounded-full ${dot[status]}`} />
      {labels[status]}
    </span>
  );
}

function SyncBadge({ status }: { status: SyncStatus }) {
  const labels: Record<SyncStatus, string> = {
    synced: "Synced",
    pending: "Pending",
    failed: "Failed",
  };
  const dot: Record<SyncStatus, string> = {
    synced: "bg-green-300",
    pending: "bg-yellow-300",
    failed: "bg-red-300",
  };

  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-white/65">
      <span className={`h-2 w-2 rounded-full ${dot[status]}`} />
      {labels[status]}
    </span>
  );
}

function ToggleRow({
  label,
  enabled,
  onClick,
}: {
  label: string;
  enabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-left transition hover:border-[#AC00FF]/35 hover:bg-white/10"
    >
      <span className="text-sm font-semibold">{label}</span>
      <span
        className={`rounded-full px-3 py-1 text-xs font-semibold ${
          enabled ? "bg-[#AC00FF]/25 text-purple-100" : "bg-white/10 text-white/50"
        }`}
      >
        {enabled ? "On" : "Off"}
      </span>
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
      <h2 className="text-2xl font-semibold">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-white/45">{description}</p>
    </div>
  );
}

function LockedOverlay() {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center rounded-3xl bg-[#070B1A]/55 p-6 backdrop-blur-[1px]">
      <div className="max-w-xl rounded-3xl border border-[#AC00FF]/30 bg-[#101935]/95 p-8 text-center shadow-2xl shadow-purple-950/40">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-3xl bg-[#AC00FF]/20">
          <Lock className="h-7 w-7 text-purple-100" />
        </div>
        <h2 className="mt-5 text-3xl font-semibold">Unlock Integrations</h2>
        <p className="mt-3 text-sm leading-6 text-white/60">
          Upgrade to Individual Pro to connect CRM and automation tools.
        </p>
        <button
          type="button"
          className="mt-6 inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-[#AC00FF] to-[#6C2CFF] px-6 py-3 text-sm font-semibold shadow-lg shadow-purple-500/20"
        >
          <Sparkles className="h-4 w-4" />
          Upgrade to Individual Pro
        </button>
      </div>
    </div>
  );
}
