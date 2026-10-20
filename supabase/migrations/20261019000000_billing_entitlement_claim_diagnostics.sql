-- Observability only. Existing claim predicates, ordering, locks and writes are
-- centralized unchanged below; legacy entry points still return only arrays.
-- Internal items contain the pre-existing work contract, NEVER diagnostic output.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $owner$ BEGIN
 IF current_user IN ('anon','authenticated','service_role') OR EXISTS (
  SELECT 1 FROM pg_proc WHERE oid IN (
   'public.billing_consumer_worker_claim(text,text,text)'::regprocedure,
   'public.billing_consumer_worker_claim_entitlement(text,text)'::regprocedure,
   'public.billing_consumer_worker_settle_entitlement(text,text,text,jsonb,text,jsonb)'::regprocedure)
  AND proowner<>(SELECT oid FROM pg_roles WHERE rolname=current_user)
 ) THEN RAISE EXCEPTION 'BILLING_WORK_OWNER'; END IF;
END $owner$;
CREATE OR REPLACE FUNCTION public.billing_consumer_worker_claim_core(p_scope text,p_consumer text,p_event text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $claim$
DECLARE w public.billing_consumer_work%ROWTYPE;p public.billing_consumer_work_partitions%ROWTYPE;r public.billing_consumer_work_routing%ROWTYPE;stamp timestamptz;token uuid;result jsonb;
BEGIN
 IF p_scope IS NULL OR p_scope !~ '^acct_[A-Za-z0-9]{1,240}:test$' OR p_consumer IS NULL OR p_consumer NOT IN ('finance','entitlement') OR (p_event IS NOT NULL AND p_event !~ '^evt_[A-Za-z0-9]{1,240}$') THEN RAISE EXCEPTION 'BILLING_WORK_INPUT'; END IF;
 IF p_event IS NULL THEN
  -- Initial recovery polling never wakes dependency_wait. A separate reviewed
  -- dependency wake mechanism may explicitly claim an exact event later.
  SELECT t.stripe_event_id INTO p_event FROM public.billing_consumer_work t
  LEFT JOIN public.billing_consumer_work_partitions part ON part.stripe_scope=t.stripe_scope AND part.consumer=t.consumer AND part.partition_kind=t.partition_kind AND part.partition_key=t.partition_key
  WHERE t.stripe_scope=p_scope AND t.consumer=p_consumer
  AND ((t.state IN ('pending','retry_wait') AND t.next_attempt_at<=clock_timestamp()) OR (t.state='processing' AND t.lease_until<=clock_timestamp()))
  AND (part.lease_until IS NULL OR part.lease_until<=clock_timestamp())
  AND NOT EXISTS(SELECT 1 FROM public.billing_consumer_work_routing route_row WHERE route_row.stripe_scope=t.stripe_scope AND route_row.stripe_event_id=t.stripe_event_id AND route_row.consumer=t.consumer AND route_row.lease_until>clock_timestamp())
  ORDER BY t.next_attempt_at,t.arrival_sequence LIMIT 1;
  IF p_event IS NULL THEN RETURN jsonb_build_object('items','[]'::jsonb,'reason','no_eligible_candidate'); END IF;
 END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('billing_work_capacity:'||p_scope,0)) THEN RETURN jsonb_build_object('items','[]'::jsonb,'reason','scope_lock_unavailable'); END IF;
 SELECT * INTO w FROM public.billing_consumer_work WHERE stripe_scope=p_scope AND stripe_event_id=p_event AND consumer=p_consumer;
 IF NOT FOUND THEN RETURN jsonb_build_object('items','[]'::jsonb,'reason','candidate_missing'); END IF;
 stamp:=clock_timestamp();
 IF w.partition_key IS NULL THEN
  IF (SELECT count(*) FROM public.billing_consumer_work_routing WHERE stripe_scope=p_scope AND lease_until>stamp)>=2 THEN RETURN jsonb_build_object('items','[]'::jsonb,'reason','routing_capacity_reached'); END IF;
  SELECT * INTO w FROM public.billing_consumer_work WHERE stripe_scope=p_scope AND stripe_event_id=p_event AND consumer=p_consumer FOR UPDATE SKIP LOCKED;
  IF NOT FOUND OR w.partition_key IS NOT NULL OR w.state NOT IN ('pending','retry_wait','dependency_wait') OR w.next_attempt_at>stamp THEN RETURN jsonb_build_object('items','[]'::jsonb,'reason','candidate_row_locked_or_changed'); END IF;
  SELECT * INTO r FROM public.billing_consumer_work_routing WHERE stripe_scope=p_scope AND stripe_event_id=p_event AND consumer=p_consumer FOR UPDATE;
  IF FOUND AND r.lease_until>stamp THEN RETURN jsonb_build_object('items','[]'::jsonb,'reason','routing_lease_active'); END IF;
  token:=gen_random_uuid();
  UPDATE public.billing_consumer_work SET scheduling_generation=scheduling_generation+1,attempts=attempts+1,retries=attempts,updated_at=stamp WHERE stripe_scope=p_scope AND stripe_event_id=p_event AND consumer=p_consumer RETURNING * INTO w;
  INSERT INTO public.billing_consumer_work_routing VALUES(p_scope,p_event,p_consumer,token,w.scheduling_generation,stamp+interval '120 seconds',stamp,CASE WHEN public.billing_consumer_worker_ignored(p_consumer,w.event_type) THEN 'receipt_only' ELSE 'routing' END)
  ON CONFLICT(stripe_scope,stripe_event_id,consumer) DO UPDATE SET token=excluded.token,generation=excluded.generation,lease_until=excluded.lease_until,started_at=excluded.started_at,kind=excluded.kind RETURNING * INTO r;
  RETURN jsonb_build_object('items',jsonb_build_array(to_jsonb(w)||jsonb_build_object('scheduling_token',r.token,'lease_until',r.lease_until,'processing_started_at',r.started_at,'execution_kind',r.kind)),'reason','routing_claimed');
 END IF;
 IF (SELECT count(*) FROM public.billing_consumer_work_partitions WHERE stripe_scope=p_scope AND lease_until>stamp)>=8 OR (SELECT count(*) FROM public.billing_consumer_work_partitions WHERE stripe_scope=p_scope AND consumer=p_consumer AND lease_until>stamp)>=4 THEN RETURN jsonb_build_object('items','[]'::jsonb,'reason','partition_capacity_unavailable'); END IF;
 SELECT * INTO p FROM public.billing_consumer_work_partitions WHERE stripe_scope=p_scope AND consumer=p_consumer AND partition_kind=w.partition_kind AND partition_key=w.partition_key FOR UPDATE SKIP LOCKED;
 IF NOT FOUND OR p.lease_until>stamp THEN RETURN jsonb_build_object('items','[]'::jsonb,'reason','partition_unavailable'); END IF;
 SELECT * INTO w FROM public.billing_consumer_work WHERE stripe_scope=p_scope AND stripe_event_id=p_event AND consumer=p_consumer FOR UPDATE SKIP LOCKED;
 stamp:=clock_timestamp();
 IF NOT FOUND OR NOT ((w.state IN ('pending','retry_wait','dependency_wait') AND w.next_attempt_at<=stamp) OR (w.state='processing' AND w.lease_until<=stamp)) THEN RETURN jsonb_build_object('items','[]'::jsonb,'reason','candidate_row_locked_or_changed'); END IF;
 token:=gen_random_uuid();
 UPDATE public.billing_consumer_work_partitions SET scheduling_token=token,scheduling_generation=scheduling_generation+1,lease_until=stamp+interval '120 seconds',last_claimed_at=stamp,updated_at=stamp WHERE stripe_scope=p_scope AND consumer=p_consumer AND partition_kind=w.partition_kind AND partition_key=w.partition_key RETURNING * INTO p;
 UPDATE public.billing_consumer_work SET state='processing',attempts=attempts+1,retries=attempts,scheduling_token=token,scheduling_generation=scheduling_generation+1,partition_generation=p.scheduling_generation,lease_until=p.lease_until,processing_started_at=stamp,settled_token=NULL,updated_at=stamp WHERE stripe_scope=p_scope AND stripe_event_id=p_event AND consumer=p_consumer RETURNING * INTO w;
 RETURN jsonb_build_object('items',jsonb_build_array(to_jsonb(w)||jsonb_build_object('execution_kind','consumer')),'reason','consumer_claimed');
