import { NextResponse } from "next/server";
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import {
  adminForbiddenMessage,
  adminRoutePatterns,
  adminUnauthorizedPath,
  isApprovedAdmin,
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

  if (
    !isApprovedAdmin({
      userId: adminAuth.userId,
      sessionClaims: adminAuth.sessionClaims,
    })
  ) {
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
  matcher: ["/((?!_next|.*\\..*).*)", "/(api|trpc)(.*)"],
};
