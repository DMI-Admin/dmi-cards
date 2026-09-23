-- Additive prerequisites for the captured DMI Cards staging schema.
-- No backfill, identity inference, grants, policies, or Cards/media function changes.
-- Stop on definition drift or pre-existing columns; review the target before reuse.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $prerequisites$
declare
  provisioning_definition text;
  provisioning_acl text;
begin
  select pg_get_functiondef(p.oid), p.proacl::text
    into provisioning_definition, provisioning_acl
  from pg_proc as p
  where p.oid = to_regprocedure('public.ensure_client_records_for_profile(uuid)');
  if provisioning_definition is null or md5(provisioning_definition) <> '010d4e08fb0a67dd5ee0808a7101c8ee' then
    raise exception 'Unexpected provisioning definition; inspect before applying prerequisites';
  end if;

  alter table public.clients add column job_title text;

  alter table public.client_users
    add column website text,
    add column address text,
    add column whatsapp text,
    add column linkedin text,
    add column instagram text,
    add column facebook text,
    add column youtube text,
    add column booking_link text,
    add column custom_url text;

  alter table public.cards
    add column client_id uuid,
    add constraint cards_client_id_fkey
      foreign key (client_id) references public.clients(id)
      on delete restrict;

  -- Preserve the complete captured function except this existing-row assignment.
  -- The INSERT branch still creates individual accounts.
  execute replace(provisioning_definition, E'      account_type = ''individual'',\n', '');

  if (select md5(pg_get_functiondef(p.oid)) from pg_proc as p
      where p.oid = 'public.ensure_client_records_for_profile(uuid)'::regprocedure) <> 'd38f31f4611e7be8fa8a8931b3af150d'
     or (select p.proacl::text from pg_proc as p
         where p.oid = 'public.ensure_client_records_for_profile(uuid)'::regprocedure)
        is distinct from provisioning_acl then
    raise exception 'Provisioning correction or permissions differ from the reviewed change';
  end if;
end;
$prerequisites$;
commit;
