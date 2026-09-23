-- Review-only rollback of 20260924090000, based on captured staging state.
-- Roll back the later foundation migration FIRST. Never use CASCADE.
-- Refuses to discard any values written to the added columns.
-- Restores the old account-type reset behavior: use only to undo this prerequisite.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $rollback$
declare
  provisioning_definition text;
  provisioning_acl text;
begin
  if to_regprocedure('public.admin_set_client_status(uuid,text)') is not null
     or to_regprocedure('public.admin_create_client_staff(uuid,jsonb)') is not null
     or to_regprocedure('public.admin_update_client_staff(uuid,jsonb)') is not null
     or to_regprocedure('public.admin_import_client_accounts(jsonb)') is not null then
    raise exception 'Roll back the foundation RPCs before prerequisite rollback';
  end if;
  lock table public.clients, public.client_users, public.cards in access exclusive mode;
  if exists (select 1 from public.clients where job_title is not null)
     or exists (select 1 from public.client_users where website is not null or address is not null
       or whatsapp is not null or linkedin is not null or instagram is not null or facebook is not null
       or youtube is not null or booking_link is not null or custom_url is not null)
     or exists (select 1 from public.cards where client_id is not null) then
    raise exception 'New columns contain data; rollback would lose data';
  end if;
  select pg_get_functiondef(p.oid), p.proacl::text
    into provisioning_definition, provisioning_acl
  from pg_proc as p
  where p.oid = to_regprocedure('public.ensure_client_records_for_profile(uuid)');
  if provisioning_definition is null or md5(provisioning_definition) <> 'd38f31f4611e7be8fa8a8931b3af150d' then
    raise exception 'Provisioning definition drift; rollback aborted';
  end if;

  execute replace(provisioning_definition,
    E'      status = coalesce(nullif(status, ''''), ''active''),\n      cards_active',
    E'      account_type = ''individual'',\n      status = coalesce(nullif(status, ''''), ''active''),\n      cards_active');

  if (select md5(pg_get_functiondef(p.oid)) from pg_proc as p
      where p.oid = 'public.ensure_client_records_for_profile(uuid)'::regprocedure) <> '010d4e08fb0a67dd5ee0808a7101c8ee'
     or (select p.proacl::text from pg_proc as p
         where p.oid = 'public.ensure_client_records_for_profile(uuid)'::regprocedure)
        is distinct from provisioning_acl then
    raise exception 'Original provisioning definition/ACL was not restored';
  end if;

  alter table public.cards drop column client_id;
  alter table public.client_users
    drop column website, drop column address, drop column whatsapp, drop column linkedin,
    drop column instagram, drop column facebook, drop column youtube,
    drop column booking_link, drop column custom_url;
  alter table public.clients drop column job_title;
end;
$rollback$;
commit;
