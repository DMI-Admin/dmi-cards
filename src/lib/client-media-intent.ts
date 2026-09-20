import type { SharedClientCard } from "@/lib/services/card-payload";
import { mediaFields, type MediaKind } from "@/lib/card-media";

export function editableMediaValue(card: SharedClientCard, field: typeof mediaFields[MediaKind]): string {
  if (card.media_edits?.[field] === "remove") return "";
  // An explicit replacement must use its new value, never the saved banner fallback.
  if (field === "company_banner_url" && !card.media_edits?.[field]) {
    const nested = card.custom_fields?.company_banner_url;
    return card[field] || (typeof nested === "string" ? nested : "");
  }
  return card[field] || "";
}

export function plannedMediaOperation(card: SharedClientCard, kind: MediaKind, previous: string, editing: boolean) {
  const field = mediaFields[kind];
  const value = editableMediaValue(card, field);
  const explicit = card.media_edits?.[field];
  if (explicit === "remove") return "remove";
  if ((explicit === "replace" && !value) || (previous && !value)) {
    throw new Error(`The ${kind} image disappeared unexpectedly. Reopen the card, or explicitly remove the image before saving.`);
  }
  if (editing && value === previous && explicit !== "replace") return "retain";
  // A new card has no previous reference to remove. Initialize its empty slot.
  if (!editing && !value && !explicit) return "remove";
  if (/^data:image\/(png|jpeg|webp);base64,/i.test(value)) return "replace";
  throw new Error(`The ${kind} image changed unexpectedly. Reopen the card or choose a replacement image.`);
}
