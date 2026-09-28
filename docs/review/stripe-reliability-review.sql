-- REVIEW ONLY. Read-only diagnostics; do not execute against hosted databases
-- without separate authorization. No customer data or secrets are selected.
SELECT state,outcome,last_error_code,count(*) FROM public.stripe_webhook_events
GROUP BY state,outcome,last_error_code ORDER BY state,outcome;
SELECT count(*) FILTER (WHERE stripe_scope IS NULL) AS legacy_unscoped,
       count(*) FILTER (WHERE verified_at IS NULL) AS unverified,
       count(*) FILTER (WHERE terminal) AS terminal
FROM public.billing_subscriptions;
SELECT stripe_scope,entitlement_enabled,checkout_enabled,count(*)
FROM public.billing_approved_prices GROUP BY stripe_scope,entitlement_enabled,checkout_enabled;
SELECT mode,outcome,count(*) FROM public.billing_sync_runs GROUP BY mode,outcome;
SELECT relname,relrowsecurity FROM pg_class WHERE oid IN
 ('public.billing_accounts'::regclass,'public.billing_approved_prices'::regclass,
  'public.billing_sync_runs'::regclass,'public.billing_subscriptions'::regclass);
SELECT has_function_privilege('authenticated','public.billing_foundation_command(text,text,uuid,uuid,jsonb)','EXECUTE') AS browser_must_be_false,
       has_function_privilege('service_role','public.billing_foundation_command(text,text,uuid,uuid,jsonb)','EXECUTE') AS worker_enabled;
