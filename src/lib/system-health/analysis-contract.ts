import { healthGroups } from "./types";
import type { DiagnosticReport } from "./presentation";
import { displayStatus, sectionForService } from "./presentation";
import { sanitizeEvidence } from "./monitoring-core";
import type { HealthGroupId, HealthSeverity, HealthStatus } from "./types";
import {
  safeEvidenceKeys,
  type AnalysisCategory,
  type AnalysisCounts,
  type AnalysisInputCheck,
  type AnalysisSectionLevel,
  type DiagnosticReportInput,
  type ProviderAnalysisResponse,
  type ProviderSectionNarrative,
  type SystemHealthAnalysisInput,
  type SystemHealthAnalysisResult,
} from "./analysis-types";

export const MAX_ANALYSIS_CHECKS = 16;
export const MAX_ANALYSIS_SUMMARY_LENGTH = 240;
export const MAX_ANALYSIS_REASON_CODE_LENGTH = 96;
export const MAX_ANALYSIS_KEY_LENGTH = 64;
export const MAX_OUTPUT_SUMMARY_LENGTH = 500;
export const MAX_ISSUE_TITLE_LENGTH = 120;
export const MAX_EVIDENCE_KEYS = safeEvidenceKeys.length;
export const MAX_LIMITATIONS = 8;
export const MAX_LIMITATION_LENGTH = 240;
export const MAX_ANALYSIS_INPUT_BYTES = 16_384;
export const MAX_PROVIDER_OUTPUT_BYTES = 16_384;

const healthStatuses = [
  "operational",
  "degraded",
  "incident",
  "unknown",
  "not_configured",
  "not_migrated",
] as const satisfies readonly HealthStatus[];
const healthSeverities = ["critical", "warning", "info", "none"] as const satisfies readonly HealthSeverity[];
const displayStatuses = [
  "Operational",
  "Degraded",
  "Incident",
  "Needs investigation",
  "Setup required",
  "Staging gap",
  "Not yet monitored",
  "Unknown",
] as const;
const sectionIds = healthGroups.map(({ id }) => id);
const providerOverallProperties = ["headline", "plain_english"] as const;
const providerSectionProperties = ["section", "headline", "plain_english", "codex_recommended"] as const;
const providerProperties = ["overall", "sections", "limitations"] as const;
type DiagnosticCheck = DiagnosticReport["checks"][number];

export function categoryForHealth(
  status: HealthStatus,
  reasonCode: string | null
): AnalysisCategory {
  if (status === "operational") return "healthy";
  if (status === "incident") return "verified_incident";
  if (status === "degraded") return "degraded";
  if (status === "not_configured") return "setup_required";
  if (status === "not_migrated") return "staging_gap";
  if (reasonCode === "check_failed" || reasonCode === "check_timed_out") {
    return "monitoring_failure";
  }
  if (reasonCode === "no_safe_operational_probe" || reasonCode === "admin_auth_not_exercised") {
    return "coverage_gap";
  }
  return "unknown";
}

export function sectionLevelForChecks(
  checks: readonly Pick<AnalysisInputCheck, "stored_status" | "reason_code">[]
): AnalysisSectionLevel {
  if (checks.some((check) => categoryForHealth(check.stored_status, check.reason_code) === "verified_incident")) {
    return "critical";
  }
  if (checks.some((check) => {
    const category = categoryForHealth(check.stored_status, check.reason_code);
    return category === "degraded" || category === "monitoring_failure";
  })) {
    return "needs_attention";
  }
  if (checks.length === 0 || checks.some((check) =>
    categoryForHealth(check.stored_status, check.reason_code) !== "healthy"
  )) {
    return "monitoring_incomplete";
  }
  return "all_good";
}

export function overallLevelForSections(
  levels: readonly AnalysisSectionLevel[]
): AnalysisSectionLevel {
  if (levels.includes("critical")) return "critical";
  if (levels.includes("needs_attention")) return "needs_attention";
  if (levels.includes("monitoring_incomplete")) return "monitoring_incomplete";
  return "all_good";
}

