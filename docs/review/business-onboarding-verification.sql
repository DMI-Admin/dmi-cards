-- Read-only. Capture output alongside existing-schema/data fingerprints.
SELECT current_database() AS database_name, current_user, version(),
       to_regclass('public.business_onboardings') AS onboarding_table;
SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,c.relacl,
       pg_get_userbyid(c.relowner) AS owner
FROM pg_class c WHERE c.oid=to_regclass('public.business_onboardings');
SELECT r.role_name,p.privilege,
 has_table_privilege(r.role_name,'public.business_onboardings',p.privilege) AS allowed
FROM unnest(ARRAY['anon','authenticated','service_role']) r(role_name)
CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p(privilege);
SELECT r.role_name,p.privilege,
 has_any_column_privilege(r.role_name,'public.business_onboardings',p.privilege) AS any_column_allowed
FROM unnest(ARRAY['anon','authenticated']) r(role_name)
CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) p(privilege);
SELECT b.rolname AS browser_role,r.rolname AS reachable_role,r.rolsuper,r.rolbypassrls
FROM pg_roles b CROSS JOIN pg_roles r
WHERE b.rolname IN ('anon','authenticated') AND (b.oid=r.oid OR pg_has_role(b.oid,r.oid,'MEMBER'));
SELECT policyname,roles,cmd,qual,with_check FROM pg_policies
WHERE schemaname='public' AND tablename='business_onboardings';
SELECT column_name,data_type,is_nullable,column_default FROM information_schema.columns
WHERE table_schema='public' AND table_name='business_onboardings' ORDER BY ordinal_position;
SELECT conname,convalidated,pg_get_constraintdef(oid) FROM pg_constraint
WHERE conrelid=to_regclass('public.business_onboardings');
SELECT i.indexrelid::regclass AS index_name,i.indisvalid,i.indisunique,pg_get_indexdef(i.indexrelid)
FROM pg_index i WHERE i.indrelid=to_regclass('public.business_onboardings');
SELECT tgname,pg_get_triggerdef(oid) FROM pg_trigger
WHERE tgrelid=to_regclass('public.business_onboardings') AND NOT tgisinternal;
SELECT status,count(*) FROM public.business_onboardings GROUP BY status ORDER BY status;
