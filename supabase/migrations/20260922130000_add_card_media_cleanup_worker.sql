-- LOCAL PREPARATION ONLY. Apply after media finalization/snapshot migrations.
-- Worker activation additionally requires Cards direct-write hardening.
-- Does not delete Storage objects or change existing grants/policies/RPCs.
begin;
set local lock_timeout = '5s';
do $$ begin
  if to_regprocedure('public.finalize_client_card_media(uuid,uuid,text,uuid,smallint,jsonb,jsonb,text)') is null
    or to_regprocedure('public.get_client_card_edit_snapshot(uuid,uuid)') is null
    or to_regprocedure('public.card_media_owner_exists(uuid)') is null then
    raise exception 'MEDIA_CLEANUP_PREREQUISITES_MISSING';
  end if;
end $$;
alter table public.card_media_assets
  add column cleanup_token uuid,
  add column cleanup_lease_until timestamptz,
  add column cleanup_attempts integer not null default 0 check (cleanup_attempts >= 0),
  add constraint card_media_cleanup_lease_pair check
    ((cleanup_token is null) = (cleanup_lease_until is null));
-- Includes attached orphan checks and deleted tombstone reconciliation.
create index card_media_cleanup_worker_due on public.card_media_assets(cleanup_after,id);

create function public.check_card_media_cleanup_boundary() returns void
language plpgsql security invoker set search_path = pg_catalog as $$
declare r record; p text; c oid := 'public.cards'::regclass; sig text; t oid;
begin
  if not (select relrowsecurity from pg_class where oid=c) then
    raise exception 'MEDIA_CLEANUP_CARDS_RLS_REQUIRED';
  end if;
  foreach p in array array['SELECT','INSERT','UPDATE','DELETE'] loop
    if not has_table_privilege('service_role',c,p) then raise exception 'MEDIA_CLEANUP_SERVICE_ACCESS_REQUIRED'; end if;
  end loop;
  foreach t in array array['public.card_media_assets'::regclass::oid,'public.card_media_sessions'::regclass::oid] loop
    if not (select relrowsecurity from pg_class where oid=t) then raise exception 'MEDIA_CLEANUP_REGISTRY_RLS_REQUIRED'; end if;
    foreach p in array array['SELECT','INSERT','UPDATE','DELETE'] loop
      if not has_table_privilege('service_role',t,p) then raise exception 'MEDIA_CLEANUP_REGISTRY_ACCESS_REQUIRED'; end if;
    end loop;
  end loop;
  -- Conservative membership closure also covers SET ROLE paths, not just INHERIT.
  for r in select oid,rolsuper,rolcreaterole from pg_roles where
    oid in ('authenticated'::regrole,'anon'::regrole)
    or pg_has_role('authenticated',oid,'MEMBER') or pg_has_role('anon',oid,'MEMBER') loop
    if r.rolsuper or r.rolcreaterole or r.oid=(select relowner from pg_class where oid=c) then
      raise exception 'MEDIA_CLEANUP_PRIVILEGED_BROWSER_ROLE';
    end if;
    foreach p in array array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
      if has_table_privilege(r.oid,c,p) then raise exception 'MEDIA_CLEANUP_REQUIRES_CARDS_HARDENING'; end if;
    end loop;
    if current_setting('server_version_num')::integer >= 170000 then
      if has_table_privilege(r.oid,c,'MAINTAIN') then raise exception 'MEDIA_CLEANUP_REQUIRES_CARDS_HARDENING'; end if;
    end if;
    foreach p in array array['INSERT','UPDATE','REFERENCES'] loop
      if has_any_column_privilege(r.oid,c,p) then raise exception 'MEDIA_CLEANUP_REQUIRES_COLUMN_HARDENING'; end if;
    end loop;
    foreach t in array array['public.card_media_assets'::regclass::oid,'public.card_media_sessions'::regclass::oid] loop
      if r.oid=(select relowner from pg_class where oid=t) then raise exception 'MEDIA_CLEANUP_REGISTRY_OWNER_PATH'; end if;
      foreach p in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
        if has_table_privilege(r.oid,t,p) then raise exception 'MEDIA_CLEANUP_REGISTRY_BROWSER_ACCESS'; end if;
      end loop;
      foreach p in array array['SELECT','INSERT','UPDATE','REFERENCES'] loop
        if has_any_column_privilege(r.oid,t,p) then raise exception 'MEDIA_CLEANUP_REGISTRY_COLUMN_ACCESS'; end if;
      end loop;
    end loop;
    foreach sig in array array[
      'public.finalize_client_card_media(uuid,uuid,text,uuid,smallint,jsonb,jsonb,text)',
      'public.attach_card_media_session(uuid,uuid,uuid)',
      'public.reserve_card_media_asset(uuid,uuid,text,text,text,integer)',
      'public.mark_card_media_ready(uuid,uuid,uuid)',
      'public.retire_card_media_asset(uuid)', 'public.claim_card_media_cleanup(uuid)',
      'public.create_client_card_atomic(uuid,smallint,jsonb)',
      'public.get_client_card_edit_snapshot(uuid,uuid)', 'public.card_media_owner_exists(uuid)'
    ] loop
      if to_regprocedure(sig) is null then raise exception 'MEDIA_CLEANUP_RPC_MISSING'; end if;
      if has_function_privilege(r.oid,to_regprocedure(sig),'EXECUTE')
        or not has_function_privilege('service_role',to_regprocedure(sig),'EXECUTE') then
        raise exception 'MEDIA_CLEANUP_RPC_PERMISSIONS';
      end if;
    end loop;
  end loop;
