import type { DiagnosticReport, DisplayStatus } from "./presentation";
import type { HealthGroupId, HealthSeverity, HealthStatus } from "./types";

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
export type AnalysisSectionLevel =
  | "all_good"
  | "monitoring_incomplete"
  | "needs_attention"
  | "critical";

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
  section_key: HealthGroupId;
  service_key: string;
  check_key: string;
  stored_status: HealthStatus;
  category: AnalysisCategory;
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

export type ProviderSectionNarrative = {
  section: HealthGroupId;
  headline: string;
  plain_english: string;
  codex_recommended: boolean;
};

export type ProviderAnalysisResponse = {
  overall: {
    headline: string;
    plain_english: string;
  };
  sections: ProviderSectionNarrative[];
  limitations: string[];
};

export type SystemHealthAnalysisSection = ProviderSectionNarrative & {
  level: AnalysisSectionLevel;
  affected_checks: string[];
};

export type SystemHealthAnalysisResult = {
  overall: {
    level: AnalysisSectionLevel;
    headline: string;
    plain_english: string;
  };
  sections: SystemHealthAnalysisSection[];
  limitations: string[];
};

export type DiagnosticReportInput = Pick<
  DiagnosticReport,
  "environment" | "overall_headline" | "checks"
>;
