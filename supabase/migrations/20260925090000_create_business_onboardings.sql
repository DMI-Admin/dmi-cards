-- Prospective records only: no operational company, identity or entitlement side effects.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
CREATE TABLE public.business_onboardings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_name text NOT NULL CHECK (length(btrim(company_name)) > 0),
 legal_company_name text, registration_number text, country_code text, website text, address text,
 contact_first_name text, contact_last_name text, contact_email text, contact_phone text,
 requested_seats integer CHECK (requested_seats > 0),
 access_type text CHECK (access_type IN ('invoice','trial','complimentary')),
 contract_start date, contract_end date,
 billing_frequency text CHECK (billing_frequency IN ('annual','quarterly')),
 invoice_reference text, po_reference text,
 status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','awaiting_information','awaiting_payment','ready_to_activate')),
 onboarding_method text NOT NULL DEFAULT 'dmi_managed' CHECK (onboarding_method = 'dmi_managed'),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 created_by_clerk_user_id text NOT NULL CHECK (created_by_clerk_user_id ~ '^user_.+' AND length(created_by_clerk_user_id) <= 200),
 updated_by_clerk_user_id text NOT NULL CHECK (updated_by_clerk_user_id ~ '^user_.+' AND length(updated_by_clerk_user_id) <= 200),
 revision bigint NOT NULL DEFAULT 1 CHECK (revision BETWEEN 1 AND 9007199254740991),
 create_request_id uuid NOT NULL UNIQUE,
 CHECK (billing_frequency IS NULL OR (access_type IS NOT NULL AND access_type = 'invoice')),
 CHECK (contract_end IS NULL OR contract_start IS NULL OR contract_end >= contract_start),
 CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$'),
 CHECK (contact_email IS NULL OR (length(contact_email) <= 254 AND contact_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')),
 CHECK (website IS NULL OR website ~ '^https?://[^[:space:]]+'),
 CHECK (length(company_name) <= 2000 AND length(legal_company_name) <= 2000 AND length(registration_number) <= 2000 AND length(country_code) <= 2000 AND length(website) <= 2000 AND length(address) <= 2000 AND length(contact_first_name) <= 2000 AND length(contact_last_name) <= 2000 AND length(contact_email) <= 2000 AND length(contact_phone) <= 2000 AND length(access_type) <= 2000 AND length(invoice_reference) <= 2000 AND length(po_reference) <= 2000)
);
CREATE INDEX business_onboardings_updated_idx ON public.business_onboardings (updated_at DESC,id DESC);
CREATE INDEX business_onboardings_status_updated_idx ON public.business_onboardings (status,updated_at DESC,id DESC);
ALTER TABLE public.business_onboardings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.business_onboardings FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.business_onboardings TO service_role;
-- No browser policies, no triggers, no cross-table writes.
DO $security$
DECLARE role_name text; privilege_name text; reachable record;
BEGIN
 FOR role_name IN SELECT unnest(ARRAY['anon','authenticated']) LOOP
  -- Inspect inherited AND role-switch reachable roles, not just direct ACLs.
  FOR reachable IN SELECT r.* FROM pg_roles r WHERE r.rolname = role_name OR pg_has_role(role_name,r.oid,'MEMBER') LOOP
   IF reachable.rolsuper OR reachable.rolbypassrls OR reachable.oid = (SELECT relowner FROM pg_class WHERE oid='public.business_onboardings'::regclass) THEN
    RAISE EXCEPTION 'Unsafe browser role path for %', role_name;
   END IF;
   FOREACH privilege_name IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
    IF has_table_privilege(reachable.oid,'public.business_onboardings',privilege_name) THEN RAISE EXCEPTION 'Browser privilege path remains'; END IF;
   END LOOP;
   FOREACH privilege_name IN ARRAY ARRAY['SELECT','INSERT','UPDATE','REFERENCES'] LOOP
    IF has_any_column_privilege(reachable.oid,'public.business_onboardings',privilege_name) THEN RAISE EXCEPTION 'Browser column privilege path remains'; END IF;
   END LOOP;
   IF current_setting('server_version_num')::integer >= 170000 AND has_table_privilege(reachable.oid,'public.business_onboardings','MAINTAIN') THEN RAISE EXCEPTION 'Browser MAINTAIN privilege remains'; END IF;
  END LOOP;
 END LOOP;
 FOREACH privilege_name IN ARRAY ARRAY['SELECT','INSERT','UPDATE'] LOOP
  IF NOT has_table_privilege('service_role','public.business_onboardings',privilege_name) THEN RAISE EXCEPTION 'Missing service privilege'; END IF;
 END LOOP;
 FOREACH privilege_name IN ARRAY ARRAY['DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
  IF has_table_privilege('service_role','public.business_onboardings',privilege_name) THEN RAISE EXCEPTION 'Unexpected service privilege: %', privilege_name; END IF;
 END LOOP;
 IF current_setting('server_version_num')::integer >= 170000 AND has_table_privilege('service_role','public.business_onboardings','MAINTAIN') THEN RAISE EXCEPTION 'Unexpected service MAINTAIN privilege'; END IF;
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.business_onboardings'::regclass) OR EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.business_onboardings'::regclass) THEN RAISE EXCEPTION 'Unexpected onboarding RLS configuration'; END IF;
END;
$security$;
COMMIT;
