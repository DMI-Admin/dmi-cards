"use client";

import { useState, type FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, LockKeyhole, Mail, Sparkles } from "lucide-react";
import { FaApple, FaMicrosoft } from "react-icons/fa";
import { FcGoogle } from "react-icons/fc";
import { supabase } from "@/lib/supabase";
import { getOrCreateClientProfile } from "@/lib/profiles";

export default function ClientLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginError("");
    setSubmitting(true);

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error) {
      setLoginError(error.message);
      setSubmitting(false);
      return;
    }

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      setLoginError(userError?.message || "Could not load signed-in user.");
      setSubmitting(false);
      return;
    }

    try {
      const profile = await getOrCreateClientProfile(user);
      console.log("[DMI auth] signed in user", user);
      console.log("[DMI auth] loaded profile", profile);
      console.log("[DMI auth] mock fallback used", false);
    } catch (profileError) {
      setLoginError(
        profileError instanceof Error
          ? profileError.message
          : "Could not load your profile."
      );
      setSubmitting(false);
      return;
    }

    const nextPath = new URLSearchParams(window.location.search).get("next");
    router.push(nextPath || "/client/dashboard");
  }

  function handleSocialLogin() {
    setLoginError("Social login is not enabled yet. Please use email and password.");
  }

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
              DMI Cards Client Portal
            </h1>

            <p className="mt-6 max-w-xl text-lg leading-8 text-white/60">
              Access your digital business card dashboard, manage your public
              card, download QR codes, preview wallet passes, and track leads.
            </p>
          </div>

          <div className="relative grid gap-4 sm:grid-cols-3">
            <InfoCard label="Cards" value="Public profiles" />
            <InfoCard label="Sharing" value="QR, Wallet, Tap" />
            <InfoCard label="Leads" value="Contacts & analytics" />
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

            <div className="rounded-3xl border border-white/10 bg-[#101935]/80 p-7 shadow-2xl shadow-purple-950/25">
              <div className="mb-8">
                <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[#AC00FF]/15 text-purple-100">
                  <Sparkles className="h-6 w-6" />
                </div>
                <h2 className="text-3xl font-bold">Welcome back</h2>
                <p className="mt-3 text-sm leading-6 text-white/50">
                  Access your digital business card dashboard.
                </p>
              </div>

              <form onSubmit={handleLogin} className="space-y-4">
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
                    className="inputStyle"
                    required
                  />
                </label>

                <label className="block">
                  <span className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-white/45">
                    <LockKeyhole className="h-3.5 w-3.5 text-purple-200" />
                    Password
                  </span>
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Enter your password"
                    className="inputStyle"
                    required
                  />
                </label>

                <div className="flex items-center justify-between gap-4 text-sm">
                  <Link
                    href="#"
                    className="text-white/45 transition hover:text-purple-100"
                  >
                    Forgot password?
                  </Link>
                  <Link
                    href="/signup"
                    className="text-[#DFA7FF] transition hover:text-white"
                  >
                    Create account
                  </Link>
                </div>

                {loginError && (
                  <div className="rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
                    {loginError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#AC00FF] to-[#6C2CFF] px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-purple-500/25 transition hover:shadow-purple-400/35"
                >
                  {submitting ? "Logging in..." : "Login"}
                  <ArrowRight className="h-4 w-4" />
                </button>
              </form>

              <SocialLoginSection onSocialLogin={handleSocialLogin} />
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

function SocialLoginSection({
  onSocialLogin,
}: {
  onSocialLogin: () => void;
}) {
  return (
    <div className="mt-7">
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-white/10" />
        <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/35">
          OR CONTINUE WITH
        </span>
        <div className="h-px flex-1 bg-white/10" />
      </div>

      <div className="mt-5 grid gap-3">
        <button
          type="button"
          onClick={onSocialLogin}
          className="inline-flex w-full items-center justify-center gap-3 rounded-2xl border border-white/20 bg-white px-4 py-3 text-sm font-semibold text-[#101935] shadow-lg shadow-white/5 transition hover:shadow-white/15"
        >
          <FcGoogle className="h-5 w-5 shrink-0" />
          Continue with Google
        </button>

        <button
          type="button"
          onClick={onSocialLogin}
          className="inline-flex w-full items-center justify-center gap-3 rounded-2xl border border-white/15 bg-black px-4 py-3 text-sm font-semibold text-white transition hover:border-white/30 hover:bg-black/80"
        >
          <FaApple className="h-5 w-5 shrink-0" />
          Continue with Apple
        </button>

        <button
          type="button"
          onClick={onSocialLogin}
          className="inline-flex w-full items-center justify-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white/65 transition hover:border-[#AC00FF]/45 hover:bg-[#AC00FF]/10 hover:text-white"
        >
          <FaMicrosoft className="h-5 w-5 shrink-0 text-[#2F6FED]" />
          Continue with Microsoft
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-white/45">
            Coming Soon
          </span>
        </button>
      </div>

      <p className="mt-5 text-center text-xs text-white/35">
        Secure authentication powered by DMI Cards.
      </p>
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/35">
        {label}
      </p>
      <p className="mt-3 text-lg font-semibold">{value}</p>
    </div>
  );
}
