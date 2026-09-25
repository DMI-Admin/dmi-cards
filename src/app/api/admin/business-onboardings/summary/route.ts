import { businessOnboardingRequest } from "@/lib/business-onboarding-server";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { return businessOnboardingRequest(request, "summary"); }
