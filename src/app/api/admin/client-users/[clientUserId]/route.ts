import { adminClientMutation } from "@/lib/admin-client-mutations-server";
type Context = { params: Promise<{ clientUserId: string }> };
export async function PATCH(request: Request, context: Context) { return adminClientMutation(request, "update-staff", (await context.params).clientUserId); }
export async function DELETE(request: Request, context: Context) { return adminClientMutation(request, "delete-staff", (await context.params).clientUserId); }
