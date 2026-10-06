import { timingSafeEqual } from "node:crypto";
import { runSystemHealthMonitoring } from "@/lib/system-health/monitoring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const stagingSupabaseUrl = "https://uohdkewufeivdpaljnng.supabase.co";
const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const provided = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(secret ? `Bearer ${secret}` : "");

  if (!secret || secret.length < 32 || provided.length !== expected.length
    || !timingSafeEqual(provided, expected)) {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  }

  if (new URL(request.url).search) {
    return Response.json({ error: "Parameters are not supported" }, { status: 400, headers });
  }

  if (process.env.VERCEL_ENV === "production") {
    return Response.json({
      ok: true,
      skipped: true,
      checked: 0,
      operational: 0,
      degraded: 0,
      incident: 0,
      unknown: 0,
      notConfigured: 0,
      notMigrated: 0,
      retentionDeleted: 0,
    }, { headers });
  }

  if (
    process.env.VERCEL_ENV !== "preview" ||
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() !== stagingSupabaseUrl
  ) {
    return Response.json({ error: "Staging monitoring is not configured for this deployment." }, {
      status: 503,
      headers,
    });
  }

  try {
    const result = await runSystemHealthMonitoring();
    return Response.json({
      ok: true,
      runId: result.runId,
      ...result.counts,
      retentionDeleted: result.retentionDeleted,
    }, { headers });
  } catch {
    return Response.json({ error: "System Health monitoring run could not be persisted." }, {
      status: 503,
      headers,
    });
  }
}
