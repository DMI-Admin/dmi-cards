-- Inactive invoice certificates only: no runtime producer, activation, backfill or financial authority.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DO $owner$
BEGIN
 IF current_user IN ('anon','authenticated','service_role') THEN RAISE EXCEPTION 'APPLICATION_PROOF_MIGRATION_OWNER'; END IF;
 IF (SELECT proowner FROM pg_proc WHERE oid='public.billing_finance_customer_apply_bundle(text,jsonb,timestamptz)'::regprocedure)
 IS DISTINCT FROM (SELECT oid FROM pg_roles WHERE rolname=current_user)
 THEN RAISE EXCEPTION 'APPLICATION_PROOF_MIGRATION_OWNER'; END IF;
END $owner$;
-- Strict, bounded JSON contract. Completeness is a future trusted producer assertion, not
-- something inferred from current subscription items or historical Finance rows.
CREATE FUNCTION public.billing_finance_invoice_proof_shape(p_state text,p_reason text,p_complete boolean,p_count integer,p_lines jsonb,p_refs jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $shape$
DECLARE item jsonb; prices text[]; refs text[];
BEGIN
 IF p_state IS NULL OR p_complete IS NULL OR p_count IS NULL OR p_lines IS NULL OR p_refs IS NULL
 OR jsonb_typeof(p_lines)<>'array' OR jsonb_typeof(p_refs)<>'array'
 OR octet_length(p_lines::text)>65536 OR octet_length(p_refs::text)>4096
 OR jsonb_array_length(p_lines)>200 OR jsonb_array_length(p_refs)>2 THEN RETURN false; END IF;
 IF p_state='unresolved' THEN
  RETURN COALESCE(p_reason IN ('incomplete_evidence','relationship_unresolved','ownership_unresolved','ownership_conflict','ownership_stale','malformed_evidence')
   AND NOT p_complete AND p_count=0 AND p_lines='[]'::jsonb AND p_refs='[]'::jsonb,false);
 END IF;
 IF p_state<>'proven' OR p_reason IS NOT NULL OR NOT p_complete OR p_count<1
 OR p_count<>jsonb_array_length(p_lines) OR jsonb_array_length(p_refs)<1 THEN RETURN false; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
  IF jsonb_typeof(item)<>'object' OR NOT item ?& ARRAY['line_id','price_id']
  OR item-ARRAY['line_id','price_id']<>'{}'::jsonb
  OR jsonb_typeof(item->'line_id') IS DISTINCT FROM 'string' OR jsonb_typeof(item->'price_id') IS DISTINCT FROM 'string'
  OR item->>'line_id' !~ '^il_[A-Za-z0-9]{1,240}$' OR item->>'price_id' !~ '^price_[A-Za-z0-9]{1,240}$' THEN RETURN false; END IF;
 END LOOP;
 IF (SELECT count(DISTINCT value->>'line_id') FROM jsonb_array_elements(p_lines))<>p_count THEN RETURN false; END IF;
 SELECT array_agg(DISTINCT value->>'price_id' ORDER BY value->>'price_id') INTO prices FROM jsonb_array_elements(p_lines);
 IF cardinality(prices)>2 THEN RETURN false; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_refs) LOOP
  IF jsonb_typeof(item)<>'object' OR NOT item ?& ARRAY['price_id','application_key','revision']
  OR item-ARRAY['price_id','application_key','revision']<>'{}'::jsonb
  OR jsonb_typeof(item->'price_id') IS DISTINCT FROM 'string'
  OR item->>'price_id' !~ '^price_[A-Za-z0-9]{1,240}$'
  OR item->>'application_key' IS DISTINCT FROM 'dmi_cards'
  OR jsonb_typeof(item->'revision') IS DISTINCT FROM 'number'
  OR item->>'revision' !~ '^[1-9][0-9]{0,15}$' THEN RETURN false; END IF;
  IF (item->>'revision')::bigint>9007199254740991 THEN RETURN false; END IF;
 END LOOP;
 SELECT array_agg(value->>'price_id' ORDER BY value->>'price_id') INTO refs FROM jsonb_array_elements(p_refs);
 RETURN prices=refs; -- no duplicate, missing or unused registry proof reference
