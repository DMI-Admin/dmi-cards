-- Additive only: no table grant/policy changes and no existing-row updates.
-- Server validates template/entitlement; this bounded RPC enforces allocation.
create function public.create_client_card_atomic(
  p_owner_user_id uuid,
  p_card_allowance smallint,
  p_card_payload jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  result public.cards%rowtype;
begin
  if p_owner_user_id is null or p_card_allowance is null or p_card_allowance not in (1, 3)
     or p_card_payload is null or jsonb_typeof(p_card_payload) <> 'object'
     or octet_length(p_card_payload::text) > 262144 then
    raise exception 'INVALID_CARD_CREATION_INPUT' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_object_keys(p_card_payload) as k(key)
    where key <> all(array['template_id', 'card_name', 'slug', 'full_name', 'title', 'first_name', 'last_name', 'job_title', 'company_name', 'email', 'phone', 'website', 'address', 'whatsapp', 'linkedin', 'instagram', 'facebook', 'youtube', 'booking_link', 'custom_url', 'profile_image_url', 'company_logo_url', 'selected_colour', 'selected_text_colour', 'field_order', 'field_visibility', 'custom_fields', 'action_config', 'lead_capture_settings', 'hidden_fields', 'status', 'is_published'])) then
    raise exception 'UNSUPPORTED_CARD_PAYLOAD_FIELD' using errcode = '22023';
  end if;
  if nullif(btrim(p_card_payload->>'card_name'), '') is null
     or nullif(btrim(p_card_payload->>'full_name'), '') is null
     or nullif(btrim(p_card_payload->>'slug'), '') is null
     or nullif(p_card_payload->>'template_id', '') is null
     or (p_card_payload->>'status') is null
     or (p_card_payload->>'status') not in ('published', 'draft')
     or jsonb_typeof(p_card_payload->'is_published') is distinct from 'boolean'
     or ((p_card_payload->>'is_published')::boolean is distinct from ((p_card_payload->>'status') = 'published')) then
    raise exception 'INVALID_CARD_PAYLOAD' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended('public.cards.card_slot:' || p_owner_user_id::text, 0)
  );
  if (select count(*) from public.cards where user_id = p_owner_user_id) >= p_card_allowance then
    raise exception 'CARD_ALLOWANCE_EXHAUSTED' using errcode = 'P0001';
  end if;
  -- Omit card_slot: assign_card_slot() reuses this transaction lock and allocates.
  -- No profile_id: it is absent from the verified live cards contract.
  insert into public.cards (user_id, template_id, card_name, slug, full_name, title, first_name, last_name, job_title, company_name, email, phone, website, address, whatsapp, linkedin, instagram, facebook, youtube, booking_link, custom_url, profile_image_url, company_logo_url, selected_colour, selected_text_colour, field_order, field_visibility, custom_fields, action_config, lead_capture_settings, hidden_fields, status, is_published)
  select p_owner_user_id, v.template_id, v.card_name, v.slug, v.full_name, v.title, v.first_name, v.last_name, v.job_title, v.company_name, v.email, v.phone, v.website, v.address, v.whatsapp, v.linkedin, v.instagram, v.facebook, v.youtube, v.booking_link, v.custom_url, v.profile_image_url, v.company_logo_url, v.selected_colour, v.selected_text_colour, v.field_order, v.field_visibility, v.custom_fields, v.action_config, v.lead_capture_settings, v.hidden_fields, v.status, v.is_published
  from jsonb_to_record(p_card_payload) as v(template_id uuid, card_name text, slug text, full_name text, title text, first_name text, last_name text, job_title text, company_name text, email text, phone text, website text, address text, whatsapp text, linkedin text, instagram text, facebook text, youtube text, booking_link text, custom_url text, profile_image_url text, company_logo_url text, selected_colour text, selected_text_colour text, field_order jsonb, field_visibility jsonb, custom_fields jsonb, action_config jsonb, lead_capture_settings jsonb, hidden_fields text[], status text, is_published boolean)
  returning * into result;
  return to_jsonb(result);
end;
$$;
revoke all on function public.create_client_card_atomic(uuid, smallint, jsonb)
  from public, anon, authenticated;
grant execute on function public.create_client_card_atomic(uuid, smallint, jsonb)
  to service_role;
