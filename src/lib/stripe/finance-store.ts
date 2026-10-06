import "server-only";
import {createSupabaseAdminClient} from "@/lib/supabase-admin";
import {resources,type FinanceStore,type StoredRow,type Resource,type Runtime,type FinanceSource,FINANCE_API_VERSION} from "./finance-contract";

// Cast exact SQL numbers before JSON decoding; never round bigint/decimal via JS Number.
const columns:Record<Resource,string>={
 subscriptions:"stripe_scope,stripe_object_id,stripe_created_at,source_event_id,source_event_created_at,stripe_api_version,normalizer_version,revision::text,verified_at,created_at,updated_at,user_id,stripe_customer_id,status,cancel_at_period_end,cancel_at,canceled_at,ended_at,trial_end,collection_paused,linkage_status,valuation_status,valuation_reason,items_complete,discount_context",
 items:"stripe_scope,stripe_object_id,stripe_created_at,source_event_id,source_event_created_at,stripe_api_version,normalizer_version,revision::text,verified_at,created_at,updated_at,stripe_subscription_id,stripe_price_id,stripe_product_id,currency,quantity::text,unit_amount_minor::text,unit_amount_decimal_minor::text,recurring_interval,interval_count,usage_type,billing_scheme,tax_behavior,period_start,period_end,effective_cycle_amount_minor::text,valuation_status,valuation_reason,discount_context,removed_at,forecast_tax_evidence",
 invoices:"stripe_scope,stripe_object_id,stripe_created_at,source_event_id,source_event_created_at,stripe_api_version,normalizer_version,revision::text,verified_at,created_at,updated_at,stripe_customer_id,stripe_subscription_id,number,status,billing_reason,collection_method,currency,subtotal_minor::text,discount_minor::text,tax_minor::text,total_minor::text,amount_due_minor::text,amount_paid_minor::text,amount_remaining_minor::text,attempt_count,due_at,next_payment_attempt_at,finalized_at,paid_at,voided_at,marked_uncollectible_at,payments_complete,tax_evidence",
 payments:"stripe_scope,stripe_object_id,stripe_created_at,source_event_id,source_event_created_at,stripe_api_version,normalizer_version,revision::text,verified_at,created_at,updated_at,stripe_customer_id,stripe_payment_intent_id,currency,status,amount_minor::text,amount_captured_minor::text,amount_refunded_minor::text,paid,captured,collected_at,collection_time_basis,attribution_status",
 allocations:"stripe_scope,stripe_object_id,stripe_created_at,source_event_id,source_event_created_at,stripe_api_version,normalizer_version,revision::text,verified_at,created_at,updated_at,stripe_invoice_id,stripe_payment_intent_id,stripe_charge_id,payment_type,currency,status,amount_requested_minor::text,amount_paid_minor::text,paid_at,canceled_at",
 attempts:"stripe_scope,attempt_key,stripe_customer_id,stripe_invoice_id,stripe_payment_intent_id,stripe_charge_id,currency,amount_minor::text,occurred_at,failure_code,evidence_type,source_event_id,stripe_api_version,normalizer_version,verified_at,created_at,updated_at",
 refunds:"stripe_scope,stripe_object_id,stripe_created_at,source_event_id,source_event_created_at,stripe_api_version,normalizer_version,revision::text,verified_at,created_at,updated_at,stripe_charge_id,stripe_payment_intent_id,currency,amount_minor::text,status,reason,failure_reason,succeeded_at,success_time_basis",
 activity:"stripe_scope,activity_key,kind,stripe_customer_id,stripe_subscription_id,object_type,object_id,occurred_at,amount_minor::text,currency,effective_at,source_event_id,origin,source_revision::text,created_at",
};

export function createFinanceStore(db:ReturnType<typeof createSupabaseAdminClient>):FinanceStore {
  return {
    async command<T>(action:string,scope:string,token:string|null,input:object={}) {
      const {data,error}=await db.rpc("billing_finance_command",{p_action:action,p_scope:scope,p_token:token,p_input:input});
      if(error)throw Error(/^FINANCE_[A-Z_]+$/.test(error.message||"")?error.message:"FINANCE_STORE_UNAVAILABLE");
      return data as T;
    },
    async read(resource:Resource,scope:string,id:string) {
      const key=resource==="activity"?"activity_key":resource==="attempts"?"attempt_key":"stripe_object_id";
      const {data,error}=await db.from(resources[resource]).select(columns[resource]).eq("stripe_scope",scope).eq(key,id).returns<StoredRow[]>().maybeSingle();
      if(error)throw Error("FINANCE_STORE_UNAVAILABLE");return data;
    },
    async items(scope,subscription) {
      const {data,error}=await db.from(resources.items).select(columns.items).eq("stripe_scope",scope).eq("stripe_subscription_id",subscription).limit(201).returns<StoredRow[]>();
      if(error||!data||data.length>200)throw Error("FINANCE_ITEMS_BOUND");return data;
    },
    async binding(scope,customer) {
      const {data,error}=await db.from("billing_accounts").select("user_id,verified_at").eq("stripe_scope",scope).eq("stripe_customer_id",customer).maybeSingle();
      if(error)throw Error("FINANCE_BINDING_UNAVAILABLE");return data;
    },
    async run(scope,id) {
      const {data,error}=await db.from("billing_finance_sync_runs").select("*").eq("stripe_scope",scope).eq("id",id).maybeSingle();
      if(error)throw Error("FINANCE_RUN_UNAVAILABLE");return data;
    },
  };
}
/** Called only by trusted server orchestration, not exposed by any HTTP endpoint. */
export async function createFinanceRuntime(source:FinanceSource,store:FinanceStore,now=()=>new Date().toISOString()):Promise<Runtime> {
  const identity=await source.identity();
  if(!/^acct_[A-Za-z0-9]+:(test|live)$/.test(identity.scope)||identity.apiVersion!==FINANCE_API_VERSION)throw Error("FINANCE_RUNTIME_VERSION_OR_SCOPE");
  return {source,store,...identity,now};
}
