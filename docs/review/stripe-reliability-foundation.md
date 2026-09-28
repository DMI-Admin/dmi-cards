# Individual Stripe reliability foundation — local implementation

## Boundary and rollout state

No hosted migration, data approval, Stripe call, configuration change, deployment,
Business entitlement change, Admin Subscriptions UI or Finance ledger is included.
The additive migration must precede deployment. It deliberately seeds no prices
or customer mappings. Do not deploy before reviewing and approving current and
historical Pro price IDs in the correct Stripe account/test-live scope.

The effective entitlement resolver and Client UI are unchanged. In particular:
active/trialing + current configured Pro price remains the effective rule;
past_due/unpaid remains Free; no freshness expiry or billing-unavailable UI is
introduced. Historical prices are supported by the new sync writer/registry, but
retiring environment price IDs still requires the separately approved resolver
phase. Do not rotate those IDs yet. Unknown active prices fail synchronization
with an explicit diagnostic and cannot create a Pro projection; existing mirror
state is preserved on that failure and may remain stale until repaired. This is
not a claim that stale-entitlement protection has been activated.

## Processing and ownership

`reliability.ts` is the only subscription projection writer. Webhooks and repairs
retrieve current Stripe state after obtaining an account lease. SQL validates the
lease token/expiry, expected revision, customer ownership, scope and price approval
again at commit. Event completion and mirror commit share a transaction. Older
notifications do not refresh verification time; same-second events retrieve anew.
Canceled subscriptions are terminal for the same subscription ID. A signature-
verified deletion may supply a terminal snapshot even if retrieval is unavailable
with resource_missing. Other missing objects are diagnostic failures, not invented
cancellations. Checkout-session IDs already recorded on old mirrors are preserved.

Leases last 90 seconds, use database time, and have fresh UUID fencing tokens on
reclaim. Busy deliveries get retryable errors. No transaction spans a Stripe call.
The initial pre-lease retrieval resolves identity only; it cannot be committed.
No browser input supplies customer IDs, price approvals, scope or entitlement.
Known subscription metadata conflicts fail; genuinely foreign events are ignored.
No raw webhook, customer, invoice or payment object is persisted. Stored checkout
creation parameters are the narrow, server-constructed immutable request, including
email only when needed for customer creation; they are never returned to clients.

## Checkout and portal

Both checkout routes share the coordinator. Existing customer/subscription lookup
is fully paginated with a hard 10,000-object safety limit; exceeding it is an error,
not a truncated "no subscription" decision. Multiple customers or live subscriptions
block creation. Identity linking uses UUIDs and trusted Stripe metadata/mirrors,
never email equality. Explicit Business/ambiguous client linkage blocks Individual
checkout without modifying Business data.

A durable customer attempt and checkout attempt own the Stripe idempotency key and
request parameters. Lost responses reuse those parameters and keys; discovered
sessions recover their saved ID. Unknown outcomes older than 20 hours block instead
of risking a replay beyond the intended idempotency window. They require operator
investigation; no automated second customer/session is created. Changing interval
while Checkout is open returns a conflict. Closed attempts can be replaced only
after terminal session/subscription state is verified. Active/trialing blocks new
checkout; past_due/unpaid/paused/incomplete directs recovery unless a matching open
session can safely resume. Stripe lookup errors never become absence.

Portal authorization verifies bearer identity plus customer ownership independently
of effective Pro. Free without billing linkage receives NO_BILLING_ACCOUNT.
The existing Client payment-method button already uses hasSubscription, not Pro;
no UI rewrite is needed. Cancellation/resume retain their existing semantics but
verify ownership and refresh through the shared writer after the Stripe action.
A refresh failure may follow a successful Stripe update; retry/reconciliation is
safe and the UI must not assume the Stripe action failed.

## Reconciliation

`POST /api/admin/billing/reconcile`: Clerk Admin ID authorization, same-origin
protection, private/no-store, strict 2 KB request and 20 subjects per page.
Body: `{ "mode": "dry_run" | "repair", "after"?: string, "userId"?: UUID }`.
Without userId it scans known mirrors by UUID cursor. With userId it enumerates the
verified customer's Stripe subscriptions by Stripe cursor and can restore missing
mirrors. There is no arbitrary Stripe-ID or customer-ID browser override.
Dry-run makes no mirror/customer binding changes; it does use temporary leases and
stores diagnostics. Repair uses the same writer; repeated unchanged repairs do not
increment the revision. Audits contain IDs, outcomes/revisions and safe codes only.
The server service is reusable by a future authenticated system worker. No scheduler
or unauthenticated system endpoint is provided.

A user with neither a verified account nor a mirror cannot be discovered through
customer enumeration. Global Stripe metadata discovery and ambiguous legacy account
recovery remain a separately reviewed operator task. A batch failure can follow
completed earlier items; inspect audit rows and retry. Audit-storage failure returns
unavailable rather than claiming complete diagnostics.

## Validation and migration review

`validate-stripe-reliability.mjs` executes real modules with fake Stripe/store.
`validate-stripe-reliability-postgres.mjs` accepts ONLY a local binary directory and
an absolute pg driver module. It creates a disposable cluster with TCP disabled,
loads fixture auth/profiles and the prepared migrations, exercises real row locks,
atomic rollback, revisions, leases and RLS, then stops/removes its own cluster.
It does not accept DATABASE_URL or hosted connection credentials.

The SQL review file contains read-only diagnostics. The rollback file is deliberate
non-destructive containment: revoke foundation RPC execution while preserving all
state. Do not drop tables, clear idempotency receipts, or roll back to the unsafe
old writer. Avoid mixed old/new deployments sharing the same webhook destination.

Before staging rollout: verify applied baseline schema/RLS, configured webhook API
version and signing secret/mode, restricted-key permissions for account/balance
scope discovery, approved prices, identity/customer mappings, and expected checkout
and portal configuration. Include invoice.payment_succeeded/invoice.paid recovery
notifications. Validate in Stripe test mode only after separate approval. No live
Stripe behavior has been verified by the local suites.
