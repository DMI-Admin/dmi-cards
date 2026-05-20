"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { ClientAuthRequiredError, requireClientUser } from "@/lib/client-auth";

export default function ClientPortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    let ignore = false;

    async function requireSession() {
      try {
        await requireClientUser();
      } catch (error) {
        if (ignore) return;

        if (error instanceof ClientAuthRequiredError) {
          router.replace(`/login?next=${encodeURIComponent(pathname)}`);
          return;
        }

        console.error("Client auth/profile load failed", error);
      }

      if (ignore) return;
      setCheckingSession(false);
    }

    void requireSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      console.log("[DMI auth] session state", {
        page: "client-layout",
        event,
        hasSession: Boolean(session),
        userId: session?.user?.id || null,
        email: session?.user?.email || null,
      });

      if (event === "SIGNED_OUT") {
        router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      } else if (!ignore) {
        setCheckingSession(false);
      }
    });

    return () => {
      ignore = true;
      subscription.unsubscribe();
    };
  }, [pathname, router]);

  if (checkingSession) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#070B1A] px-6 text-white">
        <div className="rounded-3xl border border-white/10 bg-white/5 px-6 py-5 text-sm text-white/55">
          Loading client portal...
        </div>
      </main>
    );
  }

  return children;
}
