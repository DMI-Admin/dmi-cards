"use client";

import { useEffect, useState, type FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, LockKeyhole, Mail, X } from "lucide-react";
import { FaApple, FaMicrosoft } from "react-icons/fa";
import { FcGoogle } from "react-icons/fc";
import { buildAuthCallbackRedirectUrl, buildAuthRedirectUrl } from "@/lib/auth-redirect";
import { supabase } from "@/lib/supabase";
import { getOrCreateClientProfile } from "@/lib/profiles";
import { getCurrentClientAccountStatus } from "@/lib/client-auth";
import styles from "./ClientLogin.module.css";

export default function ClientLogin() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState(() =>
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("suspended") === "1"
      ? "This account has been suspended. Please contact DMI Cards support."
      : ""
  );
  const [resetEmail, setResetEmail] = useState(() =>
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("forgot") === "1"
      ? new URLSearchParams(window.location.search).get("email") || ""
      : ""
  );
  const [resetMessage, setResetMessage] = useState("");
  const [showResetModal, setShowResetModal] = useState(
    () =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("forgot") === "1"
  );
  const [submitting, setSubmitting] = useState(false);
  const [resetSubmitting, setResetSubmitting] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    if (params.get("forgot") === "1") {
      window.history.replaceState(null, "", "/");
    }
  }, []);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      console.log("[DMI auth] session state", {
        page: "login",
        event,
        hasSession: Boolean(session),
        userId: session?.user?.id || null,
        email: session?.user?.email || null,
      });
    });

    return () => subscription.unsubscribe();
  }, []);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginError("");
    setSubmitting(true);

    console.log("[DMI auth] login request", {
      email: email.trim(),
      projectUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    });

    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    console.log("[DMI auth] login result", {
      error: error
        ? { name: error.name, message: error.message, status: error.status }
        : null,
      hasUser: Boolean(data.user),
      hasSession: Boolean(data.session),
      user: data.user
        ? {
            id: data.user.id,
            email: data.user.email,
          }
        : null,
    });

    if (error) {
      setLoginError(getFriendlyLoginError(error));
      setSubmitting(false);
      return;
    }

    const {
      data: { session },
    } = await supabase.auth.getSession();

    console.log("[DMI auth] session state", {
      page: "login",
      event: "AFTER_LOGIN",
      hasSession: Boolean(session),
      userId: session?.user?.id || null,
      email: session?.user?.email || null,
    });

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    console.log(
      "[DMI auth] auth user",
      user
        ? {
            id: user.id,
            email: user.email,
          }
        : null
    );

    if (userError || !user) {
      setLoginError(userError?.message || "Could not load signed-in user.");
      setSubmitting(false);
      return;
    }

    try {
      const statusBeforeProvisioning = await getCurrentClientAccountStatus(user.id);

      console.log("[DMI auth] login status decision", {
        authenticatedUserId: user.id,
        email: user.email || null,
        clientId: statusBeforeProvisioning.clientId,
        clientStatus: statusBeforeProvisioning.clientStatus,
        clientUserId: statusBeforeProvisioning.clientUserId,
        clientUserStatus: statusBeforeProvisioning.clientUserStatus,
        redirectDecision: statusBeforeProvisioning.isSuspended
          ? "sign-out-and-stay-login"
          : "continue-login",
      });

      if (statusBeforeProvisioning.isSuspended) {
        await supabase.auth.signOut();
        setLoginError(
          "This account has been suspended. Please contact DMI Cards support."
        );
        setSubmitting(false);
        return;
      }

      const profile = await getOrCreateClientProfile(user);
      const statusAfterProvisioning = await getCurrentClientAccountStatus(user.id);

      console.log("[DMI auth] login post-provision status decision", {
        authenticatedUserId: user.id,
        email: user.email || null,
        clientId: statusAfterProvisioning.clientId,
        clientStatus: statusAfterProvisioning.clientStatus,
        clientUserId: statusAfterProvisioning.clientUserId,
        clientUserStatus: statusAfterProvisioning.clientUserStatus,
        redirectDecision: statusAfterProvisioning.isSuspended
          ? "sign-out-and-stay-login"
          : "allow-dashboard",
      });

      if (statusAfterProvisioning.isSuspended) {
        await supabase.auth.signOut();
        setLoginError(
          "This account has been suspended. Please contact DMI Cards support."
        );
        setSubmitting(false);
        return;
      }

      console.log("[DMI auth] signed in user", {
        id: user.id,
        email: user.email,
      });
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

    const nextPath = safeNextPath(
      new URLSearchParams(window.location.search).get("next")
    );
    router.push(nextPath);
  }

  async function handleGoogleLogin() {
    setLoginError("");

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: buildAuthCallbackRedirectUrl("/client/dashboard"),
      },
    });

    if (error) {
      console.error("[DMI auth] Google login start failed", {
        name: error.name,
        message: error.message,
        status: error.status,
      });
      setLoginError("Could not start Google sign-in. Please try again.");
    }
  }

  function handleUnavailableSocialLogin() {
    setLoginError("Social login is not enabled yet. Please use email and password.");
  }

  async function handlePasswordReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginError("");
    setResetMessage("");
    setResetSubmitting(true);

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(resetEmail.trim(), {
        redirectTo: buildAuthRedirectUrl("/auth/reset-password"),
      });

      if (error) {
        console.error("[DMI auth] password reset request failed", {
          name: error.name,
          message: error.message,
          status: error.status,
        });
      }

      setResetMessage(
        "If an account exists for this email, we’ve sent password reset instructions."
      );
    } catch (error) {
      console.error("[DMI auth] password reset request failed", error);
      setResetMessage(
        "If an account exists for this email, we’ve sent password reset instructions."
      );
    } finally {
      setResetSubmitting(false);
    }
  }

  return (
    <main className="min-h-dvh overflow-x-hidden bg-[#070B1A] text-white">
      <div className="grid min-h-dvh lg:h-dvh lg:grid-cols-[minmax(0,0.9fr)_minmax(460px,0.6fr)] lg:overflow-hidden">
        <section className="relative hidden overflow-hidden border-r border-white/10 bg-[#0F0E38] p-8 lg:flex lg:flex-col lg:justify-center lg:gap-10 xl:p-12">
          <div className={styles.brandAurora} />
          <div className={styles.brandAuroraAccent} />
          <div className="relative">
            <div className="relative mb-7 h-20 w-20 xl:h-24 xl:w-24">
              <Image
                src="/dmi-cards-logo.svg"
                alt="DMI Cards Logo"
                fill
                sizes="96px"
                className="object-contain"
                priority
              />
            </div>

            <h1 className="max-w-2xl text-4xl font-bold leading-tight xl:text-5xl">
              DMI Cards Client Portal
            </h1>

            <p className="mt-5 max-w-xl text-base leading-7 text-white/62 xl:text-lg xl:leading-8">
              Access your digital business card dashboard, manage your public
              card, download QR codes, preview wallet passes, and track leads.
            </p>
          </div>

          <div className="relative grid gap-3 xl:grid-cols-3 xl:gap-4">
            <InfoCard label="Cards" value="Public profiles" />
            <InfoCard label="Sharing" value="QR, Wallet, Tap" />
            <InfoCard label="Leads" value="Contacts & analytics" />
          </div>
        </section>

        <section className="flex min-h-dvh items-center justify-center p-5 sm:p-8 lg:min-h-0 lg:p-8">
          <div className="w-full max-w-md">
            <div className="mb-6 flex flex-col items-center text-center lg:hidden">
              <div className="relative mb-3 h-16 w-16">
                <Image
                  src="/dmi-cards-logo.svg"
                  alt="DMI Cards Logo"
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

            <div className="rounded-3xl border border-white/10 bg-[#101935]/80 p-6 shadow-2xl shadow-purple-950/25 sm:p-7">
              <div className="mb-6 text-center">
                <h2 className="text-3xl font-bold">Welcome</h2>
                <p className="mx-auto mt-2 max-w-xs text-sm leading-6 text-white/50">
                  Access your digital business card dashboard.
                </p>
              </div>

              {!showResetModal ? (
                <>
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
                        autoComplete="username"
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
                        autoComplete="current-password"
                        className="inputStyle"
                        required
                      />
                    </label>

                    <div className="flex items-center justify-between gap-4 text-sm">
                      <button
                        type="button"
                        onClick={() => {
                          setShowResetModal(true);
                          setResetEmail(email);
                          setResetMessage("");
                        }}
                        className="text-white/45 transition hover:text-purple-100"
                      >
                        Forgot password?
                      </button>
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
                      className="dmi-gradient-primary mt-2 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#AC00FF] to-[#6C2CFF] px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-purple-500/25 transition hover:shadow-purple-400/35 [&_svg]:text-white"
                    >
                      {submitting ? "Logging in..." : "Login"}
                      <ArrowRight className="h-4 w-4 text-white" />
                    </button>
                  </form>

                  <SocialLoginSection
                    onGoogleLogin={handleGoogleLogin}
                    onUnavailableSocialLogin={handleUnavailableSocialLogin}
                  />
                </>
              ) : (
                <PasswordResetModal
                  email={resetEmail}
                  message={resetMessage}
                  submitting={resetSubmitting}
                  onEmailChange={setResetEmail}
                  onClose={() => {
                    setShowResetModal(false);
                    setResetMessage("");
                  }}
                  onSubmit={handlePasswordReset}
                />
              )}
            </div>

            <p className="mt-4 text-center text-xs text-white/30">
              DMI Cards by DevMaster Inc
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}

