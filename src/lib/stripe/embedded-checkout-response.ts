import "server-only";
import type Stripe from "stripe";
import { ApiRouteError } from "@/lib/api/responses";
import { isStripeBillingInterval } from "./billing-state";

// Only fixed presentation data leaves the authenticated API. The provider
// object, metadata, customer and original exceptions are never serialized.
export function embeddedCheckoutResponse(session: Stripe.Checkout.Session, publishableKey: string) {
  const interval = session.metadata?.billing_interval;
  if (!/^cs_(?:test_|live_)?[A-Za-z0-9]{1,240}$/.test(session.id) || !isStripeBillingInterval(interval || "")) {
    throw new ApiRouteError(409, "CONFLICT", "This checkout is unavailable. Please return to Billing.");
  }
  const base = { sessionId: session.id, interval };
  if (session.status === "complete") return {
    ...base, kind: session.payment_status === "paid" ? "complete" as const : "processing" as const,
  };
  if (session.status === "expired") return { ...base, kind: "expired" as const };
  if (session.status === "open" && session.ui_mode === "embedded_page" && session.client_secret) {
    return { ...base, kind: "embedded" as const, clientSecret: session.client_secret, publishableKey };
  }
  if (session.status === "open" && (!session.ui_mode || session.ui_mode === "hosted_page") && session.url) {
    const url = new URL(session.url);
    if (url.protocol === "https:" && !url.username && !url.password) return { ...base, kind: "hosted" as const, url: url.href };
  }
  throw new ApiRouteError(409, "CONFLICT", "This checkout is unavailable. Please return to Billing.");
}
