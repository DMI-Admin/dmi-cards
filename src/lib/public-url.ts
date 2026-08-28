const fallbackPublicAppOrigin = "https://app.dmicards.com";

export function getCanonicalPublicAppOrigin() {
  const configuredOrigin =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim();

  if (configuredOrigin) {
    return normalisePublicOrigin(configuredOrigin);
  }

  if (isVercelPreviewEnvironment()) {
    const previewOrigin = vercelPreviewOrigin();

    if (previewOrigin) {
      return previewOrigin;
    }
  }

  return fallbackPublicAppOrigin;
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

function isVercelPreviewEnvironment() {
  return (
    process.env.NEXT_PUBLIC_VERCEL_ENV === "preview" ||
    process.env.VERCEL_ENV === "preview"
  );
}

function vercelPreviewOrigin() {
  const deploymentHost =
    process.env.NEXT_PUBLIC_VERCEL_URL?.trim() ||
    process.env.VERCEL_URL?.trim();

  if (!deploymentHost) return null;

  try {
    const url = deploymentHost.startsWith("http://") ||
      deploymentHost.startsWith("https://")
      ? new URL(deploymentHost)
      : new URL(`https://${deploymentHost}`);

    if (url.protocol !== "https:") return null;

    return url.origin;
  } catch {
    return null;
  }
}
