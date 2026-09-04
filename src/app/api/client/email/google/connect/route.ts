import { NextResponse } from "next/server";
import { requireApiClient } from "@/lib/api/client-context";
import { apiErrorFromUnknown } from "@/lib/api/responses";
import {
  createEmailOAuthState,
  getOAuthRedirectUri,
  setEmailOAuthNonceCookie,
} from "@/lib/email/oauth-state";
import {
  buildGoogleEmailAuthorizationUrl,
  getGoogleEmailOAuthConfig,
} from "@/lib/email/providers/google";
import { logInfo, logWarn } from "@/lib/observability/logger";
import { requestIdFromRequest, withRequestIdHeader } from "@/lib/observability/request";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function GET(request: Request) {
  const requestId = requestIdFromRequest(request);
  const route = "/api/client/email/google/connect";

  try {
    const client = await requireApiClient(request);
    const config = getGoogleEmailOAuthConfig();

    if (!config.configured) {
      logWarn({ code: "email.google.oauth_not_configured", requestId, route });

      return withRequestIdHeader(
        NextResponse.json(
          {
            error: {
              code: "GOOGLE_EMAIL_OAUTH_NOT_CONFIGURED",
              message: "Google email connection is not configured yet.",
            },
          },
          { status: 503 }
        ),
        requestId
      );
    }

    const url = new URL(request.url);
    const state = createEmailOAuthState({
      provider: "gmail",
      ownerUserId: client.userId,
      returnTo: url.searchParams.get("returnTo"),
    });
    const authorizationUrl = buildGoogleEmailAuthorizationUrl({
      redirectUri: getOAuthRedirectUri(
        request,
        "/api/client/email/google/callback"
      ),
      state: state.state,
    });
    const response = NextResponse.json({
      data: {
        authorizationUrl,
      },
    });
    setEmailOAuthNonceCookie(response, state.nonce, state.expiresAt);
    logInfo({ code: "email.google.oauth_started", requestId, route });

    return withRequestIdHeader(response, requestId);
  } catch (error) {
    return withRequestIdHeader(apiErrorFromUnknown(error), requestId);
  }
}
