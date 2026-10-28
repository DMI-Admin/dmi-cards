-- Access seed only. No runner capability, live seed gate, V1 grant or V1 write.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
CREATE ROLE billing_v2_seed NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
SET LOCAL ROLE billing_v2_owner;
CREATE FUNCTION billing_v2.seed_canonical(value jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $seed$
DECLARE answer text;
BEGIN
 CASE jsonb_typeof(value)
 WHEN 'object' THEN SELECT '{'||coalesce(string_agg(to_jsonb(key)::text||':'||billing_v2.seed_canonical(v),',' ORDER BY key COLLATE "C"),'')||'}' INTO answer FROM jsonb_each(value) e(key,v);
 WHEN 'array' THEN SELECT '['||coalesce(string_agg(billing_v2.seed_canonical(v),',' ORDER BY ord),'')||']' INTO answer FROM jsonb_array_elements(value) WITH ORDINALITY e(v,ord);
 ELSE answer:=value::text;
 END CASE;
 RETURN answer;
END;
$seed$;
CREATE FUNCTION billing_v2.seed_digest(value jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $seed$
SELECT encode(sha256(convert_to(billing_v2.seed_canonical(value),'UTF8')),'hex');
$seed$;
CREATE FUNCTION billing_v2.seed_privileges() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $seed$
DECLARE bad integer; role_oid oid;
BEGIN
 SELECT oid INTO role_oid FROM pg_roles WHERE rolname='billing_v2_seed' AND NOT rolcanlogin AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication AND NOT rolbypassrls AND NOT rolinherit;
 IF role_oid IS NULL OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member=role_oid) THEN RAISE EXCEPTION 'V2_SEED_ROLE_UNSAFE';END IF;
 SELECT count(*) INTO bad FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r','p','v','m','f') AND (has_table_privilege(role_oid,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER,REFERENCES') OR has_any_column_privilege(role_oid,c.oid,'INSERT,UPDATE,REFERENCES') OR (n.nspname<>'billing_v2' AND has_table_privilege(role_oid,c.oid,'SELECT')));
 IF bad<>0 THEN RAISE EXCEPTION 'V2_SEED_TABLE_PRIVILEGE';END IF;
 IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE CASE WHEN c.relkind='S' AND n.nspname !~ '^pg_' THEN has_sequence_privilege(role_oid,c.oid,'USAGE,UPDATE,SELECT') ELSE false END) THEN RAISE EXCEPTION 'V2_SEED_SEQUENCE_PRIVILEGE';END IF;
 IF EXISTS(SELECT 1 FROM pg_namespace n WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND has_schema_privilege(role_oid,n.oid,'CREATE')) THEN RAISE EXCEPTION 'V2_SEED_SCHEMA_PRIVILEGE';END IF;
 IF has_database_privilege(role_oid,current_database(),'CREATE') THEN RAISE EXCEPTION 'V2_SEED_DATABASE_PRIVILEGE';END IF;
 IF EXISTS(SELECT 1 FROM pg_shdepend WHERE refclassid='pg_authid'::regclass AND refobjid=role_oid AND deptype='o') THEN RAISE EXCEPTION 'V2_SEED_OWNERSHIP_PRIVILEGE';END IF;
 -- Invoker SQL/PLpgSQL utilities gain no caller authority. Protect billing entry points
 -- regardless of invoker/definer mode; never exempt extension or native capabilities.
 IF EXISTS(
  SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
  WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND p.prokind IN ('f','p')
   AND has_function_privilege(role_oid,p.oid,'EXECUTE')
   AND NOT (n.nspname='billing_v2' AND p.proowner='billing_v2_owner'::regrole AND p.proname IN ('seed_begin','seed_page','seed_finalize','seed_verify','seed_privileges'))
   AND (
    (p.prosecdef AND has_schema_privilege(role_oid,n.oid,'USAGE')) OR n.nspname='billing_v2' OR p.proowner='billing_v2_owner'::regrole
    OR (n.nspname='public' AND p.proname ~ '^(billing_|stripe_)')
    OR (has_schema_privilege(role_oid,n.oid,'USAGE') AND (
     l.lanname NOT IN ('sql','plpgsql') OR NOT l.lanpltrusted
     OR EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e')
    ))
   )
 ) THEN RAISE EXCEPTION 'V2_SEED_FUNCTION_PRIVILEGE';END IF;
 RETURN '{"safe":true,"execution_enabled":false}'::jsonb;
