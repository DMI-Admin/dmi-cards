import "server-only";
import type {SupabaseClient} from "@supabase/supabase-js";
import {resolveChargeOwnershipProof, type VerifiedInvoicePriceEvidence} from "./finance-charge-ownership-proof";
import {readFinanceOwnership} from "./finance-application-ownership-adapter";
import {objectId, type EventEvidence, type Runtime} from "./finance-contract";
export type DmiHistoricalProof={scope:string;charge:string;invoice:string;invoiceRevision:string;certificateRevision:string;paymentIntent:string|null;prices:readonly {id:string;application:string;revision:number}[]};
export type DmiProofOptions = {approvedScope:string;approval:"reviewed_staging_dmi_charge_v1";production:boolean;consumption:boolean;wake:boolean};
/** Trusted server injection only. Undefined disables all three options; no environment/browser reads. */
export function configureDmiProofs(r:Runtime,options?:DmiProofOptions):void {
 if(!options)return;
 if([options.production,options.consumption,options.wake].some(flag=>typeof flag!=="boolean")||options.approval!=="reviewed_staging_dmi_charge_v1"||options.approvedScope!==r.scope||!/^acct_[A-Za-z0-9]{1,240}:test$/.test(r.scope))throw Error("FINANCE_PROOF_OPT_IN");
 r.dmiProofOptions=options;
 if(options.production)r.invoiceProofProduction={approvedScope:r.scope,approval:"reviewed_staging_invoice_proofs_v1"};
}
/** Six resolver reads remain unchanged: the invoice read includes the latest certificate.
 * Certificate RPC rechecks anchors/authority. No subscription-price fallback or provider calls.
 */
export async function resolveDmiCharge(db:SupabaseClient,event:EventEvidence,scope:string):Promise<{state:"dmi";proof:DmiHistoricalProof}|{state:"unresolved"|"conflict";reason:string}>{
 const evidence:VerifiedInvoicePriceEvidence[]=[];
 const query=async(table:string,columns:readonly string[],field:string,value:string,signal:AbortSignal)=>{
  const {data,error}=await db.from(table).select(columns.join(",")).eq("stripe_scope",scope).eq(field,value).abortSignal(signal).maybeSingle();
  if(error)throw Error("FINANCE_STORE_UNAVAILABLE");return data as Record<string,unknown>|null;
 };
 let certificateRevision:string|undefined;
 const result=await resolveChargeOwnershipProof({
  readPayment:q=>query("billing_payments",q.columns,"stripe_object_id",q.id,q.signal),
  readAllocations:async q=>{const {data,error}=await db.from("billing_invoice_payments").select(q.columns.join(",")).eq("stripe_scope",scope).eq(q.field,q.value).limit(q.limit).abortSignal(q.signal);if(error)throw Error("FINANCE_STORE_UNAVAILABLE");return {rows:(data??[]) as unknown as Record<string,unknown>[],complete:!!data&&data.length<q.limit};},
  readInvoice:async q=>{
   const {data,error}=await db.rpc("billing_finance_dmi_invoice_context",{p_scope:scope,p_invoice:q.id}).abortSignal(q.signal);
   if(error)throw Error("FINANCE_STORE_UNAVAILABLE");
   if(!data?.invoice)return null;
   const certificate=data.certificate;
   if(certificate?.state==="proven"&&certificate.application_key==="dmi_cards"){certificateRevision=String(certificate.certificate_revision);evidence.push({scope,invoice:q.id,customer:certificate.stripe_customer_id,subscription:certificate.stripe_subscription_id,invoiceRevision:String(certificate.source_invoice_revision),complete:certificate.lines_complete===true,prices:certificate.registry_proofs.map((ref:{price_id:string;revision:number})=>({id:ref.price_id,ownershipRevision:ref.revision}))});}
   return data.invoice;
  },
  readOwnership:async q=>{const read=await readFinanceOwnership(db,[q.key],{signal:q.signal});if(read.state!=="read")throw Error("FINANCE_STORE_UNAVAILABLE");return read.records[0]??null;},
 },{scope,type:event.type as "charge.succeeded",charge:objectId(event.data.object),customer:objectId(event.data.object.customer),paymentIntent:objectId(event.data.object.payment_intent)||null},evidence);
 // This certificate path never emits foreign, even if injected evidence is invalid.
 if(result.state==="foreign")return {state:"unresolved" as const,reason:"ownership_unresolved" as const};
 if(result.state==="dmi"&&certificateRevision)return {state:"dmi",proof:{...result.proof,certificateRevision,paymentIntent:objectId(event.data.object.payment_intent)||null}};
 if(result.state==="unresolved"&&result.reason==="allocation_ambiguous")return {state:"conflict" as const,reason:"ownership_conflict" as const};
 return {state:result.state==="conflict"?"conflict":"unresolved",reason:"reason" in result?result.reason:"ownership_unresolved"};
}
