import { adminClientMutation } from "@/lib/admin-client-mutations-server";
export async function POST(request: Request) { return adminClientMutation(request, "import"); }
