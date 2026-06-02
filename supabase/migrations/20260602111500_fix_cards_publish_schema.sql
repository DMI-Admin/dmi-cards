create extension if not exists pgcrypto;

create table if not exists public.cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete set null,
  template_id uuid references public.templates(id) on delete set null,
  card_name text not null default 'Primary Digital Card',
  slug text not null,
  is_published boolean not null default false,
  selected_colour text,
  full_name text,
  job_title text,
  department text,
  bio text,
  company_name text,
  email text,
  phone text,
  website text,
  address text,
  whatsapp text,
  linkedin text,
  instagram text,
  facebook text,
  youtube text,
  booking_link text,
  custom_url text,
  profile_image_url text,
  company_logo_url text,
  company_banner_url text,
  hidden_fields text[],
  field_order jsonb,
  lead_capture_settings jsonb,
  custom_fields jsonb not null default '{}'::jsonb,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.cards
  add column if not exists user_id uuid references auth.users(id) on delete cascade,
  add column if not exists profile_id uuid references public.profiles(id) on delete set null,
  add column if not exists template_id uuid references public.templates(id) on delete set null,
  add column if not exists card_name text not null default 'Primary Digital Card',
  add column if not exists slug text,
  add column if not exists is_published boolean not null default false,
  add column if not exists selected_colour text,
  add column if not exists full_name text,
  add column if not exists job_title text,
  add column if not exists department text,
  add column if not exists bio text,
  add column if not exists company_name text,
  add column if not exists email text,
  add column if not exists phone text,
  add column if not exists website text,
  add column if not exists address text,
  add column if not exists whatsapp text,
  add column if not exists linkedin text,
  add column if not exists instagram text,
  add column if not exists facebook text,
  add column if not exists youtube text,
  add column if not exists booking_link text,
  add column if not exists custom_url text,
  add column if not exists profile_image_url text,
  add column if not exists company_logo_url text,
  add column if not exists company_banner_url text,
  add column if not exists hidden_fields text[],
  add column if not exists field_order jsonb,
  add column if not exists lead_capture_settings jsonb,
  add column if not exists custom_fields jsonb not null default '{}'::jsonb,
  add column if not exists status text not null default 'draft',
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

update public.cards
set
  slug = coalesce(
    nullif(slug, ''),
    lower(regexp_replace(coalesce(full_name, card_name, id::text), '[^a-zA-Z0-9]+', '-', 'g'))
  ),
  custom_fields = coalesce(custom_fields, '{}'::jsonb),
  status = case when status = 'published' or is_published then 'published' else 'draft' end,
  is_published = case when status = 'published' or is_published then true else false end,
  updated_at = coalesce(updated_at, created_at, now()),
  created_at = coalesce(created_at, now())
where slug is null
   or slug = ''
   or custom_fields is null
   or status is null
   or status not in ('draft', 'published')
   or updated_at is null
   or created_at is null;

alter table public.cards
  alter column slug set not null,
  alter column custom_fields set default '{}'::jsonb,
  alter column custom_fields set not null,
  alter column status set default 'draft',
  alter column status set not null,
  alter column is_published set default false,
  alter column is_published set not null,
  alter column card_name set default 'Primary Digital Card',
  alter column card_name set not null,
  alter column created_at set default now(),
  alter column created_at set not null,
  alter column updated_at set default now(),
  alter column updated_at set not null;

alter table public.cards
  drop constraint if exists cards_status_check;

alter table public.cards
  add constraint cards_status_check
  check (status in ('draft', 'published'));

create unique index if not exists cards_slug_unique_idx
  on public.cards (slug);

create index if not exists cards_user_id_idx
  on public.cards (user_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists cards_set_updated_at on public.cards;

create trigger cards_set_updated_at
before update on public.cards
for each row
execute function public.set_updated_at();

alter table public.cards enable row level security;

drop policy if exists "Users can read own cards" on public.cards;
create policy "Users can read own cards"
  on public.cards
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Published cards are publicly readable" on public.cards;
create policy "Published cards are publicly readable"
  on public.cards
  for select
  to anon, authenticated
  using (status = 'published' or is_published = true);

drop policy if exists "Users can insert own cards" on public.cards;
create policy "Users can insert own cards"
  on public.cards
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own cards" on public.cards;
create policy "Users can update own cards"
  on public.cards
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own cards" on public.cards;
create policy "Users can delete own cards"
  on public.cards
  for delete
  to authenticated
  using (auth.uid() = user_id);
