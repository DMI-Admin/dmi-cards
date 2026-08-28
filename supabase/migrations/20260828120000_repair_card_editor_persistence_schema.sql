alter table public.cards
  add column if not exists field_visibility jsonb not null default '{}'::jsonb,
  add column if not exists field_order jsonb,
  add column if not exists hidden_fields text[],
  add column if not exists lead_capture_settings jsonb,
  add column if not exists action_config jsonb;

alter table public.templates
  add column if not exists allowed_actions jsonb;

update public.cards
set field_visibility = '{}'::jsonb
where field_visibility is null;

alter table public.cards
  alter column field_visibility set default '{}'::jsonb,
  alter column field_visibility set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'cards_field_visibility_object_check'
      and conrelid = 'public.cards'::regclass
  ) then
    alter table public.cards
      add constraint cards_field_visibility_object_check
      check (jsonb_typeof(field_visibility) = 'object');
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'cards_field_order_object_check'
      and conrelid = 'public.cards'::regclass
  ) then
    alter table public.cards
      add constraint cards_field_order_object_check
      check (field_order is null or jsonb_typeof(field_order) = 'object');
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'cards_lead_capture_settings_object_check'
      and conrelid = 'public.cards'::regclass
  ) then
    alter table public.cards
      add constraint cards_lead_capture_settings_object_check
      check (
        lead_capture_settings is null
        or jsonb_typeof(lead_capture_settings) = 'object'
      );
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'cards_action_config_object_check'
      and conrelid = 'public.cards'::regclass
  ) then
    alter table public.cards
      add constraint cards_action_config_object_check
      check (action_config is null or jsonb_typeof(action_config) = 'object');
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'templates_allowed_actions_object_check'
      and conrelid = 'public.templates'::regclass
  ) then
    alter table public.templates
      add constraint templates_allowed_actions_object_check
      check (allowed_actions is null or jsonb_typeof(allowed_actions) = 'object');
  end if;
end
$$;

comment on column public.cards.field_visibility is
  'Per-field visibility map used by the client card editor.';

comment on column public.cards.field_order is
  'Per-card ordered field groups used by the client card editor and public renderer.';

comment on column public.cards.hidden_fields is
  'Legacy hidden field list retained for compatibility with existing card visibility code.';

comment on column public.cards.lead_capture_settings is
  'Per-card lead capture settings used by setup and publishing flows.';

comment on column public.cards.action_config is
  'Optional per-card visitor action presentation config. Existing scalar fields remain the destination source of truth.';

comment on column public.templates.allowed_actions is
  'Optional template-level visitor action permissions and new-card defaults. NULL means use legacy derivation.';
