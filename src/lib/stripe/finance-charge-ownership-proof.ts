import "server-only";
import { classifyFinanceApplication, type OwnershipRecord, type OwnershipKey } from "./finance-application-ownership";
import { safeId } from "./finance-customer-relationships";

// Independent application limits; the existing two-read routing contract is unchanged.
export const CHARGE_PROOF_DEADLINE_MS = 2_000;
export const CHARGE_PROOF_MAX_READS = 6;
export const CHARGE_PROOF_MAX_ALLOCATIONS = 2;
export const CHARGE_PROOF_MAX_PRICES = 2;
export const chargeProofColumns = {
  payment: ["stripe_scope", "stripe_object_id", "stripe_customer_id", "stripe_payment_intent_id"],
  allocation: ["stripe_scope", "stripe_object_id", "stripe_invoice_id", "stripe_charge_id", "stripe_payment_intent_id"],
  invoice: ["stripe_scope", "stripe_object_id", "stripe_customer_id", "stripe_subscription_id", "revision"],
} as const;
type Row = Record<string, unknown>;
/** Trusted server storage only: minimal columns, exact equality filters, no retries/providers.
 * Allocation adapters must fetch limit=3 (cap+1), reject truncation, and report completeness.
 * No Supabase adapter is supplied here; this module is inactive specification/composition.
 */
export interface ChargeProofStorage {
  readPayment(request: {scope:string; id:string; columns:readonly string[]; signal:AbortSignal}): Promise<Row|null>;
  readAllocations(request: {scope:string; field:"stripe_charge_id"|"stripe_payment_intent_id"; value:string;
    columns:readonly string[]; limit:3; signal:AbortSignal}): Promise<{rows:Row[]; complete:boolean}>;
  readInvoice(request: {scope:string; id:string; columns:readonly string[]; signal:AbortSignal}): Promise<Row|null>;
  readOwnership(request: {key:OwnershipKey; signal:AbortSignal}): Promise<OwnershipRecord|null>;
}
/** Already signature-verified charge projection. Schema validation is NOT signature verification. */
export type VerifiedChargeProofInput = {scope:string; type:"charge.succeeded"|"charge.failed"|"charge.captured"|"charge.refunded";
  charge:string; customer:string; paymentIntent:string|null};
/** Internal evidence from a trusted complete invoice snapshot, NOT current subscription items.
 * Existing billing_invoices does not persist these fields. A future caller must supply genuine
 * verified evidence or return unresolved; no invented DB column/provider fallback is allowed.
 * invoiceRevision binds evidence to the exact stored relationship revision. Registry revisions
 * bind the reviewed price proofs. This is not financial write/foreign-completion authority.
 */
export type VerifiedInvoicePriceEvidence = {scope:string; invoice:string; customer:string; subscription:string|null;
  invoiceRevision:string; complete:boolean; prices:readonly {id:string; ownershipRevision:number}[]};
export type ChargeProofReason = "invalid_evidence"|"missing_relationship"|"allocation_ambiguous"|"incomplete_evidence"|
  "ownership_unresolved"|"ownership_stale"|"ownership_conflict"|"lookup_unavailable"|"read_budget_exhausted"|
  "lookup_timeout_ambiguous"|"lookup_cancelled_ambiguous";
export type ChargeOwnershipProof = {state:"dmi"|"foreign"; proof:{scope:string; charge:string; invoice:string;
  invoiceRevision:string; prices:readonly {id:string; application:string; revision:number}[]}}|
  {state:"unresolved"|"conflict"; reason:ChargeProofReason};
export type ChargeProofClock = {now:()=>number; setTimer:(work:()=>void,ms:number)=>ReturnType<typeof setTimeout>;
  clearTimer:(timer:ReturnType<typeof setTimeout>)=>void};
const revision = (v:unknown):v is string => typeof v==="string" && /^[1-9][0-9]{0,18}$/.test(v) && BigInt(v)<=BigInt("9223372036854775807");
const unresolved = (reason:ChargeProofReason):ChargeOwnershipProof=>({state:"unresolved",reason});
const conflict = ():ChargeOwnershipProof=>({state:"conflict",reason:"ownership_conflict"});
/** No I/O unless invoked with injected trusted storage. Success proofs contain INTERNAL IDs:
 * never log/serialize them to browsers, System Health or AI. Failures contain fixed codes only.
 * Six reads maximum: payment, two exact allocation indexes, invoice, up to two price records.
 * Two allocation rows may describe one invoice; multiple invoices stay unresolved.
 */
