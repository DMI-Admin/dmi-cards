import { NextRequest, NextResponse } from "next/server";
import { upsertEmailConnection } from "@/lib/email/connections";
import {
  clearEmailOAuthNonceCookie,
  getOAuthRedirectUri,
  verifyEmailOAuthState,
} from "@/lib/email/oauth-state";
import {
  exchangeMicrosoftEmailCode,
  getMicrosoftEmailAccount,
} from "@/lib/email/providers/microsoft";
import { logError, logInfo, safeErrorMetadata } from "@/lib/observability/logger";
import { requestIdFromRequest, withRequestIdHeader } from "@/lib/observability/request";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const requestId = requestIdFromRequest(request);
  const route = "/api/client/email/microsoft/callback";
  const url = new URL(request.url);
  const returnTo = "/client/email-automations";
  const denied = url.searchParams.get("error");

  if (denied) {
    return redirectWithStatus(
      request,
      returnTo,
      "error",
      "microsoft",
      "consent_denied",
      requestId
    );
  }

  try {
    const verifiedState = verifyEmailOAuthState(
      request,
      url.searchParams.get("state"),
      "outlook"
    );
    const code = url.searchParams.get("code")?.trim() || "";

    if (!code) {
      throw new Error("MICROSOFT_EMAIL_OAUTH_CODE_MISSING");
    }

    const tokens = await exchangeMicrosoftEmailCode({
      code,
      redirectUri: getOAuthRedirectUri(
        request,
        "/api/client/email/microsoft/callback"
      ),
    });
    const account = await getMicrosoftEmailAccount(tokens.accessToken);

    await upsertEmailConnection({
      ownerUserId: verifiedState.ownerUserId,
      provider: "outlook",
      providerAccountId: account.providerAccountId,
      providerAccountEmail: account.providerAccountEmail,
      displayName: account.displayName,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      scopes: tokens.scopes,
    });

    logInfo({
      code: "email.microsoft.connected",
      requestId,
      route,
      metadata: { ownerUserId: verifiedState.ownerUserId },
    });

    return redirectWithStatus(
      request,
      verifiedState.returnTo,
      "success",
      "microsoft",
      "connected",
      requestId
    );
  } catch (error) {
    logError({
      code: "email.microsoft.oauth_callback_failed",
      requestId,
      route,
      metadata: safeErrorMetadata(error),
    });

    return redirectWithStatus(
      request,
      returnTo,
      "error",
      "microsoft",
      "connect_failed",
      requestId
    );
  }
}

function redirectWithStatus(
  request: Request,
  returnTo: string,
  status: "success" | "error",
  provider: "microsoft",
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
