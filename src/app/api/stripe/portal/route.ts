import { NextResponse } from "next/server";

import { requireApiClient } from "@/lib/api/client-context";
import { ApiRouteError } from "@/lib/api/responses";
import { isPaidPlan, normalizeDmiPlan } from "@/lib/entitlements";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { createStripeBillingPortalSession } from "@/lib/stripe/checkout";

export const dynamic = "force-dynamic";

type BillingSubscriptionPortalRow = {
  stripe_customer_id?: string | null;
  stripe_subscription_status?: string | null;
  dmi_plan?: string | null;
  updated_at?: string | null;
};

export async function POST(request: Request) {
  try {
    const client = await requireApiClient(request);

    if (!isPaidPlan(client.plan)) {
      throw new ApiRouteError(
        403,
        "FORBIDDEN",
        "A paid subscription is required to manage billing."
      );
    }

    const stripeCustomerId = await stripeCustomerIdForUser(client.userId);

    if (!stripeCustomerId) {
      throw new ApiRouteError(
        409,
        "CONFLICT",
        "No Stripe customer is available for this account yet."
      );
    }

    const origin = new URL(request.url).origin;
    const session = await createStripeBillingPortalSession({
      customerId: stripeCustomerId,
      returnUrl: `${origin}/client/billing?portal=return`,
    });

    if (!session.url) {
      throw new Error("Stripe Billing Portal session did not return a URL.");
    }

    return NextResponse.json({ url: session.url });
  } catch (error) {
    if (error instanceof ApiRouteError) {
      return NextResponse.json(
        {
          error: {
            code: error.code,
            message: error.message,
          },
        },
        { status: error.status }
      );
    }

    console.error("[DMI Stripe] billing portal session creation failed", {
      name: error instanceof Error ? error.name : "UnknownError",
    });

    return NextResponse.json(
      {
        error: {
          code: "STRIPE_PORTAL_FAILED",
          message: "Could not open Stripe Billing Portal.",
        },
      },
      { status: 500 }
    );
  }
}

async function stripeCustomerIdForUser(userId: string) {
  const supabaseAdmin = createSupabaseAdminClient();
  const { data, error } = await supabaseAdmin
    .from("billing_subscriptions")
    .select("stripe_customer_id, stripe_subscription_status, dmi_plan, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(10);

  if (error) {
    throw new Error(`Billing subscription lookup failed: ${error.code || "UNKNOWN"}`);
  }

  const rows = (data || []) as BillingSubscriptionPortalRow[];
  const paidRow = rows.find((row) => {
    const status = row.stripe_subscription_status;

    return (
      Boolean(row.stripe_customer_id) &&
      (status === "active" || status === "trialing") &&
      normalizeDmiPlan(row.dmi_plan) !== "free"
    );
  });

  return paidRow?.stripe_customer_id?.trim() || "";
}
