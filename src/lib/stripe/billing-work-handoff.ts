import "server-only";
import {admitBillingConsumerWork,type WorkAdmissionStorage} from "./billing-work-admission";
import {prepareBillingWorkEvidence,type VerifiedWorkEvent,type WorkConsumer} from "./billing-work-evidence";
import type {BillingWorkConfiguration} from "./billing-work-config";

// Applicability mirrors the existing consumers, including their explicit ignore paths.
// Unsupported types carry no financial work; they are never inferred to be foreign.
const financeEvents=new Set(["customer.subscription.created","customer.subscription.updated","customer.subscription.deleted","invoice.finalized","invoice.updated","invoice.paid","invoice.payment_failed","invoice.voided","invoice.marked_uncollectible","charge.refunded","charge.refund.updated","charge.succeeded","charge.failed","charge.captured","refund.created","refund.updated","refund.failed"]);
const entitlementEvents=new Set(["checkout.session.completed","customer.subscription.created","customer.subscription.updated","customer.subscription.deleted","invoice.paid","invoice.payment_succeeded","invoice.payment_failed"]);
export function applicableBillingConsumers(type:string):WorkConsumer[]{return [...(financeEvents.has(type)?["finance" as const]:[]),...(entitlementEvents.has(type)?["entitlement" as const]:[])];}
export type HandoffStorage=WorkAdmissionStorage & {rpc(name:string,args:Record<string,unknown>):PromiseLike<{data:unknown;error:unknown}>};
export type HandoffResult={state:"disabled"|"completed"|"unfinished"|"rejected";applicable:number;terminal:number};
// Five-second command bound, not a provider guarantee. Lost admission responses
// remain ambiguous: no retry/fallback, and no follow-up after that timeout.
type RpcResponse={data:unknown;error:unknown};
function cancellableCall(db:HandoffStorage,name:string,args:Record<string,unknown>,signal:AbortSignal):PromiseLike<RpcResponse>{
 const command=db.rpc(name,args) as PromiseLike<RpcResponse> & {abortSignal?:(signal:AbortSignal)=>PromiseLike<RpcResponse>};
 return command.abortSignal?command.abortSignal(signal):command;
}
async function bounded<T>(run:(signal:AbortSignal)=>PromiseLike<T>):Promise<T>{let timer:ReturnType<typeof setTimeout>|undefined;const controller=new AbortController();try{return await Promise.race([Promise.resolve().then(()=>run(controller.signal)),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error("BILLING_WORK_HANDOFF_INCOMPLETE"));},5000);})]);}finally{if(timer)clearTimeout(timer);}}

/** Caller MUST verify the Stripe signature first. No worker/provider/partition
 * inference here: unbound work is bound later by the SQL-verified routing worker.
 */
export async function handoffBillingWork(event:VerifiedWorkEvent,config:BillingWorkConfiguration,storage:()=>HandoffStorage):Promise<HandoffResult>{
 if(config.state==="disabled")return {state:"disabled",applicable:0,terminal:0};
 if(config.state!=="enabled"||event.livemode!==false||(event.account!==undefined&&event.account!==config.scope.split(":")[0]))return {state:"rejected",applicable:0,terminal:0};
 const consumers=applicableBillingConsumers(event.type);
 // Validate before any admission, including immutable evidence/digest requirements.
 if(consumers.some(consumer=>prepareBillingWorkEvidence(config.scope,event,consumer).state!=="prepared"))return {state:"rejected",applicable:consumers.length,terminal:0};
 if(!consumers.length)return {state:"completed",applicable:0,terminal:0};
 let db:HandoffStorage;try{db=storage();}catch{return {state:"rejected",applicable:consumers.length,terminal:0};}
 const results=await Promise.allSettled(consumers.map(async consumer=>{
  const admitted=await bounded(signal=>admitBillingConsumerWork({rpc:(name,args)=>cancellableCall(db,name,args,signal)},config.scope,event,consumer,{approvedScope:config.scope,approval:"reviewed_staging_work_admission_v2"}));
  if(admitted.state!=="admitted")return false;
  const {data,error}=await bounded(signal=>cancellableCall(db,"billing_consumer_worker_receipt",{p_scope:config.scope,p_event:event.id,p_consumer:consumer},signal));
  if(error||!data||typeof data!=="object"||!("state" in data)||!("lease_active" in data)||data.lease_active!==false)return false;
  return data.state==="processed"||(consumer==="finance"&&data.state==="ignored");
 }));
 const terminal=results.filter(r=>r.status==="fulfilled"&&r.value===true).length;
 return {state:terminal===consumers.length?"completed":"unfinished",applicable:consumers.length,terminal};
}
