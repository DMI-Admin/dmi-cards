-- Manual, separately authorized rollback only. No CASCADE, no operational objects.
-- Disable onboarding application entrypoints first. If rows exist, export/review
-- them and prepare a separate approved data-retention plan; this script aborts.
BEGIN;
SET LOCAL lock_timeout = '5s';
LOCK TABLE public.business_onboardings IN ACCESS EXCLUSIVE MODE;
DO $rollback$
BEGIN
 IF EXISTS (SELECT 1 FROM public.business_onboardings) THEN
  RAISE EXCEPTION 'Rollback refused: onboarding rows require an approved retention plan';
 END IF;
END;
$rollback$;
DROP TABLE public.business_onboardings RESTRICT;
COMMIT;
