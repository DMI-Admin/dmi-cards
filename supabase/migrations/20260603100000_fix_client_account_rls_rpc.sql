-- To inspect the live policy that blocked login, run:
-- select policyname, permissive, roles, cmd, qual, with_check
-- from pg_policies
-- where schemaname = 'public'
--   and tablename = 'client_users'
-- order by policyname;

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
  from auth.users as users
  where users.id = current_user_id
  on conflict (id) do update
  set
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

revoke all on function public.ensure_client_records_for_profile(uuid)
  from public, anon, authenticated;

revoke all on function public.ensure_current_client_account()
  from public, anon;

grant execute on function public.ensure_current_client_account()
  to authenticated;

alter table public.clients enable row level security;
alter table public.client_users enable row level security;

drop policy if exists "Users can read own client record" on public.clients;
create policy "Users can read own client record"
  on public.clients
  for select
  to authenticated
  using (auth.uid() = profile_id or auth.uid() = user_id);

drop policy if exists "Users can read own client user record" on public.client_users;
create policy "Users can read own client user record"
  on public.client_users
  for select
  to authenticated
  using (auth.uid() = profile_id or auth.uid() = user_id);

select public.ensure_client_records_for_profile(id)
from public.profiles;
