import { NextResponse } from "next/server";
import { clerkClient, clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import {
  adminForbiddenMessage,
  adminRoutePatterns,
  adminUnauthorizedPath,
  emailFromClerkUser,
  requireAdminAccess,
} from "@/lib/admin-auth";

const isAdminRoute = createRouteMatcher(adminRoutePatterns);
const isAdminEntryRoute = createRouteMatcher(["/admin"]);
const isAdminUnauthorizedRoute = createRouteMatcher([adminUnauthorizedPath]);
const isAdminApiRoute = createRouteMatcher(["/api/admin(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (!isAdminRoute(req) || isAdminUnauthorizedRoute(req)) {
    return;
  }

  if (isAdminEntryRoute(req)) {
    return;
  }

  const adminAuth = await auth();

  if (!adminAuth.userId) {
    if (isAdminApiRoute(req)) {
      return NextResponse.json(
        { error: adminForbiddenMessage },
        { status: 403 }
      );
    }

    return NextResponse.redirect(new URL("/admin", req.url));
  }

  // Use the same fallback as the Admin APIs without calling the App Router's
  // currentUser()/auth() helpers inside middleware. ID/claim matches skip it.
  const adminAccess = await requireAdminAccess(adminAuth, async () =>
    emailFromClerkUser(await (await clerkClient()).users.getUser(adminAuth.userId))
  );

  if (!adminAccess.authorized) {
    if (isAdminApiRoute(req)) {
      return NextResponse.json(
        { error: adminForbiddenMessage },
        { status: 403 }
      );
    }

    return NextResponse.redirect(new URL(adminUnauthorizedPath, req.url));
  }
});

export const config = {
  matcher: ["/((?!api/health|_next|.*\\..*).*)", "/(api/(?!health)|trpc)(.*)"],
};
