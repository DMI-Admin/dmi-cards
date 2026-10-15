import { requireBillingIdentity } from "@/lib/stripe/client-identity";
import { ApiRouteError, apiSuccess, apiError } from "@/lib/api/responses";
import { embeddedCheckoutEnabled, embeddedCheckoutEnvironment, embeddedCheckoutRuntimeMatches } from "@/lib/stripe/embedded-checkout-config";
import { createStripeCheckoutSession, readOwnedCheckoutSession } from "@/lib/stripe/checkout";
import { embeddedCheckoutResponse } from "@/lib/stripe/embedded-checkout-response";
import { isStripeBillingInterval, stripePriceForCheckoutPlan } from "@/lib/stripe/billing-state";
import { billingRuntime } from "@/lib/stripe/reliability";

export const dynamic = "force-dynamic";
export const revalidate = 0;
const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
async function runtime() {
  const r = await billingRuntime();
  if (!embeddedCheckoutRuntimeMatches(r.scope, r.live)) throw new ApiRouteError(403, "FORBIDDEN", "Checkout unavailable.");
  return r;
}
function failure(error: unknown) {
  // Never log provider exceptions or include their messages in a response that
  // might contain a Session capability. Known errors expose fixed copy only.
  const status = error instanceof ApiRouteError ? error.status : 503;
  const response = apiError(status, status === 401 ? "UNAUTHENTICATED" : "INVALID_REQUEST",
    status === 401 ? "Please sign in to continue." : "Could not open secure checkout. Please return to Billing or try again.");
  for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
  return response;
}

export async function GET(request: Request) {
  try {
    const user = await requireBillingIdentity(request);
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some(key => key !== "session_id") || params.getAll("session_id").length > 1) {
      throw new ApiRouteError(400, "INVALID_REQUEST", "Invalid request.");
    }
    if (!params.has("session_id")) return apiSuccess({ available: embeddedCheckoutEnabled() }, { headers });
    // Disabling new creation must not strand an already issued embedded Session.
    // Resumption still requires all exact deployment/account/test-key guards.
    const config = embeddedCheckoutEnvironment();
    if (!config) throw new ApiRouteError(403, "FORBIDDEN", "Checkout unavailable.");
    if (!/^cs_(?:test_|live_)?[A-Za-z0-9]{1,240}$/.test(params.get("session_id")!)) throw new ApiRouteError(400, "INVALID_REQUEST", "Invalid request.");
    const session = await readOwnedCheckoutSession(user.userId, params.get("session_id")!, await runtime());
    return apiSuccess(embeddedCheckoutResponse(session, config.publishableKey), { headers });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    const user = await requireBillingIdentity(request);
    const config = embeddedCheckoutEnvironment();
    if (!config || !embeddedCheckoutEnabled()) throw new ApiRouteError(403, "FORBIDDEN", "Checkout unavailable.");
    if (new URL(request.url).search || (request.headers.get("origin") && request.headers.get("origin") !== config.origin)) {
      throw new ApiRouteError(400, "INVALID_REQUEST", "Invalid request.");
    }
    const text = await request.text();
    if (text.length > 1024) throw new ApiRouteError(400, "INVALID_REQUEST", "Invalid request.");
    let body: unknown;
    try { body = JSON.parse(text); } catch { throw new ApiRouteError(400, "INVALID_REQUEST", "Invalid request."); }
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        Object.keys(body).length !== 1 || !("interval" in body) ||
        typeof body.interval !== "string" || !isStripeBillingInterval(body.interval)) {
      throw new ApiRouteError(400, "INVALID_REQUEST", "Invalid request.");
    }
    const priceId = stripePriceForCheckoutPlan("pro", body.interval);
    if (!priceId) throw new ApiRouteError(503, "INTERNAL_ERROR", "Checkout unavailable.");
    const session = await createStripeCheckoutSession({
      userId: user.userId, profileId: user.profileId, email: user.email,
      plan: "pro", billingInterval: body.interval, priceId, presentation: "embedded",
      returnUrl: `${config.origin}/client/billing/pay?session_id={CHECKOUT_SESSION_ID}`,
    }, await runtime());
    return apiSuccess(embeddedCheckoutResponse(session, config.publishableKey), { headers });
  } catch (error) { return failure(error); }
}
