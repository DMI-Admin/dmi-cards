-- Inactive proof-aware wrapper only. Existing commit RPC, protocol and runtime defaults are unchanged.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $owner$
BEGIN
 IF current_user IN ('anon','authenticated','service_role') OR
 (SELECT proowner FROM pg_proc WHERE oid='public.billing_finance_invoice_proof_append(text,text,jsonb)'::regprocedure)
 IS DISTINCT FROM (SELECT oid FROM pg_roles WHERE rolname=current_user)
 THEN RAISE EXCEPTION 'FINANCE_PROOF_MIGRATION_OWNER'; END IF;
END $owner$;
CREATE FUNCTION public.billing_finance_customer_commit_with_proofs(p_scope text,p_customer text,p_token uuid,p_input jsonb,p_candidates jsonb,p_authority jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $rpc$
DECLARE control public.billing_finance_protocol_control%ROWTYPE;lease public.billing_finance_sync_state%ROWTYPE;
 receipt public.billing_finance_event_deliveries%ROWTYPE;invoice public.billing_invoices%ROWTYPE;own public.billing_stripe_resource_ownership%ROWTYPE;
 candidate jsonb;ref jsonb;entry jsonb;bundle jsonb:='{}';refs jsonb:='[]';canonical jsonb;used jsonb;result jsonb;
 kind text;identity_column text;app text;proven integer:=0;unresolved integer:=0;
BEGIN
 -- This initial opt-in is test-scope only. Neither install nor invocation changes protocol mode.
 IF p_scope IS NULL OR p_scope !~ '^acct_[A-Za-z0-9]{1,240}:test$'
 OR p_customer IS NULL OR p_customer !~ '^cus_[A-Za-z0-9]{1,240}$' OR p_token IS NULL
 OR jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR jsonb_typeof(p_candidates) IS DISTINCT FROM 'array'
 OR jsonb_array_length(p_candidates)>200 OR jsonb_typeof(p_authority) IS DISTINCT FROM 'object'
 OR NOT p_authority ?& ARRAY['evidence','proofs'] OR p_authority-ARRAY['evidence','proofs']<>'{}'
 OR jsonb_typeof(p_authority->'proofs') IS DISTINCT FROM 'array' OR jsonb_array_length(p_authority->'proofs') NOT BETWEEN 1 AND 2
 OR octet_length(jsonb_build_array(p_input,p_candidates,p_authority)::text)>1048576
 OR NOT p_input ?& ARRAY['expected_epoch','expected_partition_revision','event_id','event_token','bundle']
 OR p_input-ARRAY['expected_epoch','expected_partition_revision','event_id','event_token','bundle']<>'{}'
 OR jsonb_typeof(p_input->'expected_epoch') IS DISTINCT FROM 'number' OR coalesce(p_input->>'expected_epoch','') !~ '^(0|[1-9][0-9]{0,15})$'
 OR (p_input->>'expected_epoch')::numeric>9007199254740991
 OR jsonb_typeof(p_input->'expected_partition_revision') IS DISTINCT FROM 'string' OR coalesce(p_input->>'expected_partition_revision','') !~ '^(0|[1-9][0-9]{0,18})$'
 OR (p_input->>'expected_partition_revision')::numeric>9223372036854775807
 OR coalesce(p_input->>'event_id','') !~ '^evt_[A-Za-z0-9]{1,240}$'
 OR coalesce(p_input->>'event_token','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
 OR jsonb_typeof(p_input->'bundle') IS DISTINCT FROM 'object'
 OR NOT (p_input->'bundle') ?& ARRAY['subscriptions','items','invoices','payments','allocations','attempts','refunds','activity']
 OR (p_input->'bundle')-ARRAY['subscriptions','items','invoices','payments','allocations','attempts','refunds','activity']<>'{}'
 THEN RAISE EXCEPTION 'FINANCE_PROOF_INPUT'; END IF;
 -- Validate/canonicalize all targets BEFORE authority locks. No late discovery is allowed.
 FOREACH kind IN ARRAY ARRAY['subscriptions','items','invoices','payments','allocations','attempts','refunds','activity'] LOOP
  IF jsonb_typeof(p_input->'bundle'->kind) IS DISTINCT FROM 'array' OR jsonb_array_length(p_input->'bundle'->kind)>200 THEN RAISE EXCEPTION 'FINANCE_PROOF_INPUT'; END IF;
  identity_column:=CASE kind WHEN 'attempts' THEN 'attempt_key' WHEN 'activity' THEN 'activity_key' ELSE 'stripe_object_id' END;
  FOR entry IN SELECT value FROM jsonb_array_elements(p_input->'bundle'->kind) LOOP
   IF jsonb_typeof(entry) IS DISTINCT FROM 'object' OR jsonb_typeof(entry->'row') IS DISTINCT FROM 'object'
   OR coalesce(entry->'row'->>identity_column,'')='' OR entry->'row'->>'stripe_scope' IS DISTINCT FROM p_scope THEN RAISE EXCEPTION 'FINANCE_PROOF_INPUT'; END IF;
  END LOOP;
  IF (SELECT count(DISTINCT value->'row'->>identity_column) FROM jsonb_array_elements(p_input->'bundle'->kind))<>jsonb_array_length(p_input->'bundle'->kind) THEN RAISE EXCEPTION 'FINANCE_PROOF_INPUT'; END IF;
  SELECT coalesce(jsonb_agg(value ORDER BY (value->'row'->>identity_column) COLLATE "C"),'[]') INTO canonical FROM jsonb_array_elements(p_input->'bundle'->kind);
  bundle:=bundle||jsonb_build_object(kind,canonical);
 END LOOP;
 IF jsonb_array_length(p_candidates)<>jsonb_array_length(bundle->'invoices')
 OR (SELECT count(DISTINCT value->>'invoice') FROM jsonb_array_elements(p_candidates))<>jsonb_array_length(p_candidates) THEN RAISE EXCEPTION 'FINANCE_PROOF_INPUT'; END IF;
 FOR candidate IN SELECT value FROM jsonb_array_elements(p_candidates) LOOP
  IF jsonb_typeof(candidate) IS DISTINCT FROM 'object' OR octet_length(candidate::text)>73728
  OR NOT candidate ?& ARRAY['proof_version','invoice','customer','subscription','verified_at','api_version','normalizer_version','event_id','event_created_at','state','reason_code','line_count','lines_complete','line_evidence','registry_proofs']
  OR candidate-ARRAY['proof_version','invoice','customer','subscription','verified_at','api_version','normalizer_version','event_id','event_created_at','state','reason_code','line_count','lines_complete','line_evidence','registry_proofs']<>'{}'
  OR candidate->'proof_version' IS DISTINCT FROM '1'::jsonb
  OR coalesce(candidate->>'invoice','') !~ '^in_[A-Za-z0-9]{1,240}$'
  OR candidate->>'customer' IS DISTINCT FROM p_customer
  OR jsonb_typeof(candidate->'line_count') IS DISTINCT FROM 'number' OR coalesce(candidate->>'line_count','') !~ '^[0-9]{1,3}$'
  OR jsonb_typeof(candidate->'lines_complete') IS DISTINCT FROM 'boolean'
  OR jsonb_typeof(candidate->'state') IS DISTINCT FROM 'string'
  OR jsonb_typeof(candidate->'reason_code') NOT IN ('null','string')
  THEN RAISE EXCEPTION 'FINANCE_PROOF_INPUT'; END IF;
  IF NOT public.billing_finance_invoice_proof_shape(candidate->>'state',candidate->>'reason_code',(candidate->>'lines_complete')::boolean,
   (candidate->>'line_count')::integer,candidate->'line_evidence',candidate->'registry_proofs') THEN RAISE EXCEPTION 'FINANCE_PROOF_INPUT'; END IF;
  -- Only missing supplementary completeness is non-fatal. Conflict/stale/malformed cannot be downgraded.
  IF candidate->>'state'='unresolved' AND candidate->>'reason_code' NOT IN ('incomplete_evidence','ownership_unresolved') THEN RAISE EXCEPTION 'FINANCE_PROOF_INPUT'; END IF;
  SELECT value->'row' INTO entry FROM jsonb_array_elements(bundle->'invoices') WHERE value->'row'->>'stripe_object_id'=candidate->>'invoice';
  IF NOT FOUND OR entry->>'stripe_customer_id' IS DISTINCT FROM p_customer
  OR entry->'stripe_subscription_id' IS DISTINCT FROM candidate->'subscription'
  OR entry->'verified_at' IS DISTINCT FROM candidate->'verified_at'
  OR entry->'stripe_api_version' IS DISTINCT FROM candidate->'api_version'
  OR entry->'normalizer_version' IS DISTINCT FROM candidate->'normalizer_version'
  OR coalesce(entry->'source_event_id','null'::jsonb) IS DISTINCT FROM candidate->'event_id'
  OR coalesce(entry->'source_event_created_at','null'::jsonb) IS DISTINCT FROM candidate->'event_created_at'
  THEN RAISE EXCEPTION 'FINANCE_PROOF_SOURCE'; END IF;
  refs:=refs||(candidate->'registry_proofs');
 END LOOP;
 -- Lock order: protocol -> application -> sorted registry -> customer -> receipt ->
 -- sorted advisory resource locks -> family/identity-sorted rows -> certificate append.
 SELECT * INTO control FROM public.billing_finance_protocol_control WHERE stripe_scope=p_scope FOR SHARE;
 IF NOT FOUND OR control.mode NOT IN ('customer','draining_to_legacy') OR control.epoch IS DISTINCT FROM (p_input->>'expected_epoch')::bigint THEN RAISE EXCEPTION 'FINANCE_PROOF_EPOCH'; END IF;
 PERFORM 1 FROM public.billing_stripe_applications WHERE application_key='dmi_cards' AND state='active' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'FINANCE_PROOF_AUTHORITY'; END IF;
 FOR ref IN SELECT value FROM jsonb_array_elements(p_authority->'proofs') LOOP
  IF jsonb_typeof(ref) IS DISTINCT FROM 'object' OR ref-ARRAY['scope','type','id','application','revision']<>'{}'
  OR NOT ref ?& ARRAY['scope','type','id','application','revision'] OR jsonb_typeof(ref->'scope') IS DISTINCT FROM 'string' OR jsonb_typeof(ref->'type') IS DISTINCT FROM 'string' OR jsonb_typeof(ref->'id') IS DISTINCT FROM 'string' OR jsonb_typeof(ref->'application') IS DISTINCT FROM 'string' OR ref->>'scope' IS DISTINCT FROM p_scope OR ref->>'application' IS DISTINCT FROM 'dmi_cards'
  OR NOT ((ref->>'type'='price' AND ref->>'id' ~ '^price_[A-Za-z0-9]{1,240}$') OR (ref->>'type'='customer' AND ref->>'id' ~ '^cus_[A-Za-z0-9]{1,240}$'))
  OR jsonb_typeof(ref->'revision') IS DISTINCT FROM 'number' OR coalesce(ref->>'revision','') !~ '^[1-9][0-9]{0,15}$'
  OR (ref->>'revision')::numeric>9007199254740991 THEN RAISE EXCEPTION 'FINANCE_PROOF_AUTHORITY'; END IF;
  refs:=refs||jsonb_build_array(jsonb_build_object('price_id',ref->>'id','application_key',ref->>'application','revision',ref->'revision','type',ref->>'type'));
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(refs) GROUP BY coalesce(value->>'type','price'),value->>'price_id' HAVING count(DISTINCT value->>'revision')>1) THEN RAISE EXCEPTION 'FINANCE_PROOF_AUTHORITY'; END IF;
 FOR ref IN SELECT jsonb_build_object('type',t,'id',id,'revision',revision) FROM
  (SELECT DISTINCT coalesce(value->>'type','price') t,value->>'price_id' id,(value->>'revision')::bigint revision FROM jsonb_array_elements(refs)) selected
  ORDER BY t COLLATE "C",id COLLATE "C" LOOP
  SELECT * INTO own FROM public.billing_stripe_resource_ownership WHERE stripe_scope=p_scope AND resource_type=ref->>'type' AND stripe_resource_id=ref->>'id' FOR SHARE;
  IF NOT FOUND OR own.state<>'active' OR own.application_key<>'dmi_cards' OR own.revision<>(ref->>'revision')::bigint
  OR own.ownership_basis IS DISTINCT FROM (CASE ref->>'type' WHEN 'price' THEN 'price_owner' ELSE 'exclusive_customer' END) THEN RAISE EXCEPTION 'FINANCE_PROOF_AUTHORITY'; END IF;
 END LOOP;
 used:=public.billing_finance_foreign_evidence(p_scope,p_authority->'evidence',p_authority->'proofs');
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_authority->'proofs') x WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(used->'used') u WHERE u->>'type'=x->>'type' AND u->>'id'=x->>'id')) THEN RAISE EXCEPTION 'FINANCE_PROOF_AUTHORITY'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(used->'customers') x WHERE x.value<>p_customer) THEN RAISE EXCEPTION 'FINANCE_PROOF_AUTHORITY'; END IF;
 SELECT * INTO lease FROM public.billing_finance_sync_state WHERE stripe_scope=p_scope AND resource_type='customer' AND resource_key=p_customer FOR UPDATE;
 IF NOT FOUND OR lease.lease_token IS DISTINCT FROM p_token OR lease.lease_protocol_epoch IS DISTINCT FROM control.epoch
 OR lease.revision IS DISTINCT FROM (p_input->>'expected_partition_revision')::bigint OR lease.lease_until IS NULL OR lease.lease_until<=clock_timestamp() THEN RAISE EXCEPTION 'FINANCE_PROOF_FENCE'; END IF;
 SELECT * INTO receipt FROM public.billing_finance_event_deliveries WHERE stripe_scope=p_scope AND consumer_version='finance_v1' AND stripe_event_id=p_input->>'event_id' FOR UPDATE;
 IF NOT FOUND OR receipt.state<>'processing' OR receipt.lease_token IS DISTINCT FROM (p_input->>'event_token')::uuid OR receipt.lease_until IS NULL OR receipt.lease_until<=clock_timestamp()
 OR receipt.partition_customer_id IS DISTINCT FROM p_customer OR receipt.partition_protocol_epoch IS DISTINCT FROM control.epoch
 OR receipt.subject_id IS DISTINCT FROM p_authority->'evidence'->>'id' THEN RAISE EXCEPTION 'FINANCE_PROOF_RECEIPT_FENCE'; END IF;
 kind:=CASE WHEN receipt.event_type IN ('customer.subscription.created','customer.subscription.updated','customer.subscription.deleted') THEN 'subscription'
 WHEN receipt.event_type IN ('invoice.finalized','invoice.updated','invoice.paid','invoice.payment_failed','invoice.voided','invoice.marked_uncollectible') THEN 'invoice'
 WHEN receipt.event_type IN ('charge.succeeded','charge.failed','charge.captured','charge.refunded') THEN 'charge'
 WHEN receipt.event_type IN ('charge.refund.updated','refund.created','refund.updated','refund.failed') THEN 'refund' END;
 IF kind IS NULL OR p_authority->'evidence'->>'kind' IS DISTINCT FROM kind THEN RAISE EXCEPTION 'FINANCE_PROOF_AUTHORITY'; END IF;
 FOR candidate IN SELECT value FROM jsonb_array_elements(p_candidates) LOOP
  IF candidate->>'event_id' IS DISTINCT FROM receipt.stripe_event_id OR (candidate->>'event_created_at')::timestamptz IS DISTINCT FROM receipt.event_created_at THEN RAISE EXCEPTION 'FINANCE_PROOF_SOURCE'; END IF;
 END LOOP;
 result:=public.billing_finance_partition_command('commit_customer',p_scope,p_customer,p_token,p_input||jsonb_build_object('bundle',bundle));
 FOR candidate IN SELECT value FROM jsonb_array_elements(p_candidates) ORDER BY (value->>'invoice') COLLATE "C" LOOP
  SELECT * INTO invoice FROM public.billing_invoices WHERE stripe_scope=p_scope AND stripe_object_id=candidate->>'invoice'; -- row lock is held by inner commit
  IF NOT FOUND OR invoice.stripe_customer_id IS DISTINCT FROM p_customer OR invoice.stripe_subscription_id IS DISTINCT FROM candidate->>'subscription'
  OR invoice.verified_at IS DISTINCT FROM (candidate->>'verified_at')::timestamptz OR invoice.stripe_api_version IS DISTINCT FROM candidate->>'api_version'
  OR invoice.normalizer_version IS DISTINCT FROM (candidate->>'normalizer_version')::integer THEN RAISE EXCEPTION 'FINANCE_PROOF_SOURCE'; END IF;
  -- No predicted revision, and provenance retained by freshness rules comes from committed SQL state.
  PERFORM public.billing_finance_invoice_proof_append(p_scope,invoice.stripe_object_id,jsonb_build_object('proof_version',1,'state',candidate->'state','reason_code',candidate->'reason_code',
   'customer',invoice.stripe_customer_id,'subscription',invoice.stripe_subscription_id,'source_revision',invoice.revision,'source_verified_at',invoice.verified_at,
   'line_count',candidate->'line_count','lines_complete',candidate->'lines_complete','line_evidence',candidate->'line_evidence','registry_proofs',candidate->'registry_proofs'));
  IF candidate->>'state'='proven' THEN proven:=proven+1;ELSE unresolved:=unresolved+1;END IF;
 END LOOP;
 IF clock_timestamp()>=lease.lease_until OR clock_timestamp()>=receipt.lease_until THEN RAISE EXCEPTION 'FINANCE_PROOF_FENCE'; END IF;
 RETURN result||jsonb_build_object('proven_certificates',proven,'unresolved_certificates',unresolved);
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range THEN RAISE EXCEPTION 'FINANCE_PROOF_INPUT';
END $rpc$;
REVOKE ALL ON FUNCTION public.billing_finance_customer_commit_with_proofs(text,text,uuid,jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.billing_finance_customer_commit_with_proofs(text,text,uuid,jsonb,jsonb,jsonb) TO service_role;
COMMIT;
