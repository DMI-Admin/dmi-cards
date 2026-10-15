import {after} from "next/server";
import {registerAutomaticBillingKick} from "@/lib/stripe/billing-work-auto-kick";
import {invoiceProofProductionOptions} from "@/lib/stripe/finance-invoice-proof-config";
import {billingWorkConfiguration} from "@/lib/stripe/billing-work-config";
import type {VerifiedWorkEvent} from "@/lib/stripe/billing-work-evidence";
import {handoffBillingWork} from "@/lib/stripe/billing-work-handoff";
import {createSupabaseAdminClient} from "@/lib/supabase-admin";
import { NextResponse } from "next/server";
import { constructStripeWebhookEvent } from "@/lib/stripe/config";
import {stripeWebhookModeDecision} from "@/lib/stripe/webhook-mode-guard";
import { handleStripeWebhookConsumers } from "@/lib/stripe/webhook-consumers";
import { logError, logInfo, safeErrorMetadata } from "@/lib/observability/logger";
import { requestIdFromRequest, withRequestIdHeader } from "@/lib/observability/request";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 90;

export async function POST(request: Request) {
  const invocationStartedAt = performance.now();
  const requestId = requestIdFromRequest(request);
  const route = "/api/stripe/webhook";
  const payload = await request.text();
  const signature = request.headers.get("stripe-signature");

  try {
    const event = constructStripeWebhookEvent({ payload, signature });
    const modeDecision = stripeWebhookModeDecision(event.livemode);
    if (modeDecision === "mode_mismatch") {
      // Acknowledge intentional rejection; never record, enqueue or kick it.
      return withRequestIdHeader(NextResponse.json(
        { received: true, handled: false, skipped: true, reason: "stripe_livemode_mismatch" },
        { status: 200 }
      ), requestId);
    }
    if (modeDecision !== "accepted") {
      // Configuration may be corrected; preserve Stripe's normal retry path.
      return withRequestIdHeader(NextResponse.json(
        { error: { code: "STRIPE_WEBHOOK_ENVIRONMENT_UNTRUSTED", message: "Stripe webhook runtime is not configured." } },
        { status: 503 }
      ), requestId);
    }
    const handoffConfig = billingWorkConfiguration("handoff");
    if (handoffConfig.state !== "disabled") {
      let confirmedAdmissions = 0;
      const handoff = await handoffBillingWork(event as unknown as VerifiedWorkEvent, handoffConfig, createSupabaseAdminClient, count => { confirmedAdmissions = count; });
      registerAutomaticBillingKick(after, confirmedAdmissions, invocationStartedAt);
      // Never expose event/partition identities or fall back to inline processing.
      return withRequestIdHeader(NextResponse.json(
        { received: handoff.state === "completed", applicable: handoff.applicable, terminal: handoff.terminal },
        { status: handoff.state === "completed" ? 200 : 500 }
      ), requestId);
    }
    const invoiceProofOptions = invoiceProofProductionOptions();
    const result = invoiceProofOptions
      ? await handleStripeWebhookConsumers(event, requestId, invocationStartedAt, invoiceProofOptions)
      : await handleStripeWebhookConsumers(event, requestId, invocationStartedAt);

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
