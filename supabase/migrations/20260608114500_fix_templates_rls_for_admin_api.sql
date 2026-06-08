alter table public.templates enable row level security;

drop policy if exists "Authenticated users can manage templates" on public.templates;
drop policy if exists "Anon can manage templates until server auth is wired" on public.templates;

drop policy if exists "Published templates are readable" on public.templates;
create policy "Published templates are readable"
  on public.templates
  for select
  to anon, authenticated
  using (status = 'published' or is_published = true);
