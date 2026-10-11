import "server-only";
import {createHash} from "node:crypto";
import {canonicalWorkEvidence,validateWorkEvidence,type WorkConsumer} from "./billing-work-evidence";
import {WorkerFailure,workerFence,type WorkerFence,type WorkerItem,type BillingWorkerStore,type WorkerCategory} from "./billing-work-store";
// Application safety limits, not provider/runtime guarantees. Billing authority is never extended.
export const WORKER_CONSUMER_MS=60_000,WORKER_SETTLEMENT_MS=15_000,WORKER_TOTAL_MS=75_000,WORKER_RENEW_AT_MS=30_000;
export type WorkerClock={now:()=>number;setTimer:(fn:()=>void,ms:number)=>ReturnType<typeof setTimeout>;clearTimer:(timer:ReturnType<typeof setTimeout>)=>void};
const realClock:WorkerClock={now:()=>performance.now(),setTimer:setTimeout,clearTimer:clearTimeout};
export class WorkerContext{
 readonly controller=new AbortController();readonly started:number;failure:WorkerFailure|undefined;stopped=false;private mutations=0;
 constructor(readonly clock:WorkerClock=realClock,started=clock.now()){this.started=started;}
 remaining(settlement=false){return (settlement?WORKER_TOTAL_MS:WORKER_CONSUMER_MS)-(this.clock.now()-this.started);}
 stop(failure:WorkerFailure){this.failure=failure;this.stopped=true;this.controller.abort();}
 check(settlement=false){if(this.stopped&&!settlement)throw this.failure!;if(this.remaining(settlement)<=0){const f=new WorkerFailure(this.mutations>0?"ambiguous_outcome":"worker_expired");this.stop(f);throw f;}}
 async bounded<T>(run:(signal:AbortSignal)=>PromiseLike<T>,kind:"read"|"mutation"|"provider"|"settlement",maximum=kind==="provider"?10_000:5_000):Promise<T>{
  this.check(kind==="settlement");let timer:ReturnType<typeof setTimeout>|undefined;
  const remaining=this.remaining(kind==="settlement"),ms=Math.min(maximum,remaining);
  const controller=new AbortController();const abort=()=>controller.abort();this.controller.signal.addEventListener("abort",abort,{once:true});
  try{
   const expiry=new Promise<never>((_,reject)=>{timer=this.clock.setTimer(()=>{controller.abort();const f=new WorkerFailure(this.mutations>0||kind==="mutation"||kind==="settlement"?"ambiguous_outcome":this.remaining()<=0?"worker_expired":kind==="provider"?"provider_unavailable":"store_unavailable");if(this.mutations>0||kind==="mutation"||kind==="settlement"||this.remaining()<=0)this.stop(f);else this.failure=f;reject(f);},ms);});
   const result=await Promise.race([Promise.resolve().then(()=>{this.check(kind==="settlement");if(kind==="mutation")this.mutations++;return Promise.resolve(run(controller.signal)).finally(()=>{if(kind==="mutation")this.mutations--;});}),expiry]);
   this.check(kind==="settlement");return result;
  }catch(error){if(kind==='mutation'&&!(error instanceof WorkerFailure)){const failure=new WorkerFailure('ambiguous_outcome');this.stop(failure);throw failure;}if(error instanceof WorkerFailure){this.failure??=error;if(error.stop||error.category==='ambiguous_outcome')this.stop(error);}throw error;}
  finally{if(timer!==undefined)this.clock.clearTimer(timer);this.controller.signal.removeEventListener("abort",abort);}
 }
}
// Exact closed codes only; no raw errors or substring matching.
const mapping:Record<string,WorkerCategory>={
 FINANCE_BUSY:"lease_busy",BILLING_BUSY:"lease_busy",FINANCE_OWNERSHIP_UNRESOLVED:"dependency_unresolved",FINANCE_CUSTOMER_ROUTING_UNRESOLVED:"routing_unresolved",FINANCE_CUSTOMER_ROUTING_UNAVAILABLE:"store_unavailable",MISSING_OBJECT:"dependency_unresolved",FINANCE_SUBSCRIPTION_MISSING:"dependency_unresolved",FINANCE_INVOICE_MISSING:"dependency_unresolved",FINANCE_PAYMENT_MISSING:"dependency_unresolved",
 FINANCE_OWNERSHIP_CONFLICT:"ownership_conflict",FINANCE_CUSTOMER_GRAPH_OWNERSHIP:"ownership_conflict",FINANCE_CUSTOMER_BUNDLE_OWNERSHIP:"ownership_conflict",FINANCE_ATTRIBUTION_CONFLICT:"ownership_conflict",FINANCE_FAILURE_IDENTITY:"ownership_conflict",IDENTITY_CONFLICT:"ownership_conflict",BILLING_IDENTITY:"ownership_conflict",SCOPE_CONFLICT:"ownership_conflict",
 FINANCE_OWNERSHIP_STALE:"ownership_stale",STRIPE_UNAVAILABLE:"provider_unavailable",FINANCE_STORE_UNAVAILABLE:"store_unavailable",BILLING_STORE_UNAVAILABLE:"store_unavailable",MIRROR_UNAVAILABLE:"store_unavailable",PRICE_REGISTRY_UNAVAILABLE:"store_unavailable",
 FINANCE_FENCE:"worker_expired",FINANCE_PARTITION_FENCE:"worker_expired",FINANCE_PARTITION_RECEIPT_FENCE:"worker_expired",FINANCE_PARTITION_REVISION:"worker_expired",FINANCE_OBJECT_REVISION:"worker_expired",FINANCE_STALE_SNAPSHOT:"worker_expired",BILLING_FENCE:"worker_expired",BILLING_REVISION:"worker_expired",
 FINANCE_PROTOCOL_DRAINING:"store_unavailable",FINANCE_PROTOCOL_MODE:"invalid_evidence",FINANCE_PROTOCOL_EPOCH:"worker_expired",FINANCE_PARTITION_EPOCH:"worker_expired",FINANCE_PARTITION_DISABLED:"store_unavailable",FINANCE_MALFORMED_STRIPE_DATA:"invalid_evidence",FINANCE_EVENT_SHAPE:"invalid_evidence",FINANCE_WEBHOOK_COMPATIBILITY:"invalid_evidence",MALFORMED_CHECKOUT:"invalid_evidence",MALFORMED_INVOICE:"invalid_evidence",UNKNOWN_PRICE:"dependency_unresolved",
};
export function classifyWorkerError(error:unknown):WorkerFailure{if(error instanceof WorkerFailure)return error;const e=error&&typeof error==="object"?error as {reason?:unknown;message?:unknown}:{};const code=typeof e.reason==="string"?e.reason:e.message;return new WorkerFailure(typeof code==="string"&&Object.hasOwn(mapping,code)?mapping[code]:"store_unavailable");}
export type WorkerDependencies={store:BillingWorkerStore;route:(w:WorkerItem,context:WorkerContext)=>Promise<string|null>;consume:(w:WorkerItem,context:WorkerContext,fence:WorkerFence)=>Promise<unknown>};
export type WorkerOptIn={target:"staging";project:"uohdkewufeivdpaljnng";approvedScope:string;approval:"reviewed_staging_billing_worker_v1";proofs?:import("./finance-dmi-charge-integration").DmiProofOptions};
export type WorkerResult={state:"disabled"|"idle"|"bound"|"completed"|"retry_wait"|"dependency_wait"|"needs_attention"|"stopped";category?:WorkerCategory};
export async function executeBillingWorker(deps:WorkerDependencies,scope:string,consumer:WorkConsumer,event?:string,optIn?:WorkerOptIn,clock:WorkerClock=realClock):Promise<WorkerResult>{
 if(!optIn)return {state:"disabled"};
 if(optIn.target!=="staging"||optIn.project!=="uohdkewufeivdpaljnng"||optIn.approval!=="reviewed_staging_billing_worker_v1"||optIn.approvedScope!==scope||!/^acct_[A-Za-z0-9]{1,240}:test$/.test(scope))return {state:"stopped",category:"invalid_evidence"};
 const context=new WorkerContext(clock);let w:WorkerItem|null;try{w=await context.bounded(()=>deps.store.claim(scope,consumer,event),"mutation");}catch{return {state:"stopped",category:context.failure?.category??"ambiguous_outcome"};}if(!w)return {state:"idle"};
 const fence=workerFence(w);
 const settle=async(action:"complete"|"retry_wait"|"dependency_wait"|"needs_attention",input:Record<string,unknown>)=>{
  try{await context.bounded(()=>deps.store.settle(w!,fence,action,input),"settlement");return {state:action==='complete'?'completed':action} as WorkerResult;}catch{return {state:"stopped",category:context.failure?.category??"ambiguous_outcome"} as WorkerResult;}
 };
 try{
  if(w.stripe_scope!==scope||w.consumer!==consumer||w.evidence_version!==2||!validateWorkEvidence(w.evidence)||w.evidence.scope!==scope||w.evidence.event_id!==w.stripe_event_id||w.evidence.consumer!==consumer||w.evidence.consumer_version!==w.consumer_version||w.evidence.event_type!==w.event_type||w.evidence.event_created!==Number(w.event_created)||createHash("sha256").update(canonicalWorkEvidence(w.evidence)).digest("hex")!==w.evidence_digest)throw new WorkerFailure("invalid_evidence");
  const receipt=await context.bounded(()=>deps.store.receipt(w!),"read");
  if(receipt.state==='processed'||consumer==='finance'&&receipt.state==='ignored')return await settle('complete',{terminal_result:receipt.state});
  if(receipt.lease_active)return await settle('retry_wait',{failure_category:'lease_busy',delay_seconds:130});
  if(w.execution_kind==='routing'){
   const key=await context.bounded(()=>deps.route(w!,context),'read',Math.min(2_000,context.remaining()));
   if(!key)return await settle('dependency_wait',{failure_category:'routing_unresolved',delay_seconds:30});
   await context.bounded(()=>deps.store.bind(w!,fence,key),'mutation');return {state:'bound'};
  }
  // Consumer invoked ONCE. Awaited renewal is coordination only, never billing authority.
  let consumerResult:unknown;
  const consuming=Promise.resolve().then(()=>deps.consume(w!,context,fence)).then(result=>{consumerResult=result;return result;});
  let heartbeat:ReturnType<typeof setTimeout>|undefined;
  const renewal=new Promise<'renew'>((resolve)=>{heartbeat=clock.setTimer(()=>resolve('renew'),Math.max(0,WORKER_RENEW_AT_MS-(clock.now()-context.started)));});
  try{
   const first=await context.bounded(()=>Promise.race([consuming.then(()=> 'done' as const),renewal]),'read',context.remaining());
   if(first==='renew'){
    let r;try{r=await context.bounded(()=>deps.store.settle(w!,fence,'renew'),'mutation');}catch{context.stop(new WorkerFailure('worker_expired',true));throw context.failure;}
    if(!r.lease_until){context.stop(new WorkerFailure('worker_expired',true));throw context.failure;}
    Object.assign(fence,{expires_at:r.lease_until});Object.assign(w,{lease_until:r.lease_until});
    // The consumer's fence object is updated in place so all later commands use renewal.
    await context.bounded(()=>consuming,'read',context.remaining());
   }
  }finally{if(heartbeat!==undefined)clock.clearTimer(heartbeat);}
  const final=await context.bounded(()=>deps.store.receipt(w!),"read");
  if(final.state==='processed'||consumer==='finance'&&final.state==='ignored'){
   const invoices=consumerResult&&typeof consumerResult==="object"&&"proofInvoices" in consumerResult?consumerResult.proofInvoices:undefined;
   if(consumer==="finance"&&optIn.proofs?.wake&&Array.isArray(invoices)&&invoices.length){
    try{await context.bounded(()=>deps.store.completeDmi(w!,fence,invoices),"settlement");return {state:"completed"};}catch{return {state:"stopped",category:"ambiguous_outcome"};}
   }
   return await settle('complete',{terminal_result:final.state});
  }
  return await settle('retry_wait',{failure_category:'store_unavailable',delay_seconds:130});
 }catch(error){
  const failure=context.failure??classifyWorkerError(error);
  if(failure.stop)return {state:'stopped',category:failure.category};
  const attention=['ownership_conflict','invalid_evidence'].includes(failure.category),dependency=['dependency_unresolved','routing_unresolved','ownership_stale'].includes(failure.category);
  const outcome=await settle(attention?'needs_attention':dependency?'dependency_wait':'retry_wait',{failure_category:failure.category,...(attention?{}:{delay_seconds:failure.category==='ambiguous_outcome'||failure.category==='worker_expired'?130:dependency?30:5})});
  return {...outcome,category:failure.category};
 }
}
