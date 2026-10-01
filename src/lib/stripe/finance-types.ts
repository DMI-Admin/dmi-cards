import "server-only";

/** Decimal strings cross JSON/SQL boundaries without IEEE-754 money loss. */
export type Minor = string;
export type Scope = string;
export type ValuationStatus = "complete" | "unsupported" | "incomplete";
export type Provenance = {
  stripe_scope: Scope; stripe_object_id: string; stripe_created_at: string;
  source_event_id: string | null; source_event_created_at: string | null;
  stripe_api_version: string; normalizer_version: number; verified_at: string;
};
/** revision/created_at/updated_at belong to the future transactional writer. */
export type Stored<T> = T & { revision: string; created_at: string; updated_at: string };
export type FinanceContext = {
  scope: Scope; verifiedAt: string; apiVersion: string;
  event?: { id: string; created: number; type: string; subjectId: string; subjectStatus?: string; previousStatus?: string; capturedAmountMinor?: string; subjectCaptured?: boolean };
};
export type Discount = {
  discount_id: string; coupon_id: string; applies_to: "subscription" | "item";
  percent_off: string | null; amount_off_minor: Minor | null; currency: string | null;
  starts_at: string; ends_at: string | null;
};
export type FinanceSubscription = Provenance & {
  user_id: string | null; stripe_customer_id: string; status: string;
  cancel_at_period_end: boolean; cancel_at: string | null; canceled_at: string | null;
  ended_at: string | null; trial_end: string | null; collection_paused: boolean;
  linkage_status: "verified" | "unresolved" | "conflict";
  valuation_status: ValuationStatus; valuation_reason: string | null;
  items_complete: boolean; discount_context: Discount[];
};
export type FinanceItem = Provenance & {
  stripe_subscription_id: string; stripe_price_id: string; stripe_product_id: string;
  currency: string; quantity: Minor | null; unit_amount_minor: Minor | null;
  unit_amount_decimal_minor: string | null; recurring_interval: "month" | "year" | "week" | "day";
  interval_count: number; usage_type: string; billing_scheme: string; tax_behavior: string;
  period_start: string | null; period_end: string | null; effective_cycle_amount_minor: Minor | null;
  valuation_status: ValuationStatus; valuation_reason: string | null;
  discount_context: Discount[]; removed_at: string | null;
};
export type FinanceInvoice = Provenance & {
  stripe_customer_id: string; stripe_subscription_id: string | null; number: string | null;
  status: string; billing_reason: string | null; collection_method: string; currency: string;
  subtotal_minor: Minor; discount_minor: Minor; tax_minor: Minor; total_minor: Minor;
  amount_due_minor: Minor; amount_paid_minor: Minor; amount_remaining_minor: Minor;
  attempt_count: number; due_at: string | null; next_payment_attempt_at: string | null;
  finalized_at: string | null; paid_at: string | null; voided_at: string | null;
  marked_uncollectible_at: string | null; payments_complete: boolean;
};
export type FinancePayment = Provenance & {
  stripe_customer_id: string; stripe_payment_intent_id: string | null; currency: string; status: string;
  amount_minor: Minor; amount_captured_minor: Minor; amount_refunded_minor: Minor; paid: boolean; captured: boolean;
  collected_at: string | null; collection_time_basis: "verified_event" | "invoice_payment" | "automatic_capture_created" | "unknown";
  attribution_status: "verified" | "unresolved" | "mixed";
};
export type InvoicePayment = Provenance & {
  stripe_invoice_id: string; stripe_payment_intent_id: string | null; stripe_charge_id: string | null;
  payment_type: string; currency: string; status: string; amount_requested_minor: Minor;
  amount_paid_minor: Minor | null; paid_at: string | null; canceled_at: string | null;
};
export type PaymentAttempt = {
  stripe_scope: Scope; attempt_key: string; stripe_customer_id: string; stripe_invoice_id: string | null;
  stripe_payment_intent_id: string | null; stripe_charge_id: string;
  currency: string; amount_minor: Minor; occurred_at: string; failure_code: string | null;
  evidence_type: "failed_charge"; source_event_id: string | null; stripe_api_version: string;
  normalizer_version: number; verified_at: string;
};
export type FinanceRefund = Provenance & {
  stripe_charge_id: string; stripe_payment_intent_id: string | null; currency: string; amount_minor: Minor;
  status: string; reason: string | null; failure_reason: string | null;
  succeeded_at: string | null; success_time_basis: "verified_event" | "unknown";
};
export type FinanceActivity = {
  stripe_scope: Scope; activity_key: string;
  kind: "subscription_created" | "cancellation_scheduled" | "cancellation_reversed" | "subscription_ended" | "invoice_paid" | "payment_failed" | "refund_issued";
  stripe_customer_id: string; stripe_subscription_id: string | null; object_type: string; object_id: string;
  occurred_at: string; amount_minor: Minor | null; currency: string | null; effective_at: string | null;
  source_event_id: string | null; origin: "webhook" | "backfill" | "reconciliation"; source_revision: string | null;
};
export type FinanceDelivery = {
  stripe_scope: Scope; consumer_version: string; stripe_event_id: string; event_type: string; subject_id: string;
  event_created_at: string; state: "received" | "processing" | "processed" | "failed" | "ignored";
  attempts: number; lease_token: string | null; lease_until: string | null; processed_at: string | null; error_code: string | null;
};
export type FinanceSyncState = {
  stripe_scope: Scope; resource_type: string; resource_key: string; revision: string;
  lease_token: string | null; lease_until: string | null; verified_at: string | null;
};
export type Coverage = { scope: Scope; currency: string; quality: "complete" | "partial"; start: string | null; end: string | null };
export type FinanceSyncRun = {
  id: string; stripe_scope: Scope; mode: "backfill" | "reconcile"; resource_type: string;
  status: "running" | "partial" | "completed" | "failed"; actor: string; window_start: string; window_end: string;
  cursor: { endpoint?: string; customer?: string; after?: string };
  coverage_start: string | null; coverage_end: string | null; coverage_quality: "complete" | "partial";
  processed_count: string; error_count: string; error_code: string | null; started_at: string; completed_at: string | null;
};
export type Rational = { numerator: bigint; denominator: bigint };
export type MetricResult<T> = { status: "complete"; value: T } | { status: "incomplete"; value: null; reason: string };
