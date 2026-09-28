-- PREPARED ONLY. No hosted execution, price approval or customer mapping is seeded.
-- One transaction: missing foundation objects are created; conflicting objects fail.
-- Temporary reference tables/functions exist only for catalog validation.
BEGIN;
CREATE TEMP TABLE foundation_expected_subscriptions (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL,
 profile_id uuid,
 stripe_customer_id text NOT NULL,
 stripe_subscription_id text NOT NULL,
 stripe_subscription_status text NOT NULL DEFAULT 'unknown',
 stripe_price_id text,
 dmi_plan text NOT NULL DEFAULT 'free',
 current_period_end timestamptz,
 cancel_at_period_end boolean NOT NULL DEFAULT false,
 latest_invoice_id text,
 checkout_session_id text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 stripe_scope text,
 revision bigint NOT NULL DEFAULT 0,
 last_event_created bigint,
 last_event_id text,
 verified_at timestamptz,
 current_period_start timestamptz,
 trial_end timestamptz,
 ended_at timestamptz,
 terminal boolean NOT NULL DEFAULT false,
 sync_snapshot jsonb
) ON COMMIT DROP;
CREATE TEMP TABLE foundation_expected_webhooks (
stripe_event_id text PRIMARY KEY,
 event_type text NOT NULL,
 processed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 state text NOT NULL DEFAULT 'received' CHECK (state IN ('received','processing','processed','failed')),
 stripe_scope text,
 event_created bigint,
 subject_id text,
 attempts integer NOT NULL DEFAULT 0,
 lease_token uuid,
 lease_until timestamptz,
 last_attempt_at timestamptz,
 outcome text,
 last_error_code text
) ON COMMIT DROP;
CREATE TEMP TABLE foundation_expected_billing_accounts (
 stripe_scope text NOT NULL,
 user_id uuid NOT NULL,
 stripe_customer_id text,
 verified_at timestamptz,
 lease_token uuid,
 lease_until timestamptz,
 generation bigint NOT NULL DEFAULT 0,
 customer_attempt uuid,
 customer_attempt_at timestamptz,
 customer_parameters jsonb,
 checkout_attempt uuid,
 checkout_attempt_at timestamptz,
 checkout_parameters jsonb,
 checkout_session_id text,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(stripe_scope,user_id),
 UNIQUE(stripe_scope,stripe_customer_id)
) ON COMMIT DROP;
CREATE TEMP TABLE foundation_expected_billing_approved_prices (
 stripe_scope text NOT NULL,
 stripe_price_id text NOT NULL,
 plan text NOT NULL DEFAULT 'pro' CHECK(plan='pro'),
 entitlement_enabled boolean NOT NULL DEFAULT true,
 checkout_enabled boolean NOT NULL DEFAULT false,
 approved_at timestamptz NOT NULL DEFAULT now(),
 approved_by text NOT NULL,
 approval_reason text NOT NULL,
 PRIMARY KEY(stripe_scope,stripe_price_id)
) ON COMMIT DROP;
CREATE TEMP TABLE foundation_expected_billing_sync_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 stripe_scope text NOT NULL,
 user_id uuid,
 subscription_id text,
 trigger text NOT NULL,
 actor text NOT NULL,
 mode text NOT NULL CHECK(mode IN ('dry_run','repair')),
 outcome text NOT NULL,
 before_revision bigint,
 after_revision bigint,
 error_code text,
 created_at timestamptz NOT NULL DEFAULT now()
) ON COMMIT DROP;

DO $schema$
DECLARE target text; expected regclass; actual regclass; col record; con record;
 definition text; baseline text[]; legacy_webhooks boolean;
