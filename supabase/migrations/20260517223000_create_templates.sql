create extension if not exists pgcrypto;

create table if not exists public.templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  layout_type text not null default 'classic_free',
  access_level text not null default 'free' check (access_level in ('free', 'paid')),
  logo_size text default 'standard',
  requires_profile_image boolean not null default true,
  requires_logo boolean not null default false,
  requires_banner boolean not null default false,
  gradient_enabled boolean not null default false,
  free_colour_palette text[],
  allowed_fonts text[],
  default_font text,
  supports_bio boolean not null default true,
  supports_save_contact boolean not null default true,
  allowed_fields text[] not null default '{}',
  primary_color text,
  secondary_color text,
  text_color text,
  button_color text,
  button_text_color text,
  custom_fields jsonb not null default '{}'::jsonb,
  show_personal_section boolean not null default true,
  show_company_section boolean not null default true,
  show_contact_section boolean not null default true,
  show_social_section boolean not null default false,
  is_published boolean not null default false,
  usage_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists templates_published_access_idx
  on public.templates (is_published, access_level);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists templates_set_updated_at on public.templates;

create trigger templates_set_updated_at
before update on public.templates
for each row
execute function public.set_updated_at();

alter table public.templates enable row level security;

drop policy if exists "Published templates are readable" on public.templates;
create policy "Published templates are readable"
  on public.templates
  for select
  using (is_published = true);

drop policy if exists "Authenticated users can manage templates" on public.templates;
create policy "Authenticated users can manage templates"
  on public.templates
  for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "Anon can manage templates until server auth is wired" on public.templates;
create policy "Anon can manage templates until server auth is wired"
  on public.templates
  for all
  to anon
  using (true)
  with check (true);

insert into public.templates (
  name,
  slug,
  layout_type,
  access_level,
  requires_profile_image,
  requires_logo,
  requires_banner,
  gradient_enabled,
  free_colour_palette,
  allowed_fonts,
  default_font,
  supports_bio,
  supports_save_contact,
  allowed_fields,
  primary_color,
  secondary_color,
  text_color,
  button_color,
  button_text_color,
  custom_fields,
  show_personal_section,
  show_company_section,
  show_contact_section,
  show_social_section,
  is_published,
  usage_count
) values (
  'Free Classic',
  'free-classic',
  'classic_free',
  'free',
  true,
  false,
  false,
  false,
  array['#AC00FF', '#7C3AED', '#2563EB', '#059669', '#DC2626', '#101935'],
  array['Inter'],
  'Inter',
  true,
  true,
  array[
    'full_name',
    'job_title',
    'bio',
    'department',
    'company_name',
    'website',
    'address',
    'email',
    'phone'
  ],
  '#AC00FF',
  '#101935',
  '#FFFFFF',
  '#FFFFFF',
  '#0F0E38',
  '{
    "personal": ["job_title", "bio", "department"],
    "company": ["company_name", "website", "address"],
    "contact": ["email", "phone", "website"],
    "social": ["whatsapp", "linkedin", "instagram", "facebook", "youtube", "booking_link", "custom_url"]
  }'::jsonb,
  true,
  true,
  true,
  false,
  true,
  0
)
on conflict (slug) do nothing;
