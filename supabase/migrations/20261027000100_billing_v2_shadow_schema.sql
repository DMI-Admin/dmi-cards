-- Local/disposable V2 only. No legacy object changes, seeds or runtime hooks.
BEGIN;
CREATE ROLE billing_v2_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE billing_v2_executor NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
-- PostgreSQL 17 grants a non-superuser creator bootstrap ADMIN-only membership.
-- Preserve that exact administrative relationship; never authorize runtime through it.
DO $installer$
DECLARE installer oid; memberships jsonb;
BEGIN
 SELECT oid INTO installer FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolcreaterole);
 IF installer IS NULL OR current_user IN ('anon','authenticated','service_role','authenticator') THEN
  RAISE EXCEPTION 'V2_INSTALLER_REQUIRED' USING ERRCODE='42501';
 END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.roleid,m.member,m.grantor),'[]'::jsonb)
 INTO memberships FROM pg_auth_members m
 WHERE m.roleid IN ('billing_v2_owner'::regrole,'billing_v2_executor'::regrole);
 IF EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles g ON g.oid=m.grantor
  WHERE m.roleid IN ('billing_v2_owner'::regrole,'billing_v2_executor'::regrole)
  AND (m.member<>installer OR NOT m.admin_option OR m.inherit_option OR m.set_option OR NOT g.rolsuper)) THEN
  RAISE EXCEPTION 'V2_INSTALLER_MEMBERSHIP' USING ERRCODE='42501';
 END IF;
 PERFORM set_config('billing_v2.install_creator_memberships',memberships::text,true);
END $installer$;
-- Transaction-local installation capability, removed and checked before COMMIT.
GRANT billing_v2_owner TO CURRENT_USER WITH INHERIT TRUE, SET TRUE;
CREATE SCHEMA billing_v2 AUTHORIZATION billing_v2_owner;
REVOKE ALL ON SCHEMA billing_v2 FROM PUBLIC,anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE billing_v2_owner IN SCHEMA billing_v2 REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE billing_v2_owner IN SCHEMA billing_v2 REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE billing_v2_owner IN SCHEMA billing_v2 REVOKE ALL ON SEQUENCES FROM PUBLIC;
CREATE FUNCTION billing_v2.valid_tax_evidence(e jsonb,forecast boolean)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $tax$
DECLARE t jsonb; sum_tax numeric:=0; sum_vat numeric:=0; classified boolean:=true; k text;
BEGIN
 IF jsonb_typeof(e) IS DISTINCT FROM 'object' OR e->'version' IS DISTINCT FROM '1'::jsonb THEN RETURN false; END IF;
 IF forecast THEN
  IF e - ARRAY['version','status','basis','reason','sourceRef','verifiedAt','configuration','grossMinor','taxMinor','netMinor']::text[] <> '{}'::jsonb
   OR NOT(e ?& ARRAY['version','status','basis','reason','sourceRef','verifiedAt','configuration','grossMinor','taxMinor','netMinor'])
   OR coalesce(e->>'status','') NOT IN ('unknown','verified') THEN RETURN false; END IF;
  IF e->>'status'='unknown' THEN
   IF e->>'basis' IS DISTINCT FROM 'unavailable' OR e->>'reason' IS DISTINCT FROM 'forecast_tax_evidence_missing'
    OR e->'sourceRef' IS DISTINCT FROM 'null'::jsonb OR e->'verifiedAt' IS DISTINCT FROM 'null'::jsonb
    OR e->'grossMinor' IS DISTINCT FROM 'null'::jsonb OR e->'taxMinor' IS DISTINCT FROM 'null'::jsonb OR e->'netMinor' IS DISTINCT FROM 'null'::jsonb THEN RETURN false; END IF;
  ELSE
   IF e->>'basis' IS DISTINCT FROM 'stripe_invoice_preview' OR e->>'reason' IS DISTINCT FROM 'verified_preview_totals'
    OR coalesce(e->>'sourceRef','')!~'^(upcoming_)?in_[A-Za-z0-9]+$'
    OR coalesce(e->>'verifiedAt','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$' THEN RETURN false; END IF;
   FOREACH k IN ARRAY ARRAY['grossMinor','taxMinor','netMinor'] LOOP
    IF jsonb_typeof(e->k) IS DISTINCT FROM 'string' OR coalesce(e->>k,'')!~'^[0-9]{1,19}$' THEN RETURN false; END IF;
   END LOOP;
   IF (e->>'grossMinor')::numeric<>(e->>'netMinor')::numeric+(e->>'taxMinor')::numeric THEN RETURN false; END IF;
  END IF;
  t:=e->'configuration';
  IF t='null'::jsonb THEN RETURN e->>'status'='unknown'; END IF;
  IF jsonb_typeof(t) IS DISTINCT FROM 'object' OR t-ARRAY['version','scope','subscriptionId','itemId','priceId','currency','quantity','interval','intervalCount','taxBehavior','discounts']::text[]<>'{}'::jsonb
   OR NOT(t ?& ARRAY['version','scope','subscriptionId','itemId','priceId','currency','quantity','interval','intervalCount','taxBehavior','discounts'])
   OR t->'version' IS DISTINCT FROM '1'::jsonb OR coalesce(t->>'scope','')!~'^acct_[A-Za-z0-9]+:(test|live)$'
   OR coalesce(t->>'subscriptionId','')!~'^sub_[A-Za-z0-9]+$' OR coalesce(t->>'itemId','')!~'^si_[A-Za-z0-9]+$'
   OR coalesce(t->>'priceId','')!~'^price_[A-Za-z0-9]+$' OR coalesce(t->>'currency','')!~'^[a-z]{3}$'
   OR coalesce(t->>'interval','') NOT IN ('day','week','month','year') OR jsonb_typeof(t->'intervalCount') IS DISTINCT FROM 'number' OR coalesce(t->>'intervalCount','')!~'^[1-9][0-9]*$'
   OR (t->'quantity'<>'null'::jsonb AND (jsonb_typeof(t->'quantity') IS DISTINCT FROM 'string' OR coalesce(t->>'quantity','')!~'^[0-9]{1,19}$'))
   OR jsonb_typeof(t->'taxBehavior') IS DISTINCT FROM 'string'
   OR jsonb_typeof(t->'discounts') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(t->'discounts') d WHERE jsonb_typeof(d) IS DISTINCT FROM 'object' OR d-ARRAY['discount_id','coupon_id','applies_to','percent_off','amount_off_minor','currency','starts_at','ends_at']::text[]<>'{}'::jsonb) THEN RETURN false; END IF;
  RETURN true;
 END IF;
 IF e-ARRAY['version','status','reason','basis','grossMinor','taxMinor','vatMinor','netMinor','automaticTaxEnabled','automaticTaxStatus','breakdownComplete','linesComplete','lineCount','breakdown']::text[]<>'{}'::jsonb
 OR NOT(e ?& ARRAY['version','status','reason','basis','grossMinor','taxMinor','vatMinor','netMinor','automaticTaxEnabled','automaticTaxStatus','breakdownComplete','linesComplete','lineCount','breakdown'])
 OR coalesce(e->>'status','') NOT IN ('unknown','verified')
 OR coalesce(e->>'reason','') NOT IN ('not_refreshed','tax_evidence_missing','tax_breakdown_invalid','invoice_lines_incomplete','invoice_not_finalized','automatic_tax_unverified','invoice_net_missing','invoice_tax_totals_mismatch','verified_invoice_totals')
 OR jsonb_typeof(e->'breakdown') IS DISTINCT FROM 'array' OR jsonb_array_length(e->'breakdown')>100
 OR (e->'lineCount'<>'null'::jsonb AND (jsonb_typeof(e->'lineCount') IS DISTINCT FROM 'number' OR coalesce(e->>'lineCount','')!~'^[0-9]{1,3}$' OR (e->>'lineCount')::int>200))
 OR (e->'linesComplete'='true'::jsonb AND e->'lineCount'='null'::jsonb)
 OR jsonb_typeof(e->'breakdownComplete') IS DISTINCT FROM 'boolean' OR jsonb_typeof(e->'linesComplete') IS DISTINCT FROM 'boolean'
 OR e->'automaticTaxEnabled' NOT IN ('null'::jsonb,'true'::jsonb,'false'::jsonb)
 OR (e->'automaticTaxStatus'<>'null'::jsonb AND e->>'automaticTaxStatus' NOT IN ('complete','failed','requires_location_inputs','unknown')) THEN RETURN false; END IF;
 FOREACH k IN ARRAY ARRAY['grossMinor','taxMinor','vatMinor','netMinor'] LOOP
  IF e->k<>'null'::jsonb AND (jsonb_typeof(e->k) IS DISTINCT FROM 'string' OR e->>k !~ '^-?[0-9]{1,19}$') THEN RETURN false; END IF;
 END LOOP;
 FOR t IN SELECT value FROM jsonb_array_elements(e->'breakdown') LOOP
  IF jsonb_typeof(t) IS DISTINCT FROM 'object' OR t-ARRAY['amountMinor','taxableAmountMinor','behavior','taxRateId','ratePercent','taxType','country','reason']::text[]<>'{}'::jsonb
   OR NOT(t ?& ARRAY['amountMinor','taxableAmountMinor','behavior','taxRateId','ratePercent','taxType','country','reason'])
   OR jsonb_typeof(t->'amountMinor') IS DISTINCT FROM 'string' OR coalesce(t->>'amountMinor','')!~'^-?[0-9]{1,19}$'
   OR coalesce(t->>'behavior','') NOT IN ('inclusive','exclusive') OR coalesce(t->>'taxRateId','')!~'^txr_[A-Za-z0-9]+$'
   OR coalesce(t->>'taxType','') NOT IN ('vat','other','unknown')
   OR (t->'ratePercent'<>'null'::jsonb AND (jsonb_typeof(t->'ratePercent') IS DISTINCT FROM 'string' OR t->>'ratePercent'!~'^[0-9]{1,3}(\.[0-9]{1,12})?$'))
   OR (t->'country'<>'null'::jsonb AND coalesce(t->>'country','')!~'^[A-Z]{2}$')
   OR (t->'taxableAmountMinor'<>'null'::jsonb AND (jsonb_typeof(t->'taxableAmountMinor') IS DISTINCT FROM 'string' OR t->>'taxableAmountMinor'!~'^-?[0-9]{1,19}$'))
   OR coalesce(t->>'reason','') NOT IN ('customer_exempt','not_available','not_collecting','not_subject_to_tax','not_supported','portion_product_exempt','portion_reduced_rated','portion_standard_rated','product_exempt','product_exempt_holiday','proportionally_rated','reduced_rated','reverse_charge','standard_rated','taxable_basis_reduced','zero_rated','unknown') THEN RETURN false; END IF;
  sum_tax:=sum_tax+(t->>'amountMinor')::numeric;
  IF t->>'taxType'='vat' THEN sum_vat:=sum_vat+(t->>'amountMinor')::numeric; END IF;
  IF t->>'taxType'='unknown' THEN classified:=false; END IF;
 END LOOP;
 IF e->>'status'='unknown' THEN
  RETURN e->>'basis'='unavailable' AND e->'taxMinor'='null'::jsonb AND e->'vatMinor'='null'::jsonb AND e->'netMinor'='null'::jsonb;
 END IF;
 RETURN e->>'basis'='finalized_invoice' AND e->>'reason'='verified_invoice_totals' AND e->'breakdownComplete'='true'::jsonb AND e->'linesComplete'='true'::jsonb
  AND e->'grossMinor'<>'null'::jsonb AND e->'taxMinor'<>'null'::jsonb AND e->'netMinor'<>'null'::jsonb
  AND (e->'automaticTaxEnabled'='false'::jsonb OR (e->'automaticTaxEnabled'='true'::jsonb AND e->>'automaticTaxStatus'='complete'))
  AND (e->>'grossMinor')::numeric=(e->>'netMinor')::numeric+sum_tax AND (e->>'taxMinor')::numeric=sum_tax
  AND ((classified AND e->'vatMinor'<>'null'::jsonb AND (e->>'vatMinor')::numeric=sum_vat) OR (NOT classified AND e->'vatMinor'='null'::jsonb));
