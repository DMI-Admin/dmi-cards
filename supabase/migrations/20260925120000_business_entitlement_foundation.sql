-- Commercial approval only. No portal, membership, card, Stripe or seat usage writes.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
CREATE TABLE public.business_workspaces (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 origin_onboarding_id uuid NOT NULL UNIQUE REFERENCES public.business_onboardings(id) ON DELETE RESTRICT,
 client_id uuid UNIQUE REFERENCES public.clients(id) ON DELETE RESTRICT CHECK (client_id IS NULL),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 created_by_clerk_user_id text NOT NULL CHECK (created_by_clerk_user_id ~ '^user_.+' AND length(created_by_clerk_user_id)<=200),
 updated_by_clerk_user_id text NOT NULL CHECK (updated_by_clerk_user_id ~ '^user_.+' AND length(updated_by_clerk_user_id)<=200),
 revision bigint NOT NULL DEFAULT 1 CHECK (revision BETWEEN 1 AND 9007199254740991)
);
CREATE TABLE public.business_entitlements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL UNIQUE REFERENCES public.business_workspaces(id) ON DELETE RESTRICT,
 source text NOT NULL CHECK (source IN ('invoice','trial','complimentary')),
 status text NOT NULL CHECK (status IN ('active','suspended','revoked')),
 seat_limit integer NOT NULL CHECK (seat_limit>0),
 starts_at timestamptz NOT NULL CHECK (isfinite(starts_at)),
 ends_at timestamptz NOT NULL CHECK (isfinite(ends_at) AND ends_at>starts_at),
 contract_reference text CHECK (length(contract_reference)<=2000),
 invoice_reference text CHECK (length(invoice_reference)<=2000),
 billing_frequency text,
 granted_by_clerk_user_id text NOT NULL CHECK (granted_by_clerk_user_id ~ '^user_.+' AND length(granted_by_clerk_user_id)<=200),
 updated_by_clerk_user_id text NOT NULL CHECK (updated_by_clerk_user_id ~ '^user_.+' AND length(updated_by_clerk_user_id)<=200),
 activated_at timestamptz NOT NULL, revoked_at timestamptz,
 created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
 revision bigint NOT NULL CHECK (revision BETWEEN 1 AND 9007199254740991),
 CHECK ((source='invoice' AND invoice_reference IS NOT NULL AND length(btrim(invoice_reference))>0 AND billing_frequency IS NOT NULL AND billing_frequency IN ('annual','quarterly'))
   OR (source IN ('trial','complimentary') AND invoice_reference IS NULL AND billing_frequency IS NULL)),
 CHECK ((status='revoked') = (revoked_at IS NOT NULL))
);
CREATE TABLE public.business_entitlement_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES public.business_workspaces(id) ON DELETE RESTRICT,
 entitlement_id uuid NOT NULL REFERENCES public.business_entitlements(id) ON DELETE RESTRICT,
 onboarding_id uuid NOT NULL REFERENCES public.business_onboardings(id) ON DELETE RESTRICT,
 event_type text NOT NULL CHECK (event_type IN ('activate_invoice','activate_trial','activate_complimentary','amend','suspend','reactivate','revoke')),
 source text NOT NULL CHECK (source IN ('invoice','trial','complimentary')),
 seat_limit integer NOT NULL CHECK (seat_limit>0),
 starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
 status text NOT NULL CHECK (status IN ('active','suspended','revoked')),
 invoice_reference text, contract_reference text, billing_frequency text,
 reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 2000),
 payment_received_date date,
 actor_clerk_user_id text NOT NULL CHECK (actor_clerk_user_id ~ '^user_.+' AND length(actor_clerk_user_id)<=200),
 operation_id uuid NOT NULL UNIQUE,
 request_hash text NOT NULL CHECK (length(request_hash)=64),
 request_payload jsonb NOT NULL,
 before_state jsonb, after_state jsonb NOT NULL, result jsonb NOT NULL,
 before_onboarding_revision bigint NOT NULL, after_onboarding_revision bigint NOT NULL,
 before_entitlement_revision bigint NOT NULL, after_entitlement_revision bigint NOT NULL,
 created_at timestamptz NOT NULL,
 UNIQUE (entitlement_id,after_entitlement_revision),
 CHECK (isfinite(starts_at) AND isfinite(ends_at) AND ends_at>starts_at),
 CHECK ((event_type='activate_invoice') = (payment_received_date IS NOT NULL))
);
CREATE INDEX business_entitlement_events_timeline_idx ON public.business_entitlement_events(workspace_id,after_entitlement_revision DESC);

