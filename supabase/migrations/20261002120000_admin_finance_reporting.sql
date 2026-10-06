-- Additive SELECT-only Admin reporting. No change to Finance writers or table ACLs.
BEGIN;
CREATE FUNCTION public.admin_finance_report(p_scope text,p_as_of timestamptz,p_period_start timestamptz,p_period_end timestamptz)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog AS $report$
WITH valid AS (
 SELECT 1 WHERE p_scope ~ '^acct_[A-Za-z0-9]+:(test|live)$' AND p_as_of IS NOT NULL
 AND p_period_start < p_period_end AND p_period_end-p_period_start <= interval '32 days'
 AND p_period_start <= p_as_of AND p_as_of <= p_period_end
), accounts AS (
 SELECT a.* FROM public.billing_accounts a,valid WHERE a.stripe_scope=p_scope AND a.verified_at IS NOT NULL AND a.verified_at<=p_as_of
), operational AS (
 SELECT b.*, EXISTS(SELECT 1 FROM accounts a WHERE a.user_id=b.user_id AND a.stripe_customer_id=b.stripe_customer_id) AS linked
 FROM public.billing_subscriptions b,valid WHERE b.stripe_scope=p_scope AND b.dmi_plan='pro'
 AND b.stripe_subscription_status='active' AND NOT b.terminal
 AND b.current_period_end>p_as_of
), subs AS (
 SELECT s.*, EXISTS(SELECT 1 FROM accounts a WHERE a.user_id=s.user_id AND a.stripe_customer_id=s.stripe_customer_id) AS bound
 FROM public.billing_finance_subscriptions s,valid WHERE s.stripe_scope=p_scope AND s.status='active'
 AND NOT s.collection_paused AND (s.ended_at IS NULL OR s.ended_at>p_as_of) AND (s.cancel_at IS NULL OR s.cancel_at>p_as_of)
), items AS (
 SELECT i.*, s.items_complete, s.valuation_status AS parent_valuation, s.linkage_status,s.bound,s.verified_at AS parent_verified
 FROM public.billing_finance_subscription_items i JOIN subs s ON s.stripe_scope=i.stripe_scope AND s.stripe_object_id=i.stripe_subscription_id
 WHERE i.stripe_scope=p_scope AND i.removed_at IS NULL
), eligible AS (
 SELECT *, interval_count::bigint * CASE WHEN recurring_interval='year' THEN 12 ELSE 1 END AS denominator
 FROM items WHERE currency='gbp' AND linkage_status='verified' AND bound AND items_complete
 AND valuation_status='complete' AND parent_valuation='complete' AND period_start<=p_as_of AND period_end>p_as_of
 AND verified_at<=p_as_of AND parent_verified<=p_as_of AND recurring_interval IN ('month','year') AND effective_cycle_amount_minor IS NOT NULL
), groups AS (
 SELECT denominator,sum(effective_cycle_amount_minor)::text AS numerator FROM eligible GROUP BY denominator
), runs AS (
 SELECT DISTINCT ON (r.resource_type) r.resource_type,r.status,r.coverage_quality,r.coverage_start,r.coverage_end,r.completed_at,r.error_count::text
 FROM public.billing_finance_sync_runs r,valid WHERE r.stripe_scope=p_scope
 AND r.resource_type IN ('active_subscriptions','open_invoices','recent_invoices','recent_failures','pending_refunds')
 ORDER BY r.resource_type,r.started_at DESC,r.id DESC
), payments AS (
 SELECT x.* FROM public.billing_payments x,valid WHERE x.stripe_scope=p_scope
), open_invoices AS (
 SELECT i.*,EXISTS(SELECT 1 FROM public.billing_finance_subscriptions s WHERE s.stripe_scope=p_scope AND s.stripe_object_id=i.stripe_subscription_id AND s.stripe_customer_id=i.stripe_customer_id AND s.linkage_status='verified'
 AND EXISTS(SELECT 1 FROM accounts a WHERE a.user_id=s.user_id AND a.stripe_customer_id=s.stripe_customer_id)) AS linked
 FROM public.billing_invoices i,valid WHERE i.stripe_scope=p_scope AND i.status='open'
)
SELECT jsonb_build_object(
 'subscriptionPopulation',jsonb_build_object(
 'paidActiveCount',(SELECT count(*)::text FROM operational),
 'verifiedUserCount',(SELECT count(DISTINCT user_id)::text FROM operational WHERE linked),
 'unresolvedIdentityCount',(SELECT count(*)::text FROM operational WHERE NOT linked),
 'unsupportedCount',(SELECT count(*)::text FROM items WHERE valuation_status='unsupported' OR parent_valuation='unsupported'),
 'incompleteItemCount',(SELECT count(*)::text FROM subs s WHERE NOT s.items_complete OR NOT EXISTS(SELECT 1 FROM items i WHERE i.stripe_subscription_id=s.stripe_object_id)),
 'oldestVerifiedAt',(SELECT min(verified_at) FROM subs),
 'missingMirrorCount',(SELECT count(*)::text FROM operational b WHERE NOT EXISTS(SELECT 1 FROM subs s WHERE s.stripe_object_id=b.stripe_subscription_id))
 ),
 'recurringRevenue',jsonb_build_object('currency','gbp',
 'groups',CASE WHEN (SELECT count(*) FROM groups)<=256 THEN coalesce((SELECT jsonb_agg(jsonb_build_object('numerator',numerator,'denominator',denominator::text) ORDER BY denominator) FROM groups),'[]'::jsonb) ELSE '[]'::jsonb END,
 'groupLimitExceeded',(SELECT count(*)>256 FROM groups),
 'blockerCount',(SELECT (count(*)-(SELECT count(*) FROM eligible))::text FROM items),
 'includedCount',(SELECT count(*)::text FROM eligible)),
 'collections',jsonb_build_object('currency','gbp',
 'minor',coalesce((SELECT sum(amount_captured_minor)::text FROM payments WHERE currency='gbp' AND status='succeeded' AND paid AND captured AND attribution_status='verified' AND collection_time_basis<>'unknown' AND collected_at>=p_period_start AND collected_at<least(p_period_end,p_as_of)),'0'),
 'includedCount',(SELECT count(*)::text FROM payments WHERE currency='gbp' AND status='succeeded' AND paid AND captured AND attribution_status='verified' AND collected_at>=p_period_start AND collected_at<least(p_period_end,p_as_of)),
 'missingTimestampCount',(SELECT count(*)::text FROM payments WHERE status='succeeded' AND paid AND captured AND collected_at IS NULL),
 'excludedCount',(SELECT count(*)::text FROM payments WHERE collected_at>=p_period_start AND collected_at<least(p_period_end,p_as_of) AND NOT(currency='gbp' AND status='succeeded' AND paid AND captured AND attribution_status='verified'))),
 'invoices',jsonb_build_object('currency','gbp','openCount',(SELECT count(*)::text FROM open_invoices),
 'minor',coalesce((SELECT sum(amount_remaining_minor)::text FROM open_invoices WHERE linked AND currency='gbp'),'0'),
 'blockerCount',(SELECT count(*)::text FROM open_invoices WHERE NOT linked OR currency<>'gbp'),
 'oldestVerifiedAt',(SELECT min(verified_at) FROM open_invoices)),
 'failedAttempts',jsonb_build_object('basis','observed','count',(SELECT count(*)::text FROM public.billing_payment_attempts a WHERE a.stripe_scope=p_scope AND a.occurred_at>=p_period_start AND a.occurred_at<least(p_period_end,p_as_of))),
 'coverage',coalesce((SELECT jsonb_agg(to_jsonb(runs)) FROM runs),'[]'::jsonb)
) FROM valid;
$report$;
REVOKE ALL ON FUNCTION public.admin_finance_report(text,timestamptz,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_finance_report(text,timestamptz,timestamptz,timestamptz) TO service_role;
COMMIT;
