import "server-only";
import {reviewedFinanceEvent} from "./finance-event-evidence";
import {withFinanceLease,prepareFinanceSync} from "./finance-sync";
import {objectId,type EventEvidence,type Root,type Runtime} from "./finance-contract";
const eventRoots:Record<string,Root["kind"]>={
 "customer.subscription.created":"subscription","customer.subscription.updated":"subscription","customer.subscription.deleted":"subscription",
 "invoice.finalized":"invoice","invoice.updated":"invoice","invoice.paid":"invoice","invoice.payment_failed":"invoice","invoice.voided":"invoice","invoice.marked_uncollectible":"invoice",
 "charge.refunded":"charge","charge.refund.updated":"refund",
 "charge.succeeded":"charge","charge.failed":"charge","charge.captured":"charge",
 "refund.created":"refund","refund.updated":"refund","refund.failed":"refund",
};
/** Input MUST be the output of mandatory signature verification. Not an HTTP route. */
export async function consumeFinanceEvent(event:EventEvidence,r:Runtime) {
 const review=()=>reviewedFinanceEvent(event);
 event=r.observer?r.observer.sync("envelope",review):review();
 if(event.livemode!==r.scope.endsWith(":live")||(event.account&&r.scope.split(":")[0]!==event.account))throw Error("FINANCE_EVENT_SCOPE");
 if(!/^evt_[A-Za-z0-9]+$/.test(event.id)||!Number.isSafeInteger(event.created)||event.created<0||!objectId(event.data.object))throw Error("FINANCE_EVENT_SHAPE");
 const identity=await r.source.identity();if(identity.scope!==r.scope||identity.apiVersion!==r.apiVersion)throw Error("FINANCE_RUNTIME_CHANGED");
 const claim=await r.store.command<{duplicate?:boolean;token:string}>("event_claim",r.scope,null,{id:event.id,type:event.type,subject:objectId(event.data.object),created:new Date(event.created*1000).toISOString()});
 if(claim.duplicate)return {outcome:"duplicate"};
 try{
  return await withFinanceLease(r,async lease=>{
   const kind=eventRoots[event.type];let ignored=!kind;
   let prepared:Awaited<ReturnType<typeof prepareFinanceSync>>|undefined;
   if(kind){try{prepared=await prepareFinanceSync(r,{kind,id:objectId(event.data.object)},event,"webhook");}catch(error){if(error instanceof Error&&error.message==="FINANCE_FOREIGN_APPLICATION")ignored=true;else throw error;}}
   await r.store.command("commit",r.scope,lease.token,{expected_scope_revision:lease.revision,event_id:event.id,event_token:claim.token,ignored,...prepared?.bundle});
   return {outcome:ignored?"ignored":"processed",complete:prepared?.complete??false};
  });
 }catch(error){
  const code=error instanceof Error&&/^FINANCE_[A-Z_]+$/.test(error.message)?error.message:"FINANCE_RETRYABLE_FAILURE";
  await r.store.command("event_fail",r.scope,claim.token,{id:event.id,error:code}).catch(()=>undefined);
  throw Error(code);
 }
}
/** Each consumer commits independently. Finance initialization failure cannot skip entitlement.
 * Sequential settlement lets successful entitlement establish customer linkage first.
 */
export async function orchestrateBillingConsumers<T>(event:EventEvidence,entitlement:(event:EventEvidence)=>Promise<T>,runtime:Runtime|(()=>Promise<Runtime>)):Promise<[T,Awaited<ReturnType<typeof consumeFinanceEvent>>]> {
 const [access]=await Promise.allSettled([Promise.resolve().then(()=>entitlement(event))]);
 const [finance]=await Promise.allSettled([Promise.resolve().then(async()=>{const r=typeof runtime==="function"?await runtime():runtime;const consume=()=>consumeFinanceEvent(event,r);return r.observer?r.observer.run("consumer",consume):consume();})]);
 if(access.status==="rejected"||finance.status==="rejected")throw Error("BILLING_CONSUMER_RETRY_REQUIRED");
 return [access.value,finance.value];
}
