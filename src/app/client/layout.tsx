"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import {
  ClientAuthRequiredError,
  ClientSuspendedError,
  type CurrentClient,
  requireClientUser,
} from "@/lib/client-auth";
import { ClientMobileHeader } from "@/components/ClientSidebar";
import UpgradeToProProvider from "@/components/UpgradeToProProvider";
import { ClientPlanProvider, type InitialClientPlan } from "@/lib/use-client-plan";

export default function ClientPortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [checkingSession, setCheckingSession] = useState(true);
  const [initialClientPlan, setInitialClientPlan] =
    useState<InitialClientPlan | null>(null);

  useEffect(() => {
    let ignore = false;

    async function requireSession() {
      try {
        const client: CurrentClient = await requireClientUser();

        if (!ignore) {
          setInitialClientPlan({
            plan: client.plan,
            source: client.planSource,
          });
        }
      } catch (error) {
        if (ignore) return;

        if (error instanceof ClientAuthRequiredError) {
          console.log("[DMI auth] client layout redirect decision", {
            redirectDecision: "redirect-login-no-session",
          });
          router.replace("/");
          return;
        }

        if (error instanceof ClientSuspendedError) {
          console.log("[DMI auth] client layout redirect decision", {
            redirectDecision: "redirect-login-suspended",
          });
          router.replace("/?suspended=1");
          return;
        }

        console.error("Client auth/profile load failed", error);
      }

      if (ignore) return;
      console.log("[DMI auth] client layout redirect decision", {
        redirectDecision: "allow-client-portal",
      });
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
        router.replace("/");
      }
    });

    return () => {
      ignore = true;
      subscription.unsubscribe();
    };
  }, [router]);

  if (checkingSession || !initialClientPlan) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#070B1A] px-6 text-white">
        <div className="rounded-3xl border border-white/10 bg-white/5 px-6 py-5 text-sm text-white/55">
          Loading client portal...
        </div>
      </main>
    );
  }

  return (
    <div className="client-portal-root min-h-screen bg-[#070B1A]">
      <UpgradeToProProvider>
        <ClientPlanProvider initialPlan={initialClientPlan}>
          <ClientMobileHeader />
          {children}
        </ClientPlanProvider>
      </UpgradeToProProvider>
    </div>
  );
}
