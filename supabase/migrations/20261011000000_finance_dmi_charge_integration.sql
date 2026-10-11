-- Disabled DMI-only composition. No existing migration, foreign RPC, protocol, or data changes.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $owner$ BEGIN
 IF current_user IN ('anon','authenticated','service_role') OR
 (SELECT proowner FROM pg_proc WHERE oid='public.billing_consumer_worker_authority(text,text,text,jsonb,text,uuid,uuid,jsonb)'::regprocedure) IS DISTINCT FROM current_user::regrole::oid
 THEN RAISE EXCEPTION 'FINANCE_PROOF_MIGRATION_OWNER'; END IF;
END $owner$;
CREATE FUNCTION public.billing_finance_dmi_invoice_context(p_scope text,p_invoice text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $context$
DECLARE certificate jsonb;invoice jsonb;
BEGIN
 IF p_scope IS NULL OR p_scope !~ '^acct_[A-Za-z0-9]{1,240}:test$' OR p_invoice IS NULL OR p_invoice !~ '^in_[A-Za-z0-9]{1,240}$' THEN RAISE EXCEPTION 'FINANCE_PROOF_INPUT'; END IF;
 certificate:=public.billing_finance_invoice_proof_read(p_scope,p_invoice);
 SELECT jsonb_build_object('stripe_scope',stripe_scope,'stripe_object_id',stripe_object_id,'stripe_customer_id',stripe_customer_id,'stripe_subscription_id',stripe_subscription_id,'revision',revision::text) INTO invoice FROM public.billing_invoices WHERE stripe_scope=p_scope AND stripe_object_id=p_invoice;
 IF certificate->>'state'='proven' THEN certificate:=certificate||jsonb_build_object('source_invoice_revision',certificate->>'source_invoice_revision'); END IF;
 RETURN jsonb_build_object('invoice',invoice,'certificate',certificate);
END $context$;
CREATE FUNCTION public.billing_finance_dmi_charge_commit(p_scope text,p_customer text,p_token uuid,p_input jsonb,p_proof jsonb,p_candidates jsonb DEFAULT NULL,p_authority jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $commit$
DECLARE control public.billing_finance_protocol_control%ROWTYPE;lease public.billing_finance_sync_state%ROWTYPE;receipt public.billing_finance_event_deliveries%ROWTYPE;
 own public.billing_stripe_resource_ownership%ROWTYPE;ref jsonb;certificate jsonb;payment public.billing_payments%ROWTYPE;allocations jsonb;result jsonb;
BEGIN
 IF p_scope IS NULL OR p_scope !~ '^acct_[A-Za-z0-9]{1,240}:test$' OR p_customer IS NULL OR p_customer !~ '^cus_[A-Za-z0-9]{1,240}$'
 OR jsonb_typeof(p_proof) IS DISTINCT FROM 'object' OR NOT p_proof ?& ARRAY['scope','charge','invoice','invoiceRevision','certificateRevision','paymentIntent','prices']
 OR p_proof-ARRAY['scope','charge','invoice','invoiceRevision','certificateRevision','paymentIntent','prices']<>'{}'
 OR p_proof->>'scope' IS DISTINCT FROM p_scope OR coalesce(p_proof->>'charge','') !~ '^ch_[A-Za-z0-9]{1,240}$' OR coalesce(p_proof->>'invoice','') !~ '^in_[A-Za-z0-9]{1,240}$'
 OR jsonb_typeof(p_proof->'prices') IS DISTINCT FROM 'array' OR jsonb_array_length(p_proof->'prices') NOT BETWEEN 1 AND 2
 OR octet_length(p_proof::text)>4096 THEN RAISE EXCEPTION 'FINANCE_PROOF_INPUT'; END IF;
 -- Scheduler partition/work (when queued) -> protocol -> application -> sorted registry ->
 -- customer -> receipt -> existing sorted advisory/resource locks -> certificate recheck.
 SELECT * INTO control FROM public.billing_finance_protocol_control WHERE stripe_scope=p_scope FOR SHARE;
 IF NOT FOUND OR control.mode NOT IN ('customer','draining_to_legacy') OR control.epoch IS DISTINCT FROM (p_input->>'expected_epoch')::bigint THEN RAISE EXCEPTION 'FINANCE_PROOF_EPOCH'; END IF;
 PERFORM 1 FROM public.billing_stripe_applications WHERE application_key='dmi_cards' AND state='active' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'FINANCE_PROOF_AUTHORITY'; END IF;
 FOR ref IN SELECT value FROM jsonb_array_elements(p_proof->'prices') ORDER BY value->>'id' COLLATE "C" LOOP
  IF ref->>'application' IS DISTINCT FROM 'dmi_cards' OR coalesce(ref->>'id','') !~ '^price_[A-Za-z0-9]{1,240}$' THEN RAISE EXCEPTION 'FINANCE_PROOF_AUTHORITY'; END IF;
  SELECT * INTO own FROM public.billing_stripe_resource_ownership WHERE stripe_scope=p_scope AND resource_type='price' AND stripe_resource_id=ref->>'id' FOR SHARE;
  IF NOT FOUND OR own.state<>'active' OR own.application_key<>'dmi_cards' OR own.ownership_basis<>'price_owner' OR own.revision IS DISTINCT FROM (ref->>'revision')::bigint THEN RAISE EXCEPTION 'FINANCE_PROOF_AUTHORITY'; END IF;
 END LOOP;
 SELECT * INTO lease FROM public.billing_finance_sync_state WHERE stripe_scope=p_scope AND resource_type='customer' AND resource_key=p_customer FOR UPDATE;
 IF NOT FOUND OR lease.lease_token IS DISTINCT FROM p_token OR lease.lease_protocol_epoch IS DISTINCT FROM control.epoch OR lease.revision IS DISTINCT FROM (p_input->>'expected_partition_revision')::bigint OR lease.lease_until<=clock_timestamp() OR lease.lease_until IS NULL THEN RAISE EXCEPTION 'FINANCE_PROOF_FENCE'; END IF;
 SELECT * INTO receipt FROM public.billing_finance_event_deliveries WHERE stripe_scope=p_scope AND consumer_version='finance_v1' AND stripe_event_id=p_input->>'event_id' FOR UPDATE;
 IF NOT FOUND OR receipt.state<>'processing' OR receipt.lease_token IS DISTINCT FROM (p_input->>'event_token')::uuid OR receipt.lease_until IS NULL OR receipt.lease_until<=clock_timestamp()
 OR receipt.partition_customer_id IS DISTINCT FROM p_customer OR receipt.partition_protocol_epoch IS DISTINCT FROM control.epoch OR receipt.subject_id IS DISTINCT FROM p_proof->>'charge'
 OR receipt.event_type NOT IN ('charge.succeeded','charge.failed','charge.captured','charge.refunded') THEN RAISE EXCEPTION 'FINANCE_PROOF_RECEIPT_FENCE'; END IF;
 -- The existing validator locks complete bundle resources in the canonical order.
 PERFORM public.billing_finance_customer_bundle_owner(p_scope,p_customer,p_input->'bundle');
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_input->'bundle'->'payments') e WHERE e->'row'->>'stripe_object_id'=p_proof->>'charge')
 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_input->'bundle'->'invoices') e WHERE e->'row'->>'stripe_object_id'=p_proof->>'invoice') THEN RAISE EXCEPTION 'FINANCE_PROOF_SOURCE'; END IF;
 SELECT to_jsonb(p) INTO certificate FROM public.billing_finance_application_proofs p WHERE stripe_scope=p_scope AND stripe_invoice_id=p_proof->>'invoice' ORDER BY certificate_revision DESC LIMIT 1;
 IF certificate->>'state' IS DISTINCT FROM 'proven' OR certificate->>'application_key' IS DISTINCT FROM 'dmi_cards'
 OR certificate->>'stripe_customer_id' IS DISTINCT FROM p_customer OR certificate->>'certificate_revision' IS DISTINCT FROM p_proof->>'certificateRevision'
 OR certificate->>'source_invoice_revision' IS DISTINCT FROM p_proof->>'invoiceRevision' THEN RAISE EXCEPTION 'FINANCE_OWNERSHIP_STALE'; END IF;
 IF (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(p_proof->'prices'))<>jsonb_array_length(p_proof->'prices')
 OR jsonb_array_length(certificate->'registry_proofs')<>jsonb_array_length(p_proof->'prices')
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(certificate->'registry_proofs') r WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_proof->'prices') p WHERE p->>'id'=r->>'price_id' AND p->>'revision'=r->>'revision')) THEN RAISE EXCEPTION 'FINANCE_PROOF_AUTHORITY'; END IF;
 certificate:=public.billing_finance_invoice_proof_read(p_scope,p_proof->>'invoice');
 IF certificate->>'state' IS DISTINCT FROM 'proven' THEN RAISE EXCEPTION 'FINANCE_OWNERSHIP_STALE'; END IF;
 SELECT * INTO payment FROM public.billing_payments WHERE stripe_scope=p_scope AND stripe_object_id=p_proof->>'charge';
 IF NOT FOUND OR payment.stripe_customer_id IS DISTINCT FROM p_customer OR payment.stripe_payment_intent_id IS DISTINCT FROM p_proof->>'paymentIntent' THEN RAISE EXCEPTION 'FINANCE_PROOF_SOURCE'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(a)),'[]') INTO allocations FROM (SELECT stripe_invoice_id,stripe_charge_id,stripe_payment_intent_id FROM public.billing_invoice_payments WHERE stripe_scope=p_scope AND (stripe_charge_id=p_proof->>'charge' OR (p_proof->>'paymentIntent' IS NOT NULL AND stripe_payment_intent_id=p_proof->>'paymentIntent')) LIMIT 3) a;
 IF jsonb_array_length(allocations) NOT BETWEEN 1 AND 2 OR EXISTS(SELECT 1 FROM jsonb_array_elements(allocations) a WHERE a->>'stripe_invoice_id' IS DISTINCT FROM p_proof->>'invoice' OR a->>'stripe_charge_id' IS DISTINCT FROM p_proof->>'charge' OR a->>'stripe_payment_intent_id' IS DISTINCT FROM p_proof->>'paymentIntent') THEN RAISE EXCEPTION 'FINANCE_PROOF_SOURCE'; END IF;
 IF p_candidates IS NOT NULL THEN
  -- Every authority row is already locked; never discover a new registry lock late.
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_authority->'proofs') a WHERE a->>'type'<>'price' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_proof->'prices') p WHERE p->>'id'=a->>'id' AND p->>'revision'=a->>'revision'))
  OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_candidates) c WHERE c->>'invoice'=p_proof->>'invoice' AND c->>'state'='proven' AND c->'line_evidence'=certificate->'line_evidence') THEN RAISE EXCEPTION 'FINANCE_PROOF_AUTHORITY'; END IF;
  result:=public.billing_finance_customer_commit_with_proofs(p_scope,p_customer,p_token,p_input,p_candidates,p_authority);
 ELSE result:=public.billing_finance_partition_command('commit_customer',p_scope,p_customer,p_token,p_input); END IF;
 RETURN result;