END $tax$;
CREATE FUNCTION billing_v2.valid_document(kind text, document jsonb) RETURNS boolean
LANGUAGE plpgsql SET search_path=pg_catalog AS $v2$
#variable_conflict use_column
DECLARE allowed text[];
BEGIN
 IF document IS NULL OR jsonb_typeof(document)<>'object' THEN RETURN false; END IF;
 IF kind='invoice_tax' THEN RETURN billing_v2.valid_tax_evidence(document,false) IS TRUE; END IF;
 IF kind='forecast_tax' THEN RETURN billing_v2.valid_tax_evidence(document,true) IS TRUE; END IF;
 allowed:=CASE kind
 WHEN 'task_evidence' THEN ARRAY['version','event_type','event_created','livemode','event_account','subject','customer','subscription','namespace_verified','principal']
 WHEN 'checkout_parameters' THEN ARRAY['mode','ui_mode','customer','client_reference_id','line_items','success_url','cancel_url','return_url','metadata','subscription_data','payment_method_types','redirect_on_completion']
 WHEN 'operation_facts' THEN ARRAY['version','stage','task','generation','before','after','digest','rows','scope','checkpoint','counts','comparison','cursor','manifest','reason','source_id']
 WHEN 'run_cursor' THEN ARRAY['version','resource','after','window_start','window_end','page']
 WHEN 'run_coverage' THEN ARRAY['version','discovered','admitted','resolved','attention','complete','digest']
 WHEN 'invoice_provenance' THEN ARRAY['version','application_key','state','invoice_revision','customer_ref','subscription_ref','complete','price_proofs','source_event_id','certificate_revision']
 ELSE NULL END;
 IF allowed IS NULL OR document-allowed<>'{}'::jsonb THEN RETURN false; END IF;
 IF kind<>'checkout_parameters' AND document->>'version' IS DISTINCT FROM '1' THEN RETURN false; END IF;
 IF kind='task_evidence' THEN
  RETURN document ?& ARRAY['event_type','event_created','livemode','subject','namespace_verified'] AND jsonb_typeof(document->'event_created')='number' AND (document->>'event_created')~'^\d+$' AND jsonb_typeof(document->'livemode')='boolean' AND jsonb_typeof(document->'namespace_verified')='boolean' AND length(document->>'subject') BETWEEN 1 AND 255;
 ELSIF kind='invoice_provenance' THEN
  RETURN document ?& ARRAY['application_key','state','invoice_revision','customer_ref','subscription_ref','complete','price_proofs','source_event_id','certificate_revision'] AND document->>'application_key'='dmi_cards' AND document->>'state'='proven' AND document->'complete'='true'::jsonb AND jsonb_typeof(document->'price_proofs')='array' AND jsonb_array_length(document->'price_proofs') BETWEEN 1 AND 100;
 END IF;
 RETURN true;
EXCEPTION WHEN others THEN RETURN false;
END;
$v2$;
CREATE FUNCTION billing_v2.valid_forecast_anchors(e jsonb,scope text,subscription text,item text,price text,currency text,quantity bigint,interval_value text,interval_count integer,tax_behavior text,verified_at timestamptz) RETURNS boolean
LANGUAGE sql SET search_path=pg_catalog AS $v2$
SELECT e->'configuration'='null'::jsonb OR (
 e->'configuration'->>'scope'=scope AND e->'configuration'->>'subscriptionId'=subscription AND e->'configuration'->>'itemId'=item AND e->'configuration'->>'priceId'=price AND e->'configuration'->>'currency'=currency AND e->'configuration'->>'quantity' IS NOT DISTINCT FROM quantity::text AND e->'configuration'->>'interval'=interval_value AND e->'configuration'->>'intervalCount'=interval_count::text AND e->'configuration'->>'taxBehavior'=tax_behavior AND (e->>'status'='unknown' OR (e->>'verifiedAt')::timestamptz=verified_at));
