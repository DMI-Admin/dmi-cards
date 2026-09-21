import type { MediaRequestTiming } from "@/lib/media-request-timing";
import "server-only";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { requireApiClient } from "@/lib/api/client-context";
import { ApiRouteError } from "@/lib/api/responses";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { normalizeTemplate } from "@/lib/templates";
import { canSelectTemplate } from "@/lib/services/card-payload";

export const cardMediaBucket = "card-media";
export const cardMediaUploadLimit = 2 * 1024 * 1024;
const capabilities = { profile: "profile_image_allowed", logo: "logo_allowed", banner: "banner_allowed" } as const;
export type CardMediaKind = keyof typeof capabilities;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function invalid(message: string): never { throw new ApiRouteError(400, "INVALID_REQUEST", message); }
function unavailable(): never { throw new ApiRouteError(404, "NOT_FOUND", "Media session or card unavailable."); }

// Identity always comes from the protected Client boundary, never submitted fields.
type VerifiedClient = Awaited<ReturnType<typeof requireApiClient>>;

async function authorizedTemplate(request: Request, templateId: string, verifiedClient?: VerifiedClient, timing?: MediaRequestTiming) {
  const endAuth = !verifiedClient ? timing?.start("auth") : undefined;
  const client = verifiedClient ?? await requireApiClient(request);
  endAuth?.();
  if (client.plan !== "free" && client.plan !== "pro") throw new ApiRouteError(403, "FORBIDDEN", "Media staging is not enabled for this account.");
  if (!uuid.test(templateId)) invalid("Invalid template ID.");
  const database = createSupabaseAdminClient();
  const endTemplate = timing?.start("template");
  const { data, error } = await database.from("templates").select("*").eq("id", templateId)
    .or("status.eq.published,is_published.eq.true").maybeSingle();
  endTemplate?.();
  if (error) throw new ApiRouteError(503, "INTERNAL_ERROR", "Could not check media template.");
  if (!data) unavailable();
  const template = normalizeTemplate(data);
  if (!canSelectTemplate(template, client.plan)) throw new ApiRouteError(403, "FORBIDDEN", "Template is not included in your plan.");
  return { client, database, template };
}

export async function beginCardMediaSession(request: Request, templateId: string, cardId?: string, timing?: MediaRequestTiming) {
  const { client, database } = await authorizedTemplate(request, templateId, undefined, timing);
  if (cardId) {
    if (!uuid.test(cardId)) invalid("Invalid card ID.");
    const { data, error } = await database.from("cards").select("id").eq("id", cardId).eq("user_id", client.userId).maybeSingle();
    if (error) throw new ApiRouteError(503, "INTERNAL_ERROR", "Could not check card ownership.");
    if (!data) unavailable();
  }
  const endSession = timing?.start("session");
  const { data, error } = await database.from("card_media_sessions")
    .insert({ owner_user_id: client.userId, template_id: templateId, card_id: cardId || null })
    .select("id,expires_at").single();
  endSession?.();
  if (error || !data) throw new ApiRouteError(503, "INTERNAL_ERROR", "Could not start media session.");
  return data as { id: string; expires_at: string };
}

// Takes bytes, not a trusted browser MIME/path. Re-encoding strips metadata and
// rejects animations/SVG. No upload occurs here; only a retryable reservation.
export async function prepareCardMediaAsset(request: Request, sessionId: string, kind: CardMediaKind, bytes: Buffer, verifiedClient?: VerifiedClient, timing?: MediaRequestTiming) {
  if (!uuid.test(sessionId) || !Object.hasOwn(capabilities, kind)) invalid("Invalid media selection.");
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > cardMediaUploadLimit) invalid("Image exceeds the upload limit.");
  const endAuth = !verifiedClient ? timing?.start("auth") : undefined;
  const client = verifiedClient ?? await requireApiClient(request);
  endAuth?.();
  const database = createSupabaseAdminClient();
  const { data: session, error } = await database.from("card_media_sessions").select("template_id,card_id")
    .eq("id", sessionId).eq("owner_user_id", client.userId).eq("state", "pending").maybeSingle();
  if (error) throw new ApiRouteError(503, "INTERNAL_ERROR", "Could not check media session.");
  if (!session) unavailable();
  const { template } = await authorizedTemplate(request, session.template_id, client, timing);
  if (template[capabilities[kind]] !== true) throw new ApiRouteError(403, "FORBIDDEN", "Template does not support this media.");
  if (session.card_id) {
    const { data, error: cardError } = await database.from("cards").select("id").eq("id", session.card_id).eq("user_id", client.userId).maybeSingle();
    if (cardError) throw new ApiRouteError(503, "INTERNAL_ERROR", "Could not check card ownership.");
    if (!data) unavailable();
  }
  const endNormalization = timing?.start("normalization");
  let normalized: Buffer;
  try {
    const source = sharp(bytes, { limitInputPixels: 20000000, failOn: "warning" });
    const meta = await source.metadata();
    if (!["jpeg", "png", "webp"].includes(meta.format || "") || (meta.pages || 1) !== 1) invalid("Unsupported image format.");
    normalized = await source.rotate().resize({ width: kind === "banner" ? 1500 : 512,
      height: kind === "banner" ? 500 : 512, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 85 }).toBuffer();
  } catch { return invalid("Image could not be decoded safely."); } finally { endNormalization?.(); }
  if (normalized.length > cardMediaUploadLimit) invalid("Processed image exceeds the upload limit.");
  const hash = createHash("sha256").update(normalized).digest("hex");
  const endReservation = timing?.start("reservation");
  const { data, error: reservationError } = await database.rpc("reserve_card_media_asset", {
    p_owner: client.userId, p_session: sessionId, p_kind: kind, p_sha256: hash,
    p_mime: "image/webp", p_size: normalized.length,
  });
  endReservation?.();
  if (reservationError || !data) throw new ApiRouteError(409, "CONFLICT", "Media session expired or reservation unavailable. Start a new session.");
  // Internal result for the protected upload handler, not an API response.
  return { ownerId: client.userId, reservation: data, bytes: normalized, contentType: "image/webp" as const, sha256: hash };
}
