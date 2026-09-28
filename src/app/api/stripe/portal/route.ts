import { NextResponse } from "next/server";
import { requireBillingIdentity } from "@/lib/stripe/client-identity";
import { ApiRouteError } from "@/lib/api/responses";
import { billingCustomerForUser, createStripeBillingPortalSession } from "@/lib/stripe/checkout";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const client = await requireBillingIdentity(request);
    const customerId = await billingCustomerForUser(client.userId);
    const session = await createStripeBillingPortalSession({ customerId, returnUrl: `${new URL(request.url).origin}/client/billing?portal=return` });
    if (!session.url) throw new Error("Portal unavailable");
    return NextResponse.json({ url: session.url }, { headers });
  } catch (error) {
    return NextResponse.json({ error: { code: error instanceof ApiRouteError ? error.code : "STRIPE_PORTAL_FAILED", message: error instanceof ApiRouteError ? error.message : "Could not open Stripe Billing Portal." } }, { status: error instanceof ApiRouteError ? error.status : 503, headers });
  }
}
