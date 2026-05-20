import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

export type ClientProfile = {
  id: string;
  full_name: string | null;
  email: string | null;
  subscription_plan: "free" | "paid";
  plan?: "free" | "paid";
  created_at?: string | null;
  updated_at?: string | null;
};

export async function getOrCreateClientProfile(user: User) {
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    throw new Error(`Could not load profile: ${profileError.message}`);
  }

  if (profile) {
    return normalizeProfile(profile);
  }

  const fallbackProfile = {
    id: user.id,
    full_name:
      typeof user.user_metadata?.full_name === "string"
        ? user.user_metadata.full_name
        : "",
    email: user.email || "",
    subscription_plan: "free",
    plan: "free",
  } satisfies Omit<ClientProfile, "created_at" | "updated_at">;

  const { data: createdProfile, error: createError } = await supabase
    .from("profiles")
    .upsert(fallbackProfile)
    .select("*")
    .single();

  if (createError) {
    throw new Error(`Could not create profile: ${createError.message}`);
  }

  return normalizeProfile(createdProfile);
}

function normalizeProfile(profile: Record<string, unknown>): ClientProfile {
  const selectedPlan =
    profile.subscription_plan === "paid" || profile.plan === "paid"
      ? "paid"
      : "free";

  return {
    id: String(profile.id),
    full_name:
      typeof profile.full_name === "string" ? profile.full_name : null,
    email: typeof profile.email === "string" ? profile.email : null,
    subscription_plan: selectedPlan,
    plan: selectedPlan,
    created_at:
      typeof profile.created_at === "string" ? profile.created_at : null,
    updated_at:
      typeof profile.updated_at === "string" ? profile.updated_at : null,
  };
}