function getFriendlyLoginError(error: { message?: string }) {
  const message = error.message || "";

  if (/invalid login credentials/i.test(message)) {
    return "Email or password is incorrect.";
  }

  return message || "Could not log in. Please try again.";
}

function PasswordResetModal({
  email,
  message,
  submitting,
  onEmailChange,
  onClose,
  onSubmit,
}: {
  email: string;
  message: string;
  submitting: boolean;
  onEmailChange: (value: string) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="rounded-3xl border border-white/10 bg-[#070B1A]/70 p-5 shadow-2xl shadow-black/30">
      <div className="w-full text-white">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold">Reset your password</h2>
            <p className="mt-3 text-sm leading-6 text-white/50">
              Enter your email address and we’ll send you password reset
              instructions.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-white/55 transition hover:bg-white/10 hover:text-white"
            aria-label="Close password reset"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <label className="block">
            <span className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-white/45">
              <Mail className="h-3.5 w-3.5 text-purple-200" />
              Email
            </span>
            <input
              type="email"
              value={email}
              onChange={(event) => onEmailChange(event.target.value)}
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

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold text-white/65 transition hover:bg-white/10 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="dmi-gradient-primary inline-flex items-center justify-center rounded-2xl bg-gradient-to-r from-[#AC00FF] to-[#6C2CFF] px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-purple-500/25 transition hover:shadow-purple-400/35 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "Sending..." : "Send reset instructions"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function SocialLoginSection({
  onGoogleLogin,
  onUnavailableSocialLogin,
}: {
  onGoogleLogin: () => void;
  onUnavailableSocialLogin: () => void;
}) {
  return (
    <div className="mt-6">
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-white/10" />
        <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/35">
          OR CONTINUE WITH
        </span>
        <div className="h-px flex-1 bg-white/10" />
      </div>

      <div className="mt-4 grid gap-3">
        <button
          type="button"
          onClick={onGoogleLogin}
          className="inline-flex w-full items-center justify-center gap-3 rounded-2xl border border-white/20 bg-white px-4 py-3 text-sm font-semibold text-[#101935] shadow-lg shadow-white/5 transition hover:shadow-white/15"
        >
          <FcGoogle className="h-5 w-5 shrink-0" />
          Continue with Google
        </button>

        <button
          type="button"
          onClick={onUnavailableSocialLogin}
          className="inline-flex w-full items-center justify-center gap-3 rounded-2xl border border-white/15 bg-black px-4 py-3 text-sm font-semibold text-white transition hover:border-white/30 hover:bg-black/80"
        >
          <FaApple className="h-5 w-5 shrink-0" />
          Continue with Apple
        </button>

        <button
          type="button"
          onClick={onUnavailableSocialLogin}
          className="inline-flex w-full items-center justify-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white/65 transition hover:border-[#AC00FF]/45 hover:bg-[#AC00FF]/10 hover:text-white"
        >
          <FaMicrosoft className="h-5 w-5 shrink-0 text-[#2F6FED]" />
          Continue with Microsoft
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-white/45">
            Coming Soon
          </span>
        </button>
      </div>
    </div>
  );
}

function safeNextPath(nextPath: string | null) {
  if (!nextPath) {
    return "/client/dashboard";
  }

  if (!nextPath.startsWith("/") || nextPath.startsWith("//")) {
    return "/client/dashboard";
  }

  try {
    const nextUrl = new URL(nextPath, window.location.origin);

    if (nextUrl.origin !== window.location.origin) {
      return "/client/dashboard";
    }

    return `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
  } catch {
    return "/client/dashboard";
  }
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm xl:p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/35">
        {label}
      </p>
      <p className="mt-2 text-base font-semibold xl:mt-3 xl:text-lg">{value}</p>
    </div>
  );
}
