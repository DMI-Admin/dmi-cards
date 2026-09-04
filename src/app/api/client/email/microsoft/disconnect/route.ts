import { NextResponse } from "next/server";
import { requireApiClient } from "@/lib/api/client-context";
import { apiErrorFromUnknown } from "@/lib/api/responses";
import { disconnectEmailConnection } from "@/lib/email/connections";
import { logInfo } from "@/lib/observability/logger";
import { requestIdFromRequest, withRequestIdHeader } from "@/lib/observability/request";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function POST(request: Request) {
  const requestId = requestIdFromRequest(request);
  const route = "/api/client/email/microsoft/disconnect";

  try {
    const client = await requireApiClient(request);
    const connection = await disconnectEmailConnection(client.userId, "outlook");

    logInfo({
      code: "email.microsoft.disconnected",
      requestId,
      route,
      metadata: { ownerUserId: client.userId },
    });

    return withRequestIdHeader(
      NextResponse.json({ data: { connection } }),
      requestId
    );
  } catch (error) {
    return withRequestIdHeader(apiErrorFromUnknown(error), requestId);
  }
}
