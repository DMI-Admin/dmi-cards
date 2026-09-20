-- Preparation only. Review and test in isolated staging before any rollout.
-- Depends on Stage A + card_media_owner_exists correction + unchanged atomic create.
-- No Storage operations, card backfill, RLS/policy/grant changes to existing tables.
begin;
do $$
begin
  if to_regprocedure('public.card_media_owner_exists(uuid)') is null
     or to_regprocedure('public.create_client_card_atomic(uuid,smallint,jsonb)') is null then
    raise exception 'MEDIA_FINALIZATION_PREREQUISITES_MISSING';
  end if;
  if not has_function_privilege('service_role','public.card_media_owner_exists(uuid)','EXECUTE') then
    raise exception 'MEDIA_OWNER_HELPER_PERMISSION_MISSING';
  end if;
end;
$$;

alter table public.card_media_sessions
  add column finalization_digest text,
  add column finalized_operation text,
  -- Tombstone: deliberately no FK; response-loss retries cannot recreate deleted cards.
  add column finalized_card_id uuid,
  add column finalization_result jsonb,
  add column finalized_at timestamptz,
  add constraint card_media_finalization_receipt_check check (
    (finalization_digest is null and finalized_operation is null and finalized_card_id is null
      and finalization_result is null and finalized_at is null)
    or
    (finalization_digest is not null and finalization_digest ~ '^[0-9a-f]{64}$'
      and finalized_operation is not null and finalized_operation in ('create','edit')
      and finalized_card_id is not null and finalization_result is not null
      and jsonb_typeof(finalization_result)='object'
      and octet_length(finalization_result::text)<=2048 and finalized_at is not null
      and state='attached')
  );

-- Trusted server only: authenticate owner, resolve allowance and validate the FULL
-- template/card contract BEFORE calling. This RPC is not a replacement validator.
-- Media is represented exclusively by exactly three intents:
-- {"profile":{"operation":"remove"},"logo":{"operation":"retain"},
--  "banner":{"operation":"replace","asset_id":"<ready asset UUID>"}}
-- Remove media keys from the validated payload before passing it here. SQL supplies
-- the final references. Retain reads the owned card; replace accepts this session only.
-- Every logical save has a fresh pending session. Retries reuse the SAME session.
create function public.finalize_client_card_media(
  p_owner uuid, p_session uuid, p_operation text, p_card_id uuid,
  p_allowance smallint, p_validated_payload jsonb, p_asset_receipts jsonb,
  p_expected_card_revision text
) returns jsonb language plpgsql security invoker set search_path = pg_catalog as $$
declare
  s public.card_media_sessions;
  a public.card_media_assets;
  original public.cards;
  saved public.cards;
  payload jsonb := p_validated_payload;
  digest text; revision text; result jsonb; intent jsonb;
  v_kind text; action text; old_ref text; next_ref text; aid uuid;
  old_refs jsonb := '{}'::jsonb;
  refs jsonb := '{}'::jsonb;
  new_ids uuid[] := array[]::uuid[];
  old_ids uuid[] := array[]::uuid[];
  involved uuid[];
  new_count integer := 0;
