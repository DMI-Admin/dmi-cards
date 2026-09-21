import { MediaRequestTiming } from "@/lib/media-request-timing";
import { requireApiClient } from "@/lib/api/client-context";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { mediaUuid } from "@/lib/card-media";
import { deliverMedia, mediaObjectPath } from "@/lib/card-media-server";
import { ApiRouteError, apiErrorFromUnknown } from "@/lib/api/responses";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ assetId: string }> }) {
  const timing = new MediaRequestTiming();
  try {
    const client = await timing.measure("auth", () => requireApiClient(request)); const { assetId } = await context.params;
    const unavailable = () => new ApiRouteError(404, "NOT_FOUND", "Image unavailable.");
    if (!mediaUuid.test(assetId)) throw unavailable();
    const database = createSupabaseAdminClient();
    // Existing FK relationships; left embeds preserve ready new-card sessions.
    // asset_lookup now measures the entire authorization graph (one DB request).
    const { data, error } = await timing.measure("asset_lookup", () => database
      .from("card_media_assets")
      .select("id,session_id,kind,state,mime_type,session:card_media_sessions!card_media_assets_session_id_fkey(id,owner_user_id,card_id,state,expires_at,card:cards!card_media_sessions_card_id_fkey(id,user_id))")
      .eq("id", assetId).maybeSingle());
    const asset = data as unknown as {
      id: string; session_id: string; kind: string; state: string; mime_type: string;
      session: { id: string; owner_user_id: string; card_id: string | null; state: string; expires_at: string;
        card: { id: string; user_id: string } | null } | null;
    } | null;
    if (error || !asset || asset.id !== assetId || !["ready", "attached"].includes(asset.state)
      || !["profile", "logo", "banner"].includes(asset.kind)) throw unavailable();
    const session = asset.session;
    if (!session || session.id !== asset.session_id || session.owner_user_id !== client.userId
      || !["pending", "attached"].includes(session.state)
      || (session.state === "pending" && !(Date.parse(session.expires_at) > Date.now()))) throw unavailable();
    if (session.card_id) {
      if (!session.card || session.card.id !== session.card_id || session.card.user_id !== client.userId) throw unavailable();
    } else if (asset.state === "attached") throw unavailable();
    return timing.response(await timing.measure("storage_download", () => deliverMedia(database, mediaObjectPath(session, asset), asset.mime_type)));
  } catch (error) { return timing.response(apiErrorFromUnknown(error)); }
}
