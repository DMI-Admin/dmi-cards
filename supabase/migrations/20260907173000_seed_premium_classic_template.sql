alter table public.templates
  add column if not exists requires_banner boolean not null default false,
  add column if not exists gradient_enabled boolean not null default false,
  add column if not exists text_colours jsonb not null default '[]'::jsonb,
  add column if not exists allowed_actions jsonb;

do $$
declare
  colour_palette_type text;
  free_colour_palette_type text;
  text_colours_type text;
  allowed_fonts_type text;
  colour_palette_expr text;
  free_colour_palette_expr text;
  text_colours_expr text;
  allowed_fonts_expr text;
begin
  select format_type(atttypid, atttypmod)
    into colour_palette_type
  from pg_attribute
  where attrelid = 'public.templates'::regclass
    and attname = 'colour_palette'
    and not attisdropped;

  select format_type(atttypid, atttypmod)
    into free_colour_palette_type
  from pg_attribute
  where attrelid = 'public.templates'::regclass
    and attname = 'free_colour_palette'
    and not attisdropped;

  select format_type(atttypid, atttypmod)
    into text_colours_type
  from pg_attribute
  where attrelid = 'public.templates'::regclass
    and attname = 'text_colours'
    and not attisdropped;

  select format_type(atttypid, atttypmod)
    into allowed_fonts_type
  from pg_attribute
  where attrelid = 'public.templates'::regclass
    and attname = 'allowed_fonts'
    and not attisdropped;

  colour_palette_expr := case
    when colour_palette_type = 'jsonb' then '$1::jsonb'
    when colour_palette_type = 'json' then '$1::json'
    when colour_palette_type = 'text[]' then '$2::text[]'
    else '$3::text'
  end;

  free_colour_palette_expr := case
    when free_colour_palette_type = 'jsonb' then '$1::jsonb'
    when free_colour_palette_type = 'json' then '$1::json'
    when free_colour_palette_type = 'text[]' then '$2::text[]'
    else '$3::text'
  end;

  text_colours_expr := case
    when text_colours_type = 'jsonb' then '$4::jsonb'
    when text_colours_type = 'json' then '$4::json'
    when text_colours_type = 'text[]' then '$5::text[]'
    else '$6::text'
  end;

  allowed_fonts_expr := case
    when allowed_fonts_type = 'jsonb' then '$7::jsonb'
    when allowed_fonts_type = 'json' then '$7::json'
    when allowed_fonts_type = 'text[]' then '$8::text[]'
    else '$9::text'
  end;

  execute format($sql$
    insert into public.templates (
      name,
      slug,
      layout_type,
      access_level,
      status,
      logo_size,
      requires_profile_image,
      requires_logo,
      requires_banner,
      gradient_enabled,
      colour_palette,
      free_colour_palette,
      text_colours,
      allowed_fonts,
      default_font,
      supports_bio,
      supports_save_contact,
      allowed_fields,
      allowed_actions,
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
      'Premium Classic',
      'premium-classic',
      'premium_classic',
      'paid',
      'published',
      'standard',
      true,
      true,
      true,
      true,
      %s,
      %s,
      %s,
      %s,
      null,
      true,
      true,
      array[
        'title',
        'first_name',
        'last_name',
        'job_title',
        'department',
        'bio',
        'company_name',
        'website',
        'address',
        'email',
        'phone'
      ],
      '{
        "version": 1,
        "actions": [
          { "type": "save_contact", "enabled": true, "default_visible": true },
          { "type": "call", "enabled": true, "default_visible": false },
          { "type": "email", "enabled": true, "default_visible": false },
          { "type": "whatsapp", "enabled": true, "default_visible": false },
          { "type": "book_meeting", "enabled": true, "default_visible": false },
          { "type": "custom_link", "enabled": true, "default_visible": false, "default_label": "Custom Link" },
          { "type": "download_pdf", "enabled": true, "default_visible": false, "default_label": "Download PDF" },
          { "type": "linkedin", "enabled": true, "default_visible": false },
          { "type": "instagram", "enabled": true, "default_visible": false },
          { "type": "facebook", "enabled": true, "default_visible": false },
          { "type": "youtube", "enabled": true, "default_visible": false }
        ]
      }'::jsonb,
      '#AC00FF',
      '#101935',
      '#FFFFFF',
      '#FFFFFF',
      '#0F0E38',
      '{
        "personal": ["job_title", "department", "bio"],
        "company": ["company_name", "website", "address"],
        "contact": ["email", "phone"],
        "social": []
      }'::jsonb,
      true,
      true,
      true,
      false,
      true,
      0
    )
    on conflict (slug) do update
    set
      name = excluded.name,
      layout_type = excluded.layout_type,
      access_level = excluded.access_level,
      status = excluded.status,
      logo_size = excluded.logo_size,
      requires_profile_image = excluded.requires_profile_image,
      requires_logo = excluded.requires_logo,
      requires_banner = excluded.requires_banner,
      gradient_enabled = excluded.gradient_enabled,
      colour_palette = excluded.colour_palette,
      free_colour_palette = excluded.free_colour_palette,
      text_colours = excluded.text_colours,
      allowed_fonts = excluded.allowed_fonts,
      default_font = excluded.default_font,
      supports_bio = excluded.supports_bio,
      supports_save_contact = excluded.supports_save_contact,
      allowed_fields = excluded.allowed_fields,
      allowed_actions = excluded.allowed_actions,
      primary_color = excluded.primary_color,
      secondary_color = excluded.secondary_color,
      text_color = excluded.text_color,
      button_color = excluded.button_color,
      button_text_color = excluded.button_text_color,
      custom_fields = excluded.custom_fields,
      show_personal_section = excluded.show_personal_section,
      show_company_section = excluded.show_company_section,
      show_contact_section = excluded.show_contact_section,
      show_social_section = excluded.show_social_section,
      is_published = excluded.is_published
  $sql$, colour_palette_expr, free_colour_palette_expr, text_colours_expr, allowed_fonts_expr)
  using
    '["#AC00FF", "#101935"]'::jsonb,
    array['#AC00FF', '#101935'],
    '["#AC00FF", "#101935"]',
    '["#FFFFFF", "#0F172A"]'::jsonb,
    array['#FFFFFF', '#0F172A'],
    '["#FFFFFF", "#0F172A"]',
    '["Inter", "Poppins", "Montserrat", "Lato", "Roboto", "Playfair Display", "DM Sans", "Outfit", "Nunito", "Space Mono", "Syne"]'::jsonb,
    array[
      'Inter',
      'Poppins',
      'Montserrat',
      'Lato',
      'Roboto',
      'Playfair Display',
      'DM Sans',
      'Outfit',
      'Nunito',
      'Space Mono',
      'Syne'
    ],
    '["Inter", "Poppins", "Montserrat", "Lato", "Roboto", "Playfair Display", "DM Sans", "Outfit", "Nunito", "Space Mono", "Syne"]';
end
$$;
