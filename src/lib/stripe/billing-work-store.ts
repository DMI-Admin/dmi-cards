import "server-only";
import type {WorkConsumer,WorkEvidence} from "./billing-work-evidence";
export type WorkerFence={token:string;generation:string;partition_generation:string|null;expires_at:string};
export type WorkerItem={stripe_scope:string;stripe_event_id:string;consumer:WorkConsumer;consumer_version:string;event_type:string;event_created:number;evidence_version:number;evidence:WorkEvidence;evidence_digest:string;partition_key:string|null;partition_kind:string|null;scheduling_token:string;scheduling_generation:number|string;partition_generation:number|string|null;lease_until:string;processing_started_at:string;execution_kind?:"consumer"|"routing"|"receipt_only"};
export type WorkRpc={rpc(name:string,args:Record<string,unknown>):PromiseLike<{data:unknown;error:unknown}>};
export type WorkerCategory="lease_busy"|"dependency_unresolved"|"ownership_conflict"|"ownership_stale"|"ambiguous_outcome"|"provider_unavailable"|"store_unavailable"|"invalid_evidence"|"worker_expired"|"retry_exhausted"|"routing_unresolved";
export class WorkerFailure extends Error{constructor(public category:WorkerCategory,public stop=false){super(stop?"BILLING_WORK_FENCE":"BILLING_WORK_EXECUTION_FAILURE");}}
export function workerFence(w:WorkerItem):WorkerFence{return {token:w.scheduling_token,generation:String(w.scheduling_generation),partition_generation:w.partition_generation===null?null:String(w.partition_generation),expires_at:w.lease_until};}
export type ReceiptState={state:"missing"|"received"|"processing"|"failed"|"processed"|"ignored";lease_active:boolean;category:WorkerCategory|null};
export function createBillingWorkerStore(db:WorkRpc){
 async function call<T>(name:string,args:Record<string,unknown>):Promise<T>{
  let data:unknown,error:unknown;try{({data,error}=await db.rpc(name,args));}catch{throw new WorkerFailure(name==='billing_consumer_worker_receipt'?'store_unavailable':'ambiguous_outcome');}
  if(error){if(name!=='billing_consumer_worker_receipt'&&(!error||typeof error!=='object'||!('code' in error)||!error.code||['57014','08000','08003','08006','PGRST000','PGRST001','PGRST002'].includes(String(error.code))))throw new WorkerFailure('ambiguous_outcome');const code=error&&typeof error==="object"&&"message" in error?error.message:undefined;if(code==="BILLING_WORK_FENCE"||code==="BILLING_WORK_DEADLINE")throw new WorkerFailure("worker_expired",true);if(code==="FINANCE_BUSY"||code==="BILLING_BUSY")throw new WorkerFailure("lease_busy");if(code==="BILLING_WORK_BINDING")throw new WorkerFailure("ownership_conflict");throw new WorkerFailure("store_unavailable");}
  return data as T;
 }
 const identity=(w:WorkerItem)=>({p_scope:w.stripe_scope,p_event:w.stripe_event_id,p_consumer:w.consumer});
 return {
  claim:async(scope:string,consumer:WorkConsumer,event?:string):Promise<WorkerItem|null>=>{const rows=await call<WorkerItem[]>("billing_consumer_worker_claim",{p_scope:scope,p_consumer:consumer,p_event:event??null});if(!Array.isArray(rows)||rows.length>1)throw new WorkerFailure("invalid_evidence");return rows[0]??null;},
  receipt:async(w:WorkerItem)=>{const r=await call<ReceiptState>("billing_consumer_worker_receipt",identity(w));if(!r||!['missing','received','processing','failed','processed','ignored'].includes(r.state)||typeof r.lease_active!=='boolean')throw new WorkerFailure('store_unavailable');return r;},
  bind:(w:WorkerItem,fence:WorkerFence,key:string)=>call<{bound:boolean}>("billing_consumer_worker_bind",{...identity(w),p_context:fence,p_key:key}),
  settle:(w:WorkerItem,fence:WorkerFence,action:"renew"|"complete"|"retry_wait"|"dependency_wait"|"needs_attention",input:Record<string,unknown>={})=>call<{state:string;lease_until?:string}>("billing_consumer_worker_settle",{...identity(w),p_context:fence,p_action:action,p_input:input}),
  authority:<T>(w:WorkerItem,fence:WorkerFence,action:string,user:string|null,token:string|null,input:object)=>call<T>("billing_consumer_worker_authority",{...identity(w),p_context:fence,p_action:action,p_user:user,p_token:token,p_input:input}),
 };
}
export type BillingWorkerStore=ReturnType<typeof createBillingWorkerStore>;
