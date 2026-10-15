import "server-only";
import {createHash,timingSafeEqual} from "node:crypto";
import type {BillingWorkConfiguration} from "./billing-work-config";
import {runAutomaticBillingWork,type AutomaticRuntime} from "./billing-work-auto-runner";
import {createBillingLatencyObserver} from "./billing-latency-diagnostics";
const EMPTY_POST_READ_TIMEOUT_MS=1_000,EMPTY_POST_MAX_READS=32;
async function hasEmptyBody(request:Request):Promise<boolean>{
 if(request.body===null)return true;
 let reader:ReadableStreamDefaultReader<Uint8Array>;
 try{reader=request.body.getReader();}catch{return false;}
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{
  const deadline=new Promise<boolean>(resolve=>{timer=setTimeout(()=>resolve(false),EMPTY_POST_READ_TIMEOUT_MS);});
  const read=async()=>{
   for(let i=0;i<EMPTY_POST_MAX_READS;i++){
    const chunk=await reader.read();
    if(chunk.done)return true;
    if(chunk.value.byteLength!==0)return false;
   }
   return false;
  };
  return await Promise.race([read(),deadline]);
 }catch{return false;}
 finally{
  if(timer!==undefined)clearTimeout(timer);
  // Cancellation is cleanup only; do not wait on an untrusted stream's cancel.
  try{void reader.cancel().catch(()=>{});}catch{/* Fail-closed result is unchanged. */}
  try{reader.releaseLock();}catch{/* No body contents/errors are exposed. */}
 }
}
const headers={"Cache-Control":"no-store"};
export async function automaticBillingRequest(request:Request,secret:string|undefined,config:BillingWorkConfiguration,createRuntime:()=>AutomaticRuntime):Promise<Response>{
 const provided=request.headers.get("authorization")??"";
 const expected=secret?`Bearer ${secret}`:"";
 const matches=timingSafeEqual(createHash("sha256").update(provided).digest(),createHash("sha256").update(expected).digest());
 if(!secret||secret.length<32||!matches)return Response.json({error:"Unauthorized"},{status:401,headers});
 if(request.method!=="POST")return Response.json({error:"Method not allowed"},{status:405,headers});
 if(new URL(request.url).search||!await hasEmptyBody(request))return Response.json({error:"Parameters are not supported"},{status:400,headers});
 if(config.state!=="enabled")return Response.json({ok:false,error:"Billing automatic execution is disabled"},{status:503,headers});
 const result=await runAutomaticBillingWork(config,createRuntime,undefined,undefined,undefined,createBillingLatencyObserver("automatic_endpoint"));
 return Response.json(result,{status:result.ok?200:503,headers});
}