BEGIN
 IF to_regclass('public.billing_subscriptions') IS NULL THEN
  RAISE EXCEPTION 'BILLING_SCHEMA_DRIFT: required billing_subscriptions baseline is absent';
 END IF;
 legacy_webhooks := to_regclass('public.stripe_webhook_events') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.stripe_webhook_events') AND attname='state' AND NOT attisdropped);
 -- The minimum historical webhook table may legitimately be absent in staging.
 CREATE TABLE IF NOT EXISTS public.stripe_webhook_events (
stripe_event_id text PRIMARY KEY,
 event_type text NOT NULL,
 processed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
 );
 CREATE TABLE IF NOT EXISTS public.billing_accounts (
 stripe_scope text NOT NULL,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 stripe_customer_id text,
 verified_at timestamptz,
 lease_token uuid,
 lease_until timestamptz,
 generation bigint NOT NULL DEFAULT 0,
 customer_attempt uuid,
 customer_attempt_at timestamptz,
 customer_parameters jsonb,
 checkout_attempt uuid,
 checkout_attempt_at timestamptz,
 checkout_parameters jsonb,
 checkout_session_id text,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(stripe_scope,user_id),
 UNIQUE(stripe_scope,stripe_customer_id)
 );
 CREATE TABLE IF NOT EXISTS public.billing_approved_prices (
 stripe_scope text NOT NULL,
 stripe_price_id text NOT NULL,
 plan text NOT NULL DEFAULT 'pro' CHECK(plan='pro'),
 entitlement_enabled boolean NOT NULL DEFAULT true,
 checkout_enabled boolean NOT NULL DEFAULT false,
 approved_at timestamptz NOT NULL DEFAULT now(),
 approved_by text NOT NULL,
 approval_reason text NOT NULL,
 PRIMARY KEY(stripe_scope,stripe_price_id)
 );
 CREATE TABLE IF NOT EXISTS public.billing_sync_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 stripe_scope text NOT NULL,
 user_id uuid,
 subscription_id text,
 trigger text NOT NULL,
 actor text NOT NULL,
 mode text NOT NULL CHECK(mode IN ('dry_run','repair')),
 outcome text NOT NULL,
 before_revision bigint,
 after_revision bigint,
 error_code text,
 created_at timestamptz NOT NULL DEFAULT now()
 );

 FOR target, expected IN SELECT * FROM (VALUES
  ('billing_subscriptions', 'pg_temp.foundation_expected_subscriptions'::regclass),
  ('stripe_webhook_events', 'pg_temp.foundation_expected_webhooks'::regclass),
  ('billing_accounts', 'pg_temp.foundation_expected_billing_accounts'::regclass),
  ('billing_approved_prices', 'pg_temp.foundation_expected_billing_approved_prices'::regclass),
  ('billing_sync_runs', 'pg_temp.foundation_expected_billing_sync_runs'::regclass)
 ) AS objects(name, reference) LOOP
  actual := to_regclass('public.' || target);
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid=actual AND relkind='r' AND NOT relispartition) THEN
   RAISE EXCEPTION 'BILLING_SCHEMA_DRIFT: % must be an ordinary table', target;
  END IF;
  baseline := CASE target
   WHEN 'billing_subscriptions' THEN ARRAY['id','user_id','profile_id','stripe_customer_id','stripe_subscription_id','stripe_subscription_status','stripe_price_id','dmi_plan','current_period_end','cancel_at_period_end','latest_invoice_id','checkout_session_id','created_at','updated_at']
   WHEN 'stripe_webhook_events' THEN ARRAY['stripe_event_id','event_type','processed_at','created_at']
   ELSE NULL END;
  FOR col IN SELECT a.attname, a.atttypid, a.atttypmod, a.attnotnull,
    pg_get_expr(d.adbin,d.adrelid) AS default_expr
   FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
   WHERE a.attrelid=expected AND a.attnum>0 AND NOT a.attisdropped LOOP
   IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid=actual AND attname=col.attname AND NOT attisdropped) THEN
    IF baseline IS NULL OR col.attname=ANY(baseline) THEN
     RAISE EXCEPTION 'BILLING_SCHEMA_DRIFT: %.% is missing', target,col.attname;
    END IF;
    -- Only known additive subscription/webhook columns may be filled in.
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN %I %s%s%s',target,col.attname,
     format_type(col.atttypid,col.atttypmod),
     CASE WHEN col.default_expr IS NULL THEN '' ELSE ' DEFAULT '||col.default_expr END,
     CASE WHEN col.attnotnull THEN ' NOT NULL' ELSE '' END);
   END IF;
   IF NOT EXISTS (
    SELECT 1 FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE a.attrelid=actual AND a.attname=col.attname AND NOT a.attisdropped
     AND a.atttypid=col.atttypid AND a.atttypmod=col.atttypmod AND a.attnotnull=col.attnotnull
     AND a.attidentity='' AND a.attgenerated=''
     AND pg_get_expr(d.adbin,d.adrelid) IS NOT DISTINCT FROM col.default_expr
   ) THEN RAISE EXCEPTION 'BILLING_SCHEMA_DRIFT: incompatible type/nullability/default for %.%',target,col.attname; END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=actual AND a.attnum>0 AND NOT a.attisdropped
   AND NOT EXISTS (SELECT 1 FROM pg_attribute e WHERE e.attrelid=expected AND e.attname=a.attname AND NOT e.attisdropped)) THEN
   RAISE EXCEPTION 'BILLING_SCHEMA_DRIFT: unexpected columns in %',target;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE oid=actual AND relowner IN ('anon'::regrole,'authenticated'::regrole,'service_role'::regrole)) THEN
   RAISE EXCEPTION 'BILLING_SCHEMA_DRIFT: runtime role owns %',target;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid=actual AND NOT tgisinternal)
   OR EXISTS (SELECT 1 FROM pg_rewrite WHERE ev_class=actual) THEN
   RAISE EXCEPTION 'BILLING_SCHEMA_DRIFT: unreviewed trigger/rule on %',target;
  END IF;
  IF target<>'billing_subscriptions' THEN
   -- Compare constraint semantics, independent of generated constraint names.
   FOR con IN SELECT pg_get_constraintdef(oid) AS def,contype FROM pg_constraint WHERE conrelid=expected LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=actual AND convalidated AND NOT condeferrable AND pg_get_constraintdef(oid)=con.def) THEN
     IF target='stripe_webhook_events' AND con.contype='c'
      AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=actual AND contype='c') THEN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT stripe_webhook_events_state_check %s',target,con.def);
     ELSE RAISE EXCEPTION 'BILLING_SCHEMA_DRIFT: missing/incompatible constraint on %: %',target,con.def; END IF;
    END IF;
   END LOOP;
   IF EXISTS (SELECT 1 FROM pg_constraint a WHERE a.conrelid=actual AND NOT EXISTS
    (SELECT 1 FROM pg_constraint e WHERE e.conrelid=expected AND pg_get_constraintdef(e.oid)=pg_get_constraintdef(a.oid))
    AND NOT (target='billing_accounts' AND a.contype='f' AND a.convalidated AND NOT a.condeferrable
     AND pg_get_constraintdef(a.oid)='FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE RESTRICT')) THEN
    RAISE EXCEPTION 'BILLING_SCHEMA_DRIFT: unexpected constraint on %',target;
   END IF;
   IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid=actual) THEN
    RAISE EXCEPTION 'BILLING_SCHEMA_DRIFT: unexpected policy on server-only table %',target;
   END IF;
   IF EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid=actual AND i.indisunique
    AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid=i.indexrelid)) THEN
    RAISE EXCEPTION 'BILLING_SCHEMA_DRIFT: unexpected unique index on %',target;
   END IF;
   IF EXISTS (SELECT 1 FROM pg_index WHERE indrelid=actual AND (NOT indisvalid OR NOT indisready)) THEN
    RAISE EXCEPTION 'BILLING_SCHEMA_DRIFT: invalid index on %',target;
   END IF;
   IF target='billing_accounts' AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=actual
    AND contype='f' AND convalidated AND NOT condeferrable
    AND pg_get_constraintdef(oid)='FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE RESTRICT') THEN
    RAISE EXCEPTION 'BILLING_SCHEMA_DRIFT: billing_accounts auth user foreign key';
   END IF;
  END IF;
 END LOOP;
 -- Existing subscription identity/read behavior must be present, never replaced.
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.billing_subscriptions'::regclass
  AND contype='p' AND pg_get_constraintdef(oid)='PRIMARY KEY (id)' AND NOT condeferrable) THEN
  RAISE EXCEPTION 'BILLING_SCHEMA_DRIFT: subscription primary key';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attname='stripe_subscription_id'
  WHERE i.indrelid='public.billing_subscriptions'::regclass AND i.indisunique AND i.indisvalid AND i.indisready AND i.indimmediate
   AND i.indpred IS NULL AND i.indexprs IS NULL AND i.indnkeyatts=1 AND i.indkey[0]=a.attnum) THEN
  RAISE EXCEPTION 'BILLING_SCHEMA_DRIFT: unique stripe_subscription_id index required';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid='public.billing_subscriptions'::regclass AND relrowsecurity)
  OR NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.billing_subscriptions'::regclass
   AND polname='Users can read own billing subscription' AND polcmd='r' AND polpermissive
   AND polroles=ARRAY['authenticated'::regrole::oid]
   AND regexp_replace(pg_get_expr(polqual,polrelid),'[[:space:]()]','','g')='auth.uid=user_idORauth.uid=profile_id')
  OR EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.billing_subscriptions'::regclass AND polcmd<>'r') THEN
  RAISE EXCEPTION 'BILLING_SCHEMA_DRIFT: subscription owner-read/security policy requires review';
 END IF;
 -- Validate existing CHECK constraints accept the writer's statuses and Pro plan.
 -- This inserts synthetic values into a TEMP table only, never into public data.
 CREATE TEMP TABLE foundation_subscription_checks (LIKE public.billing_subscriptions INCLUDING DEFAULTS INCLUDING CONSTRAINTS) ON COMMIT DROP;
 BEGIN
  INSERT INTO foundation_subscription_checks(user_id,stripe_customer_id,stripe_subscription_id,stripe_subscription_status,dmi_plan)
   SELECT '00000000-0000-4000-8000-000000000001'::uuid,'cus_fixture','sub_fixture',status,plan
   FROM unnest(ARRAY['active','trialing','past_due','unpaid','canceled','incomplete','incomplete_expired','paused','unknown']) status
   CROSS JOIN unnest(ARRAY['free','pro']) plan;
 EXCEPTION WHEN check_violation THEN RAISE EXCEPTION 'BILLING_SCHEMA_DRIFT: subscription CHECK constraint rejects writer status/plan'; END;
 -- Only the old four-column webhook baseline needs historical backfill.
 -- Reruns must not relabel processed events or overwrite diagnostic outcomes.
 IF legacy_webhooks THEN
  UPDATE public.stripe_webhook_events SET state='processed',outcome='legacy_processed'
   WHERE processed_at IS NOT NULL AND state='received' AND attempts=0 AND outcome IS NULL;
 END IF;
