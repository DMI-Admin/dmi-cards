import { NextResponse } from "next/server";
import {
  WalletRouteError,
  loadWalletCardForRequest,
} from "@/lib/wallet/card-loader";
import { buildApplePassData, getAppleWalletConfig } from "@/lib/wallet/apple";

type AppleWalletRouteContext = {
  params: Promise<{
    cardId: string;
  }>;
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request, context: AppleWalletRouteContext) {
  const { cardId } = await context.params;
  let card;

  try {
    card = await loadWalletCardForRequest(request, cardId);
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
        cardId: card.id,
        code: "APPLE_WALLET_NOT_CONFIGURED",
        message: "Apple Wallet configuration is incomplete.",
        missingVariables: appleConfig.missingVariables,
      },
      { status: 503 }
    );
  }

  const passData = buildApplePassData(card, appleConfig.config);

  return NextResponse.json(
    {
      ready: true,
      cardId: passData.cardId,
      serialNumber: passData.serialNumber,
      nextStep: "APPLE_PASS_GENERATION",
    },
    { status: 200 }
  );
}