END $claim$;
CREATE OR REPLACE FUNCTION public.billing_consumer_worker_claim_entitlement_core(p_scope text,p_consumer text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $claim$
DECLARE result jsonb; decisions jsonb; id text;
BEGIN
 IF p_consumer IS DISTINCT FROM 'entitlement' THEN RAISE EXCEPTION 'BILLING_WORK_AUTHORITY'; END IF;
 result:=public.billing_consumer_worker_claim_core(p_scope,p_consumer);
 decisions:=jsonb_build_array(jsonb_build_object('phase','ordinary','reason',result->>'reason'));
 IF result->'items'<>'[]'::jsonb THEN RETURN jsonb_build_object('items',result->'items','decisions',decisions); END IF;
 -- Lost-wake fallback: only after ordinary work, at most 32 candidate identities.
 -- No state reset or binding: the exact claim reruns the normal routing worker.
 SELECT t.stripe_event_id INTO id FROM (
  SELECT w.* FROM public.billing_consumer_work w WHERE w.stripe_scope=p_scope AND w.consumer='entitlement'
   AND w.state='dependency_wait' AND w.failure_category='routing_unresolved' AND w.partition_key IS NULL
   AND w.next_attempt_at<=clock_timestamp()
   AND EXISTS(SELECT 1 FROM public.billing_subscriptions s WHERE s.stripe_scope=p_scope
    AND s.stripe_subscription_id=public.billing_consumer_work_subscription(w.evidence) AND s.verified_at IS NOT NULL)
  ORDER BY w.next_attempt_at,w.arrival_sequence LIMIT 32
 ) t
 WHERE EXISTS(SELECT 1 FROM public.billing_subscriptions s WHERE s.stripe_scope=p_scope
   AND s.stripe_subscription_id=public.billing_consumer_work_subscription(t.evidence) AND s.verified_at IS NOT NULL)
 AND NOT EXISTS(SELECT 1 FROM public.billing_consumer_work_routing r WHERE r.stripe_scope=t.stripe_scope AND r.stripe_event_id=t.stripe_event_id AND r.consumer=t.consumer AND r.lease_until>clock_timestamp())
 ORDER BY t.next_attempt_at,t.arrival_sequence LIMIT 1;
 IF id IS NULL THEN RETURN jsonb_build_object('items','[]'::jsonb,'decisions',decisions||jsonb_build_array(jsonb_build_object('phase','dependency_fallback','reason','dependency_fallback_unavailable'))); END IF;
 decisions:=decisions||jsonb_build_array(jsonb_build_object('phase','dependency_fallback','reason','dependency_fallback_selected'));
 result:=public.billing_consumer_worker_claim_core(p_scope,p_consumer,id);
 RETURN jsonb_build_object('items',result->'items','decisions',decisions||jsonb_build_array(jsonb_build_object('phase','dependency_fallback','reason',result->>'reason')));
END $claim$;
-- CREATE OR REPLACE preserves legacy OIDs, ownership, signatures and ACLs.
CREATE OR REPLACE FUNCTION public.billing_consumer_worker_claim(p_scope text,p_consumer text,p_event text DEFAULT NULL) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $legacy$
 SELECT public.billing_consumer_worker_claim_core(p_scope,p_consumer,p_event)->'items';
$legacy$;
CREATE OR REPLACE FUNCTION public.billing_consumer_worker_claim_entitlement(p_scope text,p_consumer text) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $legacy$
 SELECT public.billing_consumer_worker_claim_entitlement_core(p_scope,p_consumer)->'items';
$legacy$;
CREATE OR REPLACE FUNCTION public.billing_consumer_worker_claim_entitlement_diagnostic(p_scope text,p_consumer text) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $diagnostic$
 SELECT public.billing_consumer_worker_claim_entitlement_core(p_scope,p_consumer);
$diagnostic$;
-- Read-only instantaneous hint. Same ordinary candidate eligibility and partition
-- caps as claim; requires a bound partition row. Does not test/reserve advisory or
-- row locks, promise selection, or change the runner's dependency stop behavior.
CREATE OR REPLACE FUNCTION public.billing_consumer_worker_entitlement_due_bound(p_scope text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $due$
DECLARE stamp timestamptz:=clock_timestamp();
BEGIN
 IF p_scope IS NULL OR p_scope !~ '^acct_[A-Za-z0-9]{1,240}:test$' THEN RAISE EXCEPTION 'BILLING_WORK_INPUT'; END IF;
 RETURN (SELECT count(*) FROM public.billing_consumer_work_partitions WHERE stripe_scope=p_scope AND lease_until>stamp)<8
 AND (SELECT count(*) FROM public.billing_consumer_work_partitions WHERE stripe_scope=p_scope AND consumer='entitlement' AND lease_until>stamp)<4
 AND EXISTS (
  SELECT 1 FROM public.billing_consumer_work t
  JOIN public.billing_consumer_work_partitions part ON part.stripe_scope=t.stripe_scope AND part.consumer=t.consumer AND part.partition_kind=t.partition_kind AND part.partition_key=t.partition_key
  WHERE t.stripe_scope=p_scope AND t.consumer='entitlement' AND t.partition_key IS NOT NULL
  AND ((t.state IN ('pending','retry_wait') AND t.next_attempt_at<=stamp) OR (t.state='processing' AND t.lease_until<=stamp))
  AND (part.lease_until IS NULL OR part.lease_until<=stamp)
  AND NOT EXISTS(SELECT 1 FROM public.billing_consumer_work_routing route_row WHERE route_row.stripe_scope=t.stripe_scope AND route_row.stripe_event_id=t.stripe_event_id AND route_row.consumer=t.consumer AND route_row.lease_until>stamp)
 );
END $due$;
-- Settle once through the existing authority, then read the hint in the same RPC.
-- Diagnostic evaluation cannot roll back a successful settlement.
CREATE OR REPLACE FUNCTION public.billing_consumer_worker_settle_entitlement_diagnostic(p_scope text,p_event text,p_consumer text,p_context jsonb,p_action text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $settle$
DECLARE result jsonb; due boolean;
BEGIN
 IF p_consumer IS DISTINCT FROM 'entitlement' THEN RAISE EXCEPTION 'BILLING_WORK_AUTHORITY'; END IF;
 result:=public.billing_consumer_worker_settle_entitlement(p_scope,p_event,p_consumer,p_context,p_action,p_input);
 IF p_action='dependency_wait' AND p_input->>'failure_category'='routing_unresolved' THEN
  BEGIN due:=public.billing_consumer_worker_entitlement_due_bound(p_scope); EXCEPTION WHEN query_canceled OR OTHERS THEN due:=NULL; END;
 END IF;
 RETURN jsonb_build_object('result',result,'other_bound_due',due);
END $settle$;
-- Private cores run as the owning definer wrapper, never as a browser/service
-- entry point. No new table or table grants, RLS changes or financial writes.
REVOKE ALL ON FUNCTION public.billing_consumer_worker_claim_core(text,text,text),public.billing_consumer_worker_claim_entitlement_core(text,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.billing_consumer_worker_claim_entitlement_diagnostic(text,text),public.billing_consumer_worker_entitlement_due_bound(text),public.billing_consumer_worker_settle_entitlement_diagnostic(text,text,text,jsonb,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.billing_consumer_worker_claim_entitlement_diagnostic(text,text),public.billing_consumer_worker_entitlement_due_bound(text),public.billing_consumer_worker_settle_entitlement_diagnostic(text,text,text,jsonb,text,jsonb) TO service_role;
COMMIT;
