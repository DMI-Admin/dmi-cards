import { cardEditSnapshot } from "@/lib/card-media-server";
import { requireApiClient } from "@/lib/api/client-context";
import { ApiRouteError, apiErrorFromUnknown, apiSuccess } from "@/lib/api/responses";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function DELETE(request: Request, context: { params: Promise<{ cardId: string }> }) {
  try {
    const client = await requireApiClient(request);
    const { cardId } = await context.params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cardId)) {
      throw new ApiRouteError(400, "INVALID_REQUEST", "Invalid card ID.");
    }
    const { data, error } = await createSupabaseAdminClient()
      .from("cards").delete().eq("id", cardId).eq("user_id", client.userId)
      .select("id").maybeSingle();
    if (error) throw new ApiRouteError(500, "INTERNAL_ERROR", "Could not delete card. Please retry.");
    // Missing and foreign-owned cards are deliberately indistinguishable.
    if (!data) throw new ApiRouteError(404, "NOT_FOUND", "Card not found.");
    return apiSuccess({ deleted: data });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function GET(request: Request, context: { params: Promise<{ cardId: string }> }) {
  try {
    const client = await requireApiClient(request);
    const { cardId } = await context.params;
    return apiSuccess(await cardEditSnapshot(client.userId, cardId), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiErrorFromUnknown(error); }
}
