-- Finance V1 PHASE 1 ONLY. Prepared locally; no seeds, entitlement writes or RPCs.
-- Deliberately fail on pre-existing names instead of silently accepting schema drift.
BEGIN;
CREATE TABLE public.billing_finance_subscriptions (
 stripe_scope text NOT NULL CHECK (stripe_scope ~ '^acct_[A-Za-z0-9]+:(test|live)$'),
 stripe_object_id text NOT NULL,
 stripe_created_at timestamptz NOT NULL,
 source_event_id text CHECK (source_event_id IS NULL OR source_event_id ~ '^evt_[A-Za-z0-9]+$'),
 source_event_created_at timestamptz,
 stripe_api_version text NOT NULL CHECK (length(stripe_api_version)>0),
 normalizer_version integer NOT NULL CHECK (normalizer_version>0),
 revision bigint NOT NULL DEFAULT 1 CHECK (revision>0),
 verified_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 user_id uuid,
 stripe_customer_id text NOT NULL CHECK (stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
 status text NOT NULL CHECK (length(status)>0), cancel_at_period_end boolean NOT NULL, cancel_at timestamptz, canceled_at timestamptz, ended_at timestamptz, trial_end timestamptz,
 collection_paused boolean NOT NULL,
 linkage_status text NOT NULL CHECK (linkage_status IN ('verified','unresolved','conflict')),
 valuation_status text NOT NULL CHECK (valuation_status IN ('complete','unsupported','incomplete')),
 valuation_reason text,
 items_complete boolean NOT NULL,
 discount_context jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(discount_context)='array'),
 CHECK (linkage_status<>'verified' OR user_id IS NOT NULL),
 CHECK (valuation_status='complete' OR valuation_reason IS NOT NULL),
 PRIMARY KEY (stripe_scope,stripe_object_id),
 CHECK (stripe_object_id ~ '^sub_[A-Za-z0-9]+$')
);
CREATE TABLE public.billing_finance_subscription_items (
 stripe_scope text NOT NULL CHECK (stripe_scope ~ '^acct_[A-Za-z0-9]+:(test|live)$'),
 stripe_object_id text NOT NULL,
 stripe_created_at timestamptz NOT NULL,
 source_event_id text CHECK (source_event_id IS NULL OR source_event_id ~ '^evt_[A-Za-z0-9]+$'),
 source_event_created_at timestamptz,
 stripe_api_version text NOT NULL CHECK (length(stripe_api_version)>0),
 normalizer_version integer NOT NULL CHECK (normalizer_version>0),
 revision bigint NOT NULL DEFAULT 1 CHECK (revision>0),
 verified_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 stripe_subscription_id text NOT NULL,
 stripe_price_id text NOT NULL CHECK (stripe_price_id ~ '^price_[A-Za-z0-9]+$'),
 stripe_product_id text NOT NULL CHECK (stripe_product_id ~ '^prod_[A-Za-z0-9]+$'),
 currency text NOT NULL CHECK (currency ~ '^[a-z]{3}$'), quantity bigint CHECK (quantity>=0), unit_amount_minor bigint CHECK (unit_amount_minor>=0),
 unit_amount_decimal_minor numeric(38,12) CHECK (unit_amount_decimal_minor>=0),
 recurring_interval text NOT NULL CHECK (recurring_interval IN ('day','week','month','year')),
 interval_count integer NOT NULL CHECK (interval_count>0), usage_type text NOT NULL, billing_scheme text NOT NULL, tax_behavior text NOT NULL,
 period_start timestamptz, period_end timestamptz,
 effective_cycle_amount_minor bigint CHECK (effective_cycle_amount_minor>=0),
 valuation_status text NOT NULL CHECK (valuation_status IN ('complete','unsupported','incomplete')), valuation_reason text,
 discount_context jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(discount_context)='array'), removed_at timestamptz,
 CHECK (period_start IS NULL OR period_end IS NULL OR period_start<period_end),
 CHECK (valuation_status<>'complete' OR effective_cycle_amount_minor IS NOT NULL),
 CHECK (valuation_status='complete' OR valuation_reason IS NOT NULL),
 FOREIGN KEY(stripe_scope,stripe_subscription_id) REFERENCES public.billing_finance_subscriptions(stripe_scope,stripe_object_id) ON DELETE RESTRICT,
 PRIMARY KEY (stripe_scope,stripe_object_id),
 CHECK (stripe_object_id ~ '^si_[A-Za-z0-9]+$')
);
CREATE TABLE public.billing_invoices (
 stripe_scope text NOT NULL CHECK (stripe_scope ~ '^acct_[A-Za-z0-9]+:(test|live)$'),
 stripe_object_id text NOT NULL,
 stripe_created_at timestamptz NOT NULL,
 source_event_id text CHECK (source_event_id IS NULL OR source_event_id ~ '^evt_[A-Za-z0-9]+$'),
 source_event_created_at timestamptz,
 stripe_api_version text NOT NULL CHECK (length(stripe_api_version)>0),
 normalizer_version integer NOT NULL CHECK (normalizer_version>0),
 revision bigint NOT NULL DEFAULT 1 CHECK (revision>0),
 verified_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 stripe_customer_id text NOT NULL CHECK (stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
 stripe_subscription_id text, number text, status text NOT NULL CHECK (length(status)>0), billing_reason text, collection_method text NOT NULL,
 currency text NOT NULL CHECK (currency ~ '^[a-z]{3}$'), subtotal_minor bigint NOT NULL, discount_minor bigint NOT NULL CHECK (discount_minor>=0), tax_minor bigint NOT NULL,
 total_minor bigint NOT NULL, amount_due_minor bigint NOT NULL CHECK (amount_due_minor>=0),
 amount_paid_minor bigint NOT NULL CHECK (amount_paid_minor>=0), amount_remaining_minor bigint NOT NULL CHECK (amount_remaining_minor>=0),
 attempt_count integer NOT NULL CHECK (attempt_count>=0), due_at timestamptz, next_payment_attempt_at timestamptz,
 finalized_at timestamptz, paid_at timestamptz, voided_at timestamptz, marked_uncollectible_at timestamptz,
 payments_complete boolean NOT NULL,
 FOREIGN KEY(stripe_scope,stripe_subscription_id) REFERENCES public.billing_finance_subscriptions(stripe_scope,stripe_object_id) ON DELETE RESTRICT,
 PRIMARY KEY (stripe_scope,stripe_object_id),
 CHECK (stripe_object_id ~ '^in_[A-Za-z0-9]+$')
);
CREATE TABLE public.billing_payments (
 stripe_scope text NOT NULL CHECK (stripe_scope ~ '^acct_[A-Za-z0-9]+:(test|live)$'),
 stripe_object_id text NOT NULL,
 stripe_created_at timestamptz NOT NULL,
 source_event_id text CHECK (source_event_id IS NULL OR source_event_id ~ '^evt_[A-Za-z0-9]+$'),
 source_event_created_at timestamptz,
 stripe_api_version text NOT NULL CHECK (length(stripe_api_version)>0),
 normalizer_version integer NOT NULL CHECK (normalizer_version>0),
 revision bigint NOT NULL DEFAULT 1 CHECK (revision>0),
 verified_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 stripe_customer_id text NOT NULL CHECK (stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
 stripe_payment_intent_id text CHECK (stripe_payment_intent_id IS NULL OR stripe_payment_intent_id ~ '^pi_[A-Za-z0-9]+$'),
 currency text NOT NULL CHECK (currency ~ '^[a-z]{3}$'), status text NOT NULL CHECK (length(status)>0), amount_minor bigint NOT NULL CHECK(amount_minor>=0), amount_captured_minor bigint NOT NULL CHECK(amount_captured_minor>=0),
 amount_refunded_minor bigint NOT NULL CHECK(amount_refunded_minor>=0), paid boolean NOT NULL, captured boolean NOT NULL,
 collected_at timestamptz,
 collection_time_basis text NOT NULL CHECK (collection_time_basis IN ('verified_event','invoice_payment','automatic_capture_created','unknown')),
 attribution_status text NOT NULL CHECK (attribution_status IN ('verified','unresolved','mixed')),
 CHECK (amount_captured_minor<=amount_minor), CHECK (amount_refunded_minor<=amount_captured_minor),
 CHECK ((collected_at IS NULL) = (collection_time_basis='unknown')),
 PRIMARY KEY (stripe_scope,stripe_object_id),
 CHECK (stripe_object_id ~ '^ch_[A-Za-z0-9]+$')
);
CREATE TABLE public.billing_invoice_payments (
 stripe_scope text NOT NULL CHECK (stripe_scope ~ '^acct_[A-Za-z0-9]+:(test|live)$'),
 stripe_object_id text NOT NULL,
 stripe_created_at timestamptz NOT NULL,
 source_event_id text CHECK (source_event_id IS NULL OR source_event_id ~ '^evt_[A-Za-z0-9]+$'),
 source_event_created_at timestamptz,
 stripe_api_version text NOT NULL CHECK (length(stripe_api_version)>0),
 normalizer_version integer NOT NULL CHECK (normalizer_version>0),
 revision bigint NOT NULL DEFAULT 1 CHECK (revision>0),
 verified_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 stripe_invoice_id text NOT NULL, stripe_payment_intent_id text, stripe_charge_id text,
 payment_type text NOT NULL, currency text NOT NULL CHECK (currency ~ '^[a-z]{3}$'), status text NOT NULL CHECK (length(status)>0), amount_requested_minor bigint NOT NULL CHECK(amount_requested_minor>=0),
 amount_paid_minor bigint CHECK(amount_paid_minor>=0), paid_at timestamptz, canceled_at timestamptz,
 FOREIGN KEY(stripe_scope,stripe_invoice_id) REFERENCES public.billing_invoices(stripe_scope,stripe_object_id) ON DELETE RESTRICT, FOREIGN KEY(stripe_scope,stripe_charge_id) REFERENCES public.billing_payments(stripe_scope,stripe_object_id) ON DELETE RESTRICT,
 PRIMARY KEY (stripe_scope,stripe_object_id),
 CHECK (stripe_object_id ~ '^inpay_[A-Za-z0-9]+$')
);
CREATE TABLE public.billing_refunds (
 stripe_scope text NOT NULL CHECK (stripe_scope ~ '^acct_[A-Za-z0-9]+:(test|live)$'),
 stripe_object_id text NOT NULL,
 stripe_created_at timestamptz NOT NULL,
 source_event_id text CHECK (source_event_id IS NULL OR source_event_id ~ '^evt_[A-Za-z0-9]+$'),
 source_event_created_at timestamptz,
 stripe_api_version text NOT NULL CHECK (length(stripe_api_version)>0),
 normalizer_version integer NOT NULL CHECK (normalizer_version>0),
 revision bigint NOT NULL DEFAULT 1 CHECK (revision>0),
 verified_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 stripe_charge_id text NOT NULL, stripe_payment_intent_id text, currency text NOT NULL CHECK (currency ~ '^[a-z]{3}$'),
 amount_minor bigint NOT NULL CHECK(amount_minor>=0), status text NOT NULL CHECK (length(status)>0), reason text, failure_reason text,
 succeeded_at timestamptz, success_time_basis text NOT NULL CHECK(success_time_basis IN ('verified_event','unknown')),
 CHECK ((succeeded_at IS NULL) = (success_time_basis='unknown')),
 FOREIGN KEY(stripe_scope,stripe_charge_id) REFERENCES public.billing_payments(stripe_scope,stripe_object_id) ON DELETE RESTRICT,
 PRIMARY KEY (stripe_scope,stripe_object_id),
 CHECK (stripe_object_id ~ '^re_[A-Za-z0-9]+$')
);
CREATE TABLE public.billing_payment_attempts (
 stripe_scope text NOT NULL CHECK (stripe_scope ~ '^acct_[A-Za-z0-9]+:(test|live)$'), attempt_key text NOT NULL,
 stripe_customer_id text NOT NULL CHECK (stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'), stripe_invoice_id text, stripe_payment_intent_id text, stripe_charge_id text,
 currency text CHECK(currency ~ '^[a-z]{3}$'), amount_minor bigint CHECK(amount_minor>=0), occurred_at timestamptz NOT NULL,
 failure_code text, evidence_type text NOT NULL CHECK(evidence_type='failed_charge'), source_event_id text,
 stripe_api_version text NOT NULL, normalizer_version integer NOT NULL CHECK(normalizer_version>0), verified_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(stripe_scope,attempt_key), CHECK (attempt_key='charge:'||stripe_charge_id AND stripe_charge_id IS NOT NULL),
 FOREIGN KEY(stripe_scope,stripe_invoice_id) REFERENCES public.billing_invoices(stripe_scope,stripe_object_id) ON DELETE RESTRICT, FOREIGN KEY(stripe_scope,stripe_charge_id) REFERENCES public.billing_payments(stripe_scope,stripe_object_id) ON DELETE RESTRICT
);
CREATE TABLE public.billing_finance_event_deliveries (
 stripe_scope text NOT NULL CHECK (stripe_scope ~ '^acct_[A-Za-z0-9]+:(test|live)$'), consumer_version text NOT NULL, stripe_event_id text NOT NULL CHECK(stripe_event_id ~ '^evt_[A-Za-z0-9]+$'),
 event_type text NOT NULL, subject_id text NOT NULL, event_created_at timestamptz NOT NULL,
 state text NOT NULL CHECK(state IN ('received','processing','processed','failed','ignored')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0), lease_token uuid, lease_until timestamptz, processed_at timestamptz, error_code text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(stripe_scope,consumer_version,stripe_event_id), CHECK((lease_token IS NULL)=(lease_until IS NULL))
);
CREATE TABLE public.billing_finance_sync_state (
 stripe_scope text NOT NULL CHECK (stripe_scope ~ '^acct_[A-Za-z0-9]+:(test|live)$'), resource_type text NOT NULL, resource_key text NOT NULL,
 revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0), lease_token uuid, lease_until timestamptz, verified_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(stripe_scope,resource_type,resource_key), CHECK((lease_token IS NULL)=(lease_until IS NULL))
);
CREATE TABLE public.billing_finance_sync_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), stripe_scope text NOT NULL CHECK (stripe_scope ~ '^acct_[A-Za-z0-9]+:(test|live)$'), mode text NOT NULL CHECK(mode IN ('backfill','reconcile')),
 resource_type text NOT NULL, status text NOT NULL CHECK(status IN ('running','partial','completed','failed')), actor text NOT NULL,
 window_start timestamptz NOT NULL, window_end timestamptz NOT NULL, cursor jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(cursor)='object'),
 coverage_start timestamptz, coverage_end timestamptz, coverage_quality text NOT NULL CHECK(coverage_quality IN ('complete','partial')),
 processed_count bigint NOT NULL DEFAULT 0 CHECK(processed_count>=0), error_count bigint NOT NULL DEFAULT 0 CHECK(error_count>=0), error_code text,
 started_at timestamptz NOT NULL, completed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), CHECK(window_start<window_end),
 CHECK(coverage_start IS NULL OR coverage_end IS NULL OR coverage_start<coverage_end),
 CHECK(coverage_quality<>'complete' OR (status='completed' AND coverage_start IS NOT NULL AND coverage_end IS NOT NULL))
);
CREATE TABLE public.billing_finance_activity (
 stripe_scope text NOT NULL CHECK (stripe_scope ~ '^acct_[A-Za-z0-9]+:(test|live)$'), activity_key text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('subscription_created','cancellation_scheduled','cancellation_reversed','subscription_ended','invoice_paid','payment_failed','refund_issued')),
 stripe_customer_id text NOT NULL, stripe_subscription_id text, object_type text NOT NULL, object_id text NOT NULL,
 occurred_at timestamptz NOT NULL, amount_minor bigint CHECK(amount_minor>=0), currency text CHECK(currency ~ '^[a-z]{3}$'), effective_at timestamptz,
 source_event_id text, origin text NOT NULL CHECK(origin IN ('webhook','backfill','reconciliation')), source_revision bigint CHECK(source_revision>=0),
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(stripe_scope,activity_key), CHECK((amount_minor IS NULL)=(currency IS NULL)),
 FOREIGN KEY(stripe_scope,stripe_subscription_id) REFERENCES public.billing_finance_subscriptions(stripe_scope,stripe_object_id) ON DELETE RESTRICT
);
CREATE INDEX billing_finance_subscriptions_lookup_0 ON public.billing_finance_subscriptions(stripe_scope,status);
CREATE INDEX billing_finance_subscriptions_lookup_1 ON public.billing_finance_subscriptions(stripe_scope,stripe_customer_id);
CREATE INDEX billing_finance_subscriptions_lookup_2 ON public.billing_finance_subscriptions(stripe_scope,user_id);
CREATE INDEX billing_finance_subscriptions_lookup_3 ON public.billing_finance_subscriptions(stripe_scope,verified_at);
CREATE INDEX billing_finance_subscription_items_lookup_0 ON public.billing_finance_subscription_items(stripe_scope,stripe_subscription_id);
CREATE INDEX billing_finance_subscription_items_lookup_1 ON public.billing_finance_subscription_items(stripe_scope,period_end);
CREATE INDEX billing_invoices_lookup_0 ON public.billing_invoices(stripe_scope,stripe_customer_id,stripe_created_at DESC);
CREATE INDEX billing_invoices_lookup_1 ON public.billing_invoices(stripe_scope,stripe_subscription_id);
CREATE INDEX billing_invoices_lookup_2 ON public.billing_invoices(stripe_scope,status,due_at);
CREATE INDEX billing_invoices_lookup_3 ON public.billing_invoices(stripe_scope,paid_at);
CREATE INDEX billing_payments_lookup_0 ON public.billing_payments(stripe_scope,stripe_customer_id,collected_at);
CREATE INDEX billing_payments_lookup_1 ON public.billing_payments(stripe_scope,stripe_payment_intent_id);
CREATE INDEX billing_payments_lookup_2 ON public.billing_payments(stripe_scope,collected_at);
CREATE INDEX billing_invoice_payments_lookup_0 ON public.billing_invoice_payments(stripe_scope,stripe_invoice_id);
CREATE INDEX billing_invoice_payments_lookup_1 ON public.billing_invoice_payments(stripe_scope,stripe_charge_id);
CREATE INDEX billing_invoice_payments_lookup_2 ON public.billing_invoice_payments(stripe_scope,stripe_payment_intent_id);
CREATE INDEX billing_refunds_lookup_0 ON public.billing_refunds(stripe_scope,stripe_charge_id);
CREATE INDEX billing_refunds_lookup_1 ON public.billing_refunds(stripe_scope,status,stripe_created_at);
CREATE INDEX billing_refunds_lookup_2 ON public.billing_refunds(stripe_scope,succeeded_at);
CREATE INDEX billing_payment_attempts_lookup_0 ON public.billing_payment_attempts(stripe_scope,stripe_invoice_id);
CREATE INDEX billing_payment_attempts_lookup_1 ON public.billing_payment_attempts(stripe_scope,stripe_payment_intent_id);
CREATE INDEX billing_payment_attempts_lookup_2 ON public.billing_payment_attempts(stripe_scope,occurred_at);
CREATE INDEX billing_finance_event_deliveries_lookup_0 ON public.billing_finance_event_deliveries(stripe_scope,state,lease_until);
CREATE INDEX billing_finance_sync_state_lookup_0 ON public.billing_finance_sync_state(stripe_scope,verified_at);
CREATE INDEX billing_finance_sync_runs_lookup_0 ON public.billing_finance_sync_runs(stripe_scope,resource_type,started_at DESC);
CREATE INDEX billing_finance_activity_lookup_0 ON public.billing_finance_activity(stripe_scope,occurred_at DESC,activity_key);
CREATE UNIQUE INDEX billing_payment_attempts_charge_unique ON public.billing_payment_attempts(stripe_scope,stripe_charge_id) WHERE stripe_charge_id IS NOT NULL;
ALTER TABLE public.billing_finance_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_finance_subscriptions FROM PUBLIC, anon, authenticated, service_role;
-- Phase 1 has no writer. Phase 2 will add fenced RPCs before writes are enabled.
GRANT SELECT ON public.billing_finance_subscriptions TO service_role;
ALTER TABLE public.billing_finance_subscription_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_finance_subscription_items FROM PUBLIC, anon, authenticated, service_role;
-- Phase 1 has no writer. Phase 2 will add fenced RPCs before writes are enabled.
GRANT SELECT ON public.billing_finance_subscription_items TO service_role;
ALTER TABLE public.billing_invoices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_invoices FROM PUBLIC, anon, authenticated, service_role;
-- Phase 1 has no writer. Phase 2 will add fenced RPCs before writes are enabled.
GRANT SELECT ON public.billing_invoices TO service_role;
ALTER TABLE public.billing_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_payments FROM PUBLIC, anon, authenticated, service_role;
-- Phase 1 has no writer. Phase 2 will add fenced RPCs before writes are enabled.
GRANT SELECT ON public.billing_payments TO service_role;
ALTER TABLE public.billing_invoice_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_invoice_payments FROM PUBLIC, anon, authenticated, service_role;
-- Phase 1 has no writer. Phase 2 will add fenced RPCs before writes are enabled.
GRANT SELECT ON public.billing_invoice_payments TO service_role;
ALTER TABLE public.billing_refunds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_refunds FROM PUBLIC, anon, authenticated, service_role;
-- Phase 1 has no writer. Phase 2 will add fenced RPCs before writes are enabled.
GRANT SELECT ON public.billing_refunds TO service_role;
ALTER TABLE public.billing_payment_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_payment_attempts FROM PUBLIC, anon, authenticated, service_role;
-- Phase 1 has no writer. Phase 2 will add fenced RPCs before writes are enabled.
GRANT SELECT ON public.billing_payment_attempts TO service_role;
ALTER TABLE public.billing_finance_event_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_finance_event_deliveries FROM PUBLIC, anon, authenticated, service_role;
-- Phase 1 has no writer. Phase 2 will add fenced RPCs before writes are enabled.
GRANT SELECT ON public.billing_finance_event_deliveries TO service_role;
ALTER TABLE public.billing_finance_sync_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_finance_sync_state FROM PUBLIC, anon, authenticated, service_role;
-- Phase 1 has no writer. Phase 2 will add fenced RPCs before writes are enabled.
GRANT SELECT ON public.billing_finance_sync_state TO service_role;
ALTER TABLE public.billing_finance_sync_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_finance_sync_runs FROM PUBLIC, anon, authenticated, service_role;
-- Phase 1 has no writer. Phase 2 will add fenced RPCs before writes are enabled.
GRANT SELECT ON public.billing_finance_sync_runs TO service_role;
ALTER TABLE public.billing_finance_activity ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_finance_activity FROM PUBLIC, anon, authenticated, service_role;
-- Phase 1 has no writer. Phase 2 will add fenced RPCs before writes are enabled.
GRANT SELECT ON public.billing_finance_activity TO service_role;
-- Fail closed if inherited/default column grants or policies expose these tables.
DO $security$
DECLARE t text; r text;
BEGIN
 FOREACH t IN ARRAY ARRAY['billing_finance_subscriptions','billing_finance_subscription_items','billing_invoices','billing_payments','billing_invoice_payments','billing_refunds','billing_payment_attempts','billing_finance_event_deliveries','billing_finance_sync_state','billing_finance_sync_runs','billing_finance_activity'] LOOP
  IF EXISTS(SELECT 1 FROM pg_policy WHERE polrelid=('public.'||t)::regclass) THEN RAISE EXCEPTION 'FINANCE_UNEXPECTED_POLICY %',t; END IF;
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF has_table_privilege(r,'public.'||t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_any_column_privilege(r,'public.'||t,'SELECT,INSERT,UPDATE,REFERENCES') THEN
    RAISE EXCEPTION 'FINANCE_BROWSER_PRIVILEGE % %',t,r;
   END IF;
  END LOOP;
  IF has_table_privilege('service_role','public.'||t,'INSERT,UPDATE,DELETE,TRUNCATE') OR has_any_column_privilege('service_role','public.'||t,'INSERT,UPDATE') THEN RAISE EXCEPTION 'FINANCE_PREMATURE_WRITER %',t; END IF;
 END LOOP;
END $security$;
COMMIT;
