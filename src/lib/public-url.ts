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
    return new URL(value).origin;
  } catch {
    return fallbackPublicAppOrigin;
  }
}
