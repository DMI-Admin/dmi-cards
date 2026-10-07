import { healthGroups } from "./types";
import type { AnalysisSectionLevel, SystemHealthAnalysisResult } from "./analysis-types";

export const analysisLevelDisplay: Record<AnalysisSectionLevel, { label: string; tone: string }> = {
  all_good: { label: "All good", tone: "aiAllGood" },
  monitoring_incomplete: { label: "Monitoring incomplete", tone: "aiMonitoringIncomplete" },
  needs_attention: { label: "Needs attention", tone: "aiNeedsAttention" },
  critical: { label: "Critical", tone: "aiCritical" },
};

const unavailable = "AI analysis is unavailable right now. You can try again later.";
const invalidResponse = "The AI summary could not be checked safely. Your health results have not changed.";
const notConfigured = "AI analysis has not been set up for Staging yet.";
const rateLimited = "Please wait a minute before requesting another AI summary.";

export class SystemHealthAnalysisClientError extends Error {
  name = "SystemHealthAnalysisClientError";
}

export function analysisErrorMessage(status: number, payload: unknown): string {
  const code = isRecord(payload)
    ? typeof payload.code === "string" ? payload.code : payload.error
    : undefined;
  if (status === 401 || status === 403) return "Admin access is required to request an AI summary.";
  switch (code) {
    case "SYSTEM_HEALTH_ANALYSIS_UNAVAILABLE": return unavailable;
    case "SYSTEM_HEALTH_ANALYSIS_NOT_CONFIGURED": return notConfigured;
    case "SYSTEM_HEALTH_ANALYSIS_INVALID_RESPONSE": return invalidResponse;
    case "SYSTEM_HEALTH_ANALYSIS_RATE_LIMITED": return rateLimited;
    // Existing endpoint returns this fixed safe message rather than a code.
    case "System Health AI analysis is not configured.": return notConfigured;
  }
  if (status === 429) return rateLimited;
  if (status === 502) return invalidResponse;
  if (status === 504) return "AI analysis took too long. You can try again later.";
  return unavailable;
}

export async function requestSystemHealthAnalysis(
  signal: AbortSignal,
  fetcher: typeof fetch = fetch
): Promise<SystemHealthAnalysisResult> {
  let response: Response;
  try {
    response = await fetcher("/api/admin/system-health/analysis", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      signal,
    });
  } catch {
    throw new SystemHealthAnalysisClientError(unavailable);
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new SystemHealthAnalysisClientError(analysisErrorMessage(response.status, payload));
  if (!isSystemHealthAnalysisResult(payload)) throw new SystemHealthAnalysisClientError(invalidResponse);
  return payload;
}

// Validate shape only. All levels and affected checks come from the server; never derive them from prose.
export function isSystemHealthAnalysisResult(value: unknown): value is SystemHealthAnalysisResult {
  if (!exactProperties(value, ["overall", "sections", "limitations"])) return false;
  if (!exactProperties(value.overall, ["level", "headline", "plain_english"]) || !isNarrative(value.overall)) return false;
  if (!Array.isArray(value.sections) || value.sections.length !== healthGroups.length) return false;
  const seen = new Set<string>();
  for (const section of value.sections) {
    if (
      !exactProperties(section, ["section", "level", "headline", "plain_english", "codex_recommended", "affected_checks"]) ||
      typeof section.section !== "string" || !healthGroups.some(({ id }) => id === section.section) ||
      seen.has(section.section) || !isNarrative(section) || typeof section.codex_recommended !== "boolean" ||
      !Array.isArray(section.affected_checks) || section.affected_checks.length > 16 ||
      !section.affected_checks.every((check) => typeof check === "string" && /^[a-z][a-z0-9_]{0,63}\/[a-z][a-z0-9_]{0,63}$/.test(check))
    ) return false;
    seen.add(section.section);
  }
  return Array.isArray(value.limitations) && value.limitations.length <= 8 &&
    value.limitations.every((text) => boundedText(text, 240));
}

function isNarrative(value: Record<string, unknown>): boolean {
  return typeof value.level === "string" && Object.hasOwn(analysisLevelDisplay, value.level) &&
    boundedText(value.headline, 120) && boundedText(value.plain_english, 500);
}

function boundedText(value: unknown, limit: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= limit &&
    !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value);
}

function exactProperties(value: unknown, keys: string[]): value is Record<string, unknown> {
  return isRecord(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
