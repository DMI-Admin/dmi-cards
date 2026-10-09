import "server-only";

export type OwnershipKey = {scope:string;type:"price"|"customer";id:string};
export type OwnershipRecord = OwnershipKey & {application:string;basis:"price_owner"|"exclusive_customer";
 provenance:"operator_review"|"reviewed_dmi_price";revision:number;state:"active"|"revoked";applicationActive:boolean};
export type OwnershipResult = {state:"dmi"|"foreign"|"unresolved"|"conflict"};
/** Internal verified relationship projection, never a browser request or metadata authority.
 * Complete means the caller proved the entire relevant relationship/item/line set.
 * Dependencies express refund->charge, charge->invoice/allocation and invoice->subscription.
 * No provider/DB work is performed. Missing edges must be represented as incomplete.
 */
export type OwnershipEvidence = {scope:string;id:string;relationships?:string[];kind:"subscription"|"invoice"|"allocation"|"charge"|"refund";complete:boolean;
 customer?:OwnershipKey;prices?:OwnershipKey[];dependencies?:OwnershipEvidence[]};
export function validOwnershipKey(k:OwnershipKey):boolean {
 return !!k && /^acct_[A-Za-z0-9]{1,240}:(test|live)$/.test(k.scope) &&
 (k.type==="price"||k.type==="customer") && new RegExp(`^${k.type==="price"?"price":"cus"}_[A-Za-z0-9]{1,240}$`).test(k.id);
}
/** Records MUST come from the trusted exact-read adapter. Metadata is never examined.
 * Expected revisions reject cached stale proofs; final receipt SQL must recheck them later.
 * This fixed output intentionally contains no identifiers or application keys.
 */
export function classifyFinanceApplication(scope:string,evidence:OwnershipEvidence,records:readonly OwnershipRecord[],
 expected:readonly {key:OwnershipKey;revision:number}[]=[]):OwnershipResult {
 let invalid=false,unknown=false;const owners=new Set<string>(),customers=new Set<string>(),seen=new Set<OwnershipEvidence>();let nodes=0;
 const key=(k:OwnershipKey)=>`${k.scope}|${k.type}|${k.id}`;
 const lookup=(k:OwnershipKey):boolean=>{
  if(!validOwnershipKey(k)||k.scope!==scope){invalid=true;return false;}
  const matches=records.filter(r=>key(r)===key(k));
  if(matches.length!==1){if(matches.length>1)invalid=true;return false;}
  const r=matches[0];
  if(!/^[a-z][a-z0-9_]{2,63}$/.test(r.application)||!Number.isSafeInteger(r.revision)||r.revision<1||
   r.basis!==(r.type==="price"?"price_owner":"exclusive_customer")||
   !["operator_review","reviewed_dmi_price"].includes(r.provenance)||
   (r.provenance==="reviewed_dmi_price"&&(r.application!=="dmi_cards"||r.type!=="price"))){invalid=true;return false;}
  if(r.state!=="active"||r.applicationActive!==true)return false;
  owners.add(r.application);return true;
 };
 const walk=(e:OwnershipEvidence,depth:number):boolean=>{
  if(!e||seen.has(e)||++nodes>20||depth>2||!["subscription","invoice","allocation","charge","refund"].includes(e.kind)) {invalid=true;return false;}
  const prefix={subscription:"sub",invoice:"in",allocation:"inpay",charge:"ch",refund:"re"}[e.kind];
  if(e.scope!==scope||!new RegExp(`^${prefix}_[A-Za-z0-9]{1,240}$`).test(e.id)){invalid=true;return false;}
  seen.add(e);if(e.complete!==true){unknown=true;return false;}
  const prices=e.prices??[],deps=e.dependencies??[];
  if(!Array.isArray(prices)||!Array.isArray(deps)||prices.length>20||deps.length>20){invalid=true;return false;}
  const relationships=e.relationships??[];
  if(!Array.isArray(relationships)||relationships.length!==deps.length||new Set(relationships).size!==relationships.length||
   deps.some((d,i)=>!d||d.id!==relationships[i])){invalid=true;return false;}
  if(e.customer){if(!validOwnershipKey(e.customer)||e.customer.scope!==scope){invalid=true;return false;}customers.add(e.customer.id);}
  if(prices.length&&e.kind!=="subscription"&&e.kind!=="invoice"){invalid=true;return false;}
  if(e.customer?.type!==undefined&&e.customer.type!=="customer"){invalid=true;return false;}
  if(e.kind==="allocation"&&e.customer){invalid=true;return false;}
  if(e.kind==="refund"&&(e.customer||prices.length||deps.length!==1||deps[0].kind!=="charge")){invalid=true;return false;}
  const allowed={subscription:[],invoice:["subscription"],allocation:["invoice"],charge:["invoice","allocation"],refund:["charge"]} as const;
  if(deps.some(d=>!allowed[e.kind].some(kind=>kind===d.kind))){invalid=true;return false;}
  let proven=false;
  if(e.customer)proven=lookup(e.customer);
  if(prices.length){const all=prices.map(p=>p.type==="price"?lookup(p):(invalid=true,false));if(all.some(v=>!v))unknown=true;proven=all.every(Boolean)||proven;}
  if(deps.length){const all=deps.map(d=>walk(d,depth+1));if(all.some(v=>!v))unknown=true;proven=all.every(Boolean)||proven;}
  if(!proven)unknown=true;return proven;
 };
 try {
  if(!/^acct_[A-Za-z0-9]{1,240}:(test|live)$/.test(scope)||records.length>20||expected.length>20)return {state:"unresolved"};
  for(const x of expected){const r=records.filter(r=>key(r)===key(x.key));if(!validOwnershipKey(x.key)||x.key.scope!==scope||r.length!==1||r[0].revision!==x.revision||r[0].state!=="active")return {state:"unresolved"};}
  walk(evidence,0);
  if(owners.size>1||customers.size>1)return {state:"conflict"};
  if(invalid||unknown||owners.size!==1)return {state:"unresolved"};
  return {state:owners.has("dmi_cards")?"dmi":"foreign"};
 } catch {return {state:"unresolved"};}
}
