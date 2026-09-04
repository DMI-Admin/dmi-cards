create or replace function private.enforce_contact_card_attribution()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  current_user_id uuid;
  persisted_card_slot smallint;
  persisted_owner_user_id uuid;
  public_lead_capture_enabled boolean;
begin
  current_user_id := auth.uid();
  public_lead_capture_enabled :=
    coalesce(current_setting('dmi.public_lead_capture', true), '') = 'on';

  if current_user_id is null and public_lead_capture_enabled then
    if TG_OP = 'UPDATE' then
      if new.owner_user_id is distinct from old.owner_user_id
        or new.card_id is distinct from old.card_id
        or new.card_slot is distinct from old.card_slot
        or new.source is distinct from old.source
        or new.status is distinct from old.status then
        raise exception 'CONTACT_PUBLIC_LEAD_SECURITY_FIELDS_IMMUTABLE: public lead updates cannot change contact attribution or status'
          using errcode = '42501';
      end if;

      return new;
    end if;

    if new.owner_user_id is null or new.card_id is null then
      raise exception 'CONTACT_PUBLIC_LEAD_ATTRIBUTION_REQUIRED: public lead contacts require card attribution'
        using errcode = '42501';
    end if;

    select user_id, card_slot
    into persisted_owner_user_id, persisted_card_slot
    from public.cards
    where id = new.card_id
      and (status = 'published' or is_published is true);

    if not found or persisted_owner_user_id is null then
      raise exception 'CONTACT_PUBLIC_LEAD_CARD_INVALID: public lead card attribution is invalid'
        using errcode = '42501';
    end if;

    if new.owner_user_id is distinct from persisted_owner_user_id then
      raise exception 'CONTACT_PUBLIC_LEAD_OWNER_MISMATCH: public lead owner attribution is invalid'
        using errcode = '42501';
    end if;

    new.card_slot = persisted_card_slot;
    return new;
  end if;

  if current_user_id is null then
    raise exception 'CONTACT_OWNER_REQUIRED: authenticated user is required'
      using errcode = '42501';
  end if;

  if new.owner_user_id is distinct from current_user_id then
    raise exception 'CONTACT_OWNER_MISMATCH: contacts must belong to the authenticated user'
      using errcode = '42501';
  end if;

  if new.card_id is null then
    return new;
  end if;

  select card_slot
  into persisted_card_slot
  from public.cards
  where id = new.card_id
    and user_id = current_user_id;

  if not found then
    raise exception 'CONTACT_CARD_NOT_OWNED: contact card attribution is invalid'
      using errcode = '42501';
  end if;

  new.card_slot = persisted_card_slot;
  return new;
end;
$$;

revoke all on function private.enforce_contact_card_attribution() from public;
revoke all on function private.enforce_contact_card_attribution() from anon;
revoke all on function private.enforce_contact_card_attribution() from authenticated;

create index if not exists contacts_owner_user_id_normalized_email_idx
  on public.contacts (owner_user_id, lower(btrim(email)))
  where email is not null and btrim(email) <> '';

create index if not exists contacts_owner_user_id_normalized_phone_idx
  on public.contacts (
    owner_user_id,
    regexp_replace(btrim(phone), '[[:space:]]+', '', 'g')
  )
  where phone is not null and btrim(phone) <> '';

