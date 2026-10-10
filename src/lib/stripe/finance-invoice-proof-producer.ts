import "server-only";
import {objectId, type Bundle, type Graph} from "./finance-contract";
import type {ForeignProof} from "./finance-foreign-event";

/** Internal, non-loggable candidates from the already-fetched verified graph only.
 * Completeness is a trusted adapter assertion; current subscription prices are never a substitute.
 * This producer performs no I/O and never predicts the SQL invoice revision.
 */
export type InvoiceProofCandidate = {
 proof_version:1; invoice:string; customer:string; subscription:string|null; verified_at:string;
 api_version:string; normalizer_version:number; event_id:string|null; event_created_at:string|null;
 state:"proven"|"unresolved"; reason_code:null|"incomplete_evidence"|"ownership_unresolved";
 line_count:number; lines_complete:boolean; line_evidence:{line_id:string;price_id:string}[];
 registry_proofs:{price_id:string;application_key:"dmi_cards";revision:number}[];
};
const valid=(v:unknown,prefix:string):v is string=>typeof v==="string"&&new RegExp(`^${prefix}_[A-Za-z0-9]{1,240}$`).test(v);
const obj=(v:unknown):Record<string,unknown>|null=>v!==null&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:null;
export function produceInvoiceProofCandidates(scope:string,customer:string,graph:Graph,bundle:Bundle,authority:readonly ForeignProof[]):InvoiceProofCandidate[] {
 if(!/^acct_[A-Za-z0-9]{1,240}:test$/.test(scope)||!valid(customer,"cus")||bundle.invoices.length>200)throw Error("FINANCE_PROOF_INPUT");
 const invoices=new Map<string,Record<string,unknown>>();
 for(const raw of graph.invoices){if(!valid(raw.id,"in")||invoices.has(raw.id))throw Error("FINANCE_PROOF_INPUT");invoices.set(raw.id,raw);}
 const seen=new Set<string>();
 const candidates=bundle.invoices.map(({row}):InvoiceProofCandidate=>{
  const id=row.stripe_object_id,raw=invoices.get(id);
  if(!valid(id,"in")||seen.has(id)||!raw||row.stripe_scope!==scope||row.stripe_customer_id!==customer||objectId(raw.customer)!==customer||raw.livemode!==false)throw Error("FINANCE_PROOF_SOURCE");
  seen.add(id);
  const parent=obj(raw.parent),details=obj(parent?.subscription_details);
  const subscription=objectId(details?.subscription)||objectId(raw.subscription)||null;
  if(subscription!==row.stripe_subscription_id||(subscription!==null&&!valid(subscription,"sub")))throw Error("FINANCE_PROOF_SOURCE");
  const candidate:InvoiceProofCandidate={proof_version:1,invoice:id,customer,subscription:row.stripe_subscription_id,verified_at:row.verified_at,
   api_version:row.stripe_api_version,normalizer_version:row.normalizer_version,event_id:row.source_event_id,event_created_at:row.source_event_created_at,
   state:"unresolved",reason_code:"incomplete_evidence",line_count:0,lines_complete:false,line_evidence:[],registry_proofs:[]};
  const lines=obj(raw.lines);
  if(!lines||!Array.isArray(lines.data))return candidate;
  const complete=graph.complete&&lines.has_more===false;
  if(lines.data.length>200)throw Error("FINANCE_PROOF_INPUT");
  const ids=new Set<string>(),evidence:{line_id:string;price_id:string}[]=[];let missingPrice=false;
  for(const value of lines.data){
   const line=obj(value);
   if(!line||!valid(line.id,"il")||ids.has(line.id)||objectId(line.invoice)!==id||line.livemode!==false||line.currency!==raw.currency)throw Error("FINANCE_PROOF_SOURCE");
   ids.add(line.id);
   const pricing=obj(line.pricing),priceDetails=obj(pricing?.price_details);
   const price=objectId(priceDetails?.price);
   if(!pricing||pricing.type!=="price_details"||!price){missingPrice=true;continue;}
   if(!valid(price,"price"))throw Error("FINANCE_PROOF_INPUT");
   // Reject contradictory old/new representations; never use legacy line.price as authority.
   if(line.price!=null&&objectId(line.price)!==price)throw Error("FINANCE_PROOF_SOURCE");
   evidence.push({line_id:line.id,price_id:price});
  }
  const prices=[...new Set(evidence.map(e=>e.price_id))].sort();
  if(prices.length>2)throw Error("FINANCE_PROOF_INPUT");
  if(!complete)return candidate;
  if(!lines.data.length||missingPrice){candidate.reason_code="ownership_unresolved";return candidate;}
  const refs:InvoiceProofCandidate["registry_proofs"]=[];
  for(const price of prices){
   const matches=authority.filter(p=>p.scope===scope&&p.type==="price"&&p.id===price);
   if(!matches.length){candidate.reason_code="ownership_unresolved";return candidate;}
   if(matches.length!==1||matches[0].application!=="dmi_cards"||!Number.isSafeInteger(matches[0].revision)||matches[0].revision<1)throw Error("FINANCE_PROOF_AUTHORITY");
   refs.push({price_id:price,application_key:"dmi_cards",revision:matches[0].revision});
  }
  return {...candidate,state:"proven",reason_code:null,line_count:evidence.length,lines_complete:true,
   line_evidence:evidence.sort((a,b)=>a.line_id<b.line_id?-1:a.line_id>b.line_id?1:0),registry_proofs:refs};
 });
 return candidates.sort((a,b)=>a.invoice<b.invoice?-1:a.invoice>b.invoice?1:0);
}
