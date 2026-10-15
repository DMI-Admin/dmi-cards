import { requireApiClient } from "@/lib/api/client-context";
import { requireBillingIdentity } from "@/lib/stripe/client-identity";
import { ApiRouteError, apiSuccess, apiError } from "@/lib/api/responses";
import { acknowledgeCheckout, verifiedProReady } from "@/lib/stripe/checkout-activation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
  try {
    const identity = await requireBillingIdentity(request);
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some(key => key !== "session_id") || params.getAll("session_id").length > 1) {
      throw new ApiRouteError(400, "INVALID_REQUEST", "This checkout link is not valid.");
    }
    if (params.has("session_id")) {
      return apiSuccess(await acknowledgeCheckout(identity.userId, params.get("session_id")!, request.signal), { headers });
    }
    const client = await requireApiClient(request);
    const ready = client.userId === identity.userId && await verifiedProReady(
      identity.userId, client.plan === "pro" && client.planSource === "stripe_billing", request.signal,
    );
    return apiSuccess({ proReady: ready }, { headers });
  } catch (error) {
    // Do not expose provider errors, checkout IDs or billing data.
    const response = error instanceof ApiRouteError
      ? apiError(error.status, error.code, error.message)
      : apiError(503, "INTERNAL_ERROR", "Could not check activation. Please try again.");
    for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
    return response;
  }
}
