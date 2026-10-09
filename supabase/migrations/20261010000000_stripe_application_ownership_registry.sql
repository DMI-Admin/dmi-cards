-- Inactive ownership authority only. No resource seeds, receipt changes or runtime activation.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DO $owner$
BEGIN
 IF current_user IN ('anon','authenticated','service_role') THEN RAISE EXCEPTION 'OWNERSHIP_MIGRATION_OWNER'; END IF;
END $owner$;
CREATE TABLE public.billing_stripe_applications (
 application_key text PRIMARY KEY CHECK (application_key ~ '^[a-z][a-z0-9_]{2,63}$'),
 state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','revoked')),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
-- Canonical application identity, independent of environment or Stripe account.
INSERT INTO public.billing_stripe_applications(application_key) VALUES ('dmi_cards');
CREATE TABLE public.billing_stripe_resource_ownership (
 stripe_scope text NOT NULL CHECK (stripe_scope ~ '^acct_[A-Za-z0-9]{1,240}:(test|live)$'),
 resource_type text NOT NULL CHECK (resource_type IN ('price','customer')),
 stripe_resource_id text NOT NULL,
 application_key text NOT NULL REFERENCES public.billing_stripe_applications(application_key) ON DELETE RESTRICT,
 ownership_basis text NOT NULL,
 provenance text NOT NULL CHECK (provenance IN ('operator_review','reviewed_dmi_price')),
 review_reference text NOT NULL CHECK (review_reference ~ '^review_[A-Za-z0-9_-]{1,80}$'),
 revision bigint NOT NULL DEFAULT 1 CHECK (revision BETWEEN 1 AND 9007199254740991),
 state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','revoked')),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (stripe_scope,resource_type,stripe_resource_id),
 CHECK ((resource_type='price' AND stripe_resource_id ~ '^price_[A-Za-z0-9]{1,240}$' AND ownership_basis='price_owner')
 OR (resource_type='customer' AND stripe_resource_id ~ '^cus_[A-Za-z0-9]{1,240}$' AND ownership_basis='exclusive_customer')),
 CHECK (provenance<>'reviewed_dmi_price' OR (resource_type='price' AND application_key='dmi_cards'))
);
CREATE TABLE public.billing_stripe_ownership_audit (
 stripe_scope text NOT NULL, resource_type text NOT NULL, stripe_resource_id text NOT NULL,
 revision bigint NOT NULL, action text NOT NULL CHECK (action IN ('register','revoke')),
 application_key text NOT NULL, provenance text NOT NULL, review_reference text NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (stripe_scope,resource_type,stripe_resource_id,revision),
 FOREIGN KEY (stripe_scope,resource_type,stripe_resource_id) REFERENCES public.billing_stripe_resource_ownership ON DELETE RESTRICT
);
CREATE FUNCTION public.billing_stripe_ownership_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $guard$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'OWNERSHIP_IMMUTABLE'; END IF;
 IF ROW(NEW.stripe_scope,NEW.resource_type,NEW.stripe_resource_id,NEW.application_key,NEW.ownership_basis,NEW.provenance,NEW.review_reference,NEW.created_at)
 IS DISTINCT FROM ROW(OLD.stripe_scope,OLD.resource_type,OLD.stripe_resource_id,OLD.application_key,OLD.ownership_basis,OLD.provenance,OLD.review_reference,OLD.created_at)
 OR OLD.state<>'active' OR NEW.state<>'revoked' OR NEW.revision<>OLD.revision+1
 THEN RAISE EXCEPTION 'OWNERSHIP_IMMUTABLE'; END IF;
 RETURN NEW;
END $guard$;
CREATE TRIGGER billing_stripe_ownership_guard BEFORE UPDATE OR DELETE ON public.billing_stripe_resource_ownership
FOR EACH ROW EXECUTE FUNCTION public.billing_stripe_ownership_guard();
CREATE FUNCTION public.billing_stripe_ownership_audit_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $guard$
BEGIN RAISE EXCEPTION 'OWNERSHIP_AUDIT_IMMUTABLE'; END $guard$;
CREATE TRIGGER billing_stripe_ownership_audit_guard BEFORE UPDATE OR DELETE ON public.billing_stripe_ownership_audit
FOR EACH ROW EXECUTE FUNCTION public.billing_stripe_ownership_audit_guard();
-- Service-role execution is privileged transport, not proof of human approval.
-- Only an approved operator tool may supply this closed action contract and review reference.
CREATE FUNCTION public.billing_stripe_register_ownership(p_scope text,p_type text,p_id text,p_app text,p_basis text,p_provenance text,p_review text,p_authority text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $rpc$
DECLARE existing public.billing_stripe_resource_ownership%ROWTYPE;
BEGIN
 IF p_authority IS DISTINCT FROM 'reviewed_operator_action' OR p_review IS NULL OR p_review !~ '^review_[A-Za-z0-9_-]{1,80}$'
 THEN RAISE EXCEPTION 'OWNERSHIP_OPERATOR_REQUIRED'; END IF;
 PERFORM 1 FROM public.billing_stripe_applications WHERE application_key=p_app AND state='active' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'OWNERSHIP_APPLICATION_UNAVAILABLE'; END IF;
 INSERT INTO public.billing_stripe_resource_ownership(stripe_scope,resource_type,stripe_resource_id,application_key,ownership_basis,provenance,review_reference)
 VALUES(p_scope,p_type,p_id,p_app,p_basis,p_provenance,p_review) ON CONFLICT DO NOTHING;
 IF FOUND THEN
 INSERT INTO public.billing_stripe_ownership_audit(stripe_scope,resource_type,stripe_resource_id,revision,action,application_key,provenance,review_reference)
 VALUES(p_scope,p_type,p_id,1,'register',p_app,p_provenance,p_review);
 ELSE
 SELECT * INTO existing FROM public.billing_stripe_resource_ownership WHERE stripe_scope=p_scope AND resource_type=p_type AND stripe_resource_id=p_id FOR UPDATE;
 IF existing.state<>'active' OR ROW(existing.application_key,existing.ownership_basis,existing.provenance,existing.review_reference)
 IS DISTINCT FROM ROW(p_app,p_basis,p_provenance,p_review) THEN RAISE EXCEPTION 'OWNERSHIP_CONFLICT'; END IF;
 END IF;
 RETURN jsonb_build_object('revision',1);
END $rpc$;
CREATE FUNCTION public.billing_stripe_revoke_ownership(p_scope text,p_type text,p_id text,p_revision bigint,p_review text,p_authority text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $rpc$
DECLARE existing public.billing_stripe_resource_ownership%ROWTYPE;
BEGIN
 IF p_authority IS DISTINCT FROM 'reviewed_operator_action' OR p_review IS NULL OR p_review !~ '^review_[A-Za-z0-9_-]{1,80}$'
 THEN RAISE EXCEPTION 'OWNERSHIP_OPERATOR_REQUIRED'; END IF;
 SELECT * INTO existing FROM public.billing_stripe_resource_ownership WHERE stripe_scope=p_scope AND resource_type=p_type AND stripe_resource_id=p_id FOR UPDATE;
 IF NOT FOUND OR existing.state<>'active' OR existing.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'OWNERSHIP_STALE'; END IF;
 UPDATE public.billing_stripe_resource_ownership SET state='revoked',revision=revision+1,updated_at=clock_timestamp()
 WHERE stripe_scope=p_scope AND resource_type=p_type AND stripe_resource_id=p_id;
 INSERT INTO public.billing_stripe_ownership_audit(stripe_scope,resource_type,stripe_resource_id,revision,action,application_key,provenance,review_reference)
 VALUES(p_scope,p_type,p_id,existing.revision+1,'revoke',existing.application_key,existing.provenance,p_review);
 RETURN jsonb_build_object('revision',existing.revision+1);
END $rpc$;
ALTER TABLE public.billing_stripe_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_stripe_resource_ownership ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_stripe_ownership_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_stripe_applications,public.billing_stripe_resource_ownership,public.billing_stripe_ownership_audit FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.billing_stripe_applications,public.billing_stripe_resource_ownership,public.billing_stripe_ownership_audit TO service_role;
REVOKE ALL ON FUNCTION public.billing_stripe_register_ownership(text,text,text,text,text,text,text,text),public.billing_stripe_revoke_ownership(text,text,text,bigint,text,text),public.billing_stripe_ownership_guard(),public.billing_stripe_ownership_audit_guard() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.billing_stripe_register_ownership(text,text,text,text,text,text,text,text),public.billing_stripe_revoke_ownership(text,text,text,bigint,text,text) TO service_role;
COMMIT;
