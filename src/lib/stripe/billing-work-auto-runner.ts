import "server-only";
import {executeBillingWorker,WORKER_TOTAL_MS,type WorkerDependencies,type WorkerOptIn,type WorkerResult} from "./billing-work-worker";
import type {BillingWorkConfiguration} from "./billing-work-config";
import type {WorkConsumer} from "./billing-work-evidence";
import {AUTOMATIC_FUNCTION_SECONDS,AUTOMATIC_RESPONSE_RESERVE_MS,AUTOMATIC_ADMISSION_DEADLINE_MS} from "./billing-work-auto-config";
import type {LatencyObserver,LatencyEvent} from "./billing-latency-diagnostics";

const states=["disabled","idle","bound","completed","retry_wait","dependency_wait","needs_attention","stopped"] as const;
export type AutomaticResult={ok:boolean;executions:number;counts:Record<typeof states[number],number>};
export type AutomaticRuntime={deps:WorkerDependencies;worker:WorkerOptIn};
export type AutomaticExecution=(deps:WorkerDependencies,scope:string,consumer:WorkConsumer,event:undefined,worker:WorkerOptIn)=>Promise<WorkerResult>;
/** One request-local claim gate only. PostgreSQL remains the cross-request
 * authority. Do not retry a claim after an ambiguous outcome. Waiting is bounded
 * so a cancelled worker cannot later dispatch a queued claim mutation.
 */
function coordinatedClaims(deps:WorkerDependencies):WorkerDependencies {
 let held:Promise<void>|undefined;let uncertain=false;
 return {...deps,store:{...deps.store,claim:async(...args)=>{
  if(uncertain)throw Error("BILLING_WORK_CLAIM_AMBIGUOUS");
  const waitingSince=performance.now();
  while(held){
   let timer:ReturnType<typeof setTimeout>|undefined;
   try{const ready=await Promise.race([held.then(()=>true),new Promise<boolean>(resolve=>{timer=setTimeout(()=>resolve(false),Math.max(0,4_000-(performance.now()-waitingSince)));})]);if(!ready)return null;}
   finally{if(timer)clearTimeout(timer);}
  }
  if(uncertain)throw Error("BILLING_WORK_CLAIM_AMBIGUOUS");
  let release!:()=>void;held=new Promise<void>(resolve=>{release=resolve;});
  try{return await deps.store.claim(...args);}catch{uncertain=true;throw Error("BILLING_WORK_CLAIM_AMBIGUOUS");}
  finally{held=undefined;release();}
 }}};
}
export async function runAutomaticBillingWork(config:BillingWorkConfiguration,createRuntime:()=>AutomaticRuntime,
 budgetMs=AUTOMATIC_FUNCTION_SECONDS*1_000-AUTOMATIC_RESPONSE_RESERVE_MS,
 now:()=>number=()=>performance.now(),execute:AutomaticExecution=executeBillingWorker,observe?:LatencyObserver):Promise<AutomaticResult>{
 const emit=(event:()=>LatencyEvent)=>{try{observe?.(event());}catch{/* Observational only. */}};
 const measuredStart=observe?performance.now():0;
 emit(()=>({stage:"runner_start"}));
 const counts:AutomaticResult["counts"]={disabled:0,idle:0,bound:0,completed:0,retry_wait:0,dependency_wait:0,needs_attention:0,stopped:0};
 let executions=0,unavailable=false;
 const result=():AutomaticResult=>{emit(()=>({stage:"runner_end",duration_ms:performance.now()-measuredStart}));return {ok:!unavailable&&!["disabled","retry_wait","dependency_wait","needs_attention","stopped"].some(s=>counts[s as keyof typeof counts]>0),executions,counts};};
 if(config.state!=="enabled"){emit(()=>({stage:"runner_skip",reason:"configuration_disabled"}));unavailable=true;return result();}
 const start=now();
 const deadline=start+Math.max(0,Math.min(budgetMs,AUTOMATIC_ADMISSION_DEADLINE_MS,AUTOMATIC_FUNCTION_SECONDS*1_000-AUTOMATIC_RESPONSE_RESERVE_MS));
 if(!Number.isFinite(deadline)){emit(()=>({stage:"runner_skip",reason:"invalid_budget",minimum_start_ms:WORKER_TOTAL_MS}));return result();}
 const initialHeadroom=deadline-now();
 if(initialHeadroom<WORKER_TOTAL_MS){emit(()=>({stage:"runner_skip",reason:"insufficient_headroom",remaining_ms:initialHeadroom,minimum_start_ms:WORKER_TOTAL_MS}));return result();}
 let runtime:AutomaticRuntime;try{runtime=createRuntime();}catch{emit(()=>({stage:"runner_skip",reason:"runtime_unavailable"}));unavailable=true;return result();}
 const deps=coordinatedClaims(runtime.deps);
 const lane=async(consumer:WorkConsumer)=>{
  for(let n=0;n<8;n++){
   const remaining=deadline-now();
   if(remaining<WORKER_TOTAL_MS){emit(()=>({stage:"lane_stop",consumer,ordinal:n+1,reason:"insufficient_headroom",remaining_ms:remaining,minimum_start_ms:WORKER_TOTAL_MS}));return;}
   executions++;
   const executionStart=observe?performance.now():0;
   emit(()=>({stage:"execution_start",consumer,ordinal:n+1,remaining_ms:remaining,minimum_start_ms:WORKER_TOTAL_MS}));
   let state:typeof states[number]="stopped";
   let workerResult:WorkerResult|undefined;
   try{const r=await execute(deps,config.scope,consumer,undefined,runtime.worker);if(states.includes(r.state))state=r.state;workerResult=r;}catch{/* Fixed aggregate only. */}
   counts[state]++;
   emit(()=>({stage:"execution_end",consumer,ordinal:n+1,outcome:state,category:workerResult?.category,duration_ms:performance.now()-executionStart}));
   if(state!=="bound"&&state!=="completed"){emit(()=>({stage:"lane_stop",consumer,ordinal:n+1,outcome:state,reason:"outcome_stop"}));return;}
  }
  emit(()=>({stage:"lane_stop",consumer,ordinal:8,reason:"execution_limit"}));
 };
 await Promise.all([lane("finance"),lane("entitlement")]);
 return result();
}
