"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getCurrentProfile } from "@/lib/client-auth";

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<CallbackLoading />}>
      <AuthCallbackContent />
    </Suspense>
  );
}

function AuthCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let ignore = false;

    async function completeAuth() {
      const nextPath = normalizeSafeNextPath(searchParams.get("next"));
      const code = searchParams.get("code");
      const tokenHash = searchParams.get("token_hash");
      const type = searchParams.get("type");
      const email = searchParams.get("email") || "";
      let verifiedUserId: string | null = null;
      let verifiedEmail: string | null = email || null;
      const urlError =
        searchParams.get("error_description") ||
        searchParams.get("error") ||
        "";

      if (urlError) {
        console.error("[DMI auth] auth callback error", urlError);
        routeVerificationError(urlError, email);
        return;
      }

      try {
        console.log("[DMI auth] auth callback params", {
          nextPath,
          hasCode: Boolean(code),
          hasTokenHash: Boolean(tokenHash),
          type,
          email: email || null,
        });

        if (code) {
          const { data, error } = await supabase.auth.exchangeCodeForSession(code);

          console.log("[DMI auth] auth callback exchange", {
            error: error
              ? { name: error.name, message: error.message, status: error.status }
              : null,
            hasSession: Boolean(data.session),
            userId: data.user?.id || data.session?.user?.id || null,
            email: data.user?.email || data.session?.user?.email || null,
          });

          verifiedUserId = data.user?.id || data.session?.user?.id || null;
          verifiedEmail = data.user?.email || data.session?.user?.email || email || null;

          if (error) throw error;
        } else if (tokenHash && type) {
          const { data, error } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: normalizeOtpType(type),
          });

          console.log("[DMI auth] auth callback verify otp", {
            error: error
              ? { name: error.name, message: error.message, status: error.status }
              : null,
            hasSession: Boolean(data.session),
            userId: data.user?.id || data.session?.user?.id || null,
            email: data.user?.email || data.session?.user?.email || email || null,
            emailConfirmedAt: data.user?.email_confirmed_at || null,
          });

          verifiedUserId = data.user?.id || data.session?.user?.id || null;
          verifiedEmail = data.user?.email || data.session?.user?.email || email || null;

          if (error) throw error;
        } else {
          console.log("[DMI auth] auth callback no explicit token", {
            nextPath,
            note: "Checking for an existing session from URL hash handling.",
          });
        }

        const { session, sessionError } = await resolveVerifiedCallbackSession({
          requiresHostedSessionCheck: !code && !(tokenHash && type),
        });

        console.log("[DMI auth] auth callback session state", {
          error: sessionError
            ? { name: sessionError.name, message: sessionError.message }
            : null,
          hasSession: Boolean(session),
          userId: session?.user?.id || null,
          email: session?.user?.email || null,
          emailConfirmedAt: session?.user?.email_confirmed_at || null,
          verifiedUserId,
          verifiedEmail,
        });

        if (session?.user && isUserEmailVerified(session.user)) {
          await getCurrentProfile(session.user);
        } else if (session?.user) {
          throw new Error("Your email address has not been verified yet.");
        } else if (nextPath === "/email-verified" && !verifiedUserId) {
          throw new Error("Verification link is missing its confirmation token.");
        } else if (nextPath !== "/email-verified") {
          throw new Error("Verification link is missing its confirmation token.");
        }

        if (nextPath === "/email-verified") {
          const { error: signOutError } = await supabase.auth.signOut();
          console.log("[DMI auth] email verification signout", {
            error: signOutError
              ? { name: signOutError.name, message: signOutError.message, status: signOutError.status }
              : null,
          });
        }

        if (!ignore) {
          router.replace(nextPath);
        }
      } catch (error) {
        console.error("[DMI auth] auth callback failed", error);
        if (!ignore) {
          routeVerificationError(
            error instanceof Error
              ? error.message
              : "Could not complete email verification.",
            email
          );
        }
      }
    }

    function routeVerificationError(message: string, email: string) {
      if (nextIsEmailVerification(normalizeSafeNextPath(searchParams.get("next")))) {
        router.replace(
          `/email-verification-error?message=${encodeURIComponent(message)}${
            email ? `&email=${encodeURIComponent(email)}` : ""
          }`
        );
        return;
      }

      setErrorMessage(message);
    }

    void completeAuth();

    return () => {
      ignore = true;
    };
  }, [router, searchParams]);

  if (errorMessage) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#070B1A] px-6 text-white">
        <div className="max-w-md rounded-3xl border border-red-400/20 bg-red-500/10 p-6 text-center">
          <h1 className="text-xl font-semibold">Could not verify your login</h1>
          <p className="mt-3 text-sm leading-6 text-red-100/80">{errorMessage}</p>
          <Link
            href="/"
            className="mt-5 inline-flex rounded-2xl bg-[#AC00FF] px-5 py-3 text-sm font-semibold text-white"
          >
            Back to login
          </Link>
        </div>
      </main>
    );
  }

  return <CallbackLoading />;
}

function nextIsEmailVerification(nextPath: string | null) {
  return nextPath === "/email-verified";
}

function normalizeSafeNextPath(nextPath: string | null) {
  if (!nextPath) return "/client/dashboard";

  try {
    const decodedPath = decodeURIComponent(nextPath).trim();

    if (
      !decodedPath.startsWith("/") ||
      decodedPath.startsWith("//") ||
      decodedPath.includes("\\")
    ) {
      return "/client/dashboard";
    }

    return decodedPath;
  } catch {
    return "/client/dashboard";
  }
}

async function resolveVerifiedCallbackSession({
  requiresHostedSessionCheck,
}: {
  requiresHostedSessionCheck: boolean;
}) {
  const maxAttempts = requiresHostedSessionCheck ? 8 : 1;
  let sessionError: Error | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (attempt > 0) {
      await wait(150);
    }

    const {
      data: { session },
      error,
    } = await supabase.auth.getSession();

    sessionError = error || null;

    if (session?.user && isUserEmailVerified(session.user)) {
      return { session, sessionError };
    }

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError) {
      sessionError = userError;
    }

    if (user && isUserEmailVerified(user)) {
      return {
        session: session ?? {
          access_token: "",
          refresh_token: "",
          expires_in: 0,
          expires_at: 0,
          token_type: "bearer",
          user,
        },
        sessionError,
      };
    }
  }

  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  return { session, sessionError: error || sessionError };
}

function isUserEmailVerified(user: { email_confirmed_at?: string | null; confirmed_at?: string | null }) {
  return Boolean(user.email_confirmed_at || user.confirmed_at);
}

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function normalizeOtpType(type: string) {
  if (type === "signup" || type === "email") return "signup";
  if (type === "recovery") return "recovery";
  if (type === "invite") return "invite";
  if (type === "magiclink") return "magiclink";
  if (type === "email_change") return "email_change";
  return "signup";
}

function CallbackLoading() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#070B1A] px-6 text-white">
      <div className="rounded-3xl border border-white/10 bg-white/5 px-6 py-5 text-sm text-white/55">
        Completing verification...
      </div>
    </main>
  );
}
