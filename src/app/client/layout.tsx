"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

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
