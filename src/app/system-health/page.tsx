"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Clock3,
  Copy,
  RefreshCw,
} from "lucide-react";
import AdminShell from "@/components/admin/AdminShell";
import { AdminPageHeader, AdminSurface, AdminButton, AdminStatusBadge, type AdminPresentationTone } from "@/components/admin/AdminUI";
import styles from "./system-health.module.css";
import { healthGroups } from "@/lib/system-health/types";
import type { SystemHealthAnalysisResult } from "@/lib/system-health/analysis-types";
import { analysisLevelDisplay, requestSystemHealthAnalysis, SystemHealthAnalysisClientError } from "@/lib/system-health/analysis-client";
import { prepareSystemHealthInvestigation, type PreparedInvestigation } from "@/lib/system-health/investigation-prompt";
import type {
  HealthSeverity,
  HealthStatus,
  StagingMonitoringResponse,
  StoredMonitorCheck,
} from "@/lib/system-health/types";
import {
  buildDiagnosticReport,
  displayStatus,
  getFixGuidance,
  orderedGroups,
  priorityOrderedChecks,
} from "@/lib/system-health/presentation";

import { ownerCheck, ownerCounts, ownerLabels, ownerOverview, ownerSectionState, ownerState, ownerStates, type OwnerState } from "@/lib/system-health/owner-presentation";

const ownerTones: Record<OwnerState, AdminPresentationTone> = { working: "success", toComplete: "completion", notMonitored: "coverage", attention: "attention", critical: "critical", unknown: "neutral" };
const aiTones: Record<SystemHealthAnalysisResult["overall"]["level"], AdminPresentationTone> = { all_good: "success", monitoring_incomplete: "coverage", needs_attention: "attention", critical: "critical" };

