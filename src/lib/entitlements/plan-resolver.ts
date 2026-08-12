import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import type { ClientProfile } from "@/lib/profiles";
import { defaultClientPlan, normalizeDmiPlan, type DmiPlan } from "@/lib/entitlements";

export type EffectiveClientPlanResult = {
  plan: DmiPlan;
  source: "stripe_billing" | "profile" | "fallback";
};

type BillingSubscriptionPlanRow = {
  stripe_subscription_status?: string | null;
  dmi_plan?: string | null;
  updated_at?: string | null;
};

export function resolvePlanFromProfile(
  profile: Pick<ClientProfile, "subscription_plan" | "plan"> | null | undefined
): EffectiveClientPlanResult {
  const plan = normalizeDmiPlan(profile?.subscription_plan || profile?.plan);

  return {
    plan,
    source: profile ? "profile" : "fallback",
  };
}

export async function resolveEffectiveClientPlan(
  user: Pick<User, "id"> | null | undefined
): Promise<EffectiveClientPlanResult> {
  if (!user?.id) {
    return { plan: defaultClientPlan, source: "fallback" };
  }

  const billingPlan = await resolvePlanFromBillingSubscription(user.id);

  if (billingPlan.plan !== defaultClientPlan) {
    return billingPlan;
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("subscription_plan, plan")
    .eq("id", user.id)
    .maybeSingle();

  if (error || !data) {
    return { plan: defaultClientPlan, source: "fallback" };
  }

  return {
    plan: normalizeDmiPlan(
      (data as { subscription_plan?: string | null; plan?: string | null })
        .subscription_plan ||
        (data as { subscription_plan?: string | null; plan?: string | null }).plan
    ),
    source: "profile",
  };
}

async function resolvePlanFromBillingSubscription(
  userId: string
): Promise<EffectiveClientPlanResult> {
  const { data, error } = await supabase
    .from("billing_subscriptions")
    .select("stripe_subscription_status, dmi_plan, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(10);

  if (error) {
    console.warn("[DMI client] billing subscription lookup skipped", {
      reason: "BILLING_SUBSCRIPTION_LOOKUP_FAILED",
      code: error.code,
    });
    return { plan: defaultClientPlan, source: "fallback" };
  }

  const rows = (data || []) as BillingSubscriptionPlanRow[];
  const paidRow = rows.find((row) => {
    const status = row.stripe_subscription_status;
    return (
      (status === "active" || status === "trialing") &&
      normalizeDmiPlan(row.dmi_plan) !== defaultClientPlan
    );
  });

  if (!paidRow) {
    return { plan: defaultClientPlan, source: "fallback" };
  }

  return {
    plan: normalizeDmiPlan(paidRow.dmi_plan),
    source: "stripe_billing",
  };
}
