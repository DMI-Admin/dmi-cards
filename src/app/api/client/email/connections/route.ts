import { NextResponse } from "next/server";
import { requireApiClient } from "@/lib/api/client-context";
import { apiErrorFromUnknown } from "@/lib/api/responses";
import { listEmailConnectionMetadata } from "@/lib/email/connections";
import { requestIdFromRequest, withRequestIdHeader } from "@/lib/observability/request";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function GET(request: Request) {
  const requestId = requestIdFromRequest(request);

  try {
    const client = await requireApiClient(request);
    const connections = await listEmailConnectionMetadata(client.userId);

    return withRequestIdHeader(NextResponse.json({ data: { connections } }), requestId);
  } catch (error) {
    return withRequestIdHeader(apiErrorFromUnknown(error), requestId);
  }
}