END;
$seed$;
CREATE FUNCTION billing_v2.seed_inert() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $seed$
BEGIN
 IF EXISTS(SELECT 1 FROM billing_v2.event_inbox) OR EXISTS(SELECT 1 FROM billing_v2.authority) OR EXISTS(SELECT 1 FROM billing_v2.checkout_attempts) OR EXISTS(SELECT 1 FROM billing_v2.finance_subscriptions) OR EXISTS(SELECT 1 FROM billing_v2.finance_subscription_items) OR EXISTS(SELECT 1 FROM billing_v2.invoices) OR EXISTS(SELECT 1 FROM billing_v2.payments) OR EXISTS(SELECT 1 FROM billing_v2.invoice_payments) OR EXISTS(SELECT 1 FROM billing_v2.refunds) OR EXISTS(SELECT 1 FROM billing_v2.payment_attempts) OR EXISTS(SELECT 1 FROM billing_v2.finance_activity) THEN RAISE EXCEPTION 'V2_SEED_NOT_INERT';END IF;
END;
$seed$;
CREATE FUNCTION billing_v2.seed_begin(manifest jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $seed$
DECLARE saved billing_v2.operations; p jsonb; ordinal integer:=0; previous text; total integer:=0; counts jsonb;
BEGIN
 PERFORM billing_v2.seed_privileges();PERFORM pg_advisory_xact_lock(hashtextextended('billing_v2_access_seed',0));PERFORM billing_v2.seed_inert();
 IF NOT manifest ?& ARRAY['version','generation','scope','checkpoint','counts','pages','digest'] OR manifest-ARRAY['version','generation','scope','checkpoint','counts','pages','digest']<>'{}'::jsonb OR manifest->>'version' IS DISTINCT FROM '1' OR manifest->>'scope' IS DISTINCT FROM 'acct_1OoTzlG71GpCYtA4:test' OR (manifest->>'generation')::uuid IS NULL OR manifest->>'digest' IS DISTINCT FROM billing_v2.seed_digest(manifest-'digest') OR jsonb_typeof(manifest->'pages') IS DISTINCT FROM 'array' OR jsonb_array_length(manifest->'pages')>10000 OR jsonb_typeof(manifest->'checkpoint') IS DISTINCT FROM 'object' OR (manifest->'checkpoint')-ARRAY['snapshot','captured_at','source_digest']<>'{}'::jsonb OR length(coalesce(manifest->'checkpoint'->>'snapshot','')) NOT BETWEEN 1 AND 255 OR (manifest->'checkpoint'->>'captured_at')::timestamptz IS NULL OR coalesce(manifest->'checkpoint'->>'source_digest','')!~'^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'V2_SEED_MANIFEST';END IF;
 counts:=manifest->'counts';IF jsonb_typeof(counts) IS DISTINCT FROM 'object' OR counts-ARRAY['accounts','price_catalog','subscriptions']<>'{}'::jsonb OR NOT counts ?& ARRAY['accounts','price_catalog','subscriptions'] THEN RAISE EXCEPTION 'V2_SEED_COUNTS';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_each(counts)e WHERE jsonb_typeof(e.value)<>'number' OR e.value::text!~'^[0-9]+$') THEN RAISE EXCEPTION 'V2_SEED_COUNTS';END IF;
 IF (counts->>'accounts')::integer<0 OR (counts->>'price_catalog')::integer<1 OR (counts->>'subscriptions')::integer<0 THEN RAISE EXCEPTION 'V2_SEED_COUNTS';END IF;
 FOR p IN SELECT value FROM jsonb_array_elements(manifest->'pages') LOOP
  IF NOT p ?& ARRAY['index','first','last','count','digest'] OR p-ARRAY['index','first','last','count','digest']<>'{}'::jsonb OR (p->>'index')::integer IS DISTINCT FROM ordinal OR (p->>'count')::integer NOT BETWEEN 1 AND 100 OR coalesce(p->>'digest','')!~'^[0-9a-f]{64}$' OR p->>'first' IS NULL OR p->>'last' IS NULL OR (p->>'first') COLLATE "C">(p->>'last') COLLATE "C" OR (previous IS NOT NULL AND previous COLLATE "C">=(p->>'first') COLLATE "C") THEN RAISE EXCEPTION 'V2_SEED_PAGES';END IF;
  previous:=p->>'last';ordinal:=ordinal+1;total:=total+(p->>'count')::integer;
 END LOOP;
 IF total<>(counts->>'accounts')::integer+(counts->>'price_catalog')::integer+(counts->>'subscriptions')::integer THEN RAISE EXCEPTION 'V2_SEED_COUNTS';END IF;
 SELECT * INTO saved FROM billing_v2.operations WHERE stripe_scope=manifest->>'scope' AND id=(manifest->>'generation')::uuid FOR UPDATE;
 IF FOUND THEN IF saved.facts->'manifest' IS DISTINCT FROM manifest THEN RAISE EXCEPTION 'V2_SEED_CONFLICT';END IF;RETURN jsonb_build_object('kind','resume','complete',saved.status='completed');END IF;
 IF EXISTS(SELECT 1 FROM billing_v2.operations) OR EXISTS(SELECT 1 FROM billing_v2.accounts) OR EXISTS(SELECT 1 FROM billing_v2.price_catalog) OR EXISTS(SELECT 1 FROM billing_v2.subscriptions) THEN RAISE EXCEPTION 'V2_SEED_REBUILD_REQUIRED';END IF;
 INSERT INTO billing_v2.operations(stripe_scope,id,record_type,operation_kind,source_kind,source_id,status,facts,started_at) VALUES(manifest->>'scope',(manifest->>'generation')::uuid,'run','backfill','recovery','access-seed:'||(manifest->>'generation'),'running',jsonb_build_object('version',1,'stage','preparing','manifest',manifest),clock_timestamp());
 RETURN '{"kind":"preparing","execution_enabled":false}'::jsonb;
