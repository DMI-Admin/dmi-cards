-- Scheduler coordination only. No billing authority, receipt or Finance writes.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $owner$
BEGIN
 IF (SELECT proowner FROM pg_proc WHERE oid='public.billing_consumer_worker_settle(text,text,text,jsonb,text,jsonb)'::regprocedure) <> (SELECT oid FROM pg_roles WHERE rolname=current_user)
 THEN RAISE EXCEPTION 'BILLING_WORK_OWNER'; END IF;
END $owner$;

-- Exact relationship identity used by the normal routing resolver, never user authority.
CREATE FUNCTION public.billing_consumer_work_subscription(p_evidence jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $identity$
 SELECT CASE WHEN p_evidence->>'subject_type'='subscription' THEN p_evidence->>'subject_id'
 ELSE coalesce(p_evidence->'object'->'parent'->'subscription_details'->>'subscription',p_evidence->'object'->>'subscription') END
$identity$;
CREATE INDEX billing_consumer_work_entitlement_dependency ON public.billing_consumer_work
 (stripe_scope, public.billing_consumer_work_subscription(evidence), next_attempt_at, arrival_sequence)
 WHERE consumer='entitlement' AND state='dependency_wait' AND failure_category='routing_unresolved' AND partition_key IS NULL;

CREATE FUNCTION public.billing_consumer_worker_settle_entitlement(p_scope text,p_event text,p_consumer text,p_context jsonb,p_action text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $settle$
DECLARE w public.billing_consumer_work%ROWTYPE; subscription text; result jsonb; n integer:=0;
BEGIN
 IF p_consumer IS DISTINCT FROM 'entitlement' THEN RAISE EXCEPTION 'BILLING_WORK_AUTHORITY'; END IF;
 -- Preserve existing renewal, failure, terminal idempotency and fence semantics.
 IF p_action IS DISTINCT FROM 'complete' THEN
  RETURN public.billing_consumer_worker_settle(p_scope,p_event,p_consumer,p_context,p_action,p_input);
 END IF;
 SELECT * INTO w FROM public.billing_consumer_work WHERE stripe_scope=p_scope AND stripe_event_id=p_event AND consumer=p_consumer;
 IF w.state='completed' THEN
  RETURN public.billing_consumer_worker_settle(p_scope,p_event,p_consumer,p_context,p_action,p_input);
 END IF;
 -- Canonical scheduler partition -> work -> routing lock order. Provider work is over.
 w:=public.billing_consumer_worker_guard(p_scope,p_event,p_consumer,p_context,true);
 subscription:=public.billing_consumer_work_subscription(w.evidence);
 -- Only a bound successful consumer with current, verified exact mapping can wake.
 IF w.partition_kind='user' AND subscription ~ '^sub_[A-Za-z0-9]{1,240}$' THEN
  PERFORM 1 FROM public.billing_subscriptions s WHERE s.stripe_scope=p_scope AND s.stripe_subscription_id=subscription
   AND s.user_id::text=w.partition_key AND s.verified_at IS NOT NULL FOR SHARE;
  IF FOUND THEN
   -- Existing settlement independently requires a processed authoritative receipt.
   result:=public.billing_consumer_worker_settle(p_scope,p_event,p_consumer,p_context,p_action,p_input);
   WITH eligible AS (
    SELECT t.stripe_event_id FROM public.billing_consumer_work t
    WHERE t.stripe_scope=p_scope AND t.consumer='entitlement' AND t.state='dependency_wait'
     AND t.failure_category='routing_unresolved' AND t.partition_key IS NULL
     AND public.billing_consumer_work_subscription(t.evidence)=subscription
     AND (t.lease_until IS NULL OR t.lease_until<=clock_timestamp())
     AND NOT EXISTS(SELECT 1 FROM public.billing_consumer_work_routing r WHERE r.stripe_scope=t.stripe_scope AND r.stripe_event_id=t.stripe_event_id AND r.consumer=t.consumer AND r.lease_until>clock_timestamp())
    ORDER BY t.next_attempt_at,t.arrival_sequence LIMIT 10 FOR UPDATE SKIP LOCKED
   )
   UPDATE public.billing_consumer_work t SET state='retry_wait',next_attempt_at=clock_timestamp(),updated_at=clock_timestamp()
   FROM eligible e WHERE t.stripe_scope=p_scope AND t.consumer='entitlement' AND t.stripe_event_id=e.stripe_event_id;
   GET DIAGNOSTICS n=ROW_COUNT;
   RETURN result||jsonb_build_object('woken',n);
  END IF;
 END IF;
 RETURN public.billing_consumer_worker_settle(p_scope,p_event,p_consumer,p_context,p_action,p_input)||jsonb_build_object('woken',0);
END $settle$;

CREATE FUNCTION public.billing_consumer_worker_claim_entitlement(p_scope text,p_consumer text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $claim$
DECLARE result jsonb; id text;
BEGIN
 IF p_consumer IS DISTINCT FROM 'entitlement' THEN RAISE EXCEPTION 'BILLING_WORK_AUTHORITY'; END IF;
 result:=public.billing_consumer_worker_claim(p_scope,p_consumer);
 IF result<>'[]'::jsonb THEN RETURN result; END IF;
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
 IF id IS NULL THEN RETURN '[]'::jsonb; END IF;
 RETURN public.billing_consumer_worker_claim(p_scope,p_consumer,id);
END $claim$;
REVOKE ALL ON FUNCTION public.billing_consumer_work_subscription(jsonb),public.billing_consumer_worker_settle_entitlement(text,text,text,jsonb,text,jsonb),public.billing_consumer_worker_claim_entitlement(text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.billing_consumer_worker_settle_entitlement(text,text,text,jsonb,text,jsonb),public.billing_consumer_worker_claim_entitlement(text,text) TO service_role;
COMMIT;
