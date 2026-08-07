import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import type { ClientProfile } from "@/lib/profiles";
import {
  defaultClientPlan,
  normalizeDmiPlan,
  type DmiPlan,
} from "@/lib/entitlements";

export type EffectiveClientPlanResult = {
  plan: DmiPlan;
  source: "profile" | "fallback";
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
