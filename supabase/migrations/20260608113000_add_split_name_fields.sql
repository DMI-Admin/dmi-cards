alter table public.profiles
  add column if not exists title text,
  add column if not exists first_name text,
  add column if not exists last_name text;

alter table public.clients
  add column if not exists title text,
  add column if not exists first_name text,
  add column if not exists last_name text;

alter table public.client_users
  add column if not exists title text,
  add column if not exists first_name text,
  add column if not exists last_name text;

alter table public.cards
  add column if not exists title text,
  add column if not exists first_name text,
  add column if not exists last_name text;

update public.profiles
set
  first_name = coalesce(nullif(first_name, ''), split_part(trim(full_name), ' ', 1)),
  last_name = coalesce(
    nullif(last_name, ''),
    nullif(regexp_replace(trim(full_name), '^\S+\s*', ''), '')
  )
where full_name is not null
  and trim(full_name) <> ''
  and (
    first_name is null
    or first_name = ''
    or last_name is null
    or last_name = ''
  );

update public.clients
set
  first_name = coalesce(nullif(first_name, ''), split_part(trim(full_name), ' ', 1)),
  last_name = coalesce(
    nullif(last_name, ''),
    nullif(regexp_replace(trim(full_name), '^\S+\s*', ''), '')
  )
where full_name is not null
  and trim(full_name) <> ''
  and (
    first_name is null
    or first_name = ''
    or last_name is null
    or last_name = ''
  );

update public.client_users
set
  first_name = coalesce(nullif(first_name, ''), split_part(trim(full_name), ' ', 1)),
  last_name = coalesce(
    nullif(last_name, ''),
    nullif(regexp_replace(trim(full_name), '^\S+\s*', ''), '')
  )
where full_name is not null
  and trim(full_name) <> ''
  and (
    first_name is null
    or first_name = ''
    or last_name is null
    or last_name = ''
  );

update public.cards
set
  first_name = coalesce(nullif(first_name, ''), split_part(trim(full_name), ' ', 1)),
  last_name = coalesce(
    nullif(last_name, ''),
    nullif(regexp_replace(trim(full_name), '^\S+\s*', ''), '')
  )
where full_name is not null
  and trim(full_name) <> ''
  and (
    first_name is null
    or first_name = ''
    or last_name is null
    or last_name = ''
  );

update public.templates
set allowed_fields = array(
  select distinct field
  from unnest(
    coalesce(allowed_fields, '{}'::text[]) ||
    array['title', 'first_name', 'last_name']::text[]
  ) as fields(field)
  where field <> 'full_name'
)
where allowed_fields is not null;

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
      account_type = 'individual',
      subscription_plan = 'free',
      billing_status = 'free',
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
    subscription_plan = 'free',
    plan = 'free',
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

drop trigger if exists ensure_client_records_after_profile_update on public.profiles;

create trigger ensure_client_records_after_profile_update
after update of title, first_name, last_name, full_name, email, subscription_plan, plan on public.profiles
for each row
execute function public.ensure_client_records_after_profile_write();
