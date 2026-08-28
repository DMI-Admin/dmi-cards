export const adminUnauthorizedPath = "/admin/unauthorized";
export const adminForbiddenMessage = "Admin access is required.";

export const adminRoutePatterns = [
  "/admin(.*)",
  "/dashboard(.*)",
  "/clients(.*)",
  "/templates(.*)",
  "/cards(.*)",
  "/public-pages(.*)",
  "/qr-codes(.*)",
  "/subscriptions(.*)",
  "/finance(.*)",
  "/analytics(.*)",
  "/uploads(.*)",
  "/support(.*)",
  "/audit-logs(.*)",
  "/settings(.*)",
  "/security(.*)",
  "/api/admin(.*)",
];

type AdminIdentity = {
  userId?: string | null;
  email?: string | null;
  sessionClaims?: unknown;
};

type AdminAccessResult =
  | {
      authorized: true;
      userId: string;
    }
  | {
      authorized: false;
      status: 403;
      error: string;
    };

export function isApprovedAdmin(identity: AdminIdentity) {
  const userId = identity.userId?.trim();
  const email =
    identity.email?.trim().toLowerCase() ||
    emailFromSessionClaims(identity.sessionClaims);
  const adminUserIds = envList(
    "DMI_ADMIN_CLERK_USER_IDS",
    "DMI_ADMIN_CLERK_USER_ID",
    "CLERK_ADMIN_USER_IDS",
    "CLERK_ADMIN_USER_ID"
  );
  const adminEmails = envList(
    "DMI_ADMIN_EMAILS",
    "DMI_ADMIN_EMAIL",
    "ADMIN_EMAILS",
    "ADMIN_EMAIL"
  ).map((item) => item.toLowerCase());

  if (userId && adminUserIds.includes(userId)) return true;
  if (email && adminEmails.includes(email)) return true;

  return false;
}

export async function requireAdminAccess(
  identity: AdminIdentity,
  loadEmail?: () => Promise<string | null>
): Promise<AdminAccessResult> {
  const userId = identity.userId?.trim() || null;

  if (!userId) {
    return {
      authorized: false,
      status: 403,
      error: adminForbiddenMessage,
    };
  }

  if (isApprovedAdmin(identity)) {
    return { authorized: true, userId };
  }

  const email = loadEmail ? await loadEmail().catch(() => null) : null;

  if (email && isApprovedAdmin({ userId, email })) {
    return { authorized: true, userId };
  }

  return {
    authorized: false,
    status: 403,
    error: adminForbiddenMessage,
  };
}

export function isAdminAllowlistConfigured() {
  return (
    envList(
      "DMI_ADMIN_CLERK_USER_IDS",
      "DMI_ADMIN_CLERK_USER_ID",
      "CLERK_ADMIN_USER_IDS",
      "CLERK_ADMIN_USER_ID"
    ).length > 0 ||
    envList("DMI_ADMIN_EMAILS", "DMI_ADMIN_EMAIL", "ADMIN_EMAILS", "ADMIN_EMAIL")
      .length > 0
  );
}

export function emailFromClerkUser(user: unknown) {
  if (!user || typeof user !== "object") return null;

  const clerkUser = user as {
    primaryEmailAddress?: { emailAddress?: string | null } | null;
    emailAddresses?: Array<{ emailAddress?: string | null }>;
  };

  const email =
    clerkUser.primaryEmailAddress?.emailAddress ||
    clerkUser.emailAddresses?.find((item) => item.emailAddress)?.emailAddress;

  return email?.trim().toLowerCase() || null;
}

function envList(...keys: string[]) {
  return keys.flatMap((key) =>
    (process.env[key] || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

function emailFromSessionClaims(sessionClaims: unknown) {
  if (!sessionClaims || typeof sessionClaims !== "object") return null;

  const claims = sessionClaims as Record<string, unknown>;
  const candidate =
    claims.email ||
    claims.email_address ||
    claims.primary_email_address ||
    claims.primaryEmailAddress;

  return typeof candidate === "string" ? candidate.trim().toLowerCase() : null;
}
