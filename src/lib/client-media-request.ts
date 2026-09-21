import { mediaAssetId, resolveCardMedia } from "@/lib/card-media";

// Coalesce only simultaneous downloads, scoped to the exact authorization token.
// Settled results are never cached: a later mount must recheck authorization/state.
export function createPrivateMediaLoader(
  getToken: () => Promise<string | null>,
  download: typeof fetch,
) {
  const pending = new Map<string, Promise<Blob>>();
  return async (reference: string): Promise<Blob> => {
    const asset = mediaAssetId(reference);
    if (!asset) throw new Error("Image unavailable.");
    const token = await getToken();
    if (!token) throw new Error("Image unavailable.");
    const key = `${token}:${asset}`;
    const existing = pending.get(key);
    if (existing) return existing;
    const request = (async () => {
      const response = await download(resolveCardMedia(reference), {
        headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
      });
      if (!response.ok) throw new Error("Image unavailable.");
      return response.blob();
    })();
    pending.set(key, request);
    try { return await request; } finally { pending.delete(key); }
  };
}
