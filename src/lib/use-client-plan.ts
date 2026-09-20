"use client";

import { createContext, createElement, useContext, useMemo, useState, useCallback, useEffect, useRef, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { isPaidPlan, type DmiPlan } from "@/lib/entitlements";
import { resolveEffectiveClientPlan, type EffectiveClientPlanResult } from "@/lib/entitlements/plan-resolver";
import { supabase } from "@/lib/supabase";

type ClientPlanSource = EffectiveClientPlanResult["source"];
export type ClientPlanState = {
  plan: DmiPlan | null;
  isPaid: boolean;
  loading: boolean;
  error: string;
  status: "auth_loading" | "billing_loading" | "ready" | "error";
  source: ClientPlanSource | null;
  billing?: EffectiveClientPlanResult["billing"];
};
export type InitialClientPlan = { plan: DmiPlan; source: ClientPlanSource };
type ClientPlanContextValue = ClientPlanState & { refreshVersion: number; refreshPlan: () => Promise<ClientPlanState> };
const ClientPlanContext = createContext<ClientPlanContextValue | null>(null);
const unavailable: ClientPlanState = { plan: null, isPaid: false, loading: false, error: "", status: "auth_loading", source: null };

export function ClientPlanProvider({ children, initialPlan }: { children: ReactNode; initialPlan?: InitialClientPlan | null }) {
  const [state, setState] = useState<ClientPlanState>(() => initialPlan
    ? { ...unavailable, ...initialPlan, isPaid: isPaidPlan(initialPlan.plan), status: "ready" }
    : { ...unavailable, loading: true });
  const request = useRef(0);
  const identity = useRef<string | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const pathname = usePathname();
  const refreshPlan = useCallback(async () => {
    const version = ++request.current;
    // A background refresh must not turn a resolved plan into a transient Free
    // plan or unmount active editors when a native file picker returns focus.
    // Failure and the next authoritative result still replace the cached state.
    setState(current => current.status === "ready" && current.plan !== "enterprise"
      ? current
      : { ...unavailable, loading: true, status: "billing_loading" });
    let next: ClientPlanState;
    try {
      const result = await resolveEffectiveClientPlan();
      next = { ...unavailable, ...result, isPaid: isPaidPlan(result.plan), status: "ready" };
    } catch (error) {
      next = { ...unavailable, status: "error", error: error instanceof Error ? error.message : "Could not refresh feature access." };
    }
    if (version === request.current) {
      setState(next);
      if (next.status === "ready") setRefreshVersion(current => current + 1);
    }
    return next;
  }, []);

  // Initial mount and navigation refresh from the protected endpoint.
  useEffect(() => {
    const timer = window.setTimeout(() => { void refreshPlan(); }, 0);
    return () => { window.clearTimeout(timer); request.current += 1; };
  }, [pathname, refreshPlan]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { void refreshPlan(); }, 100);
    };
    const visible = () => { if (document.visibilityState === "visible") schedule(); };
    window.addEventListener("focus", schedule);
    document.addEventListener("visibilitychange", visible);
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      const nextIdentity = session?.user.id ?? null;
      const sameIdentity = nextIdentity !== null && identity.current === nextIdentity;
      identity.current = nextIdentity;
      if (event === "SIGNED_OUT" || event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        request.current += 1;
        setState(current => sameIdentity && event !== "SIGNED_OUT" && current.status === "ready" && current.plan !== "enterprise"
          ? current
          : { ...unavailable });
        if (event === "SIGNED_OUT") clearTimeout(timer);
        else schedule(); // Never await Supabase calls inside its auth callback.
      }
    });
    return () => {
      clearTimeout(timer); subscription.unsubscribe(); request.current += 1;
      window.removeEventListener("focus", schedule);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [refreshPlan]);

  // One refresh at the known period boundary; no polling or local downgrade rule.
  useEffect(() => {
    const end = Date.parse(state.billing?.currentPeriodEnd || "");
    const delay = end - Date.now() + 1500;
    if (!Number.isFinite(delay) || delay <= 0 || delay > 2147483647) return;
    const timer = window.setTimeout(() => { void refreshPlan(); }, delay);
    return () => window.clearTimeout(timer);
  }, [state.billing?.currentPeriodEnd, refreshPlan]);

  const value = useMemo(() => ({ ...state, refreshVersion, refreshPlan }), [state, refreshVersion, refreshPlan]);
  // refreshPlan reads the request ref only when invoked, never during render.
  // eslint-disable-next-line react-hooks/refs
  return createElement(ClientPlanContext.Provider, { value }, children);
}

export function useClientPlan(): ClientPlanContextValue {
  const context = useContext(ClientPlanContext);
  if (!context) throw new Error("useClientPlan must be used within ClientPlanProvider.");
  return context;
}
