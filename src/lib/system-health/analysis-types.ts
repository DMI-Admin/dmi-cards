import type { DiagnosticReport, DisplayStatus } from "./presentation";
import type { HealthSeverity, HealthStatus } from "./types";

export const analysisCategories = [
  "healthy",
  "verified_incident",
  "degraded",
  "monitoring_failure",
  "setup_required",
  "staging_gap",
  "coverage_gap",
  "unknown",
] as const;

export type AnalysisCategory = (typeof analysisCategories)[number];
export type AnalysisIssueCategory = Exclude<AnalysisCategory, "healthy">;

export const overallAssessments = [
  "healthy",
  "action_required",
  "configuration_required",
  "staging_parity_gap",
  "coverage_gap",
  "mixed",
  "unknown",
] as const;

export type OverallAssessment = (typeof overallAssessments)[number];
export type AnalysisConfidence = "high" | "medium" | "low";
export type ChangeRequirement = "yes" | "no" | "unknown";

export const safeEvidenceKeys = [
  "returned_rows",
  "http_status",
  "configuration_present_count",
  "configuration_required_count",
  "configured",
  "certificate_valid",
  "provider_response_ok",
  "query_bounded",
] as const;

export type SafeEvidenceKey = (typeof safeEvidenceKeys)[number];
export type SafeEvidenceValue = number | boolean;

export type AnalysisCounts = {
  operational: number;
  degraded: number;
  incident: number;
  needs_investigation: number;
  setup_required: number;
  staging_gap: number;
  not_yet_monitored: number;
  unknown: number;
};

export type AnalysisInputCheck = {
  service_key: string;
  check_key: string;
  stored_status: HealthStatus;
  display_status: DisplayStatus;
  severity: HealthSeverity;
  reason_code: string | null;
  safe_summary: string;
  evidence: Partial<Record<SafeEvidenceKey, SafeEvidenceValue>>;
  verified: boolean;
};

export type SystemHealthAnalysisInput = {
  environment: "staging";
  overall_assessment_source: {
    headline: string;
    counts: AnalysisCounts;
  };
  checks: AnalysisInputCheck[];
};

export type AnalysisIssue = {
  service_key: string;
  check_key: string;
  category: AnalysisIssueCategory;
  title: string;
  explanation: string;
  probable_area: string;
  recommended_next_step: string;
  where_to_fix: string;
  confidence: AnalysisConfidence;
  requires_code_change: ChangeRequirement;
  requires_configuration_change: ChangeRequirement;
  requires_database_change: ChangeRequirement;
  evidence_check_keys: string[];
};

export type SystemHealthAnalysisResult = {
  summary: string;
  overall_assessment: OverallAssessment;
  issues: AnalysisIssue[];
  limitations: string[];
};

export type DiagnosticReportInput = Pick<
  DiagnosticReport,
  "overall_headline" | "checks"
>;