export default function SystemHealthPage() {
  const [health, setHealth] = useState<StagingMonitoringResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const [analysis, setAnalysis] = useState<SystemHealthAnalysisResult | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState("");
  const analysisRequest = useRef<AbortController | null>(null);
  const [investigation, setInvestigation] = useState<PreparedInvestigation | null>(null);
  const [investigationCopied, setInvestigationCopied] = useState(false);
  const [investigationCopyError, setInvestigationCopyError] = useState("");
  const investigationDraft = useRef<PreparedInvestigation | null>(null);

  const loadHealth = useCallback(async (signal?: AbortSignal) => {
    analysisRequest.current?.abort();
    analysisRequest.current = null;
    setAnalysis(null);
    setAnalysisLoading(false);
    setAnalysisError("");
    investigationDraft.current = null;
    setInvestigation(null);
    setInvestigationCopied(false);
    setInvestigationCopyError("");
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
      analysisRequest.current?.abort();
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
  const investigationPreparation = useMemo(() => run ? prepareSystemHealthInvestigation(run) : null, [run]);
  const prepareInvestigation = () => {
    if (!analysis || investigationPreparation?.kind !== "ready") return;
    investigationDraft.current = investigationPreparation.investigation;
    setInvestigation(investigationPreparation.investigation);
    setInvestigationCopied(false);
    setInvestigationCopyError("");
  };
  const copyInvestigation = async () => {
    const draft = investigationDraft.current;
    if (!draft) return;
    try {
      await navigator.clipboard.writeText(draft.prompt);
      if (investigationDraft.current !== draft) return;
      setInvestigationCopied(true);
      setInvestigationCopyError("");
    } catch {
      if (investigationDraft.current !== draft) return;
      setInvestigationCopied(false);
      setInvestigationCopyError("Copy was unavailable. The full prompt remains visible; select and copy it manually.");
    }
  };
  const counts = run ? ownerCounts(run.checks) : null;
  const orderedChecks = run ? priorityOrderedChecks(run.checks) : [];
  const attention = orderedChecks.filter((check) => ["critical", "attention"].includes(ownerState(check)));
  const completion = orderedChecks.filter((check) => ownerState(check) === "toComplete");
  const overview = run ? ownerOverview(run.checks) : null;
  const headline = overview?.headline ?? "No Staging run available";
  const groups = run ? healthGroups.map(({ id, label }) => ({
    id,
    label,
    checks: orderedGroups(run.checks).find((group) => group.label === label)?.checks ?? [],
  })) : [];

  const analyseLatestHealthRun = async () => {
    if (!run || analysisRequest.current) return;
    const controller = new AbortController();
    analysisRequest.current = controller;
    setAnalysis(null);
    setAnalysisError("");
    setAnalysisLoading(true);
    try {
      const result = await requestSystemHealthAnalysis(controller.signal);
      if (!controller.signal.aborted) setAnalysis(result);
    } catch (requestError) {
      if (!controller.signal.aborted) {
        // The client request helper emits only fixed, owner-friendly errors.
        setAnalysisError(requestError instanceof SystemHealthAnalysisClientError
          ? requestError.message
          : "AI analysis is unavailable right now. You can try again later.");
      }
    } finally {
      if (analysisRequest.current === controller) {
        analysisRequest.current = null;
        setAnalysisLoading(false);
      }
    }
  };
  return (
    <AdminShell>
      <div className={styles.ownerView}>
        <div className={styles.pageHeader}>
          <AdminPageHeader title="System Health" subtitle="Current health of DMI Cards Staging. Automated safe checks run on a schedule; Refresh reloads the latest saved run. This view does not report Production health." />
          <div className={styles.headerActions}>
            <AdminStatusBadge label="Staging" tone="neutral" />
            <AdminButton onClick={() => void loadHealth()} disabled={loading}>
              <RefreshCw aria-hidden="true" className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
            </AdminButton>
          </div>
        </div>
        {error ? <AdminSurface role="alert" className={styles.safeError}>{error}</AdminSurface> : null}
        {copyError ? <p role="status" className={styles.safeError}>{copyError}</p> : null}
        {copied ? <p role="status" className={styles.successText}>Safe diagnostic report copied to clipboard.</p> : null}
        <AdminSurface aria-live="polite">
          <div className={styles.overviewHeader}>
            <div className="min-w-0">
              <OwnerBadge state={run ? ownerSectionState(run.checks) : "unknown"} />
              <h2 className="mt-3 text-xl font-semibold">{loading && !health ? "Loading the latest Staging run…" : headline}</h2>
              <p className={styles.explanation}>{overview?.explanation ?? (error ? "Staging monitoring history could not be read safely. Refresh to try again." : "No saved automated Staging check run is available yet.")}</p>
            </div>
            <p className={styles.savedTime}><Clock3 aria-hidden="true" className="h-4 w-4" />{run ? `Last checked ${formatTime(run.generatedAt)}` : "Not checked"}</p>
          </div>
        </AdminSurface>
        {run && counts ? <div className={styles.overview} aria-label="Owner overview">
          <section aria-label="Owner status summary" className={styles.ownerSummary}>
            {ownerStates.filter((state) => state !== "unknown" || counts.unknown > 0).map((state) => (
              <AdminSurface key={state} className={styles.ownerTile} data-owner-state={state} data-tone={ownerTones[state]}>
                <div className={styles.counterLabel}><span aria-hidden="true" className={styles.ownerDot} /><span>{ownerLabels[state]}</span></div>
                <strong className={styles.ownerNumber}>{counts[state]}<span className="sr-only"> checks {ownerLabels[state]}</span></strong>
              </AdminSurface>
            ))}
          </section>
          {attention.length > 0 ? <AdminSurface aria-labelledby="owner-attention">
            <h2 id="owner-attention" className="text-xl font-semibold">Critical / Needs attention</h2>
            <p className={styles.explanation}>Monitoring failures need investigation but do not prove a service outage.</p>
            <OwnerPriorityList checks={attention} />
          </AdminSurface> : null}
          {completion.length > 0 ? <AdminSurface aria-labelledby="owner-completion">
            <h2 id="owner-completion" className="text-xl font-semibold">{counts.toComplete} {counts.toComplete === 1 ? "thing still needs" : "things still need"} completing</h2>
            <OwnerPriorityList checks={completion} />
          </AdminSurface> : null}
          {counts.notMonitored > 0 ? <AdminSurface aria-labelledby="owner-coverage">
            <h2 id="owner-coverage" className="text-xl font-semibold">{counts.notMonitored} {counts.notMonitored === 1 ? "area isn't" : "areas aren't"} monitored yet</h2>
            <p className={styles.explanation}>This does not mean they&apos;re broken. DMI Cards cannot automatically verify them yet.</p>
          </AdminSurface> : null}
          {counts.unknown > 0 ? <p role="status" className={styles.explanation}>{counts.unknown} checks have an unknown status. Review their evidence before drawing conclusions.</p> : null}
        </div> : null}
        <AdminSurface aria-labelledby="ai-health-analysis" aria-busy={analysisLoading}>
          <div className={styles.overviewHeader}>
            <div className="min-w-0">
              <h2 id="ai-health-analysis" className="text-xl font-semibold">AI Health Analysis</h2>
              <p className={styles.explanation}>AI explains the latest verified System Health results in plain English. It cannot change health statuses or make fixes.</p>
              <p className={styles.explanation}>Not yet monitored does not mean the service is broken.</p>
            </div>
            <AdminButton onClick={() => void analyseLatestHealthRun()} disabled={analysisLoading || loading || !run}>
              {analysisLoading ? <RefreshCw aria-hidden="true" className="h-4 w-4 animate-spin" /> : null}
              {analysisLoading ? "Analysing…" : "Analyse latest health run"}
            </AdminButton>
          </div>
          <div aria-live="polite">
            {analysisLoading ? <p role="status" className={styles.explanation}>Analysing the latest saved health run…</p> : null}
            {analysisError ? <p role="alert" className={styles.safeError}>{analysisError}</p> : null}
            {analysis ? <div className="mt-4">
              <AiExplanation summary={analysis.overall} />
              {investigationPreparation?.kind === "ready" ? <AdminButton onClick={prepareInvestigation}>Prepare Codex investigation</AdminButton>
                : investigationPreparation?.kind === "none" ? <p className={styles.explanation}>No checks in this saved run currently require an incident investigation.</p>
                : <p role="alert" className={styles.safeError}>A safe investigation prompt could not be prepared from this saved run. Refresh the health results.</p>}
              {investigation ? <AdminSurface aria-labelledby="codex-investigation-review" className={styles.investigationPanel}>
                <h3 id="codex-investigation-review" className="text-lg font-semibold">Review Codex investigation</h3>
                <p className={styles.explanation}>Based on the displayed saved health run</p>
                <p className={styles.explanation}>Saved run: {investigation.runId} · {formatTime(investigation.savedAt)}</p>
                <p className={styles.explanation}>This historical snapshot is not necessarily the same run the AI analysed. Review the full read-only prompt before copying.</p>
                <ul className="my-4 space-y-2 text-sm">
                  {investigation.checks.map((check) => <li key={`${check.service_key}/${check.check_key}`} className="break-words"><strong>{check.section_label}</strong>: {check.service_key}/{check.check_key} — {check.display_status}</li>)}
                </ul>
                <label htmlFor="codex-investigation-prompt" className="block text-sm font-semibold">Full read-only investigation prompt</label>
                <textarea id="codex-investigation-prompt" readOnly value={investigation.prompt} rows={18} className={styles.investigationPrompt} />
                <AdminButton onClick={() => void copyInvestigation()}>Copy Codex investigation</AdminButton>
                {investigationCopied ? <p role="status" className={styles.successText}>Codex investigation copied. Review it in Codex before proceeding.</p> : null}
                {investigationCopyError ? <p role="alert" className={styles.safeError}>{investigationCopyError}</p> : null}
              </AdminSurface> : null}
            </div> : null}
          </div>
        </AdminSurface>
        {loading && !health ? <p role="status" className={styles.explanation}>Loading saved Staging checks…</p> : run ? <>
          {groups.map((group) => <section key={group.label} aria-labelledby={`group-${slug(group.label)}`}>
            <div className="mb-4 space-y-3">
              <div className={styles.sectionHeading}><h2 id={`group-${slug(group.label)}`} className="text-xl font-semibold">{group.label}</h2><OwnerBadge state={ownerSectionState(group.checks)} section /></div>
              <p className={styles.explanation}>{sectionDescription(group.checks)}</p>
              <p className="text-sm font-semibold">{sectionCounts(group.checks)}</p>
            </div>
            {analysis ? <AiExplanation summary={analysis.sections.find((section) => section.section === group.id)!} /> : null}
            <div className={styles.checkGrid}>{priorityOrderedChecks(group.checks).map((check) => <HealthServiceCard key={`${check.serviceKey}/${check.checkKey}`} check={check} />)}</div>
          </section>)}
          {diagnosticReport ? <details className={styles.technicalDetails}>
            <summary>Technical details</summary>
            <p className={styles.explanation}>Environment: Staging · Run ID: {run.runId} · Saved {formatTime(run.generatedAt)}</p>
            <AdminButton onClick={() => void copyDiagnosticReport()} disabled={!diagnosticReport}>
              {copied ? <Check aria-hidden="true" className="h-4 w-4" /> : <Copy aria-hidden="true" className="h-4 w-4" />}
              {copied ? "Copied diagnostic report" : "Copy diagnostic report"}
            </AdminButton>
            <h3 className="mt-4 font-semibold">Safe diagnostic report JSON</h3>
            <pre className={styles.diagnosticReport}>{diagnosticReport}</pre>
          </details> : null}
        </> : health ? <AdminSurface className={styles.explanation}>No saved automated Staging check run is available yet. The scheduled monitor must complete successfully before per-check history can be shown.</AdminSurface> : null}
      </div>
    </AdminShell>
  );
}

function AiExplanation({ summary }: { summary: SystemHealthAnalysisResult["overall"] }) {
  const display = analysisLevelDisplay[summary.level];
  return <AdminSurface className={styles.aiExplanation}>
    <div className="flex flex-wrap items-center gap-3"><AdminStatusBadge label={display.label} tone={aiTones[summary.level]} indicator /><span className={styles.advisoryLabel}>AI advisory</span></div>
    <h3 className="mt-3 font-semibold break-words">{summary.headline}</h3>
    <p className={styles.explanation}>{summary.plain_english}</p>
  </AdminSurface>;
}
function OwnerBadge({ state, section = false }: { state: OwnerState; section?: boolean }) {
  return <AdminStatusBadge label={section && state === "notMonitored" ? "Not monitored fully yet" : ownerLabels[state]} tone={ownerTones[state]} indicator />;
}
function sectionCounts(checks: readonly StoredMonitorCheck[]) {
  const counts = ownerCounts(checks);
  return ownerStates.filter((state) => counts[state] > 0).map((state) => `${counts[state]} ${ownerLabels[state]}`).join(" · ") || "No saved checks";
}

function sectionDescription(checks: readonly StoredMonitorCheck[]) {
  const counts = ownerCounts(checks);
  const parts = [];
  if (counts.working) parts.push(`${counts.working} saved ${counts.working === 1 ? "check passed" : "checks passed"}.`);
  if (counts.critical) parts.push(`${counts.critical} ${counts.critical === 1 ? "check verified a service failure" : "checks verified service failures"}.`);
  if (counts.attention) parts.push(`${counts.attention} ${counts.attention === 1 ? "check needs" : "checks need"} investigation; this does not establish a complete outage.`);
  if (counts.toComplete) parts.push(`${counts.toComplete} ${counts.toComplete === 1 ? "item needs" : "items need"} Staging setup completed.`);
  if (counts.notMonitored) parts.push(`${counts.notMonitored} ${counts.notMonitored === 1 ? "check is" : "checks are"} not monitored yet. This does not mean the services are broken.`);
  if (counts.unknown) parts.push(`${counts.unknown} ${counts.unknown === 1 ? "result is" : "results are"} unknown.`);
  return parts.join(" ") || "No saved checks are available for this section.";
}

function OwnerPriorityList({ checks }: { checks: readonly StoredMonitorCheck[] }) {
  return <ul className="mt-4 space-y-4">{checks.map((check) => {
    const owner = ownerCheck(check);
    return <li key={`${check.serviceKey}/${check.checkKey}`} className="space-y-2">
      <div className="flex flex-wrap items-center gap-3"><strong>{owner.title}</strong><OwnerBadge state={owner.state} /></div>
      <p className="text-sm leading-6 text-[var(--admin-text-secondary)]">{owner.explanation}</p>
      <p className="text-sm text-[var(--admin-text-secondary)]"><strong>Next step:</strong> {owner.nextStep}</p>
    </li>;
  })}</ul>;
}

function HealthServiceCard({ check }: { check: StoredMonitorCheck }) {
  const status = displayStatus(check.storedStatus, check.reasonCode);
  const guidance = getFixGuidance(check);
  const owner = ownerCheck(check);
  return (
    <AdminSurface role="article">
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:justify-between">
        <h3 className="min-w-0 text-lg font-semibold">{owner.title}</h3>
        <OwnerBadge state={owner.state} />
      </div>
      <p className="mt-3 text-sm leading-6 text-[var(--admin-text-secondary)]">{owner.explanation}</p>
      <p className="mt-3 text-sm leading-6 text-[var(--admin-text-secondary)]"><strong>Problem confirmed?</strong> {owner.problem}</p>
      <p className="mt-2 text-sm leading-6 text-[var(--admin-text-secondary)]"><strong>Next step:</strong> {owner.nextStep}</p>
      <details className={styles.technicalDetails}>
        <summary>
          Technical details
        </summary>
        <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
          <Detail label="Service key" value={check.serviceKey} />
          <Detail label="Check key" value={check.checkKey} />
          <Detail label="Stored status" value={check.storedStatus} />
          <Detail label="Technical display status" value={status} />
          <Detail label="Checked" value={formatTime(check.checkedAt)} />
          <Detail label="Verified" value={check.verifiedAt ? formatTime(check.verifiedAt) : "Not verified"} />
          <Detail label="Severity" value={check.severity} />
          <Detail label="Safe summary" value={check.safeSummary} />
          <Detail label="Reason code" value={check.reasonCode ?? "Not provided"} />
          <Detail label="Where to fix" value={guidance.whereToFix} />
          <Detail label="Recommended next step" value={guidance.recommendedNextStep} />
          {Object.entries(check.evidence).map(([key, value]) => (
            <Detail key={key} label={humanize(key)} value={value} />
          ))}
        </dl>
      </details>
    </AdminSurface>
  );
}

function Detail({ label, value }: { label: string; value: string | number | boolean | null }) {
  if (value === null || value === "") return null;
  return (
    <div className="min-w-0 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-secondary)] px-3 py-2">
      <dt className="font-semibold uppercase tracking-[0.12em] text-[var(--admin-text-secondary)]">{label}</dt>
      <dd className="mt-1 text-[var(--admin-text-secondary)] [overflow-wrap:anywhere]">{String(value)}</dd>
    </div>
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
