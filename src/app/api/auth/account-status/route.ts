import { NextResponse } from "next/server";

const genericAccountStatusMessage =
  "If an account exists, instructions will be sent.";

export async function POST(request: Request) {
  await request.json().catch(() => null);

  return NextResponse.json({
    message: genericAccountStatusMessage,
  });
}
