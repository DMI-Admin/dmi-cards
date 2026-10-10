import "server-only";
import type {SupabaseClient} from "@supabase/supabase-js";
import {projectVerifiedFinanceRouting} from "./finance-routing-evidence";
import {resolveVerifiedFinanceRouting} from "./finance-customer-relationship-adapter";
import {replayBillingWorkEvidence} from "./billing-work-evidence";
import type {EventEvidence} from "./finance-contract";
import {WorkerFailure,type WorkerItem} from "./billing-work-store";
import type {WorkerContext} from "./billing-work-worker";
/** Lookup-only; SQL independently checks binding. Routing never grants write authority. */
export async function resolveBillingWorkerPartition(db:SupabaseClient,w:WorkerItem,context:WorkerContext):Promise<string|null>{
 context.check();const event=replayBillingWorkEvidence(w.evidence);
 if(w.consumer==='finance'){
  const r=await resolveVerifiedFinanceRouting(db,w.stripe_scope,projectVerifiedFinanceRouting(w.stripe_scope,event as EventEvidence),{signal:context.controller.signal});
  if(r.status==='resolved'||r.status==='routed')return r.partition.customer;
  if(r.reason==='conflicting_ownership')throw new WorkerFailure('ownership_conflict');return null;
 }
 const raw=w.evidence.object;
 if(raw.namespace==='dmi_cards_v2'&&typeof raw.dmi_user_id==='string'){
  if(raw.dmi_profile_id!==undefined&&raw.dmi_profile_id!==raw.dmi_user_id||raw.client_reference_id!=null&&raw.client_reference_id!==raw.dmi_user_id)throw new WorkerFailure('ownership_conflict');
  return raw.dmi_user_id; // SQL requires auth identity and matching signed evidence.
 }
 const parent=raw.parent as {subscription_details?:{subscription?:string}}|undefined;
 const id=w.evidence.subject_type==='subscription'?w.evidence.subject_id:parent?.subscription_details?.subscription??raw.subscription;
 if(typeof id!=='string')return null;
 const {data,error}=await context.bounded(signal=>db.from('billing_subscriptions').select('user_id,stripe_scope').eq('stripe_scope',w.stripe_scope).eq('stripe_subscription_id',id).abortSignal(signal).maybeSingle(),'read',2000);
 if(error)throw new WorkerFailure('store_unavailable');return typeof data?.user_id==='string'&&data.stripe_scope===w.stripe_scope?data.user_id:null;
}
