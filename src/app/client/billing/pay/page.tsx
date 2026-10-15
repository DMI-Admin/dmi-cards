"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Check, LockKeyhole } from "lucide-react";
import EmbeddedPayment from "@/components/EmbeddedPayment";
import { supabase } from "@/lib/supabase";
import { activationReturnUrl, paymentCheckout, paymentPageInput, type PaymentCheckout, type CheckoutInterval } from "@/lib/embedded-checkout-client";

const endpoint = "/api/v1/billing/checkout/embedded";

export default function BillingPaymentPage() {
  const [checkout, setCheckout] = useState<PaymentCheckout | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [interval, setInterval] = useState<CheckoutInterval | null>(null);
  // Share initialization across React's effect probe. Never blindly retry a
  // Session-creating POST. Explicit retry re-enters the same server fences.
  const initialization = useRef<Promise<PaymentCheckout> | null>(null);
  const owner = useRef<string | null>(null);
  useEffect(() => {
    let disposed = false;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!disposed && owner.current && session?.user.id !== owner.current) {
        disposed = true;
        setCheckout(null);
        setError(true);
      }
    });
    async function initialize() {
      const input = paymentPageInput(window.location.search);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Unavailable");
      owner.current = session.user.id;
      const read = async (path: string, options: RequestInit = {}) => {
        const { data: { session: before } } = await supabase.auth.getSession();
        if (before?.user.id !== session!.user.id) throw new Error("Unavailable");
        const response = await fetch(path, {
          ...options, cache: "no-store", referrerPolicy: "no-referrer",
          headers: { Authorization: `Bearer ${before.access_token}`, ...(options.body ? { "Content-Type": "application/json" } : {}) },
        });
        const body = await response.json();
        const { data: { session: after } } = await supabase.auth.getSession();
        if (!response.ok || after?.user.id !== session!.user.id) throw new Error("Unavailable");
        return body.data;
      };
      if ("sessionId" in input) return paymentCheckout(await read(`${endpoint}?session_id=${encodeURIComponent(input.sessionId)}`));
      const config = await read(endpoint);
      if (config?.available !== true) return { kind: "disabled" } as const;
      return paymentCheckout(await read(endpoint, { method: "POST", body: JSON.stringify({ interval: input.interval }) }));
    }
    initialization.current ||= initialize();
    void initialization.current.then(result => {
      if (disposed) return;
      if (result.kind === "complete") { window.location.assign(activationReturnUrl(result.sessionId)); return; }
      if (result.kind === "hosted") { window.location.assign(result.url); return; }
      if (result.kind !== "disabled") {
        setInterval(result.interval);
        // Persist only the opaque Session reference in the URL, never its
        // client secret. Refresh/back now resume, including after flag rollback.
        window.history.replaceState(null, "", `/client/billing/pay?session_id=${encodeURIComponent(result.sessionId)}`);
      }
      setCheckout(result);
    }).catch(() => { if (!disposed) setError(true); });
    return () => { disposed = true; subscription.unsubscribe(); };
  }, [attempt]);

  return <main className="mx-auto grid min-h-[85vh] max-w-6xl items-start gap-7 px-5 py-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:py-16">
    <section aria-labelledby="payment-heading" className="rounded-3xl border border-[var(--dmi-border)] bg-[var(--dmi-surface)] p-7 sm:p-9">
      <div className="mb-10 flex items-center gap-3">
        <div className="rounded-xl bg-white p-2"><Image src="/dmi-cards-logo.svg" alt="" width={36} height={36} priority /></div>
        <span className="text-lg font-bold text-[var(--text-primary)]">DMI Cards</span>
      </div>
      <p className="mb-3 text-sm font-semibold text-purple-500">Your next chapter</p>
      <h1 id="payment-heading" className="text-3xl font-bold text-[var(--text-primary)]">Individual Pro</h1>
      <p className="mt-5 text-4xl font-bold text-[var(--text-primary)]">{interval ? <>{interval === "annual" ? "£59.99" : "£5.99"}<span className="text-base font-normal text-[var(--dmi-muted)]"> / {interval === "annual" ? "year" : "month"}</span></> : <span className="text-base text-[var(--dmi-muted)]">Confirming your plan…</span>}</p>
      <p className="mt-3 text-sm leading-6 text-[var(--dmi-muted)]">Your final total, including any promotion, appears in secure checkout.</p>
      <ul className="my-9 space-y-4 text-sm text-[var(--text-primary)]">
        {["Contacts and lead capture", "Tap to Share", "Advanced analytics", "Premium templates and custom branding"].map(label => <li key={label} className="flex items-center gap-3"><Check size={17} className="shrink-0 text-purple-500" aria-hidden="true" />{label}</li>)}
      </ul>
      <Link href="/client/billing" className="text-sm text-[var(--dmi-muted)] underline underline-offset-4">Return to Billing</Link>
    </section>
    <section aria-label="Secure payment" className="rounded-3xl border border-[var(--dmi-border)] bg-[var(--dmi-surface)] p-5 sm:p-7">
      <div className="mb-6 flex items-center gap-2 text-sm text-[var(--dmi-muted)]"><LockKeyhole size={17} aria-hidden="true" />Secure payment powered by Stripe</div>
      {error ? <div role="alert"><p className="text-[var(--text-primary)]">We couldn&apos;t open your checkout. Your payment details are safe.</p>
        <button type="button" className="mt-5 rounded-xl bg-[#8C16EB] px-5 py-3 font-semibold text-white" onClick={() => { initialization.current = null; setError(false); setAttempt(value => value + 1); }}>Try again</button></div>
        : checkout?.kind === "embedded" ? <EmbeddedPayment {...checkout} />
        : checkout?.kind === "disabled" ? <p role="status" className="leading-7 text-[var(--dmi-muted)]">Please return to Billing and choose Pro to continue with our secure hosted checkout.</p>
        : checkout?.kind === "processing" ? <div role="status" className="leading-7 text-[var(--dmi-muted)]">Your payment is still being confirmed. You don&apos;t need to pay again.<button type="button" className="mt-5 block rounded-xl border border-[var(--dmi-border)] px-5 py-3" onClick={() => { initialization.current = null; setAttempt(value => value + 1); }}>Check again</button></div>
        : checkout?.kind === "expired" ? <p role="status" className="leading-7 text-[var(--dmi-muted)]">This checkout has expired. Return to Billing to start again.</p>
        : <p role="status" className="text-[var(--dmi-muted)]">Preparing your secure checkout…</p>}
    </section>
  </main>;
}
