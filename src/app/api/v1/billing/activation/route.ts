import { requireApiClient } from "@/lib/api/client-context";
import { requireBillingIdentity } from "@/lib/stripe/client-identity";
import { ApiRouteError, apiSuccess, apiError } from "@/lib/api/responses";
import { acknowledgeCheckout, verifiedProReady } from "@/lib/stripe/checkout-activation";
import { createBillingLatencyObserver, type LatencyEvent } from "@/lib/stripe/billing-latency-diagnostics";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
  const observe = createBillingLatencyObserver("activation");
  const started = performance.now();
  const emit = (event: LatencyEvent) => { try { observe?.(event); } catch { /* Timing cannot affect the response. */ } };
  const finish = (outcome: LatencyEvent["outcome"]) => emit({ stage: "activation_end", outcome, duration_ms: performance.now() - started });
  emit({ stage: "activation_start" });
  let phase: "acknowledgement" | "readiness" | undefined;
  let phaseStarted = started;
  try {
    const params = new URL(request.url).searchParams;
    const malformed = [...params.keys()].some(key => key !== "session_id") || params.getAll("session_id").length > 1;
    if (params.has("session_id") || malformed) {
      const identity = await requireBillingIdentity(request);
      if (malformed) throw new ApiRouteError(400, "INVALID_REQUEST", "This checkout link is not valid.");
      phase = "acknowledgement"; phaseStarted = performance.now();
      emit({ stage: "acknowledgement_start" });
      const result = await acknowledgeCheckout(identity.userId, params.get("session_id")!, request.signal);
      const outcome = result.paymentReceived ? "payment_acknowledged" : "payment_unconfirmed";
      emit({ stage: "acknowledgement_end", outcome, duration_ms: performance.now() - phaseStarted });
      finish(outcome);
      return apiSuccess(result, { headers });
    }
    phase = "readiness"; phaseStarted = performance.now();
    emit({ stage: "readiness_start" });
    // This context already validates the request's Bearer token with getUser.
    // Reuse that single verified identity; never accept a browser-supplied user.
    const client = await requireApiClient(request);
    const ready = await verifiedProReady(
      client.userId, client.plan === "pro" && client.planSource === "stripe_billing", request.signal,
    );
    const outcome = ready ? "pro_ready" : "pro_not_ready";
    emit({ stage: "readiness_end", outcome, duration_ms: performance.now() - phaseStarted });
    finish(outcome);
    return apiSuccess({ proReady: ready }, { headers });
  } catch (error) {
    if (phase) emit({ stage: phase === "acknowledgement" ? "acknowledgement_end" : "readiness_end", outcome: "safe_error", duration_ms: performance.now() - phaseStarted });
    finish("safe_error");
    // Do not expose provider errors, checkout IDs or billing data.
    const response = error instanceof ApiRouteError
      ? apiError(error.status, error.code, error.message)
      : apiError(503, "INTERNAL_ERROR", "Could not check activation. Please try again.");
    for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
    return response;
  }
}
