import { editableMediaValue } from "@/lib/client-media-intent";
import { mediaFields, resolveCardMedia } from "@/lib/card-media";
import { isFieldVisible, type SharedClientCard } from "@/lib/services/card-payload";

export function incompleteVisibleMedia(card: SharedClientCard, capabilities: Record<typeof mediaFields[keyof typeof mediaFields], boolean>) {
  const labels = { profile: "Profile photo", logo: "Company logo", banner: "Banner" };
  return (Object.keys(mediaFields) as Array<keyof typeof mediaFields>).flatMap(kind => {
    const field = mediaFields[kind];
    const value = editableMediaValue(card, field);
    if (!capabilities[field] || !isFieldVisible(field, card) || resolveCardMedia(value)) return [];
    const upload = kind === "profile" ? "photo" : kind;
    return [{ key: field, label: labels[kind], uploadLabel: `Upload ${upload}`, detail: `${labels[kind]} is set to visible, but no ${upload} has been uploaded.` }];
  });
}