CREATE FUNCTION public.protect_business_entitlement_event() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $fn$
BEGIN RAISE EXCEPTION 'BUSINESS_AUDIT_IMMUTABLE' USING ERRCODE='42501'; END;
$fn$;
CREATE TRIGGER business_entitlement_events_immutable BEFORE UPDATE OR DELETE ON public.business_entitlement_events
FOR EACH ROW EXECUTE FUNCTION public.protect_business_entitlement_event();

-- Existing proposal updates already lock their onboarding row. Commercial commands
-- take the same lock first, so proposal edits cannot race activation.
CREATE FUNCTION public.protect_activated_business_proposal() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $fn$
BEGIN
 IF ROW(NEW.requested_seats,NEW.access_type,NEW.contract_start,NEW.contract_end,NEW.billing_frequency,NEW.invoice_reference,NEW.po_reference)
  IS DISTINCT FROM ROW(OLD.requested_seats,OLD.access_type,OLD.contract_start,OLD.contract_end,OLD.billing_frequency,OLD.invoice_reference,OLD.po_reference)
  AND EXISTS (SELECT 1 FROM public.business_workspaces w JOIN public.business_entitlements e ON e.workspace_id=w.id WHERE w.origin_onboarding_id=OLD.id) THEN
  RAISE EXCEPTION 'BUSINESS_TERMS_LOCKED_USE_COMMERCIAL_ACTION' USING ERRCODE='P0001';
 END IF;
 RETURN NEW;
END;
$fn$;
CREATE TRIGGER business_onboarding_commercial_guard BEFORE UPDATE ON public.business_onboardings
FOR EACH ROW EXECUTE FUNCTION public.protect_activated_business_proposal();

CREATE FUNCTION public.get_business_entitlement(p_onboarding_id uuid, p_page integer DEFAULT 1) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $fn$
DECLARE w public.business_workspaces%rowtype; e public.business_entitlements%rowtype; effective text; history jsonb; total bigint;
BEGIN
 IF p_page IS NULL OR p_page<1 OR p_page>100000 THEN RAISE EXCEPTION 'BUSINESS_INVALID_PAGE' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.business_onboardings WHERE id=p_onboarding_id) THEN RAISE EXCEPTION 'BUSINESS_NOT_FOUND' USING ERRCODE='P0002'; END IF;
 SELECT * INTO w FROM public.business_workspaces WHERE origin_onboarding_id=p_onboarding_id;
 SELECT * INTO e FROM public.business_entitlements WHERE workspace_id=w.id;
 effective := CASE WHEN e.id IS NULL THEN 'absent' WHEN e.status='revoked' THEN 'revoked' WHEN e.status='suspended' THEN 'suspended'
  WHEN statement_timestamp()<e.starts_at THEN 'scheduled' WHEN statement_timestamp()>=e.ends_at THEN 'expired' ELSE 'active' END;
 SELECT count(*) INTO total FROM public.business_entitlement_events WHERE workspace_id=w.id;
 SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY v.after_entitlement_revision DESC),'[]'::jsonb) INTO history FROM
  (SELECT id,event_type,source,seat_limit,starts_at,ends_at,status,invoice_reference,contract_reference,billing_frequency,reason,payment_received_date,actor_clerk_user_id,created_at,after_entitlement_revision
   FROM public.business_entitlement_events WHERE workspace_id=w.id ORDER BY after_entitlement_revision DESC LIMIT 25 OFFSET (p_page-1)*25) v;
 RETURN jsonb_build_object('workspace',CASE WHEN w.id IS NULL THEN NULL ELSE to_jsonb(w) END,
  'entitlement',CASE WHEN e.id IS NULL THEN NULL ELSE to_jsonb(e) END,'effective_status',effective,
  'effective_seat_allowance',CASE WHEN effective='active' THEN e.seat_limit ELSE 0 END,
  'evaluated_at',statement_timestamp(),'history',history,'history_total',total,'page',p_page,'page_size',25);
