"use client";

import {
  BarChart3,
  Check,
  ContactRound,
  Palette,
  Plug,
  QrCode,
  ShieldCheck,
  Sparkles,
  SmartphoneNfc,
  X,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import styles from "@/components/UpgradeToProModal.module.css";
import { supabase } from "@/lib/supabase";

type BillingInterval = "monthly" | "annual";

type UpgradeToProModalProps = {
  open: boolean;
  onClose: () => void;
};

const pricing: Record<
  BillingInterval,
  {
    price: string;
    period: string;
    cta: string;
  }
> = {
  monthly: {
    price: "£5.99",
    period: "per month",
    cta: "Continue with Pro — £5.99/month",
  },
  annual: {
    price: "£59.99",
    period: "per year",
    cta: "Continue with Pro — £59.99/year",
  },
};

const benefits = [
  { label: "Contacts and lead capture", icon: ContactRound },
  { label: "Tap to Share", icon: SmartphoneNfc },
  { label: "Advanced analytics", icon: BarChart3 },
  { label: "CRM integrations", icon: Plug },
  { label: "Premium templates", icon: Sparkles },
  { label: "Advanced QR features", icon: QrCode },
  { label: "Custom colours and branding", icon: Palette },
];

export default function UpgradeToProModal({
  open,
  onClose,
}: UpgradeToProModalProps) {
  const [interval, setInterval] = useState<BillingInterval>("monthly");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const activePrice = pricing[interval];

  const selectedSavings = useMemo(
    () => (interval === "annual" ? "Save £11.89/year" : null),
    [interval]
  );

  function trapFocus(event: KeyboardEvent) {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
    );

    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  useEffect(() => {
    if (!open) return;

    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    window.setTimeout(() => {
      setErrorMessage("");
      closeButtonRef.current?.focus();
    }, 0);

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }

      if (event.key === "Tab") {
        trapFocus(event);
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      previousFocusRef.current?.focus?.();
    };
  }, [open, onClose]);

  async function startCheckout() {
    if (submitting) return;

    setSubmitting(true);
    setErrorMessage("");

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Please sign in again before upgrading to Pro.");
      }

      const response = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ interval }),
      });
      const payload = await response.json().catch(() => null);
      const checkoutUrl =
        typeof payload?.url === "string"
          ? payload.url
          : typeof payload?.data?.url === "string"
            ? payload.data.url
            : "";

      if (!response.ok || !checkoutUrl) {
        const message =
          typeof payload?.error?.message === "string"
            ? payload.error.message
            : "Checkout could not be started. Please try again.";
        throw new Error(message);
      }

      window.location.assign(checkoutUrl);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Checkout could not be started. Please try again."
      );
      setSubmitting(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[#02040D]/75 px-4 py-6 text-white backdrop-blur-md sm:px-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !submitting) {
          onClose();
        }
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="relative flex max-h-[min(92vh,48rem)] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-[#AC00FF]/35 bg-[#070B1A] shadow-2xl shadow-purple-950/50 ring-1 ring-white/10"
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-44 bg-[radial-gradient(circle_at_top_left,rgba(172,0,255,0.34),transparent_36%),radial-gradient(circle_at_top_right,rgba(108,44,255,0.22),transparent_34%)]" />
        <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto p-5 sm:p-7">
          <div className="flex items-start justify-between gap-4">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full border border-[#AC00FF]/40 bg-[#AC00FF]/15 px-3 py-1 text-xs font-bold uppercase tracking-[0.16em] text-purple-100">
                <Sparkles className="h-3.5 w-3.5" />
                Pro
              </span>
              <h2 id={titleId} className="mt-4 text-3xl font-bold tracking-normal sm:text-4xl">
                Individual Pro
              </h2>
              <p id={descriptionId} className="mt-2 text-sm leading-6 text-white/62 sm:text-base">
                Unlock the full DMI Cards experience.
              </p>
            </div>

            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-white/70 transition hover:border-[#AC00FF]/50 hover:bg-[#AC00FF]/15 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#AC00FF] disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Close upgrade modal"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="mt-7 grid gap-5 lg:grid-cols-[1fr_290px]">
            <div className="grid gap-3 sm:grid-cols-2">
              {benefits.map(({ label, icon: Icon }) => (
                <div
                  key={label}
                  className="flex min-h-16 items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3.5 shadow-lg shadow-black/10"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#AC00FF]/18 text-purple-100">
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="text-sm font-semibold leading-5 text-white/80">
                    {label}
                  </span>
                </div>
              ))}
            </div>

            <div className="rounded-3xl border border-[#AC00FF]/30 bg-[#0D1330]/90 p-4 shadow-xl shadow-purple-950/25">
              <div className="grid grid-cols-2 rounded-2xl border border-white/10 bg-black/25 p-1">
                {(["monthly", "annual"] as const).map((option) => {
                  const active = option === interval;
                  return (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setInterval(option)}
                      disabled={submitting}
                      aria-pressed={active}
                      className={`rounded-xl px-3 py-2.5 text-sm font-bold capitalize transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#AC00FF] disabled:cursor-not-allowed ${
                        active
                          ? "bg-gradient-to-r from-[#AC00FF] to-[#6C2CFF] text-white shadow-lg shadow-purple-500/25"
                          : "text-white/55 hover:bg-white/5 hover:text-white"
                      }`}
                    >
                      {option}
                    </button>
                  );
                })}
              </div>

              <div className="mt-5 min-h-[8.5rem] rounded-3xl border border-white/10 bg-white/[0.04] p-5">
                <div key={interval} className={styles.priceEnter}>
                  <p className="text-sm font-semibold uppercase tracking-[0.16em] text-purple-200">
                    Individual Pro
                  </p>
                  <p className="mt-3 text-4xl font-bold tracking-normal text-white">
                    {activePrice.price}
                  </p>
                  <p className="mt-1 text-sm font-medium text-white/55">
                    {activePrice.period}
                  </p>
                  {selectedSavings && (
                    <span className="mt-4 inline-flex rounded-full border border-emerald-300/30 bg-emerald-400/10 px-3 py-1 text-xs font-bold text-emerald-100">
                      {selectedSavings}
                    </span>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={startCheckout}
                disabled={submitting}
                className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#AC00FF] to-[#6C2CFF] px-5 py-3 text-sm font-bold text-white shadow-lg shadow-purple-500/25 transition hover:-translate-y-0.5 hover:shadow-purple-400/35 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#AC00FF] disabled:cursor-wait disabled:opacity-75 motion-reduce:transition-none"
              >
                {submitting ? "Preparing secure checkout..." : activePrice.cta}
              </button>

              <p className="mt-3 flex items-center justify-center gap-2 text-xs font-medium text-white/45">
                <ShieldCheck className="h-4 w-4 text-purple-200" />
                Secure checkout powered by Stripe
              </p>

              {errorMessage && (
                <p className="mt-3 rounded-2xl border border-red-400/25 bg-red-500/10 px-4 py-3 text-sm leading-6 text-red-100">
                  {errorMessage}
                </p>
              )}
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2 text-xs font-medium text-white/45">
            <Check className="h-4 w-4 text-purple-200" />
            Monthly and annual billing both unlock the same Pro features.
          </div>
        </div>
      </div>
    </div>
  );
}
