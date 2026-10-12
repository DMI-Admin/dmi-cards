import {createRecoveryEntitlementDiagnostics,entitlementOnlyDiagnosticEnabled} from "@/lib/stripe/billing-recovery-entitlement-diagnostics";
import {invoiceProofProductionOptions} from "@/lib/stripe/finance-invoice-proof-config";
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
  const proofs=invoiceProofProductionOptions();
  const baseWorker=proofs?{...config.worker,proofs}:config.worker;
  const entitlementDiagnostics=createRecoveryEntitlementDiagnostics(process.env);
  const worker=entitlementDiagnostics?{...baseWorker,entitlementDiagnostics}:baseWorker;
  const deps=createDisabledBillingWorkerRuntime(createSupabaseAdminClient(),getStripeServerClient(),worker);
  if(!deps)throw Error("BILLING_WORK_DISABLED");
  return consumer=>executeBillingWorker(deps,config.scope,consumer,undefined,worker);
 },()=>entitlementOnlyDiagnosticEnabled(process.env));
}
