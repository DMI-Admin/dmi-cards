import { requireApiClient } from "@/lib/api/client-context";
import { apiErrorFromUnknown, apiSuccess } from "@/lib/api/responses";
import { setSubscriptionCancelAtPeriodEndForUser } from "@/lib/stripe/billing-summary";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: Request) {
  try {
    const client = await requireApiClient(request);
    const billing = await setSubscriptionCancelAtPeriodEndForUser({
      userId: client.userId,
      cancelAtPeriodEnd: false,
    });

    return apiSuccess(billing);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
