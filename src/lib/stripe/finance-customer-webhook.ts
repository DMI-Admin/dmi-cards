import "server-only";
import {resolveDmiCharge,type DmiHistoricalProof} from "./finance-dmi-charge-integration";
import type {SupabaseClient} from "@supabase/supabase-js";
import {produceInvoiceProofCandidates} from "./finance-invoice-proof-producer";
import {decideFinanceApplication} from "./finance-foreign-event";
import {FinanceLeaseBusyFailure} from "./finance-store";
import {acquireLeaseWithRetry} from "./lease-acquisition-timing";
import {projectVerifiedFinanceRouting} from "./finance-routing-evidence";
import {resolveVerifiedFinanceRouting} from "./finance-customer-relationship-adapter";
import {validateFinanceGraphOwnership,validateFinanceBundleOwnership} from "./finance-customer-ownership";
import {prepareFinanceSync} from "./finance-sync";
import {objectId,type EventEvidence,type Runtime,type Root,type Graph,type Resource,type StoredRow} from "./finance-contract";
const unsupported=new Set(["checkout.session.completed","invoice.payment_succeeded","customer.created","invoice_payment.paid"]);
/** Internal only. Receives the original signature-verified snapshot and reviewed narrative separately.
 * No path falls back to the legacy writer. Ownership identifiers never enter diagnostics.
 */
