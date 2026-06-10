alter table public.templates
  add column if not exists text_colours jsonb not null default '[]'::jsonb;

alter table public.cards
  add column if not exists selected_text_colour text;

update public.templates
set text_colours = '[]'::jsonb
where text_colours is null;
