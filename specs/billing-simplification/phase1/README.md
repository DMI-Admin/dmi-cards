# Billing simplification — Phase 1 behavioral contract

Status: specification and test artifacts only. Baseline: `d9e19c3887919990f5aba4c2bb79cd207e9448ad`.
No artifact in this directory may be imported by application code, installed as SQL, acquire authority, grant access, call a provider, or become a scheduled process. No new runtime or shadow runtime exists here. Existing Staging and Production behavior remains authoritative.

Run from repository root:

```sh
node specs/billing-simplification/phase1/validate.mjs
```

`schema.json` is the proposed schema contract, not a migration. `behavior.json` defines state transitions, closed outcomes, proposed budgets and measurable gates. `fixtures.json` contains synthetic normalized expected outcomes; `current-system.mjs` runs supported scenarios through the existing real-module offline harness. `comparison.mjs` only validates and compares fixture-shaped observations; it is not a synchronizer. `baseline.json` pins runtime and migrations against changes during this phase. Refreshing that baseline requires review, never an automatic validator repair.

## Frozen current authority

| Responsibility | Current authority and entry points |
| --- | --- |
| Signature, trusted mode, admission | `src/app/api/stripe/webhook/route.ts`: signature → `stripeWebhookModeDecision` → consumers/handoff. Signed wrong-mode events return 200/skip before DB; unknown runtime returns 503. Hostname is not trust; platform events need not contain `event.account`. |
| Durable scheduling | `billing_consumer_work_admit` and `billing_consumer_worker_*` SQL; `executeBillingWorker` in `billing-work-worker.ts`, store/runtime in `billing-work-store.ts` and `billing-work-runtime.ts`. Existing caps, ordering, partition generations and SQL fencing remain authoritative. |
| Access subscription writer | `synchronizeSubscription` in `reliability.ts`; `billing_foundation_command('commit')` atomically writes the verified mirror and authoritative Entitlement receipt. `webhook.ts` delegates checkout/subscription/invoice handling to that synchronizer. |
| Finance writers | `finance-webhook.ts` / `consumeFinanceEvent`, `finance-customer-webhook.ts` / `consumeCustomerFinanceEvent`; customer apply/commit RPCs, invoice proof commit, and `billing_finance_dmi_charge_commit`. Legacy scope writer is still guarded by protocol control, never a competing customer-mode writer. |
| DMI scheduler completion | `billing_consumer_worker_complete_dmi` validates exact current invoice/payment/allocation/catalog proof; ordinary work uses fenced settlement. Receipt completion and scheduler completion remain distinct current contracts. |
| Checkout / identity | `checkout.ts`, `withAccount`, `verifiedCustomerForUser`, and `billing_foundation_command`: owned account lease, verified customer metadata/binding, frozen provider parameters/key and persisted resumption. Hosted/embedded presentation survives retries. |
| Reconciliation | `reconciliation.ts` / `reconcileBilling` supports bounded manual dry-run/repair of known mirrors or a specified user's customer inventory. It calls the same synchronizer. `finance-reconciliation.ts` has legacy/protocol limitations. This is not yet a complete automated missing-event discovery service. |
| Business plans | Separate Business workspace/onboarding/entitlement authority remains outside this simplification; no Individual writer may replace it. |

Current receipt/business atomicity does **not** prove target task/projection/audit atomicity. The current scheduler may settle after consumer commit. That window must be removed from the target transaction design, not described as already solved by a mock fixture.

## Target tables and access

Exact columns, types/nullability, keys, foreign keys, uniqueness, enums, mutability, readers/writer and retention are in `schema.json`. No wildcard JSON extension fields may conceal another receipt/work/routing machine.

