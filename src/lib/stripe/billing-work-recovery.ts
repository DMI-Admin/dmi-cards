import "server-only";
import {createHash,timingSafeEqual} from "node:crypto";
import type {BillingWorkConfiguration} from "./billing-work-config";
import type {WorkerResult} from "./billing-work-worker";
import type {WorkConsumer} from "./billing-work-evidence";
const headers={"Cache-Control":"no-store"};
const states=["disabled","idle","bound","completed","retry_wait","dependency_wait","needs_attention","stopped"] as const;
export type RecoveryExecution=(consumer:WorkConsumer)=>Promise<WorkerResult>;
/** No session auth, request configuration, IDs, logs, or raw errors. Hashing gives
 * timingSafeEqual fixed-size inputs even for differently sized bearer values.
 */
export async function recoverBillingWork(request:Request,secret:string|undefined,config:BillingWorkConfiguration,createExecution:()=>RecoveryExecution):Promise<Response>{
 const provided=request.headers.get("authorization")??"";
 const expected=secret?`Bearer ${secret}`:"";
 const matches=timingSafeEqual(createHash("sha256").update(provided).digest(),createHash("sha256").update(expected).digest());
 if(!secret||secret.length<32||!matches)return Response.json({error:"Unauthorized"},{status:401,headers});
 if(request.method!=="POST")return Response.json({error:"Method not allowed"},{status:405,headers});
 if(new URL(request.url).search||request.body!==null)return Response.json({error:"Parameters are not supported"},{status:400,headers});
 if(config.state!=="enabled")return Response.json({error:config.state==="disabled"?"Billing work recovery is disabled":"Billing work target rejected"},{status:503,headers});
 let execute:RecoveryExecution;try{execute=createExecution();}catch{return Response.json({error:"Billing work recovery unavailable"},{status:503,headers});}
 // Exactly one claim/execution per consumer, awaited together. No polling loop,
 // background continuation, request-triggered worker, or inline fallback.
 const settled=await Promise.allSettled((["finance","entitlement"] as const).map(consumer=>Promise.resolve().then(()=>execute(consumer))));
 const counts:Record<typeof states[number],number>={disabled:0,idle:0,bound:0,completed:0,retry_wait:0,dependency_wait:0,needs_attention:0,stopped:0};
 for(const result of settled){if(result.status==="fulfilled"&&states.includes(result.value.state))counts[result.value.state]++;else counts.stopped++;}
 const incomplete=counts.retry_wait+counts.dependency_wait+counts.needs_attention+counts.stopped+counts.disabled>0;
 return Response.json({ok:!incomplete,executions:2,counts},{status:incomplete?503:200,headers});
}
