import { readAdminInventory } from "@/lib/admin-inventory-server";
import { adminClientMutation } from "@/lib/admin-client-mutations-server";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { return readAdminInventory(request, "clients"); }
export async function POST(request: Request) { return adminClientMutation(request, "create-client"); }