$v2$;
CREATE TABLE billing_v2.accounts (
 stripe_scope text NOT NULL,
 id uuid DEFAULT gen_random_uuid() NOT NULL,
 principal_kind text NOT NULL,
 principal_id uuid,
 stripe_customer_id text,
 binding_state text NOT NULL,
 binding_revision bigint DEFAULT 0 NOT NULL,
 verified_at timestamptz,
 created_at timestamptz DEFAULT clock_timestamp() NOT NULL,
 updated_at timestamptz DEFAULT clock_timestamp() NOT NULL,
 PRIMARY KEY (stripe_scope,id),
 CHECK (stripe_scope ~ '^acct_[A-Za-z0-9]+:(test|live)$'),
 CHECK (principal_kind IN ('individual','business','unresolved')),
 CHECK (binding_state IN ('unresolved','verified','conflict')),
 CHECK (binding_revision >= 0),
 CHECK ((binding_state <> 'verified') OR (principal_id IS NOT NULL AND stripe_customer_id IS NOT NULL AND principal_kind <> 'unresolved' AND verified_at IS NOT NULL)),
 CHECK (stripe_customer_id IS NULL OR stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
 CHECK ((principal_kind='unresolved') = (principal_id IS NULL))
);
CREATE TABLE billing_v2.checkout_attempts (
 stripe_scope text NOT NULL,
 id uuid DEFAULT gen_random_uuid() NOT NULL,
 billing_account_id uuid NOT NULL,
 operation_kind text NOT NULL,
 presentation text,
 idempotency_key text NOT NULL,
 parameters jsonb NOT NULL,
 parameters_digest text NOT NULL,
 status text NOT NULL,
 provider_object_id text,
 attempted_at timestamptz,
 resolved_at timestamptz,
 replay_deadline timestamptz NOT NULL,
 lease_token uuid,
 lease_until timestamptz,
 claim_generation bigint DEFAULT 0 NOT NULL,
 created_at timestamptz DEFAULT clock_timestamp() NOT NULL,
 updated_at timestamptz DEFAULT clock_timestamp() NOT NULL,
 PRIMARY KEY (stripe_scope,id),
 CHECK (stripe_scope ~ '^acct_[A-Za-z0-9]+:(test|live)$'),
 CHECK (operation_kind IN ('create_customer','create_session','update_subscription')),
 CHECK (presentation IN ('hosted','embedded')),
 CHECK (status IN ('prepared','in_flight','succeeded','ambiguous','attention')),
 CHECK (claim_generation >= 0),
 CHECK ((lease_token IS NULL) = (lease_until IS NULL)),
 CHECK ((status='in_flight') = (lease_token IS NOT NULL)),
 CHECK ((operation_kind='create_session') = (presentation IS NOT NULL)),
 CHECK (replay_deadline > created_at),
 CHECK ((billing_v2.valid_document('checkout_parameters',parameters)) IS TRUE),
 CHECK (parameters_digest ~ '^[0-9a-f]{64}$')
);
CREATE TABLE billing_v2.price_catalog (
 stripe_scope text NOT NULL,
 stripe_price_id text NOT NULL,
 stripe_product_id text,
 application_key text NOT NULL,
 plan text NOT NULL,
 billing_interval text NOT NULL,
 entitlement_enabled boolean NOT NULL,
 checkout_enabled boolean NOT NULL,
 ownership_state text NOT NULL,
 ownership_basis text NOT NULL,
 revision bigint DEFAULT 1 NOT NULL,
 verified_at timestamptz NOT NULL,
 created_at timestamptz DEFAULT clock_timestamp() NOT NULL,
 updated_at timestamptz DEFAULT clock_timestamp() NOT NULL,
 application_active boolean NOT NULL,
 PRIMARY KEY (stripe_scope,stripe_price_id),
 CHECK (stripe_scope ~ '^acct_[A-Za-z0-9]+:(test|live)$'),
 CHECK (plan IN ('pro')),
 CHECK (billing_interval IN ('monthly','annual')),
 CHECK (ownership_state IN ('active','revoked')),
 CHECK (ownership_basis IN ('price_owner')),
 CHECK (revision > 0),
 CHECK (stripe_price_id ~ '^price_[A-Za-z0-9]+$'),
 CHECK (length(application_key)>0)
);
CREATE TABLE billing_v2.subscriptions (
 stripe_scope text NOT NULL,
 stripe_subscription_id text NOT NULL,
 billing_account_id uuid NOT NULL,
 stripe_customer_id text NOT NULL,
 stripe_price_id text,
 status text NOT NULL,
 plan text NOT NULL,
 cancel_at_period_end boolean NOT NULL,
 period_start timestamptz,
 period_end timestamptz,
 trial_end timestamptz,
 ended_at timestamptz,
 latest_invoice_id text,
 terminal boolean NOT NULL,
 revision bigint DEFAULT 1 NOT NULL,
 verified_at timestamptz NOT NULL,
 last_event_created bigint,
 last_event_id text,
 snapshot_digest text NOT NULL,
 created_at timestamptz DEFAULT clock_timestamp() NOT NULL,
 updated_at timestamptz DEFAULT clock_timestamp() NOT NULL,
 PRIMARY KEY (stripe_scope,stripe_subscription_id),
 CHECK (stripe_scope ~ '^acct_[A-Za-z0-9]+:(test|live)$'),
 CHECK (status IN ('active','trialing','past_due','unpaid','canceled','incomplete','incomplete_expired','paused','unknown')),
 CHECK (plan IN ('free','pro')),
 CHECK (revision > 0),
 CHECK (stripe_subscription_id ~ '^sub_[A-Za-z0-9]+$'),
 CHECK (stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
 CHECK (plan <> 'pro' OR (status IN ('active','trialing') AND NOT terminal AND stripe_price_id IS NOT NULL)),
 CHECK (period_start IS NULL OR period_end IS NULL OR period_start < period_end)
);
CREATE TABLE billing_v2.event_inbox (
 stripe_scope text NOT NULL,
 id uuid DEFAULT gen_random_uuid() NOT NULL,
 source_kind text NOT NULL,
 source_id text NOT NULL,
 task_kind text NOT NULL,
 stripe_event_id text,
 event_type text,
 event_created bigint,
 evidence_version integer NOT NULL,
 evidence jsonb NOT NULL,
 evidence_digest text NOT NULL,
 billing_account_id uuid,
 state text NOT NULL,
 available_at timestamptz NOT NULL,
 arrival_sequence bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
 dependency_kind text,
 dependency_reference text,
 lease_token uuid,
 lease_until timestamptz,
 claim_generation bigint DEFAULT 0 NOT NULL,
 authority_generation bigint,
 writer_engine text,
 processing_started_at timestamptz,
 claim_count bigint DEFAULT 0 NOT NULL,
 failure_count integer DEFAULT 0 NOT NULL,
 first_failure_at timestamptz,
 retry_deadline timestamptz,
 failure_category text,
 result text,
 completed_at timestamptz,
 projection_revision bigint,
 projection_digest text,
 run_id uuid,
 created_at timestamptz DEFAULT clock_timestamp() NOT NULL,
 updated_at timestamptz DEFAULT clock_timestamp() NOT NULL,
 PRIMARY KEY (stripe_scope,id),
 CHECK (stripe_scope ~ '^acct_[A-Za-z0-9]+:(test|live)$'),
 CHECK (source_kind IN ('webhook','reconciliation','recovery')),
 CHECK (task_kind IN ('access','finance')),
 CHECK (state IN ('queued','processing','retry_wait','dependency_wait','completed','needs_attention')),
 CHECK (dependency_kind IN ('account_binding','subscription','invoice','payment','ownership_provenance')),
 CHECK (claim_generation >= 0),
 CHECK (writer_engine IN ('shadow')),
 CHECK (claim_count >= 0),
 CHECK (failure_count >= 0),
 CHECK (result IN ('processed','ignored','unchanged','stale_ignored','terminal_ignored')),
 CHECK ((state='processing') = (lease_token IS NOT NULL AND lease_until IS NOT NULL AND writer_engine IS NOT NULL)),
 CHECK ((lease_token IS NULL) = (lease_until IS NULL)),
 CHECK (state='processing' OR (lease_token IS NULL AND writer_engine IS NULL AND authority_generation IS NULL)),
 CHECK ((state='completed') = (completed_at IS NOT NULL AND result IS NOT NULL)),
 CHECK (state <> 'dependency_wait' OR (dependency_kind IS NOT NULL AND dependency_reference IS NOT NULL)),
 CHECK (state <> 'retry_wait' OR failure_category IS NOT NULL),
 CHECK (state <> 'needs_attention' OR failure_category IS NOT NULL),
 CHECK (evidence_digest ~ '^[0-9a-f]{64}$'),
 CHECK (evidence_version=1),
 CHECK ((billing_v2.valid_document('task_evidence',evidence)) IS TRUE),
 CHECK (failure_category IS NULL OR failure_category IN ('provider_unavailable','provider_rate_limited','provider_transport','store_unavailable','ambiguous_provider_result','ownership_unresolved','ownership_conflict','unknown_price','invalid_evidence','retry_exhausted','dependency_unresolved','handover_blocked')),
 CHECK (state='completed' OR (completed_at IS NULL AND result IS NULL))
);
CREATE TABLE billing_v2.authority (
 stripe_scope text NOT NULL,
 domain text NOT NULL,
 resource_key text NOT NULL,
 billing_account_id uuid,
 writer_engine text DEFAULT 'shadow' NOT NULL,
 mode text DEFAULT 'shadow_only' NOT NULL,
 generation bigint DEFAULT 0 NOT NULL,
 inbox_task_id uuid,
 checkout_attempt_id uuid,
 handover_from text,
 handover_started_at timestamptz,
 handover_completed_at timestamptz,
 last_completed_operation_id uuid,
 created_at timestamptz DEFAULT clock_timestamp() NOT NULL,
 updated_at timestamptz DEFAULT clock_timestamp() NOT NULL,
 PRIMARY KEY (stripe_scope,domain,resource_key),
 CHECK (stripe_scope ~ '^acct_[A-Za-z0-9]+:(test|live)$'),
 CHECK (domain IN ('access','finance','reconciliation','migration')),
 CHECK (writer_engine IN ('shadow')),
 CHECK (mode IN ('shadow_only')),
 CHECK (generation >= 0),
 CHECK (num_nonnulls(inbox_task_id,checkout_attempt_id) <= 1),
 CHECK ((domain NOT IN ('access','finance')) OR (billing_account_id IS NOT NULL AND resource_key=billing_account_id::text))
);
CREATE TABLE billing_v2.operations (
 stripe_scope text NOT NULL,
 id uuid DEFAULT gen_random_uuid() NOT NULL,
 record_type text NOT NULL,
 operation_kind text NOT NULL,
 parent_run_id uuid,
 source_kind text NOT NULL,
 source_id text NOT NULL,
 billing_account_id uuid,
 task_id uuid,
 status text NOT NULL,
 outcome text,
 authority_generation bigint,
 before_revision bigint,
 after_revision bigint,
 cursor jsonb,
 coverage jsonb,
 facts jsonb NOT NULL,
 started_at timestamptz,
 completed_at timestamptz,
 created_at timestamptz DEFAULT clock_timestamp() NOT NULL,
 updated_at timestamptz DEFAULT clock_timestamp() NOT NULL,
 PRIMARY KEY (stripe_scope,id),
 CHECK (stripe_scope ~ '^acct_[A-Za-z0-9]+:(test|live)$'),
 CHECK (record_type IN ('run','audit')),
 CHECK (operation_kind IN ('subscription_sync','finance_projection','checkout','ownership_change','handover','subscription_reconciliation','finance_reconciliation','recovery','backfill','shadow_comparison')),
 CHECK (status IN ('planned','running','partial','completed','failed','suspended')),
 CHECK ((billing_v2.valid_document('operation_facts',facts)) IS TRUE),
 CHECK (record_type <> 'audit' OR (cursor IS NULL AND coverage IS NULL AND outcome IS NOT NULL)),
 CHECK (record_type <> 'run' OR task_id IS NULL),
 CHECK ((cursor IS NULL OR billing_v2.valid_document('run_cursor',cursor)) IS TRUE),
 CHECK ((coverage IS NULL OR billing_v2.valid_document('run_coverage',coverage)) IS TRUE)
);
CREATE TABLE billing_v2.finance_subscriptions (
 stripe_scope text NOT NULL,
 stripe_object_id text NOT NULL,
 stripe_created_at timestamptz NOT NULL,
 source_event_id text,
 source_event_created_at timestamptz,
 stripe_api_version text NOT NULL,
 normalizer_version integer NOT NULL,
 revision bigint DEFAULT 1 NOT NULL,
 verified_at timestamptz NOT NULL,
 created_at timestamptz DEFAULT clock_timestamp() NOT NULL,
 updated_at timestamptz DEFAULT clock_timestamp() NOT NULL,
 user_id uuid,
 stripe_customer_id text NOT NULL,
 status text NOT NULL,
 cancel_at_period_end boolean NOT NULL,
 cancel_at timestamptz,
 canceled_at timestamptz,
 ended_at timestamptz,
 trial_end timestamptz,
 collection_paused boolean NOT NULL,
 linkage_status text NOT NULL,
 valuation_status text NOT NULL,
 valuation_reason text,
 items_complete boolean NOT NULL,
 discount_context jsonb NOT NULL,
 PRIMARY KEY (stripe_scope,stripe_object_id),
 CHECK (stripe_scope ~ '^acct_[A-Za-z0-9]+:(test|live)$'),
 CHECK (revision > 0),
 CHECK (linkage_status IN ('verified','unresolved','conflict')),
 CHECK (valuation_status IN ('complete','unsupported','incomplete')),
 CHECK (source_event_id IS NULL OR source_event_id ~ '^evt_[A-Za-z0-9]+$'),
 CHECK (length(stripe_api_version)>0),
 CHECK (normalizer_version>0),
 CHECK (revision>0),
 CHECK (stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
 CHECK (length(status)>0),
 CHECK (jsonb_typeof(discount_context)='array'),
 CHECK (linkage_status<>'verified' OR user_id IS NOT NULL),
 CHECK (valuation_status='complete' OR valuation_reason IS NOT NULL),
 CHECK (stripe_object_id ~ '^sub_[A-Za-z0-9]+$')
);
CREATE TABLE billing_v2.finance_subscription_items (
 stripe_scope text NOT NULL,
 stripe_object_id text NOT NULL,
 stripe_created_at timestamptz NOT NULL,
 source_event_id text,
 source_event_created_at timestamptz,
 stripe_api_version text NOT NULL,
 normalizer_version integer NOT NULL,
 revision bigint DEFAULT 1 NOT NULL,
 verified_at timestamptz NOT NULL,
 created_at timestamptz DEFAULT clock_timestamp() NOT NULL,
 updated_at timestamptz DEFAULT clock_timestamp() NOT NULL,
 stripe_subscription_id text NOT NULL,
 stripe_price_id text NOT NULL,
 stripe_product_id text NOT NULL,
 currency text NOT NULL,
 quantity bigint,
 unit_amount_minor bigint,
 unit_amount_decimal_minor numeric(38,12),
 recurring_interval text NOT NULL,
 interval_count integer NOT NULL,
 usage_type text NOT NULL,
 billing_scheme text NOT NULL,
 tax_behavior text NOT NULL,
 period_start timestamptz,
 period_end timestamptz,
 effective_cycle_amount_minor bigint,
 valuation_status text NOT NULL,
 valuation_reason text,
 discount_context jsonb NOT NULL,
 removed_at timestamptz,
 forecast_tax_evidence jsonb NOT NULL,
 PRIMARY KEY (stripe_scope,stripe_object_id),
 CHECK (stripe_scope ~ '^acct_[A-Za-z0-9]+:(test|live)$'),
 CHECK (revision > 0),
 CHECK (recurring_interval IN ('day','week','month','year')),
 CHECK (valuation_status IN ('complete','unsupported','incomplete')),
 CHECK (source_event_id IS NULL OR source_event_id ~ '^evt_[A-Za-z0-9]+$'),
 CHECK (length(stripe_api_version)>0),
 CHECK (normalizer_version>0),
 CHECK (revision>0),
 CHECK (stripe_price_id ~ '^price_[A-Za-z0-9]+$'),
 CHECK (stripe_product_id ~ '^prod_[A-Za-z0-9]+$'),
 CHECK (currency ~ '^[a-z]{3}$'),
 CHECK (quantity>=0),
 CHECK (unit_amount_minor>=0),
 CHECK (unit_amount_decimal_minor>=0),
 CHECK (interval_count>0),
 CHECK (effective_cycle_amount_minor>=0),
 CHECK (jsonb_typeof(discount_context)='array'),
 CHECK (period_start IS NULL OR period_end IS NULL OR period_start<period_end),
 CHECK (valuation_status<>'complete' OR effective_cycle_amount_minor IS NOT NULL),
 CHECK (valuation_status='complete' OR valuation_reason IS NOT NULL),
 CHECK (stripe_object_id ~ '^si_[A-Za-z0-9]+$'),
 CHECK ((billing_v2.valid_document('forecast_tax',forecast_tax_evidence)) IS TRUE),
 CHECK ((billing_v2.valid_forecast_anchors(forecast_tax_evidence,stripe_scope,stripe_subscription_id,stripe_object_id,stripe_price_id,currency,quantity,recurring_interval,interval_count,tax_behavior,verified_at)) IS TRUE)
);
CREATE TABLE billing_v2.invoices (
 stripe_scope text NOT NULL,
 stripe_object_id text NOT NULL,
 stripe_created_at timestamptz NOT NULL,
 source_event_id text,
 source_event_created_at timestamptz,
 stripe_api_version text NOT NULL,
 normalizer_version integer NOT NULL,
 revision bigint DEFAULT 1 NOT NULL,
 verified_at timestamptz NOT NULL,
 created_at timestamptz DEFAULT clock_timestamp() NOT NULL,
 updated_at timestamptz DEFAULT clock_timestamp() NOT NULL,
 stripe_customer_id text NOT NULL,
 stripe_subscription_id text,
 number text,
 status text NOT NULL,
 billing_reason text,
 collection_method text NOT NULL,
 currency text NOT NULL,
 subtotal_minor bigint NOT NULL,
 discount_minor bigint NOT NULL,
 tax_minor bigint,
 total_minor bigint NOT NULL,
 amount_due_minor bigint NOT NULL,
 amount_paid_minor bigint NOT NULL,
 amount_remaining_minor bigint NOT NULL,
 attempt_count integer NOT NULL,
 due_at timestamptz,
 next_payment_attempt_at timestamptz,
 finalized_at timestamptz,
 paid_at timestamptz,
 voided_at timestamptz,
 marked_uncollectible_at timestamptz,
 payments_complete boolean NOT NULL,
 tax_evidence jsonb NOT NULL,
 ownership_state text NOT NULL,
 ownership_revision bigint DEFAULT 0 NOT NULL,
 ownership_provenance jsonb NOT NULL,
 PRIMARY KEY (stripe_scope,stripe_object_id),
 CHECK (stripe_scope ~ '^acct_[A-Za-z0-9]+:(test|live)$'),
 CHECK (revision > 0),
 CHECK (ownership_state IN ('proven','unresolved','conflict','foreign')),
 CHECK (ownership_revision >= 0),
 CHECK (source_event_id IS NULL OR source_event_id ~ '^evt_[A-Za-z0-9]+$'),
 CHECK (length(stripe_api_version)>0),
 CHECK (normalizer_version>0),
 CHECK (revision>0),
 CHECK (stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
 CHECK (length(status)>0),
 CHECK (currency ~ '^[a-z]{3}$'),
 CHECK (discount_minor>=0),
 CHECK (amount_due_minor>=0),
 CHECK (amount_paid_minor>=0),
 CHECK (amount_remaining_minor>=0),
 CHECK (attempt_count>=0),
 CHECK (stripe_object_id ~ '^in_[A-Za-z0-9]+$'),
 CHECK ((billing_v2.valid_document('invoice_tax',tax_evidence)) IS TRUE),
 CHECK ((billing_v2.valid_document('invoice_provenance',ownership_provenance)) IS TRUE),
 CHECK (tax_evidence->>'status'<>'verified' OR ((tax_evidence->>'grossMinor')::bigint=total_minor AND (tax_evidence->>'taxMinor')::bigint IS NOT DISTINCT FROM tax_minor AND finalized_at IS NOT NULL AND status IN ('open','paid','uncollectible','void')))
);
CREATE TABLE billing_v2.payments (
 stripe_scope text NOT NULL,
 stripe_object_id text NOT NULL,
 stripe_created_at timestamptz NOT NULL,
 source_event_id text,
 source_event_created_at timestamptz,
 stripe_api_version text NOT NULL,
 normalizer_version integer NOT NULL,
 revision bigint DEFAULT 1 NOT NULL,
 verified_at timestamptz NOT NULL,
 created_at timestamptz DEFAULT clock_timestamp() NOT NULL,
 updated_at timestamptz DEFAULT clock_timestamp() NOT NULL,
 stripe_customer_id text NOT NULL,
 stripe_payment_intent_id text,
 currency text NOT NULL,
 status text NOT NULL,
 amount_minor bigint NOT NULL,
 amount_captured_minor bigint NOT NULL,
 amount_refunded_minor bigint NOT NULL,
 paid boolean NOT NULL,
 captured boolean NOT NULL,
 collected_at timestamptz,
 collection_time_basis text NOT NULL,
 attribution_status text NOT NULL,
 PRIMARY KEY (stripe_scope,stripe_object_id),
 CHECK (stripe_scope ~ '^acct_[A-Za-z0-9]+:(test|live)$'),
 CHECK (revision > 0),
 CHECK (collection_time_basis IN ('verified_event','invoice_payment','automatic_capture_created','unknown')),
 CHECK (attribution_status IN ('verified','unresolved','mixed')),
 CHECK (source_event_id IS NULL OR source_event_id ~ '^evt_[A-Za-z0-9]+$'),
 CHECK (length(stripe_api_version)>0),
 CHECK (normalizer_version>0),
 CHECK (revision>0),
 CHECK (stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
 CHECK (stripe_payment_intent_id IS NULL OR stripe_payment_intent_id ~ '^pi_[A-Za-z0-9]+$'),
 CHECK (currency ~ '^[a-z]{3}$'),
 CHECK (length(status)>0),
 CHECK (amount_minor>=0),
 CHECK (amount_captured_minor>=0),
 CHECK (amount_refunded_minor>=0),
 CHECK (amount_captured_minor<=amount_minor),
 CHECK (amount_refunded_minor<=amount_captured_minor),
 CHECK ((collected_at IS NULL) = (collection_time_basis='unknown')),
 CHECK (stripe_object_id ~ '^ch_[A-Za-z0-9]+$')
);
CREATE TABLE billing_v2.invoice_payments (
 stripe_scope text NOT NULL,
 stripe_object_id text NOT NULL,
 stripe_created_at timestamptz NOT NULL,
 source_event_id text,
 source_event_created_at timestamptz,
 stripe_api_version text NOT NULL,
 normalizer_version integer NOT NULL,
 revision bigint DEFAULT 1 NOT NULL,
 verified_at timestamptz NOT NULL,
 created_at timestamptz DEFAULT clock_timestamp() NOT NULL,
 updated_at timestamptz DEFAULT clock_timestamp() NOT NULL,
 stripe_invoice_id text NOT NULL,
 stripe_payment_intent_id text,
 stripe_charge_id text,
 payment_type text NOT NULL,
 currency text NOT NULL,
 status text NOT NULL,
 amount_requested_minor bigint NOT NULL,
 amount_paid_minor bigint,
 paid_at timestamptz,
 canceled_at timestamptz,
 PRIMARY KEY (stripe_scope,stripe_object_id),
 CHECK (stripe_scope ~ '^acct_[A-Za-z0-9]+:(test|live)$'),
 CHECK (revision > 0),
 CHECK (source_event_id IS NULL OR source_event_id ~ '^evt_[A-Za-z0-9]+$'),
 CHECK (length(stripe_api_version)>0),
 CHECK (normalizer_version>0),
 CHECK (revision>0),
 CHECK (currency ~ '^[a-z]{3}$'),
 CHECK (length(status)>0),
 CHECK (amount_requested_minor>=0),
 CHECK (amount_paid_minor>=0),
 CHECK (stripe_object_id ~ '^inpay_[A-Za-z0-9]+$')
);
CREATE TABLE billing_v2.refunds (
 stripe_scope text NOT NULL,
 stripe_object_id text NOT NULL,
 stripe_created_at timestamptz NOT NULL,
 source_event_id text,
 source_event_created_at timestamptz,
 stripe_api_version text NOT NULL,
 normalizer_version integer NOT NULL,
 revision bigint DEFAULT 1 NOT NULL,
 verified_at timestamptz NOT NULL,
 created_at timestamptz DEFAULT clock_timestamp() NOT NULL,
 updated_at timestamptz DEFAULT clock_timestamp() NOT NULL,
 stripe_charge_id text NOT NULL,
 stripe_payment_intent_id text,
 currency text NOT NULL,
 amount_minor bigint NOT NULL,
 status text NOT NULL,
 reason text,
 failure_reason text,
 succeeded_at timestamptz,
 success_time_basis text NOT NULL,
 PRIMARY KEY (stripe_scope,stripe_object_id),
 CHECK (stripe_scope ~ '^acct_[A-Za-z0-9]+:(test|live)$'),
 CHECK (revision > 0),
 CHECK (success_time_basis IN ('verified_event','unknown')),
 CHECK (source_event_id IS NULL OR source_event_id ~ '^evt_[A-Za-z0-9]+$'),
 CHECK (length(stripe_api_version)>0),
 CHECK (normalizer_version>0),
 CHECK (revision>0),
 CHECK (currency ~ '^[a-z]{3}$'),
 CHECK (amount_minor>=0),
 CHECK (length(status)>0),
 CHECK ((succeeded_at IS NULL) = (success_time_basis='unknown')),
 CHECK (stripe_object_id ~ '^re_[A-Za-z0-9]+$')
);
CREATE TABLE billing_v2.payment_attempts (
 stripe_scope text NOT NULL,
 attempt_key text NOT NULL,
 stripe_customer_id text NOT NULL,
 stripe_invoice_id text,
 stripe_payment_intent_id text,
 stripe_charge_id text,
 currency text,
 amount_minor bigint,
 occurred_at timestamptz NOT NULL,
 failure_code text,
 evidence_type text NOT NULL,
 source_event_id text,
 stripe_api_version text NOT NULL,
 normalizer_version integer NOT NULL,
 verified_at timestamptz NOT NULL,
 created_at timestamptz DEFAULT clock_timestamp() NOT NULL,
 updated_at timestamptz DEFAULT clock_timestamp() NOT NULL,
 PRIMARY KEY (stripe_scope,attempt_key),
 CHECK (stripe_scope ~ '^acct_[A-Za-z0-9]+:(test|live)$'),
 CHECK (stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
 CHECK (currency ~ '^[a-z]{3}$'),
 CHECK (amount_minor>=0),
 CHECK (evidence_type='failed_charge'),
 CHECK (normalizer_version>0),
 CHECK (attempt_key='charge:'||stripe_charge_id AND stripe_charge_id IS NOT NULL)
);
CREATE TABLE billing_v2.finance_activity (
 stripe_scope text NOT NULL,
 activity_key text NOT NULL,
 kind text NOT NULL,
 stripe_customer_id text NOT NULL,
 stripe_subscription_id text,
 object_type text NOT NULL,
 object_id text NOT NULL,
 occurred_at timestamptz NOT NULL,
 amount_minor bigint,
 currency text,
 effective_at timestamptz,
 source_event_id text,
 origin text NOT NULL,
 source_revision bigint,
 created_at timestamptz DEFAULT clock_timestamp() NOT NULL,
 updated_at timestamptz DEFAULT clock_timestamp() NOT NULL,
 PRIMARY KEY (stripe_scope,activity_key),
 CHECK (stripe_scope ~ '^acct_[A-Za-z0-9]+:(test|live)$'),
 CHECK (kind IN ('subscription_created','cancellation_scheduled','cancellation_reversed','subscription_ended','invoice_paid','payment_failed','refund_issued')),
 CHECK (origin IN ('webhook','backfill','reconciliation')),
 CHECK (amount_minor>=0),
 CHECK (currency ~ '^[a-z]{3}$'),
 CHECK (source_revision>=0),
 CHECK ((amount_minor IS NULL)=(currency IS NULL))
);
CREATE UNIQUE INDEX v2_accounts_i1 ON billing_v2.accounts (stripe_scope,stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
CREATE UNIQUE INDEX v2_accounts_i2 ON billing_v2.accounts (stripe_scope,principal_kind,principal_id) WHERE binding_state='verified';
CREATE INDEX v2_accounts_i3 ON billing_v2.accounts (stripe_scope,principal_kind,principal_id);
ALTER TABLE billing_v2.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_v2.accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_only ON billing_v2.accounts TO billing_v2_owner USING (true) WITH CHECK (true);
REVOKE ALL ON billing_v2.accounts FROM PUBLIC,anon,authenticated,service_role,billing_v2_executor;
ALTER TABLE billing_v2.checkout_attempts ADD CONSTRAINT checkout_attempts_fk0 FOREIGN KEY (stripe_scope,billing_account_id) REFERENCES billing_v2.accounts(stripe_scope,id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
CREATE UNIQUE INDEX v2_checkout_attempts_i1 ON billing_v2.checkout_attempts (stripe_scope,idempotency_key);
CREATE UNIQUE INDEX v2_checkout_attempts_i2 ON billing_v2.checkout_attempts (stripe_scope,billing_account_id,operation_kind) WHERE status IN ('prepared','in_flight','ambiguous');
CREATE INDEX v2_checkout_attempts_i3 ON billing_v2.checkout_attempts (stripe_scope,billing_account_id,created_at DESC);
ALTER TABLE billing_v2.checkout_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_v2.checkout_attempts FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_only ON billing_v2.checkout_attempts TO billing_v2_owner USING (true) WITH CHECK (true);
REVOKE ALL ON billing_v2.checkout_attempts FROM PUBLIC,anon,authenticated,service_role,billing_v2_executor;
CREATE INDEX v2_price_catalog_i1 ON billing_v2.price_catalog (stripe_scope,application_key,ownership_state);
ALTER TABLE billing_v2.price_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_v2.price_catalog FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_only ON billing_v2.price_catalog TO billing_v2_owner USING (true) WITH CHECK (true);
REVOKE ALL ON billing_v2.price_catalog FROM PUBLIC,anon,authenticated,service_role,billing_v2_executor;
ALTER TABLE billing_v2.subscriptions ADD CONSTRAINT subscriptions_fk0 FOREIGN KEY (stripe_scope,billing_account_id) REFERENCES billing_v2.accounts(stripe_scope,id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
CREATE UNIQUE INDEX v2_subscriptions_i1 ON billing_v2.subscriptions (stripe_scope,billing_account_id) WHERE plan='pro' AND status IN ('active','trialing') AND NOT terminal;
CREATE INDEX v2_subscriptions_i2 ON billing_v2.subscriptions (stripe_scope,billing_account_id);
CREATE INDEX v2_subscriptions_i3 ON billing_v2.subscriptions (stripe_scope,verified_at);
ALTER TABLE billing_v2.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_v2.subscriptions FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_only ON billing_v2.subscriptions TO billing_v2_owner USING (true) WITH CHECK (true);
REVOKE ALL ON billing_v2.subscriptions FROM PUBLIC,anon,authenticated,service_role,billing_v2_executor;
ALTER TABLE billing_v2.event_inbox ADD CONSTRAINT event_inbox_fk0 FOREIGN KEY (stripe_scope,billing_account_id) REFERENCES billing_v2.accounts(stripe_scope,id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE billing_v2.event_inbox ADD CONSTRAINT event_inbox_fk1 FOREIGN KEY (stripe_scope,run_id) REFERENCES billing_v2.operations(stripe_scope,id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
CREATE UNIQUE INDEX v2_event_inbox_i1 ON billing_v2.event_inbox (stripe_scope,source_kind,source_id,task_kind);
CREATE INDEX v2_event_inbox_i2 ON billing_v2.event_inbox (stripe_scope,task_kind,available_at,arrival_sequence) WHERE state IN ('queued','retry_wait');
CREATE INDEX v2_event_inbox_i3 ON billing_v2.event_inbox (stripe_scope,lease_until) WHERE state='processing';
CREATE INDEX v2_event_inbox_i4 ON billing_v2.event_inbox (stripe_scope,dependency_kind,dependency_reference,available_at) WHERE state='dependency_wait';
CREATE INDEX v2_event_inbox_i5 ON billing_v2.event_inbox (stripe_scope,billing_account_id,task_kind,available_at) WHERE state IN ('queued','retry_wait');
CREATE INDEX v2_event_inbox_i6 ON billing_v2.event_inbox (stripe_scope,stripe_event_id,task_kind);
CREATE INDEX v2_event_inbox_i7 ON billing_v2.event_inbox (stripe_scope,run_id);
ALTER TABLE billing_v2.event_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_v2.event_inbox FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_only ON billing_v2.event_inbox TO billing_v2_owner USING (true) WITH CHECK (true);
REVOKE ALL ON billing_v2.event_inbox FROM PUBLIC,anon,authenticated,service_role,billing_v2_executor;
ALTER TABLE billing_v2.authority ADD CONSTRAINT authority_fk0 FOREIGN KEY (stripe_scope,billing_account_id) REFERENCES billing_v2.accounts(stripe_scope,id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE billing_v2.authority ADD CONSTRAINT authority_fk1 FOREIGN KEY (stripe_scope,inbox_task_id) REFERENCES billing_v2.event_inbox(stripe_scope,id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE billing_v2.authority ADD CONSTRAINT authority_fk2 FOREIGN KEY (stripe_scope,checkout_attempt_id) REFERENCES billing_v2.checkout_attempts(stripe_scope,id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE billing_v2.authority ADD CONSTRAINT authority_fk3 FOREIGN KEY (stripe_scope,last_completed_operation_id) REFERENCES billing_v2.operations(stripe_scope,id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX v2_authority_i1 ON billing_v2.authority (stripe_scope,billing_account_id,domain);
CREATE INDEX v2_authority_i2 ON billing_v2.authority (stripe_scope,inbox_task_id);
CREATE INDEX v2_authority_i3 ON billing_v2.authority (stripe_scope,checkout_attempt_id);
CREATE INDEX v2_authority_i4 ON billing_v2.authority (stripe_scope,last_completed_operation_id);
ALTER TABLE billing_v2.authority ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_v2.authority FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_only ON billing_v2.authority TO billing_v2_owner USING (true) WITH CHECK (true);
REVOKE ALL ON billing_v2.authority FROM PUBLIC,anon,authenticated,service_role,billing_v2_executor;
ALTER TABLE billing_v2.operations ADD CONSTRAINT operations_fk0 FOREIGN KEY (stripe_scope,billing_account_id) REFERENCES billing_v2.accounts(stripe_scope,id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE billing_v2.operations ADD CONSTRAINT operations_fk1 FOREIGN KEY (stripe_scope,parent_run_id) REFERENCES billing_v2.operations(stripe_scope,id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE billing_v2.operations ADD CONSTRAINT operations_fk2 FOREIGN KEY (stripe_scope,task_id) REFERENCES billing_v2.event_inbox(stripe_scope,id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
CREATE UNIQUE INDEX v2_operations_i1 ON billing_v2.operations (stripe_scope,operation_kind,source_kind,source_id,record_type);
CREATE INDEX v2_operations_i2 ON billing_v2.operations (stripe_scope,record_type,operation_kind,created_at DESC);
CREATE INDEX v2_operations_i3 ON billing_v2.operations (stripe_scope,task_id);
CREATE INDEX v2_operations_i4 ON billing_v2.operations (stripe_scope,parent_run_id);
CREATE INDEX v2_operations_i5 ON billing_v2.operations (stripe_scope,billing_account_id);
CREATE UNIQUE INDEX v2_operations_one_completion ON billing_v2.operations (stripe_scope,task_id) WHERE record_type='audit' AND task_id IS NOT NULL AND outcome IN ('processed','ignored','unchanged','stale_ignored','terminal_ignored');
ALTER TABLE billing_v2.operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_v2.operations FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_only ON billing_v2.operations TO billing_v2_owner USING (true) WITH CHECK (true);
REVOKE ALL ON billing_v2.operations FROM PUBLIC,anon,authenticated,service_role,billing_v2_executor;
CREATE INDEX v2_finance_subscriptions_i1 ON billing_v2.finance_subscriptions (stripe_scope,stripe_customer_id);
CREATE INDEX v2_finance_subscriptions_i2 ON billing_v2.finance_subscriptions (stripe_scope,status);
CREATE INDEX v2_finance_subscriptions_i3 ON billing_v2.finance_subscriptions (stripe_scope,verified_at);
ALTER TABLE billing_v2.finance_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_v2.finance_subscriptions FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_only ON billing_v2.finance_subscriptions TO billing_v2_owner USING (true) WITH CHECK (true);
REVOKE ALL ON billing_v2.finance_subscriptions FROM PUBLIC,anon,authenticated,service_role,billing_v2_executor;
ALTER TABLE billing_v2.finance_subscription_items ADD CONSTRAINT finance_subscription_items_fk0 FOREIGN KEY (stripe_scope,stripe_subscription_id) REFERENCES billing_v2.finance_subscriptions(stripe_scope,stripe_object_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX v2_finance_subscription_items_i1 ON billing_v2.finance_subscription_items (stripe_scope,stripe_subscription_id);
CREATE INDEX v2_finance_subscription_items_i2 ON billing_v2.finance_subscription_items (stripe_scope,period_end);
ALTER TABLE billing_v2.finance_subscription_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_v2.finance_subscription_items FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_only ON billing_v2.finance_subscription_items TO billing_v2_owner USING (true) WITH CHECK (true);
REVOKE ALL ON billing_v2.finance_subscription_items FROM PUBLIC,anon,authenticated,service_role,billing_v2_executor;
ALTER TABLE billing_v2.invoices ADD CONSTRAINT invoices_fk0 FOREIGN KEY (stripe_scope,stripe_subscription_id) REFERENCES billing_v2.finance_subscriptions(stripe_scope,stripe_object_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX v2_invoices_i1 ON billing_v2.invoices (stripe_scope,stripe_customer_id,stripe_created_at DESC);
CREATE INDEX v2_invoices_i2 ON billing_v2.invoices (stripe_scope,stripe_subscription_id);
CREATE INDEX v2_invoices_i3 ON billing_v2.invoices (stripe_scope,status,due_at);
ALTER TABLE billing_v2.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_v2.invoices FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_only ON billing_v2.invoices TO billing_v2_owner USING (true) WITH CHECK (true);
REVOKE ALL ON billing_v2.invoices FROM PUBLIC,anon,authenticated,service_role,billing_v2_executor;
CREATE INDEX v2_payments_i1 ON billing_v2.payments (stripe_scope,stripe_customer_id,collected_at);
CREATE INDEX v2_payments_i2 ON billing_v2.payments (stripe_scope,stripe_payment_intent_id);
ALTER TABLE billing_v2.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_v2.payments FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_only ON billing_v2.payments TO billing_v2_owner USING (true) WITH CHECK (true);
REVOKE ALL ON billing_v2.payments FROM PUBLIC,anon,authenticated,service_role,billing_v2_executor;
ALTER TABLE billing_v2.invoice_payments ADD CONSTRAINT invoice_payments_fk0 FOREIGN KEY (stripe_scope,stripe_invoice_id) REFERENCES billing_v2.invoices(stripe_scope,stripe_object_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE billing_v2.invoice_payments ADD CONSTRAINT invoice_payments_fk1 FOREIGN KEY (stripe_scope,stripe_charge_id) REFERENCES billing_v2.payments(stripe_scope,stripe_object_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX v2_invoice_payments_i1 ON billing_v2.invoice_payments (stripe_scope,stripe_invoice_id);
CREATE INDEX v2_invoice_payments_i2 ON billing_v2.invoice_payments (stripe_scope,stripe_charge_id);
CREATE INDEX v2_invoice_payments_i3 ON billing_v2.invoice_payments (stripe_scope,stripe_payment_intent_id);
ALTER TABLE billing_v2.invoice_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_v2.invoice_payments FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_only ON billing_v2.invoice_payments TO billing_v2_owner USING (true) WITH CHECK (true);
REVOKE ALL ON billing_v2.invoice_payments FROM PUBLIC,anon,authenticated,service_role,billing_v2_executor;
ALTER TABLE billing_v2.refunds ADD CONSTRAINT refunds_fk0 FOREIGN KEY (stripe_scope,stripe_charge_id) REFERENCES billing_v2.payments(stripe_scope,stripe_object_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX v2_refunds_i1 ON billing_v2.refunds (stripe_scope,stripe_charge_id);
CREATE INDEX v2_refunds_i2 ON billing_v2.refunds (stripe_scope,status,stripe_created_at);
ALTER TABLE billing_v2.refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_v2.refunds FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_only ON billing_v2.refunds TO billing_v2_owner USING (true) WITH CHECK (true);
REVOKE ALL ON billing_v2.refunds FROM PUBLIC,anon,authenticated,service_role,billing_v2_executor;
ALTER TABLE billing_v2.payment_attempts ADD CONSTRAINT payment_attempts_fk0 FOREIGN KEY (stripe_scope,stripe_invoice_id) REFERENCES billing_v2.invoices(stripe_scope,stripe_object_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE billing_v2.payment_attempts ADD CONSTRAINT payment_attempts_fk1 FOREIGN KEY (stripe_scope,stripe_charge_id) REFERENCES billing_v2.payments(stripe_scope,stripe_object_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
CREATE UNIQUE INDEX v2_payment_attempts_i1 ON billing_v2.payment_attempts (stripe_scope,stripe_charge_id) WHERE stripe_charge_id IS NOT NULL;
CREATE INDEX v2_payment_attempts_i2 ON billing_v2.payment_attempts (stripe_scope,stripe_invoice_id);
CREATE INDEX v2_payment_attempts_i3 ON billing_v2.payment_attempts (stripe_scope,stripe_charge_id);
CREATE INDEX v2_payment_attempts_i4 ON billing_v2.payment_attempts (stripe_scope,occurred_at);
ALTER TABLE billing_v2.payment_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_v2.payment_attempts FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_only ON billing_v2.payment_attempts TO billing_v2_owner USING (true) WITH CHECK (true);
REVOKE ALL ON billing_v2.payment_attempts FROM PUBLIC,anon,authenticated,service_role,billing_v2_executor;
ALTER TABLE billing_v2.finance_activity ADD CONSTRAINT finance_activity_fk0 FOREIGN KEY (stripe_scope,stripe_subscription_id) REFERENCES billing_v2.finance_subscriptions(stripe_scope,stripe_object_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX v2_finance_activity_i1 ON billing_v2.finance_activity (stripe_scope,stripe_customer_id,occurred_at DESC);
CREATE INDEX v2_finance_activity_i2 ON billing_v2.finance_activity (stripe_scope,stripe_subscription_id);
ALTER TABLE billing_v2.finance_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_v2.finance_activity FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_only ON billing_v2.finance_activity TO billing_v2_owner USING (true) WITH CHECK (true);
REVOKE ALL ON billing_v2.finance_activity FROM PUBLIC,anon,authenticated,service_role,billing_v2_executor;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA billing_v2 FROM PUBLIC,anon,authenticated,service_role,billing_v2_executor;
-- Transfer every foundation object; table transfer also transfers identity sequence/index ownership.
ALTER TABLE billing_v2.accounts OWNER TO billing_v2_owner;
ALTER TABLE billing_v2.checkout_attempts OWNER TO billing_v2_owner;
ALTER TABLE billing_v2.price_catalog OWNER TO billing_v2_owner;
ALTER TABLE billing_v2.subscriptions OWNER TO billing_v2_owner;
ALTER TABLE billing_v2.event_inbox OWNER TO billing_v2_owner;
ALTER TABLE billing_v2.authority OWNER TO billing_v2_owner;
ALTER TABLE billing_v2.operations OWNER TO billing_v2_owner;
ALTER TABLE billing_v2.finance_subscriptions OWNER TO billing_v2_owner;
ALTER TABLE billing_v2.finance_subscription_items OWNER TO billing_v2_owner;
ALTER TABLE billing_v2.invoices OWNER TO billing_v2_owner;
ALTER TABLE billing_v2.payments OWNER TO billing_v2_owner;
ALTER TABLE billing_v2.invoice_payments OWNER TO billing_v2_owner;
ALTER TABLE billing_v2.refunds OWNER TO billing_v2_owner;
ALTER TABLE billing_v2.payment_attempts OWNER TO billing_v2_owner;
ALTER TABLE billing_v2.finance_activity OWNER TO billing_v2_owner;
ALTER FUNCTION billing_v2.valid_tax_evidence(jsonb,boolean) OWNER TO billing_v2_owner;
ALTER FUNCTION billing_v2.valid_document(text,jsonb) OWNER TO billing_v2_owner;
ALTER FUNCTION billing_v2.valid_forecast_anchors(jsonb,text,text,text,text,text,bigint,text,integer,text,timestamptz) OWNER TO billing_v2_owner;
REVOKE billing_v2_owner FROM CURRENT_USER;
DO $installed$
DECLARE memberships jsonb; installer oid; role_oid oid;
BEGIN
 SELECT oid INTO installer FROM pg_roles WHERE rolname=current_user;
 SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.roleid,m.member,m.grantor),'[]'::jsonb)
 INTO memberships FROM pg_auth_members m
 WHERE m.roleid IN ('billing_v2_owner'::regrole,'billing_v2_executor'::regrole);
 IF memberships IS DISTINCT FROM current_setting('billing_v2.install_creator_memberships')::jsonb THEN
  RAISE EXCEPTION 'V2_INSTALLER_MEMBERSHIP' USING ERRCODE='42501';
 END IF;
 -- No indirect runtime path through the trusted installer is permitted either.
 IF EXISTS(WITH RECURSIVE members(member) AS (
  SELECT member FROM pg_auth_members WHERE roleid IN ('billing_v2_owner'::regrole,'billing_v2_executor'::regrole)
  UNION SELECT m.member FROM pg_auth_members m JOIN members p ON p.member=m.roleid
 ) SELECT 1 FROM members WHERE member<>installer) THEN
  RAISE EXCEPTION 'V2_RUNTIME_MEMBERSHIP' USING ERRCODE='42501';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN ('billing_v2_owner','billing_v2_executor')
  AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) THEN
  RAISE EXCEPTION 'V2_ROLE_ATTRIBUTES' USING ERRCODE='42501';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='billing_v2' AND nspowner<>'billing_v2_owner'::regrole)
 OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='billing_v2' AND c.relowner<>'billing_v2_owner'::regrole)
 OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='billing_v2' AND p.proowner<>'billing_v2_owner'::regrole) THEN
  RAISE EXCEPTION 'V2_OBJECT_OWNER' USING ERRCODE='42501';
 END IF;
 IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='billing_v2' AND c.relkind='r' AND c.relrowsecurity AND c.relforcerowsecurity)<>15 THEN
  RAISE EXCEPTION 'V2_RLS_REQUIRED' USING ERRCODE='42501';
 END IF;
 -- Reject direct ACLs, including inherited installer default privileges and PUBLIC.
 IF EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a
  WHERE n.nspname='billing_v2' AND a.grantee<>n.nspowner)
 OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 's'::"char" ELSE 'r'::"char" END,c.relowner))) a
  WHERE n.nspname='billing_v2' AND c.relkind IN ('r','S') AND a.grantee<>c.relowner)
 OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
  WHERE n.nspname='billing_v2' AND a.grantee<>p.proowner) THEN
  RAISE EXCEPTION 'V2_UNEXPECTED_ACL' USING ERRCODE='42501';
 END IF;
 FOREACH role_oid IN ARRAY ARRAY['anon'::regrole::oid,'authenticated'::regrole::oid,'service_role'::regrole::oid,'billing_v2_executor'::regrole::oid] LOOP
  IF has_schema_privilege(role_oid,'billing_v2','USAGE') OR has_schema_privilege(role_oid,'billing_v2','CREATE') THEN
   RAISE EXCEPTION 'V2_RUNTIME_ACCESS' USING ERRCODE='42501';
  END IF;
 END LOOP;
END $installed$;
COMMIT;
