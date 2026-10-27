# Billing simplification — Phase 2 implementation design

Design only. Baseline `d9e19c3887919990f5aba4c2bb79cd207e9448ad`. Existing public billing is authoritative. Nothing here installs SQL, runs a worker, changes a route, creates a provider object or grants Pro. Phase 1 fixtures remain the behavioral contract. This document authorizes no cutover or hosted operation.

## Physical boundary

Current artifacts live only in `specs/billing-simplification/phase2/`. Future implementation lives in `experiments/billing-v2/`, with its own build/test configuration, outside the Next.js runtime graph. The eventual module list and file-by-file build order are in `plan.json`; those files do not exist yet. No application route, webhook, activation API or QStash configuration imports or dispatches V2 in Phase 2.

The future database namespace is **`billing_v2`**, never exposed through PostgREST and never included in public API search paths. It holds 15 isolated candidate tables with the same logical identities, not compatibility views over public tables. No synonyms, triggers on public tables, logical replication subscriptions, grants or existing-RPC rewrites connect it to live writes. Future Phase 3 event capture is a separately approved integration, not installed by these migrations.

Pure domain modules have no imports from current writers, SDK instances, DB clients, timers, environment, browser code or feature flags. Adapters accept read-only normalized Stripe snapshots and scoped persistence capabilities. Tests may reuse the existing Phase 1/current harness. Production builds must remain unable to reach either `experiments/billing-v2` or `specs/billing-simplification`.

## Physical schema draft

`schema.json` is the complete physical inventory: exact column types/nullability/defaults/immutability/enums, primary keys, explicit scoped foreign keys, unique constraints/index predicates, B-tree indexes, SQL CHECK expressions, transactional constraints and retention/security posture for each table. It is a JSON design, not executable DDL. Named validators and transaction triggers are specified by `rpc.json`; implementing them faithfully is a future PostgreSQL acceptance obligation.

| Logical table | Physical table |
| --- | --- |
| billing_accounts | billing_v2.accounts |
| billing_checkout_attempts | billing_v2.checkout_attempts |
| billing_price_catalog | billing_v2.price_catalog |
| billing_subscriptions | billing_v2.subscriptions |
| billing_event_inbox | billing_v2.event_inbox |
| billing_authority | billing_v2.authority |
| billing_operations | billing_v2.operations |
| billing_finance_subscriptions | billing_v2.finance_subscriptions |
| billing_finance_subscription_items | billing_v2.finance_subscription_items |
| billing_invoices | billing_v2.invoices |
| billing_payments | billing_v2.payments |
| billing_invoice_payments | billing_v2.invoice_payments |
| billing_refunds | billing_v2.refunds |
| billing_payment_attempts | billing_v2.payment_attempts |
| billing_finance_activity | billing_v2.finance_activity |

All FKs are same-scope, RESTRICT, deferrable initially deferred where bundles need insertion ordering. Nullable references use ordinary MATCH SIMPLE semantics; NULL is not an authorization shortcut. Finance retains **all** current FK/check relationships, not just the Phase 1 summary. Tax evidence and forecast anchors preserve the pinned tax validation, including nullable invoice tax. No JS floating-point money conversion is allowed. IDs remain private database data, never diagnostic labels.

Primary/unique indexes enforce scoped identity. Partial due-task indexes exclude completed work; expired-processing and exact dependency indexes support recovery. FK leading-column indexes prevent table scans during parent validation. No volatile `now()` in index predicates. No GIN indexes over private evidence. No partitioning initially: introduce it only on measured volume with reviewed global uniqueness/FK implications. Check EXPLAIN plans at 100k-account synthetic scale before claiming throughput or latency targets.

Checks cannot prove ownership or cross-row revision consistency alone: commit RPCs recheck binding, catalog and authority under locks. Deferred completion validation requires matching projection/result and one unique immutable completion audit. Immutability triggers reject evidence/key/identity edits and all audit UPDATE/DELETE. Run checkpoints are a separately typed mutable record inside operations, not a second receipt state machine.

Account principal references remain polymorphic: a transactional read-only resolver validates existing Individual profile/Business workspace ownership; there is no fictional FK to two tables. Foreign/unknown financial customers can be unresolved candidate accounts and cannot become entitled merely by sharing a customer ID. Verified bindings cannot be silently rebound.

## Database capability isolation

