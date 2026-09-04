import { NextResponse } from "next/server";
import { constructStripeWebhookEvent } from "@/lib/stripe/config";
import { handleStripeWebhookEvent } from "@/lib/stripe/webhook";
import { logError, logInfo, safeErrorMetadata } from "@/lib/observability/logger";
import { requestIdFromRequest, withRequestIdHeader } from "@/lib/observability/request";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: Request) {
  const requestId = requestIdFromRequest(request);
  const route = "/api/stripe/webhook";
  const payload = await request.text();
  const signature = request.headers.get("stripe-signature");

  try {
    const event = constructStripeWebhookEvent({ payload, signature });
    const result = await handleStripeWebhookEvent(event);

    logInfo({
      code: "STRIPE_WEBHOOK_PROCESSED",
      requestId,
      route,
      metadata: {
        eventId: event.id,
        eventType: event.type,
        handled: result.handled,
        skipped: Boolean(result.skipped),
        reason: result.reason || null,
      },
    });

    return withRequestIdHeader(
      NextResponse.json({
        received: true,
        handled: result.handled,
        skipped: Boolean(result.skipped),
        reason: result.reason || null,
      }),
      requestId
    );
  } catch (error) {
    if (error instanceof Error && /signature|Stripe-Signature/i.test(error.message)) {
      logInfo({
        code: "STRIPE_WEBHOOK_SIGNATURE_REJECTED",
        requestId,
        route,
      });

      return withRequestIdHeader(
        NextResponse.json(
          {
            error: {
              code: "INVALID_STRIPE_SIGNATURE",
              message: "Invalid Stripe webhook signature.",
            },
          },
          { status: 400 }
        ),
        requestId
      );
    }

    logError({
      code: "STRIPE_WEBHOOK_FAILED",
      requestId,
      route,
      metadata: safeErrorMetadata(error),
    });

    return withRequestIdHeader(
      NextResponse.json(
        {
          error: {
            code: "STRIPE_WEBHOOK_FAILED",
            message: "Stripe webhook could not be processed.",
          },
        },
        { status: 500 }
      ),
      requestId
    );
  }
}
