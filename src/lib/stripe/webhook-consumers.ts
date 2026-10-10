import "server-only";
import {createAcquisitionTiming,createLeaseRetryPolicy} from "./lease-acquisition-timing";
import {logInfo} from "@/lib/observability/logger";
import {createWebhookObserver, type Stage} from "./webhook-observer";
import {isFinanceTargetEnabled} from "./finance-runtime-guard";
import type Stripe from "stripe";
import {handleStripeWebhookEvent} from "./webhook";
import {getStripeServerClient} from "./config";
import {createSupabaseAdminClient} from "@/lib/supabase-admin";
import {createFinanceRuntime,createFinanceStore} from "./finance-store";
import {stripeFinanceSource} from "./finance-stripe-adapter";
import {orchestrateBillingConsumers} from "./finance-webhook";
import type {EventEvidence} from "./finance-contract";

/** Called only after the route verifies the signature. Checkpoint 4 is staging-only. */
export async function handleStripeWebhookConsumers(event:Stripe.Event, requestId="unavailable", invocationStartedAt=performance.now()) {
 if(!isFinanceTargetEnabled())return handleStripeWebhookEvent(event);
 const acquisitionTiming=createAcquisitionTiming(invocationStartedAt,metadata=>logInfo({code:"BILLING_LEASE_ACQUISITION_TIMING",route:"/api/stripe/webhook",metadata}));
 const leaseRetry=createLeaseRetryPolicy(acquisitionTiming,metadata=>logInfo({code:"BILLING_LEASE_ACQUISITION_RETRY",route:"/api/stripe/webhook",metadata}));
 const enabled=process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()==="https://uohdkewufeivdpaljnng.supabase.co";
 const observer=(consumer:"entitlement"|"finance")=>enabled?createWebhookObserver({requestId,stripeEventId:event.id,stripeEventType:event.type,consumer},fields=>logInfo({code:"STRIPE_WEBHOOK_DIAGNOSTIC",requestId,route:"/api/stripe/webhook",metadata:fields})):undefined;
 const access=observer("entitlement"), finance=observer("finance");
 const entitlementWork=()=>handleStripeWebhookEvent(event,undefined,access,acquisitionTiming,leaseRetry);
 const [entitlement]=await orchestrateBillingConsumers(
  event as unknown as EventEvidence,
  ()=>access?access.run("consumer",entitlementWork):entitlementWork(),
  async()=>{
   const initialize=async()=>{
   // Fail closed rather than write Finance into a different database or live account.
   if(process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()!=="https://uohdkewufeivdpaljnng.supabase.co")throw Error("FINANCE_STAGING_TARGET");
   if(!/^(sk|rk)_test_/.test(process.env.STRIPE_SECRET_KEY?.trim()||""))throw Error("FINANCE_STAGING_CREDENTIAL");
   const db=createSupabaseAdminClient();
   const runtime=await createFinanceRuntime(stripeFinanceSource(getStripeServerClient()),createFinanceStore(db,acquisitionTiming));
   runtime.relationshipDb=db;
   if(!runtime.scope.endsWith(":test"))throw Error("FINANCE_STAGING_MODE");
   runtime.leaseRetry=leaseRetry;
   if(finance){
    const store=runtime.store;
    runtime.observer=finance;
    runtime.store={...store,
     command:<T>(action:string,scope:string,token:string|null,input:object={})=>finance.run(({read_protocol:"other_rpc",partition_claim:"claim",partition_release:"release",partition_bind:"bind",partition_commit:"commit",invoice_proof_commit:"commit",partition_ignored:"event_finish",foreign_complete:"event_finish"} as Record<string,Stage>)[action]??action as Stage,()=>store.command<T>(action,scope,token,input)),
     read:(...args)=>finance.run("mirror_read",()=>store.read(...args)),
     items:(...args)=>finance.run("item_read",()=>store.items(...args)),
     binding:(...args)=>finance.run("identity_binding",()=>store.binding(...args)),
    };
   }
   return runtime;
   };
   return finance?finance.run("runtime",initialize):initialize();
  },
 );
 // Preserve the existing response contract: no financial objects leave the route.
 return entitlement;
}
