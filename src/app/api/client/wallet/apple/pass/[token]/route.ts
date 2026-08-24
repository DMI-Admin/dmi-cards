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

type PublicAppleWalletPassRouteContext = {
  params: Promise<{
    token: string;
  }>;
};

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function GET(_request: Request, context: PublicAppleWalletPassRouteContext) {
  const { token } = await context.params;
  let payload;

  try {
    payload = verifyWalletPassToken(token);
  } catch {
    return NextResponse.json(
      {
        code: "WALLET_PASS_LINK_INVALID",
        message: "This Wallet pass link is invalid or expired.",
      },
      { status: 401 }
    );
  }

  let card;

  try {
    card = await loadPublishedWalletCardById(payload.cardId);
  } catch (error) {
    if (error instanceof WalletRouteError) {
      return NextResponse.json(
        {
          cardId: payload.cardId,
          code: error.code,
          message: error.message,
        },
        { status: error.status }
      );
    }

    throw error;
  }

  const appleConfig = getAppleWalletConfig();

  if (!appleConfig.configured) {
    return NextResponse.json(
      {
        ready: false,
        cardId: card.id,
        code: "APPLE_WALLET_NOT_CONFIGURED",
        message: "Apple Wallet configuration is incomplete.",
        missingVariables: appleConfig.missingVariables,
      },
      { status: 503 }
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
    return NextResponse.json(
      {
        code: "WALLET_PASS_COLOUR_CONTRAST_INVALID",
        message: "Choose a Wallet text colour with stronger contrast.",
      },
      { status: 400 }
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
      },
    });
  } catch (error) {
    if (error instanceof AppleWalletCertificateError) {
      return NextResponse.json(
        {
          ready: false,
          cardId: card.id,
          code: error.code,
          message: "Apple Wallet configuration is invalid.",
        },
        { status: 503 }
      );
    }

    if (error instanceof ApplePassGenerationError) {
      return NextResponse.json(
        {
          ready: false,
          cardId: card.id,
          code: error.code,
          message: "Could not generate Apple Wallet pass.",
        },
        { status: 500 }
      );
    }

    console.error("Apple Wallet pass generation failed", {
      code: "APPLE_PASS_UNEXPECTED_ERROR",
      errorName: error instanceof Error ? error.name : "UnknownError",
    });

    return NextResponse.json(
      {
        ready: false,
        cardId: card.id,
        code: "APPLE_PASS_GENERATION_FAILED",
        message: "Could not generate Apple Wallet pass.",
      },
      { status: 500 }
    );
  }
}