| Table | Responsibility / writer |
| --- | --- |
| billing_accounts | Scoped verified customer ↔ principal; `bindVerifiedCustomer`. Unresolved Finance identities cannot grant access. |
| billing_checkout_attempts | Immutable provider operation intent/parameters/idempotency and canonical operation lease; checkout coordinator. |
| billing_price_catalog | Approved checkout/access prices plus application ownership and revisions; reviewed catalog commands. |
| billing_subscriptions | Sole canonical access projection; subscription synchronizer atomic commit. |
| billing_event_inbox | One durable task unit per source and projection kind; admission, claim, atomic commit/defer. |
| billing_authority | One engine/generation/active-operation reference per account/domain; claim/handover commands. No duplicate lease clock. |
| billing_operations | Typed resumable scan runs and insert-only audit rows; transactional audit/checkpoint commands. |
| billing_finance_subscriptions | Financial subscription linkage/completeness. |
| billing_finance_subscription_items | Items, recurring valuation, discounts and tax evidence. |
| billing_invoices | Invoice facts plus validated current ownership provenance. |
| billing_payments | Exact charge/payment facts, capture and collection evidence. |
| billing_invoice_payments | Exact allocations; sharing a customer is insufficient. |
| billing_refunds | Refund-to-charge facts and success evidence. |
| billing_payment_attempts | Failed-charge reporting evidence. |
| billing_finance_activity | Idempotent derived reporting activity; never access authority. |

The last eight retain the current normalized fields, scalar/enumeration/check contracts, lossless money and tax/completeness validation. The retained base table declaration plus pinned tax migration is normative, not an authorization to reinstall old DDL. Future schema DDL must carry those checks forward. Invoice provenance is versioned: exact invoice/customer/subscription/payment/allocation anchors, invoice revision, catalog ownership revisions, application `dmi_cards`, completeness and revocation checks. Prior versions move to immutable audit facts. Typed JSON payload validation is mandatory before Phase 2; provider status fields currently open text stay open nonempty text rather than inventing closed Stripe status enums.

All 15 tables deny direct browser reads/writes by default. Existing authenticated owned-account API/read adapters remain the compatibility surface; private evidence, operation parameters and audit facts are not returned. Proposed principal references are external to the 15-table core: existing Individual profiles/Business workspaces remain authoritative. Their type-discriminated identity must be checked transactionally (ordinary SQL FK cannot enforce a polymorphic principal).

Every declared FK includes scope, uses RESTRICT, and must be deferred only within a validated bundle. Optional invoice/subscription/payment relationships must be checked against exact scoped persisted/verified provider evidence; missing rows park the task, not create a guessed link. `billing_authority.last_completed_operation_id` references an operation in the same scope. Checkout attempt references and inbox task references must match authority account/domain/generation.

Retention is a review gate, not a new deletion policy. Never auto-delete unresolved provider intent, dedupe tombstones, cancellation tombstones, tax/financial facts or audit evidence. Raw minimal evidence can later be minimized after a documented retention interval only while retaining immutable identity/digest/result and legally required facts. No retention duration is invented as legal advice here.

## One inbox, explicit state machine

Dedupe is `(stripe_scope, source_kind, source_id, task_kind)`. A webhook can create access and Finance tasks in one admission transaction. There is no separate authoritative receipt or routing table in the target. `stripe_event_id` is correlation, not a new event-target override. A reconciliation intent is a deterministic run/resource/observed-revision identity; recovery has a new reviewed causal identity.

A repeated identity with identical digest returns the existing task/result and performs no business/provider effects. Conflicting immutable evidence never overwrites the first event: append a conflict audit, quarantine unfinished tasks to attention under the holder/coordinator guard, and alert. Completed tasks remain immutable; conflict is a separately audited attention operation, never retroactive success replacement. The audit record uses a deterministic conflict digest identity so repeated conflict delivery cannot multiply effects.

| State | Required fields / entry / exit |
| --- | --- |
| queued | Immutable admitted evidence/version/digest, arrival sequence and due time; account may be unresolved. Admission only. Claim → processing. No active lease. |
| processing | Account resolved before business commit; token, future expiry, engine, claim generation and matching authority generation/reference required. Claim or expired-claim recovery only. Holder → completed/retry/dependency/attention. |
| retry_wait | Fixed category, failure count/deadline and due time; no active lease. Holder deferred. Ordinary due claim → processing. |
| dependency_wait | Exact dependency kind/reference, bounded next fallback time, fixed category; no active lease. Holder parks. Matching committed proof/binding wake or timed coordinator → retry_wait; deadline → attention. |
| completed | Result, projection digest/revision (or explicit no-projection ignore), completed timestamp and unique completion audit. Atomic commit only. Terminal: no reopen. Duplicate reads result. |
| needs_attention | Fixed reviewed reason, audit and cleared lease. Automatic processing terminal. Manual resolution creates a new linked intent, never silently reopens/completes this one. |

