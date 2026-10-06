-- V1 observed reporting only. No historical population reconstruction or Finance writes.
BEGIN;
CREATE FUNCTION public.admin_finance_v1_report(p_scope text,p_as_of timestamptz,p_periods jsonb,p_list text,p_after text DEFAULT NULL,p_limit integer DEFAULT 25)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $report$
WITH valid AS (
 SELECT 1 WHERE p_scope ~ '^acct_[A-Za-z0-9]+:(test|live)$' AND p_as_of IS NOT NULL
 AND p_list IN ('new_customers','invoices','upcoming','failed','cancelled','refunds')
 AND p_limit BETWEEN 1 AND 50 AND jsonb_typeof(p_periods)='array' AND jsonb_array_length(p_periods) BETWEEN 1 AND 12
), periods AS (
 SELECT x.label,x.start_at,x.end_at FROM valid,jsonb_to_recordset(p_periods) AS x(label text,start_at timestamptz,end_at timestamptz)
 WHERE x.start_at<x.end_at AND x.end_at-x.start_at<=interval '32 days'
), accounts AS (
 SELECT a.stripe_customer_id,a.user_id FROM public.billing_accounts a,valid
 WHERE a.stripe_scope=p_scope AND a.verified_at IS NOT NULL AND a.verified_at<=p_as_of
), subs AS (
 SELECT s.*,a.user_id AS linked_user,
 EXISTS(SELECT 1 FROM public.billing_finance_subscription_items i JOIN public.billing_approved_prices p ON p.stripe_scope=i.stripe_scope AND p.stripe_price_id=i.stripe_price_id AND p.plan='pro'
 WHERE i.stripe_scope=p_scope AND i.stripe_subscription_id=s.stripe_object_id) AS pro
 FROM public.billing_finance_subscriptions s LEFT JOIN accounts a ON a.stripe_customer_id=s.stripe_customer_id AND s.user_id=a.user_id AND s.linkage_status='verified',valid
 WHERE s.stripe_scope=p_scope
), invoices AS (
 SELECT i.*,a.user_id AS linked_user,s.pro,
 EXISTS(SELECT 1 FROM public.billing_invoice_payments a JOIN public.billing_payments p ON p.stripe_scope=a.stripe_scope AND p.stripe_object_id=a.stripe_charge_id
 WHERE a.stripe_scope=p_scope AND a.stripe_invoice_id=i.stripe_object_id AND a.status='paid' AND a.amount_paid_minor>0 AND p.status='succeeded' AND p.paid AND p.captured AND p.amount_captured_minor>0 AND p.attribution_status='verified') AS payment_verified
 FROM public.billing_invoices i LEFT JOIN accounts a ON a.stripe_customer_id=i.stripe_customer_id
 LEFT JOIN subs s ON s.stripe_object_id=i.stripe_subscription_id AND s.stripe_customer_id=i.stripe_customer_id,valid
 WHERE i.stripe_scope=p_scope AND i.stripe_subscription_id IS NOT NULL
), first_paid AS (
 -- Rank across ALL observed history before period filtering. Never claim lifetime completeness.
 SELECT * FROM (SELECT i.*,row_number() OVER(PARTITION BY COALESCE(linked_user::text,stripe_customer_id) ORDER BY paid_at,stripe_object_id) AS position
 FROM invoices i WHERE status='paid' AND amount_paid_minor>0 AND paid_at IS NOT NULL AND payment_verified AND pro) x WHERE position=1
), item_context AS (
 SELECT DISTINCT ON (i.stripe_subscription_id) i.stripe_subscription_id,
 to_jsonb(i)||jsonb_build_object('quantity',i.quantity::text,'unit_amount_minor',i.unit_amount_minor::text,'unit_amount_decimal_minor',trim_scale(i.unit_amount_decimal_minor)::text,'effective_cycle_amount_minor',i.effective_cycle_amount_minor::text) AS item,
 count(*) FILTER(WHERE i.removed_at IS NULL) OVER(PARTITION BY i.stripe_subscription_id) AS current_count
 FROM public.billing_finance_subscription_items i,valid WHERE i.stripe_scope=p_scope
 ORDER BY i.stripe_subscription_id,(i.removed_at IS NULL) DESC,i.stripe_created_at DESC,i.stripe_object_id
), ended AS (
 SELECT s.*,COALESCE(s.ended_at,s.canceled_at) AS end_time FROM subs s
 WHERE s.status='canceled' AND COALESCE(s.ended_at,s.canceled_at)<=p_as_of AND EXISTS(SELECT 1 FROM invoices i WHERE i.stripe_subscription_id=s.stripe_object_id AND i.payment_verified AND i.status='paid' AND i.amount_paid_minor>0)
), recovery AS (
 SELECT s.*,i.stripe_object_id AS invoice_id,i.amount_remaining_minor,i.currency,i.attempt_count,i.next_payment_attempt_at,
 (SELECT max(a.occurred_at) FROM public.billing_payment_attempts a WHERE a.stripe_scope=p_scope AND a.stripe_invoice_id=i.stripe_object_id) AS failed_at
 FROM subs s LEFT JOIN LATERAL (SELECT i.* FROM invoices i WHERE i.stripe_subscription_id=s.stripe_object_id AND i.status IN ('open','uncollectible') AND i.amount_remaining_minor>0 ORDER BY i.stripe_created_at DESC,i.stripe_object_id DESC LIMIT 1) i ON true
 WHERE s.pro AND (s.status IN ('past_due','unpaid') OR (s.status='active' AND i.attempt_count>0))
), refunds AS (
 SELECT r.*,a.user_id AS linked_user,(SELECT min(i.number) FROM public.billing_invoice_payments ip JOIN invoices i ON i.stripe_object_id=ip.stripe_invoice_id WHERE ip.stripe_scope=p_scope AND ip.stripe_charge_id=r.stripe_charge_id HAVING count(DISTINCT i.stripe_object_id)=1) AS invoice_number
 FROM public.billing_refunds r JOIN public.billing_payments p ON p.stripe_scope=r.stripe_scope AND p.stripe_object_id=r.stripe_charge_id
 LEFT JOIN accounts a ON a.stripe_customer_id=p.stripe_customer_id,valid WHERE r.stripe_scope=p_scope AND r.status='succeeded'
), inventory AS (
 SELECT 'new_customers'::text AS kind,i.stripe_object_id AS id,i.paid_at AS occurrence,
 jsonb_build_object('id',i.stripe_object_id,'userId',i.linked_user,'date',i.paid_at,'status','paid','plan','Individual Pro','reference',i.number,'amount',i.total_minor::text,'currency',i.currency,'invoiceTax',i.tax_evidence,'item',c.item) AS row
 FROM first_paid i LEFT JOIN item_context c ON c.stripe_subscription_id=i.stripe_subscription_id
 UNION ALL
 SELECT 'invoices',i.stripe_object_id,i.finalized_at,jsonb_build_object('id',i.stripe_object_id,'userId',i.linked_user,'date',i.finalized_at,'status',i.status,'plan',CASE WHEN i.pro THEN 'Individual Pro' END,'reference',i.number,'amount',i.total_minor::text,'currency',i.currency,'invoiceTax',i.tax_evidence)
 FROM invoices i
 UNION ALL
 SELECT 'upcoming',s.stripe_object_id,(c.item->>'period_end')::timestamptz,jsonb_build_object('id',s.stripe_object_id,'userId',s.linked_user,'date',least((c.item->>'period_end')::timestamptz,s.cancel_at),'status',CASE WHEN s.cancel_at_period_end OR s.cancel_at IS NOT NULL THEN 'cancelling' ELSE 'upcoming' END,'plan',CASE WHEN s.pro THEN 'Individual Pro' END,'sub',to_jsonb(s),'item',CASE WHEN c.current_count=1 THEN c.item END,'currency',c.item->>'currency')
 FROM subs s JOIN item_context c ON c.stripe_subscription_id=s.stripe_object_id
 WHERE s.status='active' AND NOT s.collection_paused AND (s.ended_at IS NULL OR s.ended_at>p_as_of) AND (s.cancel_at IS NULL OR s.cancel_at>p_as_of) AND c.current_count>0 AND (c.item->>'period_end')::timestamptz>p_as_of
 UNION ALL
 SELECT 'failed',s.stripe_object_id,s.failed_at,jsonb_build_object('id',s.stripe_object_id,'userId',s.linked_user,'date',s.failed_at,'status',s.status,'amount',s.amount_remaining_minor::text,'currency',s.currency,'attempts',s.attempt_count::text,'nextRetry',s.next_payment_attempt_at)
 FROM recovery s
 UNION ALL
 SELECT 'cancelled',s.stripe_object_id,s.end_time,jsonb_build_object('id',s.stripe_object_id,'userId',s.linked_user,'date',s.end_time,'started',s.stripe_created_at,'status','cancelled','plan',CASE WHEN s.pro THEN 'Individual Pro' END,'item',c.item,'finalPayment',(SELECT jsonb_build_object('amount',i.amount_paid_minor::text,'currency',i.currency,'date',i.paid_at) FROM invoices i WHERE i.stripe_subscription_id=s.stripe_object_id AND i.payment_verified AND i.status='paid' ORDER BY i.paid_at DESC NULLS LAST,i.stripe_object_id DESC LIMIT 1),'reason',NULL)
 FROM ended s LEFT JOIN item_context c ON c.stripe_subscription_id=s.stripe_object_id
 UNION ALL
 SELECT 'refunds',r.stripe_object_id,r.succeeded_at,jsonb_build_object('id',r.stripe_object_id,'userId',r.linked_user,'date',r.succeeded_at,'status',r.status,'reference',r.invoice_number,'amount',r.amount_minor::text,'currency',r.currency,'reason',r.reason)
 FROM refunds r
), filtered AS (
 SELECT * FROM inventory r WHERE kind=p_list AND (kind IN ('upcoming','failed') OR EXISTS(SELECT 1 FROM periods p WHERE r.occurrence>=p.start_at AND r.occurrence<p.end_at))
), page AS (
 SELECT * FROM filtered WHERE p_after IS NULL OR id>p_after ORDER BY id LIMIT p_limit+1
), monthly AS (
 SELECT p.label,jsonb_build_object('label',p.label,
 'newCustomers',(SELECT count(*)::text FROM first_paid i WHERE i.paid_at>=p.start_at AND i.paid_at<p.end_at),
 'invoiceCount',count(i.stripe_object_id)::text,
 'gross',CASE WHEN count(i.stripe_object_id)>0 AND count(*) FILTER(WHERE i.currency<>'gbp')=0 THEN sum(i.total_minor)::text END,
 'vat',CASE WHEN count(i.stripe_object_id)>0 AND count(*) FILTER(WHERE i.currency<>'gbp' OR i.tax_evidence->>'status' IS DISTINCT FROM 'verified' OR i.tax_evidence->>'vatMinor' IS NULL)>0 THEN NULL WHEN count(i.stripe_object_id)>0 THEN sum((i.tax_evidence->>'vatMinor')::numeric)::text END,
 'net',CASE WHEN count(i.stripe_object_id)>0 AND count(*) FILTER(WHERE i.currency<>'gbp' OR i.tax_evidence->>'status' IS DISTINCT FROM 'verified' OR i.tax_evidence->>'netMinor' IS NULL)>0 THEN NULL WHEN count(i.stripe_object_id)>0 THEN sum((i.tax_evidence->>'netMinor')::numeric)::text END,
 'failedPayments',(SELECT count(*)::text FROM public.billing_payment_attempts a WHERE a.stripe_scope=p_scope AND a.occurred_at>=p.start_at AND a.occurred_at<p.end_at),
 'cancelledCustomers',(SELECT count(DISTINCT COALESCE(s.linked_user::text,s.stripe_customer_id))::text FROM ended s WHERE s.end_time>=p.start_at AND s.end_time<p.end_at),
 'refunds',(SELECT count(*)::text FROM refunds r WHERE r.succeeded_at>=p.start_at AND r.succeeded_at<p.end_at)) AS row
 FROM periods p LEFT JOIN invoices i ON i.finalized_at>=p.start_at AND i.finalized_at<p.end_at GROUP BY p.label,p.start_at,p.end_at
)
SELECT jsonb_build_object('items',COALESCE((SELECT jsonb_agg(row ORDER BY id) FROM (SELECT * FROM page ORDER BY id LIMIT p_limit) x),'[]'::jsonb),
 'nextAfter',CASE WHEN (SELECT count(*) FROM page)>p_limit THEN (SELECT id FROM page ORDER BY id OFFSET p_limit-1 LIMIT 1) END,
 'months',COALESCE((SELECT jsonb_agg(row ORDER BY label) FROM monthly),'[]'::jsonb),
 'activePaidCustomers',(SELECT count(DISTINCT b.user_id)::text FROM public.billing_subscriptions b JOIN accounts a ON a.user_id=b.user_id AND a.stripe_customer_id=b.stripe_customer_id WHERE b.stripe_scope=p_scope AND b.dmi_plan='pro' AND b.stripe_subscription_status='active' AND NOT b.terminal AND b.current_period_end>p_as_of),
 'recoveryCustomers',(SELECT count(DISTINCT COALESCE(linked_user::text,stripe_customer_id))::text FROM recovery),
 'undatedInvoices',(SELECT count(*)::text FROM invoices WHERE finalized_at IS NULL),
 'undatedRefunds',(SELECT count(*)::text FROM refunds WHERE succeeded_at IS NULL),
 'basis','observed_finance_history') FROM valid;
$report$;
REVOKE ALL ON FUNCTION public.admin_finance_v1_report(text,timestamptz,jsonb,text,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_finance_v1_report(text,timestamptz,jsonb,text,text,integer) TO service_role;
CREATE INDEX billing_invoices_scope_finalized_v1 ON public.billing_invoices(stripe_scope,finalized_at,stripe_object_id);
COMMIT;
