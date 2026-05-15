import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isProtectedRoute = createRouteMatcher([
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
]);

export default clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)", "/(api|trpc)(.*)"],
};