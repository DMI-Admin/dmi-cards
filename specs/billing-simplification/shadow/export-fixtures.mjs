// Synthetic identifiers only. Never captures a hosted source.
import {createHash} from 'node:crypto';
export const checksum=text=>createHash('sha256').update(text).digest('hex');
export function exportFixture(){
 const scope='acct_1OoTzlG71GpCYtA4:test',stamp='2026-10-28T09:00:00.000000+00:00',user='11111111-1111-4111-8111-111111111111';
 return [{frozen_access_source:{scope,source_snapshot:'100:100:',captured_at:stamp,
 checks:{unverified_accounts:0,unverified_or_missing_snapshot:0,inconsistent_subscription_bindings:0,missing_active_price_ownership:0,missing_or_ambiguous_product_interval:0},
 billing_accounts:[{stripe_scope:scope,user_id:user,stripe_customer_id:'cus_fixture',verified_at:stamp,generation:'1',updated_at:stamp}],
 billing_approved_prices:[{stripe_scope:scope,stripe_price_id:'price_fixture',entitlement_enabled:true,checkout_enabled:true,approved_at:stamp}],
 billing_subscriptions:[{stripe_scope:scope,user_id:user,stripe_customer_id:'cus_fixture',stripe_subscription_id:'sub_fixture',stripe_subscription_status:'active',stripe_price_id:'price_fixture',dmi_plan:'pro',current_period_start:null,current_period_end:null,trial_end:null,ended_at:null,cancel_at_period_end:false,latest_invoice_id:null,terminal:false,revision:'7',last_event_created:'100',last_event_id:'evt_fixture',verified_at:stamp,created_at:stamp,updated_at:stamp,sync_snapshot:{subscription_id:'sub_fixture',customer_id:'cus_fixture',status:'active',price_id:'price_fixture',plan:'pro',period_start:null,period_end:null,trial_end:null,ended_at:null,cancel_at_period_end:false,invoice_id:null,terminal:false}}],
 billing_stripe_resource_ownership:[{stripe_scope:scope,resource_type:'price',stripe_resource_id:'price_fixture',application_key:'dmi_cards',ownership_basis:'price_owner',revision:'3',state:'active',updated_at:stamp}],
 billing_stripe_applications:[{application_key:'dmi_cards',state:'active'}],
 price_items:[{stripe_price_id:'price_fixture',stripe_product_id:'prod_fixture',recurring_interval:'month',interval_count:1,verified_at:stamp}],
 }}];
}
