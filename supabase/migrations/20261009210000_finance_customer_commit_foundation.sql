-- Inactive customer commit foundation. No protocol transition/customer activation.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DO $owner$
BEGIN
 IF (SELECT proowner FROM pg_catalog.pg_proc WHERE oid='public.billing_finance_partition_command(text,text,text,uuid,jsonb)'::regprocedure)
  IS DISTINCT FROM (CURRENT_USER::pg_catalog.regrole)::oid
  OR (SELECT proowner FROM pg_catalog.pg_proc WHERE oid='public.billing_finance_command(text,text,uuid,jsonb)'::regprocedure)
  IS DISTINCT FROM (CURRENT_USER::pg_catalog.regrole)::oid THEN RAISE EXCEPTION 'FINANCE_PARTITION_OWNER'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_constraint WHERE conname='billing_finance_protocol_foundation_legacy'
  AND conrelid='public.billing_finance_protocol_control'::regclass AND convalidated)
 THEN RAISE EXCEPTION 'FINANCE_PARTITION_FOUNDATION_REQUIRED'; END IF;
END $owner$;
ALTER TABLE public.billing_finance_event_deliveries ADD COLUMN partition_protocol_epoch bigint
 CHECK(partition_protocol_epoch IS NULL OR partition_protocol_epoch BETWEEN 0 AND 9007199254740991);
ALTER TABLE public.billing_finance_event_deliveries ADD CONSTRAINT billing_finance_receipt_partition_epoch_pair
 CHECK((partition_customer_id IS NULL)=(partition_protocol_epoch IS NULL));

-- Owner-only helper: financial rules copied verbatim from the gated legacy writer.
CREATE FUNCTION public.billing_finance_customer_apply_bundle(p_scope text,p_input jsonb,p_stamp timestamptz)
RETURNS integer LANGUAGE plpgsql SET search_path=pg_catalog,public AS $apply$
DECLARE stamp timestamptz:=p_stamp; entry jsonb;rowdata jsonb;prior jsonb;object_key text;count_written integer:=0;v_revision bigint;
BEGIN
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
 RETURN count_written;
END $apply$;

