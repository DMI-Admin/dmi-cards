import { readAdminInventory } from "@/lib/admin-inventory-server";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return readAdminInventory(request, "clients");
}
