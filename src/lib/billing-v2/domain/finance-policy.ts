import type {FinanceInput,FinanceDecision} from "./types";
import {trustedEvidence} from "./subscription-policy";
import {financeContract} from "./finance-contract";
export function decideFinance(i:FinanceInput):FinanceDecision {
 const fail=(reason:"invalid_evidence"|"ownership_conflict"|"dependency_unresolved",kind:"reject"|"attention"|"defer"="defer"):FinanceDecision=>({kind,reason,businessWrites:0});
 if(!trustedEvidence(i.task,false))return fail("invalid_evidence","reject");
 if(!i.complete||i.rows.length>500)return fail("dependency_unresolved");
 if(i.binding.scope!==i.task.scope)return fail("ownership_conflict","attention");
 const type=i.task.eventType||"",subject=i.task.subject||"";
 const root=type.startsWith("invoice.")?"invoices":type.startsWith("customer.subscription.")?"finance_subscriptions":type.startsWith("refund.")||type.startsWith("charge.refund.")?"refunds":type.startsWith("charge.")?"payments":null;
 if(!root||!subject||!i.rows.some(r=>r.table===root&&r.columns.stripe_object_id===subject))return fail("invalid_evidence","attention");
 if(root==="refunds"&&i.rows.some(r=>r.table==="refunds"&&!i.rows.some(p=>p.table==="payments"&&p.columns.stripe_object_id===r.columns.stripe_charge_id)))return fail("dependency_unresolved");
 const rows=new Map<string,typeof i.rows[number]>();
 for(const row of i.rows){
  if(!Object.hasOwn(financeContract,row.table)||!/^\d+$/.test(row.expectedRevision))return fail("invalid_evidence","attention");
  const contract=financeContract[row.table];const c=row.columns;
  if(Object.keys(c).some(k=>!(contract.columns as readonly string[]).includes(k))||c.stripe_scope!==i.task.scope||(c.stripe_customer_id!==undefined&&c.stripe_customer_id!==i.binding.customer))return fail("ownership_conflict","attention");
  for(const key of contract.money){const value=c[key];if(value!==undefined&&value!==null&&(typeof value!=="string"||!(/^-?\d+(\.\d+)?$/).test(value)))return fail("invalid_evidence","attention");}
  const key=contract.pk.map(k=>c[k]).join(":");if(rows.has(row.table+":"+key))return fail("invalid_evidence","attention");rows.set(row.table+":"+key,row);
 }
 for(const proof of i.proofs){
  if(!proof.complete||proof.application!=="dmi_cards"||proof.customer!==i.binding.customer||!proof.prices.length)return fail("dependency_unresolved");
  if(proof.prices.some(p=>!i.catalog.some(c=>c.scope===i.task.scope&&c.id===p.id&&c.revision===p.revision&&c.active&&c.application==="dmi_cards")))return fail("dependency_unresolved");
 }
 for(const row of i.rows){const c=row.columns;
  if(row.table==="finance_subscriptions"&&(c.linkage_status==="verified"&&(!i.binding.verified||c.user_id!==i.binding.principalId)))return fail("ownership_conflict","attention");
  if(row.table==="finance_subscription_items"&&!i.catalog.some(p=>p.scope===i.task.scope&&p.id===c.stripe_price_id&&p.active&&p.application==="dmi_cards"))return fail("dependency_unresolved");
  if(row.table==="invoices"&&!i.proofs.some(p=>p.invoice===c.stripe_object_id&&p.customer===c.stripe_customer_id&&p.subscription===(c.stripe_subscription_id??null)))return fail("dependency_unresolved");
  if(row.table==="payments"||row.table==="refunds"||row.table==="payment_attempts"){
   const charge=String(row.table==="payments"?c.stripe_object_id:c.stripe_charge_id||"");
   if(!charge||!i.proofs.some(p=>p.allocations.some(a=>a.charge===charge&&(c.stripe_payment_intent_id==null||a.intent===c.stripe_payment_intent_id))))return fail("dependency_unresolved");
  }
  if(row.table==="invoice_payments"&&!i.proofs.some(p=>p.invoice===c.stripe_invoice_id&&p.allocations.some(a=>a.id===c.stripe_object_id&&a.charge===(c.stripe_charge_id??null)&&a.intent===(c.stripe_payment_intent_id??null))))return fail("dependency_unresolved");
 }
 return {kind:"commit",rows:i.rows,proofs:i.proofs};
}
