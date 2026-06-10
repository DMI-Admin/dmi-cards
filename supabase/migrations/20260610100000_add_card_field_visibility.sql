alter table public.cards
  add column if not exists field_visibility jsonb not null default '{}'::jsonb;

update public.cards
set field_visibility = '{}'::jsonb
where field_visibility is null;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'cards'
      and column_name = 'hidden_fields'
  ) then
    execute $sql$
      update public.cards
      set field_visibility = coalesce(field_visibility, '{}'::jsonb) ||
        coalesce(
          (
            select jsonb_object_agg(hidden_field, false)
            from unnest(hidden_fields) as hidden_field
          ),
          '{}'::jsonb
        )
      where hidden_fields is not null
    $sql$;
  end if;
end $$;
