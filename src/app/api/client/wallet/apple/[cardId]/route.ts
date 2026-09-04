import { NextResponse } from "next/server";
import {
  WalletRouteError,
  loadWalletCardForRequest,
} from "@/lib/wallet/card-loader";
import {
  ApplePassGenerationError,
  AppleWalletCertificateError,
  buildApplePassData,
  generateAppleWalletPass,
  getAppleWalletConfig,
} from "@/lib/wallet/apple";
import { walletPassColoursAreReadable } from "@/lib/wallet/pass-link";
import { logError, safeErrorMetadata } from "@/lib/observability/logger";
import { requestIdFromRequest, withRequestIdHeader } from "@/lib/observability/request";

type AppleWalletRouteContext = {
  params: Promise<{
    cardId: string;
  }>;
};

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function GET(request: Request, context: AppleWalletRouteContext) {
  const requestId = requestIdFromRequest(request);
  const route = "/api/client/wallet/apple/[cardId]";
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

  const appleConfig = getAppleWalletConfig();

  if (!appleConfig.configured) {
    return withRequestIdHeader(
      NextResponse.json(
        {
          ready: false,
          cardId: card.id,
          code: "APPLE_WALLET_NOT_CONFIGURED",
          message: "Apple Wallet configuration is incomplete.",
          missingVariables: appleConfig.missingVariables,
        },
        { status: 503 }
      ),
      requestId
    );
  }

  const backgroundColor = requestedBackgroundColor(request);
  const foregroundColor = requestedForegroundColor(request);
  const labelColor = requestedLabelColor(request);

  if (!walletPassColoursAreReadable({ backgroundColor, foregroundColor })) {
    return withRequestIdHeader(
      NextResponse.json(
        {
          code: "WALLET_PASS_COLOUR_CONTRAST_INVALID",
          message: "Choose a Wallet text colour with stronger contrast.",
        },
        { status: 400 }
      ),
      requestId
    );
  }

  const passData = buildApplePassData(card, appleConfig.config, {
    backgroundColor,
    foregroundColor,
    labelColor,
  });

  try {
    const passBuffer = await generateAppleWalletPass(passData, appleConfig.config);

    return new NextResponse(new Uint8Array(passBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.apple.pkpass",
        "Content-Disposition": 'inline; filename="DMI-Card.pkpass"',
        "Cache-Control": "private, no-store",
        "x-request-id": requestId,
      },
    });
  } catch (error) {
    logError({
      code: "APPLE_WALLET_GENERATION_FAILED",
      requestId,
      route,
      metadata: safeErrorMetadata(error),
    });

    if (error instanceof AppleWalletCertificateError) {
      return withRequestIdHeader(
        NextResponse.json(
          {
            ready: false,
            cardId: card.id,
            code: error.code,
            message: "Apple Wallet configuration is invalid.",
          },
          { status: 503 }
        ),
        requestId
      );
    }

    if (error instanceof ApplePassGenerationError) {
      return withRequestIdHeader(
        NextResponse.json(
          {
            ready: false,
            cardId: card.id,
            code: error.code,
            message: "Could not generate Apple Wallet pass.",
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
          code: "APPLE_PASS_GENERATION_FAILED",
          message: "Could not generate Apple Wallet pass.",
        },
        { status: 500 }
      ),
      requestId
    );
  }
}

function requestedBackgroundColor(request: Request) {
  const value = new URL(request.url).searchParams.get("backgroundColor")?.trim() || "";

  return /^#[0-9a-fA-F]{6}$/.test(value) ? value.toUpperCase() : undefined;
}

function requestedForegroundColor(request: Request) {
  const value = new URL(request.url).searchParams.get("foregroundColor")?.trim() || "";

  return /^#[0-9a-fA-F]{6}$/.test(value) ? value.toUpperCase() : undefined;
}

function requestedLabelColor(request: Request) {
  const value = new URL(request.url).searchParams.get("labelColor")?.trim() || "";

  return /^#[0-9a-fA-F]{6}$/.test(value) ? value.toUpperCase() : undefined;
}
