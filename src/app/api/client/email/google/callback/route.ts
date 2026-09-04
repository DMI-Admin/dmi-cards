import { NextRequest, NextResponse } from "next/server";
import { upsertEmailConnection } from "@/lib/email/connections";
import {
  clearEmailOAuthNonceCookie,
  getOAuthRedirectUri,
  verifyEmailOAuthState,
} from "@/lib/email/oauth-state";
import {
  exchangeGoogleEmailCode,
  getGoogleEmailAccount,
} from "@/lib/email/providers/google";
import { logError, logInfo, safeErrorMetadata } from "@/lib/observability/logger";
import { requestIdFromRequest, withRequestIdHeader } from "@/lib/observability/request";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const requestId = requestIdFromRequest(request);
  const route = "/api/client/email/google/callback";
  const url = new URL(request.url);
  const returnTo = "/client/email-automations";
  const denied = url.searchParams.get("error");

  if (denied) {
    return redirectWithStatus(
      request,
      returnTo,
      "error",
      "google",
      "consent_denied",
      requestId
    );
  }

  try {
    const verifiedState = verifyEmailOAuthState(
      request,
      url.searchParams.get("state"),
      "gmail"
    );
    const code = url.searchParams.get("code")?.trim() || "";

    if (!code) {
      throw new Error("GOOGLE_EMAIL_OAUTH_CODE_MISSING");
    }

    const tokens = await exchangeGoogleEmailCode({
      code,
      redirectUri: getOAuthRedirectUri(
        request,
        "/api/client/email/google/callback"
      ),
    });
    const account = await getGoogleEmailAccount(tokens.accessToken);

    await upsertEmailConnection({
      ownerUserId: verifiedState.ownerUserId,
      provider: "gmail",
      providerAccountId: account.providerAccountId,
      providerAccountEmail: account.providerAccountEmail,
      displayName: account.displayName,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      scopes: tokens.scopes,
    });

    logInfo({
      code: "email.google.connected",
      requestId,
      route,
      metadata: { ownerUserId: verifiedState.ownerUserId },
    });

    return redirectWithStatus(
      request,
      verifiedState.returnTo,
      "success",
      "google",
      "connected",
      requestId
    );
  } catch (error) {
    logError({
      code: "email.google.oauth_callback_failed",
      requestId,
      route,
      metadata: safeErrorMetadata(error),
    });

    return redirectWithStatus(
      request,
      returnTo,
      "error",
      "google",
      "connect_failed",
      requestId
    );
  }
}

function redirectWithStatus(
  request: Request,
  returnTo: string,
  status: "success" | "error",
  provider: "google",
  message: string,
  requestId: string
) {
  const redirectUrl = new URL(returnTo, request.url);
  redirectUrl.searchParams.set("email_oauth", status);
  redirectUrl.searchParams.set("provider", provider);
  redirectUrl.searchParams.set("message", message);
  const response = NextResponse.redirect(redirectUrl);
  clearEmailOAuthNonceCookie(response);

  return withRequestIdHeader(response, requestId);
}
