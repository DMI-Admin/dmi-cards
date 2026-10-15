"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Check, LoaderCircle, ShieldCheck } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { startActivationPolling, type ActivationState } from "@/lib/billing-activation-poller";

export default function BillingActivationPage() {
  const [state, setState] = useState<ActivationState>("checking");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // Query input is only an opaque lookup reference, never an entitlement.
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.getAll("session_id").length === 1 ? params.get("session_id") || "" : "";
    let checkoutUser: string | null = null;
    const read = async (path: string, signal: AbortSignal) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session || signal.aborted) throw new Error("Unavailable");
      if (checkoutUser && checkoutUser !== session.user.id) throw new Error("Unavailable");
      checkoutUser = session.user.id;
      const response = await fetch(path, {
        method: "GET", cache: "no-store", signal, referrerPolicy: "no-referrer",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const payload = await response.json();
      const { data: { session: current } } = await supabase.auth.getSession();
      if (!response.ok || current?.user.id !== session.user.id || signal.aborted) throw new Error("Unavailable");
      return payload.data;
    };
    return startActivationPolling({
      acknowledge: async signal => {
        if (!sessionId || params.has("checkout")) return false;
        return (await read(`/api/v1/billing/activation?session_id=${encodeURIComponent(sessionId)}`, signal))?.paymentReceived === true;
      },
      readReady: async signal => (await read("/api/v1/billing/activation", signal))?.proReady === true,
      onState: setState,
      // A full navigation refreshes the authenticated portal/provider as well
      // as Billing, avoiding a cached Free plan between the two pages.
      onReady: () => { window.location.replace("/client/billing"); },
    });
  }, [attempt]);

  const ready = state === "ready";
  const acknowledged = ["activating", "waiting", "ready"].includes(state);
  const paused = state === "waiting" || state === "unavailable";
  const heading = ready ? "You're Pro" : acknowledged ? "Payment successful" : "Finishing your upgrade";
  const description = ready ? "Your Individual Pro features are ready. Taking you to Billing…"
    : state === "waiting" ? "Your Pro account is still being activated. This normally only takes a moment."
    : state === "unavailable" ? "We couldn't confirm your upgrade just yet. Check again in a moment."
    : acknowledged ? "We're activating your Individual Pro account." : "We're securely confirming your checkout.";

  return (
    <main className="flex min-h-[85vh] items-center justify-center px-5 py-12">
      <section aria-labelledby="activation-heading" className="w-full max-w-lg rounded-3xl border border-[var(--dmi-border)] bg-[var(--dmi-surface)] p-7 shadow-xl sm:p-10">
        <div className="mb-9 flex items-center gap-3">
          <div className="rounded-xl bg-white p-2"><Image src="/dmi-cards-logo.svg" alt="" width={36} height={36} priority /></div>
          <span className="text-lg font-bold text-[var(--text-primary)]">DMI Cards</span>
        </div>
        <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-purple-500/15 text-purple-500">
          {ready ? <ShieldCheck size={30} aria-hidden="true" /> : <LoaderCircle size={30} className={paused ? "" : "motion-safe:animate-spin"} aria-hidden="true" />}
        </div>
        <div role="status" aria-live="polite" aria-atomic="true">
          <h1 id="activation-heading" className="text-3xl font-bold tracking-tight text-[var(--text-primary)]">{heading}</h1>
          <p className="mt-3 min-h-16 leading-7 text-[var(--dmi-muted)]">{description}</p>
        </div>
        <ol aria-label="Activation progress" className="my-8 space-y-5">
          {["Payment received", "Subscription confirmed", "Pro features activated"].map((label, index) => {
            const complete = ready || (index === 0 && acknowledged);
            return <li key={label} className="flex items-center gap-3 text-sm text-[var(--text-primary)]">
              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${complete ? "bg-emerald-500/15 text-emerald-500" : "bg-purple-500/10 text-[var(--dmi-muted)]"}`}>
                {complete ? <Check size={16} aria-hidden="true" /> : <span aria-hidden="true">{index + 1}</span>}
              </span>
              {complete ? label : index === 0 ? "Confirming payment" : index === 1 ? "Confirming your subscription" : "Activating Pro features"}
              <span className="sr-only">{complete ? " — complete" : " — pending"}</span>
            </li>;
          })}
        </ol>
        {paused && <button type="button" onClick={() => setAttempt(value => value + 1)} className="w-full rounded-xl bg-gradient-to-r from-[#AC00FF] to-[#6C2CFF] px-5 py-3 font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-purple-500">Check again</button>}
        {!ready && <Link href="/client/dashboard" className="mt-5 block text-center text-sm text-[var(--dmi-muted)] underline underline-offset-4">Return to Dashboard</Link>}
      </section>
    </main>
  );
}
