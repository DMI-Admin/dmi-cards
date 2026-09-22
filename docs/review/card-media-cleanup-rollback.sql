-- REVIEW ONLY. Stop workers and wait for all leases/in-flight requests before execution.
-- Cannot undo physical object deletion. Does not restore unsafe grants or old references.
begin;
set local lock_timeout = '5s';
do $$ begin
  if exists(select 1 from public.card_media_assets where cleanup_lease_until > now()) then
    raise exception 'STOP_WORKERS_AND_WAIT_FOR_LEASES';
  end if;
end $$;
drop function public.prune_empty_card_media_sessions(integer);
drop function public.manage_card_media_cleanup(uuid,text,uuid);
drop function public.card_media_cleanup_candidates(integer);
drop function public.check_card_media_cleanup_boundary();
drop index public.card_media_cleanup_worker_due;
alter table public.card_media_assets drop constraint card_media_cleanup_lease_pair,
  drop column cleanup_token, drop column cleanup_lease_until, drop column cleanup_attempts;
commit;
