# Card media cleanup — local review, not scheduled

No SQL or Storage operations have been executed. Customer-facing code is unchanged.

## Activation prerequisites

1. Review/apply Cards authenticated direct-write hardening separately. The worker refuses
   to run if anon/authenticated or any membership path retains direct table/column writes,
   or protected RPC execution. Do not reopen grants to make cleanup run.
2. Review the additive `20260922130000_add_card_media_cleanup_worker.sql` in isolated
   staging. Existing Stage A/owner/finalizer/snapshot RPCs remain unchanged.
3. Apply locally prepared migration to staging only after approval. Verify below, then
   exercise actual Storage and separate-connection races before Production authorization.
4. No automatic route/schedule exists. The manual runner requires exported server env
   `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and explicit target confirmation:
   `node scripts/run-card-media-cleanup.mjs --execute --project-ref=<approved-ref> --batch=20`.
   It does NOT load any env file. Do not run it against Production without approval.

## Algorithm / invariants

Candidates are due assets ordered by cleanup_after/id, at most 20 (hard cap 50).
Owner advisory/session/asset locks match finalization. Global references include all
cards, all statuses, and all three canonical fields, irrespective of owner/visibility.
Referenced assets are deferred 24h. Unreferenced attached assets use the existing
retirement RPC and its 24h grace; card/account deletion alone never authorizes deletion.
Expired reserved/ready assets use the existing claim RPC. Pending unexpired uploads
are deferred unless their Auth owner has been deleted. Session expiry remains Stage A's
48h; no finalized receipt is removed.

A 5-minute token lease fences duplicate workers and completion. Before Storage remove,
the worker rechecks token/state/global references. Deleting/deleted assets cannot be
reattached by approved finalization. This is why direct-write hardening is a prerequisite.
Trusted service-role callers must also keep using the approved finalizer; a rogue service
role/database owner can bypass this or any RLS-based design and is outside this boundary.

Storage metadata lookup confirms existence. Only explicit 404/NoSuchKey is absent; generic
400,403,network errors fail closed. One exact generated object path is removed. A second
metadata check confirms absence before completion. Unknown outcomes remain retryable.
Failed attempts release the lease with 15-minute backoff; crashes recover at lease expiry.
The runner gives each network call a 10-second abort signal and stops starting assets after
25 seconds. A currently running asset can take longer; there is no unbounded loop.

Deleted asset rows and their sessions/receipts are retained as durable tombstones. Daily
bounded tombstone reconciliation catches uploads that were already in flight when expiry
cleanup occurred. Empty pending/expired sessions older than expiry+7 days can be pruned,
under session locks, only if no assets and no finalization receipt exist. Assets with
history are never purged. No bucket-wide listing/deletion is performed; unexpected objects
without registry rows need a separate read-only inventory, not speculative deletion.

Counts: candidates, claimed, deleted, alreadyAbsent, skippedReferenced, failed, retried,
staleInvalid, deferred, sessionsPruned. Counts contain no identities/paths/secrets.
`retried` includes recurring tombstone reconciliation, not solely earlier failures.

## Staging verification (must still be performed)

Use designated fixtures only. Test real object removal/absence and resulting state;
attached/finalized assets and references from another card must survive. Repeat after
Storage denial/network failure; kill a worker after remove before completion and retry.
In independent database connections test finalizer-wins and cleanup-wins, retirement vs
replacement, duplicate claims and expired tokens. Finalizer must reject deleting assets;
wrong/stale token must never complete. Confirm zero writes when security preflight fails.
Test a delayed upload arriving after deleted, then daily reconciliation removes it.
Check pruning retains receipts and sessions with even one tombstone. DDL/security proof
requires a database: local mock/static tests are not a substitute.

## Rollback / operations

Stop invocations first; wait at least 5 minutes and ensure no worker is active. Run the
separate rollback file only after review. It removes only new worker functions/index/
lease columns. It does not restore deleted bytes or revert lifecycle state. Existing
claim/finalizer protections remain. Restoring deleted media is not an ACL rollback:
physical deletion is irreversible without an independently retained backup.

Start with one bounded batch every 15 minutes after staging/Production approval. Observe
backlog age, failures, referenced skips and lease expiry. Increase batch/frequency only
from evidence. 24h grace remains intact. No schedule is created by this implementation.
Daily checks of tombstones/attached references consume batch capacity at large scale;
monitor backlog before increasing volume. Registry/receipt metadata intentionally grows
for idempotency/history; Storage bytes are reclaimed. Metadata compaction is separate.

## Controlled exact-asset trial

After separate approval of the target and exact UUID, use:

```sh
node scripts/run-card-media-cleanup.mjs --execute --project-ref=<approved-ref> --asset-id=<approved-asset-uuid>
```

This mode does not call candidate discovery or session pruning. It rejects a simultaneous
`--batch`, malformed/duplicate arguments and invalid UUIDs before opening a connection.
The boundary is verified first; only the exact row is read immediately before the locked
claim, which rechecks eligibility with database time. The existing global-reference/token
check still runs immediately before deletion. No alternative asset is selected on failure.
A skipped, deferred, stale, invalid or failed exact run exits unsuccessfully with safe counters.
API statusCode "404" (including HTTP 400) remains confirmed absence; generic errors retry.
Batch mode is unchanged and requires separate authorization. This command is documentation,
not approval to execute cleanup.
