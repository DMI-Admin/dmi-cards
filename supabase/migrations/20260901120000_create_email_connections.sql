create extension if not exists pgcrypto;

create table if not exists public.email_connections (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  provider_account_id text not null,
  provider_account_email text,
  display_name text,
  status text not null default 'connected',
  access_token_encrypted text,
  refresh_token_encrypted text,
  access_token_expires_at timestamptz,
  provider_scopes text[] not null default '{}',
  connected_at timestamptz not null default now(),
  last_refreshed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint email_connections_provider_check check (provider in ('gmail', 'outlook')),
  constraint email_connections_status_check check (
    status in ('connected', 'reconnect_required', 'revoked', 'error', 'disconnected')
  ),
  constraint email_connections_provider_account_id_length_check
    check (char_length(provider_account_id) between 1 and 255),
  constraint email_connections_provider_account_email_length_check
    check (provider_account_email is null or char_length(provider_account_email) <= 320),
  constraint email_connections_display_name_length_check
    check (display_name is null or char_length(display_name) <= 255),
  constraint email_connections_access_token_length_check
    check (access_token_encrypted is null or char_length(access_token_encrypted) <= 12000),
  constraint email_connections_refresh_token_length_check
    check (refresh_token_encrypted is null or char_length(refresh_token_encrypted) <= 12000)
);

create unique index if not exists email_connections_owner_provider_key
  on public.email_connections (owner_user_id, provider);

create unique index if not exists email_connections_owner_provider_account_key
  on public.email_connections (owner_user_id, provider, provider_account_id);

create index if not exists email_connections_owner_status_idx
  on public.email_connections (owner_user_id, status);

create index if not exists email_connections_provider_account_idx
  on public.email_connections (provider, provider_account_id);

create or replace function public.set_email_connections_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists email_connections_set_updated_at on public.email_connections;

create trigger email_connections_set_updated_at
before update on public.email_connections
for each row
execute function public.set_email_connections_updated_at();

alter table public.email_connections enable row level security;

drop policy if exists "Users can read own email connections" on public.email_connections;
create policy "Users can read own email connections"
  on public.email_connections
  for select
  to authenticated
  using (auth.uid() = owner_user_id);

drop policy if exists "Users can insert own email connections" on public.email_connections;
create policy "Users can insert own email connections"
  on public.email_connections
  for insert
  to authenticated
  with check (auth.uid() = owner_user_id);

drop policy if exists "Users can update own email connections" on public.email_connections;
create policy "Users can update own email connections"
  on public.email_connections
  for update
  to authenticated
  using (auth.uid() = owner_user_id)
  with check (auth.uid() = owner_user_id);

drop policy if exists "Users can delete own email connections" on public.email_connections;
create policy "Users can delete own email connections"
  on public.email_connections
  for delete
  to authenticated
  using (auth.uid() = owner_user_id);

revoke all on table public.email_connections from public;
revoke all on table public.email_connections from anon;
revoke all on table public.email_connections from authenticated;
grant select, insert, update, delete on table public.email_connections to service_role;

revoke all on function public.set_email_connections_updated_at() from public;
revoke all on function public.set_email_connections_updated_at() from anon;
revoke all on function public.set_email_connections_updated_at() from authenticated;
