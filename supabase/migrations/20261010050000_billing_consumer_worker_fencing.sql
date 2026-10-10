-- Disabled worker adapters only. Existing billing RPC definitions/grants stay unchanged.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $owner$ BEGIN
 IF current_user IN ('anon','authenticated','service_role') OR to_regclass('public.billing_consumer_work') IS NULL THEN RAISE EXCEPTION 'BILLING_WORK_PREREQUISITE'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc WHERE oid IN ('public.billing_consumer_work_claim(text,text,integer)'::regprocedure,'public.billing_finance_command(text,text,uuid,jsonb)'::regprocedure,'public.billing_finance_partition_command(text,text,text,uuid,jsonb)'::regprocedure,'public.billing_finance_complete_foreign(text,text,uuid,bigint,jsonb,jsonb)'::regprocedure,'public.billing_foundation_command(text,text,uuid,uuid,jsonb)'::regprocedure) AND proowner IS DISTINCT FROM current_user::regrole::oid) THEN RAISE EXCEPTION 'BILLING_WORK_PREREQUISITE'; END IF;
END $owner$;
-- No invented/global financial partition: unbound routing has a separate read-only lease.
CREATE TABLE public.billing_consumer_work_routing (
 stripe_scope text NOT NULL,stripe_event_id text NOT NULL,consumer text NOT NULL,
 token uuid NOT NULL,generation bigint NOT NULL CHECK(generation>0),lease_until timestamptz NOT NULL,started_at timestamptz NOT NULL,
 kind text NOT NULL CHECK(kind IN ('routing','receipt_only')),
 PRIMARY KEY(stripe_scope,stripe_event_id,consumer),
 FOREIGN KEY(stripe_scope,stripe_event_id,consumer) REFERENCES public.billing_consumer_work ON DELETE RESTRICT
);
CREATE INDEX billing_consumer_work_routing_active ON public.billing_consumer_work_routing(stripe_scope,lease_until);
CREATE FUNCTION public.billing_consumer_worker_ignored(p_consumer text,p_type text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$
 SELECT coalesce((p_consumer='finance' AND p_type IN ('checkout.session.completed','invoice.payment_succeeded','customer.created','invoice_payment.paid')) OR
 (p_consumer='entitlement' AND p_type IN ('customer.created','invoice.finalized','invoice.updated','invoice.voided','invoice.marked_uncollectible','invoice_payment.paid','charge.succeeded','charge.failed','charge.captured','charge.refunded','charge.refund.updated','refund.created','refund.updated','refund.failed')),false);
$$;
CREATE FUNCTION public.billing_consumer_worker_guard(p_scope text,p_event text,p_consumer text,p_context jsonb,p_settlement boolean DEFAULT false)
RETURNS public.billing_consumer_work LANGUAGE plpgsql SET search_path=pg_catalog,public AS $guard$
DECLARE w public.billing_consumer_work%ROWTYPE;p public.billing_consumer_work_partitions%ROWTYPE;r public.billing_consumer_work_routing%ROWTYPE;stamp timestamptz;expiry timestamptz;started timestamptz;
BEGIN
 IF p_scope !~ '^acct_[A-Za-z0-9]{1,240}:test$' OR p_scope IS NULL OR jsonb_typeof(p_context) IS DISTINCT FROM 'object'
 OR NOT p_context ?& ARRAY['token','generation','partition_generation','expires_at'] OR p_context-ARRAY['token','generation','partition_generation','expires_at']<>'{}' THEN RAISE EXCEPTION 'BILLING_WORK_FENCE'; END IF;
 SELECT * INTO w FROM public.billing_consumer_work WHERE stripe_scope=p_scope AND stripe_event_id=p_event AND consumer=p_consumer;
 IF NOT FOUND THEN RAISE EXCEPTION 'BILLING_WORK_FENCE'; END IF;
 -- Always partition -> work -> routing sidecar -> existing authoritative order.
 IF w.partition_key IS NOT NULL THEN
  SELECT * INTO p FROM public.billing_consumer_work_partitions WHERE stripe_scope=p_scope AND consumer=p_consumer AND partition_kind=w.partition_kind AND partition_key=w.partition_key FOR UPDATE;
 END IF;
 SELECT * INTO w FROM public.billing_consumer_work WHERE stripe_scope=p_scope AND stripe_event_id=p_event AND consumer=p_consumer FOR UPDATE;
 stamp:=clock_timestamp();
 IF w.partition_key IS NOT NULL THEN
  IF w.state<>'processing' OR w.scheduling_token::text IS DISTINCT FROM p_context->>'token' OR w.scheduling_generation::text IS DISTINCT FROM p_context->>'generation'
  OR w.partition_generation::text IS DISTINCT FROM p_context->>'partition_generation' OR p.scheduling_token IS DISTINCT FROM w.scheduling_token OR p.scheduling_generation IS DISTINCT FROM w.partition_generation
  OR p.lease_until<=stamp OR w.lease_until<=stamp THEN RAISE EXCEPTION 'BILLING_WORK_FENCE'; END IF;
  expiry:=w.lease_until;started:=w.processing_started_at;
 ELSE
  SELECT * INTO r FROM public.billing_consumer_work_routing WHERE stripe_scope=p_scope AND stripe_event_id=p_event AND consumer=p_consumer FOR UPDATE;
  stamp:=clock_timestamp(); -- Refresh after routing-sidecar lock waits too.
  IF NOT FOUND OR w.state NOT IN ('pending','retry_wait','dependency_wait') OR r.token::text IS DISTINCT FROM p_context->>'token'
  OR r.generation::text IS DISTINCT FROM p_context->>'generation' OR r.generation<>w.scheduling_generation OR p_context->'partition_generation' IS DISTINCT FROM 'null'::jsonb OR r.lease_until<=stamp THEN RAISE EXCEPTION 'BILLING_WORK_FENCE'; END IF;
  expiry:=r.lease_until;started:=r.started_at;
 END IF;
 IF (p_context->>'expires_at')::timestamptz IS DISTINCT FROM expiry THEN RAISE EXCEPTION 'BILLING_WORK_FENCE'; END IF;
 IF stamp>=started+(CASE WHEN p_settlement THEN interval '75 seconds' ELSE interval '60 seconds' END) THEN RAISE EXCEPTION 'BILLING_WORK_DEADLINE'; END IF;
 RETURN w;
END $guard$;
CREATE FUNCTION public.billing_consumer_worker_receipt(p_scope text,p_event text,p_consumer text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $receipt$
DECLARE s text;code text;expiry timestamptz;
BEGIN
 IF p_scope IS NULL OR p_scope !~ '^acct_[A-Za-z0-9]{1,240}:test$' OR p_event IS NULL OR p_event !~ '^evt_[A-Za-z0-9]{1,240}$' OR p_consumer IS NULL OR p_consumer NOT IN ('finance','entitlement') THEN RAISE EXCEPTION 'BILLING_WORK_INPUT'; END IF;
 IF p_consumer='finance' THEN SELECT state,error_code,lease_until INTO s,code,expiry FROM public.billing_finance_event_deliveries WHERE stripe_scope=p_scope AND stripe_event_id=p_event AND consumer_version='finance_v1';
 ELSE SELECT state,last_error_code,lease_until INTO s,code,expiry FROM public.stripe_webhook_events WHERE stripe_scope=p_scope AND stripe_event_id=p_event; END IF;
 RETURN jsonb_build_object('state',coalesce(s,'missing'),'lease_active',coalesce(s='processing',false) AND coalesce(expiry>clock_timestamp(),false),'category',CASE
 WHEN code IN ('FINANCE_BUSY','BILLING_BUSY') THEN 'lease_busy'
 WHEN code IN ('FINANCE_OWNERSHIP_UNRESOLVED','FINANCE_CUSTOMER_ROUTING_UNRESOLVED','MISSING_OBJECT') THEN 'dependency_unresolved'
 WHEN code IN ('FINANCE_OWNERSHIP_CONFLICT','FINANCE_ATTRIBUTION_CONFLICT','IDENTITY_CONFLICT','BILLING_IDENTITY') THEN 'ownership_conflict'
 WHEN code IS NULL THEN NULL ELSE 'store_unavailable' END);
END $receipt$;
CREATE FUNCTION public.billing_consumer_worker_claim(p_scope text,p_consumer text,p_event text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $claim$
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
  IF p_event IS NULL THEN RETURN '[]'; END IF;
 END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('billing_work_capacity:'||p_scope,0)) THEN RETURN '[]'; END IF;
 SELECT * INTO w FROM public.billing_consumer_work WHERE stripe_scope=p_scope AND stripe_event_id=p_event AND consumer=p_consumer;
 IF NOT FOUND THEN RETURN '[]'; END IF;
 stamp:=clock_timestamp();
 IF w.partition_key IS NULL THEN
  IF (SELECT count(*) FROM public.billing_consumer_work_routing WHERE stripe_scope=p_scope AND lease_until>stamp)>=2 THEN RETURN '[]'; END IF;
  SELECT * INTO w FROM public.billing_consumer_work WHERE stripe_scope=p_scope AND stripe_event_id=p_event AND consumer=p_consumer FOR UPDATE SKIP LOCKED;
  IF NOT FOUND OR w.partition_key IS NOT NULL OR w.state NOT IN ('pending','retry_wait','dependency_wait') OR w.next_attempt_at>stamp THEN RETURN '[]'; END IF;
  SELECT * INTO r FROM public.billing_consumer_work_routing WHERE stripe_scope=p_scope AND stripe_event_id=p_event AND consumer=p_consumer FOR UPDATE;
  IF FOUND AND r.lease_until>stamp THEN RETURN '[]'; END IF;
  token:=gen_random_uuid();
  UPDATE public.billing_consumer_work SET scheduling_generation=scheduling_generation+1,attempts=attempts+1,retries=attempts,updated_at=stamp WHERE stripe_scope=p_scope AND stripe_event_id=p_event AND consumer=p_consumer RETURNING * INTO w;
  INSERT INTO public.billing_consumer_work_routing VALUES(p_scope,p_event,p_consumer,token,w.scheduling_generation,stamp+interval '120 seconds',stamp,CASE WHEN public.billing_consumer_worker_ignored(p_consumer,w.event_type) THEN 'receipt_only' ELSE 'routing' END)
  ON CONFLICT(stripe_scope,stripe_event_id,consumer) DO UPDATE SET token=excluded.token,generation=excluded.generation,lease_until=excluded.lease_until,started_at=excluded.started_at,kind=excluded.kind RETURNING * INTO r;
  RETURN jsonb_build_array(to_jsonb(w)||jsonb_build_object('scheduling_token',r.token,'lease_until',r.lease_until,'processing_started_at',r.started_at,'execution_kind',r.kind));
 END IF;
 IF (SELECT count(*) FROM public.billing_consumer_work_partitions WHERE stripe_scope=p_scope AND lease_until>stamp)>=8 OR (SELECT count(*) FROM public.billing_consumer_work_partitions WHERE stripe_scope=p_scope AND consumer=p_consumer AND lease_until>stamp)>=4 THEN RETURN '[]'; END IF;
 SELECT * INTO p FROM public.billing_consumer_work_partitions WHERE stripe_scope=p_scope AND consumer=p_consumer AND partition_kind=w.partition_kind AND partition_key=w.partition_key FOR UPDATE SKIP LOCKED;
 IF NOT FOUND OR p.lease_until>stamp THEN RETURN '[]'; END IF;
 SELECT * INTO w FROM public.billing_consumer_work WHERE stripe_scope=p_scope AND stripe_event_id=p_event AND consumer=p_consumer FOR UPDATE SKIP LOCKED;
 stamp:=clock_timestamp();
 IF NOT FOUND OR NOT ((w.state IN ('pending','retry_wait','dependency_wait') AND w.next_attempt_at<=stamp) OR (w.state='processing' AND w.lease_until<=stamp)) THEN RETURN '[]'; END IF;
 token:=gen_random_uuid();
 UPDATE public.billing_consumer_work_partitions SET scheduling_token=token,scheduling_generation=scheduling_generation+1,lease_until=stamp+interval '120 seconds',last_claimed_at=stamp,updated_at=stamp WHERE stripe_scope=p_scope AND consumer=p_consumer AND partition_kind=w.partition_kind AND partition_key=w.partition_key RETURNING * INTO p;
 UPDATE public.billing_consumer_work SET state='processing',attempts=attempts+1,retries=attempts,scheduling_token=token,scheduling_generation=scheduling_generation+1,partition_generation=p.scheduling_generation,lease_until=p.lease_until,processing_started_at=stamp,settled_token=NULL,updated_at=stamp WHERE stripe_scope=p_scope AND stripe_event_id=p_event AND consumer=p_consumer RETURNING * INTO w;
 RETURN jsonb_build_array(to_jsonb(w)||jsonb_build_object('execution_kind','consumer'));
END $claim$;
-- Bound lookup-only routing proof. No provider/metadata-based financial authority.
CREATE FUNCTION public.billing_consumer_worker_bind(p_scope text,p_event text,p_consumer text,p_context jsonb,p_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $bind$
DECLARE w public.billing_consumer_work%ROWTYPE;customer text;u text;linked text;r public.billing_consumer_work_routing%ROWTYPE;kind text;stamp timestamptz;
BEGIN
 kind:=CASE p_consumer WHEN 'finance' THEN 'customer' WHEN 'entitlement' THEN 'user' END;
 IF p_consumer='finance' AND coalesce(p_key,'') !~ '^cus_[A-Za-z0-9]{1,240}$' OR p_consumer='entitlement' AND coalesce(p_key,'') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'BILLING_WORK_BINDING'; END IF;
 -- Acquire the destination partition BEFORE the work; never upgrade work->partition.
 INSERT INTO public.billing_consumer_work_partitions(stripe_scope,consumer,partition_kind,partition_key) VALUES(p_scope,p_consumer,kind,p_key) ON CONFLICT DO NOTHING;
 PERFORM 1 FROM public.billing_consumer_work_partitions WHERE stripe_scope=p_scope AND consumer=p_consumer AND partition_kind=kind AND partition_key=p_key FOR UPDATE;
 w:=public.billing_consumer_worker_guard(p_scope,p_event,p_consumer,p_context);
 IF w.partition_key IS NOT NULL THEN RAISE EXCEPTION 'BILLING_WORK_BINDING'; END IF;
 SELECT * INTO r FROM public.billing_consumer_work_routing WHERE stripe_scope=p_scope AND stripe_event_id=p_event AND consumer=p_consumer;
 IF r.kind<>'routing' THEN RAISE EXCEPTION 'BILLING_WORK_BINDING'; END IF;
 IF p_consumer='finance' THEN
  customer:=w.evidence->>'customer';
  -- Stored root evidence is checked even when the signed snapshot has a customer.
  linked:=NULL;
  CASE w.evidence->>'subject_type'
  WHEN 'subscription' THEN SELECT stripe_customer_id INTO linked FROM public.billing_finance_subscriptions WHERE stripe_scope=p_scope AND stripe_object_id=w.evidence->>'subject_id';
  WHEN 'invoice' THEN SELECT stripe_customer_id INTO linked FROM public.billing_invoices WHERE stripe_scope=p_scope AND stripe_object_id=w.evidence->>'subject_id';
  WHEN 'charge' THEN SELECT stripe_customer_id INTO linked FROM public.billing_payments WHERE stripe_scope=p_scope AND stripe_object_id=w.evidence->>'subject_id';
  ELSE NULL; END CASE;
  IF customer IS NOT NULL AND linked IS NOT NULL AND customer<>linked THEN RAISE EXCEPTION 'BILLING_WORK_BINDING'; END IF;
  IF customer IS NULL THEN
   CASE w.evidence->>'subject_type'
   WHEN 'subscription' THEN SELECT stripe_customer_id INTO customer FROM public.billing_finance_subscriptions WHERE stripe_scope=p_scope AND stripe_object_id=w.evidence->>'subject_id';
   WHEN 'invoice' THEN SELECT stripe_customer_id INTO customer FROM public.billing_invoices WHERE stripe_scope=p_scope AND stripe_object_id=w.evidence->>'subject_id';
   WHEN 'charge' THEN SELECT stripe_customer_id INTO customer FROM public.billing_payments WHERE stripe_scope=p_scope AND stripe_object_id=w.evidence->>'subject_id';
   WHEN 'refund' THEN
    SELECT stripe_charge_id INTO linked FROM public.billing_refunds WHERE stripe_scope=p_scope AND stripe_object_id=w.evidence->>'subject_id';
    IF linked IS NOT NULL AND w.evidence->'object'->>'charge' IS NOT NULL AND linked<>w.evidence->'object'->>'charge' THEN RAISE EXCEPTION 'BILLING_WORK_BINDING'; END IF;
    linked:=coalesce(linked,w.evidence->'object'->>'charge');
    SELECT stripe_customer_id INTO customer FROM public.billing_payments WHERE stripe_scope=p_scope AND stripe_object_id=linked;
   ELSE NULL; END CASE;
  END IF;
  IF customer IS NULL OR customer<>p_key THEN RAISE EXCEPTION 'BILLING_WORK_BINDING'; END IF;
 ELSE
  linked:=CASE WHEN w.evidence->>'subject_type'='subscription' THEN w.evidence->>'subject_id' ELSE coalesce(w.evidence->'object'->'parent'->'subscription_details'->>'subscription',w.evidence->'object'->>'subscription') END;
  SELECT user_id::text INTO customer FROM public.billing_subscriptions WHERE stripe_scope=p_scope AND stripe_subscription_id=linked;
  u:=w.evidence->'object'->>'dmi_user_id';
  IF w.evidence->'object'->>'namespace'='dmi_cards_v2' AND u IS NOT NULL THEN
   IF customer IS NOT NULL AND customer<>u THEN RAISE EXCEPTION 'BILLING_WORK_BINDING'; END IF;
   IF w.evidence->'object'->>'dmi_profile_id' IS NOT NULL AND w.evidence->'object'->>'dmi_profile_id'<>u THEN RAISE EXCEPTION 'BILLING_WORK_BINDING'; END IF;
   IF w.evidence->'object'->>'client_reference_id' IS NOT NULL AND w.evidence->'object'->>'client_reference_id'<>u THEN RAISE EXCEPTION 'BILLING_WORK_BINDING'; END IF;
  ELSE
   linked:=CASE WHEN w.evidence->>'subject_type'='subscription' THEN w.evidence->>'subject_id' ELSE coalesce(w.evidence->'object'->'parent'->'subscription_details'->>'subscription',w.evidence->'object'->>'subscription') END;
   SELECT user_id::text INTO u FROM public.billing_subscriptions WHERE stripe_scope=p_scope AND stripe_subscription_id=linked;
  END IF;
  IF u IS NULL OR u<>p_key OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_key::uuid) THEN RAISE EXCEPTION 'BILLING_WORK_BINDING'; END IF;
 END IF;
 stamp:=clock_timestamp();
 PERFORM public.billing_consumer_worker_guard(p_scope,p_event,p_consumer,p_context);
 UPDATE public.billing_consumer_work SET partition_kind=kind,partition_key=p_key,partition_basis='verified_relationship',state='pending',next_attempt_at=stamp,updated_at=stamp WHERE stripe_scope=p_scope AND stripe_event_id=p_event AND consumer=p_consumer;
 DELETE FROM public.billing_consumer_work_routing WHERE stripe_scope=p_scope AND stripe_event_id=p_event AND consumer=p_consumer;
 RETURN jsonb_build_object('bound',true);
END $bind$;
-- Only this dispatch is supplied to queued consumer adapters. No dynamic SQL/function names.
CREATE FUNCTION public.billing_consumer_worker_authority(p_scope text,p_event text,p_consumer text,p_context jsonb,p_action text,p_user uuid DEFAULT NULL,p_token uuid DEFAULT NULL,p_input jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET lock_timeout='3s' AS $authority$
DECLARE w public.billing_consumer_work%ROWTYPE;result jsonb;receipt_only boolean;
BEGIN
 w:=public.billing_consumer_worker_guard(p_scope,p_event,p_consumer,p_context);
 receipt_only:=w.partition_key IS NULL;
 IF receipt_only AND NOT public.billing_consumer_worker_ignored(p_consumer,w.event_type) THEN RAISE EXCEPTION 'BILLING_WORK_AUTHORITY'; END IF;
 IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR (p_input ? 'event_id' AND p_input->>'event_id' IS DISTINCT FROM p_event) OR (p_input ? 'id' AND p_input->>'id' IS DISTINCT FROM p_event) THEN RAISE EXCEPTION 'BILLING_WORK_AUTHORITY'; END IF;
 IF p_consumer='entitlement' AND p_action='commit' AND (p_input->>'event_id' IS DISTINCT FROM p_event OR (p_input->>'event_created')::bigint IS DISTINCT FROM w.event_created OR p_input->>'event_token' IS NULL) THEN RAISE EXCEPTION 'BILLING_WORK_AUTHORITY'; END IF;
 IF p_action='event_claim' THEN
  IF p_input->>'id' IS DISTINCT FROM p_event OR p_input->>'type' IS DISTINCT FROM w.event_type THEN RAISE EXCEPTION 'BILLING_WORK_AUTHORITY'; END IF;
  IF p_consumer='finance' THEN
   IF p_input->>'subject' IS DISTINCT FROM w.evidence->>'subject_id' OR (p_input->>'created')::timestamptz IS DISTINCT FROM to_timestamp(w.event_created) THEN RAISE EXCEPTION 'BILLING_WORK_AUTHORITY'; END IF;
   result:=public.billing_finance_command('event_claim',p_scope,NULL,p_input);
  ELSE
   IF (p_input->>'created')::bigint IS DISTINCT FROM w.event_created OR p_input->>'subject' IS DISTINCT FROM w.evidence->>'subject_id' THEN RAISE EXCEPTION 'BILLING_WORK_AUTHORITY'; END IF;
   result:=public.billing_foundation_command('event_claim',p_scope,NULL,NULL,p_input);
  END IF;
 ELSIF p_consumer='finance' THEN
  IF p_user IS NOT NULL THEN RAISE EXCEPTION 'BILLING_WORK_AUTHORITY'; END IF;
  IF p_action='read_protocol' THEN result:=public.billing_finance_partition_command('read_protocol',p_scope);
  ELSIF p_action='event_fail' AND NOT receipt_only THEN result:=public.billing_finance_command('event_fail',p_scope,p_token,p_input);
  ELSIF p_action='partition_ignored' AND public.billing_consumer_worker_ignored(p_consumer,w.event_type) THEN result:=public.billing_finance_partition_command('complete_unsupported',p_scope,NULL,p_token,p_input);
  ELSIF NOT receipt_only AND p_action IN ('partition_claim','partition_release','partition_bind','partition_commit') THEN
   IF w.partition_kind<>'customer' OR p_input->>'customer' IS DISTINCT FROM w.partition_key THEN RAISE EXCEPTION 'BILLING_WORK_AUTHORITY'; END IF;
   IF p_action='partition_release' THEN
    PERFORM 1 FROM public.billing_finance_protocol_control WHERE stripe_scope=p_scope FOR SHARE;
    PERFORM 1 FROM public.billing_finance_sync_state WHERE stripe_scope=p_scope AND resource_type='customer' AND resource_key=w.partition_key AND lease_token=p_token AND lease_until>clock_timestamp() AND lease_protocol_epoch=(p_input->>'expected_epoch')::bigint FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'FINANCE_PARTITION_FENCE'; END IF;
   END IF;
   result:=public.billing_finance_partition_command(CASE p_action WHEN 'partition_claim' THEN 'claim_customer' WHEN 'partition_release' THEN 'release_customer' WHEN 'partition_bind' THEN 'bind_receipt' ELSE 'commit_customer' END,p_scope,w.partition_key,p_token,p_input-'customer');
  ELSIF NOT receipt_only AND p_action='foreign_complete' THEN result:=public.billing_finance_complete_foreign(p_scope,p_event,p_token,(p_input->>'expected_epoch')::bigint,p_input->'evidence',p_input->'proofs');
  ELSE RAISE EXCEPTION 'BILLING_WORK_AUTHORITY'; END IF;
 ELSE
  IF p_action IN ('event_finish','event_fail') THEN
   IF receipt_only AND (p_action<>'event_finish' OR p_input->>'outcome' IS DISTINCT FROM 'unhandled_event_type') THEN RAISE EXCEPTION 'BILLING_WORK_AUTHORITY'; END IF;
   result:=public.billing_foundation_command(p_action,p_scope,NULL,p_token,p_input);
  ELSIF NOT receipt_only AND p_action IN ('claim','bind','commit','release') THEN
   IF w.partition_kind<>'user' OR p_user::text IS DISTINCT FROM w.partition_key THEN RAISE EXCEPTION 'BILLING_WORK_AUTHORITY'; END IF;
   IF p_action='release' THEN
    PERFORM 1 FROM public.billing_accounts WHERE stripe_scope=p_scope AND user_id=p_user AND lease_token=p_token AND lease_until>clock_timestamp() FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'BILLING_FENCE'; END IF;
   END IF;
   result:=public.billing_foundation_command(p_action,p_scope,p_user,p_token,p_input);
  ELSE RAISE EXCEPTION 'BILLING_WORK_AUTHORITY'; END IF;
 END IF;
 -- If ownership/deadline expired while the original RPC ran, roll ALL its effects back.
 PERFORM public.billing_consumer_worker_guard(p_scope,p_event,p_consumer,p_context);
 RETURN result;
END $authority$;
CREATE FUNCTION public.billing_consumer_worker_settle(p_scope text,p_event text,p_consumer text,p_context jsonb,p_action text,p_input jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $settle$
DECLARE w public.billing_consumer_work%ROWTYPE;r public.billing_consumer_work_routing%ROWTYPE;receipt jsonb;stamp timestamptz;until_time timestamptz;
BEGIN
 IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR p_input-ARRAY['failure_category','delay_seconds','terminal_result']<>'{}' THEN RAISE EXCEPTION 'BILLING_WORK_INPUT'; END IF;
 IF p_action='renew' AND p_input<>'{}' OR p_action='complete' AND (p_input-ARRAY['terminal_result']<>'{}' OR NOT p_input ? 'terminal_result') OR p_action='needs_attention' AND p_input-ARRAY['failure_category']<>'{}' OR p_action IN ('retry_wait','dependency_wait') AND p_input-ARRAY['failure_category','delay_seconds']<>'{}' THEN RAISE EXCEPTION 'BILLING_WORK_INPUT'; END IF;
 -- Lost completion response may be inspected and retried only with the original fence.
 SELECT * INTO w FROM public.billing_consumer_work WHERE stripe_scope=p_scope AND stripe_event_id=p_event AND consumer=p_consumer;
 IF w.state='completed' AND p_action='complete' AND w.settled_token::text=p_context->>'token' AND w.scheduling_generation::text=p_context->>'generation' AND (w.partition_generation::text IS NOT DISTINCT FROM p_context->>'partition_generation') AND w.terminal_result=p_input->>'terminal_result' THEN RETURN jsonb_build_object('state','completed'); END IF;
 w:=public.billing_consumer_worker_guard(p_scope,p_event,p_consumer,p_context,true);
 IF w.partition_key IS NOT NULL THEN RETURN public.billing_consumer_work_update(p_action,p_scope,p_event,p_consumer,p_context-'expires_at'||p_input); END IF;
 SELECT * INTO r FROM public.billing_consumer_work_routing WHERE stripe_scope=p_scope AND stripe_event_id=p_event AND consumer=p_consumer;
 stamp:=clock_timestamp();
 IF p_action='renew' THEN
  until_time:=least(stamp+interval '120 seconds',r.started_at+interval '240 seconds');
  UPDATE public.billing_consumer_work_routing SET lease_until=until_time WHERE stripe_scope=p_scope AND stripe_event_id=p_event AND consumer=p_consumer;
  RETURN jsonb_build_object('state','processing','lease_until',until_time);
 END IF;
 IF p_action='complete' THEN
  receipt:=public.billing_consumer_worker_receipt(p_scope,p_event,p_consumer);
  IF (p_consumer='finance' AND receipt->>'state' NOT IN ('processed','ignored')) OR (p_consumer='entitlement' AND receipt->>'state' IS DISTINCT FROM 'processed') OR p_input->>'terminal_result' IS DISTINCT FROM receipt->>'state' THEN RAISE EXCEPTION 'BILLING_WORK_RECEIPT_NOT_TERMINAL'; END IF;
 ELSIF p_action IN ('retry_wait','dependency_wait','needs_attention') THEN
  IF p_input->>'failure_category' IS NULL OR p_input->>'failure_category' NOT IN ('lease_busy','dependency_unresolved','ownership_conflict','ownership_stale','ambiguous_outcome','provider_unavailable','store_unavailable','invalid_evidence','worker_expired','retry_exhausted','routing_unresolved') THEN RAISE EXCEPTION 'BILLING_WORK_INPUT'; END IF;
  IF p_action<>'needs_attention' AND (jsonb_typeof(p_input->'delay_seconds') IS DISTINCT FROM 'number' OR (p_input->>'delay_seconds')::numeric<>trunc((p_input->>'delay_seconds')::numeric) OR (p_input->>'delay_seconds')::numeric NOT BETWEEN 1 AND 86400) THEN RAISE EXCEPTION 'BILLING_WORK_INPUT'; END IF;
 ELSE RAISE EXCEPTION 'BILLING_WORK_INPUT'; END IF;
 UPDATE public.billing_consumer_work SET state=CASE WHEN p_action='complete' THEN 'completed' ELSE p_action END,settled_token=r.token,
 next_attempt_at=CASE WHEN p_action IN ('retry_wait','dependency_wait') THEN stamp+make_interval(secs=>(p_input->>'delay_seconds')::integer) ELSE next_attempt_at END,
 failure_category=CASE WHEN p_action='complete' THEN NULL ELSE p_input->>'failure_category' END,
 terminal_result=CASE WHEN p_action='complete' THEN p_input->>'terminal_result' END,completed_at=CASE WHEN p_action='complete' THEN stamp END,updated_at=stamp
 WHERE stripe_scope=p_scope AND stripe_event_id=p_event AND consumer=p_consumer;
 DELETE FROM public.billing_consumer_work_routing WHERE stripe_scope=p_scope AND stripe_event_id=p_event AND consumer=p_consumer;
 RETURN jsonb_build_object('state',CASE WHEN p_action='complete' THEN 'completed' ELSE p_action END);
END $settle$;
ALTER TABLE public.billing_consumer_work_routing ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_consumer_work_routing FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.billing_consumer_worker_ignored(text,text),public.billing_consumer_worker_guard(text,text,text,jsonb,boolean),public.billing_consumer_worker_receipt(text,text,text),public.billing_consumer_worker_claim(text,text,text),public.billing_consumer_worker_bind(text,text,text,jsonb,text),public.billing_consumer_worker_authority(text,text,text,jsonb,text,uuid,uuid,jsonb),public.billing_consumer_worker_settle(text,text,text,jsonb,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.billing_consumer_worker_receipt(text,text,text),public.billing_consumer_worker_claim(text,text,text),public.billing_consumer_worker_bind(text,text,text,jsonb,text),public.billing_consumer_worker_authority(text,text,text,jsonb,text,uuid,uuid,jsonb),public.billing_consumer_worker_settle(text,text,text,jsonb,text,jsonb) TO service_role;
COMMIT;
