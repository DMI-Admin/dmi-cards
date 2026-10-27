# Billing V2 local foundation — non-authoritative

Specification baseline commit: `ff086a32b381c600903a0cce2afed1c07bfb2bd8` (pushed alone). Implementation remains local/uncommitted. No hosted billing connection, provider client, live runner, route, environment loader, browser feature read or deployment is present.

## Implemented boundary

`src/lib/billing-v2` contains nine isolated modules: normalized types, pure subscription policy, closed schema/Finance metadata, pure Finance policy, existing-checkout intent observation, application composition, injected PostgreSQL persistence, six-outcome shadow comparison and dry-run backfill planning. Existing application source and SQL remain byte-identical to the pre-simplification baseline. No current route/worker/activation/Billing read imports V2.

Candidate `plan=pro` is a private comparison fact. It cannot grant access: UI reads current public authority, restricted V2 roles cannot write current tables/functions, no V2 route exposes it and the schema is unexposed. The adapter constructs only fixed `billing_v2` RPC calls. It has no connection factory, credentials, provider SDK, fetch or environment access. Transport uncertainty is surfaced as a fixed ambiguous result; it is never automatically replayed with a new identity.

## Migrations — local only

- `20261027000100_billing_v2_shadow_schema.sql`: private schema, two restricted NOLOGIN roles, pinned pure tax/document validation, all 15 tables/FKs/indexes/checks and forced RLS.
- `20261027000200_billing_v2_task_transactions.sql`: one inbox lifecycle, shared claim/reclaim, canonical operation lease and generation authority, atomic subscription/Finance completion plus audit, bounded retry/dependency handling and immutable/deferred-completion guards.
- `20261027000300_billing_v2_shadow_operations.sql`: exact matching dependency wake, safe diagnostics, comparison/checkpoint APIs, fixture seed gate and explicit executor grants.

All writes are to `billing_v2`. The 28 planned entry/helper functions use four additional private implementation helpers (tax validation, bounded row application, task deferral and task finish): **32 SQL functions total**, not 32 public APIs. Functions use fixed search paths; row application uses closed table/column names. No existing table, function, role, trigger or protocol is altered. Schema creation fails on pre-existing names rather than masking drift. No migrations were applied to Staging.

RLS is enabled/forced; anon/authenticated have no access. Existing service_role can call only safe diagnostics, not mutations or table reads. The executor has explicit entry-point EXECUTE and no direct table privileges. Private helpers and triggers are not executable by it. Test connections use a fresh private Unix socket with TCP disabled, never a URL or environment connection string.

## Transaction and recovery behavior

Task claims use due-time/arrival ordering, skip locked task rows and account/domain ownership. Access and Finance have independent domains. A holder must match scope, account, engine, operation reference, claim and authority generations, token and unexpired DB-time lease. Expired/replaced holders cannot renew, release or commit. Current task completion/result is checked before duplicate mutation.

Projection, semantic revision, terminal task result, authority release and unique immutable audit commit in one transaction. Deferred checks reject completion without its matching audit/projection. Lost acknowledgement can be resolved through read_result; retry sees completed and produces no new projection/activity. Audit failure rolls back the entire projection/completion transaction.

Retry limits/backoff use the reviewed Phase 1 proposal (12 failures/24h); contention release does not count as failure. Dependency wait uses exact invoice/subscription/account/charge references, explicit proof wake and bounded five-minute fallback, then attention at the deadline. No event targeting, provider replay or long-running worker loop exists. Needs-attention/completed tasks do not reopen. Checkout mutation and handover APIs remain blocked_phase2.

Finance supports all eight scoped projections with lossless money, current invoice/customer/subscription/payment/allocation/catalog anchors and current certificate checks. Exact invoice proof wakes matching charge dependencies. A shared customer alone never authorizes a charge. Access transactions remain committed when Finance defers/fails. Copied normalization/tax contracts remain covered by existing regressions.

## Offline comparisons and limitations

`equivalence.mjs` exercises all 35 Phase 1 fixture definitions. 31 existing-behavior cases compare normalized policy facts against current real-module harnesses/resolvers/normalizers; four future-only cases are classified separately. This is not a claim of live shadow equivalence or full transaction-history equivalence. PostgreSQL tests separately exercise real persistence, atomicity, role denial, stale holders, duplicate/lost responses and all eight Finance projections.

The lost-checkout fixture compares observation/resumption of an existing frozen key/parameters/Session. V2 has no Session creation/replay capability. The four future-only cases are crash-after-commit (new atomic invariant tested locally), handover (blocked), shadow (offline comparison only), and broader reconciliation discovery (not a live scheduler). No Phase 3/cutover gate is declared satisfied.

Backfill planning accepts digest-checked normalized snapshots or supported current exports, preserves natural IDs/revisions/attempt keys/times, refuses inconsistent ownership/missing FK parents/incomplete invoice certificates, and returns deterministic candidate pages/manifests. Resume cursors bind to snapshot generation. Current price exports require captured read-only interval/product evidence because billing_approved_prices does not contain it. Historic receipts/leases/protocol/audit records become private archive references, never active authority. No database or filesystem write occurs in the planner.

The SQL backfill_page entry point is deliberately a bounded **fixture account/catalog seed** for local tests, not a full hosted import executor. Actual backfill execution, live capture, live discovery, connection provisioning, authority bridge/cutover and provider-operation dispatch remain outside this task. Unresolved identities park; no live route or browser request can reach this code.

## Validation commands

From repository root:

```sh
node specs/billing-simplification/local/validate.mjs
node specs/billing-simplification/local/equivalence.mjs
node specs/billing-simplification/local/postgres.mjs /absolute/postgres/bin /absolute/pg/module
node specs/billing-simplification/phase1/validate.mjs
node specs/billing-simplification/phase2/validate.mjs
```

The local boundary manifest pins every new source/migration and the narrow validator edits. It preserves all old runtime/migration hashes and rejects unrelated paths/imports. Two existing migration guards recognize only these exact three new SQL hashes; unknown additions, old edits and changed/missing approved migrations remain rejected. All business assertions in existing validators remain intact.

No deployment, hosted SQL, Stripe/QStash/Vercel/Supabase access, worker invocation, Production action or implementation push is authorized by this README.

Unresolved customer evidence creates only an unresolved candidate account; binding requires the access fence and verified input. Missing identity uses the same task-only resolution lease and cannot commit a projection. Expired-processing reclamation has a bounded age, confirmed SQL failures defer through the retry/dependency policy, and transport ambiguity never triggers a new operation. Final PostgreSQL acceptance: 34/34 checks.
