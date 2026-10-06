import { readAdminSubscriptions } from "@/lib/admin-subscriptions-server";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const GET = readAdminSubscriptions;
