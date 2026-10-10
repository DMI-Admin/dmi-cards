import "server-only";
import type Stripe from "stripe";
import type {SupabaseClient} from "@supabase/supabase-js";
import {handleStripeWebhookEvent} from "./webhook";
import {consumeFinanceEvent} from "./finance-webhook";
import {createFinanceRuntime,createFinanceStore} from "./finance-store";
import {stripeFinanceSource} from "./finance-stripe-adapter";
import type {EventEvidence} from "./finance-contract";
import {replayBillingWorkEvidence} from "./billing-work-evidence";
import {createBillingWorkerStore,type WorkerItem,type WorkerFence,WorkerFailure} from "./billing-work-store";
import {resolveBillingWorkerPartition} from "./billing-work-routing";
import {type WorkerContext,type WorkerOptIn,type WorkerDependencies} from "./billing-work-worker";

// No environment reads, credentials, route construction or automatic invocation.
// Explicit injected dependencies plus reviewed test-scope opt-in are mandatory.
export function createDisabledBillingWorkerRuntime(db:SupabaseClient,stripe:Stripe,optIn?:WorkerOptIn):WorkerDependencies|null{
 if(!optIn)return null;
 if(optIn.target!=='staging'||optIn.project!=='uohdkewufeivdpaljnng'||optIn.approval!=='reviewed_staging_billing_worker_v1'||!/^acct_[A-Za-z0-9]{1,240}:test$/.test(optIn.approvedScope))throw new WorkerFailure('invalid_evidence',true);
 const store=createBillingWorkerStore(db);
 return {store,route:(w,c)=>resolveBillingWorkerPartition(guardWorkerDatabase(db,w,c,undefined),w,c),consume:async(w,c,f)=>{
  if(w.stripe_scope!==optIn.approvedScope)throw new WorkerFailure('ownership_conflict',true);
  const guardedDb=guardWorkerDatabase(db,w,c,f),guardedStripe=guardWorkerStripe(stripe,c),event=replayBillingWorkEvidence(w.evidence);
  if(w.consumer==='entitlement')return handleStripeWebhookEvent(event as unknown as Stripe.Event,{db:guardedDb,stripe:guardedStripe,scope:w.stripe_scope,live:false});
  const protocol=await c.bounded(()=>store.authority<{mode:string;epoch:number}>(w,f,'read_protocol',null,null,{}),'read');
  if(protocol.mode!=='customer')throw new WorkerFailure('store_unavailable');
  if(w.execution_kind==='receipt_only'){const receipt=await c.bounded(()=>store.authority<{duplicate?:boolean;token:string}>(w,f,'event_claim',null,null,{id:w.stripe_event_id,type:w.event_type,subject:w.evidence.subject_id,created:new Date(w.event_created*1000).toISOString()}),'mutation');if(!receipt.duplicate)await c.bounded(()=>store.authority(w,f,'partition_ignored',null,receipt.token,{expected_epoch:protocol.epoch,event_id:w.stripe_event_id,reason:'unsupported_event'}),'mutation');return;}
  const runtime=await createFinanceRuntime(stripeFinanceSource(guardedStripe),createFinanceStore(guardedDb));runtime.relationshipDb=guardedDb;
  return consumeFinanceEvent(event as EventEvidence,runtime);
 }};
}
// Every authority command goes through the scheduler-prefixed SQL dispatcher.
export function guardWorkerDatabase(db:SupabaseClient,w:WorkerItem,c:WorkerContext,f:WorkerFence|undefined):SupabaseClient{
 function query(builder:unknown,mutation:boolean):unknown{
  let cached:Promise<unknown>|undefined;
  return new Proxy(builder as object,{get(target,key){
   if(key==='then')return (resolve:(v:unknown)=>unknown,reject:(e:unknown)=>unknown)=>{
    cached??=c.bounded(signal=>{const q=target as {abortSignal:(s:AbortSignal)=>PromiseLike<unknown>};return Promise.resolve(q.abortSignal(signal)).then(result=>{const error=(result as {error?:{message?:string;code?:string}}).error;if(error?.message==='BILLING_WORK_FENCE'||error?.message==='BILLING_WORK_DEADLINE'){const failure=new WorkerFailure('worker_expired',true);c.stop(failure);throw failure;}if(mutation&&error&&(!error.code||['57014','08000','08003','08006','PGRST000','PGRST001','PGRST002'].includes(error.code))){const failure=new WorkerFailure('ambiguous_outcome');c.stop(failure);throw failure;}return result;});},mutation?'mutation':'read');
    return cached.then(resolve,reject);
   };
   const v=Reflect.get(target,key);if(typeof v!=='function')return v;
   return (...args:unknown[])=>{c.check();if(['insert','update','upsert','delete'].includes(String(key)))throw new WorkerFailure('invalid_evidence',true);const r=Reflect.apply(v,target,args);return r&&typeof r==='object'?query(r,mutation):r;};
  }});
 }
 return new Proxy(db,{get(target,key){
  if(key==='rpc')return (name:string,args:Record<string,unknown>)=>{
   c.check();if(!f)throw new WorkerFailure('ownership_conflict',true);
   let action:string;let input:unknown=args.p_input??{};const user=args.p_user??null,token=args.p_token??null;
   if(name==='billing_foundation_command'&&w.consumer==='entitlement')action=String(args.p_action);
   else if(name==='billing_finance_command'&&w.consumer==='finance')action=String(args.p_action);
   else if(name==='billing_finance_partition_command'&&w.consumer==='finance'){
    const actions:Record<string,string>={read_protocol:'read_protocol',claim_customer:'partition_claim',release_customer:'partition_release',bind_receipt:'partition_bind',commit_customer:'partition_commit',complete_unsupported:'partition_ignored'};
    if(!Object.hasOwn(actions,String(args.p_action)))throw new WorkerFailure('invalid_evidence',true);action=actions[String(args.p_action)];input={...(args.p_input as object),...(args.p_customer?{customer:args.p_customer}:{})};
   }else if(name==='billing_finance_complete_foreign'&&w.consumer==='finance'){action='foreign_complete';input={event_id:w.stripe_event_id,expected_epoch:args.p_epoch,evidence:args.p_evidence,proofs:args.p_proofs};}
   else throw new WorkerFailure('invalid_evidence',true);
   if(args.p_scope!==w.stripe_scope)throw new WorkerFailure('ownership_conflict',true);
   return query(target.rpc('billing_consumer_worker_authority',{p_scope:w.stripe_scope,p_event:w.stripe_event_id,p_consumer:w.consumer,p_context:f,p_action:action,p_user:user,p_token:token,p_input:input}),action!=='read_protocol');
  };
  if(key==='from')return (name:string)=>{c.check();return query(target.from(name),false);};
  throw new WorkerFailure('invalid_evidence',true);
 }}) as SupabaseClient;
}
// Read methods only. SDK request options retain Finance's pinned version while
// overriding network retries and bounding each read by the invocation's headroom.
export function guardWorkerStripe(stripe:Stripe,c:WorkerContext):Stripe{
 const optionsKeys=['apiVersion','timeout','maxNetworkRetries'];
 function resource(target:object):object{return new Proxy(target,{get(obj,key){
  const value=Reflect.get(obj,key);if(value&&typeof value==='object')return resource(value);
  if(typeof value!=='function')return value;
  if(key!=='retrieve'&&key!=='list')return ()=>{throw new WorkerFailure('invalid_evidence',true);};
  return (...original:unknown[])=>c.bounded(()=>{
   c.check();const args=[...original],last=args.at(-1);let options:Record<string,unknown>={};
   if(last&&typeof last==='object'&&optionsKeys.some(k=>Object.hasOwn(last,k)))options=args.pop() as Record<string,unknown>;
   args.push({...options,timeout:Math.max(1,Math.floor(Math.min(10000,c.remaining()))),maxNetworkRetries:0});
   return Promise.resolve(Reflect.apply(value,obj,args));
  },'provider');
 }});}
 return resource(stripe) as Stripe;
}
