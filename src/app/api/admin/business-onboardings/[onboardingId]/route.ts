import { businessOnboardingRequest } from "@/lib/business-onboarding-server";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ onboardingId: string }> };
export async function GET(request: Request, context: Context) { return businessOnboardingRequest(request,"read",(await context.params).onboardingId); }
export async function PATCH(request: Request, context: Context) { return businessOnboardingRequest(request,"update",(await context.params).onboardingId); }
