import { businessEntitlementRequest } from "@/lib/business-entitlement-server";
export const dynamic = "force-dynamic";
export async function GET(request:Request,context:{params:Promise<{onboardingId:string}>}){
 return businessEntitlementRequest(request,"read",(await context.params).onboardingId);
}
