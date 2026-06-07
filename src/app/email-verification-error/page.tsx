"use client";

import { Suspense, useState, type FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { AlertCircle, Mail, RotateCw } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function EmailVerificationErrorPage() {
  return (
    <Suspense fallback={<VerificationErrorShell />}>
      <EmailVerificationErrorContent />
    </Suspense>
  );
}

function EmailVerificationErrorContent() {
  const searchParams = useSearchParams();
  const initialEmail = searchParams.get("email") || "";
  const reason = searchParams.get("message") || "";
  const [email, setEmail] = useState(initialEmail);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function resendVerification(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setSubmitting(true);

    try {
      await supabase.auth.resend({
        type: "signup",
        email: email.trim(),
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?next=/email-verified`,
        },
      });
      setMessage("If an account exists for this email, we’ve sent a new verification link.");
    } catch (error) {
      console.error("[DMI auth] verification resend failed", error);
      setMessage("If an account exists for this email, we’ve sent a new verification link.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <VerificationErrorShell>
      <div className="rounded-3xl border border-red-400/20 bg-[#101935]/80 p-7 text-center shadow-2xl shadow-purple-950/25">
        <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-500/15 text-red-100">
          <AlertCircle className="h-7 w-7" />
        </div>
        <h2 className="text-3xl font-bold">Email verification failed.</h2>
        <p className="mx-auto mt-4 max-w-sm text-sm leading-6 text-white/55">
          The verification link could not be completed. It may have expired or
          already been used. Request a new verification link, then try again.
        </p>
        {reason && (
          <p className="mt-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left text-xs leading-5 text-white/45">
            {reason}
          </p>
        )}

        <form onSubmit={resendVerification} className="mt-6 space-y-4 text-left">
          <label className="block">
            <span className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-white/45">
              <Mail className="h-3.5 w-3.5 text-purple-200" />
              Email
            </span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@company.com"
              autoComplete="email"
              className="inputStyle"
              required
            />
          </label>

          {message && (
            <div className="rounded-2xl border border-green-400/20 bg-green-500/10 px-4 py-3 text-sm leading-6 text-green-100">
              {message}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#AC00FF] to-[#6C2CFF] px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-purple-500/25 transition hover:shadow-purple-400/35 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RotateCw className="h-4 w-4" />
            {submitting ? "Sending..." : "Resend verification email"}
          </button>
        </form>

        <Link
          href="/login"
          className="mt-4 inline-flex w-full items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold text-white/65 transition hover:bg-white/10 hover:text-white"
        >
          Back to login
        </Link>
      </div>
    </VerificationErrorShell>
  );
}

function VerificationErrorShell({ children }: { children?: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-[#070B1A] text-white">
      <div className="grid min-h-screen lg:grid-cols-[minmax(0,0.9fr)_minmax(480px,0.6fr)]">
        <section className="relative hidden overflow-hidden border-r border-white/10 bg-[#0F0E38] p-12 lg:flex lg:flex-col lg:justify-between">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(172,0,255,0.22),transparent_32%),radial-gradient(circle_at_78%_18%,rgba(91,44,255,0.18),transparent_28%),linear-gradient(135deg,rgba(255,255,255,0.05),transparent_45%)]" />
          <div className="relative">
            <div className="relative mb-8 h-24 w-24">
              <Image
                src="/logo.png"
                alt="DevMaster Inc Logo"
                fill
                sizes="96px"
                className="object-contain"
                priority
              />
            </div>
            <p className="mb-6 text-xs font-semibold uppercase tracking-[0.35em] text-white/40">
              DevMaster Inc
            </p>
            <h1 className="max-w-2xl text-5xl font-bold leading-tight">
              Let’s get your email verified.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-white/60">
              Request a fresh link and return to login once your email has been
              confirmed.
            </p>
          </div>
        </section>

        <section className="flex items-center justify-center p-6 sm:p-10">
          <div className="w-full max-w-md">
            <div className="mb-8 flex flex-col items-center text-center lg:hidden">
              <div className="relative mb-4 h-20 w-20">
                <Image
                  src="/logo.png"
                  alt="DevMaster Inc Logo"
                  fill
                  sizes="80px"
                  className="object-contain"
                  priority
                />
              </div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-white/40">
                DMI Cards
              </p>
            </div>
            {children || (
              <div className="rounded-3xl border border-white/10 bg-[#101935]/80 p-7 text-center text-sm text-white/55">
                Loading verification details...
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
