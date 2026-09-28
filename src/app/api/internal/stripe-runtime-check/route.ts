import "server-only";

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/admin-auth";
import { resolveStripeAccountScope } from "@/lib/stripe/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const headers = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie, Authorization",
};

// Temporary Preview-only diagnostic. No billing runtime, leases or database access.
export async function GET() {
  if (process.env.VERCEL_ENV !== "preview") {
    return new Response(null, { status: 404, headers });
  }

  try {
    const access = await requireAdminAccess(await auth());
    if (!access.authorized) {
      return new Response(null, { status: 403, headers });
    }

    const { accountId, livemode, stripeScope } = await resolveStripeAccountScope();
    return NextResponse.json({ accountId, livemode, stripeScope }, { headers });
  } catch {
    // Do not log provider errors or return provider/configuration details.
    return new Response(null, { status: 503, headers });
  }
}
