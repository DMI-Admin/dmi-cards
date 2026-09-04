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
    const normalizedProfile = await fillMissingProfileNameFromAuthMetadata(
      user,
      normalizeProfile(profile)
    );
    const clientAccount = await ensureClientAccount();
    logClientSignupFlow(user.id, normalizedProfile.id, clientAccount);
    return normalizedProfile;
  }

  const metadataName = profileNameFromAuthUser(user);

  const fallbackProfile = {
    id: user.id,
    title: metadataName.title,
    first_name: metadataName.firstName,
    last_name: metadataName.lastName,
    full_name: metadataName.fullName,
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

async function fillMissingProfileNameFromAuthMetadata(
  user: User,
  profile: ClientProfile
) {
  const metadataName = profileNameFromAuthUser(user);
  const patch: Partial<ClientProfile> = {};

  if (!profile.title?.trim() && metadataName.title) {
    patch.title = metadataName.title;
  }

  if (!profile.first_name?.trim() && metadataName.firstName) {
    patch.first_name = metadataName.firstName;
  }

  if (!profile.last_name?.trim() && metadataName.lastName) {
    patch.last_name = metadataName.lastName;
  }

  if (!profile.full_name?.trim() && metadataName.fullName) {
    patch.full_name = metadataName.fullName;
  }

  if (Object.keys(patch).length === 0) {
    return profile;
  }

  const { data, error } = await supabase
    .from("profiles")
    .update(patch)
    .eq("id", user.id)
    .select("*")
    .single();

  if (error) {
    throw new Error(`Could not update profile name: ${error.message}`);
  }

  return normalizeProfile(data);
}

function profileNameFromAuthUser(user: User) {
  const title = metadataString(user, "title");
  const explicitFirstName = metadataString(user, "first_name");
  const explicitLastName = metadataString(user, "last_name");
  const googleFirstName = metadataString(user, "given_name");
  const googleLastName = metadataString(user, "family_name");
  const metadataFullName =
    metadataString(user, "full_name") || metadataString(user, "name");

  const parsedFullName = parseFullName(metadataFullName);
  const emailPrefix = emailLocalPart(user.email);
  const firstName =
    explicitFirstName || googleFirstName || parsedFullName.firstName || emailPrefix;
  const lastName = explicitLastName || googleLastName || parsedFullName.lastName;
  const fullName =
    metadataFullName ||
    [title, firstName, lastName].filter(Boolean).join(" ") ||
    emailPrefix;

  return {
    title,
    firstName,
    lastName,
    fullName,
  };
}

function metadataString(user: User, key: string) {
  const value = user.user_metadata?.[key];

  return typeof value === "string" ? value.trim() : "";
}

function parseFullName(fullName: string) {
  const parts = fullName.split(/\s+/).map((part) => part.trim()).filter(Boolean);

  if (parts.length === 0) {
    return { firstName: "", lastName: "" };
  }

  if (parts.length === 1) {
    return { firstName: parts[0], lastName: "" };
  }

  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
  };
}

function emailLocalPart(email?: string) {
  return email?.split("@")[0]?.trim() || "";
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
