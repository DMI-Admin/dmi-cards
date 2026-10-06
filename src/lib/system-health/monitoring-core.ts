import type { HealthSeverity, HealthStatus } from "./types";

export const monitorStatuses = [
  "operational",
  "degraded",
  "incident",
  "unknown",
  "not_configured",
  "not_migrated",
] as const satisfies readonly HealthStatus[];

export const monitorSeverities = [
  "none",
  "info",
  "warning",
  "critical",
] as const satisfies readonly HealthSeverity[];

export const CHECK_TIMEOUT_MS = 5_000;
export const RETENTION_DAYS = 30;
export const RETENTION_BATCH_SIZE = 500;
export const RETENTION_MAX_BATCHES = 5;

const allowedEvidenceKeys = new Set([
  "returned_rows",
  "http_status",
  "configuration_present_count",
  "configuration_required_count",
  "configured",
  "certificate_valid",
  "provider_response_ok",
  "query_bounded",
]);

export type SafeEvidence = Record<string, number | boolean>;

export type MonitorObservation = {
  status: HealthStatus;
  severity: HealthSeverity;
  verified: boolean;
  reasonCode: string | null;
  safeSummary: string;
  evidence?: Record<string, unknown>;
};

export type MonitorCheckDefinition = {
  serviceKey: string;
  checkKey: string;
  run: (signal: AbortSignal) => Promise<MonitorObservation>;
};

export type MonitorCheckResult = {
  serviceKey: string;
  checkKey: string;
  status: HealthStatus;
  severity: HealthSeverity;
  checkedAt: string;
  verifiedAt: string | null;
  durationMs: number;
  reasonCode: string | null;
  safeSummary: string;
  evidence: SafeEvidence;
};

class CheckTimeoutError extends Error {}

export function sanitizeEvidence(evidence: Record<string, unknown> = {}): SafeEvidence {
  return Object.fromEntries(
    Object.entries(evidence).filter(([key, value]) =>
      allowedEvidenceKeys.has(key) &&
      ((typeof value === "number" && Number.isFinite(value)) || typeof value === "boolean")
    )
  ) as SafeEvidence;
}

export async function executeChecks(
  definitions: readonly MonitorCheckDefinition[],
  timeoutMs = CHECK_TIMEOUT_MS
): Promise<MonitorCheckResult[]> {
  return Promise.all(definitions.map(async (definition) => {
    const startedAt = Date.now();
    const started = performance.now();
    const checkedAt = new Date(startedAt).toISOString();
    const controller = new AbortController();

    try {
      const observation = await withTimeout(
        definition.run(controller.signal),
        timeoutMs,
        controller
      );
      return {
        serviceKey: definition.serviceKey,
        checkKey: definition.checkKey,
        status: observation.status,
        severity: observation.severity,
        checkedAt,
        verifiedAt: observation.verified ? new Date().toISOString() : null,
        durationMs: Math.min(60_000, Math.max(0, Math.round(performance.now() - started))),
        reasonCode: observation.reasonCode,
        safeSummary: observation.safeSummary.slice(0, 240),
        evidence: sanitizeEvidence(observation.evidence),
      };
    } catch (error) {
      const timedOut = error instanceof CheckTimeoutError;
      return {
        serviceKey: definition.serviceKey,
        checkKey: definition.checkKey,
        status: "unknown",
        severity: "info",
        checkedAt,
        verifiedAt: null,
        durationMs: Math.min(60_000, Math.max(0, Math.round(performance.now() - started))),
        reasonCode: timedOut ? "check_timed_out" : "check_failed",
        safeSummary: timedOut
          ? "The check exceeded its time limit; health could not be verified."
          : "The check failed before it could return verified evidence.",
        evidence: {},
      };
    }
  }));
}

export function summarizeCheckResults(results: readonly MonitorCheckResult[]) {
  const counts = {
    checked: results.length,
    operational: 0,
    degraded: 0,
    incident: 0,
    unknown: 0,
    notConfigured: 0,
    notMigrated: 0,
  };

  for (const result of results) {
    switch (result.status) {
      case "operational":
        counts.operational++;
        break;
      case "degraded":
        counts.degraded++;
        break;
      case "incident":
        counts.incident++;
        break;
      case "not_configured":
        counts.notConfigured++;
        break;
      case "not_migrated":
        counts.notMigrated++;
        break;
      case "unknown":
        counts.unknown++;
        break;
    }
  }

  return counts;
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  controller: AbortController
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new CheckTimeoutError());
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
