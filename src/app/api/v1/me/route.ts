import { requireApiClient } from "@/lib/api/client-context";
import { apiErrorFromUnknown, apiSuccess } from "@/lib/api/responses";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const client = await requireApiClient(request);

    return apiSuccess({
      user: {
        id: client.userId,
        email: client.email,
      },
      profile: client.profile,
      plan: client.plan,
      planSource: client.planSource,
      entitlements: client.entitlements,
    });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
