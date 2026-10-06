"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock3,
  Copy,
  HelpCircle,
  RefreshCw,
  XCircle,
} from "lucide-react";
import Sidebar from "@/components/Sidebar";
import styles from "./system-health.module.css";
import type {
  HealthSeverity,
  HealthStatus,
  StagingMonitoringResponse,
  StoredMonitorCheck,
} from "@/lib/system-health/types";
import {
  buildDiagnosticReport,
  displayCounts,
  displayStatus,
  getFixGuidance,
  isActionable,
  overallHeadline,
  orderedGroups,
  priorityOrderedChecks,
  serviceTitle,
  type DisplayStatus,
} from "@/lib/system-health/presentation";

export default function SystemHealthPage() {
  const [health, setHealth] = useState<StagingMonitoringResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");

  const loadHealth = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    setCopied(false);
    setCopyError("");
    try {
      const response = await fetch("/api/admin/system-health", {
        cache: "no-store",
        signal,
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !isMonitoringResponse(payload)) {
        throw new Error(response.status === 401 || response.status === 403
          ? "System Health is unavailable for this admin session."
          : "Staging System Health history could not be loaded safely.");
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

  const diagnosticReport = useMemo(() => {
    if (!health?.monitoringRun) return null;
    return JSON.stringify(buildDiagnosticReport(health.monitoringRun), null, 2);
  }, [health]);

  const copyDiagnosticReport = async () => {
    if (!diagnosticReport) return;
    try {
      await navigator.clipboard.writeText(diagnosticReport);
      setCopied(true);
      setCopyError("");
    } catch {
      setCopied(false);
      setCopyError("Copy was unavailable. Open the report below and copy its safe JSON manually.");
    }
  };

  const run = health?.monitoringRun ?? null;
  const counts = run ? displayCounts(run.checks) : null;
  const actionable = run
    ? priorityOrderedChecks(run.checks).filter((check) =>
        isActionable(displayStatus(check.storedStatus, check.reasonCode))
      )
    : [];
  const headline = run ? overallHeadline(run.checks) : "No Staging run available";

  return (
    <main className="flex min-h-screen bg-[#070B1A] text-white">
      <Sidebar />
      <section className="min-w-0 flex-1 p-5 sm:p-8 lg:p-10">
        <header className="mb-8 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-[#D946EF]">
              Operations · Staging
            </p>
            <h1 className="mt-3 text-3xl font-bold lg:text-4xl">System Health</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-white/60">
              Current health of DMI Cards Staging. Automated safe checks run on a schedule; Refresh reloads the latest saved run. This view does not report Production health.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void copyDiagnosticReport()}
              disabled={!diagnosticReport}
              className="inline-flex w-fit items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/10 px-4 py-3 text-sm font-semibold text-white transition hover:border-[#D946EF]/50 hover:bg-white/[0.14] disabled:cursor-not-allowed disabled:opacity-45"
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? "Copied diagnostic report" : "Copy diagnostic report"}
            </button>
            <button
              type="button"
              onClick={() => void loadHealth()}
              disabled={loading}
              className="inline-flex w-fit items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/10 px-4 py-3 text-sm font-semibold text-white transition hover:border-[#D946EF]/50 hover:bg-white/[0.14] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
        </header>

        {error ? (
          <section role="alert" className="mb-6 rounded-3xl border border-amber-400/25 bg-amber-400/10 p-6 text-sm text-amber-100">
            {error}
          </section>
        ) : null}

        {copyError ? (
          <p role="status" className="mb-4 text-sm text-amber-100">{copyError}</p>
        ) : null}
        {copied ? (
          <p role="status" className="mb-4 text-sm text-emerald-200">Safe diagnostic report copied to clipboard.</p>
        ) : null}

        <section
          aria-live="polite"
          className="mb-8 rounded-3xl border border-white/10 bg-white/[0.06] p-6"
        >
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-4">
              <OverallStatusIcon checks={run?.checks} />
              <div>
                <h2 className="text-xl font-semibold">
                  {loading && !health ? "Loading the latest Staging run…" : headline}
                </h2>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-white/65">
                  {run
                    ? headline === "Attention required"
                      ? "One or more checks reported a verified issue or could not complete. Setup and Staging parity gaps are shown separately."
                      : "There are no recorded verified incidents or failed/timed-out checks in this run. Setup, Staging parity, and monitoring-coverage gaps remain visible below."
                    : error
                      ? "Staging monitoring history could not be read safely. Refresh to try again."
                      : "No saved automated Staging check run is available yet."}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-4 py-2 text-sm text-white/65">
              <Clock3 className="h-4 w-4" />
              <span>{run ? `Last checked ${formatTime(run.generatedAt)}` : "Not checked"}</span>
            </div>
          </div>
          {run ? (
            <p className="mt-4 text-xs text-white/40">
              Environment: Staging · Run ID: {run.runId}
            </p>
          ) : null}
        </section>

        {loading && !health ? (
          <p role="status" className="py-8 text-sm text-white/60">Loading saved Staging checks…</p>
        ) : run && counts ? (
          <div className="space-y-8">
            <section aria-label="Status summary" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
              <SummaryTile label="Operational" count={counts.Operational} tone="green" />
              <SummaryTile
                label="Needs attention"
                count={counts.Incident + counts.Degraded + counts["Needs investigation"]}
                tone="amber"
              />
              <SummaryTile label="Setup required" count={counts["Setup required"]} tone="slate" />
              <SummaryTile label="Staging gaps" count={counts["Staging gap"]} tone="violet" />
              <SummaryTile label="Not yet monitored" count={counts["Not yet monitored"]} tone="slate" />
              <SummaryTile label="Unknown" count={counts.Unknown} tone="slate" />
            </section>

            {actionable.length > 0 ? (
              <section aria-labelledby="needs-attention" className="rounded-3xl border border-amber-300/20 bg-amber-300/[0.045] p-5 sm:p-6">
                <div className="mb-4 flex items-center gap-3">
                  <AlertTriangle className="h-5 w-5 text-amber-200" />
                  <div>
                    <h2 id="needs-attention" className="text-xl font-semibold">Needs attention</h2>
                    <p className="mt-1 text-sm text-white/50">Actionable items are ordered by severity. “Not yet monitored” is not treated as a fault.</p>
                  </div>
                </div>
                <div className="space-y-3">
                  {actionable.map((check) => (
                    <AttentionItem key={`${check.serviceKey}/${check.checkKey}`} check={check} />
                  ))}
                </div>
              </section>
            ) : null}

            {orderedGroups(run.checks).map((group) => (
              <section key={group.label} aria-labelledby={`group-${slug(group.label)}`}>
                <div className="mb-4 flex items-end justify-between gap-4">
                  <h2 id={`group-${slug(group.label)}`} className="text-xl font-semibold">{group.label}</h2>
                  <span className="text-xs text-white/40">{group.checks.length} checks</span>
                </div>
                <div className="grid gap-4 xl:grid-cols-2">
                  {group.checks.map((check) => (
                    <HealthServiceCard key={`${check.serviceKey}/${check.checkKey}`} check={check} />
                  ))}
                </div>
              </section>
            ))}

            {counts["Not yet monitored"] > 0 ? (
              <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
                <h2 className="font-semibold">About “Not yet monitored”</h2>
                <p className="mt-2 text-sm leading-6 text-white/55">
                  These checks do not have a safe bounded probe, or the relevant flow was intentionally not exercised. This status is not evidence that the underlying service is broken and is not counted as an active fault.
                </p>
              </section>
            ) : null}

            {diagnosticReport ? (
              <details className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <summary className="cursor-pointer text-sm font-semibold text-white/65">View safe diagnostic report JSON</summary>
                <pre className="mt-4 max-h-[32rem] overflow-auto whitespace-pre-wrap break-words rounded-xl bg-black/30 p-4 text-xs leading-5 text-white/70">{diagnosticReport}</pre>
              </details>
            ) : null}
          </div>
        ) : health ? (
          <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 text-sm text-white/60">
            No saved automated Staging check run is available yet. The scheduled monitor must complete successfully before per-check history can be shown.
          </section>
        ) : null}
      </section>
    </main>
  );
}

function SummaryTile({
  label,
  count,
  tone,
}: {
  label: string;
  count: number;
  tone: "green" | "amber" | "slate" | "violet";
}) {
  const toneClass = {
    green: "border-emerald-300/15 bg-emerald-300/[0.06]",
    amber: "border-amber-300/15 bg-amber-300/[0.06]",
    slate: "border-white/10 bg-white/[0.035]",
    violet: "border-violet-300/15 bg-violet-300/[0.06]",
  }[tone];
  return (
    <div className={`rounded-2xl border p-4 ${toneClass}`}>
      <p className="text-xs font-semibold text-white/50">{label}</p>
      <p className="mt-2 text-2xl font-bold">{count}</p>
    </div>
  );
}

function AttentionItem({ check }: { check: StoredMonitorCheck }) {
  const status = displayStatus(check.storedStatus, check.reasonCode);
  const guidance = getFixGuidance(check);
  return (
    <article className="rounded-2xl border border-white/10 bg-black/20 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-semibold">{serviceTitle(check.serviceKey)}</h3>
        <StatusBadge status={status} />
      </div>
      <p className="mt-2 text-sm leading-6 text-white/75">{check.safeSummary}</p>
      <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
        <Detail label="Reason code" value={check.reasonCode ?? "Not provided"} />
        <Detail label="Checked" value={formatTime(check.checkedAt)} />
        <Detail label="Where to fix" value={guidance.whereToFix} />
        <Detail label="Recommended next step" value={guidance.recommendedNextStep} />
      </dl>
    </article>
  );
}

function HealthServiceCard({ check }: { check: StoredMonitorCheck }) {
  const status = displayStatus(check.storedStatus, check.reasonCode);
  const guidance = getFixGuidance(check);
  return (
    <article className={`rounded-2xl border p-5 ${
      status === "Operational"
        ? "border-white/10 bg-white/[0.035]"
        : "border-white/10 bg-white/[0.045] shadow-[0_18px_60px_rgba(0,0,0,0.18)]"
    }`}>
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold">{serviceTitle(check.serviceKey)}</h3>
          <p className="mt-1 truncate text-sm leading-6 text-white/75">{check.safeSummary}</p>
        </div>
        <StatusBadge status={status} />
      </div>
      <p className="mt-3 text-xs text-white/40">
        {check.verifiedAt
          ? `Last verified ${formatTime(check.verifiedAt)}`
          : `Checked ${formatTime(check.checkedAt)}; health not verified`}
      </p>
      <details className="mt-4 rounded-xl border border-white/10 bg-black/20 px-4 py-3">
        <summary className="cursor-pointer text-sm font-semibold text-white/75">
          {status === "Incident" || status === "Degraded" || status === "Needs investigation" ? "Investigate" : "Details"}
        </summary>
        <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
          <Detail label="Service key" value={check.serviceKey} />
          <Detail label="Check key" value={check.checkKey} />
          <Detail label="Stored status" value={check.storedStatus} />
          <Detail label="Display status" value={status} />
          <Detail label="Severity" value={check.severity} />
          <Detail label="Safe summary" value={check.safeSummary} />
          {status !== "Operational" ? <Detail label="Reason code" value={check.reasonCode ?? "Not provided"} /> : null}
          <Detail label="Where to fix" value={guidance.whereToFix} />
          <Detail label="Recommended next step" value={guidance.recommendedNextStep} />
          {Object.entries(check.evidence).map(([key, value]) => (
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
    <div className="min-w-0 rounded-lg border border-white/5 bg-white/[0.035] px-3 py-2">
      <dt className="font-semibold uppercase tracking-[0.12em] text-white/35">{label}</dt>
      <dd className="mt-1 text-white/70 [overflow-wrap:anywhere]">{String(value)}</dd>
    </div>
  );
}

function StatusBadge({ status }: { status: DisplayStatus }) {
  return (
    <span className={`${styles.statusBadge} ${styles[statusClassName(status)]}`}>
      <StatusIcon status={status} />
      {status}
    </span>
  );
}

function StatusIcon({ status }: { status: DisplayStatus }) {
  const Icon = status === "Operational"
    ? CheckCircle2
    : status === "Incident"
      ? XCircle
      : status === "Degraded" || status === "Needs investigation"
        ? AlertTriangle
        : HelpCircle;
  return <Icon aria-hidden="true" className="h-3.5 w-3.5" />;
}

function OverallStatusIcon({ checks }: { checks?: readonly StoredMonitorCheck[] }) {
  const headline = checks ? overallHeadline(checks) : "No Staging run available";
  const Icon = headline === "No verified incidents"
    ? CheckCircle2
    : headline === "Attention required"
      ? AlertTriangle
      : Activity;
  const style = headline === "No verified incidents"
    ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-200"
    : headline === "Attention required"
      ? "border-amber-400/25 bg-amber-400/10 text-amber-200"
      : "border-slate-300/20 bg-slate-300/10 text-slate-200";
  return (
    <span className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border ${style}`}>
      <Icon aria-hidden="true" className="h-5 w-5" />
    </span>
  );
}

function humanize(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "time unavailable";
  return date.toLocaleString();
}

function isMonitoringResponse(value: unknown): value is StagingMonitoringResponse {
  if (!value || typeof value !== "object") return false;
  const response = value as Partial<StagingMonitoringResponse>;
  if (
    response.service !== "dmi-cards" ||
    typeof response.requestId !== "string" ||
    response.environment !== "staging"
  ) return false;
  if (response.monitoringRun === null) return true;
  const run = response.monitoringRun;
  return !!run &&
    run.environment === "staging" &&
    typeof run.generatedAt === "string" &&
    typeof run.runId === "string" &&
    Array.isArray(run.checks) &&
    run.checks.every((check) =>
      !!check &&
      typeof check.serviceKey === "string" &&
      typeof check.checkKey === "string" &&
      isHealthStatus(check.storedStatus) &&
      isHealthSeverity(check.severity) &&
      (check.reasonCode === null || typeof check.reasonCode === "string") &&
      typeof check.safeSummary === "string" &&
      isSafeEvidence(check.evidence) &&
      typeof check.checkedAt === "string" &&
      (check.verifiedAt === null || typeof check.verifiedAt === "string")
    );
}

function isHealthStatus(value: unknown): value is HealthStatus {
  return typeof value === "string" &&
    ["operational", "degraded", "incident", "unknown", "not_configured", "not_migrated"].includes(value);
}

function isHealthSeverity(value: unknown): value is HealthSeverity {
  return typeof value === "string" && ["critical", "warning", "info", "none"].includes(value);
}

function isSafeEvidence(value: unknown): value is Record<string, number | boolean> {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    Object.entries(value).every(([, item]) =>
      typeof item === "boolean" || (typeof item === "number" && Number.isFinite(item))
    );
}

function slug(value: string) {
  return value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-");
}

function statusClassName(status: DisplayStatus) {
  const classes: Record<DisplayStatus, string> = {
    Operational: "operational",
    Degraded: "degraded",
    Incident: "incident",
    "Needs investigation": "needsInvestigation",
    "Setup required": "setupRequired",
    "Staging gap": "stagingGap",
    "Not yet monitored": "notYetMonitored",
    Unknown: "unknown",
  };
  return classes[status];
}
