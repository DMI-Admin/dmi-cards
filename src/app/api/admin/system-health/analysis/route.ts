import "server-only";
import { randomUUID } from "node:crypto";

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/admin-auth";
import { requestIdFromRequest } from "@/lib/observability/request";
import { logWarn } from "@/lib/observability/logger";
import { enforceSystemHealthAnalysisRateLimit } from "@/lib/security/public-lead-rate-limit";
import { loadLatestStagingMonitorRun } from "@/lib/system-health/admin-report-server";
import {
  buildAnalysisInput,
} from "@/lib/system-health/analysis-contract";
import { buildDiagnosticReport } from "@/lib/system-health/presentation";
import {
  getSystemHealthAnalysisProvider,
  AnalysisInputTooLargeError,
  AnalysisProviderNotConfiguredError,
  AnalysisProviderOutputInvalidError,
  AnalysisProviderTimeoutError,
  safeAnalysisFailureMetadata,
} from "@/lib/system-health/analysis-provider";
import { runSystemHealthAnalysis } from "@/lib/system-health/analysis-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const stagingSupabaseUrl = "https://uohdkewufeivdpaljnng.supabase.co";
const safeHeaders = { "Cache-Control": "private, no-store" };

export async function POST(request: Request) {
  const requestId = requestIdFromRequest(request);
  const adminAccess = await requireAdminAccess(await auth());

  if (!adminAccess.authorized) {
    return response(
      { error: adminAccess.error },
      adminAccess.status,
      requestId
    );
  }

  if (
    process.env.VERCEL_ENV !== "preview" ||
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() !== stagingSupabaseUrl
  ) {
    return response(
      { error: "System Health AI analysis is available only for Staging." },
      503,
      requestId
    );
  }

  if (!(await hasEmptyRequestBody(request))) {
    return response(
      { error: "A request body is not supported." },
      400,
      requestId
    );
  }

  const startedAt = Date.now();
  try {
    const allowed = await enforceSystemHealthAnalysisRateLimit(adminAccess.userId);
    if (!allowed) {
      return response(
        { error: "System Health analysis is temporarily rate limited." },
        429,
        requestId
      );
    }

    const run = await loadLatestStagingMonitorRun();
    if (!run) {
      return response(
        { error: "No saved Staging System Health run is available." },
        503,
        requestId
      );
    }

    const diagnosticReport = buildDiagnosticReport(run);
    const input = buildAnalysisInput(diagnosticReport);
    const provider = getSystemHealthAnalysisProvider();
    const result = await runSystemHealthAnalysis(input, provider);
    return response(result, 200, requestId);
  } catch (error) {
    const failure = safeAnalysisFailureMetadata(
      error instanceof AnalysisProviderOutputInvalidError || error instanceof AnalysisProviderTimeoutError
        ? error.failure : {
          stage: error instanceof AnalysisProviderNotConfiguredError ? "not_configured"
            : error instanceof AnalysisInputTooLargeError ? "input_too_large" : "unclassified_failure",
          fetch_attempted: false, response_received: false, elapsed_ms: Math.max(0, Date.now() - startedAt),
        }
    );
    logWarn({
      code: "system_health_ai_analysis_failed",
      requestId: randomUUID(),
      route: "/api/admin/system-health/analysis",
      metadata: failure,
    });
    if (error instanceof AnalysisInputTooLargeError) {
      return response(
        { error: "System Health diagnostic input exceeded the safe analysis limit." },
        413,
        requestId
      );
    }
    if (error instanceof AnalysisProviderNotConfiguredError) {
      return response(
        { error: "System Health AI analysis is not configured." },
        503,
        requestId
      );
    }
    if (error instanceof AnalysisProviderTimeoutError) {
      return response(
        { error: "System Health AI analysis timed out. Try again later." },
        504,
        requestId
      );
    }
    if (error instanceof AnalysisProviderOutputInvalidError) {
      return response(
        { error: "System Health AI returned a response that could not be validated." },
        502,
        requestId
      );
    }
    return response(
      { error: "System Health analysis could not be completed safely." },
      503,
      requestId
    );
  }
}

async function hasEmptyRequestBody(request: Request): Promise<boolean> {
  if (request.body === null) return true;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    reader = request.body.getReader();
    const bodyReader = reader;
    // Next.js may provide an empty stream for a bodyless POST. Inspect bytes,
    // never Content-Length, and bound both elapsed time and empty chunks.
    const deadline = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), 1_000);
    });
    return await Promise.race([
      deadline,
      (async () => {
        for (let reads = 0; reads < 16; reads++) {
          const { done, value } = await bodyReader.read();
          if (done) return true;
          if (value.byteLength !== 0) return false;
        }
        return false;
      })(),
    ]);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
    if (reader) {
      // Cancellation can itself stall; do not await untrusted stream cleanup.
      void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
}

function response(body: unknown, status: number, requestId: string) {
  return NextResponse.json(body, {
    status,
    headers: { ...safeHeaders, "x-request-id": requestId },
  });
}