export function buildAnalysisInput(report: DiagnosticReportInput): SystemHealthAnalysisInput {
  if (
    !isRecord(report) ||
    report.environment !== "staging" ||
    !Array.isArray(report.checks) ||
    report.checks.length > MAX_ANALYSIS_CHECKS
  ) {
    throw new TypeError("Diagnostic report is not valid for System Health analysis.");
  }

  const seen = new Set<string>();
  const checks = report.checks.map((check) => {
    const projected = projectCheck(check);
    const reference = `${projected.service_key}/${projected.check_key}`;
    if (seen.has(reference)) {
      throw new TypeError("Diagnostic report contains duplicate check references.");
    }
    seen.add(reference);
    return projected;
  });
  const counts = emptyCounts();
  for (const check of checks) countsForCheck(counts, check);

  const headline = checks.some((check) => {
    const category = categoryForHealth(check.stored_status, check.reason_code);
    return category === "verified_incident" || category === "degraded" || category === "monitoring_failure";
  })
    ? "Attention required"
    : "No verified incidents";

  return {
    environment: "staging",
    overall_assessment_source: {
      headline,
      counts,
    },
    checks,
  };
}

export function validateProviderResponse(
  value: unknown,
  input: SystemHealthAnalysisInput
): value is ProviderAnalysisResponse {
  if (!hasExactProperties(value, providerProperties)) return false;
  const response = value as Record<string, unknown>;
  if (
    !hasExactProperties(response.overall, providerOverallProperties) ||
    !boundedText(response.overall.headline, MAX_ISSUE_TITLE_LENGTH) ||
    !boundedText(response.overall.plain_english, MAX_OUTPUT_SUMMARY_LENGTH) ||
    !Array.isArray(response.sections) ||
    response.sections.length !== healthGroups.length ||
    !Array.isArray(response.limitations) ||
    response.limitations.length > MAX_LIMITATIONS ||
    !response.limitations.every((limitation) => boundedText(limitation, MAX_LIMITATION_LENGTH))
  ) {
    return false;
  }

  const checksBySection = groupChecks(input.checks);
  const narratives = new Map<HealthGroupId, ProviderSectionNarrative>();
  const sectionLevels = new Map<HealthGroupId, AnalysisSectionLevel>();
  for (const valueSection of response.sections) {
    if (!hasExactProperties(valueSection, providerSectionProperties)) return false;
    const section = valueSection as Record<string, unknown>;
    if (
      !isOneOf(section.section, sectionIds) ||
      narratives.has(section.section) ||
      !boundedText(section.headline, MAX_ISSUE_TITLE_LENGTH) ||
      !boundedText(section.plain_english, MAX_OUTPUT_SUMMARY_LENGTH) ||
      typeof section.codex_recommended !== "boolean"
    ) {
      return false;
    }
    const level = sectionLevelForChecks(checksBySection.get(section.section) ?? []);
    if (
      (level === "all_good" && section.codex_recommended) ||
      !narrativeMatchesLevel(section.headline, section.plain_english, level)
    ) return false;
    narratives.set(section.section, section as unknown as ProviderSectionNarrative);
    sectionLevels.set(section.section, level);
  }

  const overallLevel = overallLevelForSections([...sectionLevels.values()]);
  return sectionIds.every((section) => narratives.has(section)) &&
    narrativeMatchesLevel(
      response.overall.headline as string,
      response.overall.plain_english as string,
      overallLevel
    );
}

export function buildValidatedAnalysisResult(
  value: unknown,
  input: SystemHealthAnalysisInput
): SystemHealthAnalysisResult | null {
  if (!validateProviderResponse(value, input)) return null;
  const checksBySection = groupChecks(input.checks);
  const sections = healthGroups.map(({ id }) => {
    const checks = checksBySection.get(id) ?? [];
    const narrative = value.sections.find((section) => section.section === id);
    if (!narrative) throw new TypeError("Validated analysis section unexpectedly missing.");
    return {
      ...narrative,
      level: sectionLevelForChecks(checks),
      affected_checks: checks
        .filter((check) => categoryForHealth(check.stored_status, check.reason_code) !== "healthy")
        .map((check) => `${check.service_key}/${check.check_key}`),
    };
  });
  return {
    overall: {
      level: overallLevelForSections(sections.map(({ level }) => level)),
      ...value.overall,
    },
    sections,
    limitations: value.limitations,
  };
}

