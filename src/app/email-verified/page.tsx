"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Sparkles } from "lucide-react";

export default function EmailVerifiedPage() {
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
              Your DMI Cards account is ready.
            </h1>

            <p className="mt-6 max-w-xl text-lg leading-8 text-white/60">
              Return to login to access your dashboard and start managing your
              digital business card.
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

            <div className="rounded-3xl border border-white/10 bg-[#101935]/80 p-7 text-center shadow-2xl shadow-purple-950/25">
              <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-green-500/15 text-green-100">
                <CheckCircle2 className="h-7 w-7" />
              </div>
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-white/45">
                <Sparkles className="h-3.5 w-3.5 text-purple-200" />
                Verified
              </div>
              <h2 className="text-3xl font-bold">Your email has been verified.</h2>
              <p className="mx-auto mt-4 max-w-sm text-sm leading-6 text-white/55">
                You can now log in to your DMI Cards account.
              </p>
              <Link
                href="/login"
                className="mt-7 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#AC00FF] to-[#6C2CFF] px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-purple-500/25 transition hover:shadow-purple-400/35"
              >
                Go to login
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>

            <p className="mt-8 text-center text-xs text-white/30">
              Powered by DevMaster Inc
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
