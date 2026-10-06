import "server-only";

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/admin-auth";
import { requestIdFromRequest } from "@/lib/observability/request";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { sanitizeEvidence } from "@/lib/system-health/monitoring-core";
import {
  healthStatuses,
  type HealthSeverity,
  type HealthStatus,
  type StagingMonitoringResponse,
  type StoredMonitorCheck,
} from "@/lib/system-health/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const stagingSupabaseUrl = "https://uohdkewufeivdpaljnng.supabase.co";
const safeHeaders = { "Cache-Control": "private, no-store" };
const severities: readonly HealthSeverity[] = ["critical", "warning", "info", "none"];
const safeSummarySensitivePattern =
  /(?:[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|(?:\+?\d[\d\s().-]{7,}\d)|(?:bearer\s+\S+)|(?:-----BEGIN [^-]*PRIVATE KEY-----))/i;

export async function GET(request: Request) {
  const requestId = requestIdFromRequest(request);
  const adminAccess = await requireAdminAccess(await auth());

  if (!adminAccess.authorized) {
    return NextResponse.json(
      { error: adminAccess.error },
      { status: adminAccess.status, headers: { ...safeHeaders, "x-request-id": requestId } }
    );
  }

  if (
    process.env.VERCEL_ENV !== "preview" ||
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() !== stagingSupabaseUrl
  ) {
    return NextResponse.json(
      { error: "Staging System Health history is unavailable in this deployment." },
      { status: 503, headers: { ...safeHeaders, "x-request-id": requestId } }
    );
  }

  const database = createSupabaseAdminClient();
  const { data: latestRun, error: latestError } = await database
    .from("system_health_check_runs")
    .select("run_id, checked_at")
    .eq("environment", "staging")
    .order("checked_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestError) {
    return historyUnavailable(requestId);
  }

  let monitoringRun: StagingMonitoringResponse["monitoringRun"] = null;
  if (latestRun) {
    if (!isUuid(latestRun.run_id) || !isTimestamp(latestRun.checked_at)) {
      return historyUnavailable(requestId);
    }

    const { data: rows, error: rowsError } = await database
      .from("system_health_check_runs")
      .select("run_id, environment, service_key, check_key, status, severity, checked_at, verified_at, reason_code, safe_summary, evidence")
      .eq("environment", "staging")
      .eq("run_id", latestRun.run_id)
      .order("service_key", { ascending: true })
      .limit(16);

    if (rowsError || !rows || rows.length === 0) {
      return historyUnavailable(requestId);
    }

    const checks = rows.map((row) => toStoredMonitorCheck(row, latestRun.run_id));
    if (checks.some((check) => check === null)) {
      return historyUnavailable(requestId);
    }

    const validChecks = checks as StoredMonitorCheck[];
    const generatedAt = validChecks.reduce(
      (latest, check) => check.checkedAt > latest ? check.checkedAt : latest,
      validChecks[0].checkedAt
    );
    monitoringRun = {
      environment: "staging",
      generatedAt,
      runId: latestRun.run_id,
      checks: validChecks,
    };
  }

  const response: StagingMonitoringResponse = {
    service: "dmi-cards",
    requestId,
    environment: "staging",
    monitoringRun,
  };
  return NextResponse.json(response, {
    headers: { ...safeHeaders, "x-request-id": requestId },
  });
}

function toStoredMonitorCheck(
  row: Record<string, unknown>,
  expectedRunId: string
): StoredMonitorCheck | null {
  const status = typeof row.status === "string" && healthStatuses.includes(row.status as HealthStatus)
    ? row.status as HealthStatus
    : null;
  const verifiedStatus = status === "operational" || status === "degraded" || status === "incident";

  if (
    row.run_id !== expectedRunId ||
    row.environment !== "staging" ||
    typeof row.service_key !== "string" ||
    !/^[a-z][a-z0-9_]{0,63}$/.test(row.service_key) ||
    typeof row.check_key !== "string" ||
    !/^[a-z][a-z0-9_]{0,63}$/.test(row.check_key) ||
    status === null ||
    typeof row.severity !== "string" ||
    !severities.includes(row.severity as HealthSeverity) ||
    !isTimestamp(row.checked_at) ||
    (row.verified_at !== null && !isTimestamp(row.verified_at)) ||
    (verifiedStatus && row.verified_at === null) ||
    (!verifiedStatus && row.verified_at !== null) ||
    (row.reason_code !== null &&
      (typeof row.reason_code !== "string" || !/^[a-z][a-z0-9_]{0,95}$/.test(row.reason_code))) ||
    typeof row.safe_summary !== "string" ||
    row.safe_summary.length > 240
  ) {
    return null;
  }

  const safeSummary = safeSummarySensitivePattern.test(row.safe_summary)
    ? "The saved summary was omitted because it did not pass safe-display checks."
    : row.safe_summary;

  return {
    serviceKey: row.service_key,
    checkKey: row.check_key,
    storedStatus: status,
    severity: row.severity as HealthSeverity,
    reasonCode: row.reason_code as string | null,
    safeSummary,
    evidence: sanitizeEvidence(isRecord(row.evidence) ? row.evidence : {}),
    checkedAt: row.checked_at,
    verifiedAt: row.verified_at as string | null,
  };
}

function historyUnavailable(requestId: string) {
  return NextResponse.json(
    { error: "The latest Staging System Health run could not be read safely." },
    { status: 503, headers: { ...safeHeaders, "x-request-id": requestId } }
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