END;
$seed$;
CREATE FUNCTION billing_v2.seed_page(generation uuid,page_index integer,checkpoint jsonb,rows jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $seed$
DECLARE run billing_v2.operations; expected jsonb; e jsonb; payload jsonb; tbl text; keys text[]; previous text; hash text; page_id text; saved jsonb; a billing_v2.accounts; p billing_v2.price_catalog; s billing_v2.subscriptions; n integer:=0;
BEGIN
 PERFORM billing_v2.seed_privileges();PERFORM pg_advisory_xact_lock(hashtextextended('billing_v2_access_seed',0));PERFORM billing_v2.seed_inert();
 SELECT * INTO run FROM billing_v2.operations WHERE id=generation AND source_id='access-seed:'||generation::text FOR UPDATE;
 IF NOT FOUND OR run.facts->'manifest'->'checkpoint' IS DISTINCT FROM checkpoint OR page_index<0 OR jsonb_typeof(rows) IS DISTINCT FROM 'array' OR jsonb_array_length(rows) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'V2_SEED_PAGE';END IF;
 expected:=run.facts->'manifest'->'pages'->page_index;hash:=billing_v2.seed_digest(rows);page_id:='access-seed:'||generation::text||':page:'||page_index::text;
 IF expected IS NULL OR hash IS DISTINCT FROM expected->>'digest' OR jsonb_array_length(rows) IS DISTINCT FROM (expected->>'count')::integer THEN RAISE EXCEPTION 'V2_SEED_PAGE_DIGEST';END IF;
 SELECT facts INTO saved FROM billing_v2.operations WHERE stripe_scope=run.stripe_scope AND source_id=page_id;
 IF saved IS NOT NULL THEN IF saved->>'digest' IS DISTINCT FROM hash THEN RAISE EXCEPTION 'V2_SEED_CONFLICT';END IF;RETURN '{"kind":"duplicate"}'::jsonb;END IF;
 IF run.status<>'running' OR (SELECT count(*) FROM billing_v2.operations WHERE parent_run_id=generation AND outcome='seed_page')<>page_index THEN RAISE EXCEPTION 'V2_SEED_PAGE_ORDER';END IF;
 FOR e IN SELECT value FROM jsonb_array_elements(rows) LOOP
  tbl:=e->>'table';payload:=e->'row';IF e-ARRAY['key','table','row']<>'{}'::jsonb OR tbl NOT IN ('accounts','price_catalog','subscriptions') OR jsonb_typeof(payload) IS DISTINCT FROM 'object' OR payload->>'stripe_scope' IS DISTINCT FROM run.stripe_scope OR e->>'key' IS DISTINCT FROM tbl||':'||coalesce(payload->>'id',payload->>'stripe_subscription_id',payload->>'stripe_price_id') OR (previous IS NOT NULL AND previous COLLATE "C">=(e->>'key') COLLATE "C") THEN RAISE EXCEPTION 'V2_SEED_ROW';END IF;
  IF n=0 AND e->>'key' IS DISTINCT FROM expected->>'first' THEN RAISE EXCEPTION 'V2_SEED_CURSOR';END IF;previous:=e->>'key';n:=n+1;
  SELECT array_agg(attname::text) INTO keys FROM pg_attribute WHERE attrelid=('billing_v2.'||tbl)::regclass AND attnum>0 AND NOT attisdropped;
  IF payload-keys<>'{}'::jsonb OR EXISTS(SELECT 1 FROM unnest(keys)k WHERE NOT payload ? k) THEN RAISE EXCEPTION 'V2_SEED_FIELDS';END IF;
  IF tbl='accounts' THEN
   a:=jsonb_populate_record(NULL::billing_v2.accounts,payload);IF a.binding_state IS DISTINCT FROM 'verified' OR a.principal_kind IS DISTINCT FROM 'individual' OR a.principal_id IS NULL OR a.stripe_customer_id IS NULL OR a.verified_at IS NULL THEN RAISE EXCEPTION 'V2_SEED_OWNERSHIP';END IF;INSERT INTO billing_v2.accounts SELECT a.*;
  ELSIF tbl='price_catalog' THEN
   p:=jsonb_populate_record(NULL::billing_v2.price_catalog,payload);IF p.application_key IS DISTINCT FROM 'dmi_cards' OR p.stripe_product_id IS NULL THEN RAISE EXCEPTION 'V2_SEED_PRICE';END IF;INSERT INTO billing_v2.price_catalog SELECT p.*;
  ELSE
   s:=jsonb_populate_record(NULL::billing_v2.subscriptions,payload);IF s.snapshot_digest !~ '^[0-9a-f]{64}$' OR s.verified_at IS NULL THEN RAISE EXCEPTION 'V2_SEED_SUBSCRIPTION';END IF;INSERT INTO billing_v2.subscriptions SELECT s.*;
  END IF;
 END LOOP;
 IF previous IS DISTINCT FROM expected->>'last' THEN RAISE EXCEPTION 'V2_SEED_CURSOR';END IF;
 INSERT INTO billing_v2.operations(stripe_scope,id,record_type,operation_kind,parent_run_id,source_kind,source_id,status,outcome,facts,completed_at) VALUES(run.stripe_scope,gen_random_uuid(),'audit','backfill',generation,'recovery',page_id,'completed','seed_page',jsonb_build_object('version',1,'stage','seed_page','digest',hash,'rows',rows),clock_timestamp());
 RETURN jsonb_build_object('kind','imported','rows',n);
END;
$seed$;
CREATE FUNCTION billing_v2.seed_verify(generation uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $seed$
DECLARE run billing_v2.operations; counts jsonb; pages integer; entry jsonb; actual jsonb; e jsonb; index_value integer:=0;
BEGIN
 PERFORM billing_v2.seed_privileges();PERFORM billing_v2.seed_inert();
 SELECT * INTO run FROM billing_v2.operations WHERE id=generation AND source_id='access-seed:'||generation::text;
 IF NOT FOUND THEN RAISE EXCEPTION 'V2_SEED_MISSING';END IF;
 counts:=jsonb_build_object('accounts',(SELECT count(*) FROM billing_v2.accounts),'price_catalog',(SELECT count(*) FROM billing_v2.price_catalog),'subscriptions',(SELECT count(*) FROM billing_v2.subscriptions));
 SELECT count(*) INTO pages FROM billing_v2.operations WHERE parent_run_id=generation AND outcome='seed_page';
 IF counts IS DISTINCT FROM run.facts->'manifest'->'counts' OR pages<>jsonb_array_length(run.facts->'manifest'->'pages') OR run.facts->'manifest'->>'digest' IS DISTINCT FROM billing_v2.seed_digest((run.facts->'manifest')-'digest') THEN RAISE EXCEPTION 'V2_SEED_INCOMPLETE';END IF;
 FOR entry IN SELECT value FROM jsonb_array_elements(run.facts->'manifest'->'pages') LOOP
  SELECT facts INTO actual FROM billing_v2.operations WHERE parent_run_id=generation AND source_id='access-seed:'||generation::text||':page:'||index_value::text AND outcome='seed_page';
  IF actual->>'digest' IS DISTINCT FROM entry->>'digest' OR billing_v2.seed_digest(actual->'rows') IS DISTINCT FROM entry->>'digest' THEN RAISE EXCEPTION 'V2_SEED_STORED_DIGEST';END IF;
  FOR e IN SELECT value FROM jsonb_array_elements(actual->'rows') LOOP
   IF e->>'table'='accounts' THEN SELECT to_jsonb(a) INTO actual FROM billing_v2.accounts a WHERE stripe_scope=run.stripe_scope AND id=(e->'row'->>'id')::uuid;IF actual IS DISTINCT FROM to_jsonb(jsonb_populate_record(NULL::billing_v2.accounts,e->'row')) THEN RAISE EXCEPTION 'V2_SEED_CONTENT';END IF;
   ELSIF e->>'table'='price_catalog' THEN SELECT to_jsonb(p) INTO actual FROM billing_v2.price_catalog p WHERE stripe_scope=run.stripe_scope AND stripe_price_id=e->'row'->>'stripe_price_id';IF actual IS DISTINCT FROM to_jsonb(jsonb_populate_record(NULL::billing_v2.price_catalog,e->'row')) THEN RAISE EXCEPTION 'V2_SEED_CONTENT';END IF;
   ELSE SELECT to_jsonb(s) INTO actual FROM billing_v2.subscriptions s WHERE stripe_scope=run.stripe_scope AND stripe_subscription_id=e->'row'->>'stripe_subscription_id';IF actual IS DISTINCT FROM to_jsonb(jsonb_populate_record(NULL::billing_v2.subscriptions,e->'row')) THEN RAISE EXCEPTION 'V2_SEED_CONTENT';END IF;END IF;
  END LOOP;
  index_value:=index_value+1;
 END LOOP;
 IF EXISTS(SELECT 1 FROM billing_v2.accounts WHERE binding_state<>'verified' OR principal_kind<>'individual') OR EXISTS(SELECT 1 FROM billing_v2.subscriptions s LEFT JOIN billing_v2.accounts a ON a.stripe_scope=s.stripe_scope AND a.id=s.billing_account_id LEFT JOIN billing_v2.price_catalog p ON p.stripe_scope=s.stripe_scope AND p.stripe_price_id=s.stripe_price_id WHERE a.id IS NULL OR a.stripe_customer_id IS DISTINCT FROM s.stripe_customer_id OR a.binding_state<>'verified' OR (s.stripe_price_id IS NOT NULL AND p.stripe_price_id IS NULL) OR s.terminal IS DISTINCT FROM (s.status='canceled') OR s.plan IS DISTINCT FROM CASE WHEN s.status IN ('active','trialing') THEN 'pro' ELSE 'free' END OR (s.plan='pro' AND NOT coalesce(p.entitlement_enabled,false))) THEN RAISE EXCEPTION 'V2_SEED_RELATIONSHIP';END IF;
 RETURN jsonb_build_object('complete',run.status='completed','verified',true,'counts',counts,'pages',pages,'generation',generation,'manifest_digest',run.facts->'manifest'->>'digest','checkpoint',run.facts->'manifest'->'checkpoint','completed_at',run.completed_at,'execution_enabled',false);
END;
$seed$;
CREATE FUNCTION billing_v2.seed_finalize(generation uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $seed$
DECLARE report jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('billing_v2_access_seed',0));PERFORM 1 FROM billing_v2.operations WHERE id=generation FOR UPDATE;
 report:=billing_v2.seed_verify(generation);IF report->'complete'='true'::jsonb THEN RETURN report;END IF;
 UPDATE billing_v2.operations SET status='completed',facts=jsonb_set(facts,'{stage}','"complete"'::jsonb),completed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=generation AND source_id='access-seed:'||generation::text;
 -- Deliberately NO authority/shadow_dataset marker: ordinary claims stay blocked_seed.
 RETURN billing_v2.seed_verify(generation);
END;
$seed$;
CREATE FUNCTION billing_v2.seed_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $seed$
BEGIN
 IF OLD.source_id LIKE 'access-seed:%' AND OLD.record_type='run' AND OLD.status='completed' THEN RAISE EXCEPTION 'V2_SEED_IMMUTABLE';END IF;RETURN NEW;
END;
$seed$;
CREATE TRIGGER seed_manifest_immutable BEFORE UPDATE OR DELETE ON billing_v2.operations FOR EACH ROW EXECUTE FUNCTION billing_v2.seed_guard();
REVOKE ALL ON FUNCTION billing_v2.seed_canonical(jsonb),billing_v2.seed_digest(jsonb),billing_v2.seed_privileges(),billing_v2.seed_inert(),billing_v2.seed_begin(jsonb),billing_v2.seed_page(uuid,integer,jsonb,jsonb),billing_v2.seed_verify(uuid),billing_v2.seed_finalize(uuid),billing_v2.seed_guard() FROM PUBLIC,anon,authenticated,service_role,billing_v2_executor;
GRANT USAGE ON SCHEMA billing_v2 TO billing_v2_seed;
GRANT EXECUTE ON FUNCTION billing_v2.seed_begin(jsonb),billing_v2.seed_page(uuid,integer,jsonb,jsonb),billing_v2.seed_verify(uuid),billing_v2.seed_finalize(uuid),billing_v2.seed_privileges() TO billing_v2_seed;
COMMIT;
