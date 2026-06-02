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
    const clientAccount = await ensureClientAccount(user, normalizedProfile);
    logClientSignupFlow(user.id, normalizedProfile.id, clientAccount);
    return normalizedProfile;
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

  const normalizedProfile = normalizeProfile(createdProfile);
  const clientAccount = await ensureClientAccount(user, normalizedProfile);
  logClientSignupFlow(user.id, normalizedProfile.id, clientAccount);
  return normalizedProfile;
}

export async function ensureClientAccount(
  user: User,
  profile: ClientProfile
): Promise<ClientAccount> {
  const fullName =
    profile.full_name ||
    (typeof user.user_metadata?.full_name === "string"
      ? user.user_metadata.full_name
      : "") ||
    user.email ||
    "Client";
  const email = profile.email || user.email || "";

  const existingClient = await findExistingClient(profile.id, email);
  const clientPayload = {
    profile_id: profile.id,
    user_id: user.id,
    full_name: fullName,
    company_name: "",
    email,
    account_type: "individual",
    subscription_plan: "free",
    billing_status: "free",
    status: "active",
    cards_active: 0,
  };

  const clientResult = existingClient?.id
    ? await writeClientAccount((payload) =>
        supabase
          .from("clients")
          .update(payload)
          .eq("id", existingClient.id)
          .select("id")
          .single(),
        clientPayload
      )
    : await writeClientAccount((payload) =>
        supabase
          .from("clients")
          .insert([payload])
          .select("id")
          .single(),
        clientPayload
      );

  if (clientResult.error || !clientResult.data?.id) {
    throw new Error(
      `Could not create client record: ${
        clientResult.error?.message || "Missing client id."
      }`
    );
  }

  const clientId = String(clientResult.data.id);
  const existingClientUser = await findExistingClientUser(
    clientId,
    profile.id,
    email
  );
  const clientUserPayload = {
    client_id: clientId,
    profile_id: profile.id,
    user_id: user.id,
    full_name: fullName,
    email,
    job_title: "",
    phone: "",
    status: "active",
  };

  const clientUserResult = existingClientUser?.id
    ? await writeClientAccount((payload) =>
        supabase
          .from("client_users")
          .update(payload)
          .eq("id", existingClientUser.id)
          .select("id")
          .single(),
        clientUserPayload
      )
    : await writeClientAccount((payload) =>
        supabase
          .from("client_users")
          .insert([payload])
          .select("id")
          .single(),
        clientUserPayload
      );

  if (clientUserResult.error) {
    throw new Error(
      `Could not create client user record: ${clientUserResult.error.message}`
    );
  }

  return {
    clientId,
    clientUserId: clientUserResult.data?.id
      ? String(clientUserResult.data.id)
      : existingClientUser?.id || null,
  };
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

async function findExistingClient(profileId: string, email: string) {
  const byProfile = await supabase
    .from("clients")
    .select("id")
    .eq("profile_id", profileId)
    .limit(1)
    .maybeSingle();

  if (byProfile.data || !isMissingColumnError(byProfile.error)) {
    return byProfile.data as { id: string } | null;
  }

  if (!email) return null;

  const byEmail = await supabase
    .from("clients")
    .select("id")
    .eq("email", email)
    .eq("account_type", "individual")
    .limit(1)
    .maybeSingle();

  if (byEmail.error) {
    throw new Error(`Could not load client record: ${byEmail.error.message}`);
  }

  return byEmail.data as { id: string } | null;
}

async function findExistingClientUser(
  clientId: string,
  profileId: string,
  email: string
) {
  const byProfile = await supabase
    .from("client_users")
    .select("id")
    .eq("profile_id", profileId)
    .limit(1)
    .maybeSingle();

  if (byProfile.data || !isMissingColumnError(byProfile.error)) {
    return byProfile.data as { id: string } | null;
  }

  if (!email) return null;

  const byEmail = await supabase
    .from("client_users")
    .select("id")
    .eq("client_id", clientId)
    .eq("email", email)
    .limit(1)
    .maybeSingle();

  if (byEmail.error) {
    throw new Error(`Could not load client user record: ${byEmail.error.message}`);
  }

  return byEmail.data as { id: string } | null;
}

async function writeClientAccount(
  write: (
    payload: Record<string, unknown>
  ) => PromiseLike<{ data: unknown; error: { message?: string } | null }>,
  payload: Record<string, unknown>
) {
  let nextPayload = { ...payload };
  let result = await write(nextPayload);

  while (result.error) {
    const missingColumn = missingColumnFromError(result.error);

    if (!missingColumn || !(missingColumn in nextPayload)) break;

    const { [missingColumn]: _removed, ...reducedPayload } = nextPayload;
    void _removed;
    nextPayload = reducedPayload;
    result = await write(nextPayload);
  }

  return result as {
    data: { id?: string } | null;
    error: { message?: string } | null;
  };
}

function missingColumnFromError(error: { message?: string } | null) {
  const message = error?.message || "";
  const quotedColumnMatch = message.match(/'([^']+)' column/);
  const qualifiedColumnMatch = message.match(/column [a-zA-Z0-9_]+\.([a-zA-Z0-9_]+) does not exist/);

  return quotedColumnMatch?.[1] || qualifiedColumnMatch?.[1] || null;
}

function isMissingColumnError(error: { message?: string } | null) {
  return Boolean(missingColumnFromError(error));
}

function logClientSignupFlow(
  authUserId: string,
  profileId: string,
  clientAccount: ClientAccount
) {
  console.log("[DMI signup] client account ensured", {
    authUserId,
    profileId,
    clientId: clientAccount.clientId,
    clientUserId: clientAccount.clientUserId,
  });
}
