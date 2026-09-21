import { MediaRequestTiming } from "@/lib/media-request-timing";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { mediaUuid, mediaFields, mediaAssetId, mediaValue, type MediaKind } from "@/lib/card-media";
import { deliverMedia, mediaObjectPath } from "@/lib/card-media-server";
import { normalizeTemplate } from "@/lib/templates";
import { ApiRouteError, apiErrorFromUnknown } from "@/lib/api/responses";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: { params: Promise<{ slug: string; kind: string }> }) {
  const timing = new MediaRequestTiming();
  try {
    const { slug: cardId, kind } = await context.params;
    const unavailable = () => new ApiRouteError(404, "NOT_FOUND", "Image unavailable.");
    if (!mediaUuid.test(cardId) || !Object.hasOwn(mediaFields, kind)) throw unavailable();
    const database = createSupabaseAdminClient();
    const { data: card } = await timing.measure("card_lookup", () => database.from("cards").select("*").eq("id", cardId).maybeSingle());
    if (!card || !(card.status === "published" || card.is_published === true)) throw unavailable();
    const assetId = mediaAssetId(mediaValue(card, kind as MediaKind));
    if (!assetId) throw unavailable();
    // Independent reads; both checks must pass before session authorization/download.
    const [{ data: rawTemplate }, { data: asset }] = await Promise.all([
      timing.measure("template", () => database.from("templates").select("*").eq("id", card.template_id).or("status.eq.published,is_published.eq.true").maybeSingle()),
      timing.measure("asset_lookup", () => database.from("card_media_assets").select("*").eq("id", assetId).eq("kind", kind).eq("state", "attached").maybeSingle()),
    ]);
    if (!rawTemplate) throw unavailable();
    const template = normalizeTemplate(rawTemplate);
    const capability = { profile: template.profile_image_allowed, logo: template.logo_allowed, banner: template.banner_allowed }[kind];
    const aliases = { profile: ["profile_image_url", "profile_image"], logo: ["company_logo_url", "company_logo", "logo"], banner: ["company_banner_url", "company_banner", "banner"] }[kind]!;
    if (capability !== true || aliases.some(key => card.hidden_fields?.includes(key) || card.field_visibility?.[key] === false)) throw unavailable();
    if (!asset) throw unavailable();
    const { data: session } = await timing.measure("session_lookup", () => database.from("card_media_sessions").select("*").eq("id", asset.session_id).eq("owner_user_id", card.user_id).eq("card_id", cardId).eq("state", "attached").maybeSingle());
    if (!session) throw unavailable();
    return timing.response(await timing.measure("storage_download", () => deliverMedia(database, mediaObjectPath(session, asset), asset.mime_type)));
  } catch (error) { return timing.response(apiErrorFromUnknown(error)); }
}