END $commit$;
CREATE FUNCTION public.billing_consumer_worker_dmi_authority(p_scope text,p_event text,p_consumer text,p_context jsonb,p_action text,p_customer text DEFAULT NULL,p_token uuid DEFAULT NULL,p_input jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET lock_timeout='3s' AS $authority$
DECLARE w public.billing_consumer_work%ROWTYPE;result jsonb;
BEGIN
 w:=public.billing_consumer_worker_guard(p_scope,p_event,p_consumer,p_context);
 IF p_consumer<>'finance' OR w.partition_kind<>'customer' OR w.partition_key IS DISTINCT FROM p_customer THEN RAISE EXCEPTION 'BILLING_WORK_AUTHORITY'; END IF;
 IF p_action='invoice_context' THEN result:=public.billing_finance_dmi_invoice_context(p_scope,p_input->>'invoice');
 ELSIF p_action IN ('invoice_commit','charge_commit') THEN
  IF p_input->'input'->>'event_id' IS DISTINCT FROM p_event THEN RAISE EXCEPTION 'BILLING_WORK_AUTHORITY'; END IF;
  IF p_action='invoice_commit' THEN result:=public.billing_finance_customer_commit_with_proofs(p_scope,p_customer,p_token,p_input->'input',p_input->'candidates',p_input->'authority');
  ELSE result:=public.billing_finance_dmi_charge_commit(p_scope,p_customer,p_token,p_input->'input',p_input->'proof',p_input->'candidates',p_input->'authority'); END IF;
 ELSE RAISE EXCEPTION 'BILLING_WORK_AUTHORITY'; END IF;
 PERFORM public.billing_consumer_worker_guard(p_scope,p_event,p_consumer,p_context);
 RETURN result;
END $authority$;
CREATE FUNCTION public.billing_consumer_worker_complete_dmi(p_scope text,p_event text,p_context jsonb,p_invoices jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $wake$
DECLARE w public.billing_consumer_work%ROWTYPE;id text;proof jsonb;usable boolean:=false;result jsonb;n integer;epoch bigint;
BEGIN
 IF jsonb_typeof(p_invoices) IS DISTINCT FROM 'array' OR jsonb_array_length(p_invoices)>200 THEN RAISE EXCEPTION 'FINANCE_PROOF_INPUT'; END IF;
 w:=public.billing_consumer_worker_guard(p_scope,p_event,'finance',p_context,true);
 IF w.partition_kind<>'customer' THEN RAISE EXCEPTION 'BILLING_WORK_AUTHORITY'; END IF;
 SELECT p.epoch INTO epoch FROM public.billing_finance_protocol_control p WHERE stripe_scope=p_scope AND mode='customer' FOR SHARE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.billing_finance_event_deliveries WHERE stripe_scope=p_scope AND stripe_event_id=p_event AND consumer_version='finance_v1' AND state='processed' AND partition_customer_id=w.partition_key AND partition_protocol_epoch=epoch) THEN RAISE EXCEPTION 'FINANCE_PROOF_EPOCH'; END IF;
 -- Serialize through the same scheduler partition. No reverse invoice -> partition acquisition.
 FOR id IN SELECT value FROM jsonb_array_elements_text(p_invoices) ORDER BY value COLLATE "C" LOOP
  IF NOT EXISTS(SELECT 1 FROM public.billing_invoices WHERE stripe_scope=p_scope AND stripe_object_id=id AND stripe_customer_id=w.partition_key AND source_event_id=p_event) THEN RAISE EXCEPTION 'FINANCE_PROOF_SOURCE'; END IF;
  proof:=public.billing_finance_invoice_proof_read(p_scope,id);
  usable:=usable OR (proof->>'state'='proven' AND proof->>'application_key'='dmi_cards' AND proof->>'stripe_customer_id'=w.partition_key);
 END LOOP;
 result:=public.billing_consumer_worker_settle(p_scope,p_event,'finance',p_context,'complete',jsonb_build_object('terminal_result','processed'));
 -- Completion cleared the partition owner, while this transaction retains its row lock.
 IF usable THEN
  WITH ready AS (SELECT stripe_event_id FROM public.billing_consumer_work WHERE stripe_scope=p_scope AND consumer='finance' AND partition_kind='customer' AND partition_key=w.partition_key AND state='dependency_wait' AND failure_category='dependency_unresolved' AND event_type IN ('charge.succeeded','charge.failed','charge.captured','charge.refunded') ORDER BY arrival_sequence LIMIT 10 FOR UPDATE SKIP LOCKED)
  UPDATE public.billing_consumer_work t SET state='retry_wait',next_attempt_at=clock_timestamp(),updated_at=clock_timestamp() FROM ready WHERE t.stripe_scope=p_scope AND t.consumer='finance' AND t.stripe_event_id=ready.stripe_event_id;
  GET DIAGNOSTICS n=ROW_COUNT;
 ELSE n:=0;END IF;
 RETURN result||jsonb_build_object('woken',n);
END $wake$;
CREATE FUNCTION public.billing_consumer_worker_claim_dmi(p_scope text,p_consumer text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $claim$
DECLARE result jsonb;id text;
BEGIN
 result:=public.billing_consumer_worker_claim(p_scope,p_consumer);
 IF result<>'[]' OR p_consumer<>'finance' THEN RETURN result; END IF;
 -- Timed fallback, only bound charge dependencies; never guess an unbound partition.
 SELECT stripe_event_id INTO id FROM public.billing_consumer_work WHERE stripe_scope=p_scope AND consumer='finance' AND partition_kind='customer' AND partition_key IS NOT NULL AND state='dependency_wait' AND failure_category='dependency_unresolved' AND event_type IN ('charge.succeeded','charge.failed','charge.captured','charge.refunded') AND next_attempt_at<=clock_timestamp() ORDER BY next_attempt_at,arrival_sequence LIMIT 1;
 IF id IS NULL THEN RETURN '[]'; END IF;
 RETURN public.billing_consumer_worker_claim(p_scope,p_consumer,id);
END $claim$;
REVOKE ALL ON FUNCTION public.billing_finance_dmi_invoice_context(text,text),public.billing_finance_dmi_charge_commit(text,text,uuid,jsonb,jsonb,jsonb,jsonb),public.billing_consumer_worker_dmi_authority(text,text,text,jsonb,text,text,uuid,jsonb),public.billing_consumer_worker_complete_dmi(text,text,jsonb,jsonb),public.billing_consumer_worker_claim_dmi(text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.billing_finance_dmi_invoice_context(text,text),public.billing_finance_dmi_charge_commit(text,text,uuid,jsonb,jsonb,jsonb,jsonb),public.billing_consumer_worker_dmi_authority(text,text,text,jsonb,text,text,uuid,jsonb),public.billing_consumer_worker_complete_dmi(text,text,jsonb,jsonb),public.billing_consumer_worker_claim_dmi(text,text) TO service_role;
COMMIT;
