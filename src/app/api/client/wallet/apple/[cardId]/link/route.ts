import { NextResponse } from "next/server";
import {
  WalletRouteError,
  loadWalletCardForRequest,
} from "@/lib/wallet/card-loader";
import { getAppleWalletConfig } from "@/lib/wallet/apple";
import {
  buildPublicWalletPassUrl,
  buildWalletPassPath,
  createWalletPassToken,
  walletPassColoursAreReadable,
} from "@/lib/wallet/pass-link";

type AppleWalletLinkRouteContext = {
  params: Promise<{
    cardId: string;
  }>;
};

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function POST(request: Request, context: AppleWalletLinkRouteContext) {
  const { cardId } = await context.params;

  try {
    await loadWalletCardForRequest(request, cardId);
  } catch (error) {
    if (error instanceof WalletRouteError) {
      return NextResponse.json(
        {
          cardId,
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
        cardId,
        code: "APPLE_WALLET_NOT_CONFIGURED",
        message: "Apple Wallet configuration is incomplete.",
        missingVariables: appleConfig.missingVariables,
      },
      { status: 503 }
    );
  }

  let body: { backgroundColor?: string; foregroundColor?: string; labelColor?: string } = {};

  try {
    body = (await request.json()) as {
      backgroundColor?: string;
      foregroundColor?: string;
      labelColor?: string;
    };
  } catch {
    body = {};
  }

  const backgroundColor = requestedBackgroundColor(body.backgroundColor);
  const foregroundColor = requestedBackgroundColor(body.foregroundColor);
  const labelColor = requestedBackgroundColor(body.labelColor);

  if (!walletPassColoursAreReadable({ backgroundColor, foregroundColor })) {
    return NextResponse.json(
      {
        code: "WALLET_PASS_COLOUR_CONTRAST_INVALID",
        message: "Choose a Wallet text colour with stronger contrast.",
      },
      { status: 400 }
    );
  }

  const token = createWalletPassToken({
    cardId,
    backgroundColor,
    foregroundColor,
    labelColor,
  });

  return NextResponse.json({
    passPath: buildWalletPassPath(token),
    publicPassUrl: buildPublicWalletPassUrl(token),
  });
}

function requestedBackgroundColor(value: string | undefined) {
  const trimmedValue = value?.trim() || "";

  return /^#[0-9a-fA-F]{6}$/.test(trimmedValue) ? trimmedValue.toUpperCase() : undefined;
}
