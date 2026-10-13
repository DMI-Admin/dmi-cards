import "server-only";
import {billingWorkAutomaticConfiguration,AUTOMATIC_FUNCTION_SECONDS,AUTOMATIC_RESPONSE_RESERVE_MS} from "./billing-work-auto-config";
import {createAutomaticBillingRuntime} from "./billing-work-auto-execution";
import {runAutomaticBillingWork} from "./billing-work-auto-runner";
/** Registration is best effort. The database queue is the durable recovery path.
 * No self HTTP, logs, request targets, retries or inline fallback.
 */
export function registerAutomaticBillingKick(register:(task:()=>Promise<void>)=>void,confirmedAdmissions:number,invocationStartedAt:number):void {
 try{
  if(confirmedAdmissions<1)return;
  const config=billingWorkAutomaticConfiguration("kick");
  if(config.state!=="enabled")return;
  register(async()=>{
   try{
    // Recheck disable/target guards at execution, then share the remaining
    // function lifetime with admission. No fresh 90s budget after response.
    const effective=billingWorkAutomaticConfiguration("kick");
    if(effective.state!=="enabled")return;
    const remaining=AUTOMATIC_FUNCTION_SECONDS*1_000-AUTOMATIC_RESPONSE_RESERVE_MS-(performance.now()-invocationStartedAt);
    await runAutomaticBillingWork(effective,()=>createAutomaticBillingRuntime(effective),remaining);
   }catch{/* Never change webhook outcome or expose private data. */}
  });
 }catch{/* Registration failure cannot undo durable admission. */}
}