All transitions and actors are machine-readable in `behavior.json`. `dependency_wait` is not an ordinary claim; due fallback is an explicit bounded coordinator transition. Unresolved routing is a queued/dependency property on the same task, not a second processing state machine.

Claim uses due-time then arrival ordering within task lane with transactional row/authority locking and skip-locked candidates. Account domains permit many customers concurrently. It must preserve current externally required ordering and fail-closed stale decisions; changing capacity or priority needs a separate decision. Claim never routes around an older task by operator-supplied event ID. No scope-wide long transaction spans provider I/O.

Expired processing reclamation first reads the durable task result under lock. Completed → return existing result. Still processing + expired → new token and increment claim/authority generation; old holder cannot commit/renew/release. If a provider mutation was attempted, resolve the **same persisted operation** before any possible replay; expiry is not evidence of rollback. A different payload/digest under the same key is a conflict.

## Atomic transaction invariants

Provider reads happen before short database transactions, under renewable account authority. Provider writes cannot be made atomic with PostgreSQL: the immutable checkout operation/key must be persisted before the call and reused on uncertain responses.

`commitSubscriptionTask` must in one PostgreSQL transaction:

1. Lock task, account authority, binding and canonical subscription in a stable lock order.
2. Validate trusted scope/mode, engine, operation reference, token, unexpired canonical lease, generation, expected projection revision, verified ownership and approved price revision.
3. Recheck stale/terminal policy against the current row; fresh equal-timestamp evidence may update, older accepted-event time may not.
4. Write the canonical projection only when semantically changed; projection revision increments only then. Record a no-op result otherwise.
5. Complete the same inbox task, store result/digest/revision, clear its lease and release its matching authority reference; authority generation never decreases.
6. Append exactly one immutable completion operation keyed by task. Any failed check rolls the entire transaction back.

A lost commit response is resolved by reading the completed task/result. A duplicate causes zero new revisions or Stripe effects. No state exists where a target projection commit is durable but its same task still claims noncompletion. Audit insertion failure rolls back projection and completion. This invariant is a Phase 2 disposable-PostgreSQL test obligation, not proven by running current mocks.

`commitFinanceTask` follows the same fence and expected-revision rules. All subscription/items/invoice/payments/allocations/refunds/failed-attempt/activity rows affected by **that task's bounded complete graph**, current invoice provenance, task completion and immutable audit commit together. It does not combine unrelated events into one giant transaction. Incomplete graph → dependency/attention before business commit; provider/storage failure → no partial bundle. Revisions compare per scoped object; money remains decimal/integer strings across JSON boundaries. Successful invoice proof can make charge work eligible; a missing wake is repairable by bounded fallback against current proof. Charge processing recomputes proof and rechecks its exact persisted anchors inside commit. Access and Finance transactions are independent; Finance delay never holds an access lease or gates Pro.

## Authority and single-writer handover

Authority key: `(scope, domain, resource_key)`. Access uses the account identity and covers checkout/customer work plus subscription synchronization. Finance uses the account identity in a separate domain; reconciliation/migration use typed coordinator keys. There is only one lease/token for an active task/checkout operation; authority references it and holds a monotonic generation and designated engine. Lease duration proposal: 90 seconds, renewal at 30 seconds before expiry, bounded caller budget. No provider request may outlive its allowed commit headroom without cancellation/fencing.

Every commit checks **engine + authority generation + task/operation generation + token + expiry + current operation reference** and expected row revisions. Renewal cannot revive an expired lease; old release cannot release a replacement. Catalog revocation increments catalog revision and invalidates derived ownership proof regardless of account engine.

