import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import type { DmiPlan } from "@/lib/entitlements";

export type EffectiveClientPlanResult = {
  plan: DmiPlan;
  source: "stripe_billing" | "temporary_free_cap";
  billing: { status: string | null; cancelAtPeriodEnd: boolean; currentPeriodEnd: string | null };
};

// The browser transports the server decision; it never interprets Stripe or
// profile/account plan fields. Failures remain errors, never paid fallbacks.
export async function resolveEffectiveClientPlan(
  user?: Pick<User, "id"> | null
): Promise<EffectiveClientPlanResult> {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session?.access_token || (user && session.user.id !== user.id)) {
    throw new Error("Please sign in again to load your feature access.");
  }
  const response = await fetch("/api/v1/billing/subscription?view=entitlement", {
    headers: { Authorization: `Bearer ${session.access_token}` },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null);
  const result = payload?.data;
  if (!response.ok || !result ||
      !["free", "pro", "enterprise"].includes(result.plan) ||
      !["stripe_billing", "temporary_free_cap"].includes(result.source) ||
      !result.billing || typeof result.billing.cancelAtPeriodEnd !== "boolean" ||
      !(result.billing.status === null || typeof result.billing.status === "string") ||
      !(result.billing.currentPeriodEnd === null || typeof result.billing.currentPeriodEnd === "string")) {
    throw new Error("Could not load current feature access. Please retry.");
  }
  const { data: { session: current } } = await supabase.auth.getSession();
  if (current?.user.id !== session.user.id) throw new Error("Your session changed. Please retry.");
  return result;
}
