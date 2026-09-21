import { startClientMediaTiming } from "@/lib/client-media-timing";
import { editableMediaValue, plannedMediaOperation } from "@/lib/client-media-intent";
import { md } from "node-forge";
import { supabase } from "@/lib/supabase";
import { mediaFields, mediaValue, mediaAssetId, type MediaKind, type MediaSave, type MediaIntent } from "@/lib/card-media";
import type { SharedClientCard, SupabaseCardRow } from "@/lib/services/card-payload";

type Snapshot = { card: SupabaseCardRow; revision: string };
type Pending = { hash: string; sessionId: string; revision: string | null; intents: Partial<Record<MediaKind, MediaIntent>>; frozen: boolean };
const snapshots = new Map<string, Snapshot>();
const inFlight = new Set<string>();
export async function clientMediaRequest(path: string, init?: RequestInit) {
  const endRequest = startClientMediaTiming(path === "/api/client/media/sessions" ? "session" : path === "/api/client/cards" ? "save_response" : "request");
  try {
  const endAuth = startClientMediaTiming("auth");
  const { data: { session } } = await supabase.auth.getSession();
  endAuth();
  if (!session?.access_token) throw new Error("Please sign in again.");
  const headers = new Headers(init?.headers); headers.set("Authorization", `Bearer ${session.access_token}`);
  const response = await fetch(path, { ...init, headers, cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || "Request failed. Please retry.");
  return body.data;
  } finally { endRequest(); }
}
function pendingKey(userId: string, id: string) { return `dmi-media-save:${userId}:${id}`; }
function readPending(key: string): Pending | null {
  const raw = sessionStorage.getItem(key);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { throw new Error("Save recovery state is unreadable. Reopen the editor."); }
}
function storePending(key: string, value: Pending) {
  // Fail BEFORE finalization if durable same-tab retry state cannot be retained.
  sessionStorage.setItem(key, JSON.stringify(value));
}
export async function loadEditableCard(cardId: string, options: { resumeSave?: boolean } = {}): Promise<Snapshot> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Please sign in again.");
  if (options.resumeSave) {
    const pending = readPending(pendingKey(session.user.id, cardId));
    if (pending) {
      const opening = snapshots.get(`${session.user.id}:${cardId}:${pending.revision}`);
      if (!opening) throw new Error("A previous save needs review. Open the editor to inspect the current card before a new action.");
      return opening;
    }
  }
  const snapshot = await clientMediaRequest(`/api/client/cards/${encodeURIComponent(cardId)}`) as Snapshot;
  if (!snapshot?.card || !/^[0-9a-f]{64}$/.test(snapshot.revision)) throw new Error("Could not load a valid card revision.");
  snapshots.set(`${session.user.id}:${cardId}:${snapshot.revision}`, snapshot);
  // Explicit reopening starts a new edit against the returned snapshot, not a retry.
  sessionStorage.removeItem(pendingKey(session.user.id, cardId));
  return snapshot;
}
export async function saveCardWithMedia(card: SharedClientCard, mode: "create" | "edit") {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Please sign in again.");
  const key = pendingKey(session.user.id, card.id);
  if (inFlight.has(key)) throw new Error("A save is already in progress.");
  inFlight.add(key);
  try {
    const editing = mode === "edit" && !card.id.startsWith("card-");
    const snapshot = snapshots.get(`${session.user.id}:${card.id}:${card.edit_revision}`);
    let pending = readPending(key);
    if (editing && !snapshot && !pending) throw new Error("Open the card editor before saving this card.");
    // Local retry fingerprint only: preserve UTF-8 SHA-256 on HTTP staging origins
    // where Safari has no Web Crypto. Media integrity remains server-validated.
    const hash = md.sha256.create().update(JSON.stringify({ card, mode }), "utf8").digest().toHex();
    if (pending && pending.hash !== hash) {
      if (pending.frozen) throw new Error("The previous save may have completed. Retry unchanged, or reopen this card to review its saved state before a new edit.");
      pending = null; // Unsubmitted upload session expires; no card references changed.
    }
    // Validate all three intents before creating a session or uploading anything.
    const planned = Object.fromEntries((Object.keys(mediaFields) as MediaKind[]).map(kind => [kind,
      plannedMediaOperation(card, kind, snapshot ? mediaValue(snapshot.card as unknown as Record<string, unknown>, kind) : "", editing),
    ]));
    if (!pending) {
      const result = await clientMediaRequest("/api/client/media/sessions", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: card.template_id, cardId: editing ? card.id : null }) });
      pending = { hash, sessionId: result.id, revision: editing ? snapshot!.revision : null, intents: {}, frozen: false };
      storePending(key, pending);
    }
    for (const kind of Object.keys(mediaFields) as MediaKind[]) {
      if (pending.intents[kind]) continue;
      const field = mediaFields[kind];
      const value = editableMediaValue(card, field);
      if (planned[kind] === "remove") pending.intents[kind] = { operation: "remove" };
      else if (planned[kind] === "retain") pending.intents[kind] = { operation: "retain" };
      else {
        if (!/^data:image\/(png|jpeg|webp);base64,/i.test(value) || mediaAssetId(value)) throw new Error("Choose an image file to replace this media; arbitrary URLs cannot be saved.");
        const image = await fetch(value).then(response => response.blob());
        const form = new FormData(); form.set("sessionId", pending.sessionId); form.set("kind", kind); form.set("file", image, `${kind}.image`);
        const endUpload = startClientMediaTiming(`upload_${kind}`);
        let uploaded;
        try { uploaded = await clientMediaRequest("/api/client/media/upload", { method: "POST", body: form }); }
        finally { endUpload(); }
        pending.intents[kind] = { operation: "replace", asset_id: uploaded.assetId };
      }
      storePending(key, pending);
    }
    const clean = { ...card, custom_fields: { ...(card.custom_fields || {}) } };
    for (const field of Object.values(mediaFields)) { delete clean[field]; delete clean.custom_fields[field]; }
    delete clean.edit_revision;
    delete clean.media_edits;
    const media: MediaSave = { sessionId: pending.sessionId, revision: pending.revision, intents: pending.intents as MediaSave["intents"] };
    pending.frozen = true; storePending(key, pending);
    const response = await clientMediaRequest("/api/client/cards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ card: clean, mode, media }) });
    if (!response?.card) throw new Error("Save response missing. Retry the same save.");
    if (!/^[0-9a-f]{64}$/.test(response.card.edit_revision || "")) throw new Error("Save revision missing. Retry the same save.");
    snapshots.delete(`${session.user.id}:${card.id}:${card.edit_revision}`);
    snapshots.set(`${session.user.id}:${response.card.id}:${response.card.edit_revision}`, { card: response.card, revision: response.card.edit_revision });
    sessionStorage.removeItem(key);
    return response.card as SupabaseCardRow;
  } finally { inFlight.delete(key); }
}
