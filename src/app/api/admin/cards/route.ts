import { adminCardMutation } from "@/lib/admin-card-mutations-server";
import { readAdminInventory } from "@/lib/admin-inventory-server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return readAdminInventory(request, "cards");
}

export async function POST(request: Request) {
  return adminCardMutation(request, "create");
}
