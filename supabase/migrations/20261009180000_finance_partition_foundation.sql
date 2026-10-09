-- Inactive additive foundation only. Apply only after separate Staging approval.
-- No activation, financial writer, receipt binding, reconciliation or scope backfill.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Inherit the established migration owner; never guess or change ownership.
DO $ownership$
DECLARE expected_owner oid;
BEGIN
 SELECT p.proowner INTO expected_owner FROM pg_catalog.pg_proc p
 WHERE p.oid = pg_catalog.to_regprocedure('public.billing_finance_command(text,text,uuid,jsonb)');
 IF expected_owner IS NULL OR expected_owner IS DISTINCT FROM (CURRENT_USER::pg_catalog.regrole)::oid
  OR EXISTS (SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid IN
   (pg_catalog.to_regclass('public.billing_finance_event_deliveries'),pg_catalog.to_regclass('public.billing_finance_sync_state'))
   AND c.relowner IS DISTINCT FROM expected_owner)
  OR pg_catalog.to_regclass('public.billing_finance_event_deliveries') IS NULL
  OR pg_catalog.to_regclass('public.billing_finance_sync_state') IS NULL
 THEN RAISE EXCEPTION 'FINANCE_PARTITION_OWNER_PREREQUISITE'; END IF;
END $ownership$;

CREATE TABLE public.billing_finance_protocol_control (
 stripe_scope text PRIMARY KEY CHECK (stripe_scope ~ '^acct_[A-Za-z0-9]+:(test|live)$' AND char_length(stripe_scope) <= 255),
 mode text NOT NULL DEFAULT 'legacy' CHECK (mode IN ('legacy','draining_to_customer','customer','draining_to_legacy')),
 epoch bigint NOT NULL DEFAULT 0 CHECK (epoch BETWEEN 0 AND 9007199254740991),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT billing_finance_protocol_foundation_legacy CHECK (mode = 'legacy' AND epoch = 0)
);
ALTER TABLE public.billing_finance_protocol_control ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.billing_finance_protocol_control FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON TABLE public.billing_finance_protocol_control TO service_role;

ALTER TABLE public.billing_finance_event_deliveries ADD COLUMN partition_customer_id text;
ALTER TABLE public.billing_finance_event_deliveries ADD CONSTRAINT billing_finance_receipt_partition_customer_check
 CHECK (partition_customer_id IS NULL OR partition_customer_id ~ '^cus_[A-Za-z0-9]{1,240}$');

-- Block ALL new associations in this foundation, including direct owner writes.
-- A future approved migration must replace this guard with a fenced binding path.
CREATE FUNCTION public.billing_finance_receipt_partition_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $guard$
BEGIN
 IF TG_OP = 'INSERT' THEN
  IF NEW.partition_customer_id IS NOT NULL THEN RAISE EXCEPTION 'FINANCE_PARTITION_BINDING_DISABLED'; END IF;
 ELSE
  IF NEW.partition_customer_id IS DISTINCT FROM OLD.partition_customer_id THEN
   IF OLD.partition_customer_id IS NOT NULL THEN RAISE EXCEPTION 'FINANCE_PARTITION_BINDING_IMMUTABLE'; END IF;
   IF OLD.state IN ('processed','ignored') THEN RAISE EXCEPTION 'FINANCE_PARTITION_BINDING_TERMINAL'; END IF;
   RAISE EXCEPTION 'FINANCE_PARTITION_BINDING_DISABLED';
  END IF;
 END IF;
 RETURN NEW;
END $guard$;
REVOKE ALL ON FUNCTION public.billing_finance_receipt_partition_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER billing_finance_receipt_partition_guard
 BEFORE INSERT OR UPDATE OF partition_customer_id ON public.billing_finance_event_deliveries
 FOR EACH ROW EXECUTE FUNCTION public.billing_finance_receipt_partition_guard();

