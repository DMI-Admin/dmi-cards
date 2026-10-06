import "server-only";
import type {InvoiceTaxEvidence, TaxBreakdown, ForecastTaxEvidence, FinanceItem, Discount} from "./finance-types";

const object=(v:unknown):Record<string,unknown>|null=>v!==null&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:null;
const amount=(v:unknown):string|null=>{
 const s=typeof v==="string"?v:typeof v==="number"&&Number.isSafeInteger(v)?v.toString():"";
 return /^-?\d+$/.test(s)&&BigInt(s)>=-BigInt("9223372036854775808")&&BigInt(s)<=BigInt("9223372036854775807")?BigInt(s).toString():null;
};
const otherTaxTypes=new Set(["amusement_tax","communications_tax","gst","hst","igst","jct","lease_tax","mass_transit_parking_tax","parking_tax","pst","qst","retail_delivery_fee","rst","sales_tax","service_tax"]);
const reasons=new Set(["customer_exempt","not_available","not_collecting","not_subject_to_tax","not_supported","portion_product_exempt","portion_reduced_rated","portion_standard_rated","product_exempt","product_exempt_holiday","proportionally_rated","reduced_rated","reverse_charge","standard_rated","taxable_basis_reduced","zero_rated"]);
/** Only current finalized invoice totals establish actual tax. Never forecasts or collections. */
export function invoiceTaxEvidence(input:unknown):InvoiceTaxEvidence {
 const o=object(input)||{},a=object(o.automatic_tax);
 const e:InvoiceTaxEvidence={version:1,status:"unknown",reason:"tax_evidence_missing",basis:"unavailable",grossMinor:amount(o.total),taxMinor:null,vatMinor:null,netMinor:null,
 automaticTaxEnabled:typeof a?.enabled==="boolean"?a.enabled:null,
 automaticTaxStatus:a?.status===null?null:["complete","failed","requires_location_inputs"].includes(String(a?.status))?a!.status as InvoiceTaxEvidence["automaticTaxStatus"]:"unknown",
 breakdownComplete:false,linesComplete:false,lineCount:null,breakdown:[]};
 const lines=object(o.lines);
 if(lines?.has_more===false&&Array.isArray(lines.data)&&lines.data.length<=200){
  const ids=lines.data.map(x=>object(x)?.id);
  e.linesComplete=ids.every(id=>typeof id==="string"&&/^il_[A-Za-z0-9]+$/.test(id))&&new Set(ids).size===ids.length&&lines.data.every(x=>object(x)?.currency===o.currency&&object(x)?.invoice===o.id&&object(x)?.livemode===o.livemode);
  e.lineCount=e.linesComplete?ids.length:null;
 }
 const rates=object(o._finance_tax_rates)||{};
 if(!Array.isArray(o.total_taxes)||o.total_taxes.length>100)return e;
 for(const raw of o.total_taxes){
  const t=object(raw),details=object(t?.tax_rate_details),rateId=details?.tax_rate;
  if(!t||amount(t.amount)===null||!["inclusive","exclusive"].includes(String(t.tax_behavior))||t.type!=="tax_rate_details"||typeof rateId!=="string"||!/^txr_[A-Za-z0-9]+$/.test(rateId)||t.taxable_amount!=null&&amount(t.taxable_amount)===null){e.reason="tax_breakdown_invalid";return e;}
  const rate=object(rates[rateId]);
  const pct=typeof rate?.percentage==="number"&&Number.isFinite(rate.percentage)?rate.percentage.toString():typeof rate?.percentage==="string"?rate.percentage:null;
  const verifiedRate=rate?.id===rateId&&rate.livemode===o.livemode;
  const part:TaxBreakdown={amountMinor:amount(t.amount)!,taxableAmountMinor:t.taxable_amount==null?null:amount(t.taxable_amount),behavior:t.tax_behavior as TaxBreakdown["behavior"],taxRateId:rateId,
   ratePercent:verifiedRate&&pct!==null&&/^\d{1,3}(?:\.\d{1,12})?$/.test(pct)?pct:null,
   taxType:verifiedRate?(rate.tax_type==="vat"?"vat":otherTaxTypes.has(String(rate.tax_type))?"other":"unknown"):"unknown",
   country:verifiedRate&&typeof rate.country==="string"&&/^[A-Z]{2}$/.test(rate.country)?rate.country:null,
   reason:typeof t.taxability_reason==="string"&&reasons.has(t.taxability_reason)?t.taxability_reason:"unknown"};
  e.breakdown.push(part);
 }
 e.breakdownComplete=true;
 if(!e.linesComplete){e.reason="invoice_lines_incomplete";return e;}
 if(!["open","paid","uncollectible","void"].includes(String(o.status))||!Number.isSafeInteger(object(o.status_transitions)?.finalized_at)){e.reason="invoice_not_finalized";return e;}
 if(e.automaticTaxEnabled===null||e.automaticTaxEnabled&&e.automaticTaxStatus!=="complete"){e.reason="automatic_tax_unverified";return e;}
 const net=amount(o.total_excluding_tax);
 if(net===null||e.grossMinor===null){e.reason="invoice_net_missing";return e;}
 const tax=e.breakdown.reduce((n,t)=>n+BigInt(t.amountMinor),BigInt(0));
 if(BigInt(net)+tax!==BigInt(e.grossMinor)){e.reason="invoice_tax_totals_mismatch";return e;}
 e.status="verified";e.reason="verified_invoice_totals";e.basis="finalized_invoice";e.netMinor=net;e.taxMinor=tax.toString();
 // Unknown classification is not VAT=0. Multiple tax components remain separate.
 if(e.breakdown.every(t=>t.taxType!=="unknown"))e.vatMinor=e.breakdown.filter(t=>t.taxType==="vat").reduce((n,t)=>n+BigInt(t.amountMinor),BigInt(0)).toString();
 return e;
}
/** No preview/tax assessment is fetched in this phase. Historical invoices cannot certify a future rate. */
export function forecastTaxEvidence(item:Omit<FinanceItem,"forecast_tax_evidence">,parentDiscounts:Discount[]):ForecastTaxEvidence {
 return {version:1,status:"unknown",basis:"unavailable",reason:"forecast_tax_evidence_missing",sourceRef:null,verifiedAt:null,
 configuration:{version:1,scope:item.stripe_scope,subscriptionId:item.stripe_subscription_id,itemId:item.stripe_object_id,priceId:item.stripe_price_id,currency:item.currency,quantity:item.quantity,interval:item.recurring_interval,intervalCount:item.interval_count,taxBehavior:item.tax_behavior,discounts:[...parentDiscounts,...item.discount_context]},grossMinor:null,taxMinor:null,netMinor:null};
}
