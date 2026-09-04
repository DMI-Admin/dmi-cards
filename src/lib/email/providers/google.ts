import "server-only";

import type { EmailConnectionTokenSet } from "@/lib/email/connections";
import { buildPlainTextEmailRaw } from "@/lib/email/mime";
import type {
  EmailSendMessageInput,
  EmailSendMessageResult,
} from "@/lib/email/providers";

const googleAuthorizeUrl = "https://accounts.google.com/o/oauth2/v2/auth";
const googleTokenUrl = "https://oauth2.googleapis.com/token";
const googleUserInfoUrl = "https://openidconnect.googleapis.com/v1/userinfo";
const googleRevokeUrl = "https://oauth2.googleapis.com/revoke";
const googleSendUrl = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const googleScopes = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.send",
];

export type GoogleEmailAccount = {
  providerAccountId: string;
  providerAccountEmail: string | null;
  displayName: string | null;
};

export function getGoogleEmailOAuthConfig() {
  const clientId = process.env.GOOGLE_EMAIL_CLIENT_ID?.trim() || "";
  const clientSecret = process.env.GOOGLE_EMAIL_CLIENT_SECRET?.trim() || "";

  return {
    configured: Boolean(clientId && clientSecret),
    missingVariables: [
      ["GOOGLE_EMAIL_CLIENT_ID", clientId],
      ["GOOGLE_EMAIL_CLIENT_SECRET", clientSecret],
    ]
      .filter(([, value]) => !value)
      .map(([name]) => name),
    clientId,
    clientSecret,
  };
}

export function buildGoogleEmailAuthorizationUrl(input: {
  redirectUri: string;
  state: string;
}) {
  const config = getGoogleEmailOAuthConfig();

  if (!config.configured) {
    throw new Error("GOOGLE_EMAIL_OAUTH_NOT_CONFIGURED");
  }

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: googleScopes.join(" "),
    state: input.state,
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
  });

  return `${googleAuthorizeUrl}?${params.toString()}`;
}

export async function exchangeGoogleEmailCode(input: {
  code: string;
  redirectUri: string;
}): Promise<EmailConnectionTokenSet> {
  const config = getGoogleEmailOAuthConfig();

  if (!config.configured) {
    throw new Error("GOOGLE_EMAIL_OAUTH_NOT_CONFIGURED");
  }

  const response = await fetch(googleTokenUrl, {
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
    }),
  });

  const data = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };

  if (!response.ok || !data.access_token) {
    throw new Error("GOOGLE_EMAIL_TOKEN_EXCHANGE_FAILED");
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || null,
    expiresAt: expiresAtFromSeconds(data.expires_in),
    scopes: scopeList(data.scope),
  };
}

export async function refreshGoogleEmailConnection(
  refreshToken: string
): Promise<EmailConnectionTokenSet> {
  const config = getGoogleEmailOAuthConfig();

  if (!config.configured) {
    throw new Error("GOOGLE_EMAIL_OAUTH_NOT_CONFIGURED");
  }

  const response = await fetch(googleTokenUrl, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const data = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };

  if (!response.ok || !data.access_token) {
    throw new Error("GOOGLE_EMAIL_REFRESH_FAILED");
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || null,
    expiresAt: expiresAtFromSeconds(data.expires_in),
    scopes: scopeList(data.scope),
  };
}

export async function getGoogleEmailAccount(accessToken: string) {
  const response = await fetch(googleUserInfoUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    signal: AbortSignal.timeout(5000),
  });
  const data = (await response.json().catch(() => ({}))) as {
    sub?: string;
    email?: string;
    name?: string;
  };

  if (!response.ok || !data.sub) {
    throw new Error("GOOGLE_EMAIL_ACCOUNT_LOOKUP_FAILED");
  }

  return {
    providerAccountId: data.sub,
    providerAccountEmail: data.email || null,
    displayName: data.name || null,
  } satisfies GoogleEmailAccount;
}

export async function sendGoogleEmailMessage(input: {
  accessToken: string;
  accountEmail: string | null;
  message: EmailSendMessageInput;
}): Promise<EmailSendMessageResult> {
  const raw = buildPlainTextEmailRaw({
    to: input.message.to,
    from: input.accountEmail,
    subject: input.message.subject,
    body: input.message.textBody || input.message.htmlBody,
  });
  const response = await fetch(googleSendUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ raw }),
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await response.json().catch(() => ({}))) as {
    id?: string;
    threadId?: string;
    error?: {
      code?: number;
      status?: string;
      message?: string;
      errors?: {
        reason?: string;
      }[];
      details?: {
        reason?: string;
      }[];
    };
  };

  if (!response.ok || !data.id) {
    throw new GoogleEmailSendError(classifyGoogleSendFailure(response.status, data), {
      responseStatus: response.status,
      googleStatus: data.error?.status || null,
      googleReason: googleErrorReason(data) || null,
    });
  }

  return {
    providerMessageId: data.id,
    threadId: data.threadId || null,
  };
}

export async function revokeGoogleEmailConnection(token: string) {
  if (!token) return;

  await fetch(googleRevokeUrl, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ token }),
    signal: AbortSignal.timeout(5000),
  });
}

export class GoogleEmailSendError extends Error {
  code:
    | "GOOGLE_EMAIL_AUTH_FAILED"
    | "GOOGLE_EMAIL_SCOPE_FAILED"
    | "GOOGLE_EMAIL_SEND_FAILED";
  metadata: {
    responseStatus: number;
    googleStatus: string | null;
    googleReason: string | null;
  };

  constructor(
    code: GoogleEmailSendError["code"],
    metadata: GoogleEmailSendError["metadata"]
  ) {
    super(code);
    this.name = "GoogleEmailSendError";
    this.code = code;
    this.metadata = metadata;
  }
}

function classifyGoogleSendFailure(
  responseStatus: number,
  data: {
    error?: {
      status?: string;
      message?: string;
      errors?: { reason?: string }[];
      details?: { reason?: string }[];
    };
  }
): GoogleEmailSendError["code"] {
  const status = data.error?.status || "";
  const reason = googleErrorReason(data) || "";
  const message = data.error?.message || "";
  const normalized = `${status} ${reason} ${message}`.toLowerCase();

  if (responseStatus === 401 || status === "UNAUTHENTICATED") {
    return "GOOGLE_EMAIL_AUTH_FAILED";
  }

  if (
    normalized.includes("insufficient authentication scopes") ||
    normalized.includes("access_token_scope_insufficient") ||
    normalized.includes("insufficientpermissions")
  ) {
    return "GOOGLE_EMAIL_SCOPE_FAILED";
  }

  return "GOOGLE_EMAIL_SEND_FAILED";
}

function googleErrorReason(data: {
  error?: {
    errors?: { reason?: string }[];
    details?: { reason?: string }[];
  };
}) {
  return (
    data.error?.errors?.find((item) => item.reason)?.reason ||
    data.error?.details?.find((item) => item.reason)?.reason ||
    null
  );
}

function expiresAtFromSeconds(seconds: number | undefined) {
  if (!seconds || !Number.isFinite(seconds)) return null;

  return new Date(Date.now() + seconds * 1000).toISOString();
}

function scopeList(scope: string | undefined) {
  return scope?.split(/\s+/).filter(Boolean) || googleScopes;
}
