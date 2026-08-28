"use client";

import {
  createContext,
  createElement,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { isPaidPlan, type DmiPlan } from "@/lib/entitlements";
import { requireClientUser } from "@/lib/client-auth";

type ClientPlanSource = "stripe_billing" | "profile" | "fallback";

export type ClientPlanState = {
  plan: DmiPlan | null;
  isPaid: boolean;
  loading: boolean;
  error: string;
  status: "auth_loading" | "billing_loading" | "ready" | "error";
  source: ClientPlanSource | null;
};

export type InitialClientPlan = {
  plan: DmiPlan;
  source: ClientPlanSource;
};

type ClientPlanContextValue = ClientPlanState & {
  refreshPlan: () => Promise<ClientPlanState>;
};

const ClientPlanContext = createContext<ClientPlanContextValue | null>(null);

function stateFromPlan(
  plan: DmiPlan | null,
  source: ClientPlanSource | null,
  loading = false,
  error = ""
): ClientPlanState {
  return {
    plan,
    isPaid: plan ? isPaidPlan(plan) : false,
    loading,
    error,
    status: loading ? "billing_loading" : error ? "error" : "ready",
    source,
  };
}

export function ClientPlanProvider({
  children,
  initialPlan,
}: {
  children: ReactNode;
  initialPlan?: InitialClientPlan | null;
}) {
  const [state, setState] = useState<ClientPlanState>(() =>
    initialPlan
      ? stateFromPlan(initialPlan.plan, initialPlan.source)
      : stateFromPlan(null, null, true)
  );

  const value = useMemo<ClientPlanContextValue>(() => {
    async function refreshPlan() {
      setState((current) => ({
        ...current,
        loading: true,
        error: "",
        status: "billing_loading",
      }));

      try {
        const client = await requireClientUser();
        const nextState = stateFromPlan(client.plan, client.planSource);
        setState(nextState);
        return nextState;
      } catch (error) {
        console.error("[DMI client] plan lookup failed", {
          name: error instanceof Error ? error.name : "UnknownError",
        });
        const errorMessage =
          error instanceof Error ? error.message : "Could not refresh your plan.";
        const nextState: ClientPlanState = {
          ...state,
          loading: false,
          error: errorMessage,
          status: "error",
        };
        setState(nextState);
        return nextState;
      }
    }

    return {
      ...state,
      refreshPlan,
    };
  }, [state]);

  return createElement(ClientPlanContext.Provider, { value }, children);
}

export function useClientPlan(): ClientPlanContextValue {
  const context = useContext(ClientPlanContext);

  if (!context) {
    throw new Error("useClientPlan must be used within ClientPlanProvider.");
  }

  return context;
}