end $$;

create function public.card_media_cleanup_candidates(p_limit integer) returns jsonb
language plpgsql security invoker set search_path = pg_catalog as $$
declare result jsonb;
begin
  perform public.check_card_media_cleanup_boundary();
  if p_limit is null or p_limit < 1 or p_limit > 50 then raise exception 'MEDIA_CLEANUP_BATCH_INVALID'; end if;
  select coalesce(jsonb_agg(id order by cleanup_after,id),'[]'::jsonb) into result from (
    select id,cleanup_after from public.card_media_assets
    where cleanup_after <= now() and (cleanup_lease_until is null or cleanup_lease_until <= now())
    order by cleanup_after,id limit p_limit
  ) candidates;
  return result;
end $$;

-- All transitions lock owner -> session -> asset, matching finalization.
-- A deleting/deleted asset is not attachable through any approved finalizer.
-- Storage I/O happens outside Postgres; lease tokens fence completion/retries.
create function public.manage_card_media_cleanup(p_asset uuid,p_action text,p_token uuid default null)
returns jsonb language plpgsql security invoker set search_path = pg_catalog as $$
declare a public.card_media_assets%rowtype; s public.card_media_sessions%rowtype;
  owner_id uuid; session_id uuid; outcome text; ref text; token uuid;
begin
  perform public.check_card_media_cleanup_boundary();
  if p_action is null or p_action not in ('claim','check','complete','retry') then raise exception 'MEDIA_CLEANUP_ACTION_INVALID'; end if;
  select ms.owner_user_id,ms.id into owner_id,session_id from public.card_media_assets ma
    join public.card_media_sessions ms on ms.id=ma.session_id where ma.id=p_asset;
  if not found then return jsonb_build_object('status','invalid'); end if;
  perform pg_advisory_xact_lock(hashtextextended('public.cards.card_slot:'||owner_id::text,0));
  select * into s from public.card_media_sessions where id=session_id for update;
  select * into a from public.card_media_assets where id=p_asset for update;
  if not found then return jsonb_build_object('status','invalid'); end if;
  if p_action <> 'claim' and (p_token is null or a.cleanup_token is distinct from p_token
    or a.cleanup_lease_until <= clock_timestamp() or a.cleanup_lease_until is null) then
    return jsonb_build_object('status','stale');
  end if;
  if p_action='claim' and a.cleanup_lease_until > clock_timestamp() then
    return jsonb_build_object('status','busy');
  end if;
  ref := 'card-media:'||a.id::text;
  -- GLOBAL references: never rely only on the owning card/session or visibility.
  if exists(select 1 from public.cards where profile_image_url=ref or company_logo_url=ref
    or custom_fields->>'company_banner_url'=ref) then
    update public.card_media_assets set cleanup_after=now()+interval '24 hours',
      cleanup_token=null,cleanup_lease_until=null where id=a.id;
    return jsonb_build_object('status','referenced');
  end if;
  if p_action='claim' then
    if a.cleanup_after > now() then return jsonb_build_object('status','not_due'); end if;
    if a.state='attached' then
      -- Deleted-card/account or superseded orphan. Retirement starts the SAME 24h grace.
      outcome := public.retire_card_media_asset(a.id);
      return jsonb_build_object('status',outcome);
    end if;
    if a.state in ('reserved','ready') and s.state='pending' and s.expires_at > now()
      and public.card_media_owner_exists(s.owner_user_id) then
      update public.card_media_assets set cleanup_after=s.expires_at where id=a.id;
      return jsonb_build_object('status','not_due');
    end if;
    if a.state <> 'deleted' then
      outcome := public.claim_card_media_cleanup(a.id);
      if outcome <> 'deleting' then return jsonb_build_object('status',outcome); end if;
    end if;
    token := gen_random_uuid();
    update public.card_media_assets set cleanup_token=token,
      cleanup_lease_until=clock_timestamp()+interval '5 minutes',cleanup_attempts=cleanup_attempts+1 where id=a.id;
    return jsonb_build_object('status','claimed','token',token,'retried',a.cleanup_attempts>0,
      'path',s.owner_user_id::text||'/'||s.id::text||'/'||a.kind||'/'||a.id::text||
        case a.mime_type when 'image/jpeg' then '.jpg' when 'image/png' then '.png' when 'image/webp' then '.webp' end);
  end if;
  if a.state not in ('deleting','deleted') then return jsonb_build_object('status','invalid'); end if;
  if p_action='check' then return jsonb_build_object('status','authorized'); end if;
  if p_action='complete' then
    -- Caller has confirmed Storage absence. Retain tombstone AND receipt forever.
    -- Reconcile tombstones daily to catch a very late in-flight abandoned upload.
    update public.card_media_assets set state='deleted',cleanup_token=null,cleanup_lease_until=null,
      cleanup_after=now()+interval '24 hours' where id=a.id;
    return jsonb_build_object('status','deleted');
  end if;
  update public.card_media_assets set cleanup_token=null,cleanup_lease_until=null,
    cleanup_after=now()+interval '15 minutes' where id=a.id;
  return jsonb_build_object('status','retry');
