BEGIN;

CREATE TABLE public.system_health_check_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  environment text NOT NULL CHECK (environment IN ('staging', 'preview', 'production', 'development', 'local')),
  service_key text NOT NULL CHECK (service_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  check_key text NOT NULL CHECK (check_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  status text NOT NULL CHECK (status IN ('operational', 'degraded', 'incident', 'unknown', 'not_configured', 'not_migrated')),
  severity text NOT NULL CHECK (severity IN ('none', 'info', 'warning', 'critical')),
  checked_at timestamptz NOT NULL,
  verified_at timestamptz,
  duration_ms integer CHECK (duration_ms IS NULL OR duration_ms >= 0),
  reason_code text CHECK (reason_code IS NULL OR reason_code ~ '^[a-z][a-z0-9_]{0,95}$'),
  safe_summary text CHECK (safe_summary IS NULL OR length(safe_summary) <= 240),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(evidence) = 'object'),
  deployment_ref text CHECK (deployment_ref IS NULL OR deployment_ref ~ '^[a-f0-9]{7,12}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT system_health_check_runs_run_service_check_key
    UNIQUE (run_id, service_key, check_key)
);

CREATE INDEX system_health_check_runs_environment_service_checked_idx
  ON public.system_health_check_runs (environment, service_key, checked_at DESC);

CREATE INDEX system_health_check_runs_environment_checked_idx
  ON public.system_health_check_runs (environment, checked_at DESC);

ALTER TABLE public.system_health_check_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.system_health_check_runs FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.system_health_check_runs TO service_role;

CREATE FUNCTION public.prune_system_health_check_runs(
  p_environment text,
  p_cutoff timestamptz,
  p_batch_size integer DEFAULT 500
) RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  deleted_count integer;
BEGIN
  IF p_environment NOT IN ('staging', 'preview', 'production', 'development', 'local')
    OR p_cutoff IS NULL
    OR p_batch_size IS NULL
    OR p_batch_size < 1
    OR p_batch_size > 500 THEN
    RAISE EXCEPTION 'SYSTEM_HEALTH_RETENTION_ARGUMENT_INVALID';
  END IF;

  WITH candidates AS (
    SELECT id
    FROM public.system_health_check_runs
    WHERE environment = p_environment
      AND checked_at < p_cutoff
    ORDER BY checked_at ASC, id ASC
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  )
  DELETE FROM public.system_health_check_runs AS runs
  USING candidates
  WHERE runs.id = candidates.id;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.prune_system_health_check_runs(text, timestamptz, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_system_health_check_runs(text, timestamptz, integer)
  TO service_role;

COMMIT;
