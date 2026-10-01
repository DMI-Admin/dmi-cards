import "server-only";
import Stripe from "stripe";
import type {AssertionObserver} from "./webhook-observer";
import type { Discount, FinanceContext, FinanceInvoice, FinanceItem, FinancePayment, FinanceRefund, FinanceSubscription, InvoicePayment, PaymentAttempt, Provenance } from "./finance-types";
import { add, decimal, rational, roundMinor } from "./finance-metrics";


// TEMPORARY: assertion diagnostics only; validation and thrown errors are unchanged.
type Check = <T>(path:string,helper:string,value:unknown,work:()=>T)=>T;
const unchecked:Check=(_path,_helper,_value,work)=>work();
function assertionChecks(observer?:AssertionObserver):Check {
 let reported=false;
 return (fieldPath,check,value,work)=>{
  try{return work();}catch(error){
   if(observer&&!reported){reported=true;try{observer({fieldPath,check,present:value!==undefined,primitiveType:value===null?"null":Array.isArray(value)?"array":typeof value,errorCode:error instanceof Error?error.message:"UNCLASSIFIED"});}catch{/* observer cannot affect validation */}}
   throw error;
  }
 };
}

type ObjectValue = Record<string, unknown>;
const MAX = BigInt("9223372036854775807");
function fail(): never { throw Error("FINANCE_MALFORMED_STRIPE_DATA"); }
function object(x:unknown):ObjectValue { if(!x||typeof x!=="object"||Array.isArray(x))return fail(); return x as ObjectValue; }
function text(x:unknown):string { if(typeof x!=="string"||!x.length)return fail();return x; }
// Stripe 22.5 response coercion returns frozen DecimalImpl objects. Never
// coerce arbitrary objects or pass monetary values through JS Number.
const stripeDecimalPrototype = Object.getPrototypeOf(Stripe.Decimal.zero);
function priceDecimalText(x:unknown):string {
 if(typeof x==="string")return text(x);
 if(!x||typeof x!=="object"||Object.getPrototypeOf(x)!==stripeDecimalPrototype||!Object.isFrozen(x))return fail();
 const coefficient=Object.getOwnPropertyDescriptor(x,"_coefficient"),exponent=Object.getOwnPropertyDescriptor(x,"_exponent");
 if(Reflect.ownKeys(x).length!==2||!coefficient||!("value" in coefficient)||typeof coefficient.value!=="bigint"||
    !exponent||!("value" in exponent)||typeof exponent.value!=="number"||!Number.isSafeInteger(exponent.value))return fail();
 // Invoke only the installed SDK implementation, not an input-owned method.
 return text(stripeDecimalPrototype.toString.call(x));
}
function optionalText(x:unknown){return x==null?null:text(x);}
function bool(x:unknown):boolean { if(typeof x!=="boolean")return fail();return x; }
function id(x:unknown,prefix:string):string { const s=text(typeof x==="object"&&x?object(x).id:x);if(!new RegExp(`^${prefix}_[A-Za-z0-9]+$`).test(s))return fail();return s; }
function optionalId(x:unknown,prefix:string){return x==null?null:id(x,prefix);}
function list(x:unknown):unknown[]{if(!Array.isArray(x)||x.length>10000)return fail();return x;}
export function minor(x:unknown,signed=false):string {
  if(typeof x==="number"&&!Number.isSafeInteger(x))return fail();
  if(typeof x!=="string"&&typeof x!=="number")return fail();
  const s=String(x);if(!/^-?\d+$/.test(s))return fail();const n=BigInt(s);
  if(n>MAX||n< -MAX||(!signed&&n<BigInt(0)))return fail();return n.toString();
}
function count(x:unknown,positive=false){const n=minor(x);if(BigInt(n)>BigInt(2147483647)||(positive&&BigInt(n)===BigInt(0)))return fail();return Number(n);}
function iso(x:unknown):string { if(typeof x!=="number"||!Number.isSafeInteger(x)||x<0||x>253402300799)return fail();return new Date(x*1000).toISOString(); }
function time(x:unknown){return x==null?null:iso(x);}
function currency(x:unknown){const s=text(x);if(!/^[a-z]{3}$/.test(s))return fail();return s;}
function validContext(c:FinanceContext){
 if(!/^acct_[A-Za-z0-9]+:(test|live)$/.test(c.scope)||!Number.isFinite(Date.parse(c.verifiedAt))||!c.apiVersion)fail();
 if(c.event){id(c.event.id,"evt");iso(c.event.created);text(c.event.type);text(c.event.subjectId);}
}
function provenance(o:ObjectValue,c:FinanceContext,prefix:string,parentLive?:boolean,check:Check=unchecked,path="subscription"):Provenance {
 check("context","valid_context",undefined,()=>validContext(c));const live=parentLive===undefined?check(path+".livemode","boolean",o.livemode,()=>bool(o.livemode)):parentLive;
 if(c.scope.endsWith(":live")!==live)throw Error("FINANCE_SCOPE_MISMATCH");
 return {stripe_scope:c.scope,stripe_object_id:check(path+".id","id",o.id,()=>id(o.id,prefix)),stripe_created_at:check(path+".created","unix_timestamp",o.created,()=>iso(o.created)),source_event_id:c.event?.id||null,
 source_event_created_at:c.event?iso(c.event.created):null,stripe_api_version:c.apiVersion,normalizer_version:1,verified_at:new Date(c.verifiedAt).toISOString()};
}
function matchingEvent(c:FinanceContext,objectId:string,types:string[]){return Boolean(c.event&&c.event.subjectId===objectId&&types.includes(c.event.type));}
function nullableAmount(x:unknown){return x==null?null:minor(x);}
function sumAmounts(x:unknown){if(x===null)return "0";return minor(list(x).reduce<bigint>((sum,row)=>sum+BigInt(minor(object(row).amount,true)),BigInt(0)).toString(),true);}
const failureCodes=new Set(["card_declined","expired_card","incorrect_cvc","insufficient_funds","processing_error","authentication_required"]);
function failureCode(x:unknown){return typeof x==="string"&&failureCodes.has(x)?x:null;}

