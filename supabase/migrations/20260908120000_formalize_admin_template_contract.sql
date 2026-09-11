alter table public.templates
  add column if not exists profile_image_allowed boolean not null default true,
  add column if not exists profile_image_default_enabled boolean not null default true,
  add column if not exists logo_allowed boolean not null default false,
  add column if not exists logo_default_enabled boolean not null default false,
  add column if not exists banner_allowed boolean not null default false,
  add column if not exists banner_default_enabled boolean not null default false,
  add column if not exists custom_colour_allowed boolean not null default false,
  add column if not exists custom_text_colour_allowed boolean not null default false,
  add column if not exists field_config jsonb not null default '{}'::jsonb,
  add column if not exists renderer_options jsonb not null default '{}'::jsonb,
  add column if not exists template_contract_version integer;

update public.templates
set
  profile_image_allowed = true,
  profile_image_default_enabled = coalesce(requires_profile_image, true),
  logo_allowed = coalesce(requires_logo, false),
  logo_default_enabled = coalesce(requires_logo, false),
  banner_allowed = coalesce(requires_banner, false),
  banner_default_enabled = coalesce(requires_banner, false),
  custom_colour_allowed = access_level = 'paid',
  custom_text_colour_allowed = access_level = 'paid',
  field_config = case
    when field_config = '{}'::jsonb then jsonb_build_object(
      'version',
      1,
      'allowed_fields',
      to_jsonb(coalesce(allowed_fields, '{}'::text[])),
      'sections',
      coalesce(custom_fields, '{}'::jsonb),
      'default_visibility',
      '{}'::jsonb,
      'required_fields',
      '[]'::jsonb
    )
    else field_config
  end,
  renderer_options = case
    when renderer_options = '{}'::jsonb then jsonb_build_object('version', 1)
    else renderer_options
  end,
  template_contract_version = 1
where template_contract_version is null;

comment on column public.templates.template_contract_version is
  'Admin template contract version. NULL means the row has not received the one-time compatibility backfill.';

comment on column public.templates.logo_default_enabled is
  'Admin template contract: whether customer/company logo rendering is enabled by default for new cards. Initial v1 backfill maps legacy requires_logo into allowed/default-enabled only to preserve existing behaviour; required, allowed and default_enabled remain separate concepts.';

comment on column public.templates.banner_default_enabled is
  'Admin template contract: whether company banner rendering is enabled by default for new cards. Initial v1 backfill maps legacy requires_banner into allowed/default-enabled only to preserve existing behaviour; required, allowed and default_enabled remain separate concepts.';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'templates_field_config_object_check'
      and conrelid = 'public.templates'::regclass
  ) then
    alter table public.templates
      add constraint templates_field_config_object_check
      check (jsonb_typeof(field_config) = 'object');
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'templates_renderer_options_object_check'
      and conrelid = 'public.templates'::regclass
  ) then
    alter table public.templates
      add constraint templates_renderer_options_object_check
      check (jsonb_typeof(renderer_options) = 'object');
  end if;
end
$$;

comment on column public.templates.profile_image_allowed is
  'Admin template contract: whether customer profile images are supported by this template.';

comment on column public.templates.profile_image_default_enabled is
  'Admin template contract: whether profile image collection/rendering is enabled by default for new cards.';

comment on column public.templates.logo_allowed is
  'Admin template contract: whether customer/company logos are supported by this template.';

comment on column public.templates.banner_allowed is
  'Admin template contract: whether company banner imagery is supported by this template.';

comment on column public.templates.custom_colour_allowed is
  'Admin template contract: whether custom card colours beyond the predefined palette are allowed.';

comment on column public.templates.custom_text_colour_allowed is
  'Admin template contract: whether custom text colours beyond the predefined palette are allowed.';

comment on column public.templates.field_config is
  'Admin template contract: versioned field sections, ordering, default visibility and required-field metadata.';

comment on column public.templates.renderer_options is
  'Admin template contract: versioned renderer-specific options consumed by layout implementations.';
