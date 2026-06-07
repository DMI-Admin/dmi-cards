import type { User } from "@supabase/supabase-js";
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
};

export type ClientAccountStatus = {
  clientId: string | null;
  clientStatus: string;
  clientUserId: string | null;
  clientUserStatus: string;
  isSuspended: boolean;
};

export function authUserLog(user: User | null | undefined) {
  return user
    ? {
        id: user.id,
        email: user.email,
      }
    : null;
}

export async function getCurrentUser() {
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  console.log("[DMI auth] session state", {
    helper: "getCurrentUser",
    hasSession: Boolean(session),
    userId: session?.user?.id || null,
    email: session?.user?.email || null,
    error: sessionError
      ? { name: sessionError.name, message: sessionError.message }
      : null,
  });

  if (session?.user) {
    return session.user;
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  console.log("[DMI auth] auth user", {
    helper: "getCurrentUser",
    user: authUserLog(user),
    error: userError
      ? { name: userError.name, message: userError.message }
      : null,
  });

  return user;
}

export async function getCurrentProfile(user?: User | null) {
  const authUser = user || (await getCurrentUser());

  if (!authUser) {
    return null;
  }

  const profile = await getOrCreateClientProfile(authUser);
  console.log("[DMI auth] loaded profile", profile);
  return profile;
}

export async function requireClientUser(): Promise<CurrentClient> {
  const user = await getCurrentUser();

  if (!user) {
    console.log("[DMI auth] requireClientUser", {
      authenticated: false,
      mockFallbackUsed: false,
    });
    throw new ClientAuthRequiredError();
  }

  const profile = await getCurrentProfile(user);

  if (!profile) {
    throw new Error("Could not load your client profile.");
  }

  const status = await getCurrentClientAccountStatus(user.id);

  console.log("[DMI auth] client portal status decision", {
    source: "requireClientUser",
    authenticatedUserId: user.id,
    email: user.email || null,
    clientId: status.clientId,
    clientStatus: status.clientStatus,
    clientUserId: status.clientUserId,
    clientUserStatus: status.clientUserStatus,
    redirectDecision: status.isSuspended ? "sign-out-and-redirect-login" : "allow",
  });

  if (status.isSuspended) {
    await supabase.auth.signOut();
    throw new ClientSuspendedError();
  }

  console.log("[DMI auth] requireClientUser", {
    authenticated: true,
    user: authUserLog(user),
    mockFallbackUsed: false,
  });

  return { user, profile };
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

  console.log("[DMI auth] suspended status lookup", {
    authenticatedUserId: userIdForLog || null,
    checkedTables: ["clients.status", "client_users.status"],
    clientId: status.clientId,
    clientStatus: status.clientStatus,
    clientUserId: status.clientUserId,
    clientUserStatus: status.clientUserStatus,
    redirectDecision: status.isSuspended ? "block" : "allow",
  });

  return status;
}

export async function isClientAccountSuspended(userIdForLog?: string | null) {
  const status = await getCurrentClientAccountStatus(userIdForLog);
  return status.isSuspended;
}
