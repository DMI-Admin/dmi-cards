-- Customer-mode zero-write receipt completion. No mode changes or ownership seeds.
-- Only the trusted server supplies signature-verified relationship projections.
-- SQL binds their root/type to the receipt and independently rechecks registry authority.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
CREATE FUNCTION public.billing_finance_foreign_evidence(p_scope text,p_evidence jsonb,p_proofs jsonb,p_depth integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,public AS $proof$
DECLARE kind text;prefix text;child jsonb;item jsonb;used jsonb:='[]';positive boolean:=false;refs jsonb;customers jsonb:='[]';
BEGIN
 IF p_depth>2 OR jsonb_typeof(p_evidence) IS DISTINCT FROM 'object' OR p_evidence->>'scope' IS DISTINCT FROM p_scope
 OR p_evidence->'complete' IS DISTINCT FROM 'true'::jsonb
 OR p_evidence-ARRAY['scope','id','kind','complete','customer','prices','relationships','dependencies']::text[]<>'{}'::jsonb
 THEN RAISE EXCEPTION 'FINANCE_OWNERSHIP_UNRESOLVED'; END IF;
 kind:=p_evidence->>'kind';prefix:=CASE kind WHEN 'subscription' THEN 'sub' WHEN 'invoice' THEN 'in' WHEN 'charge' THEN 'ch' WHEN 'refund' THEN 're' WHEN 'allocation' THEN 'inpay' END;
 IF prefix IS NULL OR coalesce(p_evidence->>'id','') !~ ('^'||prefix||'_[A-Za-z0-9]{1,240}$') THEN RAISE EXCEPTION 'FINANCE_OWNERSHIP_UNRESOLVED'; END IF;
 IF p_evidence ? 'customer' THEN
 item:=p_evidence->'customer';
 IF kind IN ('refund','allocation') OR item->>'scope' IS DISTINCT FROM p_scope OR item->>'type' IS DISTINCT FROM 'customer'
 OR coalesce(item->>'id','') !~ '^cus_[A-Za-z0-9]{1,240}$' OR item-ARRAY['scope','type','id']::text[]<>'{}'::jsonb THEN RAISE EXCEPTION 'FINANCE_OWNERSHIP_UNRESOLVED'; END IF;
 customers:=jsonb_build_array(item->>'id');
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_proofs) x WHERE x->>'type'='customer' AND x->>'id'=item->>'id') THEN used:=used||jsonb_build_array(item);positive:=true; END IF;
 END IF;
 refs:=coalesce(p_evidence->'prices','[]'::jsonb);
 IF jsonb_typeof(refs) IS DISTINCT FROM 'array' OR jsonb_array_length(refs)>20 OR (jsonb_array_length(refs)>0 AND kind NOT IN ('subscription','invoice')) THEN RAISE EXCEPTION 'FINANCE_OWNERSHIP_UNRESOLVED'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(refs) LOOP
 IF item->>'scope' IS DISTINCT FROM p_scope OR item->>'type' IS DISTINCT FROM 'price' OR coalesce(item->>'id','') !~ '^price_[A-Za-z0-9]{1,240}$'
 OR item-ARRAY['scope','type','id']::text[]<>'{}'::jsonb OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_proofs) x WHERE x->>'type'='price' AND x->>'id'=item->>'id') THEN RAISE EXCEPTION 'FINANCE_OWNERSHIP_UNRESOLVED'; END IF;
 used:=used||jsonb_build_array(item);positive:=true;
 END LOOP;
 refs:=coalesce(p_evidence->'dependencies','[]'::jsonb);
 IF jsonb_typeof(refs) IS DISTINCT FROM 'array' OR jsonb_array_length(refs)>20 OR jsonb_typeof(coalesce(p_evidence->'relationships','[]'::jsonb)) IS DISTINCT FROM 'array'
 OR jsonb_array_length(refs)<>jsonb_array_length(coalesce(p_evidence->'relationships','[]'::jsonb))
 OR (kind='refund' AND jsonb_array_length(refs)<>1)
 OR (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(coalesce(p_evidence->'relationships','[]'::jsonb)))<>jsonb_array_length(refs)
 OR (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(refs))<>jsonb_array_length(refs) THEN RAISE EXCEPTION 'FINANCE_OWNERSHIP_UNRESOLVED'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(refs) WITH ORDINALITY t(value,n) ORDER BY n LOOP
 IF (kind='subscription') OR (kind='invoice' AND item->>'kind'<>'subscription') OR (kind='charge' AND item->>'kind' NOT IN ('invoice','allocation'))
 OR (kind='allocation' AND item->>'kind'<>'invoice') OR (kind='refund' AND item->>'kind'<>'charge')
 OR NOT (coalesce(p_evidence->'relationships','[]'::jsonb) @> jsonb_build_array(item->>'id')) THEN RAISE EXCEPTION 'FINANCE_OWNERSHIP_UNRESOLVED'; END IF;
 child:=public.billing_finance_foreign_evidence(p_scope,item,p_proofs,p_depth+1);used:=used||(child->'used');customers:=customers||(child->'customers');positive:=true;
 END LOOP;
 IF NOT positive THEN RAISE EXCEPTION 'FINANCE_OWNERSHIP_UNRESOLVED'; END IF;
 IF (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(customers))>1 THEN RAISE EXCEPTION 'FINANCE_OWNERSHIP_CONFLICT'; END IF;
 RETURN jsonb_build_object('used',used,'customers',customers);
