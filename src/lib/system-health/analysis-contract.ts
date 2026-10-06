import { displayStatus, type DiagnosticReport } from "./presentation";
import { sanitizeEvidence } from "./monitoring-core";
import type { HealthSeverity, HealthStatus } from "./types";
import {
  analysisCategories,
  overallAssessments,
  safeEvidenceKeys,
  type AnalysisCategory,
  type AnalysisCounts,
  type AnalysisIssueCategory,
  type AnalysisInputCheck,
  type DiagnosticReportInput,
  type SystemHealthAnalysisInput,
  type SystemHealthAnalysisResult,
} from "./analysis-types";

export const MAX_ANALYSIS_CHECKS = 16;
export const MAX_ANALYSIS_SUMMARY_LENGTH = 240;
export const MAX_ANALYSIS_REASON_CODE_LENGTH = 96;
export const MAX_ANALYSIS_KEY_LENGTH = 64;
export const MAX_OUTPUT_SUMMARY_LENGTH = 500;
export const MAX_ISSUE_TITLE_LENGTH = 120;
export const MAX_ISSUE_EXPLANATION_LENGTH = 500;
export const MAX_ISSUE_ACTION_LENGTH = 300;
export const MAX_ISSUE_PROBABLE_AREA_LENGTH = 160;
export const MAX_ISSUES = 16;
export const MAX_EVIDENCE_KEYS = safeEvidenceKeys.length;
export const MAX_LIMITATIONS = 8;
export const MAX_LIMITATION_LENGTH = 240;

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
const issueProperties = [
  "service_key",
  "check_key",
  "category",
  "title",
  "explanation",
  "probable_area",
  "recommended_next_step",
  "where_to_fix",
  "confidence",
  "requires_code_change",
  "requires_configuration_change",
  "requires_database_change",
  "evidence_check_keys",
] as const;
const resultProperties = ["summary", "overall_assessment", "issues", "limitations"] as const;

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

export function buildAnalysisInput(report: DiagnosticReportInput): SystemHealthAnalysisInput {
  if (!isRecord(report) || !Array.isArray(report.checks) || report.checks.length > MAX_ANALYSIS_CHECKS) {
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

export function validateAnalysisResult(
  value: unknown,
  input: SystemHealthAnalysisInput
): value is SystemHealthAnalysisResult {
  if (!hasExactProperties(value, resultProperties)) return false;
  const result = value as Record<string, unknown>;
  if (
    !boundedText(result.summary, MAX_OUTPUT_SUMMARY_LENGTH) ||
    !isOneOf(result.overall_assessment, overallAssessments) ||
    !Array.isArray(result.issues) ||
    result.issues.length > MAX_ISSUES ||
    !Array.isArray(result.limitations) ||
    result.limitations.length > MAX_LIMITATIONS ||
    !result.limitations.every((item) => boundedText(item, MAX_LIMITATION_LENGTH))
  ) {
    return false;
  }

  const inputChecks = new Map(
    input.checks.map((check) => [`${check.service_key}/${check.check_key}`, check])
  );
  const seen = new Set<string>();
  for (const valueIssue of result.issues) {
    if (!hasExactProperties(valueIssue, issueProperties)) return false;
    const issue = valueIssue as Record<string, unknown>;
    const reference = `${String(issue.service_key)}/${String(issue.check_key)}`;
    const sourceCheck = inputChecks.get(reference);
    if (
      !sourceCheck ||
      seen.has(reference) ||
      !isOneOf(issue.category, analysisCategories.filter(
        (category): category is AnalysisIssueCategory => category !== "healthy"
      )) ||
      issue.category !== categoryForHealth(sourceCheck.stored_status, sourceCheck.reason_code) ||
      !boundedText(issue.title, MAX_ISSUE_TITLE_LENGTH) ||
      !boundedText(issue.explanation, MAX_ISSUE_EXPLANATION_LENGTH) ||
      !boundedText(issue.probable_area, MAX_ISSUE_PROBABLE_AREA_LENGTH) ||
      !boundedText(issue.recommended_next_step, MAX_ISSUE_ACTION_LENGTH) ||
      !boundedText(issue.where_to_fix, MAX_ISSUE_ACTION_LENGTH) ||
      !isOneOf(issue.confidence, ["high", "medium", "low"]) ||
      !isOneOf(issue.requires_code_change, ["yes", "no", "unknown"]) ||
      !isOneOf(issue.requires_configuration_change, ["yes", "no", "unknown"]) ||
      !isOneOf(issue.requires_database_change, ["yes", "no", "unknown"]) ||
      !isEvidenceReferenceList(issue.evidence_check_keys, inputChecks)
    ) {
      return false;
    }
    seen.add(reference);
  }

  const requiredIssueCount = input.checks.filter((check) =>
    categoryForHealth(check.stored_status, check.reason_code) !== "healthy"
  ).length;
  return seen.size === requiredIssueCount &&
    result.overall_assessment === overallAssessmentForInput(input);
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
  if (Object.keys(evidence).length > MAX_EVIDENCE_KEYS) {
    throw new TypeError("Diagnostic evidence exceeds the analysis limit.");
  }

  const expectedDisplay = displayStatus(
    check.stored_status as HealthStatus,
    check.reason_code as string | null
  );
  if (check.display_status !== expectedDisplay) {
    throw new TypeError("Diagnostic display status does not match its stored status.");
  }

  return {
    service_key: check.service_key,
    check_key: check.check_key,
    stored_status: check.stored_status as HealthStatus,
    display_status: expectedDisplay,
    severity: check.severity as HealthSeverity,
    reason_code: check.reason_code as string | null,
    safe_summary: check.safe_summary,
    evidence,
    verified: check.verified_at !== null,
  };
}

function overallAssessmentForInput(input: SystemHealthAnalysisInput) {
  const categories = new Set(input.checks.map((check) =>
    categoryForHealth(check.stored_status, check.reason_code)
  ));
  const nonHealthy = new Set([...categories].filter((category) => category !== "healthy"));
  if (nonHealthy.size === 0) return "healthy";

  const groups = new Set(
    [...nonHealthy].map((category) => {
      if (
        category === "verified_incident" ||
        category === "degraded" ||
        category === "monitoring_failure"
      ) return "action_required";
      if (category === "setup_required") return "configuration_required";
      if (category === "staging_gap") return "staging_parity_gap";
      if (category === "coverage_gap") return "coverage_gap";
      return "unknown";
    })
  );
  if (groups.size !== 1) return "mixed";
  return [...groups][0] as (typeof overallAssessments)[number];
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

function isEvidenceReferenceList(
  value: unknown,
  inputChecks: Map<string, AnalysisInputCheck>
): value is string[] {
  if (!Array.isArray(value) || value.length > MAX_ANALYSIS_CHECKS) return false;
  const seen = new Set<string>();
  for (const reference of value) {
    if (
      !isBoundedText(reference, MAX_ANALYSIS_KEY_LENGTH * 2 + 1) ||
      !inputChecks.has(reference) ||
      seen.has(reference)
    ) return false;
    seen.add(reference);
  }
  return true;
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