end $$;

create function public.prune_empty_card_media_sessions(p_limit integer) returns integer
language plpgsql security invoker set search_path = pg_catalog as $$
declare s record; removed integer := 0;
begin
  perform public.check_card_media_cleanup_boundary();
  if p_limit is null or p_limit < 1 or p_limit > 50 then raise exception 'MEDIA_CLEANUP_BATCH_INVALID'; end if;
  for s in select id from public.card_media_sessions ms
    where ms.state in ('pending','expired') and ms.expires_at < now()-interval '7 days'
      and ms.finalization_digest is null and ms.finalization_result is null and ms.finalized_at is null
      and not exists(select 1 from public.card_media_assets a where a.session_id=ms.id)
    order by ms.expires_at,ms.id limit p_limit for update of ms skip locked loop
    -- Reserve/finalize both acquire the session lock first; expired sessions cannot revive.
    delete from public.card_media_sessions where id=s.id;
    removed := removed+1;
  end loop;
  return removed;
end $$;

revoke all on function public.check_card_media_cleanup_boundary(), public.card_media_cleanup_candidates(integer),
  public.manage_card_media_cleanup(uuid,text,uuid), public.prune_empty_card_media_sessions(integer) from public,anon,authenticated;
grant execute on function public.check_card_media_cleanup_boundary(), public.card_media_cleanup_candidates(integer),
  public.manage_card_media_cleanup(uuid,text,uuid), public.prune_empty_card_media_sessions(integer) to service_role;
commit;
