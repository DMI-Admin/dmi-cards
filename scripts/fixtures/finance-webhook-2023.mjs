// Sanitized, hand-built 2023-10-16 evidence shapes; NOT captured Sandbox payloads.
// Old invoice.subscription/charge/payment_intent and subscription period fields
// deliberately differ from the current-object relationships used by the adapter.
import {event,graphFixture,sec} from './finance-v1.mjs';
export function legacyEvents(){
 const f=graphFixture();const sub={id:'sub_one',created:sec('2026-09-01'),status:'active',cancel_at_period_end:false,current_period_start:sec('2026-09-01'),current_period_end:sec('2026-10-01'),items:{data:[]}};
 const invoice={id:'in_one',status:'paid',subscription:'sub_old',charge:'ch_old',payment_intent:'pi_old',amount_paid:123456};
 const charge={...f.charge,invoice:'in_old',billing_details:{name:'DO_NOT_PERSIST'}};
 const refund={...f.refund,status:'succeeded'};
 return [
  event('legacyCreated','customer.subscription.created',sub),
  event('legacyCancel','customer.subscription.updated',{...sub,cancel_at_period_end:true},{cancel_at_period_end:false}),
  event('legacyResume','customer.subscription.updated',sub,{cancel_at_period_end:true}),
  event('legacyEnded','customer.subscription.deleted',{...sub,status:'canceled'}),
  ...['finalized','updated','paid','payment_failed','voided','marked_uncollectible'].map((name,i)=>event('legacyInvoice'+i,'invoice.'+name,invoice)),
  event('legacyCharge','charge.succeeded',charge),event('legacyCapture','charge.captured',charge),
  event('legacyFailure','charge.failed',{...charge,status:'failed',paid:false,captured:false,amount_captured:0,failure_code:'card_declined'}),
  event('legacyChargeRefunded','charge.refunded',{...charge,refunds:{data:[],has_more:true}}),
  event('legacyChargeRefundUpdated','charge.refund.updated',refund,{status:'pending'}),
  event('legacyRefundCreated','refund.created',refund),
  event('legacyRefundUpdated','refund.updated',refund,{status:'pending'}),
  event('legacyRefundFailed','refund.failed',{...refund,status:'failed'}),
 ];
}

// Synthetic reproduction of the reported staging flexible/unspecified-tax shape.
// All IDs/timestamps are synthetic. Unreported required fields (created, has_more,
// cancel_at_period_end, billing_scheme and IDs) inherit valid fixture assumptions;
// this is NOT the full retrieved staging object or proof of its omitted fields.
export function flexibleStagingShape(){
 const f=graphFixture(),s=f.subscription,it=s.items.data[0];
 Object.assign(s,{currency:'gbp',billing_mode:{type:'flexible',flexible:{proration_discounts:'included'}},discount:null,default_tax_rates:[],current_period_start:it.current_period_start,current_period_end:it.current_period_end,latest_invoice:'in_synthetic'});
 s.metadata.finance_smoke_checkpoint='checkpoint5';it.tax_rates=[];
 Object.assign(it.price,{type:'recurring',tax_behavior:'unspecified'});
 Object.assign(it.price.recurring,{aggregate_usage:null,meter:null,trial_period_days:null});
 return f;
}
