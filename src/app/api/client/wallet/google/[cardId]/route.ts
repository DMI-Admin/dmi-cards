import { NextResponse } from "next/server";
import {
  WalletRouteError,
  loadWalletCardForRequest,
} from "@/lib/wallet/card-loader";
import {
  GoogleWalletGenerationError,
  createGoogleWalletSaveLink,
  getGoogleWalletConfig,
} from "@/lib/wallet/google";
import { logError, safeErrorMetadata } from "@/lib/observability/logger";
import { requestIdFromRequest, withRequestIdHeader } from "@/lib/observability/request";

type GoogleWalletRouteContext = {
  params: Promise<{
    cardId: string;
  }>;
};

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function POST(request: Request, context: GoogleWalletRouteContext) {
  const requestId = requestIdFromRequest(request);
  const route = "/api/client/wallet/google/[cardId]";
  const { cardId } = await context.params;
  let card;

  try {
    card = await loadWalletCardForRequest(request, cardId);
  } catch (error) {
    if (error instanceof WalletRouteError) {
      return withRequestIdHeader(
        NextResponse.json(
          {
            cardId,
            code: error.code,
            message: error.message,
          },
          { status: error.status }
        ),
        requestId
      );
    }

    throw error;
  }

  const googleConfig = getGoogleWalletConfig();

  if (!googleConfig.configured) {
    return withRequestIdHeader(
      NextResponse.json(
        {
          ready: false,
          cardId,
          code: "GOOGLE_WALLET_NOT_CONFIGURED",
          message: "Google Wallet configuration is incomplete.",
          missingVariables: googleConfig.missingVariables,
        },
        { status: 503 }
      ),
      requestId
    );
  }

  let body: { backgroundColor?: string } = {};

  try {
    body = (await request.json()) as { backgroundColor?: string };
  } catch {
    body = {};
  }

  const backgroundColor = requestedBackgroundColor(body.backgroundColor);

  try {
    const saveLink = await createGoogleWalletSaveLink(card, googleConfig.config, {
      backgroundColor,
    });

    return withRequestIdHeader(
      NextResponse.json({
        ready: true,
        cardId: card.id,
        classId: saveLink.classId,
        objectId: saveLink.objectId,
        publicCardUrl: saveLink.publicCardUrl,
        saveUrl: saveLink.saveUrl,
      }),
      requestId
    );
  } catch (error) {
    logError({
      code: "GOOGLE_WALLET_GENERATION_FAILED",
      requestId,
      route,
      metadata: safeErrorMetadata(error),
    });

    if (error instanceof GoogleWalletGenerationError) {
      return withRequestIdHeader(
        NextResponse.json(
          {
            ready: false,
            cardId: card.id,
            code: error.code,
            message: "Could not generate Google Wallet pass.",
          },
          { status: 500 }
        ),
        requestId
      );
    }

    return withRequestIdHeader(
      NextResponse.json(
        {
          ready: false,
          cardId: card.id,
          code: "GOOGLE_WALLET_GENERATION_FAILED",
          message: "Could not generate Google Wallet pass.",
        },
        { status: 500 }
      ),
      requestId
    );
  }
}

function requestedBackgroundColor(value: string | undefined) {
  const trimmedValue = value?.trim() || "";

  return /^#[0-9a-fA-F]{6}$/.test(trimmedValue) ? trimmedValue.toUpperCase() : undefined;
}
