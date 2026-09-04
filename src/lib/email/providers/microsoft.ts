import "server-only";

import type { EmailConnectionTokenSet } from "@/lib/email/connections";

const microsoftGraphMeUrl = "https://graph.microsoft.com/v1.0/me";
const microsoftScopes = [
  "openid",
  "email",
  "profile",
  "offline_access",
  "User.Read",
  "Mail.Send",
];

export type MicrosoftEmailAccount = {
  providerAccountId: string;
  providerAccountEmail: string | null;
  displayName: string | null;
};

export function getMicrosoftEmailOAuthConfig() {
  const clientId = process.env.MICROSOFT_EMAIL_CLIENT_ID?.trim() || "";
  const clientSecret = process.env.MICROSOFT_EMAIL_CLIENT_SECRET?.trim() || "";
  const tenant = process.env.MICROSOFT_EMAIL_TENANT?.trim() || "common";

  return {
    configured: Boolean(clientId && clientSecret),
    missingVariables: [
      ["MICROSOFT_EMAIL_CLIENT_ID", clientId],
      ["MICROSOFT_EMAIL_CLIENT_SECRET", clientSecret],
    ]
      .filter(([, value]) => !value)
      .map(([name]) => name),
    clientId,
    clientSecret,
    tenant,
    authorizeUrl: `https://login.microsoftonline.com/${encodeURIComponent(
      tenant
    )}/oauth2/v2.0/authorize`,
    tokenUrl: `https://login.microsoftonline.com/${encodeURIComponent(
      tenant
    )}/oauth2/v2.0/token`,
  };
}

export function buildMicrosoftEmailAuthorizationUrl(input: {
  redirectUri: string;
  state: string;
}) {
  const config = getMicrosoftEmailOAuthConfig();

  if (!config.configured) {
    throw new Error("MICROSOFT_EMAIL_OAUTH_NOT_CONFIGURED");
  }

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    response_mode: "query",
    scope: microsoftScopes.join(" "),
    state: input.state,
    prompt: "select_account",
  });

  return `${config.authorizeUrl}?${params.toString()}`;
}

export async function exchangeMicrosoftEmailCode(input: {
  code: string;
  redirectUri: string;
}): Promise<EmailConnectionTokenSet> {
  const config = getMicrosoftEmailOAuthConfig();

  if (!config.configured) {
    throw new Error("MICROSOFT_EMAIL_OAUTH_NOT_CONFIGURED");
  }

  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code: input.code,
      grant_type: "authorization_code",
      redirect_uri: input.redirectUri,
      scope: microsoftScopes.join(" "),
    }),
  });
  const data = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };

  if (!response.ok || !data.access_token) {
    throw new Error("MICROSOFT_EMAIL_TOKEN_EXCHANGE_FAILED");
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || null,
    expiresAt: expiresAtFromSeconds(data.expires_in),
    scopes: scopeList(data.scope),
  };
}

export async function refreshMicrosoftEmailConnection(
  refreshToken: string
): Promise<EmailConnectionTokenSet> {
  const config = getMicrosoftEmailOAuthConfig();

  if (!config.configured) {
    throw new Error("MICROSOFT_EMAIL_OAUTH_NOT_CONFIGURED");
  }

  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
      scope: microsoftScopes.join(" "),
    }),
  });
  const data = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };

  if (!response.ok || !data.access_token) {
    throw new Error("MICROSOFT_EMAIL_REFRESH_FAILED");
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || null,
    expiresAt: expiresAtFromSeconds(data.expires_in),
    scopes: scopeList(data.scope),
  };
}

export async function getMicrosoftEmailAccount(accessToken: string) {
  const response = await fetch(
    `${microsoftGraphMeUrl}?$select=id,displayName,mail,userPrincipalName`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      signal: AbortSignal.timeout(5000),
    }
  );
  const data = (await response.json().catch(() => ({}))) as {
    id?: string;
    displayName?: string;
    mail?: string;
    userPrincipalName?: string;
  };

  if (!response.ok || !data.id) {
    throw new Error("MICROSOFT_EMAIL_ACCOUNT_LOOKUP_FAILED");
  }

  return {
    providerAccountId: data.id,
    providerAccountEmail: data.mail || data.userPrincipalName || null,
    displayName: data.displayName || null,
  } satisfies MicrosoftEmailAccount;
}

export async function revokeMicrosoftEmailConnection() {
  // Microsoft personal and work accounts do not provide a universal token
  // revocation endpoint equivalent to Google's revoke endpoint. Disconnecting
  // removes local encrypted credentials and marks the connection revoked.
}

function expiresAtFromSeconds(seconds: number | undefined) {
  if (!seconds || !Number.isFinite(seconds)) return null;

  return new Date(Date.now() + seconds * 1000).toISOString();
}

function scopeList(scope: string | undefined) {
  return scope?.split(/\s+/).filter(Boolean) || microsoftScopes;
}