create or replace function public.create_public_card_lead_v2(
  p_card_slug text,
  p_name text default null,
  p_email text default null,
  p_phone text default null,
  p_company text default null,
  p_job_title text default null,
  p_website text default null,
  p_message text default null,
  p_consent_given boolean default null,
  p_consent_notice text default null,
  p_terms_url text default null,
  p_submitted_at timestamptz default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  clean_slug text;
  clean_name text;
  clean_email text;
  clean_phone text;
  clean_phone_key text;
  clean_company text;
  clean_job_title text;
  clean_website text;
  clean_message text;
  clean_consent_notice text;
  clean_terms_url text;
  clean_metadata jsonb;
  submitted_at_value timestamptz;
  resolved_card_id uuid;
  resolved_owner_user_id uuid;
  resolved_card_slot smallint;
  existing_contact_id uuid;
  existing_metadata jsonb;
  repeat_count integer;
  inserted_contact_id uuid;
begin
  clean_slug := btrim(coalesce(p_card_slug, ''));
  if clean_slug !~ '^[A-Za-z0-9-]{1,120}$' then
    raise exception 'PUBLIC_LEAD_CARD_SLUG_INVALID'
      using errcode = '22023';
  end if;

  clean_name := nullif(btrim(coalesce(p_name, '')), '');
  clean_email := lower(nullif(btrim(coalesce(p_email, '')), ''));
  clean_phone := nullif(btrim(coalesce(p_phone, '')), '');
  clean_phone_key := nullif(regexp_replace(coalesce(clean_phone, ''), '[[:space:]]+', '', 'g'), '');
  clean_company := nullif(btrim(coalesce(p_company, '')), '');
  clean_job_title := nullif(btrim(coalesce(p_job_title, '')), '');
  clean_website := nullif(btrim(coalesce(p_website, '')), '');
  clean_message := nullif(btrim(coalesce(p_message, '')), '');
  clean_consent_notice := nullif(btrim(coalesce(p_consent_notice, '')), '');
  clean_terms_url := nullif(btrim(coalesce(p_terms_url, '')), '');
  clean_metadata := coalesce(p_metadata, '{}'::jsonb);
  submitted_at_value := coalesce(p_submitted_at, now());

  if jsonb_typeof(clean_metadata) <> 'object' then
    raise exception 'PUBLIC_LEAD_METADATA_INVALID'
      using errcode = '22023';
  end if;

  if octet_length(clean_metadata::text) > 8000 then
    raise exception 'PUBLIC_LEAD_METADATA_TOO_LARGE'
      using errcode = '22023';
  end if;

  if clean_name is null
    and clean_email is null
    and clean_phone is null
    and clean_company is null
    and clean_job_title is null
    and clean_website is null
    and clean_message is null then
    raise exception 'PUBLIC_LEAD_EMPTY'
      using errcode = '22023';
  end if;

  if length(coalesce(clean_name, '')) > 180
    or length(coalesce(clean_email, '')) > 254
    or length(coalesce(clean_phone, '')) > 60
    or length(coalesce(clean_company, '')) > 180
    or length(coalesce(clean_job_title, '')) > 180
    or length(coalesce(clean_website, '')) > 2048
    or length(coalesce(clean_message, '')) > 2000
    or length(coalesce(clean_consent_notice, '')) > 1000
    or length(coalesce(clean_terms_url, '')) > 2048 then
    raise exception 'PUBLIC_LEAD_FIELD_TOO_LONG'
      using errcode = '22023';
  end if;

  if clean_email is not null
    and clean_email !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception 'PUBLIC_LEAD_EMAIL_INVALID'
      using errcode = '22023';
  end if;

  if clean_website is not null
    and clean_website !~* '^https?://' then
    raise exception 'PUBLIC_LEAD_WEBSITE_INVALID'
      using errcode = '22023';
  end if;

  if clean_terms_url is not null
    and clean_terms_url !~* '^https?://' then
    raise exception 'PUBLIC_LEAD_TERMS_URL_INVALID'
      using errcode = '22023';
  end if;

  select id, user_id, card_slot
  into resolved_card_id, resolved_owner_user_id, resolved_card_slot
  from public.cards
  where slug = clean_slug
    and (status = 'published' or is_published is true)
  limit 1;

  if not found then
    raise exception 'PUBLIC_LEAD_CARD_NOT_FOUND'
      using errcode = 'P0002';
  end if;

  if resolved_owner_user_id is null then
    raise exception 'PUBLIC_LEAD_CARD_OWNER_REQUIRED'
      using errcode = '23502';
  end if;

  if clean_email is not null then
    select id, metadata
    into existing_contact_id, existing_metadata
    from public.contacts
    where owner_user_id = resolved_owner_user_id
      and email is not null
      and lower(btrim(email)) = clean_email
    order by created_at asc, id asc
    limit 1;
  end if;

  if existing_contact_id is null and clean_phone_key is not null then
    select id, metadata
    into existing_contact_id, existing_metadata
    from public.contacts
    where owner_user_id = resolved_owner_user_id
      and phone is not null
      and regexp_replace(btrim(phone), '[[:space:]]+', '', 'g') = clean_phone_key
    order by created_at asc, id asc
    limit 1;
  end if;

  if existing_contact_id is not null then
    repeat_count := case
      when coalesce(existing_metadata #>> '{public_lead_capture,repeat_count}', '') ~ '^[0-9]+$'
        then (existing_metadata #>> '{public_lead_capture,repeat_count}')::integer + 1
      when coalesce(existing_metadata #>> '{public_lead_capture,submission_count}', '') ~ '^[0-9]+$'
        then (existing_metadata #>> '{public_lead_capture,submission_count}')::integer + 1
      else 2
    end;

    perform set_config('dmi.public_lead_capture', 'on', true);

    update public.contacts
    set
      submitted_at = submitted_at_value,
      consent_given = p_consent_given,
      consent_notice = clean_consent_notice,
      terms_url = clean_terms_url,
      metadata =
        coalesce(metadata, '{}'::jsonb) ||
        clean_metadata ||
        jsonb_build_object(
          'public_lead_capture',
          jsonb_build_object(
            'last_submitted_at', submitted_at_value,
            'last_card_id', resolved_card_id,
            'last_card_slug', clean_slug,
            'last_card_slot', resolved_card_slot,
            'repeat_count', repeat_count
          )
        )
    where id = existing_contact_id;

    perform set_config('dmi.public_lead_capture', 'off', true);

    return jsonb_build_object(
      'contact_id', existing_contact_id,
      'created', false
    );
  end if;

  perform set_config('dmi.public_lead_capture', 'on', true);

  insert into public.contacts (
    owner_user_id,
    card_id,
    card_slot,
    source,
    status,
    name,
    email,
    phone,
    company,
    job_title,
    website,
    message,
    consent_given,
    consent_notice,
    terms_url,
    submitted_at,
    metadata
  )
  values (
    resolved_owner_user_id,
    resolved_card_id,
    resolved_card_slot,
    'digital_card',
    'new',
    clean_name,
    clean_email,
    clean_phone,
    clean_company,
    clean_job_title,
    clean_website,
    clean_message,
    p_consent_given,
    clean_consent_notice,
    clean_terms_url,
    submitted_at_value,
    clean_metadata ||
      jsonb_build_object(
        'public_lead_capture',
        jsonb_build_object(
          'first_submitted_at', submitted_at_value,
          'last_submitted_at', submitted_at_value,
          'last_card_id', resolved_card_id,
          'last_card_slug', clean_slug,
          'last_card_slot', resolved_card_slot,
          'submission_count', 1,
          'repeat_count', 1
        )
      )
  )
  returning id into inserted_contact_id;

  perform set_config('dmi.public_lead_capture', 'off', true);

  return jsonb_build_object(
    'contact_id', inserted_contact_id,
    'created', true
  );
exception
  when others then
    perform set_config('dmi.public_lead_capture', 'off', true);
    raise;
end;
$$;

revoke all on function public.create_public_card_lead_v2(
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  boolean,
  text,
  text,
  timestamptz,
  jsonb
) from public;
revoke all on function public.create_public_card_lead_v2(
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  boolean,
  text,
  text,
  timestamptz,
  jsonb
) from anon;
revoke all on function public.create_public_card_lead_v2(
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  boolean,
  text,
  text,
  timestamptz,
  jsonb
) from authenticated;
grant execute on function public.create_public_card_lead_v2(
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  boolean,
  text,
  text,
  timestamptz,
  jsonb
) to service_role;
