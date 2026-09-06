"use client";

import { useEffect, useState, type FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Check,
  LockKeyhole,
  Mail,
  Sparkles,
  UserRound,
} from "lucide-react";
import { FaApple, FaMicrosoft } from "react-icons/fa";
import { FcGoogle } from "react-icons/fc";
import { buildAuthCallbackRedirectUrl } from "@/lib/auth-redirect";
import { supabase } from "@/lib/supabase";
import { getOrCreateClientProfile } from "@/lib/profiles";

const titleOptions = ["Mr", "Mrs", "Miss", "Ms", "Mx", "Dr", "Prof", "Sir", "Dame", "Lord", "Lady", "Other"];

type SocialAuthProvider = "google" | "apple";

function buildFullName(title: string, firstName: string, lastName: string) {
  return [title, firstName, lastName]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
}

export default function ClientSignupPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [createdEmail, setCreatedEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [signupError, setSignupError] = useState("");
  const [signupMessage, setSignupMessage] = useState("");
  const [verificationPending, setVerificationPending] = useState(false);
  const [accountExists, setAccountExists] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [startingSocialProvider, setStartingSocialProvider] =
    useState<SocialAuthProvider | null>(null);

  useEffect(() => {
    let pageWasHidden = false;

    function resetRestoredSocialAuthState() {
      setStartingSocialProvider(null);
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") {
        pageWasHidden = true;
        return;
      }

      if (pageWasHidden && document.visibilityState === "visible") {
        pageWasHidden = false;
        resetRestoredSocialAuthState();
      }
    }

    window.addEventListener("pageshow", resetRestoredSocialAuthState);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("pageshow", resetRestoredSocialAuthState);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      console.log("[DMI auth] session state", {
        page: "signup",
        event,
        hasSession: Boolean(session),
        userId: session?.user?.id || null,
        email: session?.user?.email || null,
      });
    });

    return () => subscription.unsubscribe();
  }, []);

  async function handleSignup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSignupError("");
    setSignupMessage("");
    setAccountExists(false);

    if (!firstName.trim() || !lastName.trim()) {
      setSignupError("First name and last name are required.");
      return;
    }

    if (password !== confirmPassword) {
      setSignupError("Passwords do not match.");
      return;
    }

    if (password.length < 6) {
      setSignupError("Password must be at least 6 characters.");
      return;
    }

    const signupEmail = email.trim();
    const fullName = buildFullName(title, firstName, lastName);
    const verificationRedirectUrl = buildAuthCallbackRedirectUrl("/client/dashboard");

    setSubmitting(true);

    try {
      console.log("[DMI auth] signup request", {
        email: signupEmail,
        title: title.trim() || null,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        fullName,
        emailRedirectTo: verificationRedirectUrl,
        projectUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
      });

      const { data, error } = await supabase.auth.signUp({
        email: signupEmail,
        password,
        options: {
          emailRedirectTo: verificationRedirectUrl,
          data: {
            title: title.trim(),
            first_name: firstName.trim(),
            last_name: lastName.trim(),
            full_name: fullName,
            subscription_plan: "free",
            plan: "free",
            account_type: "individual",
          },
        },
      });

      console.log("[DMI auth] signup result", {
        error: error ? { name: error.name, message: error.message, status: error.status } : null,
        hasUser: Boolean(data.user),
        hasSession: Boolean(data.session),
        user: data.user
          ? {
              id: data.user.id,
              email: data.user.email,
              metadata: data.user.user_metadata,
            }
          : null,
      });

      if (isAlreadyRegisteredError(error)) {
        setCreatedEmail(signupEmail);
        setAccountExists(true);
        setPassword("");
        setConfirmPassword("");
        return;
      }

      if (error) {
        setSignupError(error.message || "Could not create your account. Please check your details and try again.");
        return;
      }

      if (!data.user) {
        setSignupError("Supabase did not return an account confirmation. Please try again.");
        return;
      }

      if (isObfuscatedExistingUser(data.user)) {
        setCreatedEmail(signupEmail);
        setAccountExists(true);
        setPassword("");
        setConfirmPassword("");
        return;
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();

      console.log("[DMI auth] session state", {
        page: "signup",
        event: "AFTER_SIGNUP",
        hasSession: Boolean(session),
        userId: session?.user?.id || null,
        email: session?.user?.email || null,
      });

      if (data.session) {
        const profile = await getOrCreateClientProfile(data.user);
        console.log("[DMI auth] auth user", {
          id: data.user.id,
          email: data.user.email,
        });
        console.log("[DMI auth] signed in user", {
          id: data.user.id,
          email: data.user.email,
        });
        console.log("[DMI auth] loaded profile", profile);
        console.log("[DMI auth] mock fallback used", false);
      }

      if (data.session) {
        await supabase.auth.signOut();
      }

      console.log("[DMI auth] auth user", {
        id: data.user.id,
        email: data.user.email,
      });
      console.log("[DMI auth] session state", {
        page: "signup",
        event: "SIGNED_UP_VERIFY_EMAIL",
        hasSession: false,
        userId: data.user.id,
        email: data.user.email || signupEmail,
      });

      setCreatedEmail(signupEmail);
      setVerificationPending(true);
      setSignupMessage("");
      setPassword("");
      setConfirmPassword("");
    } catch (error) {
      console.error("[DMI auth] signup failed", error);
      setSignupError(
        error instanceof Error
          ? error.message
          : "Could not create your account. Please check your details and try again."
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGoogleSignup() {
    setSignupError("");
    setSignupMessage("");
    setAccountExists(false);
    setStartingSocialProvider("google");

    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: buildAuthCallbackRedirectUrl("/client/dashboard"),
        },
      });

      if (error) {
        console.error("[DMI auth] Google signup start failed", {
          name: error.name,
          message: error.message,
          status: error.status,
        });
        setSignupError("Could not start Google sign-up. Please try again.");
        setStartingSocialProvider(null);
      }
    } catch (error) {
      console.error("[DMI auth] Google signup start failed", error);
      setSignupError("Could not start Google sign-up. Please try again.");
      setStartingSocialProvider(null);
    }
  }

  async function handleAppleSignup() {
    setSignupError("");
    setSignupMessage("");
    setAccountExists(false);
    setStartingSocialProvider("apple");

    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "apple",
        options: {
          redirectTo: buildAuthCallbackRedirectUrl("/client/dashboard"),
        },
      });

      if (error) {
        console.error("[DMI auth] Apple signup start failed", {
          name: error.name,
          message: error.message,
          status: error.status,
        });
        setSignupError("Could not start Apple sign-up. Please try again.");
        setStartingSocialProvider(null);
      }
    } catch (error) {
      console.error("[DMI auth] Apple signup start failed", error);
      setSignupError("Could not start Apple sign-up. Please try again.");
      setStartingSocialProvider(null);
    }
  }

  function handleUnavailableSocialSignup() {
    setSignupError("Social signup is not enabled yet. Please use email and password.");
  }

  async function resendVerificationEmail() {
    const resendEmail = createdEmail || email.trim();

    if (!resendEmail) {
      setSignupError("Enter your email address to resend verification.");
      return;
    }

    setSignupError("");
    setSignupMessage("");
    setResending(true);

    try {
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: resendEmail,
        options: {
          emailRedirectTo: buildAuthCallbackRedirectUrl("/client/dashboard"),
        },
      });

      if (error) {
        throw error;
      }

      setSignupMessage("Verification email sent. Please check your inbox.");
    } catch (error) {
      console.error("[DMI auth] verification resend failed", error);
      setSignupError(
        error instanceof Error
          ? error.message
          : "Could not resend the verification email. Please try again."
      );
    } finally {
      setResending(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#070B1A] text-white">
      <AuthResourceHints />
      <div className="grid min-h-screen lg:grid-cols-[minmax(0,0.8fr)_minmax(560px,0.7fr)]">
        <section className="relative hidden overflow-hidden border-r border-white/10 bg-[#0F0E38] p-12 lg:flex lg:flex-col lg:justify-between">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_24%_18%,rgba(172,0,255,0.24),transparent_32%),radial-gradient(circle_at_76%_28%,rgba(91,44,255,0.18),transparent_30%),linear-gradient(135deg,rgba(255,255,255,0.06),transparent_48%)]" />
          <div className="relative">
            <div className="relative mb-8 h-24 w-24">
              <Image
                src="/dmi-cards-logo.svg"
                alt="DMI Cards Logo"
                fill
                sizes="96px"
                className="object-contain"
                priority
              />
            </div>

            <h1 className="max-w-2xl text-5xl font-bold leading-tight">
              Launch your DMI Cards profile in minutes.
            </h1>

            <p className="mt-6 max-w-xl text-lg leading-8 text-white/60">
              Create a digital business card, publish your public profile, and
              upgrade when you are ready for premium sharing tools.
            </p>
          </div>

          <div className="relative rounded-3xl border border-[#AC00FF]/25 bg-[#AC00FF]/10 p-6 shadow-2xl shadow-purple-950/25">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#AC00FF]/20">
                <Sparkles className="h-6 w-6 text-purple-100" />
              </div>
              <div>
                <h2 className="text-xl font-semibold">Free to start</h2>
                <p className="mt-2 text-sm leading-6 text-white/60">
                  Your first card includes a public page, QR code, and the Free
                  Classic template.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="flex items-center justify-center p-6 sm:p-10">
          <div className="w-full max-w-2xl">
            <div className="mb-8 flex flex-col items-center text-center lg:hidden">
              <div className="relative mb-4 h-20 w-20">
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

            <div className="rounded-3xl border border-white/10 bg-[#101935]/80 p-6 shadow-2xl shadow-purple-950/25">
              {verificationPending ? (
                <VerificationSuccess
                  email={createdEmail}
                  message={signupMessage}
                  error={signupError}
                  resending={resending}
                  onGoToLogin={() => router.push("/")}
                  onResend={resendVerificationEmail}
                />
              ) : (
              <>
              <div className="mb-5">
                <h2 className="text-3xl font-bold">
                  Create your DMI Cards account
                </h2>
                <p className="mt-3 text-sm leading-6 text-white/50">
                  Start with a free digital business card and upgrade when
                  you&apos;re ready.
                </p>
              </div>

              <form onSubmit={handleSignup} className="space-y-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Title" icon={UserRound}>
                    <select
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                      className="inputStyle"
                      autoComplete="honorific-prefix"
                    >
                      <option value="">Optional</option>
                      {titleOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <Field label="First name" icon={UserRound}>
                    <input
                      value={firstName}
                      onChange={(event) => setFirstName(event.target.value)}
                      placeholder="First name"
                      className="inputStyle"
                      autoComplete="given-name"
                      required
                    />
                  </Field>

                  <Field label="Last name" icon={UserRound}>
                    <input
                      value={lastName}
                      onChange={(event) => setLastName(event.target.value)}
                      placeholder="Last name"
                      className="inputStyle"
                      autoComplete="family-name"
                      required
                    />
                  </Field>

                  <Field label="Email address" icon={Mail}>
                    <input
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="you@company.com"
                      className="inputStyle"
                      autoComplete="email"
                      required
                    />
                  </Field>

                  <Field label="Password" icon={LockKeyhole}>
                    <input
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="Create a password"
                      className="inputStyle"
                      autoComplete="new-password"
                      required
                    />
                  </Field>

                  <Field label="Confirm password" icon={LockKeyhole}>
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      placeholder="Confirm password"
                      className="inputStyle"
                      autoComplete="new-password"
                      required
                    />
                  </Field>
                </div>

                {accountExists && (
                  <AccountAlreadyExistsInline
                    email={createdEmail || email.trim()}
                    onGoToLogin={() => router.push("/")}
                  />
                )}

                {signupError && (
                  <div className="rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
                    {signupError}
                  </div>
                )}

                {signupMessage && (
                  <div className="rounded-2xl border border-green-400/20 bg-green-500/10 px-4 py-3 text-sm text-green-100">
                    {signupMessage}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  className="dmi-gradient-primary inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#AC00FF] to-[#6C2CFF] px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-purple-500/25 transition hover:shadow-purple-400/35 [&_svg]:text-white"
                >
                  {submitting ? "Creating account..." : "Create Account"}
                  <ArrowRight className="h-4 w-4 text-white" />
                </button>
              </form>

              <SocialLoginSection
                onGoogleSignup={handleGoogleSignup}
                onAppleSignup={handleAppleSignup}
                startingProvider={startingSocialProvider}
                onUnavailableSocialSignup={handleUnavailableSocialSignup}
              />

              <div className="mt-5 flex flex-col gap-3 text-center text-sm text-white/45 sm:flex-row sm:items-center sm:justify-between">
                <Link href="/" className="transition hover:text-purple-100">
                  Already have an account? Log in
                </Link>
                <div className="flex justify-center gap-3">
                  <Link href="#" className="transition hover:text-purple-100">
                    Terms
                  </Link>
                  <span className="text-white/20">/</span>
                  <Link href="#" className="transition hover:text-purple-100">
                    Privacy
                  </Link>
                </div>
              </div>
              <p className="mt-4 text-center text-xs text-white/30">
                DMI Cards by DevMaster Inc
              </p>
              </>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function isAlreadyRegisteredError(error: { message?: string | null } | null) {
  return typeof error?.message === "string" && /already registered/i.test(error.message);
}

function isObfuscatedExistingUser(user: { identities?: unknown }) {
  return Array.isArray(user.identities) && user.identities.length === 0;
}

function AuthResourceHints() {
  return (
    <>
      <link rel="dns-prefetch" href="https://auth.dmicards.com" />
      <link rel="preconnect" href="https://auth.dmicards.com" />
      <link rel="dns-prefetch" href="https://accounts.google.com" />
      <link rel="preconnect" href="https://accounts.google.com" />
      <link rel="dns-prefetch" href="https://appleid.apple.com" />
      <link rel="preconnect" href="https://appleid.apple.com" />
    </>
  );
}

function SocialLoginSection({
  onGoogleSignup,
  onAppleSignup,
  startingProvider,
  onUnavailableSocialSignup,
}: {
  onGoogleSignup: () => void;
  onAppleSignup: () => void;
  startingProvider: SocialAuthProvider | null;
  onUnavailableSocialSignup: () => void;
}) {
  const isStartingGoogle = startingProvider === "google";
  const isStartingApple = startingProvider === "apple";
  const isStartingSocialAuth = Boolean(startingProvider);

  return (
    <div className="mt-5">
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-white/10" />
        <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/35">
          OR CONTINUE WITH
        </span>
        <div className="h-px flex-1 bg-white/10" />
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <button
          type="button"
          onClick={onGoogleSignup}
          disabled={isStartingSocialAuth}
          aria-busy={isStartingGoogle}
          className="inline-flex w-full items-center justify-center gap-3 rounded-2xl border border-white/20 bg-white px-4 py-3 text-sm font-semibold text-[#101935] shadow-lg shadow-white/5 transition hover:shadow-white/15 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isStartingGoogle ? (
            <Spinner className="border-[#101935]/25 border-t-[#101935]" />
          ) : (
            <FcGoogle className="h-5 w-5 shrink-0" />
          )}
          {isStartingGoogle ? "Connecting to Google..." : "Continue with Google"}
        </button>

        <button
          type="button"
          onClick={onAppleSignup}
          disabled={isStartingSocialAuth}
          aria-busy={isStartingApple}
          className="inline-flex w-full items-center justify-center gap-3 rounded-2xl border border-white/15 bg-black px-4 py-3 text-sm font-semibold text-white transition hover:border-white/30 hover:bg-black/80 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isStartingApple ? (
            <Spinner className="border-white/25 border-t-white" />
          ) : (
            <FaApple className="h-5 w-5 shrink-0" />
          )}
          {isStartingApple ? "Connecting to Apple..." : "Continue with Apple"}
        </button>

        <button
          type="button"
          onClick={onUnavailableSocialSignup}
          className="inline-flex w-full items-center justify-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white/65 transition hover:border-[#AC00FF]/45 hover:bg-[#AC00FF]/10 hover:text-white md:col-span-2"
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

function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`h-4 w-4 shrink-0 animate-spin rounded-full border-2 ${className}`}
    />
  );
}

