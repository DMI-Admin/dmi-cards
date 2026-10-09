import "server-only";
import type {SupabaseClient} from "@supabase/supabase-js";
import {projectVerifiedFinanceRouting} from "./finance-routing-evidence";
import {financeRoutingEvents} from "./finance-customer-routing";
import {resolveVerifiedFinanceRouting} from "./finance-customer-relationship-adapter";
import {RELATIONSHIP_DEADLINE_MS,safeId} from "./finance-customer-relationships";
import {readFinanceOwnership} from "./finance-application-ownership-adapter";
import {classifyFinanceApplication,type OwnershipEvidence,type OwnershipKey} from "./finance-application-ownership";
import {objectId,record,type EventEvidence} from "./finance-contract";
export type ForeignProof={scope:string;type:"price"|"customer";id:string;application:string;revision:number};
export type ApplicationDecision={state:"dmi"|"foreign";evidence:OwnershipEvidence;proofs:ForeignProof[]}|{state:"unresolved"|"conflict"};
/** Only the original signature-verified event may enter. Internal, non-loggable proof.
 * One shared monotonic 2-second deadline. Each existing adapter retains <=2 reads:
 * at most four exact reads total (two relationships + two registry records).
 * No provider fallback: sparse/unsupported chains stay unresolved.
 */
export async function decideFinanceApplication(db:Pick<SupabaseClient,"from">,scope:string,verified:EventEvidence):Promise<ApplicationDecision>{
 const controller=new AbortController(),start=performance.now();let reads=0;
 const timer=setTimeout(()=>controller.abort(),RELATIONSHIP_DEADLINE_MS);
 const bounded={from:(...args:Parameters<typeof db.from>)=>{if(controller.signal.aborted||performance.now()-start>=RELATIONSHIP_DEADLINE_MS||++reads>4)throw Error("FINANCE_OWNERSHIP_UNRESOLVED");return db.from(...args);}} as Pick<SupabaseClient,"from">;
 let stop!:()=>void;const cancelled=new Promise<ApplicationDecision>(resolve=>{stop=()=>resolve({state:"unresolved"});});controller.signal.addEventListener("abort",stop,{once:true});
 const work=async():Promise<ApplicationDecision>=>{
  try{
   const projected=projectVerifiedFinanceRouting(scope,verified),raw=verified.data.object;
   const kind=financeRoutingEvents[verified.type as keyof typeof financeRoutingEvents];
   const evidence:OwnershipEvidence={scope,id:objectId(raw),kind,complete:true};
   const routing=await resolveVerifiedFinanceRouting(bounded,scope,projected,{signal:controller.signal});
   if(routing.status!=="routed"&&routing.status!=="resolved")return {state:routing.reason==="conflicting_ownership"?"conflict":"unresolved"};
   const customer=routing.partition.customer;
   if(kind==="refund"){
    const charge=objectId(projected.data.object.charge);if(!safeId(charge,"ch"))return {state:"unresolved"};
    evidence.relationships=[charge];evidence.dependencies=[{scope,id:charge,kind:"charge",complete:true,customer:{scope,type:"customer",id:customer}}];
   }
   if(!safeId(customer,"cus"))return {state:"unresolved"};
   if(kind!=="refund")evidence.customer={scope,type:"customer",id:customer};
   if(kind==="subscription"){
    const items=record(raw.items);if(items.has_more!==false||!Array.isArray(items.data)||!items.data.length||items.data.length>20)return {state:"unresolved"};
    const prices=items.data.map(item=>objectId(record(item).price));if(prices.some(id=>!safeId(id,"price")))return {state:"unresolved"};
    evidence.prices=[...new Set(prices)].map(id=>({scope,type:"price",id}));
   }else if(kind==="invoice"&&raw.lines!=null){
    const lines=record(raw.lines);if(lines.has_more!==false||!Array.isArray(lines.data)||lines.data.length>20)return {state:"unresolved"};
    const prices=lines.data.map(line=>objectId(record(line).price));if(prices.some(id=>!safeId(id,"price")))return {state:"unresolved"};
    evidence.prices=[...new Set(prices)].map(id=>({scope,type:"price",id}));
   }
   const keys:OwnershipKey[]=[{scope,type:"customer",id:customer},...(evidence.prices??[])];
   const read=await readFinanceOwnership(bounded,keys,{signal:controller.signal});
   if(read.state!=="read"||controller.signal.aborted||performance.now()-start>=RELATIONSHIP_DEADLINE_MS)return {state:"unresolved"};
   const result=classifyFinanceApplication(scope,evidence,read.records);
   if(result.state==="unresolved"||result.state==="conflict")return {state:result.state};
   return {state:result.state,evidence,proofs:read.records.filter(r=>r.state==="active"&&r.applicationActive).map(r=>({scope:r.scope,type:r.type,id:r.id,application:r.application,revision:r.revision}))};
  }catch{return {state:"unresolved"};}
 };
 try{return await Promise.race([work(),cancelled]);}finally{clearTimeout(timer);}
}
