import "server-only";

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/admin-auth";
import { requestIdFromRequest } from "@/lib/observability/request";
import { loadLatestStagingMonitorRun } from "@/lib/system-health/admin-report-server";
import type { StagingMonitoringResponse } from "@/lib/system-health/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const stagingSupabaseUrl = "https://uohdkewufeivdpaljnng.supabase.co";
const safeHeaders = { "Cache-Control": "private, no-store" };

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

  let monitoringRun: StagingMonitoringResponse["monitoringRun"];
  try {
    monitoringRun = await loadLatestStagingMonitorRun();
  } catch {
    return historyUnavailable(requestId);
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

function historyUnavailable(requestId: string) {
  return NextResponse.json(
    { error: "The latest Staging System Health run could not be read safely." },
    { status: 503, headers: { ...safeHeaders, "x-request-id": requestId } }
  );
}
