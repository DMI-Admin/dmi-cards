# Finance V1 — financial write/sync foundation and staging webhook integration

Local implementation only. No hosted SQL, authenticated Stripe requests, webhook
configuration changes, backfills, UI, deployments or entitlement changes. The
webhook route now connects independent consumers only for the staging target; the
reliable entitlement consumer is unchanged. Phase 1
schema, normalization and server-only hardening remain authoritative.

## Database contract

After the reviewed Phase 1 migration, `20260930130000_finance_v1_writer.sql`
adds **one** SECURITY DEFINER RPC:

`public.billing_finance_command(text,text,uuid,jsonb)`

Actions: `event_claim`, `event_fail`, `claim`, `release`, `run_start`, `commit`.
The JSON contract is a bounded bundle of fixed, typed, allowlisted Finance rows,
not arbitrary table names, SQL, columns or raw Stripe objects. Typed casts,
constraints and scoped foreign keys remain enforced. EXECUTE is granted only to
service_role (and the migration owner); PUBLIC/anon/authenticated are denied.
Direct service-role table writes remain denied; SELECT is retained. No table,
column, grant or function belonging to the entitlement foundation is changed.
The writer only READS billing_accounts to verify existing customer/user bindings.
The migration intentionally fails on an existing function name rather than
accepting incompatible drift. Do not blindly rerun either migration.

A scope-wide lease is the deliberately small V1 coordination model: one writer
per Stripe account/mode, 120-second expiry, random fencing token and monotonic
revision. Object snapshots must carry expected revisions; older verification
timestamps fail. Lease validity is checked again at transaction completion.
Expired leases can be reclaimed; old tokens cannot release/commit newer work.
Financial updates, activity, cursor advancement and event completion are one
transaction. A failure leaves the event retryable with no partial money changes.
Identical mutable refreshes preserve object revision. Immutable attempt/activity
keys are no-ops when equivalent and reject conflicting facts. Terminal canceled
subscriptions/succeeded refunds cannot regress. Captured/refunded totals cannot
regress; known collection/refund completion evidence is preserved. Missing
subscription items are retired with removed_at, never deleted. Existing scoped
foreign keys retain financial history using DELETE RESTRICT.

## Runtime, API version and integration boundary

Installed stripe SDK: 22.5.0, default `2026-07-29.dahlia`. Existing application
Stripe construction does not explicitly pin apiVersion. This is evidence of local
SDK behavior, **not evidence of the deployed Stripe webhook endpoint version**.
The new read-only adapter pins that version per request. Fixtures are hand-built
from installed SDK types, not captured staging payloads. The verified staging destination is pinned to webhook version `2023-10-16`.
Finance explicitly accepts only that webhook version, independently of retrieval
version, and still rejects account/mode mismatches. See the two-version contract
below; changing either contract requires a compatibility review.

`createFinanceRuntime` derives scope from injected Stripe account/balance reads;
server callers cannot use browser-supplied scope/user IDs as identity authority.
`consumeFinanceEvent` expects an already signature-verified Stripe event, never
an HTTP body. The route calls `handleStripeWebhookConsumers`, which uses
`orchestrateBillingConsumers` for staging: settle entitlement first, then run Finance
even if entitlement failed, and request retry if either fails. This lets a successful
entitlement handler establish the verified customer binding before Finance reads it.
Each uses its own receipt state; neither rolls back or erases the other's completion.

Finance receipts use `(stripe_scope, finance_v1, stripe_event_id)`. Supported
refresh triggers: invoice.finalized/updated/paid/payment_failed/voided/
marked_uncollectible; charge.succeeded/failed/captured;
refund.created/updated/failed; subscription.created/updated/deleted. Unknown types
are explicitly ignored. invoice.payment_succeeded is not separately counted as
money. Every trigger retrieves current objects **after** obtaining the scope
lease. An older event refreshes current state rather than replaying its old
snapshot; chronology watermarks cannot decrease. Same-second events are serialized
by the lease/revision rather than guessed by lexicographic event IDs.

## Attribution and financial evidence

- Match exact runtime account/mode, Stripe object/customer/subscription/payment IDs.
- Subscription namespace must be `dmi_cards_v2`. Entirely foreign graphs are
  ignored; mixed foreign/DMI graphs fail closed.
- A verified subscription requires valid metadata dmi_user_id, compatible optional
  dmi_profile_id/customer metadata and an existing verified billing_accounts
  binding for that exact scope/customer/user. Conflicts fail; missing binding is
  unresolved. No email/name matching or customer mapping creation.
