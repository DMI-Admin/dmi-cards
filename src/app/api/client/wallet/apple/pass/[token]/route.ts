import { NextResponse } from "next/server";
import {
  WalletRouteError,
  loadPublishedWalletCardById,
} from "@/lib/wallet/card-loader";
import {
  ApplePassGenerationError,
  AppleWalletCertificateError,
  buildApplePassData,
  generateAppleWalletPass,
  getAppleWalletConfig,
} from "@/lib/wallet/apple";
import {
  verifyWalletPassToken,
  walletPassColoursAreReadable,
} from "@/lib/wallet/pass-link";
import { logError, safeErrorMetadata } from "@/lib/observability/logger";
import { requestIdFromRequest, withRequestIdHeader } from "@/lib/observability/request";

type PublicAppleWalletPassRouteContext = {
  params: Promise<{
    token: string;
  }>;
};

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function GET(request: Request, context: PublicAppleWalletPassRouteContext) {
  const requestId = requestIdFromRequest(request);
  const route = "/api/client/wallet/apple/pass/[token]";
  const { token } = await context.params;
  let payload;

  try {
    payload = verifyWalletPassToken(token);
  } catch {
    return withRequestIdHeader(
      NextResponse.json(
        {
          code: "WALLET_PASS_LINK_INVALID",
          message: "This Wallet pass link is invalid or expired.",
        },
        { status: 401 }
      ),
      requestId
    );
  }

  let card;

  try {
    card = await loadPublishedWalletCardById(payload.cardId);
  } catch (error) {
    if (error instanceof WalletRouteError) {
      return withRequestIdHeader(
        NextResponse.json(
          {
            cardId: payload.cardId,
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

  const passData = buildApplePassData(card, appleConfig.config, {
    backgroundColor: payload.backgroundColor,
    foregroundColor: payload.foregroundColor,
    labelColor: payload.labelColor,
  });

  if (
    !walletPassColoursAreReadable({
      backgroundColor: payload.backgroundColor,
      foregroundColor: payload.foregroundColor,
    })
  ) {
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
      code: "APPLE_WALLET_PUBLIC_PASS_FAILED",
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
