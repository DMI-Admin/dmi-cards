export const adminUnauthorizedPath = "/admin/unauthorized";
export const adminForbiddenMessage = "Admin access is required.";

export const adminRoutePatterns = [
  "/admin(.*)",
  "/dashboard(.*)",
  "/clients(.*)",
  "/business-onboarding(.*)",
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
  "/system-health(.*)",
  "/settings(.*)",
  "/security(.*)",
  "/api/admin(.*)",
];

type AdminIdentity = {
  userId?: string | null;
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

// Callers must supply the identity returned by Clerk's server-side auth().
export function isApprovedAdmin(identity: AdminIdentity) {
  return Boolean(identity.userId && adminUserIds().includes(identity.userId));
}

export async function requireAdminAccess(
  identity: AdminIdentity
): Promise<AdminAccessResult> {
  if (identity.userId && isApprovedAdmin(identity)) {
    return { authorized: true, userId: identity.userId };
  }

  return {
    authorized: false,
    status: 403,
    error: adminForbiddenMessage,
  };
}

export function isAdminAllowlistConfigured() {
  return adminUserIds().length > 0;
}

function adminUserIds() {
  return (process.env.DMI_ADMIN_CLERK_USER_IDS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

// Display only on the unauthorized page; never used to authorize access.
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
