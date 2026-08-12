import { NextResponse } from "next/server";

import { ClientAuthRequiredError, requireClientUser } from "@/lib/client-auth";
import { requireApiClient, type ApiClientContext } from "@/lib/api/client-context";
import { ApiRouteError } from "@/lib/api/responses";
import {
  isStripeBillingInterval,
  stripePriceForCheckoutPlan,
} from "@/lib/stripe/billing-state";
import { createStripeCheckoutSession } from "@/lib/stripe/checkout";

export const dynamic = "force-dynamic";

type CheckoutClient = {
  userId: string;
  email: string | null;
  profileId: string;
};

export async function POST(request: Request) {
  try {
    const client = await requireCheckoutClient(request);

    const body = await request.json().catch(() => ({}));
    const interval = typeof body?.interval === "string" ? body.interval : "";

    if (!isStripeBillingInterval(interval)) {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_BILLING_INTERVAL",
            message: "Billing interval must be monthly or annual.",
          },
        },
        { status: 400 }
      );
    }

    const priceId = stripePriceForCheckoutPlan("pro", interval);

    if (!priceId) {
      return NextResponse.json(
        {
          error: {
            code: "STRIPE_PRICE_NOT_CONFIGURED",
            message: "Stripe price is not configured.",
          },
        },
        { status: 500 }
      );
    }

    const origin = new URL(request.url).origin;
    const session = await createStripeCheckoutSession({
      userId: client.userId,
      profileId: client.profileId,
      email: client.email,
      plan: "pro",
      billingInterval: interval,
      priceId,
      successUrl: `${origin}/client/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${origin}/client/billing?checkout=cancelled`,
    });

    if (!session.url) {
      throw new Error("Stripe checkout session did not return a URL.");
    }

    return NextResponse.json({
      url: session.url,
    });
  } catch (error) {
    if (
      error instanceof ClientAuthRequiredError ||
      (error instanceof ApiRouteError && error.status === 401)
    ) {
      return NextResponse.json(
        {
          error: {
            code: "AUTHENTICATION_REQUIRED",
            message: "Please sign in to upgrade to Individual Pro.",
          },
        },
        { status: 401 }
      );
    }

    console.error("[DMI Stripe] checkout session creation failed", error);

    return NextResponse.json(
      {
        error: {
          code: "STRIPE_CHECKOUT_FAILED",
          message: "Could not start Stripe Checkout.",
        },
      },
      { status: 500 }
    );
  }
}

async function requireCheckoutClient(request: Request): Promise<CheckoutClient> {
  if (request.headers.get("authorization")) {
    const client: ApiClientContext = await requireApiClient(request);

    return {
      userId: client.userId,
      email: client.email,
      profileId: client.profile?.id || client.userId,
    };
  }

  const { user, profile } = await requireClientUser();

  return {
    userId: user.id,
    email: user.email ?? null,
    profileId: profile.id,
  };
}