The future owner is `billing_v2_owner NOLOGIN NOBYPASSRLS`; it owns only the private schema and has no current public billing write privileges. Every table enables and forces RLS. Owner-only policies permit its definer RPC operations. `billing_v2_executor NOLOGIN NOBYPASSRLS` has USAGE and explicit RPC EXECUTE, no table access or public writer capability. A separately provisioned restricted connection role can assume executor; do not use the current broad service-role client for the shadow process.

`anon`, `authenticated` and PUBLIC receive no schema/table/function access. Existing `service_role` receives only USAGE plus the safe diagnostic read RPC, no V2 mutation RPC/table access. Explicit grants override revoked defaults only after signatures exist. Sequence access stays with the definer owner. All definer functions use `SET search_path=pg_catalog`, qualified objects, fixed argument schemas and no dynamic caller SQL. Catalog tests must verify inherited role privileges and every reachable legacy public writer: if public functions/role membership let the restricted login mutate current billing, revoke the isolated login's reach or STOP. RLS alone does not constrain a BYPASSRLS role; using service-role credentials for shadow invalidates the isolation proof.

This is a future security design, not a claim those roles or database settings currently exist. No credentials/configuration are created by this task.

## Inbox APIs and processing

`rpc.json` specifies exact function names, argument types/shapes, result enums, writes, guards and replay behavior. The core entry points are `admit`, `claim`, `reclaim_expired`, `wait_dependency`, `wait_retry`, `complete_subscription`, `complete_finance`, `mark_attention`, `read_result` and `diagnose`. They use one event_inbox row as the sole processing/completion state; no new receipt or routing tables exist.

Admission verifies signature and trusted runtime mode before any database access in the future capture boundary. SQL accepts only closed normalized evidence and derives valid task kinds. Dedupe key is `(scope,source_kind,source_id,task_kind)`; the server computes a versioned canonical normalized evidence digest. A duplicate returns the same task/result. Different immutable evidence under the same identity is quarantined/audited, never overwritten. Completed results cannot be reopened. Conflict handling locks the affected row and invalidates any unfinished holder generation. A source containing two projection tasks admits both atomically.

Claims take no event target. They scan `available_at ASC, arrival_sequence ASC` with SKIP LOCKED and account/domain authority. Readiness at snapshot time does not promise a claim. An unresolved account uses the **same task lease** for bounded read-only identity resolution; no business commit is allowed until authority is attached to the verified account. This does not add a persisted routing lifecycle. Known accounts acquire task and account authority together. Exact scope/account match is rechecked at every mutation. Capacity remains a bounded claim policy, not a long global mutex. Future tests must preserve required ordering/fairness and measure contention; this design makes no change to current routing caps, 250ms recheck, runner headroom or QStash.

Expired work is reclaimed by the same selection core, rereading the durable result under lock before replacing tokens. Completed → replay result. Still-processing expired → new token/generation. Lease expiry cannot prove a provider write did not commit. Retry/dependency budgets remain the Phase 1 proposals, not implemented by these specs. Structured contention reschedules without consuming failure budget. Dependency wake matches exact current proof/binding, with bounded durable fallback. No tight runner retry loop is introduced.

## Authority and atomic commit

`acquire_authority`, `touch`, `release`, private `assert_fence` and `handover` are specified in `rpc.json`. Authority stores engine/generation/reference, **not a second lease/token**. Its effective lease is the referenced task/checkout operation. Task/attempt lock → authority lock → sorted catalog/projection locks → audit is the common lock order. Work and provider I/O occur outside short DB transactions.

A holder must match scope/account/domain/engine, operation reference, task and authority generations, token, unexpired DB-time lease and expected projection/catalog revisions. Touch uses the same fence; expiry cannot be revived. Release atomically clears only its own reference and moves unfinished task to a future due state, never processing-without-lease. Cancellation/uncertain renewal stops mutation; reading a committed result remains safe.

Subscription commit transaction: validate holder and source/binding/catalog → stale/terminal/equal-time decision recheck → candidate projection revision/digest if changed → inbox completed/result → unique immutable completion audit → clear matching authority. Finance commit: validate current exact ownership and per-row revisions → bounded whole graph/provenance → same task completion/audit → authority release. Any failure, including audit failure, rolls back the entire bundle. Lost response reads the durable result, so completed tasks never repeat business effects. No-op/stale decisions complete and audit without fabricating projection revisions.

**Phase 2 engine is only shadow; authority mode is only shadow_only.** Candidate projection commits are isolated comparison data, not live financial/access authority. Live legacy/simplified engines fail schema constraints. Checkout prepare/record and handover return `blocked_phase2` without writes. Phase 1's prohibition on shadow owning live access/Finance authority remains intact.