END $shape$;
CREATE TABLE public.billing_finance_application_proofs (
 stripe_scope text NOT NULL CHECK(stripe_scope ~ '^acct_[A-Za-z0-9]{1,240}:(test|live)$'),
 stripe_invoice_id text NOT NULL CHECK(stripe_invoice_id ~ '^in_[A-Za-z0-9]{1,240}$'),
 certificate_revision bigint NOT NULL CHECK(certificate_revision BETWEEN 1 AND 9007199254740991),
 proof_version integer NOT NULL CHECK(proof_version=1),
 state text NOT NULL CHECK(state IN ('proven','unresolved')), reason_code text,
 stripe_customer_id text NOT NULL CHECK(stripe_customer_id ~ '^cus_[A-Za-z0-9]{1,240}$'),
 stripe_subscription_id text CHECK(stripe_subscription_id IS NULL OR stripe_subscription_id ~ '^sub_[A-Za-z0-9]{1,240}$'),
 source_invoice_revision bigint NOT NULL CHECK(source_invoice_revision>0),
 source_invoice_verified_at timestamptz NOT NULL,
 source_event_id text CHECK(source_event_id IS NULL OR source_event_id ~ '^evt_[A-Za-z0-9]{1,240}$'),
 source_event_created_at timestamptz,
 stripe_api_version text NOT NULL CHECK(length(stripe_api_version) BETWEEN 1 AND 128),
 normalizer_version integer NOT NULL CHECK(normalizer_version>0),
 application_key text REFERENCES public.billing_stripe_applications(application_key) ON DELETE RESTRICT,
 line_evidence jsonb NOT NULL, line_count integer NOT NULL CHECK(line_count BETWEEN 0 AND 200),
 lines_complete boolean NOT NULL, registry_proofs jsonb NOT NULL,
 verified_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(stripe_scope,stripe_invoice_id,certificate_revision),
 FOREIGN KEY(stripe_scope,stripe_invoice_id) REFERENCES public.billing_invoices(stripe_scope,stripe_object_id) ON DELETE RESTRICT,
 CHECK((state='proven' AND application_key IS NOT DISTINCT FROM 'dmi_cards') OR (state='unresolved' AND application_key IS NULL)),
 CHECK(public.billing_finance_invoice_proof_shape(state,reason_code,lines_complete,line_count,line_evidence,registry_proofs))
);
CREATE FUNCTION public.billing_finance_invoice_proof_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $guard$
BEGIN RAISE EXCEPTION 'APPLICATION_PROOF_IMMUTABLE'; END $guard$;
CREATE TRIGGER billing_finance_invoice_proof_guard BEFORE UPDATE OR DELETE ON public.billing_finance_application_proofs
FOR EACH ROW EXECUTE FUNCTION public.billing_finance_invoice_proof_guard();
ALTER TABLE public.billing_finance_application_proofs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_finance_application_proofs FROM PUBLIC,anon,authenticated,service_role;
-- Internal only; lock order: application -> registry prices (sorted) -> invoice.
-- The invoice row serializes revision allocation. No lease/receipt/protocol state is touched.
-- Future commit integration MUST review lock order before calling this under existing locks.
CREATE FUNCTION public.billing_finance_invoice_proof_append(p_scope text,p_invoice text,p_input jsonb)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $append$
DECLARE invoice public.billing_invoices%ROWTYPE; ref jsonb; next_revision bigint; own public.billing_stripe_resource_ownership%ROWTYPE;
BEGIN
 IF p_scope IS NULL OR p_scope !~ '^acct_[A-Za-z0-9]{1,240}:(test|live)$'
 OR p_invoice IS NULL OR p_invoice !~ '^in_[A-Za-z0-9]{1,240}$'
 OR p_input IS NULL OR jsonb_typeof(p_input)<>'object' OR octet_length(p_input::text)>73728
 OR NOT p_input ?& ARRAY['proof_version','state','reason_code','customer','subscription','source_revision','source_verified_at','line_count','lines_complete','line_evidence','registry_proofs']
 OR p_input-ARRAY['proof_version','state','reason_code','customer','subscription','source_revision','source_verified_at','line_count','lines_complete','line_evidence','registry_proofs']<>'{}'::jsonb
 OR p_input->'proof_version' IS DISTINCT FROM '1'::jsonb
 OR jsonb_typeof(p_input->'state') IS DISTINCT FROM 'string'
 OR jsonb_typeof(p_input->'reason_code') NOT IN ('string','null')
 OR jsonb_typeof(p_input->'customer') IS DISTINCT FROM 'string'
 OR p_input->>'customer' !~ '^cus_[A-Za-z0-9]{1,240}$'
 OR jsonb_typeof(p_input->'subscription') NOT IN ('string','null')
 OR (p_input->>'subscription' IS NOT NULL AND p_input->>'subscription' !~ '^sub_[A-Za-z0-9]{1,240}$')
 OR jsonb_typeof(p_input->'source_revision') IS DISTINCT FROM 'number'
 OR p_input->>'source_revision' !~ '^[1-9][0-9]{0,15}$'
 OR jsonb_typeof(p_input->'source_verified_at') IS DISTINCT FROM 'string'
 OR jsonb_typeof(p_input->'line_count') IS DISTINCT FROM 'number' OR p_input->>'line_count' !~ '^[0-9]{1,3}$'
 OR jsonb_typeof(p_input->'lines_complete') IS DISTINCT FROM 'boolean'
 THEN RAISE EXCEPTION 'APPLICATION_PROOF_INVALID'; END IF;
 IF NOT public.billing_finance_invoice_proof_shape(p_input->>'state',p_input->>'reason_code',
 (p_input->>'lines_complete')::boolean,(p_input->>'line_count')::integer,p_input->'line_evidence',p_input->'registry_proofs')
 THEN RAISE EXCEPTION 'APPLICATION_PROOF_INVALID'; END IF;
 IF p_input->>'state'='proven' THEN
  PERFORM 1 FROM public.billing_stripe_applications WHERE application_key='dmi_cards' AND state='active' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'APPLICATION_PROOF_AUTHORITY'; END IF;
  FOR ref IN SELECT value FROM jsonb_array_elements(p_input->'registry_proofs') ORDER BY value->>'price_id' LOOP
   SELECT * INTO own FROM public.billing_stripe_resource_ownership WHERE stripe_scope=p_scope AND resource_type='price' AND stripe_resource_id=ref->>'price_id' FOR SHARE;
   IF NOT FOUND OR own.state<>'active' OR own.application_key<>'dmi_cards' OR own.ownership_basis<>'price_owner'
   OR own.revision<>(ref->>'revision')::bigint THEN RAISE EXCEPTION 'APPLICATION_PROOF_AUTHORITY'; END IF;
  END LOOP;
 END IF;
 SELECT * INTO invoice FROM public.billing_invoices WHERE stripe_scope=p_scope AND stripe_object_id=p_invoice FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'APPLICATION_PROOF_SOURCE'; END IF;
 IF invoice.stripe_subscription_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.billing_finance_subscriptions WHERE stripe_scope=p_scope AND stripe_object_id=invoice.stripe_subscription_id AND stripe_customer_id=invoice.stripe_customer_id)
 THEN RAISE EXCEPTION 'APPLICATION_PROOF_SOURCE'; END IF;
 IF invoice.stripe_customer_id IS DISTINCT FROM p_input->>'customer' OR invoice.stripe_subscription_id IS DISTINCT FROM p_input->>'subscription'
 OR invoice.revision<>(p_input->>'source_revision')::bigint OR invoice.verified_at IS DISTINCT FROM (p_input->>'source_verified_at')::timestamptz
 THEN RAISE EXCEPTION 'APPLICATION_PROOF_SOURCE'; END IF;
 SELECT certificate_revision INTO next_revision FROM public.billing_finance_application_proofs WHERE stripe_scope=p_scope AND stripe_invoice_id=p_invoice ORDER BY certificate_revision DESC LIMIT 1;
 next_revision:=COALESCE(next_revision,0)+1;
 INSERT INTO public.billing_finance_application_proofs
 (stripe_scope,stripe_invoice_id,certificate_revision,proof_version,state,reason_code,stripe_customer_id,stripe_subscription_id,
 source_invoice_revision,source_invoice_verified_at,source_event_id,source_event_created_at,stripe_api_version,normalizer_version,
 application_key,line_evidence,line_count,lines_complete,registry_proofs,verified_at)
 VALUES(p_scope,p_invoice,next_revision,1,p_input->>'state',p_input->>'reason_code',invoice.stripe_customer_id,invoice.stripe_subscription_id,
 invoice.revision,invoice.verified_at,invoice.source_event_id,invoice.source_event_created_at,invoice.stripe_api_version,invoice.normalizer_version,
 CASE WHEN p_input->>'state'='proven' THEN 'dmi_cards' END,p_input->'line_evidence',(p_input->>'line_count')::integer,
 (p_input->>'lines_complete')::boolean,p_input->'registry_proofs',clock_timestamp());
 RETURN next_revision;
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range THEN
 RAISE EXCEPTION 'APPLICATION_PROOF_INVALID';
