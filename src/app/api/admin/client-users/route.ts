import { adminClientMutation } from "@/lib/admin-client-mutations-server";
import { readAdminInventory } from "@/lib/admin-inventory-server";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return readAdminInventory(request, "client_users");
}

export async function POST(request: Request) { return adminClientMutation(request, "create-staff"); }
