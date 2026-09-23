import { adminClientMutation } from "@/lib/admin-client-mutations-server";
export async function PATCH(request: Request, context: { params: Promise<{ clientId: string }> }) {
  return adminClientMutation(request, "status", (await context.params).clientId);
}