export async function consumeCustomerFinanceEvent(verified:EventEvidence,event:EventEvidence,r:Runtime,roots:Record<string,Root["kind"]>) {
 const epoch=r.financeProtocol!.epoch;
 if(r.dmiProofOptions&&(r.dmiProofOptions.approval!=="reviewed_staging_dmi_charge_v1"||r.dmiProofOptions.approvedScope!==r.scope||!r.scope.endsWith(":test")))throw Error("FINANCE_PROOF_OPT_IN");
 if(r.invoiceProofProduction&&(r.invoiceProofProduction.approval!=="reviewed_staging_invoice_proofs_v1"||r.invoiceProofProduction.approvedScope!==r.scope||!r.scope.endsWith(":test")))throw Error("FINANCE_PROOF_OPT_IN");
 const receipt=await r.store.command<{duplicate?:boolean;token:string}>("event_claim",r.scope,null,{id:event.id,type:event.type,subject:objectId(event.data.object),created:new Date(event.created*1000).toISOString()});
 if(receipt.duplicate)return {outcome:"duplicate"};
 try {
  const kind=roots[event.type];
  if(!kind){
   if(!unsupported.has(event.type))throw Error("FINANCE_CUSTOMER_UNSUPPORTED");
   await r.store.command("partition_ignored",r.scope,receipt.token,{expected_epoch:epoch,event_id:event.id,reason:"unsupported_event"});
   return {outcome:"ignored",complete:false};
  }
  if(!r.relationshipDb)throw Error("FINANCE_CUSTOMER_ROUTING_UNAVAILABLE");
  let decision=await decideFinanceApplication(r.relationshipDb,r.scope,verified);
  let chargeProof:DmiHistoricalProof|undefined;
  if(decision.state==="unresolved"&&r.dmiProofOptions?.consumption&&kind==="charge"){
   const proof=await resolveDmiCharge(r.relationshipDb as SupabaseClient,verified,r.scope);
   if(proof.state==="conflict")throw Error("FINANCE_OWNERSHIP_CONFLICT");
   if(proof.state==="dmi"){
    chargeProof=proof.proof;
    const prices=proof.proof.prices.map(p=>({scope:r.scope,type:"price" as const,id:p.id}));
    decision={state:"dmi",evidence:{scope:r.scope,id:objectId(verified.data.object),kind:"charge",complete:true,relationships:[proof.proof.invoice],dependencies:[{scope:r.scope,id:proof.proof.invoice,kind:"invoice",complete:true,prices}]},proofs:proof.proof.prices.map(p=>({scope:r.scope,type:"price" as const,id:p.id,application:p.application,revision:p.revision}))};
   }
  }
  if(decision.state==="unresolved")throw Error("FINANCE_OWNERSHIP_UNRESOLVED");
  if(decision.state==="conflict")throw Error("FINANCE_OWNERSHIP_CONFLICT");
  if(decision.state==="foreign"){
   await r.store.command("foreign_complete",r.scope,receipt.token,{event_id:event.id,expected_epoch:epoch,evidence:decision.evidence,proofs:decision.proofs});
   return {outcome:"ignored",complete:false};
  }
  const evidence=projectVerifiedFinanceRouting(r.scope,verified);
  const routing=await resolveVerifiedFinanceRouting(r.relationshipDb,r.scope,evidence);
  if(routing.status!=="routed"&&routing.status!=="resolved")throw Error("FINANCE_CUSTOMER_ROUTING_UNRESOLVED");
  const partition=routing.partition;
  const acquire=()=>r.store.command<{token:string;revision:string;epoch:number}>("partition_claim",r.scope,null,{customer:partition.customer,expected_epoch:epoch});
  const retryPolicy=r.leaseRetry?{...r.leaseRetry,emit:(metadata:Parameters<typeof r.leaseRetry.emit>[0])=>r.leaseRetry!.emit({...metadata,lease_kind:"customer"})}:undefined;
  const lease=retryPolicy?await acquireLeaseWithRetry(retryPolicy,"finance",acquire,error=>error instanceof FinanceLeaseBusyFailure&&error.message==="FINANCE_BUSY"):await acquire();
  let committed=false;
  try {
   if(lease.epoch!==epoch)throw Error("FINANCE_PROTOCOL_EPOCH");
   const stored:Partial<Record<Resource,Record<string,unknown>[]>>={};let graph:Graph|undefined;
   const remember=(kind:Resource,row:StoredRow)=>{
    const rows=stored[kind]??=[];const key=(x:Record<string,unknown>)=>x.stripe_object_id??x.attempt_key??x.activity_key;
    if(!rows.some(x=>key(x)===key(row)))rows.push(structuredClone(row));
   };
   const guarded:Runtime={...r,source:{...r.source,graph:async root=>{
    const fetched=await r.source.graph(root);
    if(!validateFinanceGraphOwnership(partition,fetched).valid)throw Error("FINANCE_CUSTOMER_GRAPH_OWNERSHIP");
    graph=structuredClone(fetched);return fetched;
   }},store:{...r.store,read:async(...args)=>{const row=await r.store.read(...args);if(row)remember(args[0],row);return row;},items:async(...args)=>{const rows=await r.store.items(...args);for(const row of rows)remember("items",row);return rows;}}};
   // Includes existing financial/attribution rules and retirement of stored items.
   const prepared=await prepareFinanceSync(guarded,{kind,id:objectId(event.data.object)},event,"webhook");
   // Raw PaymentIntent allocations omit the charge relationship derived by normalization.
   // The opt-in proof path checks stored identity against the complete normalized bundle,
   // which retains that derived relationship; raw graph ownership is checked separately.
   const graphStored=r.dmiProofOptions?.production||r.dmiProofOptions?.consumption?undefined:stored;
   if(!graph||!validateFinanceGraphOwnership(partition,graph,graphStored).valid||!validateFinanceBundleOwnership(partition,prepared.bundle,stored).valid)throw Error("FINANCE_CUSTOMER_BUNDLE_OWNERSHIP");
   const input={customer:partition.customer,expected_epoch:epoch,expected_partition_revision:lease.revision,event_id:event.id,event_token:receipt.token,bundle:prepared.bundle};
   await r.store.command("partition_bind",r.scope,lease.token,input);
   let proofInvoices:string[]=[];
   if(chargeProof){
    if(!("proofs" in decision))throw Error("FINANCE_PROOF_AUTHORITY");
    const {customer,...commitInput}=input;
    const candidates=r.invoiceProofProduction?produceInvoiceProofCandidates(r.scope,partition.customer,graph,prepared.bundle,decision.proofs):undefined;
    proofInvoices=candidates?.filter(c=>c.state==="proven").map(c=>c.invoice)??[];
    await r.store.command("dmi_charge_commit",r.scope,lease.token,{customer,input:commitInput,proof:chargeProof,...(candidates?{candidates,authority:{evidence:decision.evidence,proofs:decision.proofs}}:{})});
   }else if(r.invoiceProofProduction){
    if(decision.state!=="dmi"||!("proofs" in decision))throw Error("FINANCE_PROOF_AUTHORITY");
    const candidates=produceInvoiceProofCandidates(r.scope,partition.customer,graph,prepared.bundle,decision.proofs);
    const {customer,...commitInput}=input;
    proofInvoices=candidates.filter(c=>c.state==="proven").map(c=>c.invoice);
    await r.store.command("invoice_proof_commit",r.scope,lease.token,{customer,input:commitInput,candidates,authority:{evidence:decision.evidence,proofs:decision.proofs}});
   }else await r.store.command("partition_commit",r.scope,lease.token,input);
   committed=true;
   return {outcome:"processed",complete:prepared.complete,...(r.dmiProofOptions?.wake&&proofInvoices.length?{proofInvoices}:{})};
  }finally{
   // Successful commit clears the lease atomically; do not release it a second time.
   if(!committed)await r.store.command("partition_release",r.scope,lease.token,{customer:partition.customer,expected_epoch:epoch}).catch(()=>undefined);
  }
 }catch(error){
  const code=error instanceof Error&&/^FINANCE_[A-Z_]+$/.test(error.message)?error.message:"FINANCE_RETRYABLE_FAILURE";
  await r.store.command("event_fail",r.scope,receipt.token,{id:event.id,error:code}).catch(()=>undefined);
  throw Error(code);
 }
}