export async function resolveChargeOwnershipProof(storage:ChargeProofStorage,input:VerifiedChargeProofInput,
  invoiceEvidence:readonly VerifiedInvoicePriceEvidence[],options:{signal?:AbortSignal; clock?:ChargeProofClock}={}):Promise<ChargeOwnershipProof> {
  const clock=options.clock??{now:()=>performance.now(),setTimer:setTimeout,clearTimer:clearTimeout};
  const start=clock.now(),controller=new AbortController();let reads=0;
  let interruption:ChargeProofReason="lookup_timeout_ambiguous";
  let stop!:()=>void;
  const interrupted=new Promise<ChargeOwnershipProof>(resolve=>{stop=()=>resolve(unresolved(interruption));});
  controller.signal.addEventListener("abort",stop,{once:true});
  const cancel=()=>{interruption="lookup_cancelled_ambiguous";controller.abort();};
  const timer=clock.setTimer(()=>controller.abort(),CHARGE_PROOF_DEADLINE_MS);
  options.signal?.addEventListener("abort",cancel,{once:true});
  if(options.signal?.aborted)cancel();
  class Stop extends Error {constructor(readonly reason:ChargeProofReason){super("CHARGE_PROOF_STOP");}}
  function check() {
    if(clock.now()-start>=CHARGE_PROOF_DEADLINE_MS)controller.abort();
    if(controller.signal.aborted)throw new Stop(interruption);
  }
  async function read<T>(work:()=>Promise<T>):Promise<T> {
    check();if(++reads>CHARGE_PROOF_MAX_READS)throw new Stop("read_budget_exhausted");
    try {const value=await work();check();return value;} catch(error){
      check();if(error instanceof Stop)throw error;throw new Stop("lookup_unavailable");
    }
  }
  async function work():Promise<ChargeOwnershipProof> {
    try {
      check();
      if(!input || !/^acct_[A-Za-z0-9]{1,240}:(test|live)$/.test(input.scope) ||
        !["charge.succeeded","charge.failed","charge.captured","charge.refunded"].includes(input.type) ||
        !safeId(input.charge,"ch") || !safeId(input.customer,"cus") ||
        (input.paymentIntent!==null&&!safeId(input.paymentIntent,"pi")) ||
        !Array.isArray(invoiceEvidence)||invoiceEvidence.length>2)return unresolved("invalid_evidence");
      const {scope,charge,customer,paymentIntent}=input,signal=controller.signal;
      const payment=await read(()=>storage.readPayment({scope,id:charge,columns:chargeProofColumns.payment,signal}));
      if(!payment)return unresolved("missing_relationship");
      if(payment.stripe_scope!==scope||payment.stripe_object_id!==charge)return unresolved("invalid_evidence");
      if(payment.stripe_customer_id!==customer)return conflict();
      if(payment.stripe_payment_intent_id!==paymentIntent)return unresolved("allocation_ambiguous");
      const byCharge=await read(()=>storage.readAllocations({scope,field:"stripe_charge_id",value:charge,
        columns:chargeProofColumns.allocation,limit:3,signal}));
      const byIntent=paymentIntent===null?{rows:[],complete:true}:await read(()=>storage.readAllocations({scope,
        field:"stripe_payment_intent_id",value:paymentIntent,columns:chargeProofColumns.allocation,limit:3,signal}));
      const rows=new Map<string,Row>();
      for(const [set,field,value] of [[byCharge,"stripe_charge_id",charge],[byIntent,"stripe_payment_intent_id",paymentIntent]] as const) {
        if(!set||!Array.isArray(set.rows)||set.complete!==true||set.rows.length>CHARGE_PROOF_MAX_ALLOCATIONS)return unresolved("incomplete_evidence");
        for(const row of set.rows) {
          if(!row||row.stripe_scope!==scope||row[field]!==value||!safeId(row.stripe_object_id,"inpay")||
            !safeId(row.stripe_invoice_id,"in"))return unresolved("invalid_evidence");
          if(row.stripe_charge_id!==charge||row.stripe_payment_intent_id!==paymentIntent)return unresolved("allocation_ambiguous");
          const prior=rows.get(row.stripe_object_id);
          if(prior&&chargeProofColumns.allocation.some(k=>prior[k]!==row[k]))return unresolved("allocation_ambiguous");
          rows.set(row.stripe_object_id,row);
        }
      }
      if(paymentIntent!==null) {
        const ids=(set:{rows:Row[]})=>new Set(set.rows.map(row=>String(row.stripe_object_id)));
        const chargeIds=ids(byCharge),intentIds=ids(byIntent);
        if(chargeIds.size!==intentIds.size||[...chargeIds].some(id=>!intentIds.has(id)))return unresolved("allocation_ambiguous");
      }
      if(!rows.size)return unresolved("missing_relationship");
      if(rows.size>CHARGE_PROOF_MAX_ALLOCATIONS)return unresolved("incomplete_evidence");
      const invoices=new Set([...rows.values()].map(row=>String(row.stripe_invoice_id)));
      if(invoices.size!==1)return unresolved("allocation_ambiguous");
      const invoice=[...invoices][0];
      const stored=await read(()=>storage.readInvoice({scope,id:invoice,columns:chargeProofColumns.invoice,signal}));
      if(!stored)return unresolved("missing_relationship");
      if(stored.stripe_scope!==scope||stored.stripe_object_id!==invoice||!revision(stored.revision)||
        (stored.stripe_subscription_id!==null&&!safeId(stored.stripe_subscription_id,"sub")))return unresolved("invalid_evidence");
      if(stored.stripe_customer_id!==customer)return conflict();
      const evidence=invoiceEvidence.filter(e=>e&&e.scope===scope&&e.invoice===invoice);
      if(evidence.length!==1)return unresolved(evidence.length?"allocation_ambiguous":"incomplete_evidence");
      const snapshot=evidence[0];
      if(snapshot.customer!==customer)return conflict();
      if(snapshot.subscription!==stored.stripe_subscription_id||snapshot.invoiceRevision!==stored.revision)return unresolved("ownership_stale");
      if(snapshot.complete!==true||!Array.isArray(snapshot.prices)||!snapshot.prices.length||snapshot.prices.length>CHARGE_PROOF_MAX_PRICES)return unresolved("incomplete_evidence");
      if(snapshot.prices.some((p:{id:string;ownershipRevision:number})=>!p||!safeId(p.id,"price")||!Number.isSafeInteger(p.ownershipRevision)||p.ownershipRevision<1)||
        new Set(snapshot.prices.map((p:{id:string;ownershipRevision:number})=>p.id)).size!==snapshot.prices.length)return unresolved("invalid_evidence");
      const records:OwnershipRecord[]=[],keys:OwnershipKey[]=[];
      for(const price of snapshot.prices) {
        const key:OwnershipKey={scope,type:"price",id:price.id};keys.push(key);
        const record=await read(()=>storage.readOwnership({key,signal}));
        if(!record)return unresolved("ownership_unresolved");
        if(record.scope!==scope||record.type!=="price"||record.id!==price.id)return unresolved("invalid_evidence");
        if(record.state!=="active"||record.applicationActive!==true||record.revision!==price.ownershipRevision)return unresolved("ownership_stale");
        records.push(record);
      }
      const decision=classifyFinanceApplication(scope,{scope,id:charge,kind:"charge",complete:true,
        relationships:[invoice],dependencies:[{scope,id:invoice,kind:"invoice",complete:true,prices:keys}]},records);
      check();
      if(decision.state==="conflict")return conflict();
      if(decision.state==="unresolved")return unresolved("ownership_unresolved");
      return {state:decision.state,proof:{scope,charge,invoice,invoiceRevision:snapshot.invoiceRevision,
        prices:records.map(r=>({id:r.id,application:r.application,revision:r.revision}))}};
    }catch(error){return unresolved(error instanceof Stop?error.reason:"invalid_evidence");}
  }
  try{return await Promise.race([work(),interrupted]);}
  finally{clock.clearTimer(timer);options.signal?.removeEventListener("abort",cancel);}
}
