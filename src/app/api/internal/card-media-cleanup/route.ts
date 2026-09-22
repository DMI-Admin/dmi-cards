import { timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { runCardMediaCleanup } from "@/lib/card-media-cleanup-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const productionOrigin = "https://gdpwqivdsjymivleruac.supabase.co";
const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const provided = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret ?? ""}`);
  if (!secret || secret.length < 32 || provided.length !== expected.length
    || !timingSafeEqual(provided, expected)) {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  }
  if (new URL(request.url).search) {
    return Response.json({ error: "Parameters are not supported" }, { status: 400, headers });
  }
  if (process.env.VERCEL_ENV !== "production"
    || (process.env.NEXT_PUBLIC_SUPABASE_URL !== productionOrigin
      && process.env.NEXT_PUBLIC_SUPABASE_URL !== "https://auth.dmicards.com")
    || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json({ error: "Cleanup is not configured" }, { status: 503, headers });
  }
  const started = Date.now();
  try {
    const database = createClient(productionOrigin, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (input, init = {}) => fetch(input, {
        ...init,
        signal: init.signal
          ? AbortSignal.any([init.signal, AbortSignal.timeout(10_000)])
          : AbortSignal.timeout(10_000),
      }) },
    });
    // Exactly one invocation: fixed ceiling of five assets and five empty sessions.
    const counts = await runCardMediaCleanup(database, 5);
    const status = counts.failed || counts.staleInvalid ? "needs_attention" : "complete";
    console.info(JSON.stringify({ event: "card_media_cleanup", status,
      durationMs: Date.now() - started, ...counts }));
    return Response.json({ status, ...counts }, { status: status === "complete" ? 200 : 503, headers });
  } catch {
    console.error(JSON.stringify({ event: "card_media_cleanup", status: "failed",
      durationMs: Date.now() - started }));
    return Response.json({ error: "Cleanup failed" }, { status: 503, headers });
  }
}
