"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  HelpCircle,
  RefreshCw,
  XCircle,
} from "lucide-react";
import Sidebar from "@/components/Sidebar";
import type {
  HealthCheck,
  HealthResponse,
  HealthStatus,
  OverallHealthStatus,
} from "@/lib/system-health/types";

export default function SystemHealthPage() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const loadHealth = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/system-health", {
        cache: "no-store",
        signal,
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !isHealthResponse(payload)) {
        throw new Error(response.status === 401 || response.status === 403
          ? "System Health is unavailable for this admin session."
          : "System Health returned an unreadable response.");
      }
      setHealth(payload);
    } catch (loadError) {
      if (signal?.aborted) return;
      setError(loadError instanceof Error
        ? loadError.message
        : "System Health could not be loaded. Please try again.");
      setHealth(null);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void loadHealth(controller.signal);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [loadHealth]);

  return (
    <main className="flex min-h-screen bg-[#070B1A] text-white">
      <Sidebar />
      <section className="min-w-0 flex-1 p-6 lg:p-10">
        <header className="mb-8 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-[#D946EF]">
              Operations
            </p>
            <h1 className="mt-3 text-3xl font-bold lg:text-4xl">System Health</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/60">
              A current view of checks we can safely verify. This page is not continuous monitoring.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadHealth()}
            disabled={loading}
            className="inline-flex w-fit items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/10 px-4 py-3 text-sm font-semibold text-white transition hover:border-[#D946EF]/50 hover:bg-white/[0.14] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </header>

        {error ? (
          <section role="alert" className="mb-6 rounded-3xl border border-amber-400/25 bg-amber-400/10 p-6 text-sm text-amber-100">
            {error}
          </section>
        ) : null}

        <section
          aria-live="polite"
          className="mb-8 rounded-3xl border border-white/10 bg-white/[0.06] p-6"
        >
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-4">
              <OverallStatusIcon status={health?.overall.status} />
              <div>
                <h2 className="text-xl font-semibold">
                  {loading && !health ? "Checking available evidence…" : health?.overall.title || "System health unavailable"}
                </h2>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-white/65">
                  {health?.overall.explanation || (error
                    ? "The checks could not be loaded. Refresh to try again."
                    : "No health result is available yet.")}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-4 py-2 text-sm text-white/65">
              <Clock3 className="h-4 w-4" />
              <span>{health ? `Checked ${formatTime(health.checkedAt)}` : "Not checked"}</span>
            </div>
          </div>
          {health ? (
            <p className="mt-4 text-xs text-white/40">
              {health.overall.attentionCount} verified issue{health.overall.attentionCount === 1 ? "" : "s"} require attention
              {" · "}{health.overall.incidentCount} incident{health.overall.incidentCount === 1 ? "" : "s"}
            </p>
          ) : null}
        </section>

        {loading && !health ? (
          <p role="status" className="py-8 text-sm text-white/60">Checking systems…</p>
        ) : health ? (
          <div className="space-y-8">
            {health.groups.map((group) => (
              <section key={group.id} aria-labelledby={`group-${group.id}`}>
                <div className="mb-4 flex items-end justify-between gap-4">
                  <h2 id={`group-${group.id}`} className="text-xl font-semibold">{group.label}</h2>
                  <span className="text-xs text-white/40">{group.checks.length} checks</span>
                </div>
                {group.checks.length ? (
                  <div className="grid gap-4 xl:grid-cols-2">
                    {group.checks.map((check) => <HealthServiceCard key={check.service} check={check} />)}
                  </div>
                ) : (
                  <p className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 text-sm text-white/55">
                    No checks are currently available for this group.
                  </p>
                )}
              </section>
            ))}
          </div>
        ) : null}
      </section>
    </main>
  );
}

function HealthServiceCard({ check }: { check: HealthCheck }) {
  return (
    <article className="rounded-2xl border border-white/10 bg-white/[0.045] p-5 shadow-[0_18px_60px_rgba(0,0,0,0.18)]">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold">{serviceTitle(check.service)}</h3>
          <p className="mt-1 text-sm leading-6 text-white/75">{check.message}</p>
        </div>
        <StatusBadge status={check.status} />
      </div>
      <p className="mt-4 text-sm leading-6 text-white/50">{check.evidenceSummary}</p>
      <p className="mt-3 text-xs text-white/40">
        {check.verifiedAt
          ? `Last verified ${formatTime(check.verifiedAt)}`
          : check.observedAt
            ? `Checked ${formatTime(check.observedAt)}; health not verified`
            : "No verification has been performed"}
      </p>
      <details className="mt-4 rounded-xl border border-white/10 bg-black/20 px-4 py-3">
        <summary className="cursor-pointer text-sm font-semibold text-white/75">
          {check.status === "incident" || check.status === "degraded" ? "Investigate" : "Details"}
        </summary>
        <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
          <Detail label="Service key" value={check.service} />
          <Detail label="Severity" value={check.severity} />
          {Object.entries(check.details).map(([key, value]) => (
            <Detail key={key} label={humanize(key)} value={value} />
          ))}
        </dl>
      </details>
    </article>
  );
}

