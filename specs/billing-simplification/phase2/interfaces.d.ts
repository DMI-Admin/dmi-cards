/** Design declarations only. No implementation, runtime imports or authority. */
export type DecimalInteger = `${bigint}`;
export type Scope = `acct_${string}:${"test" | "live"}`;
export type Instant = string;
export type Ref = string;
export type Plan = "free" | "pro";
export type State = "queued" | "processing" | "retry_wait" | "dependency_wait" | "completed" | "needs_attention";
export type OrderDecision = "accepted" | "unchanged" | "stale_ignored" | "terminal_ignored";
export type ErrorCategory = "provider_unavailable" | "provider_rate_limited" | "provider_transport" | "store_unavailable" | "ambiguous_provider_result" | "ownership_unresolved" | "ownership_conflict" | "unknown_price" | "invalid_evidence" | "retry_exhausted" | "dependency_unresolved" | "handover_blocked";
declare const verified: unique symbol;
/** Only the future verified-envelope/owned-provider adapter may construct brands. */
export type Verified<T> = Readonly<T> & {readonly [verified]: true};
export interface Evidence {scope: Scope; sourceKind: "webhook" | "reconciliation" | "recovery"; sourceId: Ref; taskKind: "access" | "finance"; eventCreated: DecimalInteger | null; evidenceDigest: string; schemaVersion: 1}
export interface Binding {accountId: Ref; principalKind: "individual" | "business"; principalId: Ref; customer: Ref; revision: DecimalInteger; verifiedAt: Instant}
export interface Price {scope: Scope; id: Ref; plan: "pro"; interval: "monthly" | "annual"; revision: DecimalInteger; entitlementEnabled: boolean; checkoutEnabled: boolean; application: string; applicationActive: boolean; ownershipState: "active" | "revoked"}
export interface SubscriptionSnapshot {scope: Scope; id: Ref; customer: Ref; status: string; price: Ref | null; cancelAtPeriodEnd: boolean; periodStart: Instant | null; periodEnd: Instant | null; trialEnd: Instant | null; endedAt: Instant | null; latestInvoice: Ref | null; terminal: boolean; verifiedAt: Instant}
export interface Canonical extends SubscriptionSnapshot {accountId: Ref; plan: Plan; revision: DecimalInteger; lastEventCreated: DecimalInteger | null; digest: string}
export interface SubscriptionInput {task: Verified<Evidence>; currentProvider: Verified<SubscriptionSnapshot>; binding: Verified<Binding>; price: Verified<Price> | null; before: Canonical | null}
export interface SubscriptionAudit {order: OrderDecision; beforeDigest: string | null; afterDigest: string; expectedRevision: DecimalInteger; expectedBindingRevision: DecimalInteger; expectedPriceRevision: DecimalInteger | null}
export type SubscriptionDecision =
 | {kind: "commit"; canonical: Omit<Canonical, "revision">; entitlement: Plan; audit: SubscriptionAudit}
 | {kind: "no_change"; entitlement: Plan; order: Exclude<OrderDecision, "accepted">; before: Canonical | null; audit: SubscriptionAudit}
 | {kind: "defer" | "attention"; reason: ErrorCategory; businessWrites: 0};
/** Pure deterministic policy: no DB, provider, timers, environment or feature grants. */
export interface SubscriptionPolicy {decide(input: SubscriptionInput): SubscriptionDecision}
export interface Fence {scope: Scope; accountId: Ref; taskId: Ref; token: Ref; claimGeneration: DecimalInteger; authorityGeneration: DecimalInteger; engine: "shadow"}
export type CommitResult = {kind: "committed" | "unchanged" | "stale_ignored" | "terminal_ignored" | "already_completed"; revision: DecimalInteger | null; digest: string} | {kind: "fenced" | "revision_conflict" | "catalog_changed"};
export interface SubscriptionPersistence {commit(fence: Fence, decision: SubscriptionDecision): Promise<CommitResult>; readResult(scope: Scope, task: Ref): Promise<{state: State; result: string | null; digest: string | null}>}
export type FinanceTable = "finance_subscriptions" | "finance_subscription_items" | "invoices" | "payments" | "invoice_payments" | "refunds" | "payment_attempts" | "finance_activity";
export type Json = null | boolean | string | number | readonly Json[] | {readonly [key: string]: Json};
/** Exact per-table columns/types are schema.json; adapter validates closed row shape.
 * Money/bigint are decimal strings, never JSON numbers. No arbitrary table name. */
export interface FinanceRow {table: FinanceTable; scope: Scope; naturalKey: Ref; expectedRevision: DecimalInteger; columns: Readonly<Record<string, Json>>}
export interface InvoiceProof {scope: Scope; invoice: Ref; customer: Ref; subscription: Ref | null; invoiceRevision: DecimalInteger; certificateRevision: DecimalInteger; application: "dmi_cards"; complete: true; allocations: readonly {allocation: Ref; charge: Ref | null; intent: Ref | null}[]; prices: readonly {id: Ref; ownershipRevision: DecimalInteger}[]}
export interface FinanceInput {task: Verified<Evidence>; binding: Verified<Binding>; providerGraph: Verified<Readonly<{scope: Scope; complete: boolean; rows: readonly FinanceRow[]}>>; currentRows: readonly FinanceRow[]; proofs: readonly Verified<InvoiceProof>[]; catalog: readonly Verified<Price>[]}
export type FinanceDecision = {kind: "commit"; rows: readonly FinanceRow[]; proofs: readonly InvoiceProof[]; audit: Readonly<{order: OrderDecision; affectedDigests: readonly string[]}>} | {kind: "defer" | "attention"; reason: ErrorCategory; businessWrites: 0};
export interface FinancePolicy {decide(input: FinanceInput): FinanceDecision}
export interface FinancePersistence {commit(fence: Fence, decision: FinanceDecision): Promise<CommitResult>}
/** Intentionally has no create/update/delete/refund/replay method or raw SDK escape. */
export interface ProviderReadPort {subscription(id: Ref): Promise<Verified<SubscriptionSnapshot>>; inventory(scope: Scope, cursor: string | null): Promise<{objects: readonly Verified<SubscriptionSnapshot>[]; next: string | null}>; financeGraph(scope: Scope, subject: Ref): Promise<FinanceInput["providerGraph"]>}
export interface NormalizedComparison {status: string | null; plan: Plan; entitlement: Plan; owner_verified: boolean; order_decision: OrderDecision; finance: readonly Readonly<{kind: string; correspondenceKey: string; money: Readonly<Record<string, DecimalInteger>>; digest: string}>[]; terminal: boolean; providerMutations: 0; unexpectedBusinessEffects: 0}
export type ComparisonOutcome = "equivalent" | "expected_representation_difference" | "policy_mismatch" | "missing_projection" | "ownership_mismatch" | "unexpected_business_effect";
export interface ComparisonRecord {version: 1; run: Ref; correspondenceDigest: string; baselineRevision: string; candidateRevision: string; baselineCheckpoint: string; candidateCheckpoint: string; outcome: ComparisonOutcome; baseline: NormalizedComparison; candidate: NormalizedComparison | null}
export interface ShadowPersistence {record(record: ComparisonRecord): Promise<"recorded" | "duplicate" | "conflict">}