CREATE FUNCTION public.billing_finance_customer_resource_owner(p_scope text,p_customer text,p_bundle jsonb,p_kind text,p_id text,p_depth integer DEFAULT 0)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,public AS $own$
DECLARE incoming jsonb;stored jsonb;rowdata jsonb; parent jsonb; n integer;k text;key_column text;linked text;
BEGIN
 IF p_depth>6 OR p_id IS NULL OR p_kind NOT IN ('subscriptions','items','invoices','payments','refunds','allocations','attempts','activity')
 THEN RAISE EXCEPTION 'FINANCE_PARTITION_OWNERSHIP'; END IF;
 key_column:=CASE p_kind WHEN 'attempts' THEN 'attempt_key' WHEN 'activity' THEN 'activity_key' ELSE 'stripe_object_id' END;
 IF (p_kind IN ('subscriptions','items','invoices','payments','refunds','allocations') AND p_id !~
  (CASE p_kind WHEN 'subscriptions' THEN '^sub_' WHEN 'items' THEN '^si_' WHEN 'invoices' THEN '^in_' WHEN 'payments' THEN '^ch_' WHEN 'refunds' THEN '^re_' ELSE '^inpay_' END||'[A-Za-z0-9]{1,240}$'))
  OR (p_kind='attempts' AND p_id !~ '^charge:ch_[A-Za-z0-9]{1,240}$')
  OR (p_kind='activity' AND (length(p_id)>400 OR p_id !~ '^[A-Za-z0-9_:.-]+$')) THEN RAISE EXCEPTION 'FINANCE_PARTITION_OWNERSHIP'; END IF;
 SELECT count(*) INTO n FROM jsonb_array_elements(p_bundle->p_kind) e WHERE e->'row'->>key_column=p_id;
 IF n>1 THEN RAISE EXCEPTION 'FINANCE_PARTITION_OWNERSHIP'; END IF;
 SELECT e->'row' INTO incoming FROM jsonb_array_elements(p_bundle->p_kind) e WHERE e->'row'->>key_column=p_id;
 CASE p_kind
 WHEN 'subscriptions' THEN SELECT to_jsonb(t) INTO stored FROM public.billing_finance_subscriptions t WHERE stripe_scope=p_scope AND stripe_object_id=p_id;
 WHEN 'items' THEN SELECT to_jsonb(t) INTO stored FROM public.billing_finance_subscription_items t WHERE stripe_scope=p_scope AND stripe_object_id=p_id;
 WHEN 'invoices' THEN SELECT to_jsonb(t) INTO stored FROM public.billing_invoices t WHERE stripe_scope=p_scope AND stripe_object_id=p_id;
 WHEN 'payments' THEN SELECT to_jsonb(t) INTO stored FROM public.billing_payments t WHERE stripe_scope=p_scope AND stripe_object_id=p_id;
 WHEN 'refunds' THEN SELECT to_jsonb(t) INTO stored FROM public.billing_refunds t WHERE stripe_scope=p_scope AND stripe_object_id=p_id;
 WHEN 'allocations' THEN SELECT to_jsonb(t) INTO stored FROM public.billing_invoice_payments t WHERE stripe_scope=p_scope AND stripe_object_id=p_id;
 WHEN 'attempts' THEN SELECT to_jsonb(t) INTO stored FROM public.billing_payment_attempts t WHERE stripe_scope=p_scope AND attempt_key=p_id;
 WHEN 'activity' THEN SELECT to_jsonb(t) INTO stored FROM public.billing_finance_activity t WHERE stripe_scope=p_scope AND activity_key=p_id;
 END CASE;
 IF incoming IS NOT NULL AND stored IS NOT NULL THEN
  FOREACH k IN ARRAY ARRAY['stripe_customer_id','stripe_subscription_id','stripe_invoice_id','stripe_charge_id','stripe_payment_intent_id','object_type','object_id'] LOOP
   IF stored->>k IS NOT NULL AND stored->>k IS DISTINCT FROM incoming->>k THEN RAISE EXCEPTION 'FINANCE_PARTITION_IDENTITY'; END IF;
  END LOOP;
 END IF;
 rowdata:=coalesce(incoming,stored);
 IF rowdata IS NULL OR rowdata->>'stripe_scope' IS DISTINCT FROM p_scope THEN RAISE EXCEPTION 'FINANCE_PARTITION_OWNERSHIP'; END IF;
 IF p_kind IN ('subscriptions','invoices','payments','attempts','activity') AND rowdata->>'stripe_customer_id' IS DISTINCT FROM p_customer
 THEN RAISE EXCEPTION 'FINANCE_PARTITION_OWNERSHIP'; END IF;
 IF p_kind='items' THEN PERFORM public.billing_finance_customer_resource_owner(p_scope,p_customer,p_bundle,'subscriptions',rowdata->>'stripe_subscription_id',p_depth+1); END IF;
 IF p_kind='invoices' AND rowdata->>'stripe_subscription_id' IS NOT NULL THEN
  PERFORM public.billing_finance_customer_resource_owner(p_scope,p_customer,p_bundle,'subscriptions',rowdata->>'stripe_subscription_id',p_depth+1); END IF;
 IF p_kind IN ('refunds','attempts') OR (p_kind='allocations' AND rowdata->>'stripe_charge_id' IS NOT NULL) THEN
  linked:=rowdata->>'stripe_charge_id';
  PERFORM public.billing_finance_customer_resource_owner(p_scope,p_customer,p_bundle,'payments',linked,p_depth+1);
  SELECT e->'row' INTO parent FROM jsonb_array_elements(p_bundle->'payments') e WHERE e->'row'->>'stripe_object_id'=linked;
  IF parent IS NULL THEN SELECT to_jsonb(t) INTO parent FROM public.billing_payments t WHERE stripe_scope=p_scope AND stripe_object_id=linked; END IF;
  IF rowdata->>'stripe_payment_intent_id' IS NOT NULL AND rowdata->>'stripe_payment_intent_id' IS DISTINCT FROM parent->>'stripe_payment_intent_id'
  THEN RAISE EXCEPTION 'FINANCE_PARTITION_OWNERSHIP'; END IF;
 END IF;
 IF p_kind IN ('allocations','attempts') AND (p_kind='allocations' OR rowdata->>'stripe_invoice_id' IS NOT NULL) THEN
  PERFORM public.billing_finance_customer_resource_owner(p_scope,p_customer,p_bundle,'invoices',rowdata->>'stripe_invoice_id',p_depth+1); END IF;
 IF p_kind='attempts' AND rowdata->>'attempt_key' IS DISTINCT FROM 'charge:'||(rowdata->>'stripe_charge_id') THEN RAISE EXCEPTION 'FINANCE_PARTITION_OWNERSHIP'; END IF;
 IF p_kind='allocations' AND rowdata->>'stripe_charge_id' IS NULL THEN
  IF rowdata->>'stripe_payment_intent_id' IS NULL THEN RAISE EXCEPTION 'FINANCE_PARTITION_OWNERSHIP'; END IF;
  SELECT count(*),min(object_id) INTO n,linked FROM (
   SELECT e->'row'->>'stripe_object_id' object_id FROM jsonb_array_elements(p_bundle->'payments') e WHERE e->'row'->>'stripe_payment_intent_id'=rowdata->>'stripe_payment_intent_id'
   UNION ALL SELECT t.stripe_object_id FROM public.billing_payments t WHERE t.stripe_scope=p_scope AND t.stripe_payment_intent_id=rowdata->>'stripe_payment_intent_id'
    AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_bundle->'payments') e WHERE e->'row'->>'stripe_object_id'=t.stripe_object_id)
   LIMIT 2) candidates;
  IF n<>1 THEN RAISE EXCEPTION 'FINANCE_PARTITION_OWNERSHIP'; END IF;
  PERFORM public.billing_finance_customer_resource_owner(p_scope,p_customer,p_bundle,'payments',linked,p_depth+1);
 END IF;
 IF p_kind='activity' THEN
  k:=CASE rowdata->>'object_type' WHEN 'attempt' THEN 'attempts' ELSE rowdata->>'object_type' END;
  IF k IS NULL OR k NOT IN ('subscriptions','invoices','refunds','attempts') THEN RAISE EXCEPTION 'FINANCE_PARTITION_OWNERSHIP'; END IF;
  PERFORM public.billing_finance_customer_resource_owner(p_scope,p_customer,p_bundle,k,rowdata->>'object_id',p_depth+1);
  SELECT e->'row' INTO parent FROM jsonb_array_elements(p_bundle->k) e
   WHERE e->'row'->>CASE k WHEN 'attempts' THEN 'attempt_key' ELSE 'stripe_object_id' END=rowdata->>'object_id';
  IF parent IS NULL THEN
   CASE k
   WHEN 'subscriptions' THEN SELECT to_jsonb(t) INTO parent FROM public.billing_finance_subscriptions t WHERE stripe_scope=p_scope AND stripe_object_id=rowdata->>'object_id';
   WHEN 'invoices' THEN SELECT to_jsonb(t) INTO parent FROM public.billing_invoices t WHERE stripe_scope=p_scope AND stripe_object_id=rowdata->>'object_id';
   WHEN 'refunds' THEN SELECT to_jsonb(t) INTO parent FROM public.billing_refunds t WHERE stripe_scope=p_scope AND stripe_object_id=rowdata->>'object_id';
   WHEN 'attempts' THEN SELECT to_jsonb(t) INTO parent FROM public.billing_payment_attempts t WHERE stripe_scope=p_scope AND attempt_key=rowdata->>'object_id';
   END CASE;
  END IF;
  IF rowdata->>'stripe_subscription_id' IS NOT NULL THEN
   IF parent->>'stripe_subscription_id' IS NOT NULL AND parent->>'stripe_subscription_id' IS DISTINCT FROM rowdata->>'stripe_subscription_id' THEN RAISE EXCEPTION 'FINANCE_PARTITION_OWNERSHIP'; END IF;
   PERFORM public.billing_finance_customer_resource_owner(p_scope,p_customer,p_bundle,'subscriptions',rowdata->>'stripe_subscription_id',p_depth+1);
   IF k='subscriptions' AND rowdata->>'stripe_subscription_id' IS DISTINCT FROM rowdata->>'object_id' THEN RAISE EXCEPTION 'FINANCE_PARTITION_OWNERSHIP'; END IF;
  END IF;
 END IF;