begin
  if p_owner is null or p_session is null or p_operation is null
     or p_operation not in ('create','edit') or p_allowance is null or p_allowance not in (1,3)
     or (p_operation='create' and (p_card_id is not null or p_expected_card_revision is not null))
     or (p_operation='edit' and (p_card_id is null or p_expected_card_revision is null
         or p_expected_card_revision !~ '^[0-9a-f]{64}$'))
     or payload is null or jsonb_typeof(payload)<>'object' or octet_length(payload::text)>262144
     or p_asset_receipts is null or jsonb_typeof(p_asset_receipts)<>'object'
     or octet_length(p_asset_receipts::text)>2048 then
    raise exception 'INVALID_MEDIA_FINALIZATION_INPUT' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_object_keys(payload) k(key) where key <> all(array['template_id', 'card_name', 'slug', 'full_name', 'title', 'first_name', 'last_name', 'job_title', 'company_name', 'email', 'phone', 'website', 'address', 'whatsapp', 'linkedin', 'instagram', 'facebook', 'youtube', 'booking_link', 'custom_url', 'profile_image_url', 'company_logo_url', 'selected_colour', 'selected_text_colour', 'field_order', 'field_visibility', 'custom_fields', 'action_config', 'lead_capture_settings', 'hidden_fields', 'status', 'is_published']))
     or payload ?| array['profile_image_url','company_logo_url']
     or coalesce(payload->'custom_fields','{}'::jsonb) ? 'company_banner_url'
     or jsonb_typeof(payload->'custom_fields') is distinct from 'object'
     or jsonb_typeof(payload->'field_visibility') is distinct from 'object'
     or (p_operation='edit' and payload ? 'slug') then
    raise exception 'INVALID_FINALIZATION_PAYLOAD_FIELDS' using errcode='22023';
  end if;
  if nullif(btrim(payload->>'card_name'),'') is null
     or nullif(btrim(payload->>'full_name'),'') is null
     or nullif(payload->>'template_id','') is null
     or (p_operation='create' and nullif(btrim(payload->>'slug'),'') is null)
     or payload->>'status' is null or payload->>'status' not in ('draft','published')
     or jsonb_typeof(payload->'is_published') is distinct from 'boolean'
     or (payload->>'is_published')::boolean is distinct from (payload->>'status'='published') then
    raise exception 'INVALID_CARD_PAYLOAD' using errcode='22023';
  end if;
  if (select array_agg(key order by key) from jsonb_object_keys(p_asset_receipts) k(key))
     is distinct from array['banner','logo','profile'] then
    raise exception 'INVALID_MEDIA_INTENTS' using errcode='22023';
  end if;
  foreach v_kind in array array['profile','logo','banner'] loop
    intent := p_asset_receipts->v_kind;
    action := intent->>'operation';
    if jsonb_typeof(intent) is distinct from 'object' or action is null
       or action not in ('retain','remove','replace') then
      raise exception 'INVALID_MEDIA_INTENT' using errcode='22023';
    end if;
    if (action='replace' and (select array_agg(key order by key) from jsonb_object_keys(intent) k(key))
         is distinct from array['asset_id','operation'])
       or (action<>'replace' and intent <> jsonb_build_object('operation',action))
       or (action='retain' and p_operation='create') then
      raise exception 'INVALID_MEDIA_INTENT' using errcode='22023';
    end if;
    if action='replace' then
      aid := (intent->>'asset_id')::uuid;
      if aid is null or aid=any(new_ids) then raise exception 'INVALID_MEDIA_RECEIPT'; end if;
      new_ids := array_append(new_ids,aid);
    end if;
  end loop;
  -- Canonical JSONB digest v1: generated slug/allowance do not identify content.
  digest := encode(sha256(convert_to(jsonb_build_object('version',1,'operation',p_operation,
    'card_id',p_card_id,'payload',payload-'slug','media',p_asset_receipts,
    'expected_revision',p_expected_card_revision)::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended('public.cards.card_slot:' || p_owner::text,0));
  if not public.card_media_owner_exists(p_owner) then raise exception 'MEDIA_OWNER_UNAVAILABLE'; end if;

  -- Determine old bindings without locking the card ahead of its media sessions.
  if p_operation='edit' then
    select * into original from public.cards where id=p_card_id and user_id=p_owner;
    -- A deleted-card replay must still reach its durable session receipt.
    if found then
      old_refs := jsonb_build_object('profile',original.profile_image_url,'logo',original.company_logo_url,
        'banner',original.custom_fields->>'company_banner_url');
      foreach v_kind in array array['profile','logo','banner'] loop
        old_ref := old_refs->>v_kind;
        if old_ref like 'card-media:%' then
          old_ids := array_append(old_ids,substring(old_ref from 12)::uuid);
        end if;
      end loop;
    end if;
  end if;
  if exists(select 1 from public.card_media_assets x
      where x.id=any(new_ids) and x.session_id<>p_session)
     or exists(select 1 from public.card_media_assets x join public.card_media_sessions ms on ms.id=x.session_id
      where x.id=any(old_ids) and ms.owner_user_id<>p_owner) then
    raise exception 'MEDIA_RECEIPT_UNAVAILABLE';
  end if;
  select array_agg(distinct session_id) into involved from public.card_media_assets
    where id=any(new_ids || old_ids);
  perform 1 from public.card_media_sessions where id=p_session or id=any(involved) order by id for update;
  select * into s from public.card_media_sessions where id=p_session;
  if not found or s.owner_user_id is distinct from p_owner then raise exception 'MEDIA_SESSION_UNAVAILABLE'; end if;
  if s.finalization_digest is not null then
    if s.finalization_digest <> digest then raise exception 'MEDIA_IDEMPOTENCY_CONFLICT'; end if;
    return s.finalization_result || jsonb_build_object('replayed',true,'card_missing',
      not exists(select 1 from public.cards where id=s.finalized_card_id and user_id=p_owner));
  end if;
  if s.state<>'pending' or s.expires_at<=now()
     or s.template_id is distinct from (payload->>'template_id')::uuid
     or (p_operation='create' and s.card_id is not null)
     or (p_operation='edit' and s.card_id is distinct from p_card_id) then
    raise exception 'MEDIA_SESSION_UNAVAILABLE';
  end if;
  if p_operation='edit' then
    select * into original from public.cards where id=p_card_id and user_id=p_owner for update;
    if not found then raise exception 'MEDIA_CARD_UNAVAILABLE'; end if;
    revision := encode(sha256(convert_to(to_jsonb(original)::text,'UTF8')),'hex');
    if revision <> p_expected_card_revision then raise exception 'CARD_REVISION_CONFLICT'; end if;
    -- Recheck the pre-lock snapshot; never continue with an incomplete lock set.
    if old_refs is distinct from jsonb_build_object('profile',original.profile_image_url,
      'logo',original.company_logo_url,'banner',original.custom_fields->>'company_banner_url') then
      raise exception 'CARD_REVISION_CONFLICT';
    end if;
  end if;
  -- Include all new-session assets: attach_card_media_session visits them all.
  perform 1 from public.card_media_assets
    where session_id=p_session or id=any(old_ids || new_ids) order by id for update;
  foreach v_kind in array array['profile','logo','banner'] loop
    action := p_asset_receipts->v_kind->>'operation';
    old_ref := old_refs->>v_kind;
    if action='replace' then
      aid := (p_asset_receipts->v_kind->>'asset_id')::uuid;
      select * into a from public.card_media_assets where id=aid;
      if not found or a.session_id<>p_session or a.kind<>v_kind or a.state<>'ready' then
        raise exception 'MEDIA_RECEIPT_UNAVAILABLE';
      end if;
      next_ref := 'card-media:' || aid::text;
      new_count := new_count+1;
    elsif action='retain' then
      next_ref := coalesce(old_ref,'');
      if next_ref like 'card-media:%' then
        aid := substring(next_ref from 12)::uuid;
        if not exists(select 1 from public.card_media_assets x join public.card_media_sessions ms on ms.id=x.session_id
          where x.id=aid and x.kind=v_kind and x.state='attached' and ms.owner_user_id=p_owner and ms.card_id=p_card_id
          and ms.state='attached') then raise exception 'MEDIA_RETAINED_ASSET_UNAVAILABLE'; end if;
      end if;
      -- Legacy data/http media copied ONLY from the exact owned card, not input.
    else
      next_ref := '';
    end if;
    refs := refs || jsonb_build_object(v_kind,next_ref);
  end loop;
  payload := payload || jsonb_build_object('profile_image_url',refs->>'profile','company_logo_url',refs->>'logo',
    'custom_fields',(payload->'custom_fields') || jsonb_build_object('company_banner_url',refs->>'banner'));
  if octet_length(payload::text)>262144 then raise exception 'INVALID_CARD_PAYLOAD'; end if;
  if p_operation='create' then
    result := public.create_client_card_atomic(p_owner,p_allowance,payload);
    select * into saved from public.cards where id=(result->>'id')::uuid;
  else
    -- Exact validated content update; immutable owner/id/slug/slot never assigned.
    update public.cards c set
    template_id=v.template_id,
    card_name=v.card_name,
    full_name=v.full_name,
    title=v.title,
    first_name=v.first_name,
    last_name=v.last_name,
    job_title=v.job_title,
    company_name=v.company_name,
    email=v.email,
    phone=v.phone,
    website=v.website,
    address=v.address,
    whatsapp=v.whatsapp,
    linkedin=v.linkedin,
    instagram=v.instagram,
    facebook=v.facebook,
    youtube=v.youtube,
    booking_link=v.booking_link,
    custom_url=v.custom_url,
    profile_image_url=v.profile_image_url,
    company_logo_url=v.company_logo_url,
    selected_colour=v.selected_colour,
    selected_text_colour=v.selected_text_colour,
    field_order=v.field_order,
    field_visibility=v.field_visibility,
    custom_fields=v.custom_fields,
    action_config=v.action_config,
    lead_capture_settings=v.lead_capture_settings,
    hidden_fields=v.hidden_fields,
    status=v.status,
    is_published=v.is_published
    from jsonb_to_record(payload) as v(template_id uuid, card_name text, slug text, full_name text, title text, first_name text, last_name text, job_title text, company_name text, email text, phone text, website text, address text, whatsapp text, linkedin text, instagram text, facebook text, youtube text, booking_link text, custom_url text, profile_image_url text, company_logo_url text, selected_colour text, selected_text_colour text, field_order jsonb, field_visibility jsonb, custom_fields jsonb, action_config jsonb, lead_capture_settings jsonb, hidden_fields text[], status text, is_published boolean)
    where c.id=p_card_id and c.user_id=p_owner returning c.* into saved;
  end if;
  if new_count>0 then
    perform public.attach_card_media_session(p_owner,p_session,saved.id);
  else
    -- Zero new media / removal-only saves also consume their retry session.
    update public.card_media_sessions set state='attached',card_id=saved.id where id=p_session;
  end if;
  -- Persisted replacement is now in the SAME transaction. Never delete objects here.
  foreach aid in array old_ids loop
    -- Never retire a foreign/corrupt binding; retained bindings were checked above.
    if exists(select 1 from public.card_media_assets x join public.card_media_sessions ms on ms.id=x.session_id
      where x.id=aid and ms.owner_user_id=p_owner and ms.card_id=saved.id) then
      perform public.retire_card_media_asset(aid);
    end if;
  end loop;
  revision := encode(sha256(convert_to(to_jsonb(saved)::text,'UTF8')),'hex');
  result := jsonb_build_object('card_id',saved.id,'status',saved.status,'is_published',saved.is_published,
    'revision',revision,'replayed',false,'card_missing',false);
  update public.card_media_sessions set finalization_digest=digest,finalized_operation=p_operation,
    finalized_card_id=saved.id,finalization_result=result,finalized_at=now() where id=p_session;
  return result;
end;
$$;
revoke all on function public.finalize_client_card_media(uuid,uuid,text,uuid,smallint,jsonb,jsonb,text)
  from public,anon,authenticated;
grant execute on function public.finalize_client_card_media(uuid,uuid,text,uuid,smallint,jsonb,jsonb,text)
  to service_role;
commit;