Before ANY new writer can be authoritative, all old commit paths (checkout/binding, Entitlement, Finance, legacy reconciliation/protocol writers, administrative repairs) must participate in the same persisted migration barrier. This is required later implementation, absent today. Environment flags alone cannot fence a running old deployment.

Handover: block new claims for account/domain → drain or wait and fence old operations → check unresolved provider operations and reconcile ambiguous results → capture/recompare canonical revisions → increment generation and switch engine in one audited transaction → allow new claims. Old tokens immediately fail. Rollback uses the same drain/fence process, reconciles the old representation to the last new-engine revision before switching, then increments again; never restore an old generation. Cutover cohort assigns accounts once, not each event randomly. No two Finance engines may write the same account. A shadow process only computes isolated observations and cannot hold live commit authority, mutate provider objects, grant Pro or advance live run cursors.

## Frozen access policy and fixture interpretation

Effective Individual Pro requires a verified owned nonterminal active/trialing subscription on an entitlement-enabled approved price. Scheduled cancellation while active retains Pro; terminal cancellation grants Free. Fresh past_due/unpaid does not grant Pro. Resumption here means reversal of scheduled cancellation/payment recovery where the fresh authoritative subscription is eligible, not resurrection of a terminal subscription. Unknown prices/owners fail closed without overwriting an existing trusted projection. Unsupported upgrade/downgrade input does not invent a commercial plan rule.

Older event time is stale-ignored; equal timestamps are not an arbitrary event-ID ordering: reread current Stripe state under authority and compare revisions. Reconciliation must not advance event ordering using its wall-clock time; it uses fresh snapshots/revisions. Wrong account is rejected by existing account scope checks; signed cross-mode or untrusted deployment is rejected before DB creation/admission/kick. Never require `event.account` when a normal platform event omits it.

`fixtures.json` contains 35 sequences, including 20 required scenarios plus policy/security edges. Each lists input, expected canonical/access/Finance/task/audit/external-effect and zero-write facts. Target normalized task states deliberately differ from old receipt/scheduler enums. Current source probes exercise the actual existing synchronizer/checkout/reconciliation via its established in-memory fake provider/store. Existing Finance/mode/worker regression suites supply remaining current-system evidence. Fixtures marked future-only express unimplemented target guarantees, not a claim of current whole-task atomicity or implemented engine handover. The comparator returns missing_projection when no future observation exists; it never treats absent target output as equivalence.

## Retry/dependency proposal — not implemented

`behavior.json` proposes at most 12 transient failed business executions or 24 hours since first failure, whichever comes first. Backoff is 5s, 15s, 30s, 60s, 120s, 300s, 600s, 900s, 1800s, 3600s, 3600s, with bounded 0.8–1.2 jitter and a longer structured Retry-After respected. The twelfth failure becomes needs_attention. This prevents infinite retries while tolerating a short provider/database outage. These numbers require review before implementation; they are not assertions about current retry ceilings.

Lease/lock contention does not spend failure budget; reschedule no earlier than authoritative lease expiry plus bounded jitter. No in-request hot loop or global serialization is added. Dependency wait wakes only on exact committed relationship/proof; five-minute fallback with a 24-hour age limit is proposed as a durable safety net. Fallback consumes a bounded coordination attempt and does not bypass proof. Waiting age starts at admission to the new policy, not imported historical creation time. Attention remains visible and never grants access/ownership based on age.

Ambiguous provider mutation uses the original frozen key/parameters only inside the current conservative 20-hour replay horizon; inspect provider/idempotency/result evidence first. Outside that horizon or with conflicting ownership: needs_attention and reviewed reconciliation, no blind new key. A lost database response reads the atomic task/result. Manual recovery is authenticated, audited and causally linked; normal ordering/fences still apply. It cannot delete work, bypass authority or manufacture proof.

## Reconciliation requirements

Scheduled access discovery must scan verified account/customer inventory with bounded pages plus existing local subscriptions. It must find provider subscriptions absent locally, local active subscriptions now missing/terminal, stale statuses, changed/unapproved prices and ownership/customer mismatches. It must not claim global completeness from scanning only existing local mirrors. Unknown foreign accounts stay unresolved; authenticated ownership evidence is still required.

