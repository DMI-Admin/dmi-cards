import { businessOnboardingRequest } from "@/lib/business-onboarding-server";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { return businessOnboardingRequest(request, "list"); }
export async function POST(request: Request) { return businessOnboardingRequest(request, "create"); }