Later atomic handover requires a separately reviewed bridge on every old checkout/binding/Entitlement/Finance/reconciliation/admin commit path. Drain claims, wait/fence holders, reconcile ambiguous provider intents, compare checkpoint digests, lock shared persisted bridge authority, increment generation and switch engine in one DB transaction. Old and new transactions must both check that same barrier. Environment flags or a barrier stored only in V2 cannot fence an unaware old writer. Rollback drains/fences V2, catches up the old projection to the new checkpoint, then increments/switches again. It cannot restore an old generation or simply flip UI reads. None of that bridge is created by Phase 2 migrations.

## Subscription synchronizer interface

`interfaces.d.ts` separates verified input, pure policy decision and persistence. Pure input includes trusted source evidence/time/digest, freshly verified Stripe subscription, customer/principal binding plus revision, current canonical projection, and approved catalog price/revision. Branded values are adapter-constructed; a TypeScript brand is not a security check.

Pure output is a candidate canonical/access decision with expected revisions and closed audit facts, or defer/attention. It does not grant features, write tables, complete tasks, perform I/O or invent new subscription policies. Existing active/trialing approved Pro, scheduled cancellation, terminal cancellation, past_due/unpaid, stale/equal timestamps, unknown price and owner rules remain frozen. Reconciliation supplies fresh snapshots without replacing event time with scan wall clock. Persistence rechecks volatile ownership/catalog/order/fence facts transactionally. It never trusts a caller's `plan: pro` alone.

The same policy can run against captured current-system fixtures, isolated V2 task execution and reconciliation. No second entitlement writer is introduced. UI/activation continue to read existing verified Pro authority exclusively.

## Finance projector interface

Finance is a separate task kind/account-domain and pure policy plus persistence port. Inputs are a scoped verified complete provider graph, existing normalized financial rows/revisions, customer binding, current invoice provenance and active catalog ownership. Outputs are closed row bundles for exactly the eight Finance tables plus ownership/audit facts, or defer/attention. Row/table/field allowlists and size limits are validated inside SQL; a generic JSON record in the type draft is not permission for arbitrary columns.

Charge/refund ownership requires its own exact invoice/payment/allocation relationship, complete anchors and active ownership revisions. A same-customer invoice cannot authorize a foreign charge. Provenance changes are versioned; revocation invalidates it. Preserve discount, tax completeness, collection-time provenance, immutable linkage and stale activity rules. Refunds/failed attempts remain reporting facts; no new refund revokes Pro policy is invented.

Access and Finance commit separately. If access succeeds and Finance defers, Pro becomes available through the current authoritative system while candidate Finance remains visible as retry/dependency/attention. No Finance transaction holds access authority or gates a successful activation redirect. Phase 2 has no provider creation/update/refund endpoint or side effect capability.

## Shadow architecture and comparison

Phase 2 first runs offline captured fixtures and local PostgreSQL. A future Phase 3 read-only capture adapter extracts admitted evidence and **the verified provider snapshots used for a specified checkpoint**, not an unrelated later Stripe state. No live webhook coupling is installed yet. Capture must cover all admitted event families; a lossy best-effort after-hook is insufficient. Durable scan watermark/overlap/replay through deterministic task identities supplies catch-up. A completeness gap is reported, never silently treated as equivalence.

Flow: verified captured envelope + associated observed provider state → isolated candidate admission/processing → pure domain + private V2 projection → normalized comparison → operations audit with kind shadow_comparison. Comparison captures baseline/candidate code versions, scope, source correspondence digest, source projection revisions, catalog/binding revision, source snapshot watermark, candidate watermark and observation timestamps. Raw IDs remain private correspondence, not logs. Exported diagnostics contain fixed labels/counts/durations only.

Use Phase 1 normalized comparison outcomes exactly. No target output → missing_projection; ownership mismatch is never representation-only; extra business/provider effects dominate. Normalize money as strings and exact relationships by private correspondence keys. A candidate computed from a different provider/catalog checkpoint is **not comparable yet**: record run coverage as partial and wait/recapture both baselines; never mislabel a timing race equivalent or policy_mismatch without matched inputs. Comparison records themselves use only the six approved outcomes once comparable; incompleteness is a run/checkpoint condition, not a seventh equivalence verdict.

Billing/activation/customer UI perform no V2 read. There is no live fallback from current tables to V2. The comparison tool can dual-read private snapshots with read-only capability; it cannot route customer requests or return candidate `proReady`. Domain decisions saying Pro do not grant it.

## Backfill and historical preservation

