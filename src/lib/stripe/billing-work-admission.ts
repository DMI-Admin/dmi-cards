import "server-only";
import {prepareBillingWorkEvidence,type VerifiedWorkEvent,type WorkConsumer} from "./billing-work-evidence";

// Undefined is disabled. Only the separately guarded webhook handoff may opt in.
export type WorkAdmissionOptIn = {approvedScope:string;approval:"reviewed_staging_work_admission_v2"};
export type WorkAdmissionStorage = {rpc(name:"billing_consumer_work_admit",args:{p_scope:string;p_event:string;p_consumer:WorkConsumer;p_input:object}):PromiseLike<{data:unknown;error:unknown}>};
export type WorkAdmissionResult = {state:"disabled"|"admitted"}|{state:"rejected";reason:"invalid_configuration"|"unsupported_event"|"invalid_evidence"|"admission_ambiguous"};
/** Internal signature-verified input only. One short action per consumer. No partition
 * inference, provider call, automatic retry, or HTTP acknowledgement is performed.
 * A lost response is ambiguous: redelivery must use the SAME exact immutable key.
 */
export async function admitBillingConsumerWork(storage:WorkAdmissionStorage,scope:string,event:VerifiedWorkEvent,consumer:WorkConsumer,optIn?:WorkAdmissionOptIn):Promise<WorkAdmissionResult> {
 if(!optIn)return {state:"disabled"};
 if(optIn.approval!=="reviewed_staging_work_admission_v2"||optIn.approvedScope!==scope||!/^acct_[A-Za-z0-9]{1,240}:test$/.test(scope))return {state:"rejected",reason:"invalid_configuration"};
 const prepared=prepareBillingWorkEvidence(scope,event,consumer);
 if(prepared.state==="rejected")return prepared;
 try {
  const {data,error}=await storage.rpc("billing_consumer_work_admit",{p_scope:scope,p_event:event.id,p_consumer:consumer,p_input:{consumer_version:prepared.evidence.consumer_version,event_type:event.type,event_created:event.created,evidence:prepared.evidence}});
  if(error||!data||typeof data!=="object"||!("state" in data)||! ["pending","processing","retry_wait","dependency_wait","completed","needs_attention"].includes(String(data.state)))return {state:"rejected",reason:"admission_ambiguous"};
  return {state:"admitted"};
 }catch{return {state:"rejected",reason:"admission_ambiguous"};}
}
