import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import type { EmailConnectionStatus, EmailProviderId } from "@/lib/email/types";
import {
  decryptEmailToken,
  encryptEmailToken,
} from "@/lib/email/token-encryption";
import {
  refreshGoogleEmailConnection,
  revokeGoogleEmailConnection,
} from "@/lib/email/providers/google";
import {
  refreshMicrosoftEmailConnection,
  revokeMicrosoftEmailConnection,
} from "@/lib/email/providers/microsoft";

export type EmailConnectionRow = {
  id: string;
  owner_user_id: string;
  provider: EmailProviderId;
  provider_account_id: string;
  provider_account_email: string | null;
  display_name: string | null;
  status: EmailConnectionStatus;
  access_token_encrypted: string | null;
  refresh_token_encrypted: string | null;
  access_token_expires_at: string | null;
  provider_scopes: string[];
  connected_at: string | null;
  last_refreshed_at: string | null;
  revoked_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type EmailConnectionMetadata = {
  id: string;
  provider: EmailProviderId;
  providerAccountEmail: string | null;
  displayName: string | null;
  status: EmailConnectionStatus;
  connectedAt: string | null;
  lastRefreshedAt: string | null;
  revokedAt: string | null;
};

export type EmailConnectionTokenSet = {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: string | null;
  scopes: string[];
};

export type UpsertEmailConnectionInput = {
  ownerUserId: string;
  provider: EmailProviderId;
  providerAccountId: string;
  providerAccountEmail: string | null;
  displayName: string | null;
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: string | null;
  scopes: string[];
};

export async function listEmailConnectionMetadata(ownerUserId: string) {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("email_connections")
    .select(
      "id, provider, provider_account_email, display_name, status, connected_at, last_refreshed_at, revoked_at"
    )
    .eq("owner_user_id", ownerUserId)
    .neq("status", "disconnected")
    .order("provider", { ascending: true });

  if (error) {
    throw new Error("EMAIL_CONNECTIONS_LIST_FAILED");
  }

  return ((data || []) as Partial<EmailConnectionRow>[]).map(toMetadata);
}

export async function upsertEmailConnection(input: UpsertEmailConnectionInput) {
  const supabase = createSupabaseAdminClient();
  const existing = await getEmailConnectionByProvider(
    supabase,
    input.ownerUserId,
    input.provider
  );
  const now = new Date().toISOString();
  const encryptedAccessToken = encryptEmailToken(input.accessToken);
  const encryptedRefreshToken =
    input.refreshToken && input.refreshToken.trim()
      ? encryptEmailToken(input.refreshToken)
      : existing?.refresh_token_encrypted || null;

  const payload = {
    owner_user_id: input.ownerUserId,
    provider: input.provider,
    provider_account_id: input.providerAccountId,
    provider_account_email: input.providerAccountEmail,
    display_name: input.displayName,
    status: "connected",
    access_token_encrypted: encryptedAccessToken,
    refresh_token_encrypted: encryptedRefreshToken,
    access_token_expires_at: input.expiresAt || null,
    provider_scopes: input.scopes,
    connected_at: existing?.connected_at || now,
    last_refreshed_at: now,
    revoked_at: null,
  };

  const { data, error } = await supabase
    .from("email_connections")
    .upsert(payload, { onConflict: "owner_user_id,provider" })
    .select(
      "id, provider, provider_account_email, display_name, status, connected_at, last_refreshed_at, revoked_at"
    )
    .single();

  if (error) {
    throw new Error("EMAIL_CONNECTION_UPSERT_FAILED");
  }

  return toMetadata(data as Partial<EmailConnectionRow>);
}

export async function disconnectEmailConnection(
  ownerUserId: string,
  provider: EmailProviderId
) {
  const supabase = createSupabaseAdminClient();
  const existing = await getEmailConnectionByProvider(supabase, ownerUserId, provider);

  if (existing) {
    const tokens = decryptConnectionTokens(existing);
    await revokeProviderConnection(provider, tokens).catch(() => undefined);
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("email_connections")
    .update({
      status: "disconnected",
      access_token_encrypted: null,
      refresh_token_encrypted: null,
      access_token_expires_at: null,
      revoked_at: now,
    })
    .eq("owner_user_id", ownerUserId)
    .eq("provider", provider)
    .neq("status", "disconnected")
    .select(
      "id, provider, provider_account_email, display_name, status, connected_at, last_refreshed_at, revoked_at"
    )
    .maybeSingle();

  if (error) {
    throw new Error("EMAIL_CONNECTION_DISCONNECT_FAILED");
  }

  return data ? toMetadata(data as Partial<EmailConnectionRow>) : null;
}

export async function ensureEmailConnectionAccessToken(
  ownerUserId: string,
  provider: EmailProviderId
) {
  const supabase = createSupabaseAdminClient();
  const connection = await getEmailConnectionByProvider(
    supabase,
    ownerUserId,
    provider
  );

  if (!connection || connection.status === "disconnected") {
    throw new Error("EMAIL_CONNECTION_NOT_FOUND");
  }

  const tokens = decryptConnectionTokens(connection);
  if (
    connection.status === "connected" &&
    tokens.accessToken &&
    connection.access_token_expires_at &&
    new Date(connection.access_token_expires_at).getTime() > Date.now() + 60_000
  ) {
    return tokens.accessToken;
  }

  if (!tokens.refreshToken) {
    await markConnectionStatus(supabase, connection.id, "reconnect_required");
    throw new Error("EMAIL_CONNECTION_RECONNECT_REQUIRED");
  }

  try {
    const refreshed =
      provider === "gmail"
        ? await refreshGoogleEmailConnection(tokens.refreshToken)
        : await refreshMicrosoftEmailConnection(tokens.refreshToken);
    await updateConnectionTokens(supabase, connection, refreshed);
    return refreshed.accessToken;
  } catch {
    await markConnectionStatus(supabase, connection.id, "reconnect_required");
    throw new Error("EMAIL_CONNECTION_RECONNECT_REQUIRED");
  }
}

export async function markConnectionStatus(
  supabase: SupabaseClient,
  connectionId: string,
  status: EmailConnectionStatus
) {
  await supabase
    .from("email_connections")
    .update({
      status,
      revoked_at:
        status === "revoked" || status === "reconnect_required"
          ? new Date().toISOString()
          : null,
    })
    .eq("id", connectionId);
}

export async function markEmailConnectionReconnectRequired(
  ownerUserId: string,
  provider: EmailProviderId
) {
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase
    .from("email_connections")
    .update({
      status: "reconnect_required",
      revoked_at: new Date().toISOString(),
    })
    .eq("owner_user_id", ownerUserId)
    .eq("provider", provider)
    .neq("status", "disconnected");

  if (error) {
    throw new Error("EMAIL_CONNECTION_STATUS_UPDATE_FAILED");
  }
}

async function updateConnectionTokens(
  supabase: SupabaseClient,
  connection: EmailConnectionRow,
  tokens: EmailConnectionTokenSet
) {
  const { error } = await supabase
    .from("email_connections")
    .update({
      status: "connected",
      access_token_encrypted: encryptEmailToken(tokens.accessToken),
      refresh_token_encrypted: tokens.refreshToken
        ? encryptEmailToken(tokens.refreshToken)
        : connection.refresh_token_encrypted,
      access_token_expires_at: tokens.expiresAt || null,
      provider_scopes: tokens.scopes.length ? tokens.scopes : connection.provider_scopes,
      last_refreshed_at: new Date().toISOString(),
      revoked_at: null,
    })
    .eq("id", connection.id)
    .eq("owner_user_id", connection.owner_user_id);

  if (error) {
    throw new Error("EMAIL_CONNECTION_REFRESH_SAVE_FAILED");
  }
}

async function getEmailConnectionByProvider(
  supabase: SupabaseClient,
  ownerUserId: string,
  provider: EmailProviderId
) {
  const { data, error } = await supabase
    .from("email_connections")
    .select("*")
    .eq("owner_user_id", ownerUserId)
    .eq("provider", provider)
    .neq("status", "disconnected")
    .maybeSingle();

  if (error) {
    throw new Error("EMAIL_CONNECTION_LOOKUP_FAILED");
  }

  return (data || null) as EmailConnectionRow | null;
}

function decryptConnectionTokens(connection: EmailConnectionRow) {
  return {
    accessToken: connection.access_token_encrypted
      ? decryptEmailToken(connection.access_token_encrypted)
      : "",
    refreshToken: connection.refresh_token_encrypted
      ? decryptEmailToken(connection.refresh_token_encrypted)
      : null,
  };
}

async function revokeProviderConnection(
  provider: EmailProviderId,
  tokens: { accessToken: string; refreshToken: string | null }
) {
  if (provider === "gmail") {
    await revokeGoogleEmailConnection(tokens.refreshToken || tokens.accessToken);
    return;
  }

  await revokeMicrosoftEmailConnection();
}

function toMetadata(row: Partial<EmailConnectionRow>): EmailConnectionMetadata {
  return {
    id: row.id || "",
    provider: row.provider || "gmail",
    providerAccountEmail: row.provider_account_email || null,
    displayName: row.display_name || null,
    status: row.status || "not_connected",
    connectedAt: row.connected_at || null,
    lastRefreshedAt: row.last_refreshed_at || null,
    revokedAt: row.revoked_at || null,
  };
}
