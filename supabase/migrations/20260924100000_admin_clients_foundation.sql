-- Local review only. Existing tables and Cards/media contracts are unchanged.
-- CREATE OR REPLACE preserves existing provisioning function ACLs.
begin;
create or replace function public.ensure_client_records_for_profile(target_profile_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  profile_record public.profiles%rowtype;
  client_record_id uuid;
  selected_title text;
  selected_first_name text;
  selected_last_name text;
  selected_full_name text;
  selected_email text;
begin
  select *
  into profile_record
  from public.profiles
  where id = target_profile_id;

  if not found then
    return null;
  end if;

  selected_title := coalesce(profile_record.title, '');
  selected_first_name := coalesce(profile_record.first_name, '');
  selected_last_name := coalesce(profile_record.last_name, '');
  selected_full_name := coalesce(
    nullif(profile_record.full_name, ''),
    nullif(concat_ws(' ', nullif(selected_title, ''), nullif(selected_first_name, ''), nullif(selected_last_name, '')), ''),
    nullif(profile_record.email, ''),
    'Client'
  );
  selected_email := coalesce(profile_record.email, '');

  select id
  into client_record_id
  from public.clients
  where profile_id = profile_record.id
     or user_id = profile_record.id
  limit 1;

  if client_record_id is null and selected_email <> '' then
    select id
    into client_record_id
    from public.clients
    where lower(email) = lower(selected_email)
      and coalesce(account_type, 'individual') = 'individual'
    order by created_at asc
    limit 1;
  end if;

  if client_record_id is null then
    insert into public.clients (
      profile_id,
      user_id,
      title,
      first_name,
      last_name,
      full_name,
      company_name,
      email,
      account_type,
      subscription_plan,
      billing_status,
      status,
      cards_active
    ) values (
      profile_record.id,
      profile_record.id,
      selected_title,
      selected_first_name,
      selected_last_name,
      selected_full_name,
      '',
      selected_email,
      'individual',
      'free',
      'free',
      'active',
      0
    )
    returning id into client_record_id;
  else
    update public.clients
    set
      profile_id = coalesce(profile_id, profile_record.id),
      user_id = coalesce(user_id, profile_record.id),
      title = coalesce(nullif(title, ''), selected_title),
      first_name = coalesce(nullif(first_name, ''), selected_first_name),
      last_name = coalesce(nullif(last_name, ''), selected_last_name),
      full_name = coalesce(nullif(full_name, ''), selected_full_name),
      email = coalesce(nullif(email, ''), selected_email),
      status = coalesce(nullif(status, ''), 'active'),
      cards_active = coalesce(cards_active, 0),
      updated_at = now()
    where id = client_record_id;
  end if;

  if not exists (
    select 1
    from public.client_users
    where profile_id = profile_record.id
       or user_id = profile_record.id
       or (
         client_id = client_record_id
         and selected_email <> ''
         and lower(coalesce(email, '')) = lower(selected_email)
       )
  ) then
    insert into public.client_users (
      client_id,
      profile_id,
      user_id,
      title,
      first_name,
      last_name,
      full_name,
      email,
      status
    ) values (
      client_record_id,
      profile_record.id,
      profile_record.id,
      selected_title,
      selected_first_name,
      selected_last_name,
      selected_full_name,
      selected_email,
      'active'
    );
  else
    update public.client_users
    set
      client_id = coalesce(client_id, client_record_id),
      profile_id = coalesce(profile_id, profile_record.id),
      user_id = coalesce(user_id, profile_record.id),
      title = coalesce(nullif(title, ''), selected_title),
      first_name = coalesce(nullif(first_name, ''), selected_first_name),
      last_name = coalesce(nullif(last_name, ''), selected_last_name),
      full_name = coalesce(nullif(full_name, ''), selected_full_name),
      email = coalesce(nullif(email, ''), selected_email),
      status = coalesce(nullif(status, ''), 'active'),
      updated_at = now()
    where profile_id = profile_record.id
       or user_id = profile_record.id
       or (
         client_id = client_record_id
         and selected_email <> ''
         and lower(coalesce(email, '')) = lower(selected_email)
       );
  end if;

  return client_record_id;
end;
$$;

create or replace function public.ensure_current_client_account()
returns table (
  client_id uuid,
  client_user_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
  selected_client_id uuid;
  selected_client_user_id uuid;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'Authentication required'
      using errcode = '28000';
  end if;

  insert into public.profiles (
    id,
    title,
    first_name,
    last_name,
    full_name,
    email,
    subscription_plan,
    plan
  )
  select
    users.id,
    coalesce(users.raw_user_meta_data ->> 'title', ''),
    coalesce(users.raw_user_meta_data ->> 'first_name', ''),
    coalesce(users.raw_user_meta_data ->> 'last_name', ''),
    coalesce(
      nullif(users.raw_user_meta_data ->> 'full_name', ''),
      nullif(
        concat_ws(
          ' ',
          nullif(users.raw_user_meta_data ->> 'title', ''),
          nullif(users.raw_user_meta_data ->> 'first_name', ''),
          nullif(users.raw_user_meta_data ->> 'last_name', '')
        ),
        ''
      ),
      ''
    ),
    users.email,
    'free',
    'free'
  from auth.users as users
  where users.id = current_user_id
  on conflict (id) do update
  set
    title = coalesce(nullif(public.profiles.title, ''), excluded.title),
    first_name = coalesce(nullif(public.profiles.first_name, ''), excluded.first_name),
    last_name = coalesce(nullif(public.profiles.last_name, ''), excluded.last_name),
    full_name = coalesce(nullif(public.profiles.full_name, ''), excluded.full_name),
    email = coalesce(nullif(public.profiles.email, ''), excluded.email),
    updated_at = now();

  selected_client_id := public.ensure_client_records_for_profile(current_user_id);

  select client_users.id
  into selected_client_user_id
  from public.client_users
  where client_users.profile_id = current_user_id
     or client_users.user_id = current_user_id
  order by client_users.created_at asc
  limit 1;

  client_id := selected_client_id;
  client_user_id := selected_client_user_id;
  return next;
end;
$$;


-- Account + membership status changes must commit together.
create function public.admin_set_client_status(p_client_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_status is null or p_status not in ('active', 'suspended') then
    raise exception 'Invalid status';
  end if;
  perform 1 from public.clients where id = p_client_id for update;
  if not found then raise exception 'Client not found'; end if;
  update public.clients set status = p_status where id = p_client_id;
  update public.client_users set status = p_status where client_id = p_client_id;
end;
$$;

create function public.admin_create_client_staff(p_client_id uuid, p_staff jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare company public.clients%rowtype; person public.client_users%rowtype;
begin
  select * into company from public.clients where id = p_client_id for update;
  if not found or company.account_type not in ('business', 'enterprise') then raise exception 'Company required'; end if;
  if jsonb_typeof(p_staff) <> 'object' or exists (
    select 1 from jsonb_object_keys(p_staff) as field(key)
    where field.key not in ('full_name','email','phone','job_title','website','address','whatsapp','linkedin','instagram','facebook','youtube','booking_link','custom_url','status')
  ) then raise exception 'Invalid staff payload'; end if;
  select * into person from jsonb_populate_record(null::public.client_users, p_staff);
  if coalesce(trim(person.full_name), '') = '' then raise exception 'Name required'; end if;
  insert into public.client_users (client_id,full_name,email,phone,job_title,website,address,whatsapp,linkedin,instagram,facebook,youtube,booking_link,custom_url,status)
  values (p_client_id,person.full_name,person.email,person.phone,person.job_title,person.website,person.address,person.whatsapp,person.linkedin,person.instagram,person.facebook,person.youtube,person.booking_link,person.custom_url,
    case when company.status in ('suspended','inactive') then 'suspended' else coalesce(person.status,'active') end);
end;
$$;

-- Same parent-first lock order as suspension and staff creation.
create function public.admin_update_client_staff(p_staff_id uuid, p_staff jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare parent_id uuid; parent_status text; person public.client_users%rowtype;
begin
  select client_id into parent_id from public.client_users where id = p_staff_id;
  if not found or parent_id is null then raise exception 'Linked company/account required'; end if;
  select status into parent_status from public.clients where id = parent_id for update;
  if not found then raise exception 'Parent account missing'; end if;
  select * into person from public.client_users where id = p_staff_id and client_id = parent_id for update;
  if not found then raise exception 'Staff linkage changed'; end if;
  if jsonb_typeof(p_staff) <> 'object' or exists (
    select 1 from jsonb_object_keys(p_staff) as field(key)
    where field.key not in ('full_name','email','phone','job_title','website','address','whatsapp','linkedin','instagram','facebook','youtube','booking_link','custom_url','status')
  ) then raise exception 'Invalid staff payload'; end if;
  select * into person from jsonb_populate_record(person, p_staff);
  if parent_status in ('suspended','inactive') and person.status = 'active' then raise exception 'Reactivate parent account first'; end if;
  update public.client_users set full_name=person.full_name,email=person.email,phone=person.phone,job_title=person.job_title,
    website=person.website,address=person.address,whatsapp=person.whatsapp,linkedin=person.linkedin,instagram=person.instagram,
    facebook=person.facebook,youtube=person.youtube,booking_link=person.booking_link,custom_url=person.custom_url,status=person.status
  where id=p_staff_id and client_id=parent_id;
end;
$$;

-- Whole import is atomic; deterministic IDs allow an unchanged lost-response retry.
-- Never UPSERT existing accounts or use email/name as identity.
create function public.admin_import_client_accounts(p_companies jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare item jsonb; staff_item jsonb; existing jsonb;
  company public.clients%rowtype; person public.client_users%rowtype; staff_total integer := 0;
begin
  if jsonb_typeof(p_companies) <> 'array' or jsonb_array_length(p_companies) not between 1 and 50 then raise exception 'Invalid import size'; end if;
  -- Serialize retries of this exact operation, including concurrently submitted retries.
  perform pg_advisory_xact_lock(hashtextextended(p_companies->0->'client'->>'id', 0));
  for item in select value from jsonb_array_elements(p_companies) loop
    if jsonb_typeof(item->'client') <> 'object' or jsonb_typeof(item->'staff') <> 'array' then raise exception 'Invalid import'; end if;
    staff_total := staff_total + jsonb_array_length(item->'staff');
    if staff_total > 200 then raise exception 'Too many staff'; end if;
    select * into company from jsonb_populate_record(null::public.clients, item->'client');
    if company.id is null or company.account_type not in ('business','enterprise') or coalesce(trim(company.full_name),'') = '' then raise exception 'Invalid company'; end if;
    select to_jsonb(c) into existing from public.clients as c where c.id = company.id for update;
    if found then
      if not existing @> (item->'client') then raise exception 'Import retry conflicts with existing account'; end if;
    else
      insert into public.clients (id,full_name,company_name,email,phone,job_title,account_type,subscription_plan,billing_status,status)
      values (company.id,company.full_name,company.company_name,company.email,company.phone,company.job_title,company.account_type,company.subscription_plan,company.billing_status,company.status);
    end if;
    for staff_item in select value from jsonb_array_elements(item->'staff') loop
      select * into person from jsonb_populate_record(null::public.client_users, staff_item);
      if person.id is null or person.client_id is distinct from company.id or coalesce(trim(person.full_name),'') = '' then raise exception 'Invalid staff'; end if;
      select to_jsonb(s) into existing from public.client_users as s where s.id = person.id for update;
      if found then
        if not existing @> staff_item then raise exception 'Import retry conflicts with existing staff'; end if;
      else
        insert into public.client_users (id,client_id,full_name,email,phone,job_title,website,address,whatsapp,linkedin,instagram,facebook,youtube,booking_link,custom_url,status)
        values (person.id,company.id,person.full_name,person.email,person.phone,person.job_title,person.website,person.address,person.whatsapp,person.linkedin,person.instagram,person.facebook,person.youtube,person.booking_link,person.custom_url,coalesce(person.status,'active'));
      end if;
    end loop;
  end loop;
end;
$$;

revoke all on function public.admin_set_client_status(uuid,text), public.admin_create_client_staff(uuid,jsonb), public.admin_import_client_accounts(jsonb), public.admin_update_client_staff(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.admin_set_client_status(uuid,text), public.admin_create_client_staff(uuid,jsonb), public.admin_import_client_accounts(jsonb), public.admin_update_client_staff(uuid,jsonb) to service_role;
commit;