- Invoices must agree with their subscription's customer. Allocation currency
  must agree with the invoice. PaymentIntent allocations resolve only through a
  unique paid/captured successful Charge; ambiguous successes fail closed.
- A payment is attributed only if all allocations link to verified DMI subscription
  invoices with matching customer/currency **and** their amounts account for the
  captured total. SQL independently verifies this condition. Unresolved objects
  can be retained but are not attributed collections.
- Money is actual normalized Charge capture/refund evidence, not event counts or
  invoice face values. Zero-value and paid-out-of-band invoices create no money.
- Failed-attempt occurrence requires the signed matching charge.failed snapshot;
  historical list results alone cannot invent its timestamp. Historical missing
  capture/refund completion evidence remains incomplete.
- Numeric fields are text-cast in PostgREST before JSON parsing; decimal recurring
  prices and bigint values are never rounded through JS Number by the store.

## Activity

Deterministic keys represent subscription created/ended, cancellation scheduled/
reversed, invoice paid, payment failed and refund succeeded. Verified attribution
and matching signed event/current object evidence are required. Cancellation
reversal additionally needs the prior mirror and signed previous_attributes to
agree; old events below the chronology watermark cannot invent new transitions.
Cancellation keys include the state revision, permitting later genuine cycles.
Amounts are allowlisted; rendered names/raw objects are never stored. Historical
reconciliation/backfill emits no activity. Missing evidence can therefore leave
activity incomplete; it is not a complete payment ledger or notification feed.

## Reconciliation and bounds

Fixed UTC windows, stored actor/resource/mode, cursor compare-and-set and atomic
progress commits. Resource scans: recent invoices, all open invoices regardless of
age, recent failed charges, all pending refunds regardless of age, active/trialing/
past_due/unpaid subscriptions. Recent overlap defaults to 35 days (configurable
1–400). One call processes at most 20 roots; graph bounds 60 reads, two pages per
list, 200 rows per resource; oversized graphs fail without partial writes. Stripe
reads have a 10-second timeout and zero retries. A batch exceeding its 120-second
lease fails safely and must be retried with a smaller operational workload in the
next phase; there is no scheduler, automatic lease extension or hosted runner.

Coverage is complete only after the last cursor and all batches are complete.
An incomplete batch increments the run diagnostic counter; later complete pages
cannot erase it. Recent failure-list coverage is always partial because it lacks
signed occurrence evidence. Runs retain committed progress on errors for retry;
failed pages do not advance. Event error codes are sanitized. Per-run detailed
error presentation/operational scheduling is deferred. No database aggregation,
Finance UI, entitlement grant/revoke, or browser write API is added.

## Offline validation

- `node scripts/validate-finance-foundation.mjs`
- `node scripts/validate-finance-consumer.mjs`
- `node scripts/validate-finance-adapter.mjs`
- `node scripts/validate-finance-postgres.mjs <local-pg-bin> <local-pg-module>`
  runs `validate-finance-writer.mjs` inside a disposable Unix-socket-only database.
- Existing Stripe foundation/reliability (mocked and disposable PostgreSQL),
  Admin subscriptions, temporary diagnostic, TypeScript and targeted ESLint checks.

Before Phase 2B: review both local migrations; verify actual payload relationships and availability of proposed additional events
with separately authorized staging evidence; review the
consumer route hookup and retry semantics; approve schema/config deployment order.
Do not enable webhook delivery, reconciliation or Finance UI from this phase alone.


## Reviewed two-version contract (local compatibility update)

WEBHOOK INPUT CONTRACT: **2023-10-16**.
CURRENT OBJECT RETRIEVAL CONTRACT: **2026-07-29.dahlia**.

User-verified Sandbox destination: DMI Cards Staging,
https://staging.dmicards.com/api/stripe/webhook. Its existing five subscriptions are
checkout.session.completed, customer.subscription.created/updated/deleted and
invoice.payment_failed. No destination/configuration was changed in this task.

An event is signature-verified trigger/provenance evidence; current GETs supply
canonical state. `reviewedFinanceEvent` copies only reviewed primitive fields into
a new object before Finance use; legacy invoice relationships, totals, subscription
items, metadata and personal fields are discarded. An unknown/null input API version
fails with FINANCE_WEBHOOK_COMPATIBILITY before any claim/retrieval. No version
coercion or wholesale legacy-object normalization is permitted. Common event evidence
is id, type, created (occurrence timestamp), livemode, optional account and subject id.
The HTTP route still verifies the signature once before either consumer.

