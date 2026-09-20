import { adminCardMutation } from "@/lib/admin-card-mutations-server";
type Context = { params: Promise<{ cardId: string }> };
export async function PATCH(request: Request, context: Context) {
  return adminCardMutation(request, "publish", (await context.params).cardId);
}
export async function DELETE(request: Request, context: Context) {
  return adminCardMutation(request, "delete", (await context.params).cardId);
}
