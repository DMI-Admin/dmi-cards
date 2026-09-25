-- LOCAL REVIEW ONLY. Never discard commercial receipts. Run only before any activation.
BEGIN;
SET LOCAL lock_timeout = '5s';
LOCK TABLE public.business_onboardings IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.business_workspaces, public.business_entitlements, public.business_entitlement_events IN ACCESS EXCLUSIVE MODE;
DO $rollback$
BEGIN
 IF EXISTS(SELECT 1 FROM public.business_workspaces)
 OR EXISTS(SELECT 1 FROM public.business_entitlements)
 OR EXISTS(SELECT 1 FROM public.business_entitlement_events) THEN
  RAISE EXCEPTION 'BUSINESS_ROLLBACK_REFUSED: commercial history exists; use a reviewed forward repair';
 END IF;
END;
$rollback$;
DROP TRIGGER business_onboarding_commercial_guard ON public.business_onboardings;
DROP FUNCTION public.admin_command_business_entitlement(uuid,uuid,text,jsonb);
DROP FUNCTION public.get_business_entitlement(uuid,integer);
DROP FUNCTION public.protect_activated_business_proposal();
DROP TABLE public.business_entitlement_events;
DROP FUNCTION public.protect_business_entitlement_event();
DROP TABLE public.business_entitlements;
DROP TABLE public.business_workspaces;
COMMIT;
