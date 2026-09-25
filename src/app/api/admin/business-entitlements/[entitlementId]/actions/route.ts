import { businessEntitlementRequest } from "@/lib/business-entitlement-server";
export const dynamic = "force-dynamic";
export async function POST(request:Request,context:{params:Promise<{entitlementId:string}>}){
 return businessEntitlementRequest(request,"action",(await context.params).entitlementId);
}
