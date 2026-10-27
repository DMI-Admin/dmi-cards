-- Isolated candidate transactions. No current/public writer is called.
BEGIN;
SET LOCAL ROLE billing_v2_owner;
CREATE FUNCTION billing_v2.append_audit(scope text, operation_kind text, source_id text, facts jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $v2$
#variable_conflict use_column
DECLARE found uuid; saved jsonb;
BEGIN
 IF NOT billing_v2.valid_document('operation_facts',facts) THEN RAISE EXCEPTION 'V2_INVALID_AUDIT'; END IF;
 INSERT INTO billing_v2.operations(stripe_scope,id,record_type,operation_kind,source_kind,source_id,status,outcome,task_id,facts,completed_at)
 VALUES(scope,gen_random_uuid(),'audit',operation_kind,'recovery',source_id,'completed',coalesce(facts->>'stage','processed'),(facts->>'task')::uuid,facts,clock_timestamp())
 ON CONFLICT(stripe_scope,operation_kind,source_kind,source_id,record_type) DO NOTHING RETURNING id INTO found;
 IF found IS NULL THEN SELECT id,operations.facts INTO found,saved FROM billing_v2.operations WHERE stripe_scope=scope AND operations.operation_kind=append_audit.operation_kind AND operations.source_id=append_audit.source_id AND record_type='audit';IF saved IS DISTINCT FROM facts THEN RAISE EXCEPTION 'V2_AUDIT_CONFLICT'; END IF; END IF;
 RETURN found;
END;
$v2$;
CREATE FUNCTION billing_v2.guard_immutable() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $v2$
#variable_conflict use_column
DECLARE k text; keys text[];
BEGIN
 IF TG_TABLE_NAME='operations' AND to_jsonb(OLD)->>'record_type'='audit' THEN RAISE EXCEPTION 'V2_IMMUTABLE_AUDIT'; END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'V2_RETENTION_NOT_AUTHORIZED'; END IF;
 keys:=string_to_array(TG_ARGV[0],',');FOREACH k IN ARRAY keys LOOP IF to_jsonb(OLD)->k IS DISTINCT FROM to_jsonb(NEW)->k THEN RAISE EXCEPTION 'V2_IMMUTABLE_FIELD'; END IF;END LOOP;
 IF TG_TABLE_NAME='event_inbox' AND to_jsonb(OLD)->>'state' IN ('completed','needs_attention') AND to_jsonb(OLD) IS DISTINCT FROM to_jsonb(NEW) THEN RAISE EXCEPTION 'V2_TERMINAL_TASK'; END IF;
 RETURN NEW;
END;
$v2$;
CREATE FUNCTION billing_v2.guard_completion() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $v2$
#variable_conflict use_column
DECLARE task billing_v2.event_inbox; n integer;
BEGIN
 SELECT * INTO task FROM billing_v2.event_inbox WHERE stripe_scope=NEW.stripe_scope AND id=NEW.id;
 IF task.state='completed' THEN SELECT count(*) INTO n FROM billing_v2.operations WHERE stripe_scope=task.stripe_scope AND task_id=task.id AND record_type='audit' AND outcome=task.result AND facts->>'digest'=task.projection_digest;IF n<>1 THEN RAISE EXCEPTION 'V2_COMPLETION_AUDIT'; END IF;IF task.task_kind='access' AND NOT EXISTS(SELECT 1 FROM billing_v2.subscriptions WHERE stripe_scope=task.stripe_scope AND stripe_subscription_id=task.evidence->>'subscription' AND revision=task.projection_revision AND snapshot_digest=task.projection_digest) THEN RAISE EXCEPTION 'V2_COMPLETION_PROJECTION';END IF;END IF;
 RETURN NULL;
END;
$v2$;
CREATE TRIGGER immutable_fields BEFORE UPDATE OR DELETE ON billing_v2.accounts FOR EACH ROW EXECUTE FUNCTION billing_v2.guard_immutable('stripe_scope,id,created_at');
CREATE TRIGGER immutable_fields BEFORE UPDATE OR DELETE ON billing_v2.checkout_attempts FOR EACH ROW EXECUTE FUNCTION billing_v2.guard_immutable('stripe_scope,id,billing_account_id,operation_kind,presentation,idempotency_key,parameters,parameters_digest,replay_deadline,created_at');
CREATE TRIGGER immutable_fields BEFORE UPDATE OR DELETE ON billing_v2.price_catalog FOR EACH ROW EXECUTE FUNCTION billing_v2.guard_immutable('stripe_scope,stripe_price_id,application_key,ownership_basis,created_at');
CREATE TRIGGER immutable_fields BEFORE UPDATE OR DELETE ON billing_v2.subscriptions FOR EACH ROW EXECUTE FUNCTION billing_v2.guard_immutable('stripe_scope,stripe_subscription_id,billing_account_id,stripe_customer_id,created_at');
CREATE TRIGGER immutable_fields BEFORE UPDATE OR DELETE ON billing_v2.event_inbox FOR EACH ROW EXECUTE FUNCTION billing_v2.guard_immutable('stripe_scope,id,source_kind,source_id,task_kind,stripe_event_id,event_type,event_created,evidence_version,evidence,evidence_digest,arrival_sequence,created_at');
CREATE TRIGGER immutable_fields BEFORE UPDATE OR DELETE ON billing_v2.authority FOR EACH ROW EXECUTE FUNCTION billing_v2.guard_immutable('stripe_scope,domain,resource_key,billing_account_id,created_at');
CREATE TRIGGER immutable_fields BEFORE UPDATE OR DELETE ON billing_v2.operations FOR EACH ROW EXECUTE FUNCTION billing_v2.guard_immutable('stripe_scope,id,record_type,operation_kind,parent_run_id,source_kind,source_id,billing_account_id,task_id,created_at');
CREATE TRIGGER immutable_fields BEFORE UPDATE OR DELETE ON billing_v2.finance_subscriptions FOR EACH ROW EXECUTE FUNCTION billing_v2.guard_immutable('stripe_scope,stripe_object_id,created_at');
CREATE TRIGGER immutable_fields BEFORE UPDATE OR DELETE ON billing_v2.finance_subscription_items FOR EACH ROW EXECUTE FUNCTION billing_v2.guard_immutable('stripe_scope,stripe_object_id,created_at');
CREATE TRIGGER immutable_fields BEFORE UPDATE OR DELETE ON billing_v2.invoices FOR EACH ROW EXECUTE FUNCTION billing_v2.guard_immutable('stripe_scope,stripe_object_id,created_at');
CREATE TRIGGER immutable_fields BEFORE UPDATE OR DELETE ON billing_v2.payments FOR EACH ROW EXECUTE FUNCTION billing_v2.guard_immutable('stripe_scope,stripe_object_id,created_at');
CREATE TRIGGER immutable_fields BEFORE UPDATE OR DELETE ON billing_v2.invoice_payments FOR EACH ROW EXECUTE FUNCTION billing_v2.guard_immutable('stripe_scope,stripe_object_id,created_at');
CREATE TRIGGER immutable_fields BEFORE UPDATE OR DELETE ON billing_v2.refunds FOR EACH ROW EXECUTE FUNCTION billing_v2.guard_immutable('stripe_scope,stripe_object_id,created_at');
CREATE TRIGGER immutable_fields BEFORE UPDATE OR DELETE ON billing_v2.payment_attempts FOR EACH ROW EXECUTE FUNCTION billing_v2.guard_immutable('stripe_scope,attempt_key,created_at');
CREATE TRIGGER immutable_fields BEFORE UPDATE OR DELETE ON billing_v2.finance_activity FOR EACH ROW EXECUTE FUNCTION billing_v2.guard_immutable('stripe_scope,activity_key,created_at');
CREATE CONSTRAINT TRIGGER completed_task_audit AFTER INSERT OR UPDATE ON billing_v2.event_inbox DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION billing_v2.guard_completion();
CREATE FUNCTION billing_v2.assert_fence(fence jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $v2$
#variable_conflict use_column
DECLARE t billing_v2.event_inbox; a billing_v2.authority;
BEGIN
 SELECT * INTO t FROM billing_v2.event_inbox WHERE stripe_scope=fence->>'scope' AND id=(fence->>'task_id')::uuid FOR UPDATE;
 IF NOT FOUND OR t.state<>'processing' OR t.lease_until<=clock_timestamp() OR t.lease_token IS DISTINCT FROM (fence->>'token')::uuid OR t.claim_generation::text IS DISTINCT FROM fence->>'claim_generation' OR t.writer_engine IS DISTINCT FROM fence->>'engine' OR t.writer_engine<>'shadow' OR t.billing_account_id IS DISTINCT FROM (fence->>'account_id')::uuid THEN RAISE EXCEPTION 'V2_FENCED'; END IF;
 IF t.billing_account_id IS NULL THEN IF fence->>'authority_generation' IS NOT NULL THEN RAISE EXCEPTION 'V2_FENCED';END IF;RETURN;END IF;
 SELECT * INTO a FROM billing_v2.authority WHERE stripe_scope=t.stripe_scope AND domain=t.task_kind AND resource_key=t.billing_account_id::text FOR UPDATE;
 IF NOT FOUND OR a.writer_engine<>'shadow' OR a.mode<>'shadow_only' OR a.inbox_task_id IS DISTINCT FROM t.id OR a.generation IS DISTINCT FROM t.authority_generation OR a.generation::text IS DISTINCT FROM fence->>'authority_generation' THEN RAISE EXCEPTION 'V2_FENCED'; END IF;
END;
$v2$;
CREATE FUNCTION billing_v2.acquire_authority(scope text, domain text, account_id uuid, operation_kind text, operation_id uuid, operation_token uuid, claim_generation bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $v2$
#variable_conflict use_column
DECLARE t billing_v2.event_inbox; a billing_v2.authority; old_until timestamptz;
BEGIN
 IF operation_kind<>'task' OR domain NOT IN ('access','finance') THEN RETURN '{"kind":"blocked"}'::jsonb; END IF;
 SELECT * INTO t FROM billing_v2.event_inbox WHERE stripe_scope=scope AND id=operation_id FOR UPDATE;
 IF NOT FOUND OR t.state<>'processing' OR t.lease_until<=clock_timestamp() OR t.lease_token IS DISTINCT FROM operation_token OR t.claim_generation<>acquire_authority.claim_generation OR t.task_kind<>domain OR t.billing_account_id IS NOT NULL AND t.billing_account_id<>account_id THEN RETURN '{"kind":"fenced"}'::jsonb; END IF;
 PERFORM 1 FROM billing_v2.accounts WHERE stripe_scope=scope AND id=account_id;IF NOT FOUND THEN RETURN '{"kind":"blocked"}'::jsonb;END IF;
 INSERT INTO billing_v2.authority(stripe_scope,domain,resource_key,billing_account_id,generation) VALUES(scope,domain,account_id::text,account_id,0) ON CONFLICT DO NOTHING;
 SELECT * INTO a FROM billing_v2.authority WHERE stripe_scope=scope AND authority.domain=acquire_authority.domain AND resource_key=account_id::text FOR UPDATE;
 IF a.inbox_task_id IS NOT NULL AND a.inbox_task_id<>operation_id THEN SELECT lease_until INTO old_until FROM billing_v2.event_inbox WHERE stripe_scope=scope AND id=a.inbox_task_id;IF old_until>clock_timestamp() THEN RETURN '{"kind":"busy"}'::jsonb;END IF;END IF;
 IF a.checkout_attempt_id IS NOT NULL THEN RETURN '{"kind":"busy"}'::jsonb;END IF;
 UPDATE billing_v2.authority SET generation=CASE WHEN inbox_task_id=operation_id THEN generation ELSE generation+1 END,inbox_task_id=operation_id,updated_at=clock_timestamp() WHERE stripe_scope=scope AND authority.domain=acquire_authority.domain AND resource_key=account_id::text RETURNING * INTO a;
 UPDATE billing_v2.event_inbox SET billing_account_id=account_id,authority_generation=a.generation WHERE stripe_scope=scope AND id=operation_id;
 RETURN jsonb_build_object('kind','acquired','generation',a.generation::text);
END;
$v2$;
CREATE FUNCTION billing_v2.admit(scope text, source_kind text, source_id text, evidence jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $v2$
#variable_conflict use_column
DECLARE kinds text[];kind text;existing billing_v2.event_inbox;account uuid;ids uuid[]:=ARRAY[]::uuid[];hash text;conflict boolean:=false; inserted integer:=0; new_count integer:=0;
BEGIN
 IF scope!~'^acct_[A-Za-z0-9]+:test$' OR source_kind NOT IN ('webhook','reconciliation','recovery') OR length(source_id) NOT BETWEEN 1 AND 255 OR NOT billing_v2.valid_document('task_evidence',evidence) OR evidence->'livemode'<>'false'::jsonb OR (evidence ? 'event_account' AND evidence->>'event_account'<>split_part(scope,':',1)) THEN RAISE EXCEPTION 'V2_INVALID_EVIDENCE'; END IF;
 kinds:=CASE WHEN evidence->>'event_type' IN ('customer.subscription.created','customer.subscription.updated','customer.subscription.deleted','invoice.paid','invoice.payment_failed','invoice.payment_succeeded') THEN ARRAY['access','finance'] WHEN evidence->>'event_type'='checkout.session.completed' THEN ARRAY['access'] WHEN evidence->>'event_type' IN ('invoice.finalized','invoice.updated','invoice.voided','invoice.marked_uncollectible','charge.succeeded','charge.failed','charge.captured','charge.refunded','charge.refund.updated','refund.created','refund.updated','refund.failed') THEN ARRAY['finance'] ELSE ARRAY[]::text[] END;
 hash:=encode(sha256(convert_to(evidence::text,'UTF8')),'hex');IF coalesce(evidence->>'customer','')~'^cus_[A-Za-z0-9]+$' THEN INSERT INTO billing_v2.accounts(stripe_scope,stripe_customer_id,principal_kind,binding_state,binding_revision) VALUES(scope,evidence->>'customer','unresolved','unresolved',0) ON CONFLICT(stripe_scope,stripe_customer_id) WHERE stripe_customer_id IS NOT NULL DO NOTHING;END IF;SELECT id INTO account FROM billing_v2.accounts WHERE stripe_scope=scope AND stripe_customer_id=evidence->>'customer';
 FOREACH kind IN ARRAY kinds LOOP
  INSERT INTO billing_v2.event_inbox(stripe_scope,id,source_kind,source_id,task_kind,stripe_event_id,event_type,event_created,evidence_version,evidence,evidence_digest,billing_account_id,state,available_at)
  VALUES(scope,gen_random_uuid(),source_kind,source_id,kind,CASE WHEN source_kind='webhook' THEN source_id END,evidence->>'event_type',(evidence->>'event_created')::bigint,1,evidence,hash,account,'queued',clock_timestamp())
  ON CONFLICT(stripe_scope,source_kind,source_id,task_kind) DO NOTHING;
  GET DIAGNOSTICS inserted=ROW_COUNT;new_count:=new_count+inserted;
  SELECT * INTO existing FROM billing_v2.event_inbox WHERE stripe_scope=scope AND event_inbox.source_kind=admit.source_kind AND event_inbox.source_id=admit.source_id AND task_kind=kind FOR UPDATE;
  ids:=array_append(ids,existing.id);
  IF existing.evidence_digest<>hash THEN
   conflict:=true;
   IF existing.state NOT IN ('completed','needs_attention') THEN UPDATE billing_v2.event_inbox SET state='needs_attention',failure_category='invalid_evidence',lease_token=NULL,lease_until=NULL,writer_engine=NULL,authority_generation=NULL,claim_generation=claim_generation+1,updated_at=clock_timestamp() WHERE stripe_scope=scope AND id=existing.id;UPDATE billing_v2.authority SET inbox_task_id=NULL,generation=generation+1 WHERE stripe_scope=scope AND inbox_task_id=existing.id;END IF;
   PERFORM billing_v2.append_audit(scope,'recovery',existing.id::text||':conflict:'||hash,jsonb_build_object('version',1,'stage','conflict','task',existing.id,'digest',hash));
  END IF;
 END LOOP;
 RETURN jsonb_build_object('kind',CASE WHEN conflict THEN 'evidence_conflict' WHEN new_count=0 THEN 'duplicate' ELSE 'admitted' END,'task_ids',ids);
END;
$v2$;
CREATE FUNCTION billing_v2.claim(scope text, task_kind text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $v2$
#variable_conflict use_column
DECLARE t billing_v2.event_inbox;result jsonb;f jsonb;operation uuid;
BEGIN
 IF task_kind NOT IN ('access','finance') OR scope!~'^acct_[A-Za-z0-9]+:test$' THEN RAISE EXCEPTION 'V2_INVALID_SCOPE'; END IF;
 SELECT last_completed_operation_id INTO operation FROM billing_v2.authority WHERE stripe_scope=scope AND domain='migration' AND resource_key='shadow_dataset';
 IF operation IS NULL OR NOT EXISTS(SELECT 1 FROM billing_v2.operations WHERE stripe_scope=scope AND id=operation AND operation_kind='backfill' AND status='completed') THEN RETURN '{"kind":"blocked_seed"}'::jsonb;END IF;
 FOR t IN SELECT * FROM billing_v2.event_inbox WHERE stripe_scope=scope AND event_inbox.task_kind=claim.task_kind AND state='dependency_wait' AND available_at<=clock_timestamp() ORDER BY available_at,arrival_sequence FOR UPDATE SKIP LOCKED LIMIT 10 LOOP PERFORM billing_v2.wake_dependencies(scope,claim.task_kind,t.dependency_kind,t.dependency_reference,1);END LOOP;
 FOR t IN SELECT * FROM billing_v2.event_inbox WHERE stripe_scope=scope AND event_inbox.task_kind=claim.task_kind AND ((state IN ('queued','retry_wait') AND available_at<=clock_timestamp()) OR (state='processing' AND lease_until<=clock_timestamp())) ORDER BY available_at,arrival_sequence FOR UPDATE SKIP LOCKED LIMIT 100 LOOP
  IF EXISTS(SELECT 1 FROM billing_v2.authority a JOIN billing_v2.event_inbox w ON w.stripe_scope=a.stripe_scope AND w.id=a.inbox_task_id WHERE a.stripe_scope=scope AND a.domain=claim.task_kind AND a.resource_key=t.billing_account_id::text AND w.id<>t.id AND w.lease_until>clock_timestamp()) THEN CONTINUE;END IF;
  UPDATE billing_v2.event_inbox SET state='processing',lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '90 seconds',claim_generation=claim_generation+1,claim_count=claim_count+1,first_failure_at=CASE WHEN state='processing' THEN coalesce(first_failure_at,processing_started_at) ELSE first_failure_at END,retry_deadline=CASE WHEN state='processing' THEN coalesce(retry_deadline,processing_started_at+interval '24 hours') ELSE retry_deadline END,processing_started_at=clock_timestamp(),writer_engine='shadow',updated_at=clock_timestamp() WHERE stripe_scope=scope AND id=t.id RETURNING * INTO t;
  IF t.billing_account_id IS NULL THEN result:=jsonb_build_object('kind','acquired','generation',NULL);ELSE result:=billing_v2.acquire_authority(scope,task_kind,t.billing_account_id,'task',t.id,t.lease_token,t.claim_generation);IF result->>'kind'<>'acquired' THEN RAISE EXCEPTION 'V2_CLAIM_RACE';END IF;END IF;
  SELECT * INTO t FROM billing_v2.event_inbox WHERE stripe_scope=scope AND id=t.id;
  f:=jsonb_build_object('scope',scope,'task_id',t.id,'account_id',t.billing_account_id,'token',t.lease_token,'claim_generation',t.claim_generation::text,'authority_generation',result->>'generation','engine','shadow');
  IF t.retry_deadline<=clock_timestamp() THEN PERFORM billing_v2.mark_attention(f,'retry_exhausted');CONTINUE;END IF;
  PERFORM billing_v2.append_audit(scope,CASE WHEN task_kind='access' THEN 'subscription_sync' ELSE 'finance_projection' END,t.id::text||':claim:'||t.claim_generation::text,jsonb_build_object('version',1,'stage','claimed','task',t.id,'generation',t.claim_generation::text));
  RETURN jsonb_build_object('kind','claimed','phase',CASE WHEN EXISTS(SELECT 1 FROM billing_v2.accounts WHERE stripe_scope=scope AND id=t.billing_account_id AND binding_state='verified') THEN 'consume' ELSE 'resolve' END,'task',to_jsonb(t),'fence',f);
 END LOOP;
 RETURN '{"kind":"idle"}'::jsonb;
EXCEPTION WHEN raise_exception THEN IF SQLERRM='V2_CLAIM_RACE' THEN RETURN '{"kind":"contended"}'::jsonb;END IF;RAISE;
END;
$v2$;
CREATE FUNCTION billing_v2.reclaim_expired(scope text, task_kind text) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $v2$
SELECT billing_v2.claim(scope,task_kind);
$v2$;
CREATE FUNCTION billing_v2.touch(fence jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $v2$
#variable_conflict use_column
BEGIN
 PERFORM billing_v2.assert_fence(fence);UPDATE billing_v2.event_inbox SET lease_until=clock_timestamp()+interval '90 seconds',updated_at=clock_timestamp() WHERE stripe_scope=fence->>'scope' AND id=(fence->>'task_id')::uuid;RETURN '{"kind":"renewed"}'::jsonb;
END;
$v2$;
CREATE FUNCTION billing_v2.read_result(scope text,task_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $v2$
SELECT jsonb_build_object('kind',CASE WHEN t.state='completed' THEN 'already_completed' ELSE t.state END,'state',t.state,'result',t.result,'category',t.failure_category,'revision',t.projection_revision::text,'digest',t.projection_digest,
 'context',jsonb_build_object('binding',(SELECT jsonb_build_object('scope',a.stripe_scope,'accountId',a.id,'principalId',a.principal_id,'customer',a.stripe_customer_id,'verified',a.binding_state='verified','revision',a.binding_revision::text) FROM billing_v2.accounts a WHERE a.stripe_scope=t.stripe_scope AND a.id=t.billing_account_id),
 'canonical',(SELECT to_jsonb(s)||jsonb_build_object('revision',s.revision::text,'last_event_created',s.last_event_created::text) FROM billing_v2.subscriptions s WHERE s.stripe_scope=t.stripe_scope AND s.billing_account_id=t.billing_account_id AND s.stripe_subscription_id=t.evidence->>'subscription'),
 'catalog',coalesce((SELECT jsonb_agg(jsonb_build_object('scope',p.stripe_scope,'id',p.stripe_price_id,'revision',p.revision::text,'entitlementEnabled',p.entitlement_enabled,'checkoutEnabled',p.checkout_enabled,'active',p.application_active AND p.ownership_state='active','application',p.application_key,'interval',p.billing_interval) ORDER BY p.stripe_price_id) FROM (SELECT * FROM billing_v2.price_catalog WHERE stripe_scope=t.stripe_scope ORDER BY stripe_price_id LIMIT 100)p),'[]'::jsonb)))
FROM billing_v2.event_inbox t WHERE t.stripe_scope=scope AND t.id=task_id;
$v2$;
CREATE FUNCTION billing_v2.defer_task(fence jsonb, target_state text, category text, dependency jsonb, retry_after_seconds integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $v2$
#variable_conflict use_column
DECLARE t billing_v2.event_inbox;delay integer;failures integer;next_state text;run uuid;
BEGIN
 SELECT * INTO t FROM billing_v2.event_inbox WHERE stripe_scope=fence->>'scope' AND id=(fence->>'task_id')::uuid FOR UPDATE;
 IF t.state='completed' THEN RETURN billing_v2.read_result(t.stripe_scope,t.id); END IF;
 PERFORM billing_v2.assert_fence(fence);
 IF target_state NOT IN ('retry_wait','dependency_wait','needs_attention') THEN RAISE EXCEPTION 'V2_INVALID_STATE';END IF;
 failures:=t.failure_count+CASE WHEN dependency IS NULL AND category<>'handover_blocked' AND target_state='retry_wait' THEN 1 ELSE 0 END;next_state:=target_state;
 IF failures>=12 OR coalesce(t.retry_deadline,clock_timestamp()+interval '24 hours')<=clock_timestamp() THEN next_state:='needs_attention';category:='retry_exhausted';END IF;
 delay:=CASE WHEN target_state='dependency_wait' THEN 300 WHEN category='handover_blocked' THEN 1 ELSE (ARRAY[5,15,30,60,120,300,600,900,1800,3600,3600])[least(greatest(failures,1),11)] END;
 delay:=greatest(delay,coalesce(retry_after_seconds,0));delay:=ceil(delay*(0.8+random()*0.4));
 UPDATE billing_v2.event_inbox SET state=next_state,failure_category=category,failure_count=failures,first_failure_at=CASE WHEN failures>0 THEN coalesce(first_failure_at,clock_timestamp()) ELSE first_failure_at END,retry_deadline=coalesce(retry_deadline,clock_timestamp()+interval '24 hours'),available_at=least(clock_timestamp()+make_interval(secs=>delay),coalesce(retry_deadline,clock_timestamp()+interval '24 hours')),dependency_kind=dependency->>'kind',dependency_reference=dependency->>'reference',lease_token=NULL,lease_until=NULL,writer_engine=NULL,authority_generation=NULL,updated_at=clock_timestamp() WHERE stripe_scope=t.stripe_scope AND id=t.id;
 run:=billing_v2.append_audit(t.stripe_scope,'recovery',t.id::text||':defer:'||t.claim_generation::text,jsonb_build_object('version',1,'stage',next_state,'task',t.id,'reason',category));
 UPDATE billing_v2.authority SET inbox_task_id=NULL,last_completed_operation_id=run,updated_at=clock_timestamp() WHERE stripe_scope=t.stripe_scope AND domain=t.task_kind AND inbox_task_id=t.id AND generation=t.authority_generation;
 RETURN jsonb_build_object('kind',next_state);
END;
$v2$;
CREATE FUNCTION billing_v2.wait_retry(fence jsonb,category text,retry_after_seconds integer) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $v2$
SELECT billing_v2.defer_task(fence,'retry_wait',category,NULL,retry_after_seconds);
$v2$;
CREATE FUNCTION billing_v2.wait_dependency(fence jsonb,dependency jsonb,expected_revision bigint) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $v2$
SELECT billing_v2.defer_task(fence,'dependency_wait','dependency_unresolved',dependency,NULL);
$v2$;
CREATE FUNCTION billing_v2.mark_attention(fence jsonb,category text) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $v2$
SELECT billing_v2.defer_task(fence,'needs_attention',category,NULL,NULL);
$v2$;
CREATE FUNCTION billing_v2.release(fence jsonb,reason text) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $v2$
SELECT billing_v2.defer_task(fence,'retry_wait','handover_blocked',NULL,1);
$v2$;
CREATE FUNCTION billing_v2.finish_task(fence jsonb,result text,revision bigint,digest text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $v2$
#variable_conflict use_column
DECLARE t billing_v2.event_inbox;operation uuid;
BEGIN
 PERFORM billing_v2.assert_fence(fence);SELECT * INTO t FROM billing_v2.event_inbox WHERE stripe_scope=fence->>'scope' AND id=(fence->>'task_id')::uuid;
 operation:=billing_v2.append_audit(t.stripe_scope,CASE WHEN t.task_kind='access' THEN 'subscription_sync' ELSE 'finance_projection' END,t.id::text||':completed',jsonb_build_object('version',1,'stage',result,'task',t.id,'digest',digest));
 UPDATE billing_v2.event_inbox SET state='completed',result=finish_task.result,projection_revision=revision,projection_digest=digest,completed_at=clock_timestamp(),updated_at=clock_timestamp(),failure_category=NULL,dependency_kind=NULL,dependency_reference=NULL,lease_token=NULL,lease_until=NULL,writer_engine=NULL,authority_generation=NULL WHERE stripe_scope=t.stripe_scope AND id=t.id;
 UPDATE billing_v2.authority SET inbox_task_id=NULL,last_completed_operation_id=operation,updated_at=clock_timestamp() WHERE stripe_scope=t.stripe_scope AND domain=t.task_kind AND inbox_task_id=t.id AND generation=t.authority_generation;
 RETURN jsonb_build_object('kind',CASE WHEN result='processed' THEN 'committed' ELSE result END,'revision',revision::text,'digest',digest);
END;
$v2$;
CREATE FUNCTION billing_v2.complete_subscription(fence jsonb,expected_revision bigint,decision jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $v2$
#variable_conflict use_column
DECLARE t billing_v2.event_inbox;old billing_v2.subscriptions;candidate billing_v2.subscriptions;account billing_v2.accounts;price billing_v2.price_catalog;result text;rev bigint;changed boolean;
BEGIN
 SELECT * INTO t FROM billing_v2.event_inbox WHERE stripe_scope=fence->>'scope' AND id=(fence->>'task_id')::uuid FOR UPDATE;
 IF t.state='completed' THEN RETURN billing_v2.read_result(t.stripe_scope,t.id);END IF;
 PERFORM billing_v2.assert_fence(fence);IF t.task_kind<>'access' OR t.evidence->'namespace_verified' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'V2_TASK_KIND';END IF;
 SELECT * INTO account FROM billing_v2.accounts WHERE stripe_scope=t.stripe_scope AND id=t.billing_account_id FOR UPDATE;
 IF account.id IS NULL OR account.binding_state IS DISTINCT FROM 'verified' OR account.binding_revision::text IS DISTINCT FROM decision->>'bindingRevision' THEN RAISE EXCEPTION 'V2_BINDING_CHANGED';END IF;
 candidate:=jsonb_populate_record(NULL::billing_v2.subscriptions,decision->'canonical');
 IF candidate.stripe_scope IS DISTINCT FROM t.stripe_scope OR candidate.billing_account_id IS DISTINCT FROM account.id OR candidate.stripe_customer_id IS DISTINCT FROM account.stripe_customer_id OR candidate.stripe_subscription_id IS DISTINCT FROM t.evidence->>'subscription' THEN RAISE EXCEPTION 'V2_OWNERSHIP';END IF;
 SELECT * INTO old FROM billing_v2.subscriptions WHERE stripe_scope=t.stripe_scope AND stripe_subscription_id=candidate.stripe_subscription_id FOR UPDATE;
 IF coalesce(old.revision,0)<>expected_revision THEN RETURN '{"kind":"revision_conflict"}'::jsonb;END IF;
 result:='processed';
 IF t.event_created<old.last_event_created THEN result:='stale_ignored';
 ELSIF old.terminal AND NOT candidate.terminal THEN result:='terminal_ignored';
 ELSE
  IF candidate.status IN ('active','trialing') THEN
   SELECT * INTO price FROM billing_v2.price_catalog WHERE stripe_scope=t.stripe_scope AND stripe_price_id=candidate.stripe_price_id FOR SHARE;
   IF NOT FOUND OR NOT price.entitlement_enabled OR price.revision::text IS DISTINCT FROM decision->>'priceRevision' THEN RETURN '{"kind":"catalog_changed"}'::jsonb;END IF;
   IF candidate.plan<>'pro' THEN RAISE EXCEPTION 'V2_POLICY_MISMATCH';END IF;
  ELSIF candidate.plan<>'free' THEN RAISE EXCEPTION 'V2_POLICY_MISMATCH';END IF;
  IF candidate.terminal IS DISTINCT FROM (candidate.status='canceled') THEN RAISE EXCEPTION 'V2_TERMINAL_POLICY';END IF;
  changed:=old.stripe_subscription_id IS NULL OR (to_jsonb(old)-ARRAY['revision','verified_at','created_at','updated_at','last_event_created','last_event_id','snapshot_digest']) IS DISTINCT FROM (to_jsonb(candidate)-ARRAY['revision','verified_at','created_at','updated_at','last_event_created','last_event_id','snapshot_digest']);
  rev:=coalesce(old.revision,0)+CASE WHEN changed THEN 1 ELSE 0 END;
  candidate.revision:=rev;candidate.last_event_created:=greatest(t.event_created,old.last_event_created);candidate.last_event_id:=coalesce(t.stripe_event_id,old.last_event_id);candidate.created_at:=coalesce(old.created_at,clock_timestamp());candidate.updated_at:=clock_timestamp();
  INSERT INTO billing_v2.subscriptions SELECT candidate.* ON CONFLICT(stripe_scope,stripe_subscription_id) DO UPDATE SET stripe_price_id=excluded.stripe_price_id,status=excluded.status,plan=excluded.plan,cancel_at_period_end=excluded.cancel_at_period_end,period_start=excluded.period_start,period_end=excluded.period_end,trial_end=excluded.trial_end,ended_at=excluded.ended_at,latest_invoice_id=excluded.latest_invoice_id,terminal=excluded.terminal,revision=excluded.revision,verified_at=excluded.verified_at,last_event_created=excluded.last_event_created,last_event_id=excluded.last_event_id,snapshot_digest=excluded.snapshot_digest,updated_at=excluded.updated_at;
  IF NOT changed THEN result:='unchanged';END IF;
 END IF;
 IF result IN ('stale_ignored','terminal_ignored') THEN rev:=old.revision;candidate:=old;END IF;
 RETURN billing_v2.finish_task(fence,result,rev,candidate.snapshot_digest);
END;
$v2$;
CREATE FUNCTION billing_v2.apply_rows(rows jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $v2$
#variable_conflict use_column
DECLARE e jsonb;tbl text;cols text;pk text;updates text;key_sql text;payload jsonb;old jsonb;merged jsonb;revision bigint;key text;n integer:=0;allowed text[];
BEGIN
 IF jsonb_typeof(rows)<>'array' OR jsonb_array_length(rows)>500 THEN RAISE EXCEPTION 'V2_BUNDLE_BOUND';END IF;
 FOR e IN SELECT value FROM jsonb_array_elements(rows) LOOP
  tbl:=e->>'table';IF tbl NOT IN ('finance_subscriptions','finance_subscription_items','invoices','payments','invoice_payments','refunds','payment_attempts','finance_activity') THEN RAISE EXCEPTION 'V2_TABLE_DENIED';END IF;
  payload:=e->'columns';IF jsonb_typeof(payload)<>'object' THEN RAISE EXCEPTION 'V2_ROW_SHAPE';END IF;
  SELECT array_agg(attname ORDER BY attnum) INTO allowed FROM pg_attribute WHERE attrelid=('billing_v2.'||tbl)::regclass AND attnum>0 AND NOT attisdropped;
  IF payload-allowed<>'{}'::jsonb THEN RAISE EXCEPTION 'V2_ROW_FIELDS';END IF;
  key:=CASE WHEN tbl='payment_attempts' THEN 'attempt_key' WHEN tbl='finance_activity' THEN 'activity_key' ELSE 'stripe_object_id' END;
  key_sql:=format('stripe_scope=$1->>''stripe_scope'' AND %I=$1->>%L',key,key);
  EXECUTE format('SELECT to_jsonb(t) FROM billing_v2.%I t WHERE %s FOR UPDATE',tbl,key_sql) INTO old USING payload;
  IF coalesce((old->>'revision')::bigint,0)<>coalesce((e->>'expectedRevision')::bigint,0) AND tbl<>'finance_activity' THEN RAISE EXCEPTION 'V2_FINANCE_REVISION';END IF;
  IF old IS NOT NULL AND payload->>'source_event_created_at' IS NOT NULL AND (payload->>'source_event_created_at')::timestamptz<(old->>'source_event_created_at')::timestamptz THEN CONTINUE;END IF;
  IF old IS NOT NULL AND ((payload ? 'stripe_customer_id' AND old->>'stripe_customer_id' IS DISTINCT FROM payload->>'stripe_customer_id') OR (payload ? 'stripe_invoice_id' AND old->>'stripe_invoice_id' IS DISTINCT FROM payload->>'stripe_invoice_id') OR (payload ? 'stripe_subscription_id' AND old->>'stripe_subscription_id' IS DISTINCT FROM payload->>'stripe_subscription_id') OR (payload ? 'stripe_charge_id' AND old->>'stripe_charge_id' IS DISTINCT FROM payload->>'stripe_charge_id') OR (payload ? 'stripe_payment_intent_id' AND old->>'stripe_payment_intent_id' IS DISTINCT FROM payload->>'stripe_payment_intent_id')) THEN RAISE EXCEPTION 'V2_RELATIONSHIP_CONFLICT';END IF;
  IF old IS NOT NULL AND tbl='finance_activity' THEN IF old-ARRAY['created_at','updated_at'] IS DISTINCT FROM payload-ARRAY['created_at','updated_at'] THEN RAISE EXCEPTION 'V2_ACTIVITY_CONFLICT';END IF;CONTINUE;END IF;
  IF old->>'collected_at' IS NOT NULL THEN payload:=payload||jsonb_build_object('collected_at',old->'collected_at','collection_time_basis',old->'collection_time_basis');END IF;
  IF old->>'succeeded_at' IS NOT NULL THEN payload:=payload||jsonb_build_object('succeeded_at',old->'succeeded_at','success_time_basis',old->'success_time_basis');END IF;
  revision:=coalesce((old->>'revision')::bigint,0)+1;
  payload:=payload||jsonb_build_object('created_at',coalesce(old->>'created_at',clock_timestamp()::text),'updated_at',clock_timestamp()::text);
  IF tbl<>'finance_activity' THEN payload:=payload||jsonb_build_object('revision',revision::text);END IF;
  SELECT string_agg(format('%I',c),','),string_agg(format('%I=excluded.%I',c,c),',') FILTER(WHERE c NOT IN ('stripe_scope','stripe_object_id','attempt_key','activity_key','created_at')) INTO cols,updates FROM unnest(allowed)c;
  pk:='stripe_scope,'||quote_ident(key);
  EXECUTE format('INSERT INTO billing_v2.%I(%s) SELECT %s FROM jsonb_populate_record(NULL::billing_v2.%I,$1) ON CONFLICT(%s) DO UPDATE SET %s',tbl,cols,cols,tbl,pk,updates) USING payload;
  n:=n+1;
 END LOOP;
 RETURN n;
END;
$v2$;
CREATE FUNCTION billing_v2.complete_finance(fence jsonb,expected_revisions jsonb,bundle jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $v2$
#variable_conflict use_column
DECLARE t billing_v2.event_inbox;a billing_v2.accounts;e jsonb;p jsonb;r jsonb;inv billing_v2.invoices;payment billing_v2.payments;cert jsonb;rows_written integer;hash text;
BEGIN
 SELECT * INTO t FROM billing_v2.event_inbox WHERE stripe_scope=fence->>'scope' AND id=(fence->>'task_id')::uuid FOR UPDATE;
 IF t.state='completed' THEN RETURN billing_v2.read_result(t.stripe_scope,t.id);END IF;
 PERFORM billing_v2.assert_fence(fence);IF t.task_kind<>'finance' THEN RAISE EXCEPTION 'V2_TASK_KIND';END IF;
 SELECT * INTO a FROM billing_v2.accounts WHERE stripe_scope=t.stripe_scope AND id=t.billing_account_id FOR SHARE;IF a.id IS NULL THEN RAISE EXCEPTION 'V2_OWNERSHIP';END IF;
 IF jsonb_typeof(bundle->'rows')<>'array' OR jsonb_typeof(bundle->'proofs')<>'array' OR jsonb_array_length(bundle->'proofs')>100 THEN RAISE EXCEPTION 'V2_BUNDLE_SHAPE';END IF;
 FOR e IN SELECT value FROM jsonb_array_elements(bundle->'rows') LOOP
  IF e->'columns'->>'stripe_scope' IS DISTINCT FROM t.stripe_scope OR (e->'columns' ? 'stripe_customer_id' AND e->'columns'->>'stripe_customer_id' IS DISTINCT FROM a.stripe_customer_id) THEN RAISE EXCEPTION 'V2_OWNERSHIP';END IF;
  IF e->>'table'='finance_subscriptions' AND e->'columns'->>'linkage_status'='verified' AND (a.binding_state<>'verified' OR e->'columns'->>'user_id' IS DISTINCT FROM a.principal_id::text) THEN RAISE EXCEPTION 'V2_OWNERSHIP';END IF;
  IF e->>'table'='finance_subscription_items' AND NOT EXISTS(SELECT 1 FROM billing_v2.price_catalog WHERE stripe_scope=t.stripe_scope AND stripe_price_id=e->'columns'->>'stripe_price_id' AND application_key='dmi_cards' AND application_active AND ownership_state='active') THEN RAISE EXCEPTION 'V2_PRICE_PROOF';END IF;
 END LOOP;
 -- Proof versions must match the pre-write invoice anchor when it exists.
 FOR p IN SELECT value FROM jsonb_array_elements(bundle->'proofs') LOOP
  SELECT * INTO inv FROM billing_v2.invoices WHERE stripe_scope=t.stripe_scope AND stripe_object_id=p->>'invoice' FOR UPDATE;
  IF inv.stripe_object_id IS NOT NULL AND (inv.revision::text IS DISTINCT FROM p->>'invoiceRevision' OR (NOT EXISTS(SELECT 1 FROM jsonb_array_elements(bundle->'rows')e WHERE e->>'table'='invoices' AND e->'columns'->>'stripe_object_id'=inv.stripe_object_id) AND (inv.ownership_state<>'proven' OR inv.ownership_revision::text IS DISTINCT FROM p->>'certificateRevision'))) THEN RAISE EXCEPTION 'V2_PROOF_STALE';END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(bundle->'rows')e WHERE e->'columns'->>'stripe_object_id'=t.evidence->>'subject' AND e->>'table'=CASE WHEN t.event_type LIKE 'invoice.%' THEN 'invoices' WHEN t.event_type LIKE 'customer.subscription.%' THEN 'finance_subscriptions' WHEN t.event_type LIKE 'refund.%' OR t.event_type LIKE 'charge.refund.%' THEN 'refunds' ELSE 'payments' END) THEN RAISE EXCEPTION 'V2_ROOT_MISSING';END IF;
 IF (t.event_type LIKE 'refund.%' OR t.event_type LIKE 'charge.refund.%') AND EXISTS(SELECT 1 FROM jsonb_array_elements(bundle->'rows')e WHERE e->>'table'='refunds' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(bundle->'rows')p WHERE p->>'table'='payments' AND p->'columns'->>'stripe_object_id'=e->'columns'->>'stripe_charge_id')) THEN RAISE EXCEPTION 'V2_REFUND_GRAPH';END IF;
 rows_written:=billing_v2.apply_rows(bundle->'rows');
 FOR p IN SELECT value FROM jsonb_array_elements(bundle->'proofs') LOOP
  SELECT * INTO inv FROM billing_v2.invoices WHERE stripe_scope=t.stripe_scope AND stripe_object_id=p->>'invoice' FOR UPDATE;
  IF inv.stripe_object_id IS NULL OR inv.stripe_customer_id IS DISTINCT FROM a.stripe_customer_id OR p->>'customer' IS DISTINCT FROM a.stripe_customer_id OR p->>'subscription' IS DISTINCT FROM inv.stripe_subscription_id OR p->'complete' IS DISTINCT FROM 'true'::jsonb OR p->>'application'<>'dmi_cards' OR jsonb_typeof(p->'prices')<>'array' OR jsonb_array_length(p->'prices') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'V2_PROOF_UNRESOLVED';END IF;
  FOR r IN SELECT value FROM jsonb_array_elements(p->'prices') LOOP
   PERFORM 1 FROM billing_v2.price_catalog WHERE stripe_scope=t.stripe_scope AND stripe_price_id=r->>'id' AND revision::text=r->>'revision' AND application_key='dmi_cards' AND application_active AND ownership_state='active' FOR SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION 'V2_PROOF_STALE';END IF;
  END LOOP;
  FOR r IN SELECT value FROM jsonb_array_elements(p->'allocations') LOOP
   PERFORM 1 FROM billing_v2.invoice_payments WHERE stripe_scope=t.stripe_scope AND stripe_invoice_id=inv.stripe_object_id AND stripe_object_id=r->>'id' AND stripe_charge_id IS NOT DISTINCT FROM r->>'charge' AND stripe_payment_intent_id IS NOT DISTINCT FROM r->>'intent';
   IF NOT FOUND THEN RAISE EXCEPTION 'V2_ALLOCATION_PROOF';END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(bundle->'rows')e WHERE e->>'table'='invoices' AND e->'columns'->>'stripe_object_id'=inv.stripe_object_id) THEN
  cert:=jsonb_build_object('version',1,'application_key','dmi_cards','state','proven','invoice_revision',inv.revision::text,'customer_ref',inv.stripe_customer_id,'subscription_ref',inv.stripe_subscription_id,'complete',true,'price_proofs',p->'prices','source_event_id',t.stripe_event_id,'certificate_revision',(inv.ownership_revision+1)::text);
  UPDATE billing_v2.invoices SET ownership_state='proven',ownership_revision=ownership_revision+1,ownership_provenance=cert WHERE stripe_scope=t.stripe_scope AND stripe_object_id=inv.stripe_object_id;
  PERFORM billing_v2.wake_dependencies(t.stripe_scope,'finance','ownership_provenance',inv.stripe_object_id,100);
  FOR r IN SELECT jsonb_build_object('charge',stripe_charge_id) FROM billing_v2.invoice_payments WHERE stripe_scope=t.stripe_scope AND stripe_invoice_id=inv.stripe_object_id AND stripe_charge_id IS NOT NULL ORDER BY stripe_object_id LIMIT 100 LOOP PERFORM billing_v2.wake_dependencies(t.stripe_scope,'finance','payment',r->>'charge',100);END LOOP;
  END IF;
 END LOOP;
 FOR e IN SELECT value FROM jsonb_array_elements(bundle->'rows') LOOP
  IF e->>'table'='invoice_payments' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(bundle->'proofs')p CROSS JOIN LATERAL jsonb_array_elements(p->'allocations')al WHERE p->>'invoice'=e->'columns'->>'stripe_invoice_id' AND al->>'id'=e->'columns'->>'stripe_object_id' AND al->>'charge' IS NOT DISTINCT FROM e->'columns'->>'stripe_charge_id' AND al->>'intent' IS NOT DISTINCT FROM e->'columns'->>'stripe_payment_intent_id') THEN RAISE EXCEPTION 'V2_ALLOCATION_PROOF';END IF;
  IF e->>'table'='finance_subscriptions' AND NOT EXISTS(SELECT 1 FROM billing_v2.finance_subscription_items it JOIN billing_v2.price_catalog pc ON pc.stripe_scope=it.stripe_scope AND pc.stripe_price_id=it.stripe_price_id WHERE it.stripe_scope=t.stripe_scope AND it.stripe_subscription_id=e->'columns'->>'stripe_object_id' AND pc.application_key='dmi_cards' AND pc.application_active AND pc.ownership_state='active') THEN RAISE EXCEPTION 'V2_SUBSCRIPTION_PROOF';END IF;
  IF e->>'table'='finance_activity' AND NOT EXISTS(SELECT 1 FROM billing_v2.finance_subscriptions sub WHERE sub.stripe_scope=t.stripe_scope AND sub.stripe_object_id=e->'columns'->>'stripe_subscription_id' AND sub.stripe_customer_id=a.stripe_customer_id) AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(bundle->'proofs')p WHERE p->>'invoice'=e->'columns'->>'object_id') THEN RAISE EXCEPTION 'V2_ACTIVITY_PROOF';END IF;
  IF e->>'table'='invoices' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(bundle->'proofs')p WHERE p->>'invoice'=e->'columns'->>'stripe_object_id') THEN RAISE EXCEPTION 'V2_INVOICE_PROOF_MISSING';END IF;
  IF e->>'table' IN ('payments','refunds','payment_attempts') THEN
   SELECT * INTO payment FROM billing_v2.payments WHERE stripe_scope=t.stripe_scope AND stripe_object_id=CASE WHEN e->>'table'='payments' THEN e->'columns'->>'stripe_object_id' ELSE e->'columns'->>'stripe_charge_id' END;
   IF payment.stripe_customer_id IS DISTINCT FROM a.stripe_customer_id OR NOT EXISTS(SELECT 1 FROM billing_v2.invoice_payments al JOIN billing_v2.invoices iv ON iv.stripe_scope=al.stripe_scope AND iv.stripe_object_id=al.stripe_invoice_id WHERE al.stripe_scope=t.stripe_scope AND al.stripe_charge_id=payment.stripe_object_id AND al.stripe_payment_intent_id IS NOT DISTINCT FROM payment.stripe_payment_intent_id AND iv.stripe_customer_id=a.stripe_customer_id AND al.currency=payment.currency AND iv.currency=payment.currency AND iv.ownership_state='proven' AND iv.ownership_provenance->>'invoice_revision'=iv.revision::text AND EXISTS(SELECT 1 FROM jsonb_array_elements(bundle->'proofs')p WHERE p->>'invoice'=iv.stripe_object_id)) THEN RAISE EXCEPTION 'V2_CHARGE_PROOF';END IF;
  END IF;
 END LOOP;
 hash:=encode(sha256(convert_to((bundle->'rows')::text,'UTF8')),'hex');
 RETURN billing_v2.finish_task(fence,'processed',NULL,hash);
END;
$v2$;
CREATE FUNCTION billing_v2.bind_customer(fence jsonb,principal_kind text,principal_id uuid,customer_ref text,expected_binding_revision bigint,verification jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $v2$
#variable_conflict use_column
DECLARE a billing_v2.accounts;
BEGIN
 PERFORM billing_v2.assert_fence(fence);
 IF NOT EXISTS(SELECT 1 FROM billing_v2.event_inbox WHERE stripe_scope=fence->>'scope' AND id=(fence->>'task_id')::uuid AND task_kind='access') THEN RAISE EXCEPTION 'V2_BINDING_DOMAIN';END IF;
 IF principal_kind NOT IN ('individual','business') OR verification->>'scope' IS DISTINCT FROM fence->>'scope' OR verification->>'principal' IS DISTINCT FROM principal_id::text OR verification->>'customer' IS DISTINCT FROM customer_ref THEN RAISE EXCEPTION 'V2_OWNERSHIP';END IF;
 SELECT * INTO a FROM billing_v2.accounts WHERE stripe_scope=fence->>'scope' AND id=(fence->>'account_id')::uuid FOR UPDATE;
 IF a.stripe_customer_id IS NOT NULL AND a.stripe_customer_id<>customer_ref THEN RETURN '{"kind":"conflict"}'::jsonb;END IF;
 IF a.binding_revision<>expected_binding_revision OR a.binding_state='verified' AND (a.principal_id<>principal_id OR a.stripe_customer_id<>customer_ref) THEN RETURN '{"kind":"conflict"}'::jsonb;END IF;
 UPDATE billing_v2.accounts SET principal_kind=bind_customer.principal_kind,principal_id=bind_customer.principal_id,stripe_customer_id=customer_ref,binding_state='verified',verified_at=clock_timestamp(),binding_revision=binding_revision+1,updated_at=clock_timestamp() WHERE stripe_scope=a.stripe_scope AND id=a.id;
 PERFORM billing_v2.append_audit(a.stripe_scope,'ownership_change',a.id::text||':binding:'||(a.binding_revision+1)::text,jsonb_build_object('version',1,'stage','bound'));
 RETURN '{"kind":"bound"}'::jsonb;
END;
$v2$;
CREATE FUNCTION billing_v2.handover(scope text,domain text,account_id uuid,expected_generation bigint,from_engine text,to_engine text,checkpoint_digest text) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $v2$
SELECT '{"kind":"blocked_phase2"}'::jsonb;
$v2$;
CREATE FUNCTION billing_v2.prepare_checkout(scope text,account_id uuid,frozen_intent jsonb) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $v2$
SELECT '{"kind":"blocked_phase2"}'::jsonb;
$v2$;
CREATE FUNCTION billing_v2.record_checkout(scope text,attempt_id uuid,fence jsonb,result jsonb) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $v2$
SELECT '{"kind":"blocked_phase2"}'::jsonb;
$v2$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA billing_v2 FROM PUBLIC,anon,authenticated,service_role,billing_v2_executor;
COMMIT;
