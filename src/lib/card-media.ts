export const mediaFields = { profile: "profile_image_url", logo: "company_logo_url", banner: "company_banner_url" } as const;
export type MediaKind = keyof typeof mediaFields;
export type MediaIntent = { operation: "retain" | "remove" } | { operation: "replace"; asset_id: string };
export type MediaSave = { sessionId: string; revision: string | null; intents: Record<MediaKind, MediaIntent> };
export const mediaUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function mediaAssetId(value: unknown): string | null {
  return typeof value === "string" && value.startsWith("card-media:") && mediaUuid.test(value.slice(11)) ? value.slice(11).toLowerCase() : null;
}
export function legacyMediaUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  if (/^data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(value)) return value;
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? value : ""; } catch { return ""; }
}
export function resolveCardMedia(value: unknown, publicCard?: { id: string; kind: MediaKind }): string {
  const asset = mediaAssetId(value);
  if (asset) return publicCard ? `/api/public/cards/${encodeURIComponent(publicCard.id)}/media/${publicCard.kind}` : `/api/client/media/${asset}`;
  // Only application-generated public delivery paths, never arbitrary relative input.
  if (typeof value === "string" && /^\/api\/public\/cards\/[0-9a-f-]{36}\/media\/(profile|logo|banner)$/.test(value)) return value;
  return legacyMediaUrl(value);
}
export function mediaValue(card: { [key: string]: unknown }, kind: MediaKind): string {
  const custom = card.custom_fields as Record<string, unknown> | undefined;
  const value = kind === "banner" ? custom?.company_banner_url ?? card.company_banner_url : card[mediaFields[kind]];
  return typeof value === "string" ? value : "";
}
