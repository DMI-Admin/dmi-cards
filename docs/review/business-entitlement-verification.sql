-- READ ONLY. Capture existing-contract fingerprint before and after migration.
WITH tables AS (
 SELECT c.oid,c.relname,c.relrowsecurity,c.relacl
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname IN ('business_workspaces','business_entitlements','business_entitlement_events') AND c.relkind='r'
), funcs AS (
 SELECT p.oid,p.proname,p.prosecdef,p.proconfig,p.proacl,pg_get_functiondef(p.oid) definition
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN ('get_business_entitlement','admin_command_business_entitlement','protect_business_entitlement_event','protect_activated_business_proposal')
)
SELECT 'tables' section,coalesce(jsonb_agg(to_jsonb(t)),'[]') details FROM tables t
UNION ALL
SELECT 'table_and_column_access',coalesce(jsonb_agg(jsonb_build_object('table',t.relname,'role',r.role_name,'privilege',p.privilege_name,'allowed',has_table_privilege(r.role_name,t.oid,p.privilege_name),'any_column',CASE WHEN p.privilege_name IN ('SELECT','INSERT','UPDATE','REFERENCES') THEN has_any_column_privilege(r.role_name,t.oid,p.privilege_name) ELSE NULL END)),'[]') FROM tables t CROSS JOIN (VALUES('anon'),('authenticated'),('service_role')) r(role_name) CROSS JOIN (VALUES('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER'),('MAINTAIN')) p(privilege_name)
UNION ALL
SELECT 'functions',coalesce(jsonb_agg(to_jsonb(f)),'[]') FROM funcs f
UNION ALL
SELECT 'execute',coalesce(jsonb_agg(jsonb_build_object('function',f.proname,'role',r.role_name,'allowed',has_function_privilege(r.role_name,f.oid,'EXECUTE'))),'[]') FROM funcs f CROSS JOIN (VALUES('anon'),('authenticated'),('service_role')) r(role_name)
UNION ALL
SELECT 'columns',coalesce(jsonb_agg(jsonb_build_object('table',t.relname,'name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid))),'[]') FROM tables t JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum>0 AND NOT a.attisdropped LEFT JOIN pg_attrdef d ON d.adrelid=t.oid AND d.adnum=a.attnum
UNION ALL
SELECT 'constraints',coalesce(jsonb_agg(jsonb_build_object('table',t.relname,'name',c.conname,'valid',c.convalidated,'definition',pg_get_constraintdef(c.oid))),'[]') FROM tables t JOIN pg_constraint c ON c.conrelid=t.oid
UNION ALL
SELECT 'indexes',coalesce(jsonb_agg(jsonb_build_object('table',t.relname,'valid',i.indisvalid,'definition',pg_get_indexdef(i.indexrelid))),'[]') FROM tables t JOIN pg_index i ON i.indrelid=t.oid
UNION ALL
SELECT 'policies_should_be_empty',coalesce(jsonb_agg(to_jsonb(p)),'[]') FROM pg_policy p JOIN tables t ON t.oid=p.polrelid
UNION ALL
SELECT 'existing_contract_fingerprint',to_jsonb(md5(coalesce(string_agg(x.definition,E'\n' ORDER BY x.definition),''))) FROM (
 SELECT pg_get_functiondef(p.oid)||coalesce(p.proacl::text,'') definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f' AND p.proname NOT IN ('get_business_entitlement','admin_command_business_entitlement','protect_business_entitlement_event','protect_activated_business_proposal')
 UNION ALL SELECT c.relname||coalesce(c.relacl::text,'')||c.relrowsecurity::text||c.relforcerowsecurity::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relname NOT IN ('business_workspaces','business_entitlements','business_entitlement_events')
 UNION ALL SELECT to_jsonb(p)::text FROM pg_policy p WHERE p.polrelid IN (SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname NOT IN ('business_workspaces','business_entitlements','business_entitlement_events'))
) x;
-- Expected: 3 RLS tables/no policies; browser table/column/EXECUTE false;
-- service SELECT only, EXECUTE true only on resolver and command, false on trigger helpers.
-- Review membership/role-switch paths too, not just direct ACL entries.
SELECT r.rolname,r.rolsuper,r.rolbypassrls,
 pg_has_role('anon',r.oid,'MEMBER') anon_member,
 pg_has_role('authenticated',r.oid,'MEMBER') authenticated_member
FROM pg_roles r WHERE r.rolname IN ('anon','authenticated','service_role')
 OR pg_has_role('anon',r.oid,'MEMBER') OR pg_has_role('authenticated',r.oid,'MEMBER');
