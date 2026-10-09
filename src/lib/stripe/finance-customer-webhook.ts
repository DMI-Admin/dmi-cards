import "server-only";
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
  const decision=await decideFinanceApplication(r.relationshipDb,r.scope,verified);
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
   if(!graph||!validateFinanceGraphOwnership(partition,graph,stored).valid||!validateFinanceBundleOwnership(partition,prepared.bundle,stored).valid)throw Error("FINANCE_CUSTOMER_BUNDLE_OWNERSHIP");
   const input={customer:partition.customer,expected_epoch:epoch,expected_partition_revision:lease.revision,event_id:event.id,event_token:receipt.token,bundle:prepared.bundle};
   await r.store.command("partition_bind",r.scope,lease.token,input);
   await r.store.command("partition_commit",r.scope,lease.token,input);
   committed=true;
   return {outcome:"processed",complete:prepared.complete};
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
