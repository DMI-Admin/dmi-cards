import { NextResponse } from "next/server";

type GoogleWalletRouteContext = {
  params: Promise<{
    cardId: string;
  }>;
};

export async function GET(_request: Request, context: GoogleWalletRouteContext) {
  const { cardId } = await context.params;

  return NextResponse.json(
    {
      cardId,
      code: "GOOGLE_WALLET_NOT_CONFIGURED",
      message: "Google Wallet setup requires issuer credentials.",
    },
    { status: 501 }
  );
}
