import { buildPublicCardUrl, getCanonicalPublicAppOrigin } from "@/lib/public-url";

// UI navigation only. Never use this helper for persisted URLs, QR or Wallet.
export function clientPublicCardNavigationUrl(slug: string | undefined, savedPublicUrl = "") {
  const canonicalUrl = slug ? buildPublicCardUrl(slug) : savedPublicUrl;
  if (typeof window !== "undefined" && process.env.NEXT_PUBLIC_VERCEL_ENV !== "production") {
    const origin = new URL(window.location.origin);
    if (origin.protocol === "https:" && origin.hostname.endsWith(".vercel.app")) {
      // Older mapped cards may carry only public_url, without a separate slug.
      try {
        const publicUrl = new URL(canonicalUrl, getCanonicalPublicAppOrigin());
        if (publicUrl.pathname.startsWith("/u/")) return `${origin.origin}${publicUrl.pathname}${publicUrl.search}${publicUrl.hash}`;
      } catch { /* Preserve the existing link if it cannot be resolved safely. */ }
    }
  }
  return canonicalUrl;
}
