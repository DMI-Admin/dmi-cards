BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE INDEX stripe_webhook_events_scope_created_idx
ON public.stripe_webhook_events USING btree
  (stripe_scope, created_at);

CREATE INDEX stripe_webhook_events_unresolved_scope_created_idx
ON public.stripe_webhook_events USING btree
  (stripe_scope, created_at)
WHERE state <> 'processed';

COMMIT;