END;
$fn$;

CREATE FUNCTION public.admin_command_business_entitlement(p_onboarding_id uuid,p_entitlement_id uuid,p_actor text,p_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $fn$
DECLARE o public.business_onboardings%rowtype; w public.business_workspaces%rowtype; e public.business_entitlements%rowtype;
 ev public.business_entitlement_events%rowtype; action text; op uuid; reason text; command_payload jsonb; result jsonb;
 expected_o bigint; expected_e bigint; before_e jsonb; before_revision bigint; stamp timestamptz; payment_date date; source_value text;
BEGIN
 IF p_actor IS NULL OR p_actor !~ '^user_.+' OR length(p_actor)>200 OR p_command IS NULL OR jsonb_typeof(p_command)<>'object' OR octet_length(p_command::text)>16000 THEN
  RAISE EXCEPTION 'BUSINESS_INVALID_COMMAND' USING ERRCODE='22023'; END IF;
 IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_command) k WHERE k NOT IN ('operation_id','action','expected_onboarding_revision','expected_entitlement_revision','reason','confirmed','payment_received_date','contract_reference','seat_limit','ends_at')) THEN
  RAISE EXCEPTION 'BUSINESS_UNSUPPORTED_FIELD' USING ERRCODE='22023'; END IF;
 action:=p_command->>'action'; reason:=btrim(p_command->>'reason');
 IF action IS NULL OR action NOT IN ('activate_invoice','activate_trial','activate_complimentary','amend','suspend','reactivate','revoke') OR reason IS NULL OR length(reason) NOT BETWEEN 1 AND 2000 OR p_command->'confirmed' IS DISTINCT FROM 'true'::jsonb THEN
  RAISE EXCEPTION 'BUSINESS_CONFIRMATION_REQUIRED' USING ERRCODE='22023'; END IF;
 IF coalesce(p_command->>'expected_onboarding_revision','') !~ '^[1-9][0-9]{0,15}$' OR coalesce(p_command->>'expected_entitlement_revision','') !~ '^(0|[1-9][0-9]{0,15})$' THEN
  RAISE EXCEPTION 'BUSINESS_INVALID_REVISION' USING ERRCODE='22023'; END IF;
 expected_o:=(p_command->>'expected_onboarding_revision')::bigint; expected_e:=(p_command->>'expected_entitlement_revision')::bigint;
 op:=(p_command->>'operation_id')::uuid; IF op IS NULL THEN RAISE EXCEPTION 'BUSINESS_OPERATION_REQUIRED' USING ERRCODE='22023'; END IF;
 IF p_onboarding_id IS NULL THEN
  SELECT bw.origin_onboarding_id INTO p_onboarding_id FROM public.business_entitlements be JOIN public.business_workspaces bw ON bw.id=be.workspace_id WHERE be.id=p_entitlement_id;
 END IF;
 SELECT * INTO o FROM public.business_onboardings WHERE id=p_onboarding_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'BUSINESS_NOT_FOUND' USING ERRCODE='P0002'; END IF;
 command_payload:=jsonb_build_object('onboarding_id',p_onboarding_id,'entitlement_id',p_entitlement_id,'actor',p_actor,'command',p_command);
 -- Replay before revision/state checks; return the durable original receipt.
 SELECT * INTO ev FROM public.business_entitlement_events WHERE operation_id=op;
 IF FOUND THEN
  IF ev.request_payload IS DISTINCT FROM command_payload THEN RAISE EXCEPTION 'BUSINESS_OPERATION_CONFLICT' USING ERRCODE='P0001'; END IF;
  RETURN ev.result;
 END IF;
 IF o.revision<>expected_o THEN RAISE EXCEPTION 'BUSINESS_STALE_ONBOARDING' USING ERRCODE='P0001'; END IF;
 IF o.onboarding_method<>'dmi_managed' OR o.status NOT IN ('draft','awaiting_information','awaiting_payment','ready_to_activate') THEN
  RAISE EXCEPTION 'BUSINESS_INVALID_ONBOARDING_STATE' USING ERRCODE='P0001'; END IF;
 SELECT * INTO w FROM public.business_workspaces WHERE origin_onboarding_id=o.id FOR UPDATE;
 IF w.id IS NULL THEN
  IF action NOT LIKE 'activate_%' OR p_entitlement_id IS NOT NULL THEN RAISE EXCEPTION 'BUSINESS_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  INSERT INTO public.business_workspaces(origin_onboarding_id,created_by_clerk_user_id,updated_by_clerk_user_id)
  VALUES(o.id,p_actor,p_actor) RETURNING * INTO w;
 END IF;
 IF w.client_id IS NOT NULL THEN RAISE EXCEPTION 'BUSINESS_PROVISIONED_WORKSPACE_OUT_OF_SCOPE' USING ERRCODE='P0001'; END IF;
 SELECT * INTO e FROM public.business_entitlements WHERE workspace_id=w.id FOR UPDATE;
 before_e:=CASE WHEN e.id IS NULL THEN NULL ELSE to_jsonb(e) END; before_revision:=coalesce(e.revision,0);
 IF before_revision<>expected_e THEN RAISE EXCEPTION 'BUSINESS_STALE_ENTITLEMENT' USING ERRCODE='P0001'; END IF;
 stamp:=clock_timestamp();
 IF action LIKE 'activate_%' THEN
  source_value:=substr(action,10);
  IF e.id IS NOT NULL OR p_entitlement_id IS NOT NULL THEN RAISE EXCEPTION 'BUSINESS_ALREADY_ACTIVATED' USING ERRCODE='P0001'; END IF;
  IF o.status='awaiting_information' OR o.access_type IS DISTINCT FROM source_value OR o.requested_seats IS NULL OR o.requested_seats<1
   OR o.contract_start IS NULL OR o.contract_end IS NULL OR NOT isfinite(o.contract_start) OR NOT isfinite(o.contract_end) OR o.contract_end<=o.contract_start
   OR (o.contract_end::timestamp AT TIME ZONE 'UTC')<=stamp THEN RAISE EXCEPTION 'BUSINESS_INCOMPLETE_COMMERCIAL_TERMS' USING ERRCODE='22023'; END IF;
  IF p_command ? 'seat_limit' OR p_command ? 'ends_at' THEN RAISE EXCEPTION 'BUSINESS_ACTIVATION_USES_SAVED_PROPOSAL' USING ERRCODE='22023'; END IF;
  IF source_value='invoice' THEN
   IF nullif(btrim(o.invoice_reference),'') IS NULL OR o.billing_frequency IS NULL OR o.billing_frequency NOT IN ('annual','quarterly')
    OR coalesce(p_command->>'payment_received_date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'BUSINESS_PAYMENT_ATTESTATION_REQUIRED' USING ERRCODE='22023'; END IF;
   payment_date:=(p_command->>'payment_received_date')::date;
   IF payment_date>(stamp AT TIME ZONE 'UTC')::date THEN RAISE EXCEPTION 'BUSINESS_FUTURE_PAYMENT_DATE' USING ERRCODE='22023'; END IF;
  ELSIF p_command ? 'payment_received_date' THEN RAISE EXCEPTION 'BUSINESS_UNEXPECTED_PAYMENT_DATE' USING ERRCODE='22023'; END IF;
  INSERT INTO public.business_entitlements(workspace_id,source,status,seat_limit,starts_at,ends_at,contract_reference,invoice_reference,billing_frequency,granted_by_clerk_user_id,updated_by_clerk_user_id,activated_at,created_at,updated_at,revision)
  VALUES(w.id,source_value,'active',o.requested_seats,o.contract_start::timestamp AT TIME ZONE 'UTC',o.contract_end::timestamp AT TIME ZONE 'UTC',nullif(btrim(p_command->>'contract_reference'),''),CASE WHEN source_value='invoice' THEN o.invoice_reference END,CASE WHEN source_value='invoice' THEN o.billing_frequency END,p_actor,p_actor,stamp,stamp,stamp,1) RETURNING * INTO e;
 ELSE
  IF e.id IS NULL OR e.id IS DISTINCT FROM p_entitlement_id THEN RAISE EXCEPTION 'BUSINESS_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF e.status='revoked' THEN RAISE EXCEPTION 'BUSINESS_REVOKED_TERMINAL' USING ERRCODE='P0001'; END IF;
  IF p_command ? 'payment_received_date' THEN RAISE EXCEPTION 'BUSINESS_UNEXPECTED_PAYMENT_DATE' USING ERRCODE='22023'; END IF;
  IF action<>'amend' AND (p_command ? 'seat_limit' OR p_command ? 'ends_at' OR p_command ? 'contract_reference') THEN RAISE EXCEPTION 'BUSINESS_UNSUPPORTED_ACTION_FIELDS' USING ERRCODE='22023'; END IF;
  IF action='amend' THEN
   IF NOT (p_command ? 'seat_limit' OR p_command ? 'ends_at' OR p_command ? 'contract_reference') THEN RAISE EXCEPTION 'BUSINESS_NO_AMENDMENT' USING ERRCODE='22023'; END IF;
   IF p_command ? 'seat_limit' THEN
    IF coalesce(p_command->>'seat_limit','') !~ '^[1-9][0-9]{0,9}$' THEN RAISE EXCEPTION 'BUSINESS_INVALID_SEATS' USING ERRCODE='22023'; END IF;
    e.seat_limit:=(p_command->>'seat_limit')::integer;
   END IF;
   IF p_command ? 'ends_at' THEN
    IF coalesce(p_command->>'ends_at','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$' THEN RAISE EXCEPTION 'BUSINESS_UTC_EXPIRY_REQUIRED' USING ERRCODE='22023'; END IF;
    e.ends_at:=(p_command->>'ends_at')::timestamptz;
    IF e.ends_at<=stamp THEN RAISE EXCEPTION 'BUSINESS_EXPIRY_MUST_BE_FUTURE' USING ERRCODE='22023'; END IF;
   END IF;
   IF p_command ? 'contract_reference' THEN e.contract_reference:=nullif(btrim(p_command->>'contract_reference'),''); END IF;
  ELSIF action='suspend' THEN
   IF e.status<>'active' THEN RAISE EXCEPTION 'BUSINESS_INVALID_TRANSITION' USING ERRCODE='P0001'; END IF; e.status:='suspended';
  ELSIF action='reactivate' THEN
   IF e.status<>'suspended' OR stamp>=e.ends_at THEN RAISE EXCEPTION 'BUSINESS_INVALID_TRANSITION' USING ERRCODE='P0001'; END IF; e.status:='active';
  ELSIF action='revoke' THEN e.status:='revoked';e.revoked_at:=stamp;
  END IF;
  UPDATE public.business_entitlements SET status=e.status,seat_limit=e.seat_limit,ends_at=e.ends_at,contract_reference=e.contract_reference,revoked_at=e.revoked_at,
   revision=revision+1,updated_at=stamp,updated_by_clerk_user_id=p_actor WHERE id=e.id RETURNING * INTO e;
 END IF;
 UPDATE public.business_workspaces SET revision=revision+1,updated_at=stamp,updated_by_clerk_user_id=p_actor WHERE id=w.id RETURNING * INTO w;
 UPDATE public.business_onboardings SET status=CASE WHEN action LIKE 'activate_%' THEN 'ready_to_activate' ELSE status END,
  revision=revision+1,updated_at=stamp,updated_by_clerk_user_id=p_actor WHERE id=o.id;
 result:=jsonb_build_object('workspace_id',w.id,'entitlement_id',e.id,'onboarding_id',o.id,'onboarding_revision',o.revision+1,'entitlement_revision',e.revision,'operation_id',op);
 INSERT INTO public.business_entitlement_events(workspace_id,entitlement_id,onboarding_id,event_type,source,seat_limit,starts_at,ends_at,status,invoice_reference,contract_reference,billing_frequency,reason,payment_received_date,actor_clerk_user_id,operation_id,request_hash,request_payload,before_state,after_state,result,before_onboarding_revision,after_onboarding_revision,before_entitlement_revision,after_entitlement_revision,created_at)
 VALUES(w.id,e.id,o.id,action,e.source,e.seat_limit,e.starts_at,e.ends_at,e.status,e.invoice_reference,e.contract_reference,e.billing_frequency,reason,payment_date,p_actor,op,encode(sha256(convert_to(command_payload::text,'UTF8')),'hex'),command_payload,before_e,to_jsonb(e),result,o.revision,o.revision+1,before_revision,e.revision,stamp);
 RETURN result;
END;
$fn$;

ALTER TABLE public.business_workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_entitlement_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.business_workspaces,public.business_entitlements,public.business_entitlement_events FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.business_workspaces,public.business_entitlements,public.business_entitlement_events TO service_role;
REVOKE ALL ON FUNCTION public.protect_business_entitlement_event(),public.protect_activated_business_proposal(),public.get_business_entitlement(uuid,integer),public.admin_command_business_entitlement(uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_business_entitlement(uuid,integer),public.admin_command_business_entitlement(uuid,uuid,text,jsonb) TO service_role;
DO $security$
DECLARE obj regclass; role_row record; privilege_name text; func regprocedure;
BEGIN
 FOREACH obj IN ARRAY ARRAY['public.business_workspaces'::regclass,'public.business_entitlements'::regclass,'public.business_entitlement_events'::regclass] LOOP
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid=obj) OR EXISTS(SELECT 1 FROM pg_policy WHERE polrelid=obj) THEN RAISE EXCEPTION 'BUSINESS_UNSAFE_RLS'; END IF;
  FOR role_row IN SELECT r.* FROM pg_roles r WHERE r.rolname IN ('anon','authenticated') OR pg_has_role('anon',r.oid,'MEMBER') OR pg_has_role('authenticated',r.oid,'MEMBER') LOOP
   IF role_row.rolsuper OR role_row.rolbypassrls OR role_row.oid=(SELECT relowner FROM pg_class WHERE oid=obj) THEN RAISE EXCEPTION 'BUSINESS_UNSAFE_ROLE'; END IF;
   FOREACH privilege_name IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] LOOP
    IF has_table_privilege(role_row.oid,obj,privilege_name) THEN RAISE EXCEPTION 'BUSINESS_BROWSER_TABLE_ACCESS'; END IF;
   END LOOP;
   FOREACH privilege_name IN ARRAY ARRAY['SELECT','INSERT','UPDATE','REFERENCES'] LOOP
    IF has_any_column_privilege(role_row.oid,obj,privilege_name) THEN RAISE EXCEPTION 'BUSINESS_BROWSER_COLUMN_ACCESS'; END IF;
   END LOOP;
  END LOOP;
  IF NOT has_table_privilege('service_role',obj,'SELECT') THEN RAISE EXCEPTION 'BUSINESS_MISSING_SERVICE_READ'; END IF;
  FOREACH privilege_name IN ARRAY ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] LOOP
   IF has_table_privilege('service_role',obj,privilege_name) THEN RAISE EXCEPTION 'BUSINESS_DIRECT_SERVICE_WRITE'; END IF;
  END LOOP;
 END LOOP;
 FOREACH func IN ARRAY ARRAY['public.get_business_entitlement(uuid,integer)'::regprocedure,'public.admin_command_business_entitlement(uuid,uuid,text,jsonb)'::regprocedure,'public.protect_business_entitlement_event()'::regprocedure,'public.protect_activated_business_proposal()'::regprocedure] LOOP
  FOR role_row IN SELECT r.* FROM pg_roles r WHERE r.rolname IN ('anon','authenticated') OR pg_has_role('anon',r.oid,'MEMBER') OR pg_has_role('authenticated',r.oid,'MEMBER') LOOP
   IF has_function_privilege(role_row.oid,func,'EXECUTE') THEN RAISE EXCEPTION 'BUSINESS_BROWSER_RPC_ACCESS'; END IF;
  END LOOP;
 END LOOP;
END;
$security$;
COMMIT;
