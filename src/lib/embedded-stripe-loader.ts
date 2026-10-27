import { loadStripe } from "@stripe/stripe-js/pure";
import { checkoutStartupObserver } from "@/lib/checkout-startup-timing";

// Page-owned, never global: no Session, secret, storage or billing API here.
// Rejections resolve to null immediately so a failed POST cannot leave an
// unhandled loader rejection. The payment component retains its safe error UI.
export function createEmbeddedStripeLoader(publishableKey: string, observe?: ReturnType<typeof checkoutStartupObserver>) {
  const started = performance.now();
  let completed: number | undefined;
  let responseAt: number | undefined;
  const report = () => {
    if (completed === undefined || responseAt === undefined) return;
    observe?.("stripe_js_overlap", Math.max(0, Math.min(completed, responseAt) - started));
    observe?.("stripe_js_remaining_after_session", Math.max(0, completed - responseAt));
  };
  const promise = Promise.resolve().then(() => loadStripe(publishableKey)).catch(() => null).then(stripe => {
    completed = performance.now();
    observe?.("stripe_js_load", completed - started);
    report();
    return stripe;
  });
  return { publishableKey, promise, sessionResponded() { responseAt ??= performance.now(); report(); } };
}
export type EmbeddedStripeLoader = ReturnType<typeof createEmbeddedStripeLoader>;