function Detail({ label, value }: { label: string; value: string | number | boolean | null }) {
  if (value === null || value === "") return null;
  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.035] px-3 py-2">
      <dt className="font-semibold uppercase tracking-[0.12em] text-white/35">{label}</dt>
      <dd className="mt-1 break-words text-white/70">{String(value)}</dd>
    </div>
  );
}

function StatusBadge({ status }: { status: HealthStatus }) {
  const style: Record<HealthStatus, string> = {
    operational: "border-emerald-400/25 bg-emerald-400/10 text-emerald-200",
    degraded: "border-amber-400/25 bg-amber-400/10 text-amber-200",
    incident: "border-rose-400/25 bg-rose-400/10 text-rose-200",
    not_configured: "border-slate-300/20 bg-slate-300/10 text-slate-200",
    not_migrated: "border-violet-300/20 bg-violet-300/10 text-violet-200",
    unknown: "border-slate-300/20 bg-slate-300/10 text-slate-200",
  };
  return (
    <span className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${style[status]}`}>
      <StatusIcon status={status} />
      {statusLabel(status)}
    </span>
  );
}

function StatusIcon({ status }: { status: HealthStatus }) {
  const Icon = status === "operational"
    ? CheckCircle2
    : status === "incident"
      ? XCircle
      : status === "degraded"
        ? AlertTriangle
        : HelpCircle;
  return <Icon aria-hidden="true" className="h-3.5 w-3.5" />;
}

function OverallStatusIcon({ status }: { status?: OverallHealthStatus }) {
  const Icon = status === "operational"
    ? CheckCircle2
    : status === "attention_required"
      ? AlertTriangle
      : Activity;
  const style = status === "operational"
    ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-200"
    : status === "attention_required"
      ? "border-amber-400/25 bg-amber-400/10 text-amber-200"
      : "border-slate-300/20 bg-slate-300/10 text-slate-200";
  return (
    <span className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border ${style}`}>
      <Icon aria-hidden="true" className="h-5 w-5" />
    </span>
  );
}

function statusLabel(status: HealthStatus) {
  const labels: Record<HealthStatus, string> = {
    operational: "Operational",
    degraded: "Degraded",
    incident: "Incident",
    not_configured: "Not configured",
    not_migrated: "Not migrated",
    unknown: "Unknown",
  };
  return labels[status];
}

function serviceTitle(service: string) {
  const titles: Record<string, string> = {
    web_application: "Web application / health endpoint",
    database_read: "Database",
    admin_authentication: "Admin authentication",
    customer_authentication: "Customer authentication",
    supabase_auth_configuration: "Supabase Auth configuration",
    public_card_read_model: "Public Cards read model",
    public_card_delivery: "Public Cards delivery",
    stripe_configuration: "Stripe configuration",
    stripe_webhook_processing: "Stripe webhook processing",
    subscription_synchronization: "Subscription / billing synchronization",
    entitlement_processing: "Entitlement processing",
    card_publishing: "Card publishing",
    contacts_read_model: "Contacts read model",
    public_lead_capture: "Contacts / public lead capture",
    media_storage: "Media / storage",
    apple_wallet: "Apple Wallet",
    google_wallet: "Google Wallet",
    upstash_rate_limiting: "Upstash / rate limiting",
    email_infrastructure: "Email infrastructure",
    email_automations: "Email Automations",
    external_integrations: "External integrations",
  };
  return titles[service] || humanize(service);
}

function humanize(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "time unavailable";
  return date.toLocaleString();
}

function isHealthResponse(value: unknown): value is HealthResponse {
  if (!value || typeof value !== "object") return false;
  const response = value as Partial<HealthResponse>;
  return response.service === "dmi-cards" &&
    typeof response.requestId === "string" &&
    typeof response.checkedAt === "string" &&
    !!response.overall &&
    Array.isArray(response.groups) &&
    response.groups.every((group) =>
      !!group && typeof group.id === "string" && typeof group.label === "string" &&
      Array.isArray(group.checks) && group.checks.every((check) =>
        !!check && typeof check.service === "string" &&
        ["operational", "degraded", "incident", "not_configured", "not_migrated", "unknown"].includes(check.status)
      )
    );
}