END;
$schema$;

-- Build the expected RPC privately; reject a conflicting pre-existing body/signature.
CREATE FUNCTION pg_temp.billing_foundation_command(p_action text,p_scope text,p_user uuid DEFAULT NULL,p_token uuid DEFAULT NULL,p_input jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE a public.billing_accounts%rowtype; e public.stripe_webhook_events%rowtype;
 b public.billing_subscriptions%rowtype; stamp timestamptz:=clock_timestamp(); s jsonb; changed boolean; v_outcome text; n bigint;
BEGIN
 IF p_scope IS NULL OR p_scope !~ '^acct_[A-Za-z0-9]+:(test|live)$' THEN RAISE EXCEPTION 'BILLING_SCOPE'; END IF;
 IF p_action='event_claim' THEN
  INSERT INTO public.stripe_webhook_events(stripe_event_id,event_type,stripe_scope,event_created,subject_id)
   VALUES(p_input->>'id',p_input->>'type',p_scope,(p_input->>'created')::bigint,p_input->>'subject') ON CONFLICT DO NOTHING;
  SELECT * INTO e FROM public.stripe_webhook_events WHERE stripe_event_id=p_input->>'id' FOR UPDATE;
  IF e.stripe_scope IS NOT NULL AND e.stripe_scope<>p_scope THEN RAISE EXCEPTION 'BILLING_SCOPE'; END IF;
  IF e.state='processed' THEN RETURN jsonb_build_object('duplicate',true); END IF;
  IF e.state='processing' AND e.lease_until>stamp THEN RAISE EXCEPTION 'BILLING_BUSY'; END IF;
  UPDATE public.stripe_webhook_events SET state='processing',stripe_scope=p_scope,event_created=(p_input->>'created')::bigint,
   lease_token=gen_random_uuid(),lease_until=stamp+interval '90 seconds',attempts=attempts+1,last_attempt_at=stamp,last_error_code=NULL
   WHERE stripe_event_id=e.stripe_event_id RETURNING * INTO e;
  RETURN jsonb_build_object('token',e.lease_token);
 END IF;
 IF p_action IN ('event_finish','event_fail') THEN
  SELECT * INTO e FROM public.stripe_webhook_events WHERE stripe_event_id=p_input->>'id' FOR UPDATE;
  IF NOT FOUND OR e.stripe_scope<>p_scope OR e.lease_token IS DISTINCT FROM p_token OR e.state<>'processing' OR e.lease_until<=stamp THEN RAISE EXCEPTION 'BILLING_FENCE'; END IF;
  UPDATE public.stripe_webhook_events SET state=CASE WHEN p_action='event_fail' THEN 'failed' ELSE 'processed' END,
   processed_at=CASE WHEN p_action='event_finish' THEN stamp ELSE NULL END,outcome=p_input->>'outcome',last_error_code=p_input->>'error',lease_until=NULL
   WHERE stripe_event_id=e.stripe_event_id;
  RETURN '{}'::jsonb;
 END IF;
 IF p_action='claim' THEN
  INSERT INTO public.billing_accounts(stripe_scope,user_id) VALUES(p_scope,p_user) ON CONFLICT DO NOTHING;
  SELECT * INTO a FROM public.billing_accounts WHERE stripe_scope=p_scope AND user_id=p_user FOR UPDATE;
  IF a.lease_until>stamp THEN RAISE EXCEPTION 'BILLING_BUSY'; END IF;
  UPDATE public.billing_accounts SET lease_token=gen_random_uuid(),lease_until=stamp+interval '90 seconds',generation=generation+1,updated_at=stamp
   WHERE stripe_scope=p_scope AND user_id=p_user RETURNING * INTO a;
  RETURN to_jsonb(a);
 END IF;
 SELECT * INTO a FROM public.billing_accounts WHERE stripe_scope=p_scope AND user_id=p_user FOR UPDATE;
 IF p_action='release' THEN
  UPDATE public.billing_accounts SET lease_until=NULL WHERE stripe_scope=p_scope AND user_id=p_user AND lease_token=p_token;
  RETURN '{}'::jsonb;
 END IF;
 IF NOT FOUND OR a.lease_token IS DISTINCT FROM p_token OR a.lease_until<=stamp THEN RAISE EXCEPTION 'BILLING_FENCE'; END IF;
 IF p_action='touch' THEN
  UPDATE public.billing_accounts SET lease_until=stamp+interval '90 seconds' WHERE stripe_scope=p_scope AND user_id=p_user;
 ELSIF p_action='bind' THEN
  IF a.stripe_customer_id IS NOT NULL AND a.stripe_customer_id<>p_input->>'customer' THEN RAISE EXCEPTION 'BILLING_IDENTITY'; END IF;
  IF EXISTS(SELECT 1 FROM public.billing_subscriptions WHERE stripe_customer_id=p_input->>'customer' AND user_id<>p_user) THEN RAISE EXCEPTION 'BILLING_IDENTITY'; END IF;
  UPDATE public.billing_accounts SET stripe_customer_id=p_input->>'customer',verified_at=stamp,updated_at=stamp WHERE stripe_scope=p_scope AND user_id=p_user;
 ELSIF p_action='customer_prepare' THEN
  IF a.stripe_customer_id IS NOT NULL THEN RAISE EXCEPTION 'BILLING_IDENTITY'; END IF;
  IF a.customer_attempt IS NULL THEN
   UPDATE public.billing_accounts SET customer_attempt=gen_random_uuid(),customer_attempt_at=stamp,customer_parameters=p_input WHERE stripe_scope=p_scope AND user_id=p_user;
  END IF;
 ELSIF p_action='checkout_prepare' THEN
  IF a.stripe_customer_id IS NULL THEN RAISE EXCEPTION 'BILLING_IDENTITY'; END IF;
  IF a.checkout_attempt IS NULL THEN
   UPDATE public.billing_accounts SET checkout_attempt=gen_random_uuid(),checkout_attempt_at=stamp,checkout_parameters=p_input,checkout_session_id=NULL WHERE stripe_scope=p_scope AND user_id=p_user;
  END IF;
 ELSIF p_action='checkout_record' THEN
  IF a.checkout_attempt::text IS DISTINCT FROM p_input->>'attempt' THEN RAISE EXCEPTION 'BILLING_FENCE'; END IF;
  UPDATE public.billing_accounts SET checkout_session_id=p_input->>'session' WHERE stripe_scope=p_scope AND user_id=p_user;
 ELSIF p_action='checkout_clear' THEN
  UPDATE public.billing_accounts SET checkout_attempt=NULL,checkout_attempt_at=NULL,checkout_parameters=NULL,checkout_session_id=NULL WHERE stripe_scope=p_scope AND user_id=p_user;
 ELSIF p_action='commit' THEN
  IF p_input ? 'event_id' THEN
   SELECT * INTO e FROM public.stripe_webhook_events WHERE stripe_event_id=p_input->>'event_id' FOR UPDATE;
   IF NOT FOUND OR e.stripe_scope<>p_scope OR e.state<>'processing' OR e.lease_token::text IS DISTINCT FROM p_input->>'event_token' OR e.lease_until<=stamp THEN RAISE EXCEPTION 'BILLING_FENCE'; END IF;
  END IF;
  s:=p_input->'snapshot';
  SELECT * INTO b FROM public.billing_subscriptions WHERE stripe_subscription_id=s->>'subscription_id' FOR UPDATE;
  IF FOUND AND (b.user_id<>p_user OR b.stripe_customer_id<>a.stripe_customer_id OR (b.stripe_scope IS NOT NULL AND b.stripe_scope<>p_scope)) THEN RAISE EXCEPTION 'BILLING_IDENTITY'; END IF;
  IF coalesce(b.revision,0)<>(p_input->>'expected_revision')::bigint THEN RAISE EXCEPTION 'BILLING_REVISION'; END IF;
  IF a.stripe_customer_id IS DISTINCT FROM s->>'customer_id' THEN RAISE EXCEPTION 'BILLING_IDENTITY'; END IF;
  IF b.last_event_created IS NOT NULL AND (p_input->>'event_created')::bigint<b.last_event_created THEN v_outcome:='stale_ignored';
  ELSIF b.terminal AND NOT (s->>'terminal')::boolean THEN v_outcome:='terminal_ignored';
  ELSE
   IF s->>'plan'='pro' AND NOT EXISTS(SELECT 1 FROM public.billing_approved_prices WHERE stripe_scope=p_scope AND stripe_price_id=s->>'price_id' AND entitlement_enabled) THEN RAISE EXCEPTION 'BILLING_UNKNOWN_PRICE'; END IF;
   changed:=b.id IS NULL OR b.sync_snapshot IS DISTINCT FROM s;
   v_outcome:=CASE WHEN changed THEN 'repaired' ELSE 'unchanged' END;
   INSERT INTO public.billing_subscriptions(user_id,profile_id,stripe_customer_id,stripe_subscription_id,stripe_subscription_status,stripe_price_id,dmi_plan,
    current_period_start,current_period_end,trial_end,ended_at,cancel_at_period_end,latest_invoice_id,stripe_scope,revision,verified_at,terminal,sync_snapshot,last_event_created,last_event_id,updated_at)
   VALUES(p_user,p_user,s->>'customer_id',s->>'subscription_id',s->>'status',s->>'price_id',s->>'plan',
    (s->>'period_start')::timestamptz,(s->>'period_end')::timestamptz,(s->>'trial_end')::timestamptz,(s->>'ended_at')::timestamptz,(s->>'cancel_at_period_end')::boolean,s->>'invoice_id',p_scope,
    coalesce(b.revision,0)+CASE WHEN changed THEN 1 ELSE 0 END,stamp,(s->>'terminal')::boolean,s,
    greatest(b.last_event_created,(p_input->>'event_created')::bigint),coalesce(p_input->>'event_id',b.last_event_id),CASE WHEN changed THEN stamp ELSE b.updated_at END)
   ON CONFLICT(stripe_subscription_id) DO UPDATE SET
    stripe_subscription_status=excluded.stripe_subscription_status,stripe_price_id=excluded.stripe_price_id,dmi_plan=excluded.dmi_plan,
    current_period_start=excluded.current_period_start,current_period_end=excluded.current_period_end,trial_end=excluded.trial_end,ended_at=excluded.ended_at,
    cancel_at_period_end=excluded.cancel_at_period_end,latest_invoice_id=excluded.latest_invoice_id,stripe_scope=excluded.stripe_scope,
    revision=excluded.revision,verified_at=excluded.verified_at,terminal=excluded.terminal,sync_snapshot=excluded.sync_snapshot,
    last_event_created=excluded.last_event_created,last_event_id=excluded.last_event_id,updated_at=excluded.updated_at
    WHERE billing_subscriptions.user_id=p_user AND billing_subscriptions.stripe_customer_id=a.stripe_customer_id
      AND (billing_subscriptions.stripe_scope IS NULL OR billing_subscriptions.stripe_scope=p_scope);
   IF NOT FOUND THEN RAISE EXCEPTION 'BILLING_IDENTITY'; END IF;
  END IF;
  IF p_input ? 'event_id' THEN
   UPDATE public.stripe_webhook_events SET state='processed',processed_at=stamp,outcome=v_outcome,lease_until=NULL WHERE stripe_event_id=e.stripe_event_id;
  END IF;
  SELECT revision INTO n FROM public.billing_subscriptions WHERE stripe_subscription_id=s->>'subscription_id';
  RETURN jsonb_build_object('outcome',v_outcome,'revision',n);
 ELSE RAISE EXCEPTION 'BILLING_COMMAND';
 END IF;
 SELECT * INTO a FROM public.billing_accounts WHERE stripe_scope=p_scope AND user_id=p_user;
 RETURN to_jsonb(a);
END;
$fn$;

DO $rpc$
DECLARE expected text; actual oid;
BEGIN
 expected := regexp_replace(pg_get_functiondef('pg_temp.billing_foundation_command(text,text,uuid,uuid,jsonb)'::regprocedure),
  '^CREATE OR REPLACE FUNCTION [^.]+[.]billing_foundation_command',
  'CREATE OR REPLACE FUNCTION public.billing_foundation_command');
 actual := to_regprocedure('public.billing_foundation_command(text,text,uuid,uuid,jsonb)');
 IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='billing_foundation_command'
  AND (actual IS NULL OR oid<>actual)) THEN RAISE EXCEPTION 'BILLING_SCHEMA_DRIFT: unexpected billing_foundation_command overload'; END IF;
 IF actual IS NOT NULL AND EXISTS (SELECT 1 FROM pg_proc WHERE oid=actual AND proowner IN ('anon'::regrole,'authenticated'::regrole,'service_role'::regrole)) THEN
  RAISE EXCEPTION 'BILLING_SCHEMA_DRIFT: runtime role owns billing_foundation_command';
 END IF;
 IF actual IS NOT NULL AND pg_get_functiondef(actual) IS DISTINCT FROM expected THEN
  RAISE EXCEPTION 'BILLING_SCHEMA_DRIFT: existing billing_foundation_command differs from reviewed implementation';
 END IF;
 IF actual IS NULL THEN EXECUTE expected; END IF;