function projectCheck(check: DiagnosticCheck): AnalysisInputCheck {
  if (
    !isRecord(check) ||
    !isBoundedKey(check.service_key) ||
    !isBoundedKey(check.check_key) ||
    !isOneOf(check.stored_status, healthStatuses) ||
    !isOneOf(check.severity, healthSeverities) ||
    !(check.reason_code === null || isReasonCode(check.reason_code)) ||
    !isBoundedText(check.safe_summary, MAX_ANALYSIS_SUMMARY_LENGTH) ||
    !isOneOf(check.display_status, displayStatuses) ||
    !(check.verified_at === null || typeof check.verified_at === "string") ||
    (check.verified_at !== null) !==
      ["operational", "degraded", "incident"].includes(check.stored_status) ||
    !isRecord(check.evidence)
  ) {
    throw new TypeError("Diagnostic check is not valid for System Health analysis.");
  }

  const evidence = sanitizeEvidence(check.evidence);
  const expectedDisplay = displayStatus(
    check.stored_status as HealthStatus,
    check.reason_code as string | null
  );
  if (check.display_status !== expectedDisplay) {
    throw new TypeError("Diagnostic display status does not match its stored status.");
  }

  return {
    section_key: sectionForService(check.service_key),
    service_key: check.service_key,
    check_key: check.check_key,
    stored_status: check.stored_status as HealthStatus,
    category: categoryForHealth(
      check.stored_status as HealthStatus,
      check.reason_code as string | null
    ),
    display_status: expectedDisplay,
    severity: check.severity as HealthSeverity,
    reason_code: check.reason_code as string | null,
    safe_summary: check.safe_summary,
    evidence,
    verified: check.verified_at !== null,
  };
}

function groupChecks(checks: readonly AnalysisInputCheck[]) {
  const grouped = new Map<HealthGroupId, AnalysisInputCheck[]>(
    healthGroups.map(({ id }) => [id, []])
  );
  for (const check of checks) grouped.get(check.section_key)?.push(check);
  return grouped;
}

function narrativeMatchesLevel(
  headline: string,
  plainEnglish: string,
  level: AnalysisSectionLevel
) {
  const text = `${headline} ${plainEnglish}`;
  if (level !== "critical" && /\bcritical\b|\bsevere outage\b/i.test(text)) return false;
  if (
    level === "monitoring_incomplete" &&
    /\b(?:broken|outage|down|failed|failure|incident|degraded)\b/i.test(text)
  ) return false;
  return true;
}

function countsForCheck(counts: AnalysisCounts, check: AnalysisInputCheck) {
  const category = categoryForHealth(check.stored_status, check.reason_code);
  if (category === "healthy") counts.operational++;
  else if (category === "verified_incident") counts.incident++;
  else if (category === "degraded") counts.degraded++;
  else if (category === "monitoring_failure") counts.needs_investigation++;
  else if (category === "setup_required") counts.setup_required++;
  else if (category === "staging_gap") counts.staging_gap++;
  else if (category === "coverage_gap") counts.not_yet_monitored++;
  else counts.unknown++;
}

function emptyCounts(): AnalysisCounts {
  return {
    operational: 0,
    degraded: 0,
    incident: 0,
    needs_investigation: 0,
    setup_required: 0,
    staging_gap: 0,
    not_yet_monitored: 0,
    unknown: 0,
  };
}

function hasExactProperties(
  value: unknown,
  allowed: readonly string[]
): value is Record<string, unknown> {
  return isRecord(value) &&
    Object.keys(value).length === allowed.length &&
    Object.keys(value).every((key) => allowed.includes(key));
}

function isBoundedKey(value: unknown): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_ANALYSIS_KEY_LENGTH &&
    /^[a-z][a-z0-9_]*$/.test(value);
}

function isReasonCode(value: unknown): value is string {
  return typeof value === "string" &&
    value.length <= MAX_ANALYSIS_REASON_CODE_LENGTH &&
    /^[a-z][a-z0-9_]*$/.test(value);
}

function boundedText(value: unknown, maxLength: number): value is string {
  return isBoundedText(value, maxLength) && value.trim().length > 0;
}

function isBoundedText(value: unknown, maxLength: number): value is string {
  return typeof value === "string" &&
    value.length <= maxLength &&
    !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value);
}

function isOneOf<const T extends readonly string[]>(
  value: unknown,
  values: T
): value is T[number] {
  return typeof value === "string" && values.includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
