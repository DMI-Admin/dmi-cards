alter table public.cards
  add column if not exists action_config jsonb;

alter table public.templates
  add column if not exists allowed_actions jsonb;

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

comment on column public.cards.action_config is
  'Optional per-card visitor action presentation config. Existing scalar fields remain the destination source of truth.';

comment on column public.templates.allowed_actions is
  'Optional template-level visitor action permissions and new-card defaults. NULL means use legacy derivation.';
