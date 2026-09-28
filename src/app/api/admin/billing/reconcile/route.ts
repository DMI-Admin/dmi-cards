import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/admin-auth";
import { reconcileBilling, isSubscriptionId } from "@/lib/stripe/reconciliation";
export const dynamic = "force-dynamic";
export const revalidate = 0;
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function POST(request: Request) {
  try {
    const access = await requireAdminAccess(await auth());
    if (!access.authorized) return NextResponse.json({ error: access.error }, { status: 403, headers });
    if ((request.headers.get("origin") && request.headers.get("origin") !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site") return NextResponse.json({ error: "Cross-origin request denied." }, { status: 403, headers });
    const reader = request.body?.getReader();
    if (!reader) return NextResponse.json({ error: "Missing request." }, { status: 400, headers });
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 2000) { await reader.cancel(); return NextResponse.json({ error: "Request too large." }, { status: 413, headers }); } chunks.push(part.value); }
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400, headers }); }
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !["mode", "userId", "after"].includes(key)) || !["dry_run", "repair"].includes(body.mode)
      || (body.userId !== undefined && (typeof body.userId !== "string" || !uuid.test(body.userId)))
      || (body.after !== undefined && (typeof body.after !== "string" || !(body.userId ? isSubscriptionId(body.after) : uuid.test(body.after))))) {
      return NextResponse.json({ error: "Invalid reconciliation request." }, { status: 400, headers });
    }
    return NextResponse.json(await reconcileBilling(body, access.userId), { headers });
  } catch { return NextResponse.json({ error: "Reconciliation could not complete. Review diagnostics and retry; earlier items may have completed." }, { status: 503, headers }); }
}
