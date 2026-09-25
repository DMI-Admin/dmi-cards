import { businessEntitlementRequest } from "@/lib/business-entitlement-server";
export const dynamic = "force-dynamic";
export async function POST(request:Request,context:{params:Promise<{onboardingId:string}>}){
 return businessEntitlementRequest(request,"activate",(await context.params).onboardingId);
}
