"use client";

import { useEffect, useRef, useState } from "react";
import { loadStripe } from "@stripe/stripe-js/pure";
import type { StripeEmbeddedCheckout } from "@stripe/stripe-js";
import { activationReturnUrl } from "@/lib/embedded-checkout-client";

export default function EmbeddedPayment({ sessionId, clientSecret, publishableKey }: {
  sessionId: string; clientSecret: string; publishableKey: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const lifecycle = useRef<Promise<void>>(Promise.resolve());
  const [status, setStatus] = useState<"loading" | "mounted" | "error">("loading");
  useEffect(() => {
    let disposed = false;
    let checkout: StripeEmbeddedCheckout | undefined;
    const destroy = () => { try { checkout?.destroy(); } catch { /* Teardown is best-effort; never log SDK data. */ } checkout = undefined; };
    // Pure loader avoids loading third-party scripts until an authenticated,
    // guarded API has returned this owner's Session. No analytics callbacks.
    // Serialize teardown/initialization, including React's Strict Mode probe.
    lifecycle.current = lifecycle.current.then(async () => {
      try {
        if (disposed) return;
        const stripe = await loadStripe(publishableKey);
        if (disposed) return;
        if (!stripe) throw new Error("Unavailable");
        checkout = await stripe.createEmbeddedCheckoutPage({
          clientSecret,
          onComplete: () => {
            if (!disposed) window.location.assign(activationReturnUrl(sessionId));
          },
        });
        if (disposed) { destroy(); return; }
        if (!container.current) throw new Error("Unavailable");
        checkout.mount(container.current);
        setStatus("mounted");
      } catch {
        destroy();
        if (!disposed) setStatus("error");
      }
    });
    return () => { disposed = true; destroy(); };
  }, [sessionId, clientSecret, publishableKey]);
  return <div>
    {status === "loading" && <p role="status" className="mb-5 text-sm text-[var(--dmi-muted)]">Loading secure payment…</p>}
    {status === "error" && <p role="alert" className="mb-5 text-sm text-[var(--dmi-muted)]">Secure payment could not load. Return to Billing, then reopen your checkout to try again.</p>}
    <div ref={container} className={status === "error" ? "hidden" : "min-h-96"} />
  </div>;
}
