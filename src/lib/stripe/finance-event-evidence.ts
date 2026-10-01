import "server-only";
import {FINANCE_WEBHOOK_VERSION,record,type EventEvidence,type Raw} from "./finance-contract";

/** Reviewed 2023-10-16 snapshot subset. Signature verification is a caller prerequisite.
 * No invoice totals, subscription items, billing details or raw metadata are forwarded.
 */
export function reviewedFinanceEvent(input:EventEvidence):EventEvidence {
 if(input.api_version!==FINANCE_WEBHOOK_VERSION)throw Error("FINANCE_WEBHOOK_COMPATIBILITY");
 if(!/^evt_[A-Za-z0-9]+$/.test(input.id)||!Number.isSafeInteger(input.created)||input.created<0||input.created>253402300799||typeof input.livemode!=="boolean")throw Error("FINANCE_EVENT_SHAPE");
 const raw=record(input.data.object),previous=record(input.data.previous_attributes||{});
 if(typeof raw.id!=="string"||!raw.id)throw Error("FINANCE_EVENT_SHAPE");
 const object:Raw={id:raw.id};const prior:Raw={};
 let fields:string[]=[];
 if(input.type.startsWith("customer.subscription."))fields=["created","status","cancel_at_period_end"];
 else if(input.type.startsWith("invoice."))fields=["status"];
 else if(input.type==="charge.refund.updated"||input.type.startsWith("refund."))fields=["status"];
 else if(input.type.startsWith("charge."))fields=["status","captured","amount_captured"];
 if(input.type==="charge.failed")fields=["created","livemode","customer","payment_intent","currency","status","paid","captured","amount","amount_captured","amount_refunded","failure_code"];
 for(const field of fields)if(raw[field]!==undefined){
  const value=raw[field];
  if(["customer","payment_intent"].includes(field)){
   const id=typeof value==="object"&&value?record(value).id:value;
   if(id!==null&&typeof id!=="string")throw Error("FINANCE_EVENT_EVIDENCE");object[field]=id;
  }else{
   if(value!==null&&!["string","number","boolean"].includes(typeof value))throw Error("FINANCE_EVENT_EVIDENCE");object[field]=value;
  }
 }
 for(const field of ["status","cancel_at_period_end"])if(previous[field]!==undefined){
  if(typeof previous[field]!== (field==="status"?"string":"boolean"))throw Error("FINANCE_EVENT_EVIDENCE");prior[field]=previous[field];
 }
 if(object.status!==undefined&&typeof object.status!=="string")throw Error("FINANCE_EVENT_EVIDENCE");
 if(object.cancel_at_period_end!==undefined&&typeof object.cancel_at_period_end!=="boolean")throw Error("FINANCE_EVENT_EVIDENCE");
 if(input.type==="charge.failed"&&(object.status!=="failed"||object.paid!==false||object.amount_captured!==0||object.livemode!==input.livemode))throw Error("FINANCE_FAILURE_EVIDENCE");
 return {id:input.id,type:input.type,created:input.created,livemode:input.livemode,api_version:input.api_version,...(input.account?{account:input.account}:{}),data:{object,previous_attributes:prior}};
}
