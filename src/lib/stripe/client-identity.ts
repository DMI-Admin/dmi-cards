import "server-only";
import { bearerTokenFromRequest, createApiSupabaseClient } from "@/lib/api/client-context";
import { ApiRouteError } from "@/lib/api/responses";

// Billing management authenticates ownership, independently of effective Pro.
// It does not grant features or change the application's suspension policy.
export async function requireBillingIdentity(request: Request) {
  const token = bearerTokenFromRequest(request);
  if (!token) throw new ApiRouteError(401, "UNAUTHENTICATED", "Authentication is required.");
  const { data, error } = await createApiSupabaseClient(token).auth.getUser(token);
  if (error || !data.user) throw new ApiRouteError(401, "UNAUTHENTICATED", "Authentication is required.");
  return { userId: data.user.id, email: data.user.email || null, profileId: data.user.id };
}
