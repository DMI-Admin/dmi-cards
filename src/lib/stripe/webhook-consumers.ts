import "server-only";
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
export async function handleStripeWebhookConsumers(event:Stripe.Event, requestId="unavailable") {
 if(!isFinanceTargetEnabled())return handleStripeWebhookEvent(event);
 const enabled=process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()==="https://uohdkewufeivdpaljnng.supabase.co";
 const observer=(consumer:"entitlement"|"finance")=>enabled?createWebhookObserver({requestId,stripeEventId:event.id,stripeEventType:event.type,consumer},fields=>logInfo({code:"STRIPE_WEBHOOK_DIAGNOSTIC",requestId,route:"/api/stripe/webhook",metadata:fields})):undefined;
 const access=observer("entitlement"), finance=observer("finance");
 const entitlementWork=()=>handleStripeWebhookEvent(event,undefined,access);
 const [entitlement]=await orchestrateBillingConsumers(
  event as unknown as EventEvidence,
  ()=>access?access.run("consumer",entitlementWork):entitlementWork(),
  async()=>{
   const initialize=async()=>{
   // Fail closed rather than write Finance into a different database or live account.
   if(process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()!=="https://uohdkewufeivdpaljnng.supabase.co")throw Error("FINANCE_STAGING_TARGET");
   if(!/^(sk|rk)_test_/.test(process.env.STRIPE_SECRET_KEY?.trim()||""))throw Error("FINANCE_STAGING_CREDENTIAL");
   const runtime=await createFinanceRuntime(stripeFinanceSource(getStripeServerClient()),createFinanceStore(createSupabaseAdminClient()));
   if(!runtime.scope.endsWith(":test"))throw Error("FINANCE_STAGING_MODE");
   if(finance){
    const store=runtime.store;
    runtime.observer=finance;
    runtime.store={...store,
     command:<T>(action:string,scope:string,token:string|null,input:object={})=>finance.run(action as Stage,()=>store.command<T>(action,scope,token,input)),
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