function Field({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-white/45">
        <Icon className="h-3.5 w-3.5 text-purple-200" />
        {label}
      </span>
      {children}
    </label>
  );
}

function VerificationSuccess({
  email,
  message,
  error,
  resending,
  onGoToLogin,
  onResend,
}: {
  email: string;
  message: string;
  error: string;
  resending: boolean;
  onGoToLogin: () => void;
  onResend: () => void;
}) {
  return (
    <div className="text-center">
      <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-green-500/15 text-green-100">
        <Check className="h-7 w-7" />
      </div>
      <h2 className="text-3xl font-bold">
        Account created. Please check your email to verify your account before logging in.
      </h2>
      <p className="mx-auto mt-4 max-w-xl text-sm leading-6 text-white/55">
        We’ve sent a verification link to your email address. Open the link,
        then you’ll be taken to your DMI Cards dashboard.
      </p>
      {email && (
        <p className="mt-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/70">
          {email}
        </p>
      )}
      {message && (
        <div className="mt-5 rounded-2xl border border-green-400/20 bg-green-500/10 px-4 py-3 text-sm text-green-100">
          {message}
        </div>
      )}
      {error && (
        <div className="mt-5 rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
          {error}
        </div>
      )}
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
        <button
          type="button"
          onClick={onGoToLogin}
          className="inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#AC00FF] to-[#6C2CFF] px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-purple-500/25 transition hover:shadow-purple-400/35"
        >
          Go to login
          <ArrowRight className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onResend}
          disabled={resending}
          className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold text-white/70 transition hover:border-[#AC00FF]/45 hover:bg-[#AC00FF]/15 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          {resending ? "Sending..." : "Resend verification email"}
        </button>
      </div>
    </div>
  );
}

