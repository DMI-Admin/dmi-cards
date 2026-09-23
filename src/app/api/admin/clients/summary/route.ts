import { readAdminClientCounts } from "@/lib/admin-client-summary-server";
export const dynamic = "force-dynamic";
export async function GET() { return readAdminClientCounts(); }
