import type { User } from "@supabase/supabase-js";
import { normalizeDmiPlan, type DmiPlan } from "@/lib/entitlements";
import { logInfo } from "@/lib/observability/logger";
import { supabase } from "@/lib/supabase";

export type ClientProfile = {
  id: string;
  title: string | null;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  email: string | null;
  subscription_plan: DmiPlan;
  plan?: DmiPlan;
  created_at?: string | null;
  updated_at?: string | null;
};

type ClientAccount = {
  clientId: string;
  clientUserId: string | null;
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
    const normalizedProfile = normalizeProfile(profile);
    const clientAccount = await ensureClientAccount();
    logClientSignupFlow(user.id, normalizedProfile.id, clientAccount);
    return normalizedProfile;
  }

  const metadataTitle =
    typeof user.user_metadata?.title === "string" ? user.user_metadata.title : "";
  const metadataFirstName =
    typeof user.user_metadata?.first_name === "string" ? user.user_metadata.first_name : "";
  const metadataLastName =
    typeof user.user_metadata?.last_name === "string" ? user.user_metadata.last_name : "";
  const metadataFullName =
    typeof user.user_metadata?.full_name === "string"
      ? user.user_metadata.full_name
      : [metadataTitle, metadataFirstName, metadataLastName].filter(Boolean).join(" ");

  const fallbackProfile = {
    id: user.id,
    title: metadataTitle,
    first_name: metadataFirstName,
    last_name: metadataLastName,
    full_name: metadataFullName,
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

  const normalizedProfile = normalizeProfile(createdProfile);
  const clientAccount = await ensureClientAccount();
  logClientSignupFlow(user.id, normalizedProfile.id, clientAccount);
  return normalizedProfile;
}

export async function ensureClientAccount(): Promise<ClientAccount> {
  const { data, error } = await supabase
    .rpc("ensure_current_client_account")
    .single();

  if (error) {
    throw new Error(`Could not ensure client account: ${error.message}`);
  }

  const result = data as {
    client_id?: string | null;
    client_user_id?: string | null;
  } | null;

  if (!result?.client_id) {
    throw new Error("Could not ensure client account: missing client id.");
  }

  return {
    clientId: result.client_id,
    clientUserId: result.client_user_id || null,
  };
}

function normalizeProfile(profile: Record<string, unknown>): ClientProfile {
  const selectedPlan = normalizeDmiPlan(
    typeof profile.subscription_plan === "string"
      ? profile.subscription_plan
      : typeof profile.plan === "string"
        ? profile.plan
        : null
  );

  return {
    id: String(profile.id),
    title: typeof profile.title === "string" ? profile.title : null,
    first_name:
      typeof profile.first_name === "string" ? profile.first_name : null,
    last_name: typeof profile.last_name === "string" ? profile.last_name : null,
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

function logClientSignupFlow(
  authUserId: string,
  profileId: string,
  clientAccount: ClientAccount
) {
  logInfo({
    code: "CLIENT_ACCOUNT_ENSURED",
    metadata: {
      authUserId,
      profileId,
      clientId: clientAccount.clientId,
      clientUserId: clientAccount.clientUserId,
    },
  });
}
