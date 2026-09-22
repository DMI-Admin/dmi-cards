# Cleanup scheduling proposal — NOT enabled

Production source: main f32f8224940d71f34f2f232ee92c87499b65a7ba includes reviewed
backend commit 285617af1662929141d8081b611309082158fbbc. Migrations already applied;
do not replay them. No cleanup invocation is part of deployment.

Local-only endpoint: GET /api/internal/card-media-cleanup. Node runtime, no-store,
120-second function budget, ten-second network timeouts, one worker invocation with
fixed limit 5. No query parameters; no caller-selected UUID/batch size. Existing
worker stops starting new candidates after 25 seconds; an in-progress candidate may
finish afterward. Service-role credentials remain server-side.

Requires Production-only CRON_SECRET (random, at least 32 characters). Exact Bearer
comparison uses timingSafeEqual; missing/incorrect secret fails before database access.
Also requires VERCEL_ENV=production and exact approved Production Supabase URL.
Existing Supabase server variables are reused. Clerk Admin allowlisting is not used
for this machine endpoint; Clerk middleware currently permits non-Admin API routes.

The following vercel.json configuration is prepared locally. Commit/push/Production
deployment still require explicit approval; no schedule is active yet:

```json
{
  "crons": [
    { "path": "/api/internal/card-media-cleanup", "schedule": "*/15 * * * *" }
  ]
}
```

Vercel API independently confirmed dmi-admin, team dmi-cards-projects, plan Pro,
and project dmi-cards in that team. Pro supports this frequency. No existing scheduler was found
in repository source/configuration. Cron runs against Production; do not enable a
second scheduler. UTC cadence is every 15 minutes; no minimum throughput guarantee.

Do not assume single execution: database leases/tokens, global reference checks and
session row locks remain authoritative under overlap. No in-process lock is relied on.
No inline retry loop. Storage failures keep normal 15-minute backoff; crash recovery
uses the five-minute lease. Vercel does not automatically retry failed cron invocations.
A failed/stale result returns 503 with safe counters; exception returns generic 503.

Monitoring: one structured card_media_cleanup event with duration, status and all
worker counters (deleted, alreadyAbsent, skippedReferenced, failed, retried,
sessionsPruned, candidates, claimed, deferred, staleInvalid). No paths, user data,
secrets, tokens or raw errors. Retain Vercel runtime logs; confirm retention before
activation and configure an existing log drain if longer history is required.
Alert on failed/stale runs and no completion for two intervals (30 minutes), monitor
backlog age separately read-only. Alert routing/log drain is not configured by this
change. Verify the first scheduled invocation's counters; never compensate for failure
with an unbounded retry. Disable the schedule first if a safety failure is observed.

Activation still requires explicit approval to commit/push and deploy. The endpoint,
tests and cron configuration remain local until then. Production CRON_SECRET is
provisioned separately as Sensitive/Production-only without storing it in source or
local environment files. Adding the secret alone does not enable the schedule.
