-- Isolated offline comparison/import APIs; no hosted capture or trigger.
BEGIN;
SET LOCAL ROLE billing_v2_owner;
CREATE FUNCTION billing_v2.diagnose(scope text,task_kind text) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $v2$
SELECT jsonb_build_object('counts_by_state',coalesce((SELECT jsonb_object_agg(state,n) FROM (SELECT state,count(*)::int n FROM billing_v2.event_inbox WHERE stripe_scope=scope AND event_inbox.task_kind=diagnose.task_kind GROUP BY state)s),'{}'::jsonb),'due_count',(SELECT count(*) FROM billing_v2.event_inbox WHERE stripe_scope=scope AND event_inbox.task_kind=diagnose.task_kind AND state IN ('queued','retry_wait') AND available_at<=clock_timestamp()),'active_task_leases',(SELECT count(*) FROM billing_v2.event_inbox WHERE stripe_scope=scope AND event_inbox.task_kind=diagnose.task_kind AND lease_until>clock_timestamp()));
$v2$;
CREATE FUNCTION billing_v2.wake_dependencies(scope text,task_kind text,dependency_kind text,reference text,limit_count integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $v2$
#variable_conflict use_column
DECLARE t billing_v2.event_inbox;n integer:=0;ready boolean;
BEGIN
 IF limit_count NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'V2_WAKE_BOUND';END IF;
 FOR t IN SELECT * FROM billing_v2.event_inbox WHERE stripe_scope=scope AND event_inbox.task_kind=wake_dependencies.task_kind AND state='dependency_wait' AND event_inbox.dependency_kind=wake_dependencies.dependency_kind AND dependency_reference=reference ORDER BY available_at,arrival_sequence FOR UPDATE SKIP LOCKED LIMIT limit_count LOOP
  ready:=CASE WHEN dependency_kind='subscription' THEN EXISTS(SELECT 1 FROM billing_v2.subscriptions WHERE stripe_scope=scope AND stripe_subscription_id=reference) WHEN dependency_kind='account_binding' THEN EXISTS(SELECT 1 FROM billing_v2.accounts WHERE stripe_scope=scope AND id=t.billing_account_id AND binding_state='verified') ELSE EXISTS(SELECT 1 FROM billing_v2.invoices iv JOIN billing_v2.accounts a ON a.stripe_scope=iv.stripe_scope AND a.stripe_customer_id=iv.stripe_customer_id WHERE iv.stripe_scope=scope AND (iv.stripe_object_id=reference OR (wake_dependencies.dependency_kind='payment' AND EXISTS(SELECT 1 FROM billing_v2.invoice_payments al WHERE al.stripe_scope=scope AND al.stripe_invoice_id=iv.stripe_object_id AND al.stripe_charge_id=reference))) AND a.id=t.billing_account_id AND iv.ownership_state='proven' AND iv.ownership_provenance->>'invoice_revision'=iv.revision::text AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(iv.ownership_provenance->'price_proofs')p WHERE NOT EXISTS(SELECT 1 FROM billing_v2.price_catalog pc WHERE pc.stripe_scope=scope AND pc.stripe_price_id=p->>'id' AND pc.revision::text=p->>'revision' AND pc.ownership_state='active' AND pc.application_active AND pc.application_key='dmi_cards'))) END;
  IF ready THEN UPDATE billing_v2.event_inbox SET state='retry_wait',available_at=clock_timestamp(),updated_at=clock_timestamp() WHERE stripe_scope=scope AND id=t.id;n:=n+1;PERFORM billing_v2.append_audit(scope,'recovery',t.id::text||':wake:'||t.claim_generation::text,jsonb_build_object('version',1,'stage','woken','task',t.id));
  ELSIF t.retry_deadline<=clock_timestamp() THEN UPDATE billing_v2.event_inbox SET state='needs_attention',failure_category='retry_exhausted',updated_at=clock_timestamp() WHERE stripe_scope=scope AND id=t.id;ELSE UPDATE billing_v2.event_inbox SET available_at=clock_timestamp()+interval '300 seconds',updated_at=clock_timestamp() WHERE stripe_scope=scope AND id=t.id;END IF;
 END LOOP;
 RETURN jsonb_build_object('kind','woken','woken_count',n);