function discounts(value:unknown,appliesTo:"subscription"|"item",now:string,check:Check=unchecked,path="subscription.discounts"):{rows:Discount[];issue:string|null} {
 const rows:Discount[]=[];let issue:string|null=null;
 for(const raw of check(path,"array",value,()=>list(value))){
  if(typeof raw==="string"){issue="unexpanded_discount";continue;}
  const d=check(path+"[]","object",raw,()=>object(raw)),source=d.source==null?null:check(path+"[].source","object",d.source,()=>object(d.source)),rawCoupon=source?.coupon??d.coupon;
  if(!rawCoupon||typeof rawCoupon==="string"){issue="unexpanded_coupon";continue;}
  const coupon=check(path+"[].coupon","object",rawCoupon,()=>object(rawCoupon));if(coupon.deleted===true){issue="deleted_coupon";continue;}
  const percent=coupon.percent_off==null?null:String(coupon.percent_off);
  if(percent!==null){const p=check(path+"[].coupon.percent_off","decimal",percent,()=>decimal(percent));if(p.numerator>BigInt(100)*p.denominator)check(path+"[].coupon.percent_off","percent_range",percent,()=>fail());}
  const amount=check(path+"[].coupon.amount_off","minor_units",coupon.amount_off,()=>nullableAmount(coupon.amount_off));
  const row:Discount={discount_id:check(path+"[].id","id",d.id,()=>id(d.id,"di")),coupon_id:check(path+"[].coupon.id","text",coupon.id,()=>text(coupon.id)),applies_to:appliesTo,percent_off:percent,amount_off_minor:amount,
   currency:coupon.currency==null?null:check(path+"[].coupon.currency","currency",coupon.currency,()=>currency(coupon.currency)),starts_at:check(path+"[].start","unix_timestamp",d.start,()=>iso(d.start)),ends_at:check(path+"[].end","optional_timestamp",d.end,()=>time(d.end))};
  rows.push(row);
  if((percent===null)===(amount===null))issue="ambiguous_discount";
  if(coupon.duration!=="forever"||coupon.applies_to!=null||coupon.currency_options!=null)issue="unsupported_discount_context";
  if(Date.parse(row.starts_at)>Date.parse(now)||(row.ends_at&&Date.parse(row.ends_at)<=Date.parse(now)))issue="discount_requires_refresh";
 }
 return {rows,issue};
}
/** Pure normalizer. verifiedUserId comes only from a future trusted identity resolver. */
export function normalizeSubscription(input:unknown,c:FinanceContext,verifiedUserId:string|null=null,observer?:AssertionObserver):{subscription:FinanceSubscription;items:FinanceItem[]} {
 const check=assertionChecks(observer);
 // Catch any future unlabelled assertion without replacing its original error.
 return check("subscription","normalization_boundary",input,()=>{
 const o=check("subscription","object",input,()=>object(input)),base=provenance(o,c,"sub",undefined,check,"subscription");
 if(check("subscription.metadata","object",o.metadata,()=>object(o.metadata)).dmi_app!=="dmi_cards_v2")throw Error("FINANCE_FOREIGN_APPLICATION");
 if(verifiedUserId&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(verifiedUserId))check("context.verified_user","uuid",undefined,()=>fail());
 const sourceItems=check("subscription.items","object",o.items,()=>object(o.items)),complete=!check("subscription.items.has_more","boolean",sourceItems.has_more,()=>bool(sourceItems.has_more)),parentDiscount=discounts(o.discounts,"subscription",c.verifiedAt,check,"subscription.discounts");
 const items=check("subscription.items.data","array",sourceItems.data,()=>list(sourceItems.data)).map(raw=>{
  const it=check("subscription.items[]","object",raw,()=>object(raw)),p=check("subscription.items[].price","object",it.price,()=>object(it.price)),recurring=check("subscription.items[].price.recurring","object",p.recurring,()=>object(p.recurring)),localDiscount=discounts(it.discounts,"item",c.verifiedAt,check,"subscription.items[].discounts");
  const unit=check("subscription.items[].price.unit_amount","minor_units",p.unit_amount,()=>nullableAmount(p.unit_amount)),decimalUnit=p.unit_amount_decimal==null?null:check("subscription.items[].price.unit_amount_decimal","text",p.unit_amount_decimal,()=>priceDecimalText(p.unit_amount_decimal));
  if(decimalUnit!==null)check("subscription.items[].price.unit_amount_decimal","decimal",decimalUnit,()=>decimal(decimalUnit));
  if(unit!==null&&decimalUnit!==null){const d=check("subscription.items[].price.unit_amount_decimal","decimal",decimalUnit,()=>decimal(decimalUnit));if(d.numerator!==BigInt(unit)*d.denominator)check("subscription.items[].price.unit_amount","amount_agreement",unit,()=>fail());}
  const interval=check("subscription.items[].price.recurring.interval","text",recurring.interval,()=>text(recurring.interval));if(!["month","year","week","day"].includes(interval))check("subscription.items[].price.recurring.interval","interval_enum",interval,()=>fail());
  const quantity=check("subscription.items[].quantity","minor_units",it.quantity,()=>nullableAmount(it.quantity)),usage=check("subscription.items[].price.recurring.usage_type","text",recurring.usage_type,()=>text(recurring.usage_type)),scheme=check("subscription.items[].price.billing_scheme","text",p.billing_scheme,()=>text(p.billing_scheme)),tax=check("subscription.items[].price.tax_behavior","text",p.tax_behavior,()=>text(p.tax_behavior));
  let reason=parentDiscount.issue||localDiscount.issue;
  if(!complete)reason="incomplete_items";
  if(p.transform_quantity!=null||scheme!=="per_unit"||usage!=="licensed"||!["month","year"].includes(interval))reason="unsupported_pricing";
  if(tax!=="exclusive")reason="tax_basis_unresolved";
  if(unit===null&&decimalUnit===null||quantity===null)reason="missing_price_or_quantity";
  const result:FinanceItem={...provenance(it,c,"si",check("subscription.livemode","boolean",o.livemode,()=>bool(o.livemode)),check,"subscription.items[]"),stripe_subscription_id:base.stripe_object_id,stripe_price_id:check("subscription.items[].price.id","id",p.id,()=>id(p.id,"price")),stripe_product_id:check("subscription.items[].price.product","id",p.product,()=>id(p.product,"prod")),
   currency:check("subscription.items[].price.currency","currency",p.currency,()=>currency(p.currency)),quantity,unit_amount_minor:unit,unit_amount_decimal_minor:decimalUnit,recurring_interval:interval as FinanceItem["recurring_interval"],interval_count:check("subscription.items[].price.recurring.interval_count","positive_count",recurring.interval_count,()=>count(recurring.interval_count,true)),
   usage_type:usage,billing_scheme:scheme,tax_behavior:tax,period_start:check("subscription.items[].current_period_start","optional_timestamp",it.current_period_start,()=>time(it.current_period_start)),period_end:check("subscription.items[].current_period_end","optional_timestamp",it.current_period_end,()=>time(it.current_period_end)),
   effective_cycle_amount_minor:null,valuation_status:reason?"unsupported":"complete",valuation_reason:reason,discount_context:localDiscount.rows,removed_at:null};
  if(!result.period_start||!result.period_end){result.valuation_status="incomplete";result.valuation_reason="missing_period";}
  else if(Date.parse(result.period_end)<=Date.parse(result.period_start))check("subscription.items[].current_period_end","period_order",it.current_period_end,()=>fail());
  return result;
 });
 if(new Set(items.map(i=>i.stripe_object_id)).size!==items.length)check("subscription.items[].id","unique_ids",undefined,()=>fail());
 const mixed=new Set(items.map(i=>`${i.currency}:${i.recurring_interval}:${i.interval_count}`)).size>1;
 // Do not invent allocation for subscription-wide discounts over multiple items.
 const ambiguous=items.length>1&&parentDiscount.rows.length>0;
 for(const it of items){
  if(mixed||ambiguous){it.valuation_status="unsupported";it.valuation_reason=mixed?"mixed_intervals_or_currencies":"ambiguous_subscription_discount";}
  if(it.valuation_status!=="complete")continue;
  let value=decimal(it.unit_amount_decimal_minor??it.unit_amount_minor!);
  value=rational(value.numerator*BigInt(it.quantity!),value.denominator);
  const ds=[...it.discount_context,...parentDiscount.rows];
  if(ds.length>1){it.valuation_status="unsupported";it.valuation_reason="stacked_discounts";continue;}
  for(const d of ds){
   if(d.percent_off!==null){const pc=decimal(d.percent_off);value=rational(value.numerator*(BigInt(100)*pc.denominator-pc.numerator),value.denominator*BigInt(100)*pc.denominator);}
   else if(d.currency!==it.currency){it.valuation_status="unsupported";it.valuation_reason="discount_currency_mismatch";}
   else {value=add(value,rational(-BigInt(d.amount_off_minor!)));if(value.numerator<BigInt(0))value=rational(BigInt(0));}
  }
  if(it.valuation_status==="complete")it.effective_cycle_amount_minor=check("subscription.items[].effective_cycle_amount_minor","minor_units",undefined,()=>minor(roundMinor(value)));
 }
 const bad=items.find(i=>i.valuation_status!=="complete");
 const reason=!complete?"incomplete_items":!items.length?"missing_items":bad?.valuation_reason||null;
 return {subscription:{...base,user_id:verifiedUserId,stripe_customer_id:check("subscription.customer","id",o.customer,()=>id(o.customer,"cus")),status:check("subscription.status","text",o.status,()=>text(o.status)),cancel_at_period_end:check("subscription.cancel_at_period_end","boolean",o.cancel_at_period_end,()=>bool(o.cancel_at_period_end)),cancel_at:check("subscription.cancel_at","optional_timestamp",o.cancel_at,()=>time(o.cancel_at)),
  canceled_at:check("subscription.canceled_at","optional_timestamp",o.canceled_at,()=>time(o.canceled_at)),ended_at:check("subscription.ended_at","optional_timestamp",o.ended_at,()=>time(o.ended_at)),trial_end:check("subscription.trial_end","optional_timestamp",o.trial_end,()=>time(o.trial_end)),collection_paused:o.pause_collection!=null,
  linkage_status:verifiedUserId?"verified":"unresolved",valuation_status:reason?(!complete||!items.length?"incomplete":"unsupported"):"complete",valuation_reason:reason,
  items_complete:complete,discount_context:parentDiscount.rows},items};
 });
}
export function normalizeInvoice(input:unknown,c:FinanceContext):FinanceInvoice {
 const o=object(input),s=object(o.status_transitions),parent=o.parent==null?null:object(o.parent);
 let sub:string|null=null;
 if(parent?.type==="subscription_details")sub=id(object(parent.subscription_details).subscription,"sub");
 else if(o.subscription!=null)sub=id(o.subscription,"sub");
 return {...provenance(o,c,"in"),stripe_customer_id:id(o.customer,"cus"),stripe_subscription_id:sub,number:optionalText(o.number),status:text(o.status),billing_reason:optionalText(o.billing_reason),collection_method:text(o.collection_method),currency:currency(o.currency),
  subtotal_minor:minor(o.subtotal,true),discount_minor:minor(sumAmounts(o.total_discount_amounts)),tax_minor:sumAmounts(o.total_taxes),total_minor:minor(o.total,true),
  amount_due_minor:minor(o.amount_due),amount_paid_minor:minor(o.amount_paid),amount_remaining_minor:minor(o.amount_remaining),attempt_count:count(o.attempt_count),
  due_at:time(o.due_date),next_payment_attempt_at:time(o.next_payment_attempt),finalized_at:time(s.finalized_at),paid_at:time(s.paid_at),voided_at:time(s.voided_at),marked_uncollectible_at:time(s.marked_uncollectible_at),
  // Allocation pagination/verification belongs to Phase 2, never infer it from an invoice.
  payments_complete:false};
}
export function normalizeInvoicePayment(input:unknown,c:FinanceContext):InvoicePayment {
 const o=object(input),p=object(o.payment),s=object(o.status_transitions),kind=text(p.type);
 return {...provenance(o,c,"inpay"),stripe_invoice_id:id(o.invoice,"in"),stripe_payment_intent_id:kind==="payment_intent"?id(p.payment_intent,"pi"):null,
  stripe_charge_id:kind==="charge"?id(p.charge,"ch"):null,payment_type:kind,currency:currency(o.currency),status:text(o.status),
  amount_requested_minor:minor(o.amount_requested),amount_paid_minor:nullableAmount(o.amount_paid),paid_at:time(s.paid_at),canceled_at:time(s.canceled_at)};
}
export function normalizeCharge(input:unknown,c:FinanceContext):FinancePayment {
 const o=object(input),base=provenance(o,c,"ch"),status=text(o.status),paid=bool(o.paid),captured=bool(o.captured);
 const amount=minor(o.amount),capturedAmount=minor(o.amount_captured),refunded=minor(o.amount_refunded);
 if(BigInt(capturedAmount)>BigInt(amount)||BigInt(refunded)>BigInt(capturedAmount))fail();
 const evidence=status==="succeeded"&&paid&&captured&&BigInt(capturedAmount)>BigInt(0)&&matchingEvent(c,base.stripe_object_id,["charge.succeeded","charge.captured"])&&c.event?.subjectStatus==="succeeded"&&c.event.subjectCaptured===true&&c.event.capturedAmountMinor===capturedAmount;
 return {...base,stripe_customer_id:id(o.customer,"cus"),stripe_payment_intent_id:optionalId(o.payment_intent,"pi"),currency:currency(o.currency),status,
  amount_minor:amount,amount_captured_minor:capturedAmount,amount_refunded_minor:refunded,paid,captured,
  collected_at:evidence?iso(c.event!.created):null,collection_time_basis:evidence?"verified_event":"unknown",attribution_status:"unresolved"};
}
export function normalizeFailedCharge(input:unknown,c:FinanceContext):PaymentAttempt {
 const o=object(input),p=normalizeCharge(o,c);if(!matchingEvent(c,p.stripe_object_id,["charge.failed"])||c.event?.subjectStatus!=="failed")throw Error("FINANCE_MISSING_FAILURE_TIME");if(p.status!=="failed"||p.paid||BigInt(p.amount_captured_minor)!==BigInt(0))fail();
 return {stripe_scope:p.stripe_scope,attempt_key:`charge:${p.stripe_object_id}`,stripe_customer_id:p.stripe_customer_id,stripe_invoice_id:optionalId(o.invoice,"in"),stripe_payment_intent_id:p.stripe_payment_intent_id,
  stripe_charge_id:p.stripe_object_id,currency:p.currency,amount_minor:p.amount_minor,
  occurred_at:matchingEvent(c,p.stripe_object_id,["charge.failed"])?iso(c.event!.created):p.stripe_created_at,
  failure_code:failureCode(o.failure_code),evidence_type:"failed_charge",source_event_id:p.source_event_id,stripe_api_version:p.stripe_api_version,normalizer_version:1,verified_at:p.verified_at};
}
export function normalizeRefund(input:unknown,c:FinanceContext):FinanceRefund {
 const o=object(input),base=provenance(o,c,"re"),status=text(o.status);
 const evidence=status==="succeeded"&&matchingEvent(c,base.stripe_object_id,["refund.created","refund.updated","charge.refund.updated"])&&c.event?.subjectStatus==="succeeded"
  &&(c.event.type==="refund.created"||(c.event.previousStatus!==undefined&&c.event.previousStatus!=="succeeded"));
 return {...base,stripe_charge_id:id(o.charge,"ch"),stripe_payment_intent_id:optionalId(o.payment_intent,"pi"),currency:currency(o.currency),amount_minor:minor(o.amount),status,
  reason:["duplicate","fraudulent","requested_by_customer"].includes(String(o.reason))?String(o.reason):null,
  failure_reason:["lost_or_stolen_card","expired_or_canceled_card","charge_for_pending_refund_disputed","insufficient_funds","declined","merchant_request","unknown"].includes(String(o.failure_reason))?String(o.failure_reason):null,
  succeeded_at:evidence?iso(c.event!.created):null,success_time_basis:evidence?"verified_event":"unknown"};
}