| Event family | Signed event evidence retained | Canonical retrieved state |
|---|---|---|
| subscription.created | subject created timestamp, status, cancel flag; creation activity requires matching created timestamp | customer binding/metadata, status, items/prices/discounts, period dates and valuation |
| subscription.updated | cancel flag and previous_attributes.cancel_at_period_end; both must agree with mirrored/current transition | current status, items/periods, cancel_at and remaining subscription state |
| subscription.deleted | canceled status and event time | terminal current subscription state |
| invoice.finalized/updated/payment_failed/voided/marked_uncollectible | subject id and provenance; status is allowlisted but does not set mirror state | invoice totals/status/timestamps, parent.subscription_details.subscription, separately listed invoice-payment allocations |
| invoice.paid | paid status gates activity; event time is fallback occurrence evidence only | amount paid/currency and status_transitions.paid_at come from current invoice, not snapshot totals |
| charge.succeeded/captured | succeeded status, captured boolean and exact captured amount corroborate collection occurrence time | all payment amounts/customer/PI/currency and state come from current Charge |
| charge.failed | created, livemode, customer, payment_intent, currency, status, paid, captured, amount, amount_captured, amount_refunded, failure_code; event.created is failure occurrence time | current Charge customer/PI/amount/currency must match; current allocations establish invoice linkage |
| refund.created | succeeded status plus matching event type may establish success time | refund amount/currency/charge/PI/status from current Refund |
| refund.updated | succeeded status plus previous_attributes.status explicitly not succeeded may establish success time | current Refund state; current success alone supplies no historical success time |
| refund.failed | failed status/provenance only; never success-time evidence | current Refund state and allowlisted failure reason |

Failed charges are the deliberate occurrence-evidence exception: the reviewed
snapshot subset describes a past failed attempt even if current related payment
state has recovered. All required financial fields must actually be present, valid,
and agree with current immutable identity. No legacy snapshot invoice link is used;
current allocation data determines it. Attempt key is charge:<charge ID>, so event
redelivery/new delivery IDs cannot create another attempt. Its stripe_api_version
records 2023-10-16 because its facts come from event evidence; current-object rows
record 2026-07-29.dahlia. Both retain source event ID/time. Event version itself is
fixed by the consumer contract, not a newly added schema column.

### Invoice-payment event availability

Installed SDK Events and InvoicePayments types describe the *current* API and
include invoice_payment.paid plus invoicePayments list/retrieve. They do not prove
that a destination pinned to 2023-10-16 can deliver that newer event. No historical
API schema or authenticated destination event catalogue is available locally.
Therefore **invoice_payment.paid is not a supported trigger in this reviewed
2023 contract** and completes as ignored if encountered. Do not subscribe to it.
Invoice finalized/updated/paid/payment_failed triggers still fetch the current
invoice and list/retrieve its invoice-payment allocations using the pinned 2026
adapter. Allocation synchronization does not depend on that event's availability.
This is a conservative compatibility choice, not a claim of proven Stripe-wide
unavailability. Availability of additional invoice/charge/refund destination event
subscriptions still needs verification before any configuration change.

Fixtures in `scripts/fixtures/finance-webhook-2023.mjs` are sanitized hand-built
contract examples, not captured production/staging evidence. They deliberately
include legacy invoice subscription/charge fields and contradictory snapshot totals
to test their exclusion. `validate-finance-compatibility.mjs` checks both contracts,
provenance, failure identity/timing/deduplication and refund evidence. Existing
consumer and transactional writer scenarios now run with 2023 envelopes and 2026
current objects, including cancellation reversal, invoice payment overlap and
historical activity suppression. There are no entitlement code changes.


## Checkpoint 4 — local staging route connection

Before this change, the route verified the signature with constructStripeWebhookEvent,
called only handleStripeWebhookEvent, and returned the existing received/handled/skipped
response. Signature errors returned 400; handler failures returned a sanitized 500.
The entitlement consumer already claimed/completed/failed its own events through
billing_foundation_command and acknowledged unsupported types. That code is unchanged.

The new wrapper activates Finance only when VERCEL_TARGET_ENV (falling back to
VERCEL_ENV) is staging and VERCEL_ENV is not production. Finance additionally requires
exactly https://uohdkewufeivdpaljnng.supabase.co, a test credential prefix and runtime
account/balance verification yielding a test scope. Other targets retain entitlement-only
handling. No new environment variable, migration, grant or Stripe configuration is added.

| Condition | HTTP result |
|---|---|
| Invalid signature | Existing safe 400 before either consumer |
| Both complete, duplicate-skip or ignore | Existing safe 200 response |
| Either consumer fails, including Finance initialization/compatibility | Sanitized 500; committed work survives |
| Unsupported Finance type with supported envelope | Finance records ignored; no failure solely for this reason |

