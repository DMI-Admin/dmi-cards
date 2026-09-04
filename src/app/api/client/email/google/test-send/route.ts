import { NextResponse } from "next/server";
import { requireApiClient } from "@/lib/api/client-context";
import { ApiRouteError, apiErrorFromUnknown } from "@/lib/api/responses";
import { markEmailConnectionReconnectRequired } from "@/lib/email/connections";
import { EmailMimeError } from "@/lib/email/mime";
import { createConnectedEmailProvider } from "@/lib/email/server-provider";
import { GoogleEmailSendError } from "@/lib/email/providers/google";
import { logError, logInfo, logWarn, safeErrorMetadata } from "@/lib/observability/logger";
import { requestIdFromRequest, withRequestIdHeader } from "@/lib/observability/request";

type TestSendBody = {
  to?: unknown;
  subject?: unknown;
  body?: unknown;
};

const testSendAttempts = new Map<string, number[]>();
const testSendWindowMs = 10 * 60 * 1000;
const maxTestSendsPerWindow = 3;

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function POST(request: Request) {
  const requestId = requestIdFromRequest(request);
  const route = "/api/client/email/google/test-send";

  try {
    const client = await requireApiClient(request);

    if (!allowTestSend(client.userId)) {
      logWarn({
        code: "email.google.test_send_rate_limited",
        requestId,
        route,
        metadata: { ownerUserId: client.userId },
      });

      throw new ApiRouteError(
        429,
        "INVALID_REQUEST",
        "Please wait before sending another test email."
      );
    }

    const body = (await request.json().catch(() => ({}))) as TestSendBody;
    const to = stringField(body.to);
    const subject = stringField(body.subject);
    const textBody = stringField(body.body);
    const provider = createConnectedEmailProvider({
      ownerUserId: client.userId,
      provider: "gmail",
    });
    const result = await provider.sendMessage({
      to,
      subject,
      htmlBody: textBody,
      textBody,
      idempotencyKey: requestId,
    });

    logInfo({
      code: "email.google.test_send_sent",
      requestId,
      route,
      metadata: { ownerUserId: client.userId },
    });

    return withRequestIdHeader(
      NextResponse.json({
        data: {
          ok: true,
          messageId: result.providerMessageId,
          threadId: result.threadId || null,
        },
      }),
      requestId
    );
  } catch (error) {
    if (error instanceof EmailMimeError) {
      return withRequestIdHeader(
        NextResponse.json(
          {
            error: {
              code: "INVALID_REQUEST",
              message: messageForMimeError(error),
            },
          },
          { status: 400 }
        ),
        requestId
      );
    }

    if (error instanceof GoogleEmailSendError) {
      if (
        error.code === "GOOGLE_EMAIL_AUTH_FAILED" ||
        error.code === "GOOGLE_EMAIL_SCOPE_FAILED"
      ) {
        const client = await safeClientFromRequest(request);
        if (client) {
          await markEmailConnectionReconnectRequired(client.userId, "gmail").catch(
            () => undefined
          );
        }
      }

      logError({
        code: "email.google.test_send_failed",
        requestId,
        route,
        metadata: {
          ...safeErrorMetadata(error),
          providerStatus: error.metadata.googleStatus,
          providerReason: error.metadata.googleReason,
          responseStatus: error.metadata.responseStatus,
        },
      });

      return withRequestIdHeader(
        NextResponse.json(
          {
            error: {
              code: "INTERNAL_ERROR",
              message:
                error.code === "GOOGLE_EMAIL_AUTH_FAILED"
                  ? "Gmail needs to be reconnected before sending."
                  : error.code === "GOOGLE_EMAIL_SCOPE_FAILED"
                    ? "Gmail needs to be reconnected with email sending permission."
                  : "Gmail could not send the test email.",
            },
          },
          { status: 502 }
        ),
        requestId
      );
    }

    if (error instanceof Error && error.message.startsWith("EMAIL_CONNECTION_")) {
      return withRequestIdHeader(
        NextResponse.json(
          {
            error: {
              code: "CONFLICT",
              message:
                error.message === "EMAIL_CONNECTION_RECONNECT_REQUIRED"
                  ? "Gmail needs to be reconnected before sending."
                  : "Connect Gmail before sending a test email.",
            },
          },
          { status: 409 }
        ),
        requestId
      );
    }

    return withRequestIdHeader(apiErrorFromUnknown(error), requestId);
  }
}

function stringField(value: unknown) {
  return typeof value === "string" ? value : "";
}

function allowTestSend(ownerUserId: string) {
  const now = Date.now();
  const attempts = (testSendAttempts.get(ownerUserId) || []).filter(
    (timestamp) => now - timestamp < testSendWindowMs
  );

  if (attempts.length >= maxTestSendsPerWindow) {
    testSendAttempts.set(ownerUserId, attempts);
    return false;
  }

  attempts.push(now);
  testSendAttempts.set(ownerUserId, attempts);
  return true;
}

async function safeClientFromRequest(request: Request) {
  try {
    return await requireApiClient(request);
  } catch {
    return null;
  }
}

function messageForMimeError(error: EmailMimeError) {
  switch (error.code) {
    case "EMAIL_RECIPIENT_INVALID":
      return "Enter one valid recipient email address.";
    case "EMAIL_FROM_INVALID":
      return "The connected Gmail account email is invalid.";
    case "EMAIL_SUBJECT_INVALID":
      return "Enter a valid subject without line breaks.";
    case "EMAIL_BODY_INVALID":
      return "Enter a valid message body.";
  }
}