function AccountAlreadyExistsInline({
  email,
  onGoToLogin,
}: {
  email: string;
  onGoToLogin: () => void;
}) {
  const resetHref = email
    ? `/?forgot=1&email=${encodeURIComponent(email)}`
    : "/?forgot=1";

  return (
    <div className="rounded-3xl border border-amber-300/25 bg-amber-300/10 p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-base font-semibold text-amber-50">
            Account already exists
          </h3>
          <p className="mt-2 text-sm leading-6 text-amber-50/75">
            An account already exists for this email. Please sign in, or reset
            your password if you can&apos;t remember it.
          </p>
          {email && (
            <p className="mt-2 text-xs font-medium text-amber-50/55">{email}</p>
          )}
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:items-end">
          <button
            type="button"
            onClick={onGoToLogin}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#AC00FF] to-[#6C2CFF] px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-purple-500/25 transition hover:shadow-purple-400/35"
          >
            Go to login
            <ArrowRight className="h-4 w-4" />
          </button>
          <Link
            href={resetHref}
            className="inline-flex items-center justify-center rounded-2xl border border-amber-50/20 bg-amber-50/10 px-4 py-2.5 text-sm font-semibold text-amber-50/80 transition hover:bg-amber-50/15 hover:text-white"
          >
            Forgot password
          </Link>
        </div>
      </div>
    </div>
  );
}