CREATE FUNCTION public.billing_finance_partition_command(
 p_action text,p_scope text,p_customer text DEFAULT NULL,p_token uuid DEFAULT NULL,p_input jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $rpc$
DECLARE control public.billing_finance_protocol_control%ROWTYPE;
 lease public.billing_finance_sync_state%ROWTYPE;
 expected_epoch bigint;
 stamp timestamptz;
BEGIN
 IF p_action IS NULL OR p_action NOT IN ('read_protocol','claim_customer','release_customer')
  OR p_scope IS NULL OR p_scope !~ '^acct_[A-Za-z0-9]+:(test|live)$' OR char_length(p_scope) > 255
  OR jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR octet_length(p_input::text) > 1024
 THEN RAISE EXCEPTION 'FINANCE_PARTITION_INPUT'; END IF;
 IF p_action = 'read_protocol' THEN
  IF p_customer IS NOT NULL OR p_token IS NOT NULL OR p_input <> '{}'::jsonb THEN RAISE EXCEPTION 'FINANCE_PARTITION_INPUT'; END IF;
  -- Only an explicit caller-supplied scope is initialized. Never enumerate accounts.
  INSERT INTO public.billing_finance_protocol_control(stripe_scope) VALUES (p_scope) ON CONFLICT DO NOTHING;
  SELECT * INTO control FROM public.billing_finance_protocol_control WHERE stripe_scope = p_scope FOR SHARE;
  RETURN jsonb_build_object('mode',control.mode,'epoch',control.epoch);
 END IF;
 IF p_customer IS NULL OR p_customer !~ '^cus_[A-Za-z0-9]{1,240}$'
  OR p_input - ARRAY['expected_epoch']::text[] <> '{}'::jsonb
  OR jsonb_typeof(p_input->'expected_epoch') IS DISTINCT FROM 'number'
  OR (p_input->>'expected_epoch') !~ '^(0|[1-9][0-9]{0,15})$'
 THEN RAISE EXCEPTION 'FINANCE_PARTITION_INPUT'; END IF;
 expected_epoch := (p_input->>'expected_epoch')::bigint;
 IF expected_epoch > 9007199254740991 THEN RAISE EXCEPTION 'FINANCE_PARTITION_INPUT'; END IF;
 SELECT * INTO control FROM public.billing_finance_protocol_control WHERE stripe_scope = p_scope FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'FINANCE_PARTITION_DISABLED'; END IF;
 IF control.epoch IS DISTINCT FROM expected_epoch THEN RAISE EXCEPTION 'FINANCE_PARTITION_EPOCH'; END IF;
 IF p_action = 'claim_customer' THEN
  IF p_token IS NOT NULL THEN RAISE EXCEPTION 'FINANCE_PARTITION_INPUT'; END IF;
  IF control.mode <> 'customer' THEN RAISE EXCEPTION 'FINANCE_PARTITION_DISABLED'; END IF;
  INSERT INTO public.billing_finance_sync_state(stripe_scope,resource_type,resource_key)
   VALUES (p_scope,'customer',p_customer) ON CONFLICT DO NOTHING;
  SELECT * INTO lease FROM public.billing_finance_sync_state
   WHERE stripe_scope = p_scope AND resource_type = 'customer' AND resource_key = p_customer FOR UPDATE;
  stamp := clock_timestamp();
  IF lease.lease_until > stamp THEN RAISE EXCEPTION 'FINANCE_BUSY'; END IF;
  UPDATE public.billing_finance_sync_state SET lease_token = gen_random_uuid(),lease_until = stamp + interval '120 seconds',
   revision = revision + 1,updated_at = stamp
   WHERE stripe_scope = p_scope AND resource_type = 'customer' AND resource_key = p_customer RETURNING * INTO lease;
  RETURN jsonb_build_object('token',lease.lease_token,'revision',lease.revision::text,'epoch',control.epoch);
 END IF;
 -- release_customer only; no commit or receipt completion action exists.
 IF p_token IS NULL THEN RAISE EXCEPTION 'FINANCE_PARTITION_INPUT'; END IF;
 IF control.mode NOT IN ('customer','draining_to_legacy') THEN RAISE EXCEPTION 'FINANCE_PARTITION_DISABLED'; END IF;
 UPDATE public.billing_finance_sync_state SET lease_token = NULL,lease_until = NULL,updated_at = clock_timestamp()
  WHERE stripe_scope = p_scope AND resource_type = 'customer' AND resource_key = p_customer AND lease_token = p_token;
 RETURN '{}'::jsonb;
END $rpc$;
REVOKE ALL ON FUNCTION public.billing_finance_partition_command(text,text,text,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.billing_finance_partition_command(text,text,text,uuid,jsonb) TO service_role;

-- Verify effective privileges and inherited/default ACLs, not merely GRANT text.
DO $security$
DECLARE browser_role text;
BEGIN
 FOREACH browser_role IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF pg_catalog.has_function_privilege(browser_role,'public.billing_finance_partition_command(text,text,text,uuid,jsonb)','EXECUTE')
   OR pg_catalog.has_any_column_privilege(browser_role,'public.billing_finance_protocol_control','SELECT,INSERT,UPDATE,REFERENCES')
   OR pg_catalog.has_table_privilege(browser_role,'public.billing_finance_protocol_control','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  THEN RAISE EXCEPTION 'FINANCE_PARTITION_BROWSER_ACCESS'; END IF;
 END LOOP;
 IF pg_catalog.has_table_privilege('service_role','public.billing_finance_protocol_control','INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER')
  OR pg_catalog.has_any_column_privilege('service_role','public.billing_finance_protocol_control','INSERT,UPDATE')
  OR NOT pg_catalog.has_function_privilege('service_role','public.billing_finance_partition_command(text,text,text,uuid,jsonb)','EXECUTE')
 THEN RAISE EXCEPTION 'FINANCE_PARTITION_SERVICE_ACL'; END IF;
END $security$;
COMMIT;
