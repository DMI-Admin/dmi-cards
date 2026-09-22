-- READ ONLY. Run BEFORE hardening; save the returned SQL outside the database.
-- Rollback restores only original authenticated mutation ACL entries and grant options.
-- Execute saved output only as the original table owner, during a controlled rollback.
-- Do not run this generator after hardening: original revoked ACLs would be lost.
with target as (
  select oid,relowner,relacl from pg_catalog.pg_class where oid='public.cards'::regclass
), acl as (
  select x.grantor,x.grantee,x.privilege_type,x.is_grantable,null::text as column_name
  from target t cross join lateral pg_catalog.aclexplode(t.relacl) x
  union all
  select x.grantor,x.grantee,x.privilege_type,x.is_grantable,a.attname::text
  from target t join pg_catalog.pg_attribute a on a.attrelid=t.oid
  cross join lateral pg_catalog.aclexplode(a.attacl) x where a.attnum>0 and not a.attisdropped
), relevant as (
  select * from acl where grantee='authenticated'::regrole
    and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN')
), statements as (
  select format('GRANT %s%s ON TABLE public.cards TO authenticated%s;',privilege_type,
    case when column_name is null then '' else format(' (%I)',column_name) end,
    case when is_grantable then ' WITH GRANT OPTION' else '' end) as sql
  from relevant
)
select case when current_user::regrole<>t.relowner or exists(select 1 from relevant where grantor<>t.relowner)
  then 'STOP: run as table owner; unexpected grantor requires review.'
  else '-- WARNING: rollback restores the previous direct-write bypass.' || E'\nBEGIN;\nSET LOCAL lock_timeout = ''5s'';\nLOCK TABLE public.cards IN ACCESS EXCLUSIVE MODE;\n'
    || format('DO $guard$ BEGIN IF current_user <> %L THEN RAISE EXCEPTION ''Wrong rollback executor''; END IF; END $guard$;',pg_catalog.pg_get_userbyid(t.relowner))
    || E'\n' || coalesce((select string_agg(sql,E'\n' order by sql) from statements),'-- No original direct mutation ACLs.') || E'\nCOMMIT;'
  end as rollback_sql,
  t.relacl as original_table_acl,
  (select jsonb_agg(jsonb_build_object('column',a.attname,'acl',a.attacl) order by a.attnum)
   from pg_catalog.pg_attribute a where a.attrelid=t.oid and a.attnum>0 and not a.attisdropped and a.attacl is not null) as original_column_acls
from target t;
