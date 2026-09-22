-- READ ONLY. Review for the intended project before manually running.
select p.oid::regprocedure as function, p.prosecdef as security_definer, p.proconfig,
  has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
  has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
  has_function_privilege('service_role',p.oid,'EXECUTE') as service_execute
from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('check_card_media_cleanup_boundary',
  'card_media_cleanup_candidates','manage_card_media_cleanup','prune_empty_card_media_sessions');
select column_name,data_type,is_nullable,column_default from information_schema.columns
where table_schema='public' and table_name='card_media_assets'
  and column_name in ('cleanup_token','cleanup_lease_until','cleanup_attempts');
select state,count(*) as assets,count(*) filter(where cleanup_after<=now()) as due,
  count(*) filter(where cleanup_lease_until>now()) as leased
from public.card_media_assets group by state;
-- This function only inspects catalog privileges. An exception means DO NOT activate worker.
select public.check_card_media_cleanup_boundary();
-- Must be zero. No owner IDs, card details or object contents are returned.
select count(*) as referenced_deleting_or_deleted from public.card_media_assets a
where a.state in ('deleting','deleted') and exists(select 1 from public.cards c
  where c.profile_image_url='card-media:'||a.id::text
  or c.company_logo_url='card-media:'||a.id::text
  or c.custom_fields->>'company_banner_url'='card-media:'||a.id::text);
