/** Read-only support DTO. Deliberately excludes card content, media and leads. */
export type SupportCard = {
  id: string; userId: string | null; clientId: string | null;
  name: string; ownerName: string | null; company: string | null;
  accountType: "individual" | "business" | "unknown";
  templateId: string | null; templateName: string | null;
  recordedPlan: string | null; status: string | null; published: boolean;
  slug: string | null; publicPath: string | null; unavailableReason: string | null;
  createdAt: string | null; updatedAt: string | null;
};
export type SupportInventory = {
  cards: SupportCard[]; page: number; pageSize: number; total: number;
  summary: { total: number; published: number; unpublished: number; business: number; individual: number };
};

export function isSupportPublished(row: { status?: unknown; is_published?: unknown }) {
  // Same OR contract as the public card resolver and its template lookup.
  return row.status === "published" || row.is_published === true;
}

export function supportPublicPath(card: { slug?: unknown; status?: unknown; is_published?: unknown }, template: { status?: unknown; is_published?: unknown } | null) {
  if (!isSupportPublished(card) || !template || !isSupportPublished(template)) return null;
  // Never trust saved URLs or invent a slug. Conservative single route segment.
  if (typeof card.slug !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,199}$/.test(card.slug)) return null;
  return `/u/${encodeURIComponent(card.slug)}`;
}