Finance scans invoices, allocations/payments, refunds and failed attempts for verified inventory, with explicit resource/window/cursor coverage. Closed windows use a proposed 48-hour overlap, scoped deterministic object/version/digest intents and idempotent projectors. Late changes beyond overlap require a periodic full inventory pass; proposed daily delta and weekly full scan are workload/SLO assumptions, not configured schedules. A run is complete only when every page is durably admitted and every included task resolved or explicitly reported as attention; partial pages/cursors are resumable. Cursor advancement and task admission are atomic. Coverage must distinguish discovered/admitted from successfully projected. Loss of an admission/checkpoint response reuses the same run and task keys.

Reconciliation creates deterministic inbox tasks and uses the same synchronizer/projector, never a direct alternative business writer. Provider absence alone must not delete/revoke a valid local subscription if read permissions/scope/transport are uncertain. Verified resource absence becomes reviewed/authoritative policy evidence; access removal follows the same ownership and terminal rules.

## Shadow format

A comparison contains fixture/source correlation (private), baseline and candidate version, normalized status/plan/entitlement/verified ownership/order/terminal and sorted Finance facts, external mutation counters and declared representation differences. No real IDs, raw provider evidence or secrets enter diagnostic output. Normalization preserves money strings and exact relationship identity through synthetic/private correspondence; a shared customer boolean cannot erase relationship mismatches.

Outcomes are exactly: equivalent, expected_representation_difference, policy_mismatch, missing_projection, ownership_mismatch, unexpected_business_effect. Any new provider/business effect wins over other classifications; ownership mismatch wins over a cosmetic difference. Representation differences must be explicit reviewed field mappings (e.g. task state labels) and cannot exempt policy, ownership, money or terminal facts. Normalized facts are equal for a representation-only result. Missing candidate output is failure, not representation difference. Revision comparisons use semantic order decisions/digests, not coincidental numeric equality across different engines. Shadow persists only isolated comparison artifacts later; it never runs mutation-capable provider clients or live commit RPCs.

## Migration gates and first next work

Exact measurable gates are in `behavior.json`. Phase 2 design can begin after this spec and fixture review; this is not permission to create authority or cut over. Phase 2 implementation must provide an isolated target adapter, local PostgreSQL transaction/concurrency/fault-injection tests and mapping/backfill/rollback contracts. Current harness success is not target equivalence.

Phase 3 requires 100% deterministic fixture equivalence, zero duplicate Stripe effects and zero stale-worker commits, crash/lost-response recovery at each boundary and handover/rollback proof for access/checkout/Finance. Staging requires seven shadow days plus 100 complete synthetic families, zero unexplained differences and fresh automatic acceptance across monthly/annual/cancel/payment-failure/repair. Production requires Staging acceptance, fourteen shadow days plus 1000 labelled synthetic/natural families, zero unexplained effects/ownership errors, audited rollback rehearsal and explicit operator approval; cohorts 1%, 10%, 100% with at least 24h and no unresolved mismatches at each step. A calendar delay alone does not satisfy coverage.

Keep all legacy tables/functions, current receipt histories, reconciliation coverage and idempotency intent until equivalence, audited data mapping, rollback window expiry and explicit retirement approval. No deletion/retirement is authorized in Phase 1. Embedded Checkout, activation polling, mode isolation, bounded idle behavior and QStash are unchanged.

## Validation limits

Phase 1 tests validate contract structure, fixture consistency, negative comparator/fence cases, source pins and supported current-system sequences. Existing offline regressions test current Finance/mode/scheduler behavior. They do not prove new SQL atomicity, operational scale, Production cutover safety or a running shadow engine. No hosted access, provider calls or SQL execution is part of this phase.

Finance fixtures include synthetic exact graph/amount facts and prior access state. The certificate-path foreign/revoked/missing relationship cases normalize to dependency waiting, not successful foreign business mutation. These expectations are linked to current Finance regression suites; the specification does not execute a new Finance projector.