END $own$;

CREATE FUNCTION public.billing_finance_customer_bundle_owner(p_scope text,p_customer text,p_bundle jsonb)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,public AS $bundle$
DECLARE k text;e jsonb;object_id text;lock_key bigint;
BEGIN
 IF jsonb_typeof(p_bundle) IS DISTINCT FROM 'object' OR p_bundle-ARRAY['subscriptions','items','invoices','payments','allocations','attempts','refunds','activity']::text[]<>'{}'::jsonb
  OR NOT(p_bundle ?& ARRAY['subscriptions','items','invoices','payments','allocations','attempts','refunds','activity']) THEN RAISE EXCEPTION 'FINANCE_PARTITION_BUNDLE'; END IF;
 FOREACH k IN ARRAY ARRAY['subscriptions','items','invoices','payments','allocations','attempts','refunds','activity'] LOOP
  IF jsonb_typeof(p_bundle->k) IS DISTINCT FROM 'array' OR jsonb_array_length(p_bundle->k)>200 THEN RAISE EXCEPTION 'FINANCE_PARTITION_BUNDLE'; END IF;
  FOR e IN SELECT value FROM jsonb_array_elements(p_bundle->k) LOOP
   IF jsonb_typeof(e) IS DISTINCT FROM 'object' OR jsonb_typeof(e->'row') IS DISTINCT FROM 'object' OR e-ARRAY['row','expected_revision']::text[]<>'{}'::jsonb
   THEN RAISE EXCEPTION 'FINANCE_PARTITION_BUNDLE'; END IF;
  END LOOP;
 END LOOP;
 -- Stable object locks protect absent-row insertion races across customer partitions.
 -- Hash collisions only cause extra serialization; all customer writes use this order.
 FOR lock_key IN SELECT DISTINCT hashtextextended(p_scope||':'||r.key||':'||
  (e.value->'row'->>CASE r.key WHEN 'attempts' THEN 'attempt_key' WHEN 'activity' THEN 'activity_key' ELSE 'stripe_object_id' END),0)
  FROM jsonb_each(p_bundle) r CROSS JOIN LATERAL jsonb_array_elements(r.value) e ORDER BY 1 LOOP
  IF lock_key IS NULL THEN RAISE EXCEPTION 'FINANCE_PARTITION_BUNDLE'; END IF;
  PERFORM pg_advisory_xact_lock(lock_key);
 END LOOP;
 FOREACH k IN ARRAY ARRAY['subscriptions','items','invoices','payments','allocations','attempts','refunds','activity'] LOOP
  FOR e IN SELECT value FROM jsonb_array_elements(p_bundle->k) LOOP
   object_id:=e->'row'->>CASE k WHEN 'attempts' THEN 'attempt_key' WHEN 'activity' THEN 'activity_key' ELSE 'stripe_object_id' END;
   PERFORM public.billing_finance_customer_resource_owner(p_scope,p_customer,p_bundle,k,object_id);
  END LOOP;
 END LOOP;
