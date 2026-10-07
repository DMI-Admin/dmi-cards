import "server-only";

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/admin-auth";
import { requestIdFromRequest } from "@/lib/observability/request";
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

  if (request.body !== null) {
    return response(
      { error: "A request body is not supported." },
      400,
      requestId
    );
  }

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

function response(body: unknown, status: number, requestId: string) {
  return NextResponse.json(body, {
    status,
    headers: { ...safeHeaders, "x-request-id": requestId },
  });
}
