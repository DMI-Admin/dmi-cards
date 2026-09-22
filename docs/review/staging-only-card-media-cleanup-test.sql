-- STAGING TEST ONLY — NEVER RUN IN PRODUCTION. PREPARED, NOT EXECUTED.
-- Replace the two placeholders with designated staging owner/template UUIDs.
-- Requires hardened Cards grants and the cleanup migration. Creates synthetic metadata
-- only; no real Storage objects. Transaction always rolls back. Real Storage/race tests
-- remain separate (see card-media-cleanup-worker.md).
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local role service_role;
do $$
declare
  owner_id uuid := '<STAGING_OWNER_UUID>'::uuid;
  template_id uuid := '<STAGING_TEMPLATE_UUID>'::uuid;
  sid uuid; edit_sid uuid; aid uuid; cid uuid; stale_sid uuid; empty_sid uuid;
  receipt jsonb; claim jsonb; again jsonb; snap jsonb; kind text; intents jsonb := '{}';
  asset_ids uuid[] := array[]::uuid[]; i integer;
begin
  perform public.check_card_media_cleanup_boundary();
  if not public.card_media_owner_exists(owner_id)
    or exists(select 1 from public.cards where user_id=owner_id) then
    raise exception 'DESIGNATED_STAGING_OWNER_MUST_EXIST_AND_HAVE_NO_CARDS';
  end if;
  if not exists(select 1 from public.templates t where t.id=template_id) then
    raise exception 'DESIGNATED_TEMPLATE_REQUIRED';
  end if;
  insert into public.card_media_sessions(owner_user_id,template_id)
    values(owner_id,template_id) returning id into sid;
  foreach kind in array array['profile','logo','banner'] loop
    receipt := public.reserve_card_media_asset(owner_id,sid,kind,repeat('a',64),'image/webp',100);
    aid := (receipt->>'asset_id')::uuid;
    asset_ids := array_append(asset_ids,aid);
    perform public.mark_card_media_ready(owner_id,sid,aid);
    intents := intents || jsonb_build_object(kind,jsonb_build_object('operation','replace','asset_id',aid));
  end loop;
  receipt := public.finalize_client_card_media(owner_id,sid,'create',null,3::smallint,
    jsonb_build_object('template_id',template_id,'card_name','Cleanup staging test',
      'full_name','Cleanup Test','slug','cleanup-test-'||gen_random_uuid()::text,
      'status','draft','is_published',false,'custom_fields','{}'::jsonb,'field_visibility','{}'::jsonb),intents,null);
  cid := (receipt->>'card_id')::uuid;
  update public.card_media_assets set cleanup_after=now()-interval '1 second' where session_id=sid;
  foreach aid in array asset_ids loop
    claim := public.manage_card_media_cleanup(aid,'claim');
    if claim->>'status'<>'referenced' then raise exception 'REFERENCED_FINALIZED_ASSET_NOT_PROTECTED'; end if;
  end loop;
  snap := public.get_client_card_edit_snapshot(owner_id,cid);
  insert into public.card_media_sessions(owner_user_id,template_id,card_id)
    values(owner_id,template_id,cid) returning id into edit_sid;
  perform public.finalize_client_card_media(owner_id,edit_sid,'edit',cid,3::smallint,
    jsonb_build_object('template_id',template_id,'card_name','Cleanup staging test',
      'full_name','Cleanup Test','status','draft','is_published',false,
      'custom_fields','{}'::jsonb,'field_visibility','{}'::jsonb),
    '{"profile":{"operation":"remove"},"logo":{"operation":"retain"},"banner":{"operation":"retain"}}',snap->>'revision');
  aid := asset_ids[1];
  if (public.manage_card_media_cleanup(aid,'claim')->>'status')<>'not_due' then raise exception 'GRACE_NOT_PRESERVED'; end if;
  update public.card_media_assets set cleanup_after=now()-interval '1 second' where id=aid;
  claim := public.manage_card_media_cleanup(aid,'claim');
  if claim->>'status'<>'claimed' then raise exception 'DUE_REMOVAL_NOT_CLAIMED'; end if;
  again := public.manage_card_media_cleanup(aid,'claim');
  if again->>'status'<>'busy' then raise exception 'DUPLICATE_CLAIM_NOT_FENCED'; end if;
  if (public.manage_card_media_cleanup(aid,'complete',gen_random_uuid())->>'status')<>'stale' then raise exception 'WRONG_TOKEN_ACCEPTED'; end if;
  perform public.manage_card_media_cleanup(aid,'retry',(claim->>'token')::uuid);
  update public.card_media_assets set cleanup_after=now()-interval '1 second' where id=aid;
  again := public.manage_card_media_cleanup(aid,'claim');
  if (again->>'retried')::boolean is not true then raise exception 'RETRY_NOT_RECORDED'; end if;
  if (public.manage_card_media_cleanup(aid,'check',(claim->>'token')::uuid)->>'status')<>'stale' then raise exception 'OLD_TOKEN_ACCEPTED'; end if;
  -- Synthetic object never existed; this models the worker's confirmed absence.
  if (public.manage_card_media_cleanup(aid,'complete',(again->>'token')::uuid)->>'status')<>'deleted' then raise exception 'COMPLETION_FAILED'; end if;
  if not exists(select 1 from public.card_media_sessions where id=sid and finalization_result is not null) then raise exception 'RECEIPT_LOST'; end if;
  delete from public.cards where id=cid;
  for i in 2..3 loop
    aid:=asset_ids[i];
    update public.card_media_assets set cleanup_after=now()-interval '1 second' where id=aid;
    if (public.manage_card_media_cleanup(aid,'claim')->>'status')<>'cleanup_pending' then raise exception 'ORPHAN_NOT_RETIRED'; end if;
    if not exists(select 1 from public.card_media_assets where id=aid and cleanup_after>=now()+interval '24 hours') then raise exception 'ORPHAN_GRACE_MISSING'; end if;
  end loop;
  insert into public.card_media_sessions(owner_user_id,template_id,created_at,expires_at)
    values(owner_id,template_id,now()-interval '72 hours',now()-interval '24 hours') returning id into stale_sid;
  insert into public.card_media_assets(session_id,kind,sha256,mime_type,size_bytes,cleanup_after)
    values(stale_sid,'profile',repeat('b',64),'image/webp',100,now()-interval '1 second') returning id into aid;
  claim := public.manage_card_media_cleanup(aid,'claim');
  if claim->>'status'<>'claimed' or not exists(select 1 from public.card_media_sessions where id=stale_sid and state='expired') then raise exception 'EXPIRED_UPLOAD_NOT_CLAIMED'; end if;
  insert into public.card_media_sessions(owner_user_id,template_id,created_at,expires_at)
    values(owner_id,template_id,now()-interval '10 days',now()-interval '9 days') returning id into empty_sid;
  -- Ensure this test does not prune other staging sessions: only call if this is the
  -- oldest eligible empty session, otherwise stop for an isolated fixture database.
  if exists(select 1 from public.card_media_sessions s where s.id<>empty_sid
    and s.state in ('pending','expired') and s.expires_at<now()-interval '7 days'
    and s.finalization_digest is null and not exists(select 1 from public.card_media_assets a where a.session_id=s.id)) then
    raise exception 'ISOLATED_PRUNE_FIXTURE_REQUIRED';
  end if;
  perform public.prune_empty_card_media_sessions(1);
  if exists(select 1 from public.card_media_sessions where id=empty_sid) then raise exception 'EMPTY_SESSION_NOT_PRUNED'; end if;
  if not exists(select 1 from public.card_media_sessions where id=edit_sid and finalization_result is not null) then raise exception 'EDIT_RECEIPT_LOST'; end if;
  raise notice 'PASS: finalized references, grace, duplicate/stale claims, retry, completion, orphan retirement, expiry, pruning and receipts. Storage/concurrency not exercised.';
end $$;
rollback;