END $bundle$;

CREATE OR REPLACE FUNCTION public.billing_finance_receipt_partition_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $guard$
DECLARE context jsonb;control public.billing_finance_protocol_control%ROWTYPE;lease public.billing_finance_sync_state%ROWTYPE;
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.partition_customer_id IS NOT NULL OR NEW.partition_protocol_epoch IS NOT NULL THEN RAISE EXCEPTION 'FINANCE_PARTITION_BINDING_DISABLED'; END IF;
 ELSIF NEW.partition_customer_id IS DISTINCT FROM OLD.partition_customer_id OR NEW.partition_protocol_epoch IS DISTINCT FROM OLD.partition_protocol_epoch THEN
  IF OLD.partition_customer_id IS NOT NULL AND NEW.partition_customer_id IS DISTINCT FROM OLD.partition_customer_id THEN RAISE EXCEPTION 'FINANCE_PARTITION_BINDING_IMMUTABLE'; END IF;
  IF OLD.state IN ('processed','ignored') THEN RAISE EXCEPTION 'FINANCE_PARTITION_BINDING_TERMINAL'; END IF;
  context:=nullif(current_setting('dmi.finance_partition_binding',true),'')::jsonb;
  IF context IS NULL OR context->>'scope' IS DISTINCT FROM NEW.stripe_scope OR context->>'event' IS DISTINCT FROM NEW.stripe_event_id
   OR context->>'customer' IS DISTINCT FROM NEW.partition_customer_id OR (context->>'epoch')::bigint IS DISTINCT FROM NEW.partition_protocol_epoch
   OR OLD.state<>'processing' OR OLD.lease_token IS DISTINCT FROM (context->>'receipt_token')::uuid OR OLD.lease_until<=clock_timestamp()
  THEN RAISE EXCEPTION 'FINANCE_PARTITION_BINDING_DISABLED'; END IF;
  SELECT * INTO control FROM public.billing_finance_protocol_control WHERE stripe_scope=NEW.stripe_scope;
  SELECT * INTO lease FROM public.billing_finance_sync_state WHERE stripe_scope=NEW.stripe_scope AND resource_type='customer' AND resource_key=NEW.partition_customer_id;
  IF control.mode NOT IN ('customer','draining_to_legacy') OR control.epoch IS DISTINCT FROM NEW.partition_protocol_epoch
   OR lease.lease_protocol_epoch IS DISTINCT FROM control.epoch OR lease.lease_token IS DISTINCT FROM (context->>'lease_token')::uuid
   OR lease.lease_until<=clock_timestamp() OR lease.revision IS DISTINCT FROM (context->>'revision')::bigint THEN RAISE EXCEPTION 'FINANCE_PARTITION_FENCE'; END IF;
 END IF;
 RETURN NEW;
