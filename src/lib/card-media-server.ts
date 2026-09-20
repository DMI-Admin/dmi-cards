import "server-only";
import { createHash } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { ApiRouteError } from "@/lib/api/responses";
import { prepareCardMediaAsset, cardMediaBucket } from "@/lib/card-media-staging-server";
import { mediaUuid, type MediaKind } from "@/lib/card-media";

export async function cardEditSnapshot(owner: string, cardId: string, database = createSupabaseAdminClient()) {
  if (!mediaUuid.test(cardId)) throw new ApiRouteError(400, "INVALID_REQUEST", "Invalid card ID.");
  const { data, error } = await database.rpc("get_client_card_edit_snapshot", { p_owner: owner, p_card_id: cardId });
  if (error) throw new ApiRouteError(503, "INTERNAL_ERROR", "Could not load the card snapshot. Please retry.");
  if (!data) throw new ApiRouteError(404, "NOT_FOUND", "Card not found.");
  return data;
}
export async function uploadCardMedia(request: Request, sessionId: string, kind: MediaKind, bytes: Buffer) {
  const prepared = await prepareCardMediaAsset(request, sessionId, kind, bytes);
  const database = createSupabaseAdminClient();
  const path = prepared.reservation.object_path as string;
  const assetId = prepared.reservation.asset_id as string;
  if (!mediaUuid.test(assetId) || typeof path !== "string") throw new ApiRouteError(503, "INTERNAL_ERROR", "Invalid media reservation.");
  const storage = database.storage.from(cardMediaBucket);
  const uploaded = await storage.upload(path, prepared.bytes, { contentType: prepared.contentType, upsert: false });
  // A retry may find the same immutable object. Verify bytes even on duplicate error.
  if (uploaded.error && !["409", "400"].includes(String(uploaded.error.statusCode))) {
    throw new ApiRouteError(503, "INTERNAL_ERROR", "Image upload failed. Your existing image is unchanged; retry save.");
  }
  const verified = await storage.download(path);
  if (verified.error || !verified.data || verified.data.size !== prepared.bytes.length || verified.data.type.split(";")[0] !== prepared.contentType
    || createHash("sha256").update(Buffer.from(await verified.data.arrayBuffer())).digest("hex") !== prepared.sha256) {
    throw new ApiRouteError(503, "INTERNAL_ERROR", "Uploaded image verification failed. Retry save.");
  }
  const { error } = await database.rpc("mark_card_media_ready", {
    p_owner: prepared.ownerId, p_session: sessionId, p_asset: assetId,
  });
  if (error) throw new ApiRouteError(409, "CONFLICT", "Media session expired or changed. The uploaded asset remains tracked for cleanup.");
  return { assetId, reference: `card-media:${assetId}` };
}
export function mediaObjectPath(session: { owner_user_id: string; id: string }, asset: { kind: string; id: string; mime_type: string }) {
  const ext = asset.mime_type === "image/jpeg" ? "jpg" : asset.mime_type === "image/png" ? "png" : asset.mime_type === "image/webp" ? "webp" : null;
  if (!ext) throw new ApiRouteError(404, "NOT_FOUND", "Image unavailable.");
  return `${session.owner_user_id}/${session.id}/${asset.kind}/${asset.id}.${ext}`;
}
export async function deliverMedia(database: ReturnType<typeof createSupabaseAdminClient>, path: string, mime: string) {
  const { data, error } = await database.storage.from(cardMediaBucket).download(path);
  if (error || !data) throw new ApiRouteError(404, "NOT_FOUND", "Image unavailable.");
  return new Response(data, { headers: { "Content-Type": mime, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox" } });
}
