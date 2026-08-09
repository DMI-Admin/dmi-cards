import { NextResponse } from "next/server";
import { constructStripeWebhookEvent } from "@/lib/stripe/config";
import { handleStripeWebhookEvent } from "@/lib/stripe/webhook";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: Request) {
  const payload = await request.text();
  const signature = request.headers.get("stripe-signature");

  try {
    const event = constructStripeWebhookEvent({ payload, signature });
    const result = await handleStripeWebhookEvent(event);

    return NextResponse.json({
      received: true,
      handled: result.handled,
      skipped: Boolean(result.skipped),
    });
  } catch (error) {
    if (error instanceof Error && /signature|Stripe-Signature/i.test(error.message)) {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_STRIPE_SIGNATURE",
            message: "Invalid Stripe webhook signature.",
          },
        },
        { status: 400 }
      );
    }

    console.error("[DMI stripe] webhook handling failed", {
      name: error instanceof Error ? error.name : "UnknownError",
    });

    return NextResponse.json(
      {
        error: {
          code: "STRIPE_WEBHOOK_FAILED",
          message: "Stripe webhook could not be processed.",
        },
      },
      { status: 500 }
    );
  }
}
