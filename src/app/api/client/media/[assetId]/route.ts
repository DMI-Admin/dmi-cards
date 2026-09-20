import { requireApiClient } from "@/lib/api/client-context";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { mediaUuid } from "@/lib/card-media";
import { deliverMedia, mediaObjectPath } from "@/lib/card-media-server";
import { ApiRouteError, apiErrorFromUnknown } from "@/lib/api/responses";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ assetId: string }> }) {
  try {
    const client = await requireApiClient(request); const { assetId } = await context.params;
    const unavailable = () => new ApiRouteError(404, "NOT_FOUND", "Image unavailable.");
    if (!mediaUuid.test(assetId)) throw unavailable();
    const database = createSupabaseAdminClient();
    const { data: asset, error } = await database.from("card_media_assets").select("*").eq("id", assetId).maybeSingle();
    if (error || !asset || !["ready", "attached"].includes(asset.state)) throw unavailable();
    const { data: session } = await database.from("card_media_sessions").select("*").eq("id", asset.session_id).eq("owner_user_id", client.userId).maybeSingle();
    if (!session || (session.state === "pending" && Date.parse(session.expires_at) <= Date.now()) || session.state === "expired") throw unavailable();
    if (session.card_id) {
      const { data: card } = await database.from("cards").select("id").eq("id", session.card_id).eq("user_id", client.userId).maybeSingle();
      if (!card) throw unavailable();
    } else if (asset.state === "attached") throw unavailable();
    return deliverMedia(database, mediaObjectPath(session, asset), asset.mime_type);
  } catch (error) { return apiErrorFromUnknown(error); }
}
