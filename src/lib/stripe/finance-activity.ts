import "server-only";
import type { FinanceActivity } from "./finance-types";
import type { EventEvidence, Resource, StoredRow } from "./finance-contract";
/** Current-state refreshes without signed transition evidence never fabricate activity. */
export function transitionActivity(resource:Resource,before:StoredRow|null,after:StoredRow,event:EventEvidence|undefined,origin:FinanceActivity["origin"]):FinanceActivity|null {
 if(!event||origin!=="webhook"||event.data.object.id!==after.stripe_object_id)return null;
 const watermark=before?.source_event_created_at;
 if(typeof watermark==="string"&&event.created*1000<Date.parse(watermark))return null;
 const snapshot=event.data.object,previous=event.data.previous_attributes||{};
 let kind:FinanceActivity["kind"]|undefined,amount:string|null=null,currency:string|null=null,effective:string|null=null;
 if(resource==="subscriptions"&&after.linkage_status==="verified") {
  if(event.type==="customer.subscription.created"&&snapshot.created===Date.parse(String(after.stripe_created_at))/1000)kind="subscription_created";
  if(before&&event.type==="customer.subscription.updated"&&before.cancel_at_period_end!==after.cancel_at_period_end&&previous.cancel_at_period_end===before.cancel_at_period_end&&snapshot.cancel_at_period_end===after.cancel_at_period_end) {
   kind=after.cancel_at_period_end?"cancellation_scheduled":"cancellation_reversed";
   effective=typeof after.cancel_at==="string"?after.cancel_at:null;
  }
  if(event.type==="customer.subscription.deleted"&&after.status==="canceled"&&snapshot.status==="canceled"&&before?.status!=="canceled")kind="subscription_ended";
 } else if(resource==="invoices"&&event.type==="invoice.paid"&&after.status==="paid"&&snapshot.status==="paid") {
  kind="invoice_paid";amount=String(after.amount_paid_minor);currency=String(after.currency);
 } else if(resource==="refunds"&&after.status==="succeeded"&&after.succeeded_at&&snapshot.status==="succeeded") {
  kind="refund_issued";amount=String(after.amount_minor);currency=String(after.currency);
 }
 if(!kind)return null;
 const revision=(BigInt(String(before?.revision||0))+BigInt(1)).toString();
 const transition=kind.startsWith("cancellation_")?`:${revision}`:"";
 return {stripe_scope:after.stripe_scope,activity_key:`${resource}:${after.stripe_object_id}:${kind}${transition}`,kind,
 stripe_customer_id:String(after.stripe_customer_id),stripe_subscription_id:resource==="subscriptions"?String(after.stripe_object_id):typeof after.stripe_subscription_id==="string"?after.stripe_subscription_id:null,
 object_type:resource,object_id:String(after.stripe_object_id),occurred_at:kind==="invoice_paid"&&typeof after.paid_at==="string"?after.paid_at:kind==="refund_issued"&&typeof (before?.succeeded_at??after.succeeded_at)==="string"?String(before?.succeeded_at??after.succeeded_at):kind==="subscription_created"?String(after.stripe_created_at):new Date(event.created*1000).toISOString(),amount_minor:amount,currency,effective_at:effective,source_event_id:event.id,origin,source_revision:revision};
}
