import { requireApiClient } from "@/lib/api/client-context";
import {
  ApiRouteError,
  apiErrorFromUnknown,
  apiSuccess,
} from "@/lib/api/responses";
import {
  isCheckoutBillingPlan,
  isStripeBillingInterval,
  stripePriceForCheckoutPlan,
} from "@/lib/stripe/billing-state";
import { createStripeCheckoutSession } from "@/lib/stripe/checkout";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type CheckoutRequestBody = {
  plan?: unknown;
  billing_interval?: unknown;
};

export async function POST(request: Request) {
  try {
    const client = await requireApiClient(request);
    const body = await parseCheckoutRequestBody(request);
    const plan = typeof body.plan === "string" ? body.plan : "";
    const billingInterval =
      typeof body.billing_interval === "string" ? body.billing_interval : "";

    if (!isCheckoutBillingPlan(plan)) {
      throw new ApiRouteError(
        400,
        "INVALID_REQUEST",
        "Self-service checkout is available for Pro only."
      );
    }

    if (!isStripeBillingInterval(billingInterval)) {
      throw new ApiRouteError(
        400,
        "INVALID_REQUEST",
        "A valid billing interval is required."
      );
    }

    const priceId = stripePriceForCheckoutPlan(plan, billingInterval);

    if (!priceId) {
      throw new ApiRouteError(
        500,
        "INTERNAL_ERROR",
        "Stripe checkout is not configured for this plan."
      );
    }

    const origin = new URL(request.url).origin;
    const session = await createStripeCheckoutSession({
      userId: client.userId,
      email: client.email,
      plan,
      billingInterval,
      priceId,
      successUrl: `${origin}/client/billing?checkout=success`,
      cancelUrl: `${origin}/client/billing?checkout=cancelled`,
    });

    return apiSuccess({
      checkoutSessionId: session.id,
      url: session.url,
      plan,
      billing_interval: billingInterval,
    });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

async function parseCheckoutRequestBody(
  request: Request
): Promise<CheckoutRequestBody> {
  try {
    const value = await request.json();
    return isRecord(value) ? value : {};
  } catch {
    throw new ApiRouteError(
      400,
      "INVALID_REQUEST",
      "Request body must be valid JSON."
    );
  }
}

function isRecord(value: unknown): value is CheckoutRequestBody {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
