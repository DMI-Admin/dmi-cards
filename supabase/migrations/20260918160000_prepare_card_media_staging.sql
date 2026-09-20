-- Stage A only. Does not activate uploads or change existing card writes.
begin;

-- Reuse only an exactly matching bucket; never mutate an existing bucket.
do $$
begin
  if exists(select 1 from storage.buckets where id='card-media' or name='card-media') then
    if not exists(select 1 from storage.buckets where id='card-media' and name='card-media'
      and public=false and file_size_limit=2097152
      and array(select unnest(allowed_mime_types) order by 1)
        = array['image/jpeg','image/png','image/webp']) then
      raise exception 'CARD_MEDIA_BUCKET_CONFIGURATION_CONFLICT';
    end if;
  else
    insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
      values('card-media','card-media',false,2097152,array['image/jpeg','image/png','image/webp']);
  end if;
end;
$$;
-- No Storage policies or grants: existing RLS with zero permissive policies
-- denies direct anon/authenticated access. service_role bypasses RLS.

create table public.card_media_sessions (
  id uuid primary key default gen_random_uuid(),
  -- Durable cleanup identity, intentionally no Auth FK or cascading deletion.
  owner_user_id uuid not null,
  -- Snapshot only: do not block existing Admin template deletion. Revalidate at save.
  template_id uuid not null,
  card_id uuid references public.cards(id) on delete set null,
  state text not null default 'pending' check (state in ('pending', 'attached', 'expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '48 hours',
  check (expires_at > created_at)
);
create index card_media_sessions_owner on public.card_media_sessions(owner_user_id);
create index card_media_sessions_expiry on public.card_media_sessions(expires_at) where state = 'pending';
create index card_media_sessions_card on public.card_media_sessions(card_id);

create table public.card_media_assets (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.card_media_sessions(id) on delete restrict,
  kind text not null check (kind in ('profile', 'logo', 'banner')),
  -- SHA-256 of server-normalized bytes; same session/kind/content is retryable.
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes integer not null check (size_bytes between 1 and 2097152),
  state text not null default 'reserved' check (state in ('reserved','ready','attached','cleanup_pending','deleting','deleted')),
  created_at timestamptz not null default now(),
  cleanup_after timestamptz not null default now() + interval '48 hours',
  unique (session_id, kind, sha256)
);
create index card_media_assets_cleanup on public.card_media_assets(cleanup_after) where state <> 'deleted';
alter table public.card_media_sessions enable row level security;
alter table public.card_media_assets enable row level security;
revoke all on public.card_media_sessions, public.card_media_assets from public, anon, authenticated;
grant select, insert, update, delete on public.card_media_sessions, public.card_media_assets to service_role;
-- Deliberately no client policies on the coordination tables.

create function public.reserve_card_media_asset(
  p_owner uuid, p_session uuid, p_kind text, p_sha256 text, p_mime text, p_size integer
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare s public.card_media_sessions; a public.card_media_assets; ext text;
begin
  select * into s from public.card_media_sessions where id = p_session for update;
  if not found or s.owner_user_id is distinct from p_owner or s.state <> 'pending' or s.expires_at <= now()
     or not exists(select 1 from auth.users where id=p_owner) then
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

-- Called only after server upload/HEAD verification of bytes, hash and MIME.
create function public.mark_card_media_ready(p_owner uuid,p_session uuid,p_asset uuid)
returns void language plpgsql security invoker set search_path = public as $$
declare s public.card_media_sessions;
begin
  select * into s from public.card_media_sessions where id=p_session for update;
  if not found or s.owner_user_id is distinct from p_owner or s.state <> 'pending' or s.expires_at <= now()
     or not exists(select 1 from auth.users where id=p_owner) then
    raise exception 'MEDIA_SESSION_UNAVAILABLE';
  end if;
  update public.card_media_assets set state='ready'
    where id=p_asset and session_id=p_session and state in ('reserved','ready');
  if not found then raise exception 'MEDIA_ASSET_UNAVAILABLE'; end if;
end;
$$;

-- Stage B MUST call this inside the same transaction as its validated card write.
-- This function never writes card content, allocates a slot or grants entitlement.
-- References use card-media:<asset UUID>, resolved through this private registry.
create function public.attach_card_media_session(p_owner uuid,p_session uuid,p_card uuid)
returns text language plpgsql security invoker set search_path = public as $$
declare s public.card_media_sessions; c public.cards; a public.card_media_assets;
  ref text; expected text; n integer := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended('public.cards.card_slot:' || p_owner::text,0));
  select * into s from public.card_media_sessions where id=p_session for update;
  if not found or s.owner_user_id is distinct from p_owner
     or not exists(select 1 from auth.users where id=p_owner) then raise exception 'MEDIA_SESSION_UNAVAILABLE'; end if;
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

-- Explicit retirement is separate from orphan cleanup. Stage B calls this after
-- replacement/removal in its transaction; a sweeper uses it after card/account deletion.
create function public.retire_card_media_asset(p_asset uuid)
returns text language plpgsql security invoker set search_path = public as $$
declare sid uuid; owner_id uuid; a public.card_media_assets; ref text;
begin
  select session_id into sid from public.card_media_assets where id=p_asset;
  if not found then return 'not_found'; end if;
  select owner_user_id into owner_id from public.card_media_sessions where id=sid;
  perform pg_advisory_xact_lock(hashtextextended('public.cards.card_slot:' || owner_id::text,0));
  perform 1 from public.card_media_sessions where id=sid for update;
  select * into a from public.card_media_assets where id=p_asset for update;
  if a.state <> 'attached' then return a.state; end if;
  ref := 'card-media:' || a.id::text;
  if exists(select 1 from public.cards where profile_image_url=ref or company_logo_url=ref
      or custom_fields->>'company_banner_url'=ref) then return 'referenced'; end if;
  update public.card_media_assets set state='cleanup_pending',cleanup_after=now()+interval '24 hours' where id=p_asset;
  return 'cleanup_pending';
end;
$$;

-- Claims only this registry's objects, never deletes Storage or card data.
-- The future worker retries deleting rows until Storage confirms absence, then
-- records deleted. Attachment and cleanup serialize on the same session lock.
create function public.claim_card_media_cleanup(p_asset uuid)
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
      or not exists (
        select 1 from auth.users where id = s.owner_user_id
      )
    )
  then
    update public.card_media_sessions set state='expired' where id=s.id;
  end if;
  return 'deleting';
end;
$$;

revoke all on function public.reserve_card_media_asset(uuid,uuid,text,text,text,integer),
  public.mark_card_media_ready(uuid,uuid,uuid), public.attach_card_media_session(uuid,uuid,uuid),
  public.claim_card_media_cleanup(uuid), public.retire_card_media_asset(uuid) from public, anon, authenticated;
grant execute on function public.reserve_card_media_asset(uuid,uuid,text,text,text,integer),
  public.mark_card_media_ready(uuid,uuid,uuid), public.attach_card_media_session(uuid,uuid,uuid),
  public.claim_card_media_cleanup(uuid), public.retire_card_media_asset(uuid) to service_role;
commit;
