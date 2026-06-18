import { NextResponse } from "next/server";

type AppleWalletRouteContext = {
  params: Promise<{
    cardId: string;
  }>;
};

export async function GET(_request: Request, context: AppleWalletRouteContext) {
  const { cardId } = await context.params;

  return NextResponse.json(
    {
      cardId,
      code: "APPLE_WALLET_NOT_CONFIGURED",
      message: "Apple Wallet setup requires pass certificates.",
    },
    { status: 501 }
  );
}
