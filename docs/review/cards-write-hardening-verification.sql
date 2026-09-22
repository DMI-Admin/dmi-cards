-- READ ONLY: run before and after. No role switching or SQL mutations.
select current_database(),current_user,current_setting('server_version') as server_version;
select r.rolname,p.privilege,has_table_privilege(r.oid,'public.cards',p.privilege) as effective
from pg_catalog.pg_roles r cross join lateral unnest(
  array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] ||
  case when current_setting('server_version_num')::integer>=170000 then array['MAINTAIN'] else array[]::text[] end
) p(privilege) where r.rolname in ('anon','authenticated','service_role') order by 1,2;
select r.rolname,a.attname,p.privilege,has_column_privilege(r.oid,a.attrelid,a.attnum,p.privilege) as effective,a.attacl
from pg_catalog.pg_roles r cross join pg_catalog.pg_attribute a cross join unnest(array['SELECT','INSERT','UPDATE','REFERENCES']) p(privilege)
where r.rolname in ('anon','authenticated','service_role') and a.attrelid='public.cards'::regclass and a.attnum>0 and not a.attisdropped order by 1,2,3;
select relrowsecurity,relforcerowsecurity,pg_catalog.pg_get_userbyid(relowner) as owner,relacl from pg_catalog.pg_class where oid='public.cards'::regclass;
select * from pg_catalog.pg_policies where schemaname='public' and tablename='cards';
select r.rolname,r.rolsuper,r.rolcreaterole,r.rolbypassrls,
  has_table_privilege(r.oid,'public.cards','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as any_write,
  has_any_column_privilege(r.oid,'public.cards','INSERT,UPDATE,REFERENCES') as any_column_write
from pg_catalog.pg_roles r where r.rolname='authenticated' or pg_has_role('authenticated',r.oid,'MEMBER');
with required(signature) as (values
  ('public.create_client_card_atomic(uuid,smallint,jsonb)'),
  ('public.finalize_client_card_media(uuid,uuid,text,uuid,smallint,jsonb,jsonb,text)'),
  ('public.get_client_card_edit_snapshot(uuid,uuid)'),
  ('public.reserve_card_media_asset(uuid,uuid,text,text,text,integer)'),
  ('public.mark_card_media_ready(uuid,uuid,uuid)'),
  ('public.attach_card_media_session(uuid,uuid,uuid)'),
  ('public.retire_card_media_asset(uuid)'),
  ('public.claim_card_media_cleanup(uuid)'),
  ('public.card_media_owner_exists(uuid)'),
  ('public.assign_card_slot()')
)
select signature,to_regprocedure(signature) is not null as present,p.prosecdef as security_definer,p.proconfig,
  pg_catalog.pg_get_userbyid(p.proowner) as owner,p.proacl,
  has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
  has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
  has_function_privilege('service_role',p.oid,'EXECUTE') as service_execute
from required left join pg_catalog.pg_proc p on p.oid=to_regprocedure(signature);
-- Review any extra callable SECURITY DEFINER surface before production approval.
-- This lists candidates, not a claim that every function writes cards.
select p.oid::regprocedure as function_name,pg_catalog.pg_get_userbyid(p.proowner) as owner,p.proconfig,
  has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
  has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute
from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.prosecdef and
  (has_function_privilege('authenticated',p.oid,'EXECUTE') or has_function_privilege('anon',p.oid,'EXECUTE'))
order by 1;
