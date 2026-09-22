-- Run the read-only ACL rollback generator and SAVE its output before execution.
-- No card data, policies, role memberships, or other table grants are changed.
-- RESTRICT is intentional: dependent grants abort rather than cascade.
begin;
set local lock_timeout = '5s';
lock table public.cards in access exclusive mode;
do $hardening$
declare
  c oid := 'public.cards'::regclass;
  auth_id oid := 'authenticated'::regrole;
  phase integer; p text; sig text; f oid; member_role record; col record;
  privileges text[] := array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'];
  columns_sql text; policies_before jsonb; anon_select_before boolean;
begin
  if current_setting('server_version_num')::integer >= 170000 then
    privileges := array_append(privileges, 'MAINTAIN');
  end if;
  if (select relkind from pg_catalog.pg_class where oid=c) <> 'r' then
    raise exception 'CARDS_HARDENING_UNEXPECTED_TABLE_KIND';
  end if;
  if (select relowner from pg_catalog.pg_class where oid=c) <> current_user::regrole then
    raise exception 'CARDS_HARDENING_RUN_AS_TABLE_OWNER';
  end if;
  -- Make captured rollback grants reproducible by this same executor.
  if exists (
    select 1 from (
      select x.* from pg_catalog.pg_class t cross join lateral pg_catalog.aclexplode(t.relacl) x where t.oid=c
      union all
      select x.* from pg_catalog.pg_attribute a cross join lateral pg_catalog.aclexplode(a.attacl) x where a.attrelid=c and a.attnum>0 and not a.attisdropped
    ) acl where grantee=auth_id and privilege_type=any(privileges) and grantor<>current_user::regrole
  ) then raise exception 'CARDS_HARDENING_UNEXPECTED_ACL_GRANTOR'; end if;
  select coalesce(jsonb_agg(to_jsonb(policy_row) order by policy_row.oid), '[]'::jsonb) into policies_before from pg_catalog.pg_policy policy_row where polrelid=c;
  anon_select_before := has_table_privilege('anon',c,'SELECT');
  if not anon_select_before then raise exception 'CARDS_HARDENING_ANON_SELECT_MISSING'; end if;
  for phase in 0..1 loop
    if not (select relrowsecurity from pg_catalog.pg_class where oid=c) then
      raise exception 'CARDS_HARDENING_RLS_DISABLED';
    end if;
    if not has_schema_privilege('authenticated','public','USAGE') or not has_table_privilege('authenticated',c,'SELECT') then
      raise exception 'CARDS_HARDENING_AUTHENTICATED_SELECT_MISSING';
    end if;
    if not has_schema_privilege('service_role','public','USAGE') then raise exception 'CARDS_HARDENING_SERVICE_SCHEMA_ACCESS'; end if;
    if not (select rolbypassrls or rolsuper from pg_catalog.pg_roles where rolname='service_role') then
      raise exception 'CARDS_HARDENING_SERVICE_RLS_BYPASS_MISSING';
    end if;
    foreach p in array array['SELECT','INSERT','UPDATE','DELETE'] loop
      if not has_table_privilege('service_role',c,p) then raise exception 'CARDS_HARDENING_SERVICE_PRIVILEGE_MISSING: %',p; end if;
    end loop;
    if to_regprocedure('public.assign_card_slot()') is null then raise exception 'CARDS_HARDENING_SLOT_FUNCTION_MISSING'; end if;
    foreach sig in array array[
      'public.create_client_card_atomic(uuid,smallint,jsonb)',
      'public.finalize_client_card_media(uuid,uuid,text,uuid,smallint,jsonb,jsonb,text)',
      'public.get_client_card_edit_snapshot(uuid,uuid)',
      'public.reserve_card_media_asset(uuid,uuid,text,text,text,integer)',
      'public.mark_card_media_ready(uuid,uuid,uuid)',
      'public.attach_card_media_session(uuid,uuid,uuid)',
      'public.retire_card_media_asset(uuid)',
      'public.claim_card_media_cleanup(uuid)',
      'public.card_media_owner_exists(uuid)'
    ] loop
      f := to_regprocedure(sig);
      if f is null then raise exception 'CARDS_HARDENING_RPC_MISSING: %',sig; end if;
      if not has_function_privilege('service_role',f,'EXECUTE') or has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE') then
        raise exception 'CARDS_HARDENING_RPC_PERMISSIONS: %',sig;
      end if;
    end loop;
    if phase=0 then
      foreach p in array privileges loop
        execute format('revoke %s on table public.cards from authenticated restrict',p);
      end loop;
      select string_agg(format('%I',attname),', ' order by attnum) into columns_sql
        from pg_catalog.pg_attribute where attrelid=c and attnum>0 and not attisdropped;
      foreach p in array array['INSERT','UPDATE','REFERENCES'] loop
        execute format('revoke %s (%s) on table public.cards from authenticated restrict',p,columns_sql);
      end loop;
    else
      -- Conservative membership closure includes NOINHERIT/SET ROLE paths.
      -- Even a currently non-switchable privileged membership aborts for review.
      for member_role in select oid,rolname,rolsuper,rolcreaterole from pg_catalog.pg_roles
        where oid=auth_id or pg_has_role(auth_id,oid,'MEMBER') loop
        if member_role.rolsuper or member_role.rolcreaterole or member_role.oid=(select relowner from pg_catalog.pg_class where oid=c) then
          raise exception 'CARDS_HARDENING_PRIVILEGED_ROLE_PATH: %',member_role.rolname;
        end if;
        foreach p in array privileges loop
          if has_table_privilege(member_role.oid,c,p) then raise exception 'CARDS_HARDENING_EFFECTIVE_WRITE: % %',member_role.rolname,p; end if;
        end loop;
        for col in select attnum from pg_catalog.pg_attribute where attrelid=c and attnum>0 and not attisdropped loop
          foreach p in array array['INSERT','UPDATE','REFERENCES'] loop
            if has_column_privilege(member_role.oid,c,col.attnum,p) then raise exception 'CARDS_HARDENING_EFFECTIVE_COLUMN_WRITE: % %',member_role.rolname,p; end if;
          end loop;
        end loop;
        foreach sig in array array[
          'public.create_client_card_atomic(uuid,smallint,jsonb)',
      'public.finalize_client_card_media(uuid,uuid,text,uuid,smallint,jsonb,jsonb,text)',
      'public.get_client_card_edit_snapshot(uuid,uuid)',
      'public.reserve_card_media_asset(uuid,uuid,text,text,text,integer)',
      'public.mark_card_media_ready(uuid,uuid,uuid)',
      'public.attach_card_media_session(uuid,uuid,uuid)',
      'public.retire_card_media_asset(uuid)',
      'public.claim_card_media_cleanup(uuid)',
      'public.card_media_owner_exists(uuid)'
        ] loop
          if has_function_privilege(member_role.oid,to_regprocedure(sig),'EXECUTE') then
            raise exception 'CARDS_HARDENING_ROLE_RPC_BYPASS: % %',member_role.rolname,sig;
          end if;
        end loop;
      end loop;
    end if;
  end loop;
  if anon_select_before is distinct from has_table_privilege('anon',c,'SELECT') or policies_before is distinct from
    (select coalesce(jsonb_agg(to_jsonb(policy_row) order by policy_row.oid),'[]'::jsonb) from pg_catalog.pg_policy policy_row where polrelid=c) then
    raise exception 'CARDS_HARDENING_READ_POLICIES_CHANGED';
  end if;
end;
$hardening$;
commit;
