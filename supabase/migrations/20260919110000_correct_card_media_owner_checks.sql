-- Additive production correction: apply after Stage A and before media finalization.
-- Preserves the staging-tested definitions; no managed Auth privilege changes.
begin;

-- Fail rather than assume the definer role has the required existing access.
do $$
begin
  if not has_schema_privilege('postgres', 'auth', 'USAGE')
     or not has_table_privilege('postgres', 'auth.users', 'SELECT') then
    raise exception 'TRUSTED_DEFINER_AUTH_READ_REQUIRED';
  end if;
end;
$$;

create function public.card_media_owner_exists(p_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select exists(select 1 from auth.users where id = p_owner);
$$;
alter function public.card_media_owner_exists(uuid) owner to postgres;
revoke all on function public.card_media_owner_exists(uuid) from public, anon, authenticated;
grant execute on function public.card_media_owner_exists(uuid) to service_role;

create or replace function public.reserve_card_media_asset(
  p_owner uuid, p_session uuid, p_kind text, p_sha256 text, p_mime text, p_size integer
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare s public.card_media_sessions; a public.card_media_assets; ext text;
begin
  select * into s from public.card_media_sessions where id = p_session for update;
  if not found or s.owner_user_id is distinct from p_owner or s.state <> 'pending' or s.expires_at <= now()
     or not public.card_media_owner_exists(p_owner) then
    raise exception 'MEDIA_SESSION_UNAVAILABLE';
  end if;
  if not exists(select 1 from public.card_media_assets where session_id=p_session and kind=p_kind and sha256=p_sha256)
     and (select count(*) from public.card_media_assets where session_id=p_session) >= 12 then
    raise exception 'MEDIA_SESSION_ASSET_LIMIT';
  end if;
  insert into public.card_media_assets(session_id,kind,sha256,mime_type,size_bytes,cleanup_after)
    values(p_session,p_kind,p_sha256,p_mime,p_size,s.expires_at)
    on conflict(session_id,kind,sha256) do nothing;
  select * into a from public.card_media_assets
    where session_id=p_session and kind=p_kind and sha256=p_sha256 for update;
  if a.state not in ('reserved','ready') or a.mime_type is distinct from p_mime or a.size_bytes is distinct from p_size then
    raise exception 'MEDIA_RETRY_CONFLICT';
  end if;
  ext := case a.mime_type when 'image/jpeg' then 'jpg' when 'image/png' then 'png' else 'webp' end;
  return jsonb_build_object('asset_id',a.id,'state',a.state,'object_path',
    s.owner_user_id::text || '/' || s.id::text || '/' || a.kind || '/' || a.id::text || '.' || ext);
end;
$$;

create or replace function public.mark_card_media_ready(p_owner uuid,p_session uuid,p_asset uuid)
returns void language plpgsql security invoker set search_path = public as $$
declare s public.card_media_sessions;
begin
  select * into s from public.card_media_sessions where id=p_session for update;
  if not found or s.owner_user_id is distinct from p_owner or s.state <> 'pending' or s.expires_at <= now()
     or not public.card_media_owner_exists(p_owner) then
    raise exception 'MEDIA_SESSION_UNAVAILABLE';
  end if;
  update public.card_media_assets set state='ready'
    where id=p_asset and session_id=p_session and state in ('reserved','ready');
  if not found then raise exception 'MEDIA_ASSET_UNAVAILABLE'; end if;
end;
$$;

create or replace function public.attach_card_media_session(p_owner uuid,p_session uuid,p_card uuid)
returns text language plpgsql security invoker set search_path = public as $$
declare s public.card_media_sessions; c public.cards; a public.card_media_assets;
  ref text; expected text; n integer := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended('public.cards.card_slot:' || p_owner::text,0));
  select * into s from public.card_media_sessions where id=p_session for update;
  if not found or s.owner_user_id is distinct from p_owner
     or not public.card_media_owner_exists(p_owner) then raise exception 'MEDIA_SESSION_UNAVAILABLE'; end if;
  select * into c from public.cards where id=p_card and user_id=p_owner for update;
  if not found or c.template_id is distinct from s.template_id then raise exception 'MEDIA_CARD_UNAVAILABLE'; end if;
  if s.state='attached' and s.card_id=p_card then return 'already_attached'; end if;
  if s.state <> 'pending' or s.expires_at <= now() or (s.card_id is not null and s.card_id <> p_card) then
    raise exception 'MEDIA_SESSION_UNAVAILABLE';
  end if;
  for a in select * from public.card_media_assets where session_id=p_session order by id for update loop
    ref := 'card-media:' || a.id::text;
    expected := case a.kind when 'profile' then c.profile_image_url when 'logo' then c.company_logo_url
      else c.custom_fields->>'company_banner_url' end;
    if expected = ref then
      if a.state <> 'ready' then raise exception 'MEDIA_ASSET_NOT_READY'; end if;
      update public.card_media_assets set state='attached' where id=a.id;
      n := n + 1;
    end if;
  end loop;
  if n=0 then raise exception 'NO_MEDIA_REFERENCES_TO_ATTACH'; end if;
  update public.card_media_sessions set state='attached',card_id=p_card where id=p_session;
  return 'attached';
end;
$$;

create or replace function public.claim_card_media_cleanup(p_asset uuid)
returns text language plpgsql security invoker set search_path = public as $$
declare s public.card_media_sessions; a public.card_media_assets; sid uuid; ref text;
begin
  select session_id into sid from public.card_media_assets where id=p_asset;
  if not found then return 'not_found'; end if;
  select * into s from public.card_media_sessions where id=sid for update;
  select * into a from public.card_media_assets where id=p_asset for update;
  if a.state='deleted' then return 'deleted'; end if;
  if a.state='attached' then return 'attached'; end if;
  if a.cleanup_after > now() then return 'not_due'; end if;
  ref := 'card-media:' || a.id::text;
  if exists(select 1 from public.cards where profile_image_url=ref or company_logo_url=ref
      or custom_fields->>'company_banner_url'=ref) then return 'referenced'; end if;
  update public.card_media_assets set state='deleting' where id=p_asset;
  if s.state = 'pending'
    and (
      s.expires_at <= now()
      or not public.card_media_owner_exists(s.owner_user_id)
    )
  then
    update public.card_media_sessions set state='expired' where id=s.id;
  end if;
  return 'deleting';
end;
$$;

-- retire_card_media_asset is unchanged and remains SECURITY INVOKER.
commit;
