// Hand-built fixtures matching fields from stripe 22.5.0 / 2026-07-29.dahlia.
// Webhook envelopes use the reviewed 2023-10-16 stable evidence subset.
// Not claimed to be captured staging events. No credentials/customer PII.
export const webhookVersion='2023-10-16';
export const apiVersion='2026-07-29.dahlia';
export const user='11111111-1111-4111-8111-111111111111';
export const sec=s=>Date.parse(s)/1000;
export const fixtureNow='2026-09-20T00:00:00.000Z';
export function graphFixture(){
 const subscription={id:'sub_one',created:sec('2026-09-01'),livemode:false,customer:'cus_one',metadata:{dmi_app:'dmi_cards_v2',dmi_user_id:user},status:'active',cancel_at_period_end:false,cancel_at:null,canceled_at:null,ended_at:null,trial_end:null,pause_collection:null,discounts:[],items:{has_more:false,data:[{id:'si_one',created:sec('2026-09-01'),quantity:1,current_period_start:sec('2026-09-01'),current_period_end:sec('2026-10-01'),discounts:[],price:{id:'price_month',product:'prod_pro',unit_amount:599,unit_amount_decimal:'599',currency:'gbp',billing_scheme:'per_unit',tax_behavior:'exclusive',recurring:{interval:'month',interval_count:1,usage_type:'licensed'}}}]}};
 const invoice={id:'in_one',created:sec('2026-09-01'),livemode:false,customer:'cus_one',parent:{type:'subscription_details',subscription_details:{subscription:'sub_one'}},number:'TEST-1',status:'open',billing_reason:'subscription_cycle',collection_method:'charge_automatically',currency:'gbp',subtotal:599,total_discount_amounts:[],total_taxes:[],total:599,amount_due:599,amount_paid:0,amount_remaining:599,attempt_count:1,status_transitions:{finalized_at:sec('2026-09-01'),paid_at:null}};
 const charge={id:'ch_one',created:sec('2026-09-01'),livemode:false,customer:'cus_one',payment_intent:'pi_one',currency:'gbp',status:'succeeded',paid:true,captured:true,amount:599,amount_captured:599,amount_refunded:0};
 const allocation={id:'inpay_one',created:sec('2026-09-01'),livemode:false,invoice:'in_one',payment:{type:'payment_intent',payment_intent:'pi_one'},currency:'gbp',status:'paid',amount_requested:599,amount_paid:599,status_transitions:{paid_at:sec('2026-09-03'),canceled_at:null}};
 const refund={id:'re_one',created:sec('2026-09-04'),livemode:false,charge:'ch_one',payment_intent:'pi_one',currency:'gbp',amount:100,status:'pending',reason:'requested_by_customer'};
 return {subscription,invoice,charge,allocation,refund,graph:{subscriptions:[subscription],customers:[{id:'cus_one',livemode:false,metadata:{dmi_app:'dmi_cards_v2',dmi_user_id:user}}],invoices:[],charges:[],allocations:[],refunds:[],complete:true}};
}
export function event(id,type,object,previous_attributes={}){return {id:'evt_'+id,type,created:sec('2026-09-10'),livemode:false,api_version:webhookVersion,data:{object:structuredClone(object),previous_attributes}};}
