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
      const nextPath = searchParams.get("next") || "/client/dashboard";
      const code = searchParams.get("code");
      const urlError =
        searchParams.get("error_description") ||
        searchParams.get("error") ||
        "";

      if (urlError) {
        console.error("[DMI auth] auth callback error", urlError);
        setErrorMessage(urlError);
        return;
      }

      try {
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

          if (error) throw error;
        }

        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();

        console.log("[DMI auth] auth callback session state", {
          error: sessionError
            ? { name: sessionError.name, message: sessionError.message }
            : null,
          hasSession: Boolean(session),
          userId: session?.user?.id || null,
          email: session?.user?.email || null,
        });

        if (session?.user) {
          await getCurrentProfile(session.user);
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
          setErrorMessage(
            error instanceof Error
              ? error.message
              : "Could not complete email verification."
          );
        }
      }
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
            href="/login"
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

function CallbackLoading() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#070B1A] px-6 text-white">
      <div className="rounded-3xl border border-white/10 bg-white/5 px-6 py-5 text-sm text-white/55">
        Completing verification...
      </div>
    </main>
  );
}