Initial seed uses an explicit Staging-only, read-only, transactionally consistent snapshot of current billing. Record scope, baseline code/schema versions, snapshot/checkpoint boundary, each table count/digest, catalog/ownership revisions and private source correspondence. No provider calls/mutations or source table writes are required for this seed. Subsequent missing provider evidence is marked unresolved, never guessed from metadata or timestamps.

Copy in dependency order: catalog and accounts → canonical and Finance subscriptions → items/invoices/payments → allocations/refunds/attempts/activity → historical typed operations. For seed data, import historical facts as immutable backfill audits, not synthetic successful consumption of real events. If seeding completed inbox rows is later needed, it must have the real matched normalized evidence plus unique completion audit/projection result; otherwise omit it and keep the source audit reference. Operations retain archived source-row digests, fixed statuses and private correspondence; raw legacy payload/archive lives in restricted retained export, not logs.

| Source family | Seed rule |
| --- | --- |
| Accounts/customer bindings | Preserve exact scoped verified owner; unresolved/conflicting binding remains unresolved/attention. Never invent principal ownership. |
| Checkout attempts | Copy frozen parameters/key/original timestamps and provider result references only. No active token/lease. Ambiguous/live in-flight intent stays quarantined, no V2 provider call. Never import client secrets. |
| Approved price + ownership registry | Merge only exact scoped prices/application/revisions, active/revoked state and entitlement/checkout flags; unknown non-price registry entries block completeness, not silently dropped. |
| Canonical subscriptions | Preserve owner/customer/status/terminal/order/revision/digest; verify approved price linkage. Multiple eligible subscriptions remain a review conflict. |
| Finance subscriptions/items | Preserve all normalization, valuation, tax/discount facts and revisions; no inferred missing rows. |
| Invoices/payments/allocations/refunds | Preserve exact natural keys/currency/amounts/linkage/revisions. Provenance usable only if all imported anchors and registry revisions validate together. |
| Failed attempts/activity | Preserve deterministic keys and occurrence/provenance, not derived duplicate activity. |
| Receipt/work/protocol/scan/audit history | Archive original identities/status/digests/cursors; normalize history into typed backfill operation facts without claiming reconstructed before-state. Keep original tables/archive through rollback window. |

Never copy active leases, tokens, scheduler generation values as a valid new authority, protocol epochs as a new commit capability, or unresolved receipt state as proof of non-commit. New engine generation starts isolated; prior generations survive only as historical facts. Copying a current lease into an idle shadow account would accidentally resurrect authority and is prohibited.

Run/page IDs and source snapshot generation make import idempotent. Each bounded page's destination facts, digest verification and cursor checkpoint commit together. Restart from the last verified checkpoint. Source snapshot TTL/connection loss requires a fresh whole snapshot generation; do not mix pages from inconsistent snapshots. A partially imported generation is unavailable to comparison/runner until FK/ownership/count/digest validation completes. Any existing candidate rows with a different snapshot digest require a new isolated import generation/rebuild after archive; never overwrite evidence in place. Source tables remain intact, so rollback from incomplete backfill is stopping tooling and abandoning the candidate generation, not reversing live writes.

A snapshot is followed by read-only delta capture with overlap from its watermark. Correlate changes by stable source identities/revisions, not wall time alone. A durable record after the watermark can describe an event created before it. Reconciliation discovery must include known customers' provider inventory and local mirrors, report partial coverage and enqueue deterministic intents into the same candidate path. No direct competing repair writer.

## Migration and build plan

`plan.json` names three future additive migrations, dependencies, function placement and rollback expectations. None is created in `supabase/migrations` now. The proposed timestamp names are reserved design names and must be checked for collision before implementation. Validators precede table CHECKs; tables precede transaction functions/triggers; final grants follow all definitions. Default privileges are revoked before creation so there is no temporary publicly executable definer window.

Build order is file-by-file in `plan.json`, with Phase 1 fixture IDs as acceptance gates for every step: pure types/policy → isolated schema → adapters → claims/authority/atomicity → synchronizer → Finance → shadow runner → comparisons → backfill → full validation. Checkout and handover remain blocked; their Phase 2 tests prove denial, not an implemented live handover or a new checkout creation path. Full handover and lost-provider-response equivalence remain mandatory later gates before authority cutover.

Local acceptance requires actual two-connection PostgreSQL concurrency/fault tests, not regex-only schema assertions: lost response after commit; rollback before audit; process death before/after transaction; stale token/engine/expiry; catalog revoked between read and commit; duplicate/different evidence; owner conflict; exact proof mismatch; restart/cursor loss; role privilege attacks; no provider mutations; no current-table writes; 100% deterministic fixture equivalence for implemented shadow features. Keep current 46 offline validators, TypeScript, lint, production build and Phase 1 checks green. Phase 2 design checks are structural and negative tests only; they do not prove unimplemented SQL.

