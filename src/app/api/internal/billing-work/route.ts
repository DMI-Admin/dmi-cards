import {billingWorkConfiguration} from "@/lib/stripe/billing-work-config";
import {recoverBillingWork} from "@/lib/stripe/billing-work-recovery";
import {createDisabledBillingWorkerRuntime} from "@/lib/stripe/billing-work-runtime";
import {executeBillingWorker} from "@/lib/stripe/billing-work-worker";
import {createSupabaseAdminClient} from "@/lib/supabase-admin";
import {getStripeServerClient} from "@/lib/stripe/config";

export const runtime="nodejs";
export const dynamic="force-dynamic";
// 75s worker budget + response reserve, below the verified 300s platform limit.
export const maxDuration=90;
export async function POST(request:Request){
 const config=billingWorkConfiguration("recovery");
 return recoverBillingWork(request,process.env.BILLING_WORK_RECOVERY_SECRET,config,()=>{
  if(config.state!=="enabled")throw Error("BILLING_WORK_DISABLED");
  const deps=createDisabledBillingWorkerRuntime(createSupabaseAdminClient(),getStripeServerClient(),config.worker);
  if(!deps)throw Error("BILLING_WORK_DISABLED");
  return consumer=>executeBillingWorker(deps,config.scope,consumer,undefined,config.worker);
 });
}
