create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  subscription_plan text not null default 'free',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles
  add column if not exists full_name text,
  add column if not exists email text,
  add column if not exists subscription_plan text not null default 'free',
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

-- Compatibility for older app/admin code that may still read `plan`.
alter table public.profiles
  add column if not exists plan text not null default 'free';

update public.profiles
set subscription_plan = coalesce(nullif(subscription_plan, ''), nullif(plan, ''), 'free'),
    plan = coalesce(nullif(plan, ''), nullif(subscription_plan, ''), 'free')
where subscription_plan is null
   or subscription_plan = ''
   or plan is null
   or plan = '';

alter table public.profiles
  drop constraint if exists profiles_subscription_plan_check;

alter table public.profiles
  add constraint profiles_subscription_plan_check
  check (subscription_plan in ('free', 'paid'));

alter table public.profiles
  drop constraint if exists profiles_plan_check;

alter table public.profiles
  add constraint profiles_plan_check
  check (plan in ('free', 'paid'));

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;

create trigger profiles_set_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

alter table public.profiles enable row level security;

drop policy if exists "Users can read own profile" on public.profiles;
create policy "Users can read own profile"
  on public.profiles
  for select
  to authenticated
  using (auth.uid() = id);

drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can insert own profile"
  on public.profiles
  for insert
  to authenticated
  with check (auth.uid() = id);

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
  on public.profiles
  for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_plan text;
begin
  selected_plan := coalesce(
    nullif(new.raw_user_meta_data ->> 'subscription_plan', ''),
    nullif(new.raw_user_meta_data ->> 'plan', ''),
    'free'
  );

  if selected_plan not in ('free', 'paid') then
    selected_plan := 'free';
  end if;

  insert into public.profiles (
    id,
    full_name,
    email,
    subscription_plan,
    plan
  ) values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new.email,
    selected_plan,
    selected_plan
  )
  on conflict (id) do update
  set
    full_name = excluded.full_name,
    email = excluded.email,
    subscription_plan = excluded.subscription_plan,
    plan = excluded.plan,
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists create_profile_after_user_signup on auth.users;

create trigger create_profile_after_user_signup
after insert on auth.users
for each row
execute function public.create_profile_for_new_user();

insert into public.profiles (
  id,
  full_name,
  email,
  subscription_plan,
  plan
)
select
  users.id,
  coalesce(users.raw_user_meta_data ->> 'full_name', ''),
  users.email,
  'free',
  'free'
from auth.users
left join public.profiles on profiles.id = users.id
where profiles.id is null;
