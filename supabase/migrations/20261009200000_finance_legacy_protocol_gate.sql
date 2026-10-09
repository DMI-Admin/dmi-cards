-- Legacy-only epoch fencing. No customer activation or new financial-write path.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DO $owner$
BEGIN
 IF (SELECT proowner FROM pg_catalog.pg_proc WHERE oid='public.billing_finance_command(text,text,uuid,jsonb)'::regprocedure)
  IS DISTINCT FROM (CURRENT_USER::pg_catalog.regrole)::oid THEN RAISE EXCEPTION 'FINANCE_PROTOCOL_OWNER'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='public.billing_finance_protocol_control'::regclass
  AND conname='billing_finance_protocol_foundation_legacy' AND convalidated)
 THEN RAISE EXCEPTION 'FINANCE_PROTOCOL_FOUNDATION_REQUIRED'; END IF;
END $owner$;
-- DDL excludes concurrent old commands while the drain prerequisite is checked.
ALTER TABLE public.billing_finance_sync_state ADD COLUMN lease_protocol_epoch bigint
 CHECK(lease_protocol_epoch IS NULL OR lease_protocol_epoch BETWEEN 0 AND 9007199254740991);
DO $drain$
BEGIN
 IF EXISTS(SELECT 1 FROM public.billing_finance_sync_state WHERE resource_type='scope' AND resource_key='finance_v1'
  AND lease_token IS NOT NULL AND lease_until>clock_timestamp()) THEN RAISE EXCEPTION 'FINANCE_PROTOCOL_DRAIN_REQUIRED'; END IF;
 IF EXISTS(SELECT 1 FROM public.billing_finance_protocol_control WHERE mode<>'legacy' OR epoch<>0)
 THEN RAISE EXCEPTION 'FINANCE_PROTOCOL_FOUNDATION_REQUIRED'; END IF;
