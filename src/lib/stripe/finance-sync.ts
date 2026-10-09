import "server-only";
import {FinanceLeaseBusyFailure} from "./finance-store";
import {acquireLeaseWithRetry} from "./lease-acquisition-timing";
import {normalizeSubscription,normalizeInvoice,normalizeInvoicePayment,normalizeCharge,normalizeFailedCharge,normalizeRefund} from "./finance-normalize";
import type {FinanceContext,FinanceActivity} from "./finance-types";
import {emptyBundle,objectId,record,type Bundle,type EventEvidence,type Root,type Runtime,type Resource,type Rows,type StoredRow} from "./finance-contract";
import {transitionActivity} from "./finance-activity";

export type Lease={token:string;revision:string};
export async function withFinanceLease<T>(r:Runtime,work:(lease:Lease)=>Promise<T>):Promise<T> {
 const acquire=()=>r.store.command<Lease>("claim",r.scope,null);
 const lease=r.leaseRetry
  ? await acquireLeaseWithRetry(r.leaseRetry,"finance",acquire,error=>error instanceof FinanceLeaseBusyFailure&&error.message==="FINANCE_BUSY")
  : await acquire();
 try{return await work(lease);}finally{await r.store.command("release",r.scope,lease.token).catch(()=>undefined);}
}
function context(r:Runtime,event?:EventEvidence):FinanceContext {
 const snapshot=event?.data.object;
 return {scope:r.scope,apiVersion:r.apiVersion,verifiedAt:r.now(),...(event?{event:{id:event.id,type:event.type,subjectId:objectId(snapshot),created:event.created,
  subjectStatus:typeof snapshot?.status==="string"?snapshot.status:undefined,previousStatus:typeof event.data.previous_attributes?.status==="string"?event.data.previous_attributes.status:undefined,
  subjectCaptured:snapshot?.captured===true,capturedAmountMinor:Number.isSafeInteger(snapshot?.amount_captured)?String(snapshot?.amount_captured):undefined}}:{})};
}
export async function prepareFinanceSync(r:Runtime,root:Root,event?:EventEvidence,origin:FinanceActivity["origin"]="reconciliation"):Promise<{bundle:Bundle;complete:boolean}> {
 // Caller MUST acquire the scope lease before this retrieval (all public entrypoints do).
 const identity=await r.source.identity();
 if(identity.scope!==r.scope||identity.apiVersion!==r.apiVersion)throw Error("FINANCE_RUNTIME_CHANGED");
 const retrieve=()=>r.source.graph(root);
 const graph=r.observer?await r.observer.run("stripe_retrieval",retrieve):await retrieve(),c=context(r,event),bundle=emptyBundle();
 if(!graph.complete)throw Error("FINANCE_GRAPH_INCOMPLETE");
 for(const rows of [graph.subscriptions,graph.customers,graph.invoices,graph.charges,graph.allocations,graph.refunds]) {
  if(rows.length>200||new Set(rows.map(x=>x.id)).size!==rows.length)throw Error("FINANCE_GRAPH_BOUND");
  for(const row of rows)if(row.livemode!==r.scope.endsWith(":live"))throw Error("FINANCE_SCOPE_MISMATCH");
 }
 const namespace=graph.subscriptions.map(sub=>record(sub.metadata).dmi_app==="dmi_cards_v2");
 if(namespace.length&&namespace.every(v=>!v))throw Error("FINANCE_FOREIGN_APPLICATION");
 if(namespace.some(v=>!v))throw Error("FINANCE_ATTRIBUTION_CONFLICT");
 const prior=new Map<string,StoredRow|null>();
 async function append<K extends Resource>(resource:K,row:Rows[K]) {
  const data=row as unknown as StoredRow;
  const key=String(data.stripe_object_id??data.attempt_key??data.activity_key);
  const before=await r.store.read(resource,r.scope,key);prior.set(`${resource}:${key}`,before);
  (bundle[resource] as {row:Rows[K];expected_revision:string}[]).push({row,expected_revision:String(before?.revision||0)});
  return before;
 }
 let complete=true;
 for(const raw of graph.subscriptions){
  const validate=async()=>{
  const customerId=objectId(raw.customer),customer=graph.customers.find(x=>x.id===customerId);
  if(!customer||customer.deleted===true)throw Error("FINANCE_CUSTOMER_MISSING");
  const meta=record(raw.metadata),customerMeta=record(customer.metadata),binding=await r.store.binding(r.scope,customerId);
  const user=typeof meta.dmi_user_id==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(meta.dmi_user_id)?meta.dmi_user_id:null;
  if(customerMeta.dmi_app&&customerMeta.dmi_app!=="dmi_cards_v2")throw Error("FINANCE_ATTRIBUTION_CONFLICT");
  if((meta.dmi_profile_id&&meta.dmi_profile_id!==user)||(customerMeta.dmi_user_id&&customerMeta.dmi_user_id!==user)||(binding&&binding.user_id!==user))throw Error("FINANCE_ATTRIBUTION_CONFLICT");
  const verified=user&&binding?.verified_at?user:null;
   return verified;
  };
  const verified=r.observer?await r.observer.run("identity_binding",validate):await validate();
  const normalize=()=>normalizeSubscription(raw,c,verified,r.observer?.assertion);
  const normalized=r.observer?r.observer.sync("normalization",normalize):normalize();
  await append("subscriptions",normalized.subscription);
  for(const item of normalized.items)await append("items",item);
  // A complete item listing retires missing items without destroying history.
  if(normalized.subscription.items_complete){
   for(const old of await r.store.items(r.scope,String(raw.id)))if(!old.removed_at&&!normalized.items.some(x=>x.stripe_object_id===old.stripe_object_id)){
    const {revision: _revision,created_at:_created,updated_at:_updated,...row}=old;
    void _revision;void _created;void _updated;
    await append("items",{...row,verified_at:c.verifiedAt,removed_at:c.verifiedAt} as unknown as Rows["items"]);
   }
  }
  if(!verified||normalized.subscription.valuation_status!=="complete")complete=false;
 }
 for(const raw of graph.invoices){
  const row=normalizeInvoice(raw,c);
  const parent=bundle.subscriptions.find(x=>x.row.stripe_object_id===row.stripe_subscription_id)?.row;
  if(row.stripe_subscription_id&&!parent)throw Error("FINANCE_SUBSCRIPTION_MISSING");
  if(parent&&parent.stripe_customer_id!==row.stripe_customer_id)throw Error("FINANCE_ATTRIBUTION_CONFLICT");
  row.payments_complete=graph.complete;
  await append("invoices",row);
  if(!parent||parent.linkage_status!=="verified")complete=false;
 }
 for(const raw of graph.charges)await append("payments",normalizeCharge(raw,c));
 for(const raw of graph.allocations){
  const allocation=normalizeInvoicePayment(raw,c),invoice=bundle.invoices.find(x=>x.row.stripe_object_id===allocation.stripe_invoice_id)?.row;
  if(!invoice)throw Error("FINANCE_INVOICE_MISSING");
  // A single verified successful Charge for a PaymentIntent establishes allocation.
  if(allocation.stripe_payment_intent_id){
   const charges=bundle.payments.filter(x=>x.row.stripe_payment_intent_id===allocation.stripe_payment_intent_id&&x.row.status==="succeeded"&&x.row.paid&&x.row.captured);
   if(charges.length>1)throw Error("FINANCE_AMBIGUOUS_PAYMENT");
   allocation.stripe_charge_id=charges[0]?.row.stripe_object_id||null;
  }
  if(allocation.currency!==invoice.currency)throw Error("FINANCE_CURRENCY_CONFLICT");
  await append("allocations",allocation);
 }
 for(const {row:payment} of bundle.payments){
  const links=bundle.allocations.filter(x=>x.row.stripe_charge_id===payment.stripe_object_id);
  const allocated=links.reduce((sum,{row:a})=>sum+BigInt(a.amount_paid_minor??"0"),BigInt(0));
  const verified=links.length>0&&allocated===BigInt(payment.amount_captured_minor)&&links.every(({row:a})=>{
   const invoice=bundle.invoices.find(x=>x.row.stripe_object_id===a.stripe_invoice_id)?.row;
   const sub=bundle.subscriptions.find(x=>x.row.stripe_object_id===invoice?.stripe_subscription_id)?.row;
   return invoice?.stripe_customer_id===payment.stripe_customer_id&&sub?.linkage_status==="verified"&&payment.currency===a.currency;
  });
  payment.attribution_status=verified?"verified":"unresolved";
  if(!verified)complete=false;
  if(payment.status==="succeeded"&&!payment.collected_at&&!prior.get(`payments:${payment.stripe_object_id}`)?.collected_at)complete=false;
 }
 for(const raw of graph.refunds){
  const refund=normalizeRefund(raw,c),payment=bundle.payments.find(x=>x.row.stripe_object_id===refund.stripe_charge_id)?.row;
  if(!payment)throw Error("FINANCE_PAYMENT_MISSING");
  if(refund.currency!==payment.currency)throw Error("FINANCE_CURRENCY_CONFLICT");
  await append("refunds",refund);
  if(refund.status==="succeeded"&&!refund.succeeded_at&&!prior.get(`refunds:${refund.stripe_object_id}`)?.succeeded_at)complete=false;
 }
 if(event?.type==="charge.failed"){
  // Immutable occurrence evidence is from the signed snapshot, not a later recovery.
  const raw=event.data.object,charge=bundle.payments.find(x=>x.row.stripe_object_id===raw.id)?.row;
  if(!charge||objectId(raw.customer)!==charge.stripe_customer_id||objectId(raw.payment_intent)!==(charge.stripe_payment_intent_id||"")||raw.currency!==charge.currency||String(raw.amount)!==charge.amount_minor)throw Error("FINANCE_FAILURE_IDENTITY");
  const attempt=normalizeFailedCharge(raw,{...c,apiVersion:event.api_version});
  const allocations=bundle.allocations.filter(x=>x.row.stripe_payment_intent_id===attempt.stripe_payment_intent_id);
  if(allocations.length===1)attempt.stripe_invoice_id=allocations[0].row.stripe_invoice_id;
  const old=await append("attempts",attempt);
  const invoice=bundle.invoices.find(x=>x.row.stripe_object_id===attempt.stripe_invoice_id)?.row;
  const sub=bundle.subscriptions.find(x=>x.row.stripe_object_id===invoice?.stripe_subscription_id)?.row;
  if(!old&&sub?.linkage_status==="verified"&&origin==="webhook")await append("activity",{stripe_scope:r.scope,activity_key:`attempt:${attempt.attempt_key}`,kind:"payment_failed",stripe_customer_id:attempt.stripe_customer_id,
   stripe_subscription_id:sub.stripe_object_id,object_type:"attempt",object_id:attempt.attempt_key,occurred_at:attempt.occurred_at,amount_minor:attempt.amount_minor,currency:attempt.currency,effective_at:null,source_event_id:event.id,origin,source_revision:null});
 }
 for(const resource of ["subscriptions","invoices","refunds"] as const)for(const {row} of bundle[resource]){
  let eligible=true,customer:string|undefined,sub:string|null=null;
  if(resource==="invoices"){
   const invoice=row as Rows["invoices"],parent=bundle.subscriptions.find(x=>x.row.stripe_object_id===invoice.stripe_subscription_id)?.row;
   eligible=parent?.linkage_status==="verified";
  }
  if(resource==="refunds"){
   const refund=row as Rows["refunds"],payment=bundle.payments.find(x=>x.row.stripe_object_id===refund.stripe_charge_id)?.row;
   eligible=payment?.attribution_status==="verified";customer=payment?.stripe_customer_id;
   const allocation=bundle.allocations.find(x=>x.row.stripe_charge_id===payment?.stripe_object_id)?.row;
   sub=bundle.invoices.find(x=>x.row.stripe_object_id===allocation?.stripe_invoice_id)?.row.stripe_subscription_id||null;
  }
  if(!eligible)continue;
  const activity=transitionActivity(resource,prior.get(`${resource}:${row.stripe_object_id}`)||null,{...row,...(customer?{stripe_customer_id:customer,stripe_subscription_id:sub}:{})} as unknown as StoredRow,event,origin);
  if(activity)await append("activity",activity);
 }
 return {bundle,complete};
}
export async function synchronizeFinance(r:Runtime,root:Root,origin:FinanceActivity["origin"]="reconciliation") {
 return withFinanceLease(r,async lease=>{
  const prepared=await prepareFinanceSync(r,root,undefined,origin);
  await r.store.command("commit",r.scope,lease.token,{expected_scope_revision:lease.revision,...prepared.bundle});
  return {complete:prepared.complete};
 });
}
