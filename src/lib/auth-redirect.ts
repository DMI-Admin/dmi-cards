const canonicalProductionOrigin = "https://app.dmicards.com";

export function buildAuthCallbackRedirectUrl(nextPath: string) {
  const url = new URL("/auth/callback", resolveAuthRedirectOrigin());
  url.searchParams.set("next", nextPath);
  return url.toString();
}

function resolveAuthRedirectOrigin() {
  if (typeof window !== "undefined") {
    const currentOrigin = window.location.origin;
    const currentHost = window.location.hostname.toLowerCase();

    if (isLocalHost(currentHost)) {
      return currentOrigin;
    }
  }

  return resolveConfiguredProductionOrigin();
}

function resolveConfiguredProductionOrigin() {
  const configuredOrigin =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    canonicalProductionOrigin;

  try {
    const url = new URL(configuredOrigin);
    const hostname = url.hostname.toLowerCase();

    if (isLocalHost(hostname) || hostname.endsWith(".vercel.app")) {
      return canonicalProductionOrigin;
    }

    return url.origin;
  } catch {
    return canonicalProductionOrigin;
  }
}

function isLocalHost(hostname: string) {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.endsWith(".localhost")
  );
}