END $proof$;
CREATE FUNCTION public.billing_finance_complete_foreign(p_scope text,p_event text,p_token uuid,p_epoch bigint,p_evidence jsonb,p_proofs jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $rpc$
DECLARE control public.billing_finance_protocol_control%ROWTYPE;receipt public.billing_finance_event_deliveries%ROWTYPE;
 rowdata public.billing_stripe_resource_ownership%ROWTYPE;item jsonb;app text;used jsonb;expected_kind text;
BEGIN
 IF p_scope IS NULL OR p_scope !~ '^acct_[A-Za-z0-9]{1,240}:(test|live)$' OR p_event IS NULL OR p_event !~ '^evt_[A-Za-z0-9]{1,240}$'
 OR p_token IS NULL OR p_epoch IS NULL OR p_epoch<0 OR p_epoch>9007199254740991
 OR jsonb_typeof(p_evidence) IS DISTINCT FROM 'object' OR jsonb_typeof(p_proofs) IS DISTINCT FROM 'array'
 OR jsonb_array_length(p_proofs) NOT BETWEEN 1 AND 2 OR octet_length(p_evidence::text)>65536 OR octet_length(p_proofs::text)>4096 THEN RAISE EXCEPTION 'FINANCE_OWNERSHIP_UNRESOLVED'; END IF;
 SELECT * INTO control FROM public.billing_finance_protocol_control WHERE stripe_scope=p_scope FOR SHARE;
 IF NOT FOUND OR control.mode<>'customer' OR control.epoch IS DISTINCT FROM p_epoch THEN RAISE EXCEPTION 'FINANCE_PROTOCOL_EPOCH'; END IF;
 -- Lock application records before registry records; deterministic order agrees with operator writes.
 FOR app IN SELECT DISTINCT value->>'application' FROM jsonb_array_elements(p_proofs) ORDER BY 1 LOOP
 IF app IS NULL OR app='dmi_cards' OR app !~ '^[a-z][a-z0-9_]{2,63}$' THEN RAISE EXCEPTION 'FINANCE_OWNERSHIP_CONFLICT'; END IF;
 PERFORM 1 FROM public.billing_stripe_applications WHERE application_key=app AND state='active' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'FINANCE_OWNERSHIP_STALE'; END IF;
 END LOOP;
 IF (SELECT count(DISTINCT value->>'application') FROM jsonb_array_elements(p_proofs))<>1
 OR (SELECT count(DISTINCT (value->>'type',value->>'id')) FROM jsonb_array_elements(p_proofs))<>jsonb_array_length(p_proofs) THEN RAISE EXCEPTION 'FINANCE_OWNERSHIP_CONFLICT'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_proofs) ORDER BY value->>'type',value->>'id' LOOP
 IF item-ARRAY['scope','type','id','application','revision']::text[]<>'{}'::jsonb OR item->>'scope' IS DISTINCT FROM p_scope
 OR jsonb_typeof(item->'revision') IS DISTINCT FROM 'number' OR coalesce(item->>'revision','') !~ '^[1-9][0-9]{0,15}$' THEN RAISE EXCEPTION 'FINANCE_OWNERSHIP_UNRESOLVED'; END IF;
 SELECT * INTO rowdata FROM public.billing_stripe_resource_ownership WHERE stripe_scope=p_scope AND resource_type=item->>'type' AND stripe_resource_id=item->>'id' FOR SHARE;
 IF NOT FOUND OR rowdata.state<>'active' OR rowdata.application_key IS DISTINCT FROM item->>'application' OR rowdata.revision IS DISTINCT FROM (item->>'revision')::bigint THEN RAISE EXCEPTION 'FINANCE_OWNERSHIP_STALE'; END IF;
 END LOOP;
 used:=public.billing_finance_foreign_evidence(p_scope,p_evidence,p_proofs)->'used';
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_proofs) x WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(used) u WHERE u->>'type'=x->>'type' AND u->>'id'=x->>'id')) THEN RAISE EXCEPTION 'FINANCE_OWNERSHIP_UNRESOLVED'; END IF;
 SELECT * INTO receipt FROM public.billing_finance_event_deliveries WHERE stripe_scope=p_scope AND consumer_version='finance_v1' AND stripe_event_id=p_event FOR UPDATE;
 IF NOT FOUND OR receipt.subject_id IS DISTINCT FROM p_evidence->>'id' OR receipt.partition_customer_id IS NOT NULL OR receipt.partition_protocol_epoch IS NOT NULL THEN RAISE EXCEPTION 'FINANCE_PARTITION_RECEIPT_FENCE'; END IF;
 expected_kind:=CASE WHEN receipt.event_type IN ('customer.subscription.created','customer.subscription.updated','customer.subscription.deleted') THEN 'subscription'
 WHEN receipt.event_type IN ('invoice.finalized','invoice.updated','invoice.paid','invoice.payment_failed','invoice.voided','invoice.marked_uncollectible') THEN 'invoice'
 WHEN receipt.event_type IN ('charge.succeeded','charge.failed','charge.captured','charge.refunded') THEN 'charge'
 WHEN receipt.event_type IN ('charge.refund.updated','refund.created','refund.updated','refund.failed') THEN 'refund' END;
 IF expected_kind IS NULL OR expected_kind IS DISTINCT FROM p_evidence->>'kind' THEN RAISE EXCEPTION 'FINANCE_OWNERSHIP_UNRESOLVED'; END IF;
 IF receipt.state='ignored' AND receipt.error_code='FINANCE_FOREIGN_PROVEN' THEN RETURN jsonb_build_object('duplicate',true); END IF;
 IF receipt.state<>'processing' OR receipt.lease_token IS DISTINCT FROM p_token OR receipt.lease_until<=clock_timestamp() THEN RAISE EXCEPTION 'FINANCE_PARTITION_RECEIPT_FENCE'; END IF;
 UPDATE public.billing_finance_event_deliveries SET state='ignored',error_code='FINANCE_FOREIGN_PROVEN',processed_at=clock_timestamp(),lease_token=NULL,lease_until=NULL,updated_at=clock_timestamp()
 WHERE stripe_scope=p_scope AND consumer_version='finance_v1' AND stripe_event_id=p_event;
 RETURN jsonb_build_object('outcome','foreign_proven');
END $rpc$;
REVOKE ALL ON FUNCTION public.billing_finance_foreign_evidence(text,jsonb,jsonb,integer),public.billing_finance_complete_foreign(text,text,uuid,bigint,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.billing_finance_complete_foreign(text,text,uuid,bigint,jsonb,jsonb) TO service_role;
COMMIT;