END $guard$;
CREATE OR REPLACE TRIGGER billing_finance_receipt_partition_guard
 BEFORE INSERT OR UPDATE OF partition_customer_id,partition_protocol_epoch ON public.billing_finance_event_deliveries
 FOR EACH ROW EXECUTE FUNCTION public.billing_finance_receipt_partition_guard();

CREATE OR REPLACE FUNCTION public.billing_finance_partition_command(p_action text,p_scope text,p_customer text DEFAULT NULL,p_token uuid DEFAULT NULL,p_input jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $rpc$
DECLARE control public.billing_finance_protocol_control%ROWTYPE;lease public.billing_finance_sync_state%ROWTYPE;
 receipt public.billing_finance_event_deliveries%ROWTYPE;expected_epoch bigint;expected_revision bigint;stamp timestamptz;written integer;kind text;previous_context text;
BEGIN
 IF p_action IS NULL OR p_action NOT IN ('read_protocol','claim_customer','release_customer','bind_receipt','commit_customer','complete_unsupported')
  OR p_scope IS NULL OR p_scope !~ '^acct_[A-Za-z0-9]+:(test|live)$' OR char_length(p_scope)>255
  OR jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR octet_length(p_input::text)>1048576 THEN RAISE EXCEPTION 'FINANCE_PARTITION_INPUT'; END IF;
 IF p_action='read_protocol' THEN
  IF p_customer IS NOT NULL OR p_token IS NOT NULL OR p_input<>'{}'::jsonb THEN RAISE EXCEPTION 'FINANCE_PARTITION_INPUT'; END IF;
  INSERT INTO public.billing_finance_protocol_control(stripe_scope) VALUES(p_scope) ON CONFLICT DO NOTHING;
  SELECT * INTO control FROM public.billing_finance_protocol_control WHERE stripe_scope=p_scope FOR SHARE;
  RETURN jsonb_build_object('mode',control.mode,'epoch',control.epoch);
 END IF;
 IF jsonb_typeof(p_input->'expected_epoch') IS DISTINCT FROM 'number' OR coalesce(p_input->>'expected_epoch','') !~ '^(0|[1-9][0-9]{0,15})$'
 THEN RAISE EXCEPTION 'FINANCE_PARTITION_INPUT'; END IF;
 expected_epoch:=(p_input->>'expected_epoch')::bigint;
 IF expected_epoch>9007199254740991 THEN RAISE EXCEPTION 'FINANCE_PARTITION_INPUT'; END IF;
 SELECT * INTO control FROM public.billing_finance_protocol_control WHERE stripe_scope=p_scope FOR SHARE;
 IF NOT FOUND OR control.mode NOT IN ('customer','draining_to_legacy') THEN RAISE EXCEPTION 'FINANCE_PARTITION_DISABLED'; END IF;
 IF control.epoch IS DISTINCT FROM expected_epoch THEN RAISE EXCEPTION 'FINANCE_PARTITION_EPOCH'; END IF;
 IF p_action='complete_unsupported' THEN
  IF p_customer IS NOT NULL OR p_token IS NULL OR p_input-ARRAY['expected_epoch','event_id','reason']::text[]<>'{}'::jsonb
   OR p_input->>'reason' IS DISTINCT FROM 'unsupported_event' OR coalesce(p_input->>'event_id','') !~ '^evt_[A-Za-z0-9]{1,240}$' THEN RAISE EXCEPTION 'FINANCE_PARTITION_INPUT'; END IF;
  SELECT * INTO receipt FROM public.billing_finance_event_deliveries WHERE stripe_scope=p_scope AND consumer_version='finance_v1' AND stripe_event_id=p_input->>'event_id' FOR UPDATE;
  IF NOT FOUND OR receipt.event_type NOT IN ('checkout.session.completed','invoice.payment_succeeded','customer.created','invoice_payment.paid')
   OR receipt.partition_customer_id IS NOT NULL THEN RAISE EXCEPTION 'FINANCE_PARTITION_UNSUPPORTED'; END IF;
  IF receipt.state='ignored' THEN RETURN jsonb_build_object('duplicate',true); END IF;
  IF receipt.state<>'processing' OR receipt.lease_token IS DISTINCT FROM p_token OR receipt.lease_until<=clock_timestamp() THEN RAISE EXCEPTION 'FINANCE_PARTITION_RECEIPT_FENCE'; END IF;
  UPDATE public.billing_finance_event_deliveries SET state='ignored',processed_at=clock_timestamp(),lease_token=NULL,lease_until=NULL,updated_at=clock_timestamp()
   WHERE stripe_scope=p_scope AND consumer_version='finance_v1' AND stripe_event_id=receipt.stripe_event_id;
  RETURN '{}'::jsonb;
 END IF;
 IF p_customer IS NULL OR p_customer !~ '^cus_[A-Za-z0-9]{1,240}$' THEN RAISE EXCEPTION 'FINANCE_PARTITION_INPUT'; END IF;
 IF p_action='claim_customer' THEN
  IF p_token IS NOT NULL OR p_input-ARRAY['expected_epoch']::text[]<>'{}'::jsonb THEN RAISE EXCEPTION 'FINANCE_PARTITION_INPUT'; END IF;
  IF control.mode<>'customer' THEN RAISE EXCEPTION 'FINANCE_PARTITION_DISABLED'; END IF;
  INSERT INTO public.billing_finance_sync_state(stripe_scope,resource_type,resource_key) VALUES(p_scope,'customer',p_customer) ON CONFLICT DO NOTHING;
  SELECT * INTO lease FROM public.billing_finance_sync_state WHERE stripe_scope=p_scope AND resource_type='customer' AND resource_key=p_customer FOR UPDATE;
  stamp:=clock_timestamp();IF lease.lease_until>stamp THEN RAISE EXCEPTION 'FINANCE_BUSY'; END IF;
  UPDATE public.billing_finance_sync_state SET lease_token=gen_random_uuid(),lease_until=stamp+interval '120 seconds',revision=revision+1,lease_protocol_epoch=control.epoch,updated_at=stamp
   WHERE stripe_scope=p_scope AND resource_type='customer' AND resource_key=p_customer RETURNING * INTO lease;
  RETURN jsonb_build_object('token',lease.lease_token,'revision',lease.revision::text,'epoch',control.epoch);
 END IF;
 SELECT * INTO lease FROM public.billing_finance_sync_state WHERE stripe_scope=p_scope AND resource_type='customer' AND resource_key=p_customer FOR UPDATE;
 IF NOT FOUND OR p_token IS NULL OR lease.lease_token IS DISTINCT FROM p_token OR lease.lease_protocol_epoch IS DISTINCT FROM control.epoch THEN RAISE EXCEPTION 'FINANCE_PARTITION_FENCE'; END IF;
 IF p_action='release_customer' THEN
  IF p_input-ARRAY['expected_epoch']::text[]<>'{}'::jsonb THEN RAISE EXCEPTION 'FINANCE_PARTITION_INPUT'; END IF;
  UPDATE public.billing_finance_sync_state SET lease_token=NULL,lease_until=NULL,lease_protocol_epoch=NULL,updated_at=clock_timestamp()
   WHERE stripe_scope=p_scope AND resource_type='customer' AND resource_key=p_customer;
  RETURN '{}'::jsonb;
 END IF;
 IF p_input-ARRAY['expected_epoch','expected_partition_revision','event_id','event_token','bundle']::text[]<>'{}'::jsonb
  OR jsonb_typeof(p_input->'expected_partition_revision') IS DISTINCT FROM 'string'
  OR coalesce(p_input->>'expected_partition_revision','') !~ '^(0|[1-9][0-9]{0,18})$'
  OR coalesce(p_input->>'event_id','') !~ '^evt_[A-Za-z0-9]{1,240}$'
  OR coalesce(p_input->>'event_token','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN RAISE EXCEPTION 'FINANCE_PARTITION_INPUT'; END IF;
 IF (p_input->>'expected_partition_revision')::numeric>9223372036854775807 THEN RAISE EXCEPTION 'FINANCE_PARTITION_INPUT'; END IF;
 expected_revision:=(p_input->>'expected_partition_revision')::bigint;
 IF lease.revision IS DISTINCT FROM expected_revision THEN RAISE EXCEPTION 'FINANCE_PARTITION_REVISION'; END IF;
 IF lease.lease_until<=clock_timestamp() THEN RAISE EXCEPTION 'FINANCE_PARTITION_FENCE'; END IF;
 SELECT * INTO receipt FROM public.billing_finance_event_deliveries WHERE stripe_scope=p_scope AND consumer_version='finance_v1' AND stripe_event_id=p_input->>'event_id' FOR UPDATE;
 IF NOT FOUND OR receipt.state<>'processing' OR receipt.lease_token IS DISTINCT FROM (p_input->>'event_token')::uuid OR receipt.lease_until<=clock_timestamp()
 THEN RAISE EXCEPTION 'FINANCE_PARTITION_RECEIPT_FENCE'; END IF;
 PERFORM public.billing_finance_customer_bundle_owner(p_scope,p_customer,p_input->'bundle');
 IF p_action='bind_receipt' THEN
  kind:=CASE WHEN receipt.event_type IN ('customer.subscription.created','customer.subscription.updated','customer.subscription.deleted') THEN 'subscriptions'
   WHEN receipt.event_type IN ('invoice.finalized','invoice.updated','invoice.paid','invoice.payment_failed','invoice.voided','invoice.marked_uncollectible') THEN 'invoices'
   WHEN receipt.event_type IN ('charge.succeeded','charge.failed','charge.captured','charge.refunded') THEN 'payments'
   WHEN receipt.event_type IN ('charge.refund.updated','refund.created','refund.updated','refund.failed') THEN 'refunds' END;
  IF kind IS NULL THEN RAISE EXCEPTION 'FINANCE_PARTITION_UNSUPPORTED'; END IF;
  PERFORM public.billing_finance_customer_resource_owner(p_scope,p_customer,p_input->'bundle',kind,receipt.subject_id);
  IF receipt.partition_customer_id IS NOT NULL AND receipt.partition_customer_id IS DISTINCT FROM p_customer THEN RAISE EXCEPTION 'FINANCE_PARTITION_BINDING_IMMUTABLE'; END IF;
  previous_context:=current_setting('dmi.finance_partition_binding',true);
  PERFORM set_config('dmi.finance_partition_binding',jsonb_build_object('scope',p_scope,'event',receipt.stripe_event_id,'customer',p_customer,'epoch',control.epoch,'receipt_token',receipt.lease_token,'lease_token',lease.lease_token,'revision',lease.revision)::text,true);
  UPDATE public.billing_finance_event_deliveries SET partition_customer_id=p_customer,partition_protocol_epoch=control.epoch,updated_at=clock_timestamp()
   WHERE stripe_scope=p_scope AND consumer_version='finance_v1' AND stripe_event_id=receipt.stripe_event_id;
  PERFORM set_config('dmi.finance_partition_binding',coalesce(previous_context,''),true);
 ELSE
  IF receipt.partition_customer_id IS DISTINCT FROM p_customer OR receipt.partition_protocol_epoch IS DISTINCT FROM control.epoch THEN RAISE EXCEPTION 'FINANCE_PARTITION_RECEIPT_OWNER'; END IF;
  written:=public.billing_finance_customer_apply_bundle(p_scope,p_input->'bundle',clock_timestamp());
  UPDATE public.billing_finance_event_deliveries SET state='processed',processed_at=clock_timestamp(),lease_token=NULL,lease_until=NULL,updated_at=clock_timestamp()
   WHERE stripe_scope=p_scope AND consumer_version='finance_v1' AND stripe_event_id=receipt.stripe_event_id;
  UPDATE public.billing_finance_sync_state SET revision=revision+1,verified_at=clock_timestamp(),lease_token=NULL,lease_until=NULL,lease_protocol_epoch=NULL,updated_at=clock_timestamp()
   WHERE stripe_scope=p_scope AND resource_type='customer' AND resource_key=p_customer;
 END IF;
 IF clock_timestamp()>=lease.lease_until OR clock_timestamp()>=receipt.lease_until THEN RAISE EXCEPTION 'FINANCE_PARTITION_FENCE'; END IF;
 RETURN CASE WHEN p_action='commit_customer' THEN jsonb_build_object('written',written) ELSE '{}'::jsonb END;
END $rpc$;

REVOKE ALL ON FUNCTION public.billing_finance_customer_apply_bundle(text,jsonb,timestamptz),public.billing_finance_customer_resource_owner(text,text,jsonb,text,text,integer),public.billing_finance_customer_bundle_owner(text,text,jsonb),public.billing_finance_receipt_partition_guard(),public.billing_finance_partition_command(text,text,text,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.billing_finance_partition_command(text,text,text,uuid,jsonb) TO service_role;
DO $acl$
DECLARE role_name text;function_name text;
BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  FOREACH function_name IN ARRAY ARRAY['public.billing_finance_customer_apply_bundle(text,jsonb,timestamptz)','public.billing_finance_customer_resource_owner(text,text,jsonb,text,text,integer)','public.billing_finance_customer_bundle_owner(text,text,jsonb)','public.billing_finance_receipt_partition_guard()'] LOOP
   IF has_function_privilege(role_name,function_name,'EXECUTE') THEN RAISE EXCEPTION 'FINANCE_PARTITION_PRIVATE_HELPER_ACCESS'; END IF;
  END LOOP;
  IF role_name<>'service_role' AND has_function_privilege(role_name,'public.billing_finance_partition_command(text,text,text,uuid,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'FINANCE_PARTITION_BROWSER_ACCESS'; END IF;
  IF has_column_privilege(role_name,'public.billing_finance_event_deliveries','partition_customer_id','UPDATE') OR has_column_privilege(role_name,'public.billing_finance_event_deliveries','partition_protocol_epoch','UPDATE') THEN RAISE EXCEPTION 'FINANCE_PARTITION_DIRECT_BINDING_ACCESS'; END IF;
 END LOOP;
 IF NOT has_function_privilege('service_role','public.billing_finance_partition_command(text,text,text,uuid,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'FINANCE_PARTITION_SERVICE_ACCESS'; END IF;
END $acl$;
COMMIT;