END;
$rpc$;
DROP FUNCTION pg_temp.billing_foundation_command(text,text,uuid,uuid,jsonb);

ALTER TABLE public.stripe_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_approved_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_sync_runs ENABLE ROW LEVEL SECURITY;
-- Table-level REVOKE does not remove pre-existing column grants. Remove both.
DO $acl$
DECLARE target text; role_name text; columns text;
BEGIN
 FOREACH target IN ARRAY ARRAY['stripe_webhook_events','billing_accounts','billing_approved_prices','billing_sync_runs'] LOOP
  SELECT string_agg(quote_ident(attname),',') INTO columns FROM pg_attribute
   WHERE attrelid=to_regclass('public.'||target) AND attnum>0 AND NOT attisdropped;
  FOREACH role_name IN ARRAY ARRAY['PUBLIC','anon','authenticated','service_role'] LOOP
   EXECUTE format('REVOKE ALL ON public.%I FROM %s',target,role_name);
   EXECUTE format('REVOKE ALL (%s) ON public.%I FROM %s',columns,target,role_name);
  END LOOP;
 END LOOP;
END;
$acl$;
GRANT SELECT ON public.stripe_webhook_events,public.billing_accounts,public.billing_approved_prices TO service_role;
GRANT SELECT,INSERT ON public.billing_sync_runs TO service_role;
REVOKE ALL ON FUNCTION public.billing_foundation_command(text,text,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.billing_foundation_command(text,text,uuid,uuid,jsonb) TO service_role;
-- Check effective privileges as well as direct ACLs (including inherited roles).
DO $verify_acl$
DECLARE target text; role_name text;
BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  FOREACH target IN ARRAY ARRAY['stripe_webhook_events','billing_accounts','billing_approved_prices','billing_sync_runs'] LOOP
   IF has_table_privilege(role_name,'public.'||target,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    OR has_any_column_privilege(role_name,'public.'||target,'SELECT,INSERT,UPDATE,REFERENCES') THEN
    RAISE EXCEPTION 'BILLING_SCHEMA_DRIFT: inherited browser privilege on % for %',target,role_name;
   END IF;
  END LOOP;
  IF has_function_privilege(role_name,'public.billing_foundation_command(text,text,uuid,uuid,jsonb)','EXECUTE') THEN
   RAISE EXCEPTION 'BILLING_SCHEMA_DRIFT: inherited browser RPC access for %',role_name;
  END IF;
 END LOOP;
END;
$verify_acl$;
-- Existing billing_subscriptions owner SELECT policy and grants are unchanged.
COMMIT;