END $drain$;
-- Historical leases stay unbound; expired authority is replaced only by a new claim.
CREATE OR REPLACE FUNCTION public.billing_finance_command(p_action text,p_scope text,p_token uuid DEFAULT NULL,p_input jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE
 stamp timestamptz:=clock_timestamp(); lockrow public.billing_finance_sync_state%ROWTYPE;
 delivery public.billing_finance_event_deliveries%ROWTYPE; runrow public.billing_finance_sync_runs%ROWTYPE;
 protocol public.billing_finance_protocol_control%ROWTYPE;
 entry jsonb; rowdata jsonb; prior jsonb;
 object_key text; count_written integer:=0; v_revision bigint;
BEGIN
 IF p_scope IS NULL OR p_scope !~ '^acct_[A-Za-z0-9]+:(test|live)$' OR jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR octet_length(p_input::text)>1048576 THEN RAISE EXCEPTION 'FINANCE_INPUT'; END IF;
 -- Shared protocol authority precedes every lease/receipt/resource lock.
 INSERT INTO public.billing_finance_protocol_control(stripe_scope) VALUES(p_scope) ON CONFLICT DO NOTHING;
 SELECT * INTO protocol FROM public.billing_finance_protocol_control WHERE stripe_scope=p_scope FOR SHARE;
 stamp:=clock_timestamp();
 IF p_action='claim' AND protocol.mode<>'legacy' THEN RAISE EXCEPTION 'FINANCE_PROTOCOL_CLAIM_BLOCKED'; END IF;
 IF (p_action='commit' AND protocol.mode NOT IN ('legacy','draining_to_customer'))
  OR (p_action='run_start' AND protocol.mode<>'legacy')
  THEN RAISE EXCEPTION 'FINANCE_PROTOCOL_WRITE_BLOCKED'; END IF;
 IF p_action='event_claim' THEN
  IF p_input - ARRAY['id','type','subject','created']::text[] <> '{}'::jsonb OR p_input->>'id' !~ '^evt_[A-Za-z0-9]+$'
   OR coalesce(p_input->>'type','')='' OR coalesce(p_input->>'subject','')='' OR NOT(p_input ?& ARRAY['id','type','subject','created']) THEN RAISE EXCEPTION 'FINANCE_EVENT'; END IF;
  INSERT INTO public.billing_finance_event_deliveries(stripe_scope,consumer_version,stripe_event_id,event_type,subject_id,event_created_at,state)
   VALUES(p_scope,'finance_v1',p_input->>'id',p_input->>'type',p_input->>'subject',(p_input->>'created')::timestamptz,'received') ON CONFLICT DO NOTHING;
  SELECT * INTO delivery FROM public.billing_finance_event_deliveries WHERE stripe_scope=p_scope AND consumer_version='finance_v1' AND stripe_event_id=p_input->>'id' FOR UPDATE;
  IF delivery.event_type IS DISTINCT FROM p_input->>'type' OR delivery.subject_id IS DISTINCT FROM p_input->>'subject' OR delivery.event_created_at IS DISTINCT FROM (p_input->>'created')::timestamptz THEN RAISE EXCEPTION 'FINANCE_EVENT_CONFLICT'; END IF;
  IF delivery.state IN ('processed','ignored') THEN RETURN jsonb_build_object('duplicate',true); END IF;
  IF delivery.state='processing' AND delivery.lease_until>stamp THEN RAISE EXCEPTION 'FINANCE_BUSY'; END IF;
  UPDATE public.billing_finance_event_deliveries SET state='processing',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=stamp+interval '120 seconds',error_code=NULL,updated_at=stamp
   WHERE stripe_scope=p_scope AND consumer_version='finance_v1' AND stripe_event_id=delivery.stripe_event_id RETURNING * INTO delivery;
  RETURN jsonb_build_object('token',delivery.lease_token);
 ELSIF p_action='event_fail' THEN
  IF p_input - ARRAY['id','error']::text[] <> '{}'::jsonb OR coalesce(p_input->>'error','') !~ '^[A-Z_]{1,80}$' THEN RAISE EXCEPTION 'FINANCE_INPUT'; END IF;
  UPDATE public.billing_finance_event_deliveries SET state='failed',lease_token=NULL,lease_until=NULL,error_code=p_input->>'error',updated_at=stamp
   WHERE stripe_scope=p_scope AND consumer_version='finance_v1' AND stripe_event_id=p_input->>'id' AND state='processing' AND lease_token=p_token AND lease_until>stamp;
  IF NOT FOUND THEN RAISE EXCEPTION 'FINANCE_FENCE'; END IF; RETURN '{}'::jsonb;
 ELSIF p_action='claim' THEN
  IF p_input<>'{}'::jsonb THEN RAISE EXCEPTION 'FINANCE_INPUT'; END IF;
  INSERT INTO public.billing_finance_sync_state(stripe_scope,resource_type,resource_key) VALUES(p_scope,'scope','finance_v1') ON CONFLICT DO NOTHING;
  SELECT * INTO lockrow FROM public.billing_finance_sync_state WHERE stripe_scope=p_scope AND resource_type='scope' AND resource_key='finance_v1' FOR UPDATE;
  stamp:=clock_timestamp();
  IF lockrow.lease_until>stamp THEN RAISE EXCEPTION 'FINANCE_BUSY'; END IF;
  UPDATE public.billing_finance_sync_state SET lease_token=gen_random_uuid(),lease_until=stamp+interval '120 seconds',revision=revision+1,lease_protocol_epoch=protocol.epoch,updated_at=stamp
   WHERE stripe_scope=p_scope AND resource_type='scope' AND resource_key='finance_v1' RETURNING * INTO lockrow;
  RETURN jsonb_build_object('token',lockrow.lease_token,'revision',lockrow.revision::text);
 ELSIF p_action='release' THEN
  -- A stale/unbound lease cannot clear successor authority, in any mode.
  SELECT * INTO lockrow FROM public.billing_finance_sync_state WHERE stripe_scope=p_scope AND resource_type='scope' AND resource_key='finance_v1' FOR UPDATE;
  IF NOT FOUND OR p_token IS NULL OR lockrow.lease_token IS DISTINCT FROM p_token THEN RAISE EXCEPTION 'FINANCE_FENCE'; END IF;
  IF lockrow.lease_protocol_epoch IS DISTINCT FROM protocol.epoch THEN RAISE EXCEPTION 'FINANCE_PROTOCOL_EPOCH'; END IF;
  UPDATE public.billing_finance_sync_state SET lease_token=NULL,lease_until=NULL,lease_protocol_epoch=NULL,updated_at=clock_timestamp()
   WHERE stripe_scope=p_scope AND resource_type='scope' AND resource_key='finance_v1' AND lease_token=p_token;
  RETURN '{}'::jsonb;
 END IF;
 SELECT * INTO lockrow FROM public.billing_finance_sync_state WHERE stripe_scope=p_scope AND resource_type='scope' AND resource_key='finance_v1' FOR UPDATE;
 stamp:=clock_timestamp();
 IF NOT FOUND OR p_token IS NULL OR lockrow.lease_token IS DISTINCT FROM p_token OR lockrow.lease_until<=stamp THEN RAISE EXCEPTION 'FINANCE_FENCE'; END IF;
 IF lockrow.lease_protocol_epoch IS DISTINCT FROM protocol.epoch THEN RAISE EXCEPTION 'FINANCE_PROTOCOL_EPOCH'; END IF;
 IF p_action='run_start' THEN
  IF p_input - ARRAY['id','mode','resource','actor','start','end']::text[] <> '{}'::jsonb OR p_input->>'resource' NOT IN ('recent_invoices','open_invoices','recent_failures','pending_refunds','active_subscriptions') THEN RAISE EXCEPTION 'FINANCE_RUN_INPUT'; END IF;
  INSERT INTO public.billing_finance_sync_runs(id,stripe_scope,mode,resource_type,status,actor,window_start,window_end,cursor,coverage_quality,started_at)
   VALUES((p_input->>'id')::uuid,p_scope,p_input->>'mode',p_input->>'resource','running',p_input->>'actor',(p_input->>'start')::timestamptz,(p_input->>'end')::timestamptz,'{}','partial',stamp) ON CONFLICT DO NOTHING;
  SELECT * INTO runrow FROM public.billing_finance_sync_runs WHERE id=(p_input->>'id')::uuid;
  IF runrow.stripe_scope IS DISTINCT FROM p_scope OR runrow.mode IS DISTINCT FROM p_input->>'mode' OR runrow.resource_type IS DISTINCT FROM p_input->>'resource' OR runrow.actor IS DISTINCT FROM p_input->>'actor' OR runrow.window_start IS DISTINCT FROM (p_input->>'start')::timestamptz OR runrow.window_end IS DISTINCT FROM (p_input->>'end')::timestamptz THEN RAISE EXCEPTION 'FINANCE_RUN_CONFLICT'; END IF;
  RETURN to_jsonb(runrow);
 END IF;
 IF p_action IS DISTINCT FROM 'commit' OR p_input - ARRAY['expected_scope_revision','event_id','event_token','ignored','subscriptions','items','invoices','payments','allocations','attempts','refunds','activity','run']::text[] <> '{}'::jsonb THEN RAISE EXCEPTION 'FINANCE_COMMAND'; END IF;
 IF (p_input->>'expected_scope_revision')::bigint IS DISTINCT FROM lockrow.revision THEN RAISE EXCEPTION 'FINANCE_REVISION'; END IF;
 IF p_input ? 'event_id' THEN
  SELECT * INTO delivery FROM public.billing_finance_event_deliveries WHERE stripe_scope=p_scope AND consumer_version='finance_v1' AND stripe_event_id=p_input->>'event_id' FOR UPDATE;
  IF NOT FOUND OR delivery.state<>'processing' OR delivery.lease_until<=stamp OR delivery.lease_token IS DISTINCT FROM (p_input->>'event_token')::uuid THEN RAISE EXCEPTION 'FINANCE_EVENT_FENCE'; END IF;
 END IF;

 IF p_input ? 'subscriptions' AND (jsonb_typeof(p_input->'subscriptions')<>'array' OR jsonb_array_length(p_input->'subscriptions')>200) THEN RAISE EXCEPTION 'FINANCE_BATCH'; END IF;
 FOR entry IN SELECT value FROM jsonb_array_elements(coalesce(p_input->'subscriptions','[]')) LOOP
  IF jsonb_typeof(entry)<>'object' OR entry - ARRAY['row','expected_revision']::text[] <>'{}'::jsonb THEN RAISE EXCEPTION 'FINANCE_ROW'; END IF;
  rowdata:=entry->'row';
  IF jsonb_typeof(rowdata) IS DISTINCT FROM 'object' OR rowdata - ARRAY['stripe_scope','stripe_object_id','stripe_created_at','source_event_id','source_event_created_at','stripe_api_version','normalizer_version','verified_at','user_id','stripe_customer_id','status','cancel_at_period_end','cancel_at','canceled_at','ended_at','trial_end','collection_paused','linkage_status','valuation_status','valuation_reason','items_complete','discount_context']::text[]<>'{}'::jsonb OR rowdata->>'stripe_scope' IS DISTINCT FROM p_scope THEN RAISE EXCEPTION 'FINANCE_ROW_SCOPE'; END IF;
  rowdata:=to_jsonb(jsonb_populate_record(NULL::public.billing_finance_subscriptions,rowdata))-ARRAY['revision','created_at','updated_at']::text[];
  object_key:=rowdata->>'stripe_object_id';
  SELECT to_jsonb(t) INTO prior FROM public.billing_finance_subscriptions t WHERE stripe_scope=p_scope AND stripe_object_id=object_key FOR UPDATE;
  IF coalesce((prior->>'revision')::bigint,0) IS DISTINCT FROM (entry->>'expected_revision')::bigint THEN RAISE EXCEPTION 'FINANCE_OBJECT_REVISION'; END IF;
  IF prior IS NOT NULL AND (rowdata->>'verified_at')::timestamptz < (prior->>'verified_at')::timestamptz THEN RAISE EXCEPTION 'FINANCE_STALE_SNAPSHOT'; END IF;
  IF prior IS NOT NULL THEN
   IF prior->>'stripe_scope' IS NOT NULL AND prior->>'stripe_scope' IS DISTINCT FROM rowdata->>'stripe_scope' THEN RAISE EXCEPTION 'FINANCE_IDENTITY'; END IF;
   IF prior->>'stripe_object_id' IS NOT NULL AND prior->>'stripe_object_id' IS DISTINCT FROM rowdata->>'stripe_object_id' THEN RAISE EXCEPTION 'FINANCE_IDENTITY'; END IF;
   IF prior->>'stripe_created_at' IS NOT NULL AND prior->>'stripe_created_at' IS DISTINCT FROM rowdata->>'stripe_created_at' THEN RAISE EXCEPTION 'FINANCE_IDENTITY'; END IF;
   IF prior->>'stripe_customer_id' IS NOT NULL AND prior->>'stripe_customer_id' IS DISTINCT FROM rowdata->>'stripe_customer_id' THEN RAISE EXCEPTION 'FINANCE_IDENTITY'; END IF;
  END IF;
  IF prior->>'user_id' IS NOT NULL AND prior->>'user_id' IS DISTINCT FROM rowdata->>'user_id' THEN RAISE EXCEPTION 'FINANCE_IDENTITY'; END IF;
  IF rowdata->>'linkage_status'='verified' AND NOT EXISTS(SELECT 1 FROM public.billing_accounts WHERE stripe_scope=p_scope AND stripe_customer_id=rowdata->>'stripe_customer_id' AND user_id=(rowdata->>'user_id')::uuid AND verified_at IS NOT NULL) THEN RAISE EXCEPTION 'FINANCE_UNVERIFIED_BINDING'; END IF;
  IF prior->>'status'='canceled' AND rowdata->>'status'<>'canceled' THEN RAISE EXCEPTION 'FINANCE_TERMINAL'; END IF;
  IF jsonb_typeof(rowdata->'discount_context') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'FINANCE_DISCOUNT'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(rowdata->'discount_context') d WHERE jsonb_typeof(d)<>'object' OR d - ARRAY['discount_id','coupon_id','applies_to','percent_off','amount_off_minor','currency','starts_at','ends_at']::text[]<>'{}'::jsonb) THEN RAISE EXCEPTION 'FINANCE_DISCOUNT'; END IF;
  v_revision:=coalesce((prior->>'revision')::bigint,0)+CASE WHEN prior IS NULL OR prior - ARRAY['created_at','updated_at','verified_at','revision','source_event_id','source_event_created_at','stripe_api_version','normalizer_version']::text[] IS DISTINCT FROM rowdata - ARRAY['created_at','updated_at','verified_at','revision','source_event_id','source_event_created_at','stripe_api_version','normalizer_version']::text[] THEN 1 ELSE 0 END;
  IF prior->>'source_event_created_at' IS NOT NULL AND (rowdata->>'source_event_created_at' IS NULL OR (rowdata->>'source_event_created_at')::timestamptz<(prior->>'source_event_created_at')::timestamptz) THEN rowdata:=rowdata||jsonb_build_object('source_event_created_at',prior->'source_event_created_at','source_event_id',prior->'source_event_id'); END IF;
  INSERT INTO public.billing_finance_subscriptions(stripe_scope,stripe_object_id,stripe_created_at,source_event_id,source_event_created_at,stripe_api_version,normalizer_version,verified_at,user_id,stripe_customer_id,status,cancel_at_period_end,cancel_at,canceled_at,ended_at,trial_end,collection_paused,linkage_status,valuation_status,valuation_reason,items_complete,discount_context,revision)
   SELECT r.stripe_scope,r.stripe_object_id,r.stripe_created_at,r.source_event_id,r.source_event_created_at,r.stripe_api_version,r.normalizer_version,r.verified_at,r.user_id,r.stripe_customer_id,r.status,r.cancel_at_period_end,r.cancel_at,r.canceled_at,r.ended_at,r.trial_end,r.collection_paused,r.linkage_status,r.valuation_status,r.valuation_reason,r.items_complete,r.discount_context,v_revision FROM jsonb_populate_record(NULL::public.billing_finance_subscriptions,rowdata) r
   ON CONFLICT(stripe_scope,stripe_object_id) DO UPDATE SET source_event_id=excluded.source_event_id,source_event_created_at=excluded.source_event_created_at,stripe_api_version=excluded.stripe_api_version,normalizer_version=excluded.normalizer_version,verified_at=excluded.verified_at,user_id=excluded.user_id,stripe_customer_id=excluded.stripe_customer_id,status=excluded.status,cancel_at_period_end=excluded.cancel_at_period_end,cancel_at=excluded.cancel_at,canceled_at=excluded.canceled_at,ended_at=excluded.ended_at,trial_end=excluded.trial_end,collection_paused=excluded.collection_paused,linkage_status=excluded.linkage_status,valuation_status=excluded.valuation_status,valuation_reason=excluded.valuation_reason,items_complete=excluded.items_complete,discount_context=excluded.discount_context,revision=excluded.revision,updated_at=stamp;
  count_written:=count_written+1;
 END LOOP;

 IF p_input ? 'items' AND (jsonb_typeof(p_input->'items')<>'array' OR jsonb_array_length(p_input->'items')>200) THEN RAISE EXCEPTION 'FINANCE_BATCH'; END IF;
 FOR entry IN SELECT value FROM jsonb_array_elements(coalesce(p_input->'items','[]')) LOOP
  IF jsonb_typeof(entry)<>'object' OR entry - ARRAY['row','expected_revision']::text[] <>'{}'::jsonb THEN RAISE EXCEPTION 'FINANCE_ROW'; END IF;
  rowdata:=entry->'row';
  IF jsonb_typeof(rowdata) IS DISTINCT FROM 'object' OR rowdata - ARRAY['stripe_scope','stripe_object_id','stripe_created_at','source_event_id','source_event_created_at','stripe_api_version','normalizer_version','verified_at','stripe_subscription_id','stripe_price_id','stripe_product_id','currency','quantity','unit_amount_minor','unit_amount_decimal_minor','recurring_interval','interval_count','usage_type','billing_scheme','tax_behavior','period_start','period_end','effective_cycle_amount_minor','valuation_status','valuation_reason','discount_context','removed_at','forecast_tax_evidence']::text[]<>'{}'::jsonb OR rowdata->>'stripe_scope' IS DISTINCT FROM p_scope THEN RAISE EXCEPTION 'FINANCE_ROW_SCOPE'; END IF;
  IF NOT(rowdata ? 'forecast_tax_evidence') THEN rowdata:=rowdata||jsonb_build_object('forecast_tax_evidence','{"version":1,"status":"unknown","basis":"unavailable","reason":"forecast_tax_evidence_missing","sourceRef":null,"verifiedAt":null,"configuration":null,"grossMinor":null,"taxMinor":null,"netMinor":null}'::jsonb); END IF;
  rowdata:=to_jsonb(jsonb_populate_record(NULL::public.billing_finance_subscription_items,rowdata))-ARRAY['revision','created_at','updated_at']::text[];
  object_key:=rowdata->>'stripe_object_id';
  SELECT to_jsonb(t) INTO prior FROM public.billing_finance_subscription_items t WHERE stripe_scope=p_scope AND stripe_object_id=object_key FOR UPDATE;
  IF coalesce((prior->>'revision')::bigint,0) IS DISTINCT FROM (entry->>'expected_revision')::bigint THEN RAISE EXCEPTION 'FINANCE_OBJECT_REVISION'; END IF;
  IF prior IS NOT NULL AND (rowdata->>'verified_at')::timestamptz < (prior->>'verified_at')::timestamptz THEN RAISE EXCEPTION 'FINANCE_STALE_SNAPSHOT'; END IF;
  IF prior IS NOT NULL THEN
   IF prior->>'stripe_scope' IS NOT NULL AND prior->>'stripe_scope' IS DISTINCT FROM rowdata->>'stripe_scope' THEN RAISE EXCEPTION 'FINANCE_IDENTITY'; END IF;
   IF prior->>'stripe_object_id' IS NOT NULL AND prior->>'stripe_object_id' IS DISTINCT FROM rowdata->>'stripe_object_id' THEN RAISE EXCEPTION 'FINANCE_IDENTITY'; END IF;
   IF prior->>'stripe_created_at' IS NOT NULL AND prior->>'stripe_created_at' IS DISTINCT FROM rowdata->>'stripe_created_at' THEN RAISE EXCEPTION 'FINANCE_IDENTITY'; END IF;
   IF prior->>'currency' IS NOT NULL AND prior->>'currency' IS DISTINCT FROM rowdata->>'currency' THEN RAISE EXCEPTION 'FINANCE_IDENTITY'; END IF;
   IF prior->>'stripe_subscription_id' IS NOT NULL AND prior->>'stripe_subscription_id' IS DISTINCT FROM rowdata->>'stripe_subscription_id' THEN RAISE EXCEPTION 'FINANCE_IDENTITY'; END IF;
  END IF;
  IF jsonb_typeof(rowdata->'discount_context') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'FINANCE_DISCOUNT'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(rowdata->'discount_context') d WHERE jsonb_typeof(d)<>'object' OR d - ARRAY['discount_id','coupon_id','applies_to','percent_off','amount_off_minor','currency','starts_at','ends_at']::text[]<>'{}'::jsonb) THEN RAISE EXCEPTION 'FINANCE_DISCOUNT'; END IF;
  v_revision:=coalesce((prior->>'revision')::bigint,0)+CASE WHEN prior IS NULL OR prior - ARRAY['created_at','updated_at','verified_at','revision','source_event_id','source_event_created_at','stripe_api_version','normalizer_version']::text[] IS DISTINCT FROM rowdata - ARRAY['created_at','updated_at','verified_at','revision','source_event_id','source_event_created_at','stripe_api_version','normalizer_version']::text[] THEN 1 ELSE 0 END;
  IF prior->>'source_event_created_at' IS NOT NULL AND (rowdata->>'source_event_created_at' IS NULL OR (rowdata->>'source_event_created_at')::timestamptz<(prior->>'source_event_created_at')::timestamptz) THEN rowdata:=rowdata||jsonb_build_object('source_event_created_at',prior->'source_event_created_at','source_event_id',prior->'source_event_id'); END IF;
  INSERT INTO public.billing_finance_subscription_items(stripe_scope,stripe_object_id,stripe_created_at,source_event_id,source_event_created_at,stripe_api_version,normalizer_version,verified_at,stripe_subscription_id,stripe_price_id,stripe_product_id,currency,quantity,unit_amount_minor,unit_amount_decimal_minor,recurring_interval,interval_count,usage_type,billing_scheme,tax_behavior,period_start,period_end,effective_cycle_amount_minor,valuation_status,valuation_reason,discount_context,removed_at,forecast_tax_evidence,revision)
   SELECT r.stripe_scope,r.stripe_object_id,r.stripe_created_at,r.source_event_id,r.source_event_created_at,r.stripe_api_version,r.normalizer_version,r.verified_at,r.stripe_subscription_id,r.stripe_price_id,r.stripe_product_id,r.currency,r.quantity,r.unit_amount_minor,r.unit_amount_decimal_minor,r.recurring_interval,r.interval_count,r.usage_type,r.billing_scheme,r.tax_behavior,r.period_start,r.period_end,r.effective_cycle_amount_minor,r.valuation_status,r.valuation_reason,r.discount_context,r.removed_at,r.forecast_tax_evidence,v_revision FROM jsonb_populate_record(NULL::public.billing_finance_subscription_items,rowdata) r
   ON CONFLICT(stripe_scope,stripe_object_id) DO UPDATE SET source_event_id=excluded.source_event_id,source_event_created_at=excluded.source_event_created_at,stripe_api_version=excluded.stripe_api_version,normalizer_version=excluded.normalizer_version,verified_at=excluded.verified_at,stripe_subscription_id=excluded.stripe_subscription_id,stripe_price_id=excluded.stripe_price_id,stripe_product_id=excluded.stripe_product_id,currency=excluded.currency,quantity=excluded.quantity,unit_amount_minor=excluded.unit_amount_minor,unit_amount_decimal_minor=excluded.unit_amount_decimal_minor,recurring_interval=excluded.recurring_interval,interval_count=excluded.interval_count,usage_type=excluded.usage_type,billing_scheme=excluded.billing_scheme,tax_behavior=excluded.tax_behavior,period_start=excluded.period_start,period_end=excluded.period_end,effective_cycle_amount_minor=excluded.effective_cycle_amount_minor,valuation_status=excluded.valuation_status,valuation_reason=excluded.valuation_reason,discount_context=excluded.discount_context,removed_at=excluded.removed_at,forecast_tax_evidence=excluded.forecast_tax_evidence,revision=excluded.revision,updated_at=stamp;
  count_written:=count_written+1;
 END LOOP;

 IF p_input ? 'invoices' AND (jsonb_typeof(p_input->'invoices')<>'array' OR jsonb_array_length(p_input->'invoices')>200) THEN RAISE EXCEPTION 'FINANCE_BATCH'; END IF;
 FOR entry IN SELECT value FROM jsonb_array_elements(coalesce(p_input->'invoices','[]')) LOOP
  IF jsonb_typeof(entry)<>'object' OR entry - ARRAY['row','expected_revision']::text[] <>'{}'::jsonb THEN RAISE EXCEPTION 'FINANCE_ROW'; END IF;
  rowdata:=entry->'row';
  IF jsonb_typeof(rowdata) IS DISTINCT FROM 'object' OR rowdata - ARRAY['stripe_scope','stripe_object_id','stripe_created_at','source_event_id','source_event_created_at','stripe_api_version','normalizer_version','verified_at','stripe_customer_id','stripe_subscription_id','number','status','billing_reason','collection_method','currency','subtotal_minor','discount_minor','tax_minor','total_minor','amount_due_minor','amount_paid_minor','amount_remaining_minor','attempt_count','due_at','next_payment_attempt_at','finalized_at','paid_at','voided_at','marked_uncollectible_at','payments_complete','tax_evidence']::text[]<>'{}'::jsonb OR rowdata->>'stripe_scope' IS DISTINCT FROM p_scope THEN RAISE EXCEPTION 'FINANCE_ROW_SCOPE'; END IF;
  IF NOT(rowdata ? 'tax_evidence') THEN rowdata:=rowdata||jsonb_build_object('tax_evidence','{"version":1,"status":"unknown","reason":"not_refreshed","basis":"unavailable","grossMinor":null,"taxMinor":null,"vatMinor":null,"netMinor":null,"automaticTaxEnabled":null,"automaticTaxStatus":null,"breakdownComplete":false,"linesComplete":false,"lineCount":null,"breakdown":[]}'::jsonb); END IF;
  rowdata:=to_jsonb(jsonb_populate_record(NULL::public.billing_invoices,rowdata))-ARRAY['revision','created_at','updated_at']::text[];
  object_key:=rowdata->>'stripe_object_id';
  SELECT to_jsonb(t) INTO prior FROM public.billing_invoices t WHERE stripe_scope=p_scope AND stripe_object_id=object_key FOR UPDATE;
  IF coalesce((prior->>'revision')::bigint,0) IS DISTINCT FROM (entry->>'expected_revision')::bigint THEN RAISE EXCEPTION 'FINANCE_OBJECT_REVISION'; END IF;
  IF prior IS NOT NULL AND (rowdata->>'verified_at')::timestamptz < (prior->>'verified_at')::timestamptz THEN RAISE EXCEPTION 'FINANCE_STALE_SNAPSHOT'; END IF;
  IF prior IS NOT NULL THEN
   IF prior->>'stripe_scope' IS NOT NULL AND prior->>'stripe_scope' IS DISTINCT FROM rowdata->>'stripe_scope' THEN RAISE EXCEPTION 'FINANCE_IDENTITY'; END IF;
   IF prior->>'stripe_object_id' IS NOT NULL AND prior->>'stripe_object_id' IS DISTINCT FROM rowdata->>'stripe_object_id' THEN RAISE EXCEPTION 'FINANCE_IDENTITY'; END IF;
   IF prior->>'stripe_created_at' IS NOT NULL AND prior->>'stripe_created_at' IS DISTINCT FROM rowdata->>'stripe_created_at' THEN RAISE EXCEPTION 'FINANCE_IDENTITY'; END IF;
   IF prior->>'stripe_customer_id' IS NOT NULL AND prior->>'stripe_customer_id' IS DISTINCT FROM rowdata->>'stripe_customer_id' THEN RAISE EXCEPTION 'FINANCE_IDENTITY'; END IF;
   IF prior->>'currency' IS NOT NULL AND prior->>'currency' IS DISTINCT FROM rowdata->>'currency' THEN RAISE EXCEPTION 'FINANCE_IDENTITY'; END IF;
   IF prior->>'stripe_subscription_id' IS NOT NULL AND prior->>'stripe_subscription_id' IS DISTINCT FROM rowdata->>'stripe_subscription_id' THEN RAISE EXCEPTION 'FINANCE_IDENTITY'; END IF;
  END IF;
  v_revision:=coalesce((prior->>'revision')::bigint,0)+CASE WHEN prior IS NULL OR prior - ARRAY['created_at','updated_at','verified_at','revision','source_event_id','source_event_created_at','stripe_api_version','normalizer_version']::text[] IS DISTINCT FROM rowdata - ARRAY['created_at','updated_at','verified_at','revision','source_event_id','source_event_created_at','stripe_api_version','normalizer_version']::text[] THEN 1 ELSE 0 END;
  IF prior->>'source_event_created_at' IS NOT NULL AND (rowdata->>'source_event_created_at' IS NULL OR (rowdata->>'source_event_created_at')::timestamptz<(prior->>'source_event_created_at')::timestamptz) THEN rowdata:=rowdata||jsonb_build_object('source_event_created_at',prior->'source_event_created_at','source_event_id',prior->'source_event_id'); END IF;
  INSERT INTO public.billing_invoices(stripe_scope,stripe_object_id,stripe_created_at,source_event_id,source_event_created_at,stripe_api_version,normalizer_version,verified_at,stripe_customer_id,stripe_subscription_id,number,status,billing_reason,collection_method,currency,subtotal_minor,discount_minor,tax_minor,total_minor,amount_due_minor,amount_paid_minor,amount_remaining_minor,attempt_count,due_at,next_payment_attempt_at,finalized_at,paid_at,voided_at,marked_uncollectible_at,payments_complete,tax_evidence,revision)
   SELECT r.stripe_scope,r.stripe_object_id,r.stripe_created_at,r.source_event_id,r.source_event_created_at,r.stripe_api_version,r.normalizer_version,r.verified_at,r.stripe_customer_id,r.stripe_subscription_id,r.number,r.status,r.billing_reason,r.collection_method,r.currency,r.subtotal_minor,r.discount_minor,r.tax_minor,r.total_minor,r.amount_due_minor,r.amount_paid_minor,r.amount_remaining_minor,r.attempt_count,r.due_at,r.next_payment_attempt_at,r.finalized_at,r.paid_at,r.voided_at,r.marked_uncollectible_at,r.payments_complete,r.tax_evidence,v_revision FROM jsonb_populate_record(NULL::public.billing_invoices,rowdata) r
   ON CONFLICT(stripe_scope,stripe_object_id) DO UPDATE SET source_event_id=excluded.source_event_id,source_event_created_at=excluded.source_event_created_at,stripe_api_version=excluded.stripe_api_version,normalizer_version=excluded.normalizer_version,verified_at=excluded.verified_at,stripe_customer_id=excluded.stripe_customer_id,stripe_subscription_id=excluded.stripe_subscription_id,number=excluded.number,status=excluded.status,billing_reason=excluded.billing_reason,collection_method=excluded.collection_method,currency=excluded.currency,subtotal_minor=excluded.subtotal_minor,discount_minor=excluded.discount_minor,tax_minor=excluded.tax_minor,total_minor=excluded.total_minor,amount_due_minor=excluded.amount_due_minor,amount_paid_minor=excluded.amount_paid_minor,amount_remaining_minor=excluded.amount_remaining_minor,attempt_count=excluded.attempt_count,due_at=excluded.due_at,next_payment_attempt_at=excluded.next_payment_attempt_at,finalized_at=excluded.finalized_at,paid_at=excluded.paid_at,voided_at=excluded.voided_at,marked_uncollectible_at=excluded.marked_uncollectible_at,payments_complete=excluded.payments_complete,tax_evidence=excluded.tax_evidence,revision=excluded.revision,updated_at=stamp;
  count_written:=count_written+1;
 END LOOP;

 IF p_input ? 'payments' AND (jsonb_typeof(p_input->'payments')<>'array' OR jsonb_array_length(p_input->'payments')>200) THEN RAISE EXCEPTION 'FINANCE_BATCH'; END IF;
 FOR entry IN SELECT value FROM jsonb_array_elements(coalesce(p_input->'payments','[]')) LOOP
  IF jsonb_typeof(entry)<>'object' OR entry - ARRAY['row','expected_revision']::text[] <>'{}'::jsonb THEN RAISE EXCEPTION 'FINANCE_ROW'; END IF;
  rowdata:=entry->'row';
  IF jsonb_typeof(rowdata) IS DISTINCT FROM 'object' OR rowdata - ARRAY['stripe_scope','stripe_object_id','stripe_created_at','source_event_id','source_event_created_at','stripe_api_version','normalizer_version','verified_at','stripe_customer_id','stripe_payment_intent_id','currency','status','amount_minor','amount_captured_minor','amount_refunded_minor','paid','captured','collected_at','collection_time_basis','attribution_status']::text[]<>'{}'::jsonb OR rowdata->>'stripe_scope' IS DISTINCT FROM p_scope THEN RAISE EXCEPTION 'FINANCE_ROW_SCOPE'; END IF;
  rowdata:=to_jsonb(jsonb_populate_record(NULL::public.billing_payments,rowdata))-ARRAY['revision','created_at','updated_at']::text[];
  object_key:=rowdata->>'stripe_object_id';
  SELECT to_jsonb(t) INTO prior FROM public.billing_payments t WHERE stripe_scope=p_scope AND stripe_object_id=object_key FOR UPDATE;
  IF coalesce((prior->>'revision')::bigint,0) IS DISTINCT FROM (entry->>'expected_revision')::bigint THEN RAISE EXCEPTION 'FINANCE_OBJECT_REVISION'; END IF;
  IF prior IS NOT NULL AND (rowdata->>'verified_at')::timestamptz < (prior->>'verified_at')::timestamptz THEN RAISE EXCEPTION 'FINANCE_STALE_SNAPSHOT'; END IF;
  IF prior IS NOT NULL THEN
   IF prior->>'stripe_scope' IS NOT NULL AND prior->>'stripe_scope' IS DISTINCT FROM rowdata->>'stripe_scope' THEN RAISE EXCEPTION 'FINANCE_IDENTITY'; END IF;
   IF prior->>'stripe_object_id' IS NOT NULL AND prior->>'stripe_object_id' IS DISTINCT FROM rowdata->>'stripe_object_id' THEN RAISE EXCEPTION 'FINANCE_IDENTITY'; END IF;
   IF prior->>'stripe_created_at' IS NOT NULL AND prior->>'stripe_created_at' IS DISTINCT FROM rowdata->>'stripe_created_at' THEN RAISE EXCEPTION 'FINANCE_IDENTITY'; END IF;
   IF prior->>'stripe_customer_id' IS NOT NULL AND prior->>'stripe_customer_id' IS DISTINCT FROM rowdata->>'stripe_customer_id' THEN RAISE EXCEPTION 'FINANCE_IDENTITY'; END IF;
   IF prior->>'currency' IS NOT NULL AND prior->>'currency' IS DISTINCT FROM rowdata->>'currency' THEN RAISE EXCEPTION 'FINANCE_IDENTITY'; END IF;
  END IF;
  IF prior IS NOT NULL AND ((rowdata->>'amount_captured_minor')::bigint<(prior->>'amount_captured_minor')::bigint OR (rowdata->>'amount_refunded_minor')::bigint<(prior->>'amount_refunded_minor')::bigint) THEN RAISE EXCEPTION 'FINANCE_MONEY_REGRESSION'; END IF;
  IF prior->>'collected_at' IS NOT NULL THEN rowdata:=rowdata||jsonb_build_object('collected_at',prior->'collected_at','collection_time_basis',prior->'collection_time_basis'); END IF;
  v_revision:=coalesce((prior->>'revision')::bigint,0)+CASE WHEN prior IS NULL OR prior - ARRAY['created_at','updated_at','verified_at','revision','source_event_id','source_event_created_at','stripe_api_version','normalizer_version']::text[] IS DISTINCT FROM rowdata - ARRAY['created_at','updated_at','verified_at','revision','source_event_id','source_event_created_at','stripe_api_version','normalizer_version']::text[] THEN 1 ELSE 0 END;
  IF prior->>'source_event_created_at' IS NOT NULL AND (rowdata->>'source_event_created_at' IS NULL OR (rowdata->>'source_event_created_at')::timestamptz<(prior->>'source_event_created_at')::timestamptz) THEN rowdata:=rowdata||jsonb_build_object('source_event_created_at',prior->'source_event_created_at','source_event_id',prior->'source_event_id'); END IF;
  INSERT INTO public.billing_payments(stripe_scope,stripe_object_id,stripe_created_at,source_event_id,source_event_created_at,stripe_api_version,normalizer_version,verified_at,stripe_customer_id,stripe_payment_intent_id,currency,status,amount_minor,amount_captured_minor,amount_refunded_minor,paid,captured,collected_at,collection_time_basis,attribution_status,revision)
   SELECT r.stripe_scope,r.stripe_object_id,r.stripe_created_at,r.source_event_id,r.source_event_created_at,r.stripe_api_version,r.normalizer_version,r.verified_at,r.stripe_customer_id,r.stripe_payment_intent_id,r.currency,r.status,r.amount_minor,r.amount_captured_minor,r.amount_refunded_minor,r.paid,r.captured,r.collected_at,r.collection_time_basis,r.attribution_status,v_revision FROM jsonb_populate_record(NULL::public.billing_payments,rowdata) r
   ON CONFLICT(stripe_scope,stripe_object_id) DO UPDATE SET source_event_id=excluded.source_event_id,source_event_created_at=excluded.source_event_created_at,stripe_api_version=excluded.stripe_api_version,normalizer_version=excluded.normalizer_version,verified_at=excluded.verified_at,stripe_customer_id=excluded.stripe_customer_id,stripe_payment_intent_id=excluded.stripe_payment_intent_id,currency=excluded.currency,status=excluded.status,amount_minor=excluded.amount_minor,amount_captured_minor=excluded.amount_captured_minor,amount_refunded_minor=excluded.amount_refunded_minor,paid=excluded.paid,captured=excluded.captured,collected_at=excluded.collected_at,collection_time_basis=excluded.collection_time_basis,attribution_status=excluded.attribution_status,revision=excluded.revision,updated_at=stamp;
  count_written:=count_written+1;
 END LOOP;

 IF p_input ? 'allocations' AND (jsonb_typeof(p_input->'allocations')<>'array' OR jsonb_array_length(p_input->'allocations')>200) THEN RAISE EXCEPTION 'FINANCE_BATCH'; END IF;
 FOR entry IN SELECT value FROM jsonb_array_elements(coalesce(p_input->'allocations','[]')) LOOP
  IF jsonb_typeof(entry)<>'object' OR entry - ARRAY['row','expected_revision']::text[] <>'{}'::jsonb THEN RAISE EXCEPTION 'FINANCE_ROW'; END IF;
  rowdata:=entry->'row';
  IF jsonb_typeof(rowdata) IS DISTINCT FROM 'object' OR rowdata - ARRAY['stripe_scope','stripe_object_id','stripe_created_at','source_event_id','source_event_created_at','stripe_api_version','normalizer_version','verified_at','stripe_invoice_id','stripe_payment_intent_id','stripe_charge_id','payment_type','currency','status','amount_requested_minor','amount_paid_minor','paid_at','canceled_at']::text[]<>'{}'::jsonb OR rowdata->>'stripe_scope' IS DISTINCT FROM p_scope THEN RAISE EXCEPTION 'FINANCE_ROW_SCOPE'; END IF;
  rowdata:=to_jsonb(jsonb_populate_record(NULL::public.billing_invoice_payments,rowdata))-ARRAY['revision','created_at','updated_at']::text[];
  object_key:=rowdata->>'stripe_object_id';
  SELECT to_jsonb(t) INTO prior FROM public.billing_invoice_payments t WHERE stripe_scope=p_scope AND stripe_object_id=object_key FOR UPDATE;
  IF coalesce((prior->>'revision')::bigint,0) IS DISTINCT FROM (entry->>'expected_revision')::bigint THEN RAISE EXCEPTION 'FINANCE_OBJECT_REVISION'; END IF;
  IF prior IS NOT NULL AND (rowdata->>'verified_at')::timestamptz < (prior->>'verified_at')::timestamptz THEN RAISE EXCEPTION 'FINANCE_STALE_SNAPSHOT'; END IF;
  IF prior IS NOT NULL THEN
   IF prior->>'stripe_scope' IS NOT NULL AND prior->>'stripe_scope' IS DISTINCT FROM rowdata->>'stripe_scope' THEN RAISE EXCEPTION 'FINANCE_IDENTITY'; END IF;
   IF prior->>'stripe_object_id' IS NOT NULL AND prior->>'stripe_object_id' IS DISTINCT FROM rowdata->>'stripe_object_id' THEN RAISE EXCEPTION 'FINANCE_IDENTITY'; END IF;
   IF prior->>'stripe_created_at' IS NOT NULL AND prior->>'stripe_created_at' IS DISTINCT FROM rowdata->>'stripe_created_at' THEN RAISE EXCEPTION 'FINANCE_IDENTITY'; END IF;
   IF prior->>'currency' IS NOT NULL AND prior->>'currency' IS DISTINCT FROM rowdata->>'currency' THEN RAISE EXCEPTION 'FINANCE_IDENTITY'; END IF;
   IF prior->>'stripe_invoice_id' IS NOT NULL AND prior->>'stripe_invoice_id' IS DISTINCT FROM rowdata->>'stripe_invoice_id' THEN RAISE EXCEPTION 'FINANCE_IDENTITY'; END IF;
   IF prior->>'stripe_charge_id' IS NOT NULL AND prior->>'stripe_charge_id' IS DISTINCT FROM rowdata->>'stripe_charge_id' THEN RAISE EXCEPTION 'FINANCE_IDENTITY'; END IF;
  END IF;
  v_revision:=coalesce((prior->>'revision')::bigint,0)+CASE WHEN prior IS NULL OR prior - ARRAY['created_at','updated_at','verified_at','revision','source_event_id','source_event_created_at','stripe_api_version','normalizer_version']::text[] IS DISTINCT FROM rowdata - ARRAY['created_at','updated_at','verified_at','revision','source_event_id','source_event_created_at','stripe_api_version','normalizer_version']::text[] THEN 1 ELSE 0 END;
  IF prior->>'source_event_created_at' IS NOT NULL AND (rowdata->>'source_event_created_at' IS NULL OR (rowdata->>'source_event_created_at')::timestamptz<(prior->>'source_event_created_at')::timestamptz) THEN rowdata:=rowdata||jsonb_build_object('source_event_created_at',prior->'source_event_created_at','source_event_id',prior->'source_event_id'); END IF;
  INSERT INTO public.billing_invoice_payments(stripe_scope,stripe_object_id,stripe_created_at,source_event_id,source_event_created_at,stripe_api_version,normalizer_version,verified_at,stripe_invoice_id,stripe_payment_intent_id,stripe_charge_id,payment_type,currency,status,amount_requested_minor,amount_paid_minor,paid_at,canceled_at,revision)
   SELECT r.stripe_scope,r.stripe_object_id,r.stripe_created_at,r.source_event_id,r.source_event_created_at,r.stripe_api_version,r.normalizer_version,r.verified_at,r.stripe_invoice_id,r.stripe_payment_intent_id,r.stripe_charge_id,r.payment_type,r.currency,r.status,r.amount_requested_minor,r.amount_paid_minor,r.paid_at,r.canceled_at,v_revision FROM jsonb_populate_record(NULL::public.billing_invoice_payments,rowdata) r
   ON CONFLICT(stripe_scope,stripe_object_id) DO UPDATE SET source_event_id=excluded.source_event_id,source_event_created_at=excluded.source_event_created_at,stripe_api_version=excluded.stripe_api_version,normalizer_version=excluded.normalizer_version,verified_at=excluded.verified_at,stripe_invoice_id=excluded.stripe_invoice_id,stripe_payment_intent_id=excluded.stripe_payment_intent_id,stripe_charge_id=excluded.stripe_charge_id,payment_type=excluded.payment_type,currency=excluded.currency,status=excluded.status,amount_requested_minor=excluded.amount_requested_minor,amount_paid_minor=excluded.amount_paid_minor,paid_at=excluded.paid_at,canceled_at=excluded.canceled_at,revision=excluded.revision,updated_at=stamp;
  count_written:=count_written+1;
 END LOOP;

 IF p_input ? 'attempts' AND (jsonb_typeof(p_input->'attempts')<>'array' OR jsonb_array_length(p_input->'attempts')>200) THEN RAISE EXCEPTION 'FINANCE_BATCH'; END IF;
 FOR entry IN SELECT value FROM jsonb_array_elements(coalesce(p_input->'attempts','[]')) LOOP
  IF jsonb_typeof(entry)<>'object' OR entry - ARRAY['row','expected_revision']::text[] <>'{}'::jsonb THEN RAISE EXCEPTION 'FINANCE_ROW'; END IF;
  rowdata:=entry->'row';
  IF jsonb_typeof(rowdata) IS DISTINCT FROM 'object' OR rowdata - ARRAY['stripe_scope','attempt_key','stripe_customer_id','stripe_invoice_id','stripe_payment_intent_id','stripe_charge_id','currency','amount_minor','occurred_at','failure_code','evidence_type','source_event_id','stripe_api_version','normalizer_version','verified_at']::text[]<>'{}'::jsonb OR rowdata->>'stripe_scope' IS DISTINCT FROM p_scope THEN RAISE EXCEPTION 'FINANCE_ROW_SCOPE'; END IF;
  rowdata:=to_jsonb(jsonb_populate_record(NULL::public.billing_payment_attempts,rowdata))-ARRAY['revision','created_at','updated_at']::text[];
  object_key:=rowdata->>'attempt_key';
  SELECT to_jsonb(t) INTO prior FROM public.billing_payment_attempts t WHERE stripe_scope=p_scope AND attempt_key=object_key FOR UPDATE;
  IF prior IS NOT NULL THEN
   IF prior->>'stripe_scope' IS NOT NULL AND prior->>'stripe_scope' IS DISTINCT FROM rowdata->>'stripe_scope' THEN RAISE EXCEPTION 'FINANCE_IDENTITY'; END IF;
   IF prior->>'attempt_key' IS NOT NULL AND prior->>'attempt_key' IS DISTINCT FROM rowdata->>'attempt_key' THEN RAISE EXCEPTION 'FINANCE_IDENTITY'; END IF;
   IF prior->>'stripe_customer_id' IS NOT NULL AND prior->>'stripe_customer_id' IS DISTINCT FROM rowdata->>'stripe_customer_id' THEN RAISE EXCEPTION 'FINANCE_IDENTITY'; END IF;
   IF prior->>'currency' IS NOT NULL AND prior->>'currency' IS DISTINCT FROM rowdata->>'currency' THEN RAISE EXCEPTION 'FINANCE_IDENTITY'; END IF;
   IF prior->>'stripe_invoice_id' IS NOT NULL AND prior->>'stripe_invoice_id' IS DISTINCT FROM rowdata->>'stripe_invoice_id' THEN RAISE EXCEPTION 'FINANCE_IDENTITY'; END IF;
   IF prior->>'stripe_charge_id' IS NOT NULL AND prior->>'stripe_charge_id' IS DISTINCT FROM rowdata->>'stripe_charge_id' THEN RAISE EXCEPTION 'FINANCE_IDENTITY'; END IF;
  END IF;
  IF prior IS NOT NULL THEN IF prior - ARRAY['created_at','updated_at','verified_at','source_event_id','stripe_api_version','normalizer_version','source_revision']::text[] IS DISTINCT FROM rowdata - ARRAY['created_at','updated_at','verified_at','source_event_id','stripe_api_version','normalizer_version','source_revision']::text[] THEN RAISE EXCEPTION 'FINANCE_IMMUTABLE_CONFLICT'; END IF; CONTINUE; END IF;
  INSERT INTO public.billing_payment_attempts(stripe_scope,attempt_key,stripe_customer_id,stripe_invoice_id,stripe_payment_intent_id,stripe_charge_id,currency,amount_minor,occurred_at,failure_code,evidence_type,source_event_id,stripe_api_version,normalizer_version,verified_at)
   SELECT r.stripe_scope,r.attempt_key,r.stripe_customer_id,r.stripe_invoice_id,r.stripe_payment_intent_id,r.stripe_charge_id,r.currency,r.amount_minor,r.occurred_at,r.failure_code,r.evidence_type,r.source_event_id,r.stripe_api_version,r.normalizer_version,r.verified_at FROM jsonb_populate_record(NULL::public.billing_payment_attempts,rowdata) r
   ;
  count_written:=count_written+1;
 END LOOP;

 IF p_input ? 'refunds' AND (jsonb_typeof(p_input->'refunds')<>'array' OR jsonb_array_length(p_input->'refunds')>200) THEN RAISE EXCEPTION 'FINANCE_BATCH'; END IF;
 FOR entry IN SELECT value FROM jsonb_array_elements(coalesce(p_input->'refunds','[]')) LOOP
  IF jsonb_typeof(entry)<>'object' OR entry - ARRAY['row','expected_revision']::text[] <>'{}'::jsonb THEN RAISE EXCEPTION 'FINANCE_ROW'; END IF;
  rowdata:=entry->'row';
  IF jsonb_typeof(rowdata) IS DISTINCT FROM 'object' OR rowdata - ARRAY['stripe_scope','stripe_object_id','stripe_created_at','source_event_id','source_event_created_at','stripe_api_version','normalizer_version','verified_at','stripe_charge_id','stripe_payment_intent_id','currency','amount_minor','status','reason','failure_reason','succeeded_at','success_time_basis']::text[]<>'{}'::jsonb OR rowdata->>'stripe_scope' IS DISTINCT FROM p_scope THEN RAISE EXCEPTION 'FINANCE_ROW_SCOPE'; END IF;
  rowdata:=to_jsonb(jsonb_populate_record(NULL::public.billing_refunds,rowdata))-ARRAY['revision','created_at','updated_at']::text[];
  object_key:=rowdata->>'stripe_object_id';
  SELECT to_jsonb(t) INTO prior FROM public.billing_refunds t WHERE stripe_scope=p_scope AND stripe_object_id=object_key FOR UPDATE;
  IF coalesce((prior->>'revision')::bigint,0) IS DISTINCT FROM (entry->>'expected_revision')::bigint THEN RAISE EXCEPTION 'FINANCE_OBJECT_REVISION'; END IF;
  IF prior IS NOT NULL AND (rowdata->>'verified_at')::timestamptz < (prior->>'verified_at')::timestamptz THEN RAISE EXCEPTION 'FINANCE_STALE_SNAPSHOT'; END IF;
  IF prior IS NOT NULL THEN
   IF prior->>'stripe_scope' IS NOT NULL AND prior->>'stripe_scope' IS DISTINCT FROM rowdata->>'stripe_scope' THEN RAISE EXCEPTION 'FINANCE_IDENTITY'; END IF;
   IF prior->>'stripe_object_id' IS NOT NULL AND prior->>'stripe_object_id' IS DISTINCT FROM rowdata->>'stripe_object_id' THEN RAISE EXCEPTION 'FINANCE_IDENTITY'; END IF;
   IF prior->>'stripe_created_at' IS NOT NULL AND prior->>'stripe_created_at' IS DISTINCT FROM rowdata->>'stripe_created_at' THEN RAISE EXCEPTION 'FINANCE_IDENTITY'; END IF;
   IF prior->>'currency' IS NOT NULL AND prior->>'currency' IS DISTINCT FROM rowdata->>'currency' THEN RAISE EXCEPTION 'FINANCE_IDENTITY'; END IF;
   IF prior->>'stripe_charge_id' IS NOT NULL AND prior->>'stripe_charge_id' IS DISTINCT FROM rowdata->>'stripe_charge_id' THEN RAISE EXCEPTION 'FINANCE_IDENTITY'; END IF;
  END IF;
  IF prior->>'amount_minor' IS NOT NULL AND prior->>'amount_minor' IS DISTINCT FROM rowdata->>'amount_minor' THEN RAISE EXCEPTION 'FINANCE_MONEY_CONFLICT'; END IF;
  IF prior->>'status'='succeeded' AND rowdata->>'status'<>'succeeded' THEN RAISE EXCEPTION 'FINANCE_TERMINAL'; END IF;
  IF prior->>'succeeded_at' IS NOT NULL THEN rowdata:=rowdata||jsonb_build_object('succeeded_at',prior->'succeeded_at','success_time_basis',prior->'success_time_basis'); END IF;
  v_revision:=coalesce((prior->>'revision')::bigint,0)+CASE WHEN prior IS NULL OR prior - ARRAY['created_at','updated_at','verified_at','revision','source_event_id','source_event_created_at','stripe_api_version','normalizer_version']::text[] IS DISTINCT FROM rowdata - ARRAY['created_at','updated_at','verified_at','revision','source_event_id','source_event_created_at','stripe_api_version','normalizer_version']::text[] THEN 1 ELSE 0 END;
  IF prior->>'source_event_created_at' IS NOT NULL AND (rowdata->>'source_event_created_at' IS NULL OR (rowdata->>'source_event_created_at')::timestamptz<(prior->>'source_event_created_at')::timestamptz) THEN rowdata:=rowdata||jsonb_build_object('source_event_created_at',prior->'source_event_created_at','source_event_id',prior->'source_event_id'); END IF;
  INSERT INTO public.billing_refunds(stripe_scope,stripe_object_id,stripe_created_at,source_event_id,source_event_created_at,stripe_api_version,normalizer_version,verified_at,stripe_charge_id,stripe_payment_intent_id,currency,amount_minor,status,reason,failure_reason,succeeded_at,success_time_basis,revision)
   SELECT r.stripe_scope,r.stripe_object_id,r.stripe_created_at,r.source_event_id,r.source_event_created_at,r.stripe_api_version,r.normalizer_version,r.verified_at,r.stripe_charge_id,r.stripe_payment_intent_id,r.currency,r.amount_minor,r.status,r.reason,r.failure_reason,r.succeeded_at,r.success_time_basis,v_revision FROM jsonb_populate_record(NULL::public.billing_refunds,rowdata) r
   ON CONFLICT(stripe_scope,stripe_object_id) DO UPDATE SET source_event_id=excluded.source_event_id,source_event_created_at=excluded.source_event_created_at,stripe_api_version=excluded.stripe_api_version,normalizer_version=excluded.normalizer_version,verified_at=excluded.verified_at,stripe_charge_id=excluded.stripe_charge_id,stripe_payment_intent_id=excluded.stripe_payment_intent_id,currency=excluded.currency,amount_minor=excluded.amount_minor,status=excluded.status,reason=excluded.reason,failure_reason=excluded.failure_reason,succeeded_at=excluded.succeeded_at,success_time_basis=excluded.success_time_basis,revision=excluded.revision,updated_at=stamp;
  count_written:=count_written+1;
 END LOOP;

 IF p_input ? 'activity' AND (jsonb_typeof(p_input->'activity')<>'array' OR jsonb_array_length(p_input->'activity')>200) THEN RAISE EXCEPTION 'FINANCE_BATCH'; END IF;
 FOR entry IN SELECT value FROM jsonb_array_elements(coalesce(p_input->'activity','[]')) LOOP
  IF jsonb_typeof(entry)<>'object' OR entry - ARRAY['row','expected_revision']::text[] <>'{}'::jsonb THEN RAISE EXCEPTION 'FINANCE_ROW'; END IF;
  rowdata:=entry->'row';
  IF jsonb_typeof(rowdata) IS DISTINCT FROM 'object' OR rowdata - ARRAY['stripe_scope','activity_key','kind','stripe_customer_id','stripe_subscription_id','object_type','object_id','occurred_at','amount_minor','currency','effective_at','source_event_id','origin','source_revision']::text[]<>'{}'::jsonb OR rowdata->>'stripe_scope' IS DISTINCT FROM p_scope THEN RAISE EXCEPTION 'FINANCE_ROW_SCOPE'; END IF;
  rowdata:=to_jsonb(jsonb_populate_record(NULL::public.billing_finance_activity,rowdata))-ARRAY['revision','created_at','updated_at']::text[];
  object_key:=rowdata->>'activity_key';
  SELECT to_jsonb(t) INTO prior FROM public.billing_finance_activity t WHERE stripe_scope=p_scope AND activity_key=object_key FOR UPDATE;
  IF prior IS NOT NULL THEN
   IF prior->>'stripe_scope' IS NOT NULL AND prior->>'stripe_scope' IS DISTINCT FROM rowdata->>'stripe_scope' THEN RAISE EXCEPTION 'FINANCE_IDENTITY'; END IF;
   IF prior->>'activity_key' IS NOT NULL AND prior->>'activity_key' IS DISTINCT FROM rowdata->>'activity_key' THEN RAISE EXCEPTION 'FINANCE_IDENTITY'; END IF;
   IF prior->>'stripe_customer_id' IS NOT NULL AND prior->>'stripe_customer_id' IS DISTINCT FROM rowdata->>'stripe_customer_id' THEN RAISE EXCEPTION 'FINANCE_IDENTITY'; END IF;
   IF prior->>'currency' IS NOT NULL AND prior->>'currency' IS DISTINCT FROM rowdata->>'currency' THEN RAISE EXCEPTION 'FINANCE_IDENTITY'; END IF;
   IF prior->>'stripe_subscription_id' IS NOT NULL AND prior->>'stripe_subscription_id' IS DISTINCT FROM rowdata->>'stripe_subscription_id' THEN RAISE EXCEPTION 'FINANCE_IDENTITY'; END IF;
  END IF;
  IF prior IS NOT NULL THEN IF prior - ARRAY['created_at','updated_at','verified_at','source_event_id','stripe_api_version','normalizer_version','source_revision']::text[] IS DISTINCT FROM rowdata - ARRAY['created_at','updated_at','verified_at','source_event_id','stripe_api_version','normalizer_version','source_revision']::text[] THEN RAISE EXCEPTION 'FINANCE_IMMUTABLE_CONFLICT'; END IF; CONTINUE; END IF;
  INSERT INTO public.billing_finance_activity(stripe_scope,activity_key,kind,stripe_customer_id,stripe_subscription_id,object_type,object_id,occurred_at,amount_minor,currency,effective_at,source_event_id,origin,source_revision)
   SELECT r.stripe_scope,r.activity_key,r.kind,r.stripe_customer_id,r.stripe_subscription_id,r.object_type,r.object_id,r.occurred_at,r.amount_minor,r.currency,r.effective_at,r.source_event_id,r.origin,r.source_revision FROM jsonb_populate_record(NULL::public.billing_finance_activity,rowdata) r
   ;
  count_written:=count_written+1;
 END LOOP;

 -- Verify attributed payment evidence from stored allocation + verified subscription.
 IF EXISTS(SELECT 1 FROM public.billing_payments p WHERE p.stripe_scope=p_scope AND p.attribution_status='verified' AND p.stripe_object_id IN (SELECT value->'row'->>'stripe_object_id' FROM jsonb_array_elements(coalesce(p_input->'payments','[]')))
  AND (p.amount_captured_minor IS DISTINCT FROM (SELECT coalesce(sum(a.amount_paid_minor),0) FROM public.billing_invoice_payments a WHERE a.stripe_scope=p_scope AND a.stripe_charge_id=p.stripe_object_id)
   OR NOT EXISTS(SELECT 1 FROM public.billing_invoice_payments a JOIN public.billing_invoices i ON (i.stripe_scope,i.stripe_object_id)=(a.stripe_scope,a.stripe_invoice_id) JOIN public.billing_finance_subscriptions s ON (s.stripe_scope,s.stripe_object_id)=(i.stripe_scope,i.stripe_subscription_id)
    WHERE a.stripe_scope=p_scope AND a.stripe_charge_id=p.stripe_object_id AND s.linkage_status='verified' AND s.stripe_customer_id=p.stripe_customer_id AND i.stripe_customer_id=p.stripe_customer_id)
   OR EXISTS(SELECT 1 FROM public.billing_invoice_payments a JOIN public.billing_invoices i ON (i.stripe_scope,i.stripe_object_id)=(a.stripe_scope,a.stripe_invoice_id) LEFT JOIN public.billing_finance_subscriptions s ON (s.stripe_scope,s.stripe_object_id)=(i.stripe_scope,i.stripe_subscription_id)
    WHERE a.stripe_scope=p_scope AND a.stripe_charge_id=p.stripe_object_id AND (s.linkage_status IS DISTINCT FROM 'verified' OR i.stripe_customer_id<>p.stripe_customer_id OR a.currency<>p.currency)))) THEN RAISE EXCEPTION 'FINANCE_ATTRIBUTION'; END IF;
 IF p_input ? 'run' THEN
  rowdata:=p_input->'run';
  IF rowdata - ARRAY['id','expected_cursor','cursor','processed','done','complete']::text[]<>'{}'::jsonb OR jsonb_typeof(rowdata->'cursor') IS DISTINCT FROM 'object' OR (rowdata->'cursor') - ARRAY['after']::text[]<>'{}'::jsonb OR (rowdata->>'processed')::int NOT BETWEEN 0 AND 20 THEN RAISE EXCEPTION 'FINANCE_RUN_INPUT'; END IF;
  SELECT * INTO runrow FROM public.billing_finance_sync_runs WHERE stripe_scope=p_scope AND id=(rowdata->>'id')::uuid FOR UPDATE;
  IF NOT FOUND OR runrow.status NOT IN ('running','partial') OR runrow.cursor IS DISTINCT FROM rowdata->'expected_cursor' THEN RAISE EXCEPTION 'FINANCE_CURSOR'; END IF;

  UPDATE public.billing_finance_sync_runs SET cursor=rowdata->'cursor',processed_count=processed_count+(rowdata->>'processed')::int,
   status=CASE WHEN (rowdata->>'done')::boolean THEN 'completed' ELSE 'partial' END,
   coverage_quality=CASE WHEN (rowdata->>'done')::boolean AND (rowdata->>'complete')::boolean AND error_count=0 THEN 'complete' ELSE 'partial' END,
   error_count=error_count+CASE WHEN (rowdata->>'complete')::boolean THEN 0 ELSE 1 END,
   coverage_start=CASE WHEN (rowdata->>'done')::boolean THEN window_start ELSE NULL END,
   coverage_end=CASE WHEN (rowdata->>'done')::boolean THEN window_end ELSE NULL END,
   completed_at=CASE WHEN (rowdata->>'done')::boolean THEN stamp ELSE NULL END,updated_at=stamp WHERE id=runrow.id;
 END IF;
 IF clock_timestamp()>=lockrow.lease_until OR (p_input ? 'event_id' AND clock_timestamp()>=delivery.lease_until) THEN RAISE EXCEPTION 'FINANCE_FENCE'; END IF;
 IF p_input ? 'event_id' THEN
  UPDATE public.billing_finance_event_deliveries SET state=CASE WHEN coalesce((p_input->>'ignored')::boolean,false) THEN 'ignored' ELSE 'processed' END,lease_token=NULL,lease_until=NULL,processed_at=stamp,updated_at=stamp
   WHERE stripe_scope=p_scope AND consumer_version='finance_v1' AND stripe_event_id=delivery.stripe_event_id;
 END IF;
 UPDATE public.billing_finance_sync_state SET verified_at=stamp,revision=revision+1,lease_token=NULL,lease_until=NULL,lease_protocol_epoch=NULL,updated_at=stamp WHERE stripe_scope=p_scope AND resource_type='scope' AND resource_key='finance_v1';
 RETURN jsonb_build_object('written',count_written);
END $fn$;
REVOKE ALL ON FUNCTION public.billing_finance_command(text,text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.billing_finance_command(text,text,uuid,jsonb) TO service_role;
COMMIT;
