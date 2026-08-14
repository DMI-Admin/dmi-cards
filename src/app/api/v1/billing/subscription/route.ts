import { requireApiClient } from "@/lib/api/client-context";
import { apiErrorFromUnknown, apiSuccess } from "@/lib/api/responses";
import { getBillingSummaryForUser } from "@/lib/stripe/billing-summary";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const client = await requireApiClient(request);
    const billing = await getBillingSummaryForUser(client.userId);

    return apiSuccess(billing);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