## Complexity estimate and limits

Current baseline: 24 core tables, 52 SQL functions, 102 dedicated source files, approximately 10,452 physical source LOC. Target: 15 core tables, 28 planned SQL functions (including private validators/triggers), 22 runtime modules, about 4,300 runtime LOC budget plus 1,500–2,200 SQL LOC. `plan.json` is the exact module/function counting source; budgets are estimates, not measured new implementation. Tests/specs/generated data are excluded on both sides where comparable; baseline source physical LOC includes its large literal evidence definitions, so percentage code reduction is approximate.

The target has three explicit operational lifecycles: inbox task, provider operation attempt and scan run checkpoint. Only the inbox is event processing/completion authority. One canonical operation lease family plus one account/domain generation/reference primitive replaces multiple task/receipt/routing/partition/account/scope lease families. Authority handover mode is a migration guard, not another receipt. Current distinct lifecycles include scheduler work, both consumer receipts, checkout intent, Finance protocol and the two scan-run histories; do not count each enum field as a separate state machine.

No tables/functions are removed in Phase 2. Side-by-side candidate storage temporarily means 24 + 15 = 39 core tables (plus unchanged Business tables), with added candidate functions until retirement. Reduction is an eventual outcome after equivalence and rollback expiry, not a Phase 2 result. Throughput at 10k/100k users depends on arrival rate, provider pagination and measured database/worker capacity; account partitioning avoids global serialization but is not a capacity proof.

## Risk decisions

| Risk | Required prevention / STOP gate |
| --- | --- |
| Duplicate provider effects | Read-only capability, blocked checkout APIs and no raw SDK escape. Later checkout uses original frozen intent/key. Lost-response uncertainty never means fresh key. |
| Stale commits | Atomic token/generation/engine/expiry/reference/revision recheck; real concurrent expiry/renew/commit tests. |
| Old/new overlap | Private shadow namespace only now. Later EVERY old writer must check shared persisted bridge; absent bridge blocks cutover. |
| Evidence conflict | Immutable digest/dedupe identity, audited quarantine, terminal result never overwritten. |
| Reconciliation divergence | Same pure synchronizer/projector, matched checkpoint/catalog/provider snapshots, deterministic tasks and complete coverage accounting. |
| Finance mismatch | Preserve exact normalized fields/checks/FKs/tax/ownership proof; shared-customer matches are insufficient; zero access coupling. |
| Historical audit loss | Retain current tables and restricted snapshot archive through rollback; deterministic imported audit digests; never invent history. |
| Partial backfill rollback | Unavailable candidate generation until validation; stop/discard isolated generation after archive, never reverse source writes. |
| Privilege leakage | Restricted login/owner/executor, forced RLS, no schema exposure, catalog privilege tests including PUBLIC execute and inherited roles. |
| Different snapshots look like policy drift | Compare only matched observation checkpoints; partial coverage remains visible, never claimed equivalent. |

Production impact: NONE. Phase 2 implementation is local/isolated first; deploying shadow tooling, provisioning credentials, Phase 3 event capture and authority cutover each require a later explicit rollout task. No UX or scheduler tuning is part of this design.

Phase 1 gates are not weakened: a blocked handover/checkout test is not full handover/lost-provider-response equivalence. Those fixtures remain outstanding for actual V2 authority and Phase 3 gate review until separately authorized work satisfies them. A Phase 2 build verdict alone cannot open Phase 3 or cutover. Imported in-flight attempts normalize to quarantined attention/ambiguous with no lease, preserving their original status/key/time in immutable historical facts.

Initial-seed readiness is an explicit database gate: the migration-domain `shadow_dataset` authority row points to a completed, count/digest/FK-validated backfill operation. Starting a new seed requires zero active candidate holders, clears that pointer and increments dataset generation; ordinary claims refuse until the new complete manifest is published. Comparisons retain the manifest generation. Only one candidate dataset generation occupies this schema at a time; a fresh seed after an abandoned import requires archived isolated rebuild, never mixing snapshots or touching public tables.

Intermediate audit keys include operation/task, fixed stage and claim generation. Completion uses a single task:completed identity and a partial unique index on scoped task completion audit, so claim/deferral/wake records cannot collide with successful completion. Both claim entry points use the same candidate union/order: reclaim is not an expired-work priority override.
