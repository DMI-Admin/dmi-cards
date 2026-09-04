import type { User } from "@supabase/supabase-js";
import type { DmiPlan } from "@/lib/entitlements";
import { resolveEffectiveClientPlan } from "@/lib/entitlements/plan-resolver";
import { logInfo, logWarn } from "@/lib/observability/logger";
import { getOrCreateClientProfile, type ClientProfile } from "@/lib/profiles";
import { supabase } from "@/lib/supabase";

export class ClientAuthRequiredError extends Error {
  constructor() {
    super("Client login is required.");
    this.name = "ClientAuthRequiredError";
  }
}

export class ClientSuspendedError extends Error {
  constructor() {
    super("This account has been suspended. Please contact DMI Cards support.");
    this.name = "ClientSuspendedError";
  }
}

export type CurrentClient = {
  user: User;
  profile: ClientProfile;
  plan: DmiPlan;
  planSource: "stripe_billing" | "profile" | "fallback";
};

export type ClientAccountStatus = {
  clientId: string | null;
  clientStatus: string;
  clientUserId: string | null;
  clientUserStatus: string;
  isSuspended: boolean;
};

export async function getCurrentUser() {
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  logInfo({
    code: "CLIENT_AUTH_SESSION_STATE",
    metadata: {
      helper: "getCurrentUser",
      hasSession: Boolean(session),
      userId: session?.user?.id || null,
      errorName: sessionError?.name || null,
    },
  });

  if (session?.user) {
    return session.user;
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  logInfo({
    code: "CLIENT_AUTH_USER_LOOKUP",
    metadata: {
      helper: "getCurrentUser",
      userId: user?.id || null,
      errorName: userError?.name || null,
    },
  });

  return user;
}

export async function getCurrentProfile(user?: User | null) {
  const authUser = user || (await getCurrentUser());

  if (!authUser) {
    return null;
  }

  const profile = await getOrCreateClientProfile(authUser);
  logInfo({
    code: "CLIENT_AUTH_PROFILE_LOADED",
    metadata: {
      userId: authUser.id,
      profileId: profile.id,
      plan: profile.plan || profile.subscription_plan,
    },
  });
  return profile;
}

export async function requireClientUser(): Promise<CurrentClient> {
  const user = await getCurrentUser();

  if (!user) {
    logWarn({
      code: "CLIENT_AUTH_REQUIRED",
      metadata: {
        authenticated: false,
      },
    });
    throw new ClientAuthRequiredError();
  }

  const profile = await getCurrentProfile(user);

  if (!profile) {
    throw new Error("Could not load your client profile.");
  }

  const status = await getCurrentClientAccountStatus(user.id);
  const { plan, source: planSource } = await resolveEffectiveClientPlan(user);

  logInfo({
    code: "CLIENT_PORTAL_STATUS_DECISION",
    metadata: {
      source: "requireClientUser",
      authenticatedUserId: user.id,
      clientId: status.clientId,
      clientStatus: status.clientStatus,
      clientUserId: status.clientUserId,
      clientUserStatus: status.clientUserStatus,
      plan,
      planSource,
      redirectDecision: status.isSuspended ? "sign-out-and-redirect-login" : "allow",
    },
  });

  if (status.isSuspended) {
    await supabase.auth.signOut();
    throw new ClientSuspendedError();
  }

  logInfo({
    code: "CLIENT_AUTH_RESOLVED",
    metadata: {
      authenticated: true,
      userId: user.id,
    },
  });

  return { user, profile, plan, planSource };
}

export async function getCurrentClientAccountStatus(userIdForLog?: string | null) {
  const { data, error } = await supabase
    .rpc("get_current_client_account_status")
    .single();

  if (error) {
    throw new Error(`Could not check client status: ${error.message}`);
  }

  const result = data as {
    client_id?: string | null;
    client_status?: string | null;
    client_user_id?: string | null;
    client_user_status?: string | null;
    is_suspended?: boolean | null;
  } | null;

  const status: ClientAccountStatus = {
    clientId: result?.client_id || null,
    clientStatus: result?.client_status || "active",
    clientUserId: result?.client_user_id || null,
    clientUserStatus: result?.client_user_status || "active",
    isSuspended: Boolean(result?.is_suspended),
  };

  logInfo({
    code: "CLIENT_ACCOUNT_STATUS_LOOKUP",
    metadata: {
      authenticatedUserId: userIdForLog || null,
      checkedTables: ["clients.status", "client_users.status"],
      clientId: status.clientId,
      clientStatus: status.clientStatus,
      clientUserId: status.clientUserId,
      clientUserStatus: status.clientUserStatus,
      redirectDecision: status.isSuspended ? "block" : "allow",
    },
  });

  return status;
}

export async function isClientAccountSuspended(userIdForLog?: string | null) {
  const status = await getCurrentClientAccountStatus(userIdForLog);
  return status.isSuspended;
}
