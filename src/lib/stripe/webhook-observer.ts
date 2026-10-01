import "server-only";
// TEMPORARY staging diagnostics: remove after the webhook failure is diagnosed.
export const stages = ["runtime", "consumer", "envelope", "event_claim", "claim", "bind", "commit", "event_finish", "event_fail", "release", "subscription_sync", "stripe_retrieval", "identity_binding", "normalization", "mirror_read", "item_read", "run_start", "run_read", "other_rpc"] as const;
export type Stage = typeof stages[number];
export type AssertionObserver = (details:{fieldPath:string;check:string;present:boolean;primitiveType:string;errorCode:string})=>void;
const assertionPaths=new Set(["context", "context.verified_user", "subscription", "subscription.cancel_at", "subscription.cancel_at_period_end", "subscription.canceled_at", "subscription.created", "subscription.customer", "subscription.discounts", "subscription.discounts[]", "subscription.discounts[].coupon", "subscription.discounts[].coupon.amount_off", "subscription.discounts[].coupon.currency", "subscription.discounts[].coupon.id", "subscription.discounts[].coupon.percent_off", "subscription.discounts[].end", "subscription.discounts[].id", "subscription.discounts[].source", "subscription.discounts[].start", "subscription.ended_at", "subscription.id", "subscription.items", "subscription.items.data", "subscription.items.has_more", "subscription.items[]", "subscription.items[].created", "subscription.items[].current_period_end", "subscription.items[].current_period_start", "subscription.items[].discounts", "subscription.items[].discounts[]", "subscription.items[].discounts[].coupon", "subscription.items[].discounts[].coupon.amount_off", "subscription.items[].discounts[].coupon.currency", "subscription.items[].discounts[].coupon.id", "subscription.items[].discounts[].coupon.percent_off", "subscription.items[].discounts[].end", "subscription.items[].discounts[].id", "subscription.items[].discounts[].source", "subscription.items[].discounts[].start", "subscription.items[].effective_cycle_amount_minor", "subscription.items[].id", "subscription.items[].price", "subscription.items[].price.billing_scheme", "subscription.items[].price.currency", "subscription.items[].price.id", "subscription.items[].price.product", "subscription.items[].price.recurring", "subscription.items[].price.recurring.interval", "subscription.items[].price.recurring.interval_count", "subscription.items[].price.recurring.usage_type", "subscription.items[].price.tax_behavior", "subscription.items[].price.unit_amount", "subscription.items[].price.unit_amount_decimal", "subscription.items[].quantity", "subscription.livemode", "subscription.metadata", "subscription.status", "subscription.trial_end"]);
const assertionChecks=new Set(["normalization_boundary", "valid_context", "boolean", "id", "unix_timestamp", "object", "array", "decimal", "minor_units", "text", "currency", "optional_timestamp", "percent_range", "positive_count", "uuid", "amount_agreement", "interval_enum", "period_order", "unique_ids"]);
export type Observer = {
 assertion?:AssertionObserver;
 run<T>(stage: Stage, work: () => Promise<T>): Promise<T>;
 sync<T>(stage: Stage, work: () => T): T;
};
const codes = new Set(["AMBIGUOUS_ITEMS", "BILLING_CONSUMER_RETRY_REQUIRED", "BILLING_IDENTITY", "BILLING_RECOVERY_REQUIRED", "BILLING_STORE_UNAVAILABLE", "CUSTOMER_UNAVAILABLE", "FINANCE_AMBIGUOUS_PAYMENT", "FINANCE_ATTRIBUTION", "FINANCE_ATTRIBUTION_CONFLICT", "FINANCE_BATCH", "FINANCE_BATCH_BOUND", "FINANCE_BINDING_UNAVAILABLE", "FINANCE_BROWSER_RPC", "FINANCE_BUSY", "FINANCE_COMMAND", "FINANCE_CURRENCY_CONFLICT", "FINANCE_CURSOR", "FINANCE_CUSTOMER_MISSING", "FINANCE_DISCOUNT", "FINANCE_EVENT", "FINANCE_EVENT_CONFLICT", "FINANCE_EVENT_EVIDENCE", "FINANCE_EVENT_FENCE", "FINANCE_EVENT_SCOPE", "FINANCE_EVENT_SHAPE", "FINANCE_FAILURE_EVIDENCE", "FINANCE_FAILURE_IDENTITY", "FINANCE_FENCE", "FINANCE_FOREIGN_APPLICATION", "FINANCE_GRAPH_BOUND", "FINANCE_GRAPH_INCOMPLETE", "FINANCE_IDENTITY", "FINANCE_IMMUTABLE_CONFLICT", "FINANCE_INPUT", "FINANCE_INVALID_DECIMAL", "FINANCE_INVALID_DENOMINATOR", "FINANCE_INVALID_MONTH", "FINANCE_INVALID_TIME", "FINANCE_INVOICE_MISSING", "FINANCE_ITEMS_BOUND", "FINANCE_MALFORMED_STRIPE_DATA", "FINANCE_MISSING_FAILURE_TIME", "FINANCE_MONEY_CONFLICT", "FINANCE_MONEY_REGRESSION", "FINANCE_NEGATIVE_VALUE", "FINANCE_OBJECT_ID", "FINANCE_OBJECT_REVISION", "FINANCE_PAGINATION_BOUND", "FINANCE_PAYMENT_MISSING", "FINANCE_REFUND_CHARGE", "FINANCE_RETRYABLE_FAILURE", "FINANCE_REVISION", "FINANCE_ROW", "FINANCE_ROW_SCOPE", "FINANCE_RUNTIME_CHANGED", "FINANCE_RUNTIME_VERSION_OR_SCOPE", "FINANCE_RUN_CONFLICT", "FINANCE_RUN_INPUT", "FINANCE_RUN_MISSING", "FINANCE_RUN_UNAVAILABLE", "FINANCE_SCOPE_MISMATCH", "FINANCE_SHAPE", "FINANCE_STAGING_CREDENTIAL", "FINANCE_STAGING_MODE", "FINANCE_STAGING_TARGET", "FINANCE_STALE_SNAPSHOT", "FINANCE_STORE_UNAVAILABLE", "FINANCE_SUBSCRIPTION_MISSING", "FINANCE_TERMINAL", "FINANCE_UNVERIFIED_BINDING", "FINANCE_WEBHOOK_COMPATIBILITY", "FINANCE_WINDOW", "IDENTITY_CONFLICT", "MALFORMED_CHECKOUT", "MIRROR_UNAVAILABLE", "MISSING_OBJECT", "PRICE_REGISTRY_UNAVAILABLE", "RETRYABLE_FAILURE", "SCOPE_CONFLICT", "SCOPE_UNAVAILABLE", "STRIPE_UNAVAILABLE", "UNCLASSIFIED"]);
export function createWebhookObserver(context: {requestId: string; stripeEventId: string; stripeEventType: string; consumer: "entitlement" | "finance"}, sink: (fields: Record<string, unknown>) => void): Observer {
 const safe = {
  requestId: /^[A-Za-z0-9_:.\/-]{1,200}$/.test(context.requestId) ? context.requestId : "invalid",
  stripeEventId: /^evt_[A-Za-z0-9]+$/.test(context.stripeEventId) ? context.stripeEventId : "invalid",
  stripeEventType: /^[a-z][a-z_.]{1,100}$/.test(context.stripeEventType) ? context.stripeEventType : "invalid",
  consumer: context.consumer,
 };
 // Synchronous, invocation-local frames; no mutable global/event state.
 const frames:{details?:Record<string,unknown>}[]=[];
 function emit(stage: Stage, outcome: "started" | "succeeded" | "failed", error?: unknown, assertion?:Record<string,unknown>) {
  try {
   let errorCode = "UNCLASSIFIED";
   if (error instanceof Error) {
    const reason = (error as Error & {reason?: unknown}).reason;
    if (typeof reason === "string" && codes.has(reason)) errorCode = reason;
    else if (codes.has(error.message)) errorCode = error.message;
   }
   sink({...safe, stage: stages.includes(stage) ? stage : "other_rpc", outcome, ...(outcome === "failed" ? {errorCode,...assertion} : {})});
  } catch { /* Logging must never affect either consumer. */ }
 }
 return {
  assertion(details){
   try {
    if(!assertionPaths.has(details.fieldPath)||!assertionChecks.has(details.check))return;
    const primitiveType=["undefined","null","array","object","string","number","boolean","bigint","symbol","function"].includes(details.primitiveType)?details.primitiveType:"unknown";
    const fields={check:details.check,fieldPath:details.fieldPath,present:details.present===true,primitiveType};
    const frame=frames.at(-1);
    if(frame){frame.details??=fields;return;}
    sink({requestId:safe.requestId,consumer:safe.consumer,stage:"normalization",outcome:"failed",errorCode:codes.has(details.errorCode)?details.errorCode:"UNCLASSIFIED",...fields});
   }catch{/* diagnostics never affect normalization */}
  },
  async run(stage, work) { emit(stage,"started"); try { const value=await work(); emit(stage,"succeeded"); return value; } catch(error) { emit(stage,"failed",error); throw error; } },
  sync(stage, work) {
   const frame:{details?:Record<string,unknown>}={};
   if(stage==="normalization")frames.push(frame);
   emit(stage,"started");
   try { const value=work(); emit(stage,"succeeded"); return value; }
   catch(error) { emit(stage,"failed",error,frame.details); throw error; }
   finally {if(stage==="normalization")frames.pop();}
  },
 };
}
