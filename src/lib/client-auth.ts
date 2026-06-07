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

  if (await isClientAccountSuspended(user.id)) {
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

export async function isClientAccountSuspended(userId: string) {
  const suspendedStatuses = new Set(["suspended", "inactive"]);

  const { data: clients, error: clientsError } = await supabase
    .from("clients")
    .select("id, status")
    .or(`user_id.eq.${userId},profile_id.eq.${userId}`);

  if (clientsError) {
    throw new Error(`Could not check client status: ${clientsError.message}`);
  }

  const { data: clientUsers, error: clientUsersError } = await supabase
    .from("client_users")
    .select("id, status")
    .or(`user_id.eq.${userId},profile_id.eq.${userId}`);

  if (clientUsersError) {
    throw new Error(`Could not check client user status: ${clientUsersError.message}`);
  }

  return [...(clients || []), ...(clientUsers || [])].some((record) =>
    suspendedStatuses.has(String(record.status || "").toLowerCase())
  );
}
