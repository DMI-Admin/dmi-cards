import "server-only";

import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type { EmailProviderId } from "@/lib/email/types";

const stateVersion = "v1";
const stateCookieName = "dmi_email_oauth_nonce";
const stateTtlMs = 10 * 60 * 1000;

type EmailOAuthStatePayload = {
  version: typeof stateVersion;
  provider: EmailProviderId;
  ownerUserId: string;
  nonce: string;
  returnTo: string;
  issuedAt: number;
  expiresAt: number;
};

export class EmailOAuthStateError extends Error {
  code:
    | "EMAIL_OAUTH_STATE_SECRET_MISSING"
    | "EMAIL_OAUTH_STATE_INVALID"
    | "EMAIL_OAUTH_STATE_EXPIRED"
    | "EMAIL_OAUTH_STATE_NONCE_INVALID"
    | "EMAIL_OAUTH_RETURN_PATH_INVALID";

  constructor(code: EmailOAuthStateError["code"]) {
    super(code);
    this.name = "EmailOAuthStateError";
    this.code = code;
  }
}

export function isEmailOAuthStateConfigured() {
  return Boolean(process.env.EMAIL_OAUTH_STATE_SECRET?.trim());
}

export function createEmailOAuthState(input: {
  provider: EmailProviderId;
  ownerUserId: string;
  returnTo?: string | null;
}) {
  const issuedAt = Date.now();
  const payload: EmailOAuthStatePayload = {
    version: stateVersion,
    provider: input.provider,
    ownerUserId: input.ownerUserId,
    nonce: base64Url(randomBytes(24)),
    returnTo: safeReturnPath(input.returnTo),
    issuedAt,
    expiresAt: issuedAt + stateTtlMs,
  };
  const encodedPayload = base64Url(Buffer.from(JSON.stringify(payload), "utf8"));
  const signature = signState(encodedPayload);

  return {
    state: `${encodedPayload}.${signature}`,
    nonce: payload.nonce,
    expiresAt: payload.expiresAt,
  };
}

export function setEmailOAuthNonceCookie(
  response: NextResponse,
  nonce: string,
  expiresAt: number
) {
  response.cookies.set(stateCookieName, nonce, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/client/email",
    expires: new Date(expiresAt),
  });
}

export function clearEmailOAuthNonceCookie(response: NextResponse) {
  response.cookies.set(stateCookieName, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/client/email",
    maxAge: 0,
  });
}

export function verifyEmailOAuthState(
  request: NextRequest,
  state: string | null,
  expectedProvider: EmailProviderId
) {
  if (!state) {
    throw new EmailOAuthStateError("EMAIL_OAUTH_STATE_INVALID");
  }

  const [encodedPayload, signature] = state.split(".");
  if (!encodedPayload || !signature) {
    throw new EmailOAuthStateError("EMAIL_OAUTH_STATE_INVALID");
  }

  const expectedSignature = signState(encodedPayload);
  if (!safeEqual(signature, expectedSignature)) {
    throw new EmailOAuthStateError("EMAIL_OAUTH_STATE_INVALID");
  }

  const payload = JSON.parse(
    Buffer.from(encodedPayload, "base64url").toString("utf8")
  ) as EmailOAuthStatePayload;

  if (
    payload.version !== stateVersion ||
    payload.provider !== expectedProvider ||
    !payload.ownerUserId ||
    !payload.nonce
  ) {
    throw new EmailOAuthStateError("EMAIL_OAUTH_STATE_INVALID");
  }

  if (payload.expiresAt < Date.now()) {
    throw new EmailOAuthStateError("EMAIL_OAUTH_STATE_EXPIRED");
  }

  const cookieNonce = request.cookies.get(stateCookieName)?.value || "";
  if (!cookieNonce || !safeEqual(cookieNonce, payload.nonce)) {
    throw new EmailOAuthStateError("EMAIL_OAUTH_STATE_NONCE_INVALID");
  }

  return {
    provider: payload.provider,
    ownerUserId: payload.ownerUserId,
    returnTo: safeReturnPath(payload.returnTo),
  };
}

export function getOAuthRedirectUri(request: Request, path: string) {
  const origin = new URL(request.url).origin;

  if (
    !origin.startsWith("http://localhost:") &&
    !origin.startsWith("http://127.0.0.1:") &&
    !origin.startsWith("https://")
  ) {
    throw new EmailOAuthStateError("EMAIL_OAUTH_RETURN_PATH_INVALID");
  }

  return `${origin}${path}`;
}

function safeReturnPath(value: string | null | undefined) {
  const fallback = "/client/email-automations";
  const trimmed = value?.trim() || fallback;

  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return fallback;

  try {
    const parsed = new URL(trimmed, "https://app.dmicards.com");
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return fallback;
  }
}

function signState(encodedPayload: string) {
  const secret = process.env.EMAIL_OAUTH_STATE_SECRET?.trim();

  if (!secret) {
    throw new EmailOAuthStateError("EMAIL_OAUTH_STATE_SECRET_MISSING");
  }

  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function base64Url(value: Buffer) {
  return value.toString("base64url");
}
