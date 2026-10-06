import "server-only";
import type {FinanceSubscription,FinanceItem,RecurringBreakdown} from "./finance-types";
import {add,decimal,rational,roundMinor,expectedRenewalEligibility} from "./finance-metrics";
/** Uses only V2 source-validated mirror evidence. Not an MRR eligibility function. */
export function contractualRecurring(sub:FinanceSubscription,item:FinanceItem,scope:string,now:string):RecurringBreakdown {
 const taxBasis=item.tax_behavior==="exclusive"?"exclusive":item.tax_behavior==="inclusive"?"inclusive":"unresolved";
 const result:RecurringBreakdown={
 contractualRecurring:{contractVersion:2,status:"unavailable",amountMinor:null,currency:item.currency,reasonCode:"contract_evidence_unavailable",evidenceBasis:"unavailable",taxBasis,interval:item.recurring_interval,intervalCount:item.interval_count},
 taxExclusiveRecurring:{status:"unavailable",amountMinor:null,currency:item.currency,reasonCode:"tax_exclusive_evidence_unavailable",evidenceBasis:"unavailable"},
 taxComponent:{status:"unavailable",amountMinor:null,rateBasisPoints:null,reasonCode:"tax_evidence_unavailable",evidenceBasis:"unavailable"}};
 if(sub.normalizer_version!==2||item.normalizer_version!==2){result.contractualRecurring.reasonCode="normalizer_refresh_required";return result;}
 const reasons=[...(sub.valuation_reason?.split("|")||[]),...(item.valuation_reason?.split("|")||[])];
 if(reasons.some(r=>r!=="tax_basis_unresolved")){result.contractualRecurring.status="unsupported";result.contractualRecurring.reasonCode="pricing_or_discount_unsupported";return result;}
 if(!["exclusive","inclusive","unspecified"].includes(item.tax_behavior)||item.billing_scheme!=="per_unit"||item.usage_type!=="licensed"||!["month","year"].includes(item.recurring_interval)||!Number.isSafeInteger(item.interval_count)||item.interval_count<1)return result;
 if(!["complete","unsupported"].includes(sub.valuation_status)||!["complete","unsupported"].includes(item.valuation_status))return result;
 try{
 // Relax only the tax status in this separate derived calculation; originals stay untouched.
 const eligible=expectedRenewalEligibility({...sub,valuation_status:"complete"},{...item,valuation_status:"complete"},scope,now);
 if(eligible.status!=="complete"||!eligible.value)return result;
 if(item.quantity===null||!/^\d+$/.test(item.quantity))return result;
 const raw=item.unit_amount_decimal_minor??item.unit_amount_minor;if(raw===null)return result;
 let value=decimal(raw);
 if(item.unit_amount_minor!==null&&(!/^\d+$/.test(item.unit_amount_minor)||value.numerator!==BigInt(item.unit_amount_minor)*value.denominator))return result;
 value=rational(value.numerator*BigInt(item.quantity),value.denominator);
 const discounts=[...sub.discount_context,...item.discount_context];if(discounts.length>1)return result;
 for(const d of discounts){
 if(!Number.isFinite(Date.parse(d.starts_at))||Date.parse(d.starts_at)>Date.parse(now)||d.ends_at!==null)return result;
 if((d.percent_off===null)===(d.amount_off_minor===null))return result;
 if(d.percent_off!==null){const pc=decimal(d.percent_off);if(pc.numerator>BigInt(100)*pc.denominator)return result;value=rational(value.numerator*(BigInt(100)*pc.denominator-pc.numerator),value.denominator*BigInt(100)*pc.denominator);}
 else{if(d.currency!==item.currency||!/^\d+$/.test(d.amount_off_minor!))return result;value=add(value,rational(-BigInt(d.amount_off_minor!)));if(value.numerator<BigInt(0))value=rational(BigInt(0));}
 }
 const amount=roundMinor(value);if(BigInt(amount)>BigInt("9223372036854775807"))return result;
 result.contractualRecurring={...result.contractualRecurring,status:"complete",amountMinor:amount,reasonCode:null,evidenceBasis:"normalized_contract_v2"};
 if(taxBasis==="exclusive"&&sub.valuation_status==="complete"&&item.valuation_status==="complete"&&item.effective_cycle_amount_minor===amount)result.taxExclusiveRecurring={status:"complete",amountMinor:amount,currency:item.currency,reasonCode:null,evidenceBasis:"existing_tax_exclusive_valuation"};
 }catch{/* Malformed persisted evidence is unavailable, never coerced into money. */}
 return result;
}
