import { adminClientMutation } from "@/lib/admin-client-mutations-server";
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

export async function PATCH(request: Request, context: { params: Promise<{ clientId: string }> }) {
  return adminClientMutation(request, "update-client", (await context.params).clientId);
}
