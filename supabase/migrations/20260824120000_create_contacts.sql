create extension if not exists pgcrypto;

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  card_id uuid null references public.cards(id) on delete set null,
  card_slot smallint null,
  source text not null default 'manual',
  name text,
  first_name text,
  last_name text,
  email text,
  phone text,
  mobile text,
  company text,
  job_title text,
  website text,
  address text,
  message text,
  notes text,
  tags text[] not null default '{}',
  status text not null default 'new',
  consent_given boolean,
  consent_notice text,
  terms_url text,
  submitted_at timestamptz,
  crm_status text,
  crm_provider text,
  crm_external_id text,
  crm_last_synced_at timestamptz,
  crm_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contacts_card_slot_check check (card_slot is null or card_slot in (1, 2, 3)),
  constraint contacts_source_check check (
    source in ('digital_card', 'business_card_scan', 'manual', 'import', 'integration')
  ),
  constraint contacts_status_check check (
    status in ('new', 'contacted', 'qualified', 'archived')
  ),
  constraint contacts_metadata_object_check check (jsonb_typeof(metadata) = 'object')
);

create index if not exists contacts_owner_user_id_created_at_idx
  on public.contacts (owner_user_id, created_at desc);

create index if not exists contacts_owner_user_id_source_idx
  on public.contacts (owner_user_id, source);

create index if not exists contacts_owner_user_id_status_idx
  on public.contacts (owner_user_id, status);

create index if not exists contacts_owner_user_id_card_id_idx
  on public.contacts (owner_user_id, card_id)
  where card_id is not null;

create index if not exists contacts_owner_user_id_card_slot_idx
  on public.contacts (owner_user_id, card_slot)
  where card_slot is not null;

create index if not exists contacts_owner_user_id_submitted_at_idx
  on public.contacts (owner_user_id, submitted_at desc)
  where submitted_at is not null;

create or replace function public.set_contacts_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists contacts_set_updated_at on public.contacts;

create trigger contacts_set_updated_at
before update on public.contacts
for each row
execute function public.set_contacts_updated_at();

alter table public.contacts enable row level security;

drop policy if exists "Users can read own contacts" on public.contacts;
create policy "Users can read own contacts"
  on public.contacts
  for select
  to authenticated
  using (auth.uid() = owner_user_id);

drop policy if exists "Users can insert own contacts" on public.contacts;
create policy "Users can insert own contacts"
  on public.contacts
  for insert
  to authenticated
  with check (auth.uid() = owner_user_id);

drop policy if exists "Users can update own contacts" on public.contacts;
create policy "Users can update own contacts"
  on public.contacts
  for update
  to authenticated
  using (auth.uid() = owner_user_id)
  with check (auth.uid() = owner_user_id);

drop policy if exists "Users can delete own contacts" on public.contacts;
create policy "Users can delete own contacts"
  on public.contacts
  for delete
  to authenticated
  using (auth.uid() = owner_user_id);
