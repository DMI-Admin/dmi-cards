"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight, LockKeyhole, Sparkles } from "lucide-react";
import { supabase } from "@/lib/supabase";

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<ResetLoading />}>
      <ResetPasswordContent />
    </Suspense>
  );
}

function ResetPasswordContent() {
  const searchParams = useSearchParams();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [ready, setReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [resetComplete, setResetComplete] = useState(false);

  useEffect(() => {
    let ignore = false;

    async function prepareRecoverySession() {
      setErrorMessage("");

      try {
        const code = searchParams.get("code");

        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        } else if (typeof window !== "undefined" && window.location.hash) {
          const hashParams = new URLSearchParams(window.location.hash.slice(1));
          const accessToken = hashParams.get("access_token");
          const refreshToken = hashParams.get("refresh_token");

          if (accessToken && refreshToken) {
            const { error } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            });
            if (error) throw error;
          }
        }

        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!ignore) {
          if (session) {
            setReady(true);
          } else {
            setErrorMessage(
              "This password reset link is invalid or has expired. Please request a new reset email."
            );
          }
        }
      } catch (error) {
        console.error("[DMI auth] password reset session failed", error);
        if (!ignore) {
          setErrorMessage(
            "This password reset link is invalid or has expired. Please request a new reset email."
          );
        }
      }
    }

    void prepareRecoverySession();

    return () => {
      ignore = true;
    };
  }, [searchParams]);

  async function handlePasswordUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    setStatusMessage("");

    if (password !== confirmPassword) {
      setErrorMessage("Passwords do not match.");
      return;
    }

    if (password.length < 6) {
      setErrorMessage("Password must be at least 6 characters.");
      return;
    }

    setSubmitting(true);

    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      console.error("[DMI auth] password update failed", error);
      setErrorMessage("Could not update your password. Please request a new reset email.");
      setSubmitting(false);
      return;
    }

    await supabase.auth.signOut();
    setResetComplete(true);
    setStatusMessage("Your password has been updated successfully.");
    setSubmitting(false);
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
              Reset your DMI Cards password.
            </h1>

            <p className="mt-6 max-w-xl text-lg leading-8 text-white/60">
              Choose a new password, then return to the client portal login.
            </p>
          </div>
        </section>

        <section className="flex items-center justify-center p-6 sm:p-10">
          <div className="w-full max-w-md">
            <div className="rounded-3xl border border-white/10 bg-[#101935]/80 p-7 shadow-2xl shadow-purple-950/25">
              <div className="mb-8">
                <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[#AC00FF]/15 text-purple-100">
                  <Sparkles className="h-6 w-6" />
                </div>
                <h2 className="text-3xl font-bold">Create new password</h2>
                <p className="mt-3 text-sm leading-6 text-white/50">
                  Enter and confirm your new password below.
                </p>
              </div>

              {resetComplete ? (
                <div className="space-y-5">
                  <div className="rounded-2xl border border-green-400/20 bg-green-500/10 px-4 py-3 text-sm text-green-100">
                    {statusMessage}
                  </div>
                  <Link
                    href="/login"
                    className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#AC00FF] to-[#6C2CFF] px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-purple-500/25 transition hover:shadow-purple-400/35"
                  >
                    Back to login
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              ) : (
                <form onSubmit={handlePasswordUpdate} className="space-y-4">
                  <label className="block">
                    <span className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-white/45">
                      <LockKeyhole className="h-3.5 w-3.5 text-purple-200" />
                      New password
                    </span>
                    <input
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="Enter your new password"
                      className="inputStyle"
                      required
                    />
                  </label>

                  <label className="block">
                    <span className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-white/45">
                      <LockKeyhole className="h-3.5 w-3.5 text-purple-200" />
                      Confirm password
                    </span>
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      placeholder="Confirm your new password"
                      className="inputStyle"
                      required
                    />
                  </label>

                  {errorMessage && (
                    <div className="rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
                      {errorMessage}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={!ready || submitting}
                    className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#AC00FF] to-[#6C2CFF] px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-purple-500/25 transition hover:shadow-purple-400/35 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {submitting ? "Updating..." : "Update password"}
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </form>
              )}
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

function ResetLoading() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#070B1A] px-6 text-white">
      <div className="rounded-3xl border border-white/10 bg-white/5 px-6 py-5 text-sm text-white/55">
        Preparing password reset...
      </div>
    </main>
  );
}
