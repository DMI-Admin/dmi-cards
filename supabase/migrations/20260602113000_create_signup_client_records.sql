create extension if not exists pgcrypto;

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  full_name text not null default '',
  company_name text,
  email text not null default '',
  phone text,
  status text not null default 'active',
  subscription_plan text not null default 'free',
  account_type text not null default 'individual',
  billing_status text not null default 'free',
  cards_active integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.clients
  add column if not exists profile_id uuid references public.profiles(id) on delete cascade,
  add column if not exists user_id uuid references auth.users(id) on delete cascade,
  add column if not exists full_name text not null default '',
  add column if not exists company_name text,
  add column if not exists email text not null default '',
  add column if not exists phone text,
  add column if not exists status text not null default 'active',
  add column if not exists subscription_plan text not null default 'free',
  add column if not exists account_type text not null default 'individual',
  add column if not exists billing_status text not null default 'free',
  add column if not exists cards_active integer not null default 0,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.client_users (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  full_name text,
  email text,
  phone text,
  job_title text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.client_users
  add column if not exists client_id uuid references public.clients(id) on delete cascade,
  add column if not exists profile_id uuid references public.profiles(id) on delete cascade,
  add column if not exists user_id uuid references auth.users(id) on delete cascade,
  add column if not exists full_name text,
  add column if not exists email text,
  add column if not exists phone text,
  add column if not exists job_title text,
  add column if not exists status text not null default 'active',
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

update public.clients
set
  subscription_plan = 'free',
  billing_status = coalesce(nullif(billing_status, ''), 'free'),
  account_type = coalesce(nullif(account_type, ''), 'individual'),
  status = coalesce(nullif(status, ''), 'active'),
  cards_active = coalesce(cards_active, 0),
  updated_at = coalesce(updated_at, created_at, now()),
  created_at = coalesce(created_at, now())
where subscription_plan is null
   or subscription_plan <> 'free'
   or billing_status is null
   or billing_status = ''
   or account_type is null
   or account_type = ''
   or status is null
   or status = ''
   or cards_active is null
   or updated_at is null
   or created_at is null;

update public.client_users
set
  status = coalesce(nullif(status, ''), 'active'),
  updated_at = coalesce(updated_at, created_at, now()),
  created_at = coalesce(created_at, now())
where status is null
   or status = ''
   or updated_at is null
   or created_at is null;

create unique index if not exists clients_profile_id_unique_idx
  on public.clients (profile_id)
  where profile_id is not null;

create unique index if not exists clients_user_id_unique_idx
  on public.clients (user_id)
  where user_id is not null;

create unique index if not exists client_users_profile_id_unique_idx
  on public.client_users (profile_id)
  where profile_id is not null;

create unique index if not exists client_users_user_id_unique_idx
  on public.client_users (user_id)
  where user_id is not null;

create index if not exists client_users_client_id_idx
  on public.client_users (client_id);

create or replace function public.ensure_client_records_for_profile(target_profile_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  profile_record public.profiles%rowtype;
  client_record_id uuid;
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

  selected_full_name := coalesce(nullif(profile_record.full_name, ''), nullif(profile_record.email, ''), 'Client');
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
      full_name,
      email,
      status
    ) values (
      client_record_id,
      profile_record.id,
      profile_record.id,
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

create or replace function public.ensure_client_records_after_profile_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.ensure_client_records_for_profile(new.id);
  return new;
end;
$$;

drop trigger if exists ensure_client_records_after_profile_insert on public.profiles;

create trigger ensure_client_records_after_profile_insert
after insert on public.profiles
for each row
execute function public.ensure_client_records_after_profile_write();

drop trigger if exists ensure_client_records_after_profile_update on public.profiles;

create trigger ensure_client_records_after_profile_update
after update of full_name, email, subscription_plan, plan on public.profiles
for each row
execute function public.ensure_client_records_after_profile_write();

select public.ensure_client_records_for_profile(id)
from public.profiles;
