"use client";

import { useEffect, useState, type FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  BriefcaseBusiness,
  Check,
  LockKeyhole,
  Mail,
  Sparkles,
  UserRound,
} from "lucide-react";
import { FaApple, FaMicrosoft } from "react-icons/fa";
import { FcGoogle } from "react-icons/fc";
import { supabase } from "@/lib/supabase";
import { getOrCreateClientProfile } from "@/lib/profiles";

const plans = [
  {
    name: "Free",
    description: "Start with one polished public digital business card.",
    features: ["1 digital card", "Free Classic template", "QR code", "Public page"],
    selected: true,
  },
  {
    name: "Individual Pro",
    description: "Unlock advanced sharing, lead capture, and premium branding.",
    features: [
      "Premium templates",
      "Wallet",
      "Tap to Share",
      "Contacts",
      "Analytics",
      "Integrations",
    ],
  },
];

export default function ClientSignupPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [signupError, setSignupError] = useState("");
  const [signupMessage, setSignupMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

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

    if (!fullName.trim()) {
      setSignupError("Full name is required.");
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

    setSubmitting(true);

    console.log("[DMI auth] signup request", {
      email: email.trim(),
      fullName: fullName.trim(),
      projectUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    });

    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/client/dashboard`,
        data: {
          full_name: fullName.trim(),
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

    if (error) {
      setSignupError(error.message);
      setSubmitting(false);
      return;
    }

    if (data.user && data.session) {
      try {
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
      } catch (profileError) {
        setSignupError(
          profileError instanceof Error
            ? profileError.message
            : "Could not create your profile."
        );
        setSubmitting(false);
        return;
      }
    }

    if (!data.session) {
      console.log("[DMI auth] auth user", data.user
        ? {
            id: data.user.id,
            email: data.user.email,
          }
        : null);
      console.log("[DMI auth] session state", {
        page: "signup",
        event: "SIGNED_UP_WITHOUT_SESSION",
        hasSession: false,
        userId: data.user?.id || null,
        email: data.user?.email || email.trim(),
      });
      setSignupMessage(
        "Account created in Supabase Auth. Please confirm your email, then log in."
      );
      setSubmitting(false);
      return;
    }

    router.push("/client/dashboard");
  }

  function handleSocialSignup() {
    setSignupError("Social signup is not enabled yet. Please use email and password.");
  }

  return (
    <main className="min-h-screen bg-[#070B1A] text-white">
      <div className="grid min-h-screen lg:grid-cols-[minmax(0,0.8fr)_minmax(560px,0.7fr)]">
        <section className="relative hidden overflow-hidden border-r border-white/10 bg-[#0F0E38] p-12 lg:flex lg:flex-col lg:justify-between">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_24%_18%,rgba(172,0,255,0.24),transparent_32%),radial-gradient(circle_at_76%_28%,rgba(91,44,255,0.18),transparent_30%),linear-gradient(135deg,rgba(255,255,255,0.06),transparent_48%)]" />
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
                  <UserRound className="h-6 w-6" />
                </div>
                <h2 className="text-3xl font-bold">
                  Create your DMI Cards account
                </h2>
                <p className="mt-3 text-sm leading-6 text-white/50">
                  Start with a free digital business card and upgrade when
                  you&apos;re ready.
                </p>
              </div>

              <form onSubmit={handleSignup} className="space-y-6">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Full name" icon={UserRound}>
                    <input
                      value={fullName}
                      onChange={(event) => setFullName(event.target.value)}
                      placeholder="Full Name"
                      className="inputStyle"
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
                      required
                    />
                  </Field>
                </div>

                <section>
                  <div className="mb-3 flex items-center justify-between gap-4">
                    <h3 className="font-semibold">Choose your plan</h3>
                    <span className="rounded-full border border-green-400/20 bg-green-500/10 px-3 py-1 text-xs font-semibold text-green-100">
                      Selected: Free
                    </span>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    {plans.map((plan) => (
                      <PlanCard key={plan.name} {...plan} />
                    ))}
                  </div>
                </section>

                <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-start gap-4">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#AC00FF]/15 text-purple-200">
                        <BriefcaseBusiness className="h-5 w-5" />
                      </div>
                      <div>
                        <h3 className="font-semibold">Need cards for a team?</h3>
                        <p className="mt-1 text-sm leading-6 text-white/50">
                          Business and Enterprise onboarding will be handled by
                          the DMI Cards team.
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      className="inline-flex shrink-0 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white/70 transition hover:border-[#AC00FF]/45 hover:bg-[#AC00FF]/15 hover:text-white"
                    >
                      Contact Sales
                    </button>
                  </div>
                </div>

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
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#AC00FF] to-[#6C2CFF] px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-purple-500/25 transition hover:shadow-purple-400/35"
                >
                  {submitting ? "Creating account..." : "Create Account"}
                  <ArrowRight className="h-4 w-4" />
                </button>
              </form>

              <SocialLoginSection onSocialLogin={handleSocialSignup} />

              <div className="mt-6 flex flex-col gap-3 text-center text-sm text-white/45 sm:flex-row sm:items-center sm:justify-between">
                <Link href="/login" className="transition hover:text-purple-100">
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

      <div className="mt-5 grid gap-3 md:grid-cols-2">
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
          className="inline-flex w-full items-center justify-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white/65 transition hover:border-[#AC00FF]/45 hover:bg-[#AC00FF]/10 hover:text-white md:col-span-2"
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

function PlanCard({
  name,
  description,
  features,
  selected = false,
}: {
  name: string;
  description: string;
  features: string[];
  selected?: boolean;
}) {
  return (
    <button
      type="button"
      className={`rounded-3xl border p-5 text-left transition ${
        selected
          ? "border-[#AC00FF]/60 bg-[#AC00FF]/15 shadow-lg shadow-purple-500/15"
          : "border-white/10 bg-white/5 hover:border-[#AC00FF]/35 hover:bg-white/10"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold">{name}</h3>
          <p className="mt-2 text-sm leading-6 text-white/50">{description}</p>
        </div>
        {selected && (
          <span className="rounded-full bg-[#AC00FF] px-3 py-1 text-xs font-semibold text-white">
            Selected
          </span>
        )}
      </div>

      <div className="mt-5 space-y-2">
        {features.map((feature) => (
          <div key={feature} className="flex items-center gap-2 text-sm text-white/65">
            <Check className="h-4 w-4 shrink-0 text-purple-200" />
            <span>{feature}</span>
          </div>
        ))}
      </div>
    </button>
  );
}