END $append$;
-- Bounded server-only exact read; always selects latest BEFORE checking state/authority.
-- Historical certificates are NOT financial/foreign-completion authority.
CREATE FUNCTION public.billing_finance_invoice_proof_read(p_scope text,p_invoice text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $read$
DECLARE proof public.billing_finance_application_proofs%ROWTYPE; latest bigint; invoice public.billing_invoices%ROWTYPE;
 ref jsonb; own public.billing_stripe_resource_ownership%ROWTYPE;
BEGIN
 IF p_scope IS NULL OR p_scope !~ '^acct_[A-Za-z0-9]{1,240}:(test|live)$' OR p_invoice IS NULL OR p_invoice !~ '^in_[A-Za-z0-9]{1,240}$'
 THEN RETURN jsonb_build_object('state','unresolved','reason_code','malformed_evidence'); END IF;
 SELECT * INTO proof FROM public.billing_finance_application_proofs WHERE stripe_scope=p_scope AND stripe_invoice_id=p_invoice ORDER BY certificate_revision DESC LIMIT 1;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','unresolved','reason_code','ownership_unresolved'); END IF;
 IF proof.state='unresolved' THEN RETURN jsonb_build_object('state','unresolved','reason_code',proof.reason_code,'certificate_revision',proof.certificate_revision); END IF;
 PERFORM 1 FROM public.billing_stripe_applications WHERE application_key=proof.application_key AND state='active' FOR SHARE;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','unresolved','reason_code','ownership_stale'); END IF;
 FOR ref IN SELECT value FROM jsonb_array_elements(proof.registry_proofs) ORDER BY value->>'price_id' LOOP
  SELECT * INTO own FROM public.billing_stripe_resource_ownership WHERE stripe_scope=p_scope AND resource_type='price' AND stripe_resource_id=ref->>'price_id' FOR SHARE;
  IF NOT FOUND OR own.state<>'active' OR own.application_key IS DISTINCT FROM proof.application_key OR own.ownership_basis<>'price_owner'
  OR own.revision<>(ref->>'revision')::bigint THEN RETURN jsonb_build_object('state','unresolved','reason_code','ownership_stale'); END IF;
 END LOOP;
 SELECT * INTO invoice FROM public.billing_invoices WHERE stripe_scope=p_scope AND stripe_object_id=p_invoice FOR SHARE;
 SELECT certificate_revision INTO latest FROM public.billing_finance_application_proofs WHERE stripe_scope=p_scope AND stripe_invoice_id=p_invoice ORDER BY certificate_revision DESC LIMIT 1;
 IF invoice.stripe_customer_id IS DISTINCT FROM proof.stripe_customer_id OR invoice.stripe_subscription_id IS DISTINCT FROM proof.stripe_subscription_id
 OR invoice.revision IS DISTINCT FROM proof.source_invoice_revision OR invoice.verified_at IS DISTINCT FROM proof.source_invoice_verified_at
 OR invoice.source_event_id IS DISTINCT FROM proof.source_event_id OR invoice.source_event_created_at IS DISTINCT FROM proof.source_event_created_at
 OR invoice.stripe_api_version IS DISTINCT FROM proof.stripe_api_version OR invoice.normalizer_version IS DISTINCT FROM proof.normalizer_version
 OR latest IS DISTINCT FROM proof.certificate_revision
 THEN RETURN jsonb_build_object('state','unresolved','reason_code','ownership_stale'); END IF;
 RETURN to_jsonb(proof); -- internal only; never logged or returned to browsers
END $read$;
REVOKE ALL ON FUNCTION public.billing_finance_invoice_proof_shape(text,text,boolean,integer,jsonb,jsonb),
 public.billing_finance_invoice_proof_guard(),public.billing_finance_invoice_proof_append(text,text,jsonb),
 public.billing_finance_invoice_proof_read(text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.billing_finance_invoice_proof_read(text,text) TO service_role;
COMMIT;