END;
$v2$;
CREATE FUNCTION billing_v2.record_comparison(scope text,run_id uuid,source_id text,comparison jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $v2$
#variable_conflict use_column
BEGIN
 IF coalesce(comparison->>'outcome','') NOT IN ('equivalent','expected_representation_difference','policy_mismatch','missing_projection','ownership_mismatch','unexpected_business_effect') THEN RAISE EXCEPTION 'V2_COMPARISON_OUTCOME';END IF;
 PERFORM billing_v2.append_audit(scope,'shadow_comparison',run_id::text||':'||source_id,jsonb_build_object('version',1,'stage',comparison->>'outcome','comparison',comparison));RETURN '{"kind":"recorded"}'::jsonb;
END;
$v2$;
CREATE FUNCTION billing_v2.backfill_page(scope text,run_id uuid,source_checkpoint jsonb,page jsonb,expected_cursor_digest text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $v2$
#variable_conflict use_column
DECLARE e jsonb;payload jsonb;tbl text;cols text;existing billing_v2.operations;manifest uuid;
BEGIN
 IF scope!~'^acct_[A-Za-z0-9]+:test$' OR source_checkpoint->'complete' IS DISTINCT FROM 'true'::jsonb OR source_checkpoint->>'digest' IS NULL OR jsonb_typeof(page)<>'array' OR jsonb_array_length(page)>100 THEN RAISE EXCEPTION 'V2_BACKFILL_INCOMPLETE';END IF;
 INSERT INTO billing_v2.authority(stripe_scope,domain,resource_key,generation) VALUES(scope,'migration','shadow_dataset',0) ON CONFLICT DO NOTHING;
 PERFORM 1 FROM billing_v2.authority WHERE stripe_scope=scope AND domain='migration' AND resource_key='shadow_dataset' FOR UPDATE;
 IF EXISTS(SELECT 1 FROM billing_v2.event_inbox WHERE stripe_scope=scope AND lease_until>clock_timestamp()) THEN RAISE EXCEPTION 'V2_BACKFILL_BUSY';END IF;
 SELECT * INTO existing FROM billing_v2.operations WHERE stripe_scope=scope AND id=run_id FOR UPDATE;
 IF FOUND THEN IF existing.facts->>'digest' IS DISTINCT FROM source_checkpoint->>'digest' THEN RAISE EXCEPTION 'V2_BACKFILL_CONFLICT';END IF;RETURN '{"kind":"duplicate"}'::jsonb;END IF;
 IF EXISTS(SELECT 1 FROM billing_v2.authority WHERE stripe_scope=scope AND domain='migration' AND resource_key='shadow_dataset' AND last_completed_operation_id IS NOT NULL) THEN RAISE EXCEPTION 'V2_REBUILD_REQUIRED';END IF;
 FOR e IN SELECT value FROM jsonb_array_elements(page) LOOP
  tbl:=e->>'table';payload:=e->'row';
  IF tbl NOT IN ('accounts','price_catalog') OR payload->>'stripe_scope' IS DISTINCT FROM scope OR payload ?| ARRAY['lease_token','lease_until','scheduling_token','writer_engine'] THEN RAISE EXCEPTION 'V2_SEED_ROW';END IF;
  SELECT string_agg(quote_ident(attname),',' ORDER BY attnum) INTO cols FROM pg_attribute WHERE attrelid=('billing_v2.'||tbl)::regclass AND attnum>0 AND NOT attisdropped;
  EXECUTE format('INSERT INTO billing_v2.%I(%s) SELECT %s FROM jsonb_populate_record(NULL::billing_v2.%I,$1)',tbl,cols,cols,tbl) USING payload;
 END LOOP;
 INSERT INTO billing_v2.operations(stripe_scope,id,record_type,operation_kind,source_kind,source_id,status,outcome,facts,completed_at) VALUES(scope,run_id,'run','backfill','recovery',run_id::text,'completed','imported',jsonb_build_object('version',1,'stage','imported','digest',source_checkpoint->>'digest'),clock_timestamp());
 UPDATE billing_v2.authority SET last_completed_operation_id=run_id,generation=generation+1,updated_at=clock_timestamp() WHERE stripe_scope=scope AND domain='migration' AND resource_key='shadow_dataset';
 PERFORM billing_v2.append_audit(scope,'backfill',run_id::text||':complete',jsonb_build_object('version',1,'stage','imported','digest',source_checkpoint->>'digest'));
 RETURN '{"kind":"seeded"}'::jsonb;
END;
$v2$;
CREATE FUNCTION billing_v2.checkpoint_run(scope text,run_id uuid,expected_cursor_digest text,page_tasks jsonb,next_cursor jsonb,coverage jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $v2$
#variable_conflict use_column
DECLARE run billing_v2.operations;e jsonb;hash text;
BEGIN
 IF jsonb_typeof(page_tasks)<>'array' OR jsonb_array_length(page_tasks)>100 OR NOT billing_v2.valid_document('run_cursor',next_cursor) OR NOT billing_v2.valid_document('run_coverage',coverage) THEN RAISE EXCEPTION 'V2_CHECKPOINT_SHAPE';END IF;
 SELECT * INTO run FROM billing_v2.operations WHERE stripe_scope=scope AND id=run_id AND record_type='run' FOR UPDATE;
 IF NOT FOUND OR run.status='completed' THEN RAISE EXCEPTION 'V2_RUN_STATE';END IF;
 hash:=encode(sha256(convert_to(coalesce(run.cursor,'{}'::jsonb)::text,'UTF8')),'hex');IF hash<>expected_cursor_digest THEN RETURN '{"kind":"conflict"}'::jsonb;END IF;
 FOR e IN SELECT value FROM jsonb_array_elements(page_tasks) LOOP PERFORM billing_v2.admit(scope,'reconciliation',run_id::text||':'||(e->>'source_id'),e->'evidence');END LOOP;
 UPDATE billing_v2.operations SET cursor=next_cursor,coverage=checkpoint_run.coverage,updated_at=clock_timestamp() WHERE stripe_scope=scope AND id=run_id;
 PERFORM billing_v2.append_audit(scope,'subscription_reconciliation',run_id::text||':'||hash,jsonb_build_object('version',1,'stage','checkpointed','cursor',next_cursor));RETURN '{"kind":"checkpointed"}'::jsonb;
END;
$v2$;
CREATE FUNCTION billing_v2.enqueue_reconciliation(scope text,run_id uuid,resource text,observed_revision text,evidence jsonb) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $v2$
SELECT billing_v2.admit(scope,'reconciliation',run_id::text||':'||resource||':'||observed_revision,evidence);
$v2$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA billing_v2 FROM PUBLIC,anon,authenticated,service_role,billing_v2_executor;
GRANT USAGE ON SCHEMA billing_v2 TO billing_v2_executor,service_role;
GRANT EXECUTE ON FUNCTION billing_v2.acquire_authority(text,text,uuid,text,uuid,uuid,bigint) TO billing_v2_executor;
GRANT EXECUTE ON FUNCTION billing_v2.admit(text,text,text,jsonb) TO billing_v2_executor;
GRANT EXECUTE ON FUNCTION billing_v2.claim(text,text) TO billing_v2_executor;
GRANT EXECUTE ON FUNCTION billing_v2.reclaim_expired(text,text) TO billing_v2_executor;
GRANT EXECUTE ON FUNCTION billing_v2.touch(jsonb) TO billing_v2_executor;
GRANT EXECUTE ON FUNCTION billing_v2.read_result(text,uuid) TO billing_v2_executor;
GRANT EXECUTE ON FUNCTION billing_v2.wait_retry(jsonb,text,integer) TO billing_v2_executor;
GRANT EXECUTE ON FUNCTION billing_v2.wait_dependency(jsonb,jsonb,bigint) TO billing_v2_executor;
GRANT EXECUTE ON FUNCTION billing_v2.mark_attention(jsonb,text) TO billing_v2_executor;
GRANT EXECUTE ON FUNCTION billing_v2.release(jsonb,text) TO billing_v2_executor;
GRANT EXECUTE ON FUNCTION billing_v2.complete_subscription(jsonb,bigint,jsonb) TO billing_v2_executor;
GRANT EXECUTE ON FUNCTION billing_v2.complete_finance(jsonb,jsonb,jsonb) TO billing_v2_executor;
GRANT EXECUTE ON FUNCTION billing_v2.bind_customer(jsonb,text,uuid,text,bigint,jsonb) TO billing_v2_executor;
GRANT EXECUTE ON FUNCTION billing_v2.handover(text,text,uuid,bigint,text,text,text) TO billing_v2_executor;
GRANT EXECUTE ON FUNCTION billing_v2.prepare_checkout(text,uuid,jsonb) TO billing_v2_executor;
GRANT EXECUTE ON FUNCTION billing_v2.record_checkout(text,uuid,jsonb,jsonb) TO billing_v2_executor;
GRANT EXECUTE ON FUNCTION billing_v2.diagnose(text,text) TO billing_v2_executor;
GRANT EXECUTE ON FUNCTION billing_v2.wake_dependencies(text,text,text,text,integer) TO billing_v2_executor;
GRANT EXECUTE ON FUNCTION billing_v2.record_comparison(text,uuid,text,jsonb) TO billing_v2_executor;
GRANT EXECUTE ON FUNCTION billing_v2.backfill_page(text,uuid,jsonb,jsonb,text) TO billing_v2_executor;
GRANT EXECUTE ON FUNCTION billing_v2.checkpoint_run(text,uuid,text,jsonb,jsonb,jsonb) TO billing_v2_executor;
GRANT EXECUTE ON FUNCTION billing_v2.enqueue_reconciliation(text,uuid,text,text,jsonb) TO billing_v2_executor;
GRANT EXECUTE ON FUNCTION billing_v2.diagnose(text,text) TO service_role;
COMMIT;
