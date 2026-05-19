import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

export type ClientProfile = {
  id: string;
  full_name: string | null;
  email: string | null;
  plan: "free" | "paid";
  account_type: "individual";
  created_at?: string | null;
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
    return profile as ClientProfile;
  }

  const fallbackProfile = {
    id: user.id,
    full_name:
      typeof user.user_metadata?.full_name === "string"
        ? user.user_metadata.full_name
        : "",
    email: user.email || "",
    plan: "free",
    account_type: "individual",
  } satisfies Omit<ClientProfile, "created_at">;

  const { data: createdProfile, error: createError } = await supabase
    .from("profiles")
    .upsert(fallbackProfile)
    .select("*")
    .single();

  if (createError) {
    throw new Error(`Could not create profile: ${createError.message}`);
  }

  return createdProfile as ClientProfile;
}
