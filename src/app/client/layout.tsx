"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getOrCreateClientProfile } from "@/lib/profiles";

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
      const {
        data: { session },
      } = await supabase.auth.getSession();

      console.log("[DMI auth] session state", {
        page: "client-layout",
        event: "INITIAL_CHECK",
        hasSession: Boolean(session),
        userId: session?.user?.id || null,
        email: session?.user?.email || null,
      });

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (ignore) return;

      if (!user) {
        router.replace(`/login?next=${encodeURIComponent(pathname)}`);
        return;
      }

      try {
        const profile = await getOrCreateClientProfile(user);
        console.log("[DMI auth] auth user", {
          id: user.id,
          email: user.email,
        });
        console.log("[DMI auth] signed in user", {
          id: user.id,
          email: user.email,
        });
        console.log("[DMI auth] loaded profile", profile);
        console.log("[DMI auth] mock fallback used", false);
      } catch (error) {
        console.error("Client profile load failed", error);
      }

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

      if (event === "SIGNED_OUT" || !session) {
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
