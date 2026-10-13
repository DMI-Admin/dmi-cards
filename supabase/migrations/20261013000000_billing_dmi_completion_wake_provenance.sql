-- Scheduler completion only; financial authority and proof commits are unchanged.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $owner$
BEGIN
 IF (SELECT proowner FROM pg_proc WHERE oid='public.billing_consumer_worker_complete_dmi(text,text,jsonb,jsonb)'::regprocedure)
 IS DISTINCT FROM (SELECT oid FROM pg_roles WHERE rolname=current_user)
 THEN RAISE EXCEPTION 'BILLING_WORK_OWNER'; END IF;
END $owner$;
CREATE OR REPLACE FUNCTION public.billing_consumer_worker_complete_dmi(p_scope text,p_event text,p_context jsonb,p_invoices jsonb) RETURNS jsonb
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
  -- Invalid/cross-customer candidates still reject the entire action. A valid
  -- invoice retaining another event's provenance cannot authorize a wake here.
  IF id IS NULL OR id !~ '^in_[A-Za-z0-9]{1,240}$' OR NOT EXISTS(SELECT 1 FROM public.billing_invoices WHERE stripe_scope=p_scope AND stripe_object_id=id AND stripe_customer_id=w.partition_key) THEN RAISE EXCEPTION 'FINANCE_PROOF_SOURCE'; END IF;
  proof:=public.billing_finance_invoice_proof_read(p_scope,id);
  usable:=usable OR (proof->>'state'='proven' AND proof->>'application_key'='dmi_cards' AND proof->>'stripe_customer_id'=w.partition_key
   AND proof->>'source_event_id'=p_event
   AND EXISTS(SELECT 1 FROM public.billing_invoices WHERE stripe_scope=p_scope AND stripe_object_id=id AND stripe_customer_id=w.partition_key AND source_event_id=p_event));
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
REVOKE ALL ON FUNCTION public.billing_consumer_worker_complete_dmi(text,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.billing_consumer_worker_complete_dmi(text,text,jsonb,jsonb) TO service_role;
COMMIT;
