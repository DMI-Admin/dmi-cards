-- NOT APPLIED. Non-destructive containment/rollback: pause new foundation
-- operations while retaining projections, event receipts, attempts and history.
-- Use only with a foundation-aware application release. NEVER deploy the old
-- direct webhook upsert/deduplication writer as a fallback.
BEGIN;
REVOKE EXECUTE ON FUNCTION public.billing_foundation_command(text,text,uuid,uuid,jsonb) FROM service_role;
COMMIT;
-- Recovery after separate review: restore this function's EXECUTE grant to
-- service_role, then retry failed events and reconcile. Do not drop these tables,
-- clear attempts, erase event IDs, or roll back approved-price history.
