import {billingWorkAutomaticConfiguration} from "@/lib/stripe/billing-work-auto-config";
import {createAutomaticBillingRuntime} from "@/lib/stripe/billing-work-auto-execution";
import {automaticBillingRequest} from "@/lib/stripe/billing-work-auto-request";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=90;
export async function POST(request:Request){
 const config=billingWorkAutomaticConfiguration("run");
 return automaticBillingRequest(request,process.env.BILLING_WORK_RECOVERY_SECRET,config,()=>createAutomaticBillingRuntime(config));
}
