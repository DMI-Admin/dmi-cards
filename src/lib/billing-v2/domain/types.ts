/** Isolated candidate facts. These types never grant access to the application. */
export type Scope = `acct_${string}:${"test"|"live"}`;
export type Json = null | boolean | string | number | Json[] | {[key:string]:Json};
export type RecordValue = {[key:string]:Json};
export type Plan = "free"|"pro";
export type Runtime = "staging"|"production"|"unknown";
export type TaskKind = "access"|"finance";
export type State = "queued"|"processing"|"retry_wait"|"dependency_wait"|"completed"|"needs_attention";
export type Category = "provider_unavailable"|"provider_rate_limited"|"provider_transport"|"store_unavailable"|"ambiguous_provider_result"|"ownership_unresolved"|"ownership_conflict"|"unknown_price"|"invalid_evidence"|"retry_exhausted"|"dependency_unresolved"|"handover_blocked";
export interface Evidence {eventType?:string;subject?:string;scope:Scope; sourceKind:"webhook"|"reconciliation"|"recovery"; sourceId:string; eventCreated:string|null; livemode:boolean; eventAccount?:string; runtime:Runtime; namespaceVerified:boolean}
export interface Binding {scope:Scope; accountId:string; principalId:string|null; customer:string; verified:boolean; revision:string}
export interface Price {scope:Scope; id:string; revision:string; entitlementEnabled:boolean; checkoutEnabled:boolean; active:boolean; application:string; interval:"monthly"|"annual"}
export interface Snapshot {id:string; customer:string; scope:Scope; livemode:boolean; owner:string; status:string; price:string|null; cancelAtPeriodEnd:boolean; periodStart:string|null; periodEnd:string|null; trialEnd:string|null; endedAt:string|null; latestInvoice:string|null; verifiedAt:string; itemsComplete:boolean; approvedItemCount:number}
export interface Canonical {stripe_scope:Scope;stripe_subscription_id:string;billing_account_id:string;stripe_customer_id:string;stripe_price_id:string|null;status:string;plan:Plan;cancel_at_period_end:boolean;period_start:string|null;period_end:string|null;trial_end:string|null;ended_at:string|null;latest_invoice_id:string|null;terminal:boolean;revision:string;verified_at:string;last_event_created:string|null;last_event_id:string|null;snapshot_digest:string}
export interface SubscriptionInput {task:Evidence; binding:Binding; provider:Snapshot; price:Price|null; before:Canonical|null}
export type SubscriptionDecision = {kind:"commit"|"no_change";canonical:Canonical|null;entitlement:Plan;order:"accepted"|"unchanged"|"stale_ignored"|"terminal_ignored";expectedRevision:string;bindingRevision:string;priceRevision:string|null}|{kind:"reject"|"attention"|"defer";reason:Category;businessWrites:0};
export interface Fence {scope:Scope;task_id:string;account_id:string|null;token:string;claim_generation:string;authority_generation:string|null;engine:"shadow"}
export interface FinanceRow {table:FinanceTable;expectedRevision:string;columns:RecordValue}
export type FinanceTable = "finance_subscriptions"|"finance_subscription_items"|"invoices"|"payments"|"invoice_payments"|"refunds"|"payment_attempts"|"finance_activity";
export interface Proof {invoice:string;customer:string;subscription:string|null;invoiceRevision:string;certificateRevision:string;prices:{id:string;revision:string}[];complete:boolean;application:string;allocations:{id:string;charge:string|null;intent:string|null}[]}
export interface FinanceInput {task:Evidence;binding:Binding;complete:boolean;rows:FinanceRow[];proofs:Proof[];catalog:Price[]}
export type FinanceDecision = {kind:"commit";rows:FinanceRow[];proofs:Proof[]}|{kind:"attention"|"defer"|"reject";reason:Category;businessWrites:0};
export interface CommitResult {kind:string;revision?:string;digest?:string;state?:State;result?:string;category?:string;context?:{binding:Binding|null;canonical:Canonical|null;catalog:Price[]}}
export interface Persistence {completeSubscription(fence:Fence,decision:Extract<SubscriptionDecision,{kind:"commit"|"no_change"}>):Promise<CommitResult>;completeFinance(fence:Fence,decision:Extract<FinanceDecision,{kind:"commit"}>):Promise<CommitResult>;defer(fence:Fence,category:Category,dependency?:{kind:string;reference:string}):Promise<CommitResult>}

/** Fixed, privacy-safe store classification; never carries SQL/payload text. */
export class V2StoreFailure extends Error {constructor(public readonly category:Category,public readonly ambiguous=false,public readonly fenced=false){super(ambiguous?"V2_AMBIGUOUS_RESULT":fenced?"V2_FENCED":"V2_STORE_FAILURE");}}