checkout.session.completed remains entitlement processing plus Finance ignored.
The three configured customer.subscription events independently refresh each consumer.
invoice.payment_failed retains its existing entitlement refresh and independently refreshes
Finance invoice/current allocation evidence. Finance has no entitlement write authority.
invoice_payment.paid remains ignored; additional reviewed invoice/charge/refund triggers
are code support only and must not be enabled in this checkpoint.

`validate-stripe-webhook-orchestration.mjs` runs the actual route and consumers with
local signed fixtures and mocked external I/O. It tests both failure directions, retry,
duplicate delivery, all five configured events, unsupported type/version, signature
rejection and staging/production guards. The PostgreSQL suites separately exercise
actual transactional permissions, fencing and entitlement non-mutation.

### Deployment preparation (not executed)

From the reviewed working tree, using the existing project link:

```sh
npx vercel deploy --cwd /Users/prashanasinnathamby/Desktop/dmi-cards-preview-50ed18a-clean --scope dmi-cards-projects --target staging
```

This publishes the reviewed working tree, including previously approved local work;
it is not an assertion that the directory has zero Git changes. Do not use --prod
or stale --prebuilt output. No original dirty Preview worktree is involved.

### Post-deployment read-only checks

1. Inspect deployment details: dmi-cards, dmi-cards-projects, custom target staging,
   new deployment URL and expected source. Verify the target environment exposes
   VERCEL_TARGET_ENV=staging; otherwise Finance intentionally remains disconnected.
2. Open the app and existing Individual Pro Billing page. Compare plan/status/period
   with the pre-deployment baseline. No new checkout or cancellation is needed.
3. Read the existing scoped billing_subscriptions technical mirror and verify the
   established customer/subscription relationship, dmi_plan/status and period remain
   correct. Do not retrieve unrelated personal data.
4. Inspect logs for naturally arriving, already-enabled events: safe 200 completion,
   or sanitized 500 with independent receipt states. Do not resend or replay events.
   No arriving event means webhook smoke verification is still pending.
5. Read scoped stripe_webhook_events and billing_finance_event_deliveries metadata
   for the same event IDs. Verify independent completion and no duplicated Finance
   facts/activity. Existing events may legitimately populate Finance; checkout alone
   is ignored by Finance. Without a supported event, empty Finance remains expected.
6. Confirm the five destination event subscriptions and webhook version remain unchanged
   by reviewing existing configuration only. Do not activate new events or backfill.

Checkpoint 5 requires successful staging smoke evidence and separate approval for
additional destination events. The installed service-role permissions were confirmed
by the user's Checkpoint 3 audit and exercised locally; this task does not make a new
hosted credential/permission verification request.


## Legacy refund compatibility (local only)

The verified 2023-10-16 destination catalogue exposes charge.refunded (Charge),
charge.refund.updated (Refund, selected payment methods only), and refund.failed.
Explicit mappings now supplement the retained refund.created/updated/failed paths.
No destination configuration is changed and newer refund events are not assumed
available. charge.refunded is discovery only: retrieve the current Charge, list
all refunds within existing pagination bounds, retrieve each Refund and verify its
Charge linkage and currency. Embedded webhook refund lists are never exhaustive.
A listed/refetched parent mismatch now fails closed; adapter architecture is unchanged.
Refund identities remain (stripe_scope, stripe_object_id), never event IDs or Charge
total differences. Bounds fail before commit; separate consumer receipts permit retry.

charge.refund.updated supplies verified_event success time only for an exact Refund
with signed prior non-succeeded status, signed succeeded status and current succeeded
state. Charge triggers, missing transition evidence and refund.failed never supply
success time. Existing verified timestamps are retained by the writer. Activity still
requires qualifying evidence and verified payment attribution. A delayed failure
refreshes current state, rather than applying the failed snapshot.

Refund coverage remains explicitly incomplete where succeeded_at is unknown. Selected
payment-method update coverage cannot guarantee all lifecycle changes; no complete
period-based refund reporting or activity history is claimed. Future reconciliation
can repair current-state gaps but cannot invent historical success timestamps.
Synthetic legacy tests cover partial/multiple/full refunds, overlap, out-of-order and
failed updates, timestamp preservation, incorrect linkage/currency/mode/scope, and
actual adapter pagination/read exhaustion without partial Finance commits. The shared
consumer scenarios also run against the disposable PostgreSQL writer.
