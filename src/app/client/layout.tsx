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
        data: { user },
      } = await supabase.auth.getUser();

      if (ignore) return;

      if (!user) {
        router.replace(`/login?next=${encodeURIComponent(pathname)}`);
        return;
      }

      try {
        const profile = await getOrCreateClientProfile(user);
        console.log("[DMI auth] signed in user", user);
        console.log("[DMI auth] loaded profile", profile);
        console.log("[DMI auth] mock fallback used", false);
      } catch (error) {
        console.error("Client profile load failed", error);
      }

      setCheckingSession(false);
    }

    void requireSession();

    return () => {
      ignore = true;
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
