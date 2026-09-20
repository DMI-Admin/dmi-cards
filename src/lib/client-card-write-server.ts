import "server-only";
import { ApiRouteError } from "@/lib/api/responses";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { ensureUniqueCardSlug } from "@/lib/services/card-write-server";
import { buildCardSlugBase, type SharedClientCard } from "@/lib/services/card-payload";
import { validateClientCard } from "@/lib/client-card-contract";
import { mediaFields, mediaValue, mediaUuid, type MediaSave, type MediaKind } from "@/lib/card-media";
import { cardEditSnapshot } from "@/lib/card-media-server";
import type { SharedTemplate } from "@/lib/templates";

export async function writeValidatedClientCard({ database, card, userId, mode, plan, template, media }: {
  database: ReturnType<typeof createSupabaseAdminClient>;
  card: SharedClientCard; userId: string; mode: "create" | "edit"; plan: "free" | "pro";
  template: SharedTemplate; media: MediaSave;
}) {
  if (typeof card.id !== "string") throw new ApiRouteError(400, "INVALID_REQUEST", "Invalid card ID.");
  const editing = mode === "edit" && !card.id.startsWith("card-");
  if (!media || !mediaUuid.test(media.sessionId) || !media.intents || typeof media.intents !== "object"
    || Object.keys(media.intents).sort().join() !== "banner,logo,profile"
    || (editing ? !mediaUuid.test(card.id) || !/^[0-9a-f]{64}$/.test(media.revision || "") : media.revision !== null)) {
    throw new ApiRouteError(400, "INVALID_REQUEST", "Reopen the editor to obtain a valid save session and card revision.");
  }
  const { data: session, error: sessionError } = await database.from("card_media_sessions").select("id,owner_user_id,template_id,card_id,finalized_card_id")
    .eq("id", media.sessionId).eq("owner_user_id", userId).maybeSingle();
  if (sessionError) throw new ApiRouteError(503, "INTERNAL_ERROR", "Could not check the save session. Retry the same save.");
  if (!session || session.template_id !== template.id || (editing && session.card_id !== card.id && session.finalized_card_id !== card.id)
    || (!editing && session.card_id && !session.finalized_card_id)) throw new ApiRouteError(404, "NOT_FOUND", "Save session unavailable.");
  let original: Record<string, unknown> | null = null;
  if (editing) {
    const { data, error } = await database.from("cards").select("*").eq("id", card.id).eq("user_id", userId).maybeSingle();
    if (error) throw new ApiRouteError(503, "INTERNAL_ERROR", "Could not check card ownership.");
    if (!data) throw new ApiRouteError(404, "NOT_FOUND", "Card not found.");
    original = data;
  }
  const candidate = { ...card, custom_fields: { ...(card.custom_fields || {}) } };
  for (const kind of Object.keys(mediaFields) as MediaKind[]) {
    const field = mediaFields[kind]; const intent = media.intents[kind];
    if (!intent || typeof intent !== "object" || !["retain", "remove", "replace"].includes(intent.operation)
      || Object.keys(intent).sort().join() !== (intent.operation === "replace" ? "asset_id,operation" : "operation")) throw new ApiRouteError(400, "INVALID_REQUEST", "Invalid media intent.");
    if (card[field] || card.custom_fields?.[field]) throw new ApiRouteError(400, "INVALID_REQUEST", "Use media receipts, not inline image values.");
    let value = "";
    if (intent.operation === "retain") {
      if (!original) throw new ApiRouteError(400, "INVALID_REQUEST", "New cards cannot retain media.");
      // Validate capability by presence; never reserialize a large trusted legacy image.
      // SQL retains the exact owned DB value after checking the OPENING revision.
      value = mediaValue(original, kind) ? "retained-media" : "";
    } else if (intent.operation === "replace") {
      if (!mediaUuid.test(intent.asset_id)) throw new ApiRouteError(400, "INVALID_REQUEST", "Invalid image receipt.");
      const { data, error } = await database.from("card_media_assets").select("id,state,kind")
        .eq("id", intent.asset_id).eq("session_id", media.sessionId).maybeSingle();
      if (error) throw new ApiRouteError(503, "INTERNAL_ERROR", "Could not verify image receipt.");
      if (!data || data.kind !== kind || !["ready", "attached"].includes(data.state)) throw new ApiRouteError(409, "CONFLICT", "Image is not ready for this save.");
      value = `card-media:${data.id}`;
    }
    candidate[field] = value;
    delete candidate.custom_fields[field];
  }
  const payload = validateClientCard(candidate, template, plan);
  const { profile_image_url: _profile, company_logo_url: _logo, ...stripped } = payload;
  void _profile; void _logo;
  delete stripped.custom_fields.company_banner_url;
  const slug = editing ? undefined : await ensureUniqueCardSlug(buildCardSlugBase(card), null, database);
  const { data, error } = await database.rpc("finalize_client_card_media", {
    p_owner: userId, p_session: media.sessionId, p_operation: editing ? "edit" : "create",
    p_card_id: editing ? card.id : null, p_allowance: plan === "free" ? 1 : 3,
    p_validated_payload: editing ? stripped : { ...stripped, slug },
    p_asset_receipts: media.intents, p_expected_card_revision: media.revision,
  });
  if (error) {
    if (error.message?.includes("CARD_ALLOWANCE_EXHAUSTED")) throw new ApiRouteError(403, "FORBIDDEN", "Your card allowance is exhausted.");
    if (error.message?.includes("CARD_REVISION_CONFLICT")) throw new ApiRouteError(409, "CONFLICT", "This card changed since you opened it. Reopen the editor before making a new save.");
    if (error.message?.includes("MEDIA_IDEMPOTENCY_CONFLICT")) throw new ApiRouteError(409, "CONFLICT", "This save session already contains different changes. Reopen the editor to start a new edit.");
    throw new ApiRouteError(409, "CONFLICT", "Card save could not complete. Retry the same save; existing media is unchanged unless the previous attempt already succeeded.");
  }
  if (!data || data.card_missing) throw new ApiRouteError(404, "NOT_FOUND", "The saved card no longer exists.");
  // A fresh owned snapshot is the baseline for a SUBSEQUENT logical edit, not
  // a replacement for the opening revision used by this save/retry.
  const saved = await cardEditSnapshot(userId, data.card_id, database);
  return { ...saved.card, edit_revision: saved.revision };
}
