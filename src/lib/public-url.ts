const fallbackPublicAppOrigin = "https://app.dmicards.com";

export function getCanonicalPublicAppOrigin() {
  const configuredOrigin =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    fallbackPublicAppOrigin;

  return normalisePublicOrigin(configuredOrigin);
}

export function buildPublicCardUrl(slug: string) {
  const cleanSlug = slug.trim().replace(/^\/+|\/+$/g, "");

  return `${getCanonicalPublicAppOrigin()}/u/${encodeURIComponent(cleanSlug)}`;
}

function normalisePublicOrigin(value: string) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();

    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".vercel.app")
    ) {
      return fallbackPublicAppOrigin;
    }

    return url.origin;
  } catch {
    return fallbackPublicAppOrigin;
  }
}
