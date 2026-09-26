import { readAdminCardSupport } from "@/lib/admin-card-support-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export async function GET(request: Request) {
  return readAdminCardSupport(request);
}
