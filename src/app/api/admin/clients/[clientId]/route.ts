import { NextResponse } from "next/server";

export async function DELETE() {
  return NextResponse.json(
    {
      error:
        "Permanent client deletion is disabled. Use Suspend Client while the safe deletion workflow is built.",
    },
    {
      status: 405,
      headers: {
        Allow: "GET, HEAD, OPTIONS",
      },
    }
  );
}
