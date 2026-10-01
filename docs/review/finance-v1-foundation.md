# Finance V1 — Phase 1 local foundation

Prepared only. No hosted SQL, migration application, Stripe requests/configuration,
backfill, webhook orchestration, Finance UI or entitlement changes are part of this phase.
Existing temporary diagnostics remain in place.

## Objects and migration boundary

`supabase/migrations/20260930120000_finance_v1_foundation.sql` creates exactly:

- billing_finance_subscriptions
- billing_finance_subscription_items
- billing_invoices
- billing_payments
- billing_invoice_payments
- billing_payment_attempts
- billing_refunds
- billing_finance_event_deliveries
- billing_finance_sync_state
- billing_finance_sync_runs
- billing_finance_activity

All objects are in public. All Stripe-object primary keys include stripe_scope.
Allocation/item/attempt/refund/activity foreign keys include scope and use DELETE
RESTRICT. There are no auth-user cascading FKs; financial history is retained when
application users disappear. User IDs are verified references, not deletion roots.
The SQL contains exact columns, defaults, constraints and indexes for review.
No price/customer/data seeds. No alterations to existing entitlement objects.

The migration is transactional and intentionally uses CREATE TABLE without IF NOT
EXISTS. A conflicting object name fails/rolls back, rather than blessing drift.
An unchanged second application also fails: use migration history, not blind reruns.
Prerequisites are public schema, anon/authenticated/service_role roles,
gen_random_uuid(), PL/pgSQL, and a migration owner with DDL/grant authority.

## Security and intentional Phase 1 differences

RLS enabled everywhere; no browser policies or grants. service_role receives SELECT
only. INSERT/UPDATE/DELETE/TRUNCATE remain denied, including checks for inherited
privileges. Phase 2 must introduce fenced transactional writer RPCs before enabling
writes; there is intentionally no generic JSON upsert/RPC in this migration.

This is stricter than the eventual service-role-write design and prevents premature
or unfenced writes. No Finance code changes application entitlement. The existing
billing_foundation_command and its tables are not modified.

Payment-attempt evidence is deliberately limited to confirmed failed charges in V1;
failed attempts require a signed event's matching failure-time evidence. Scheduled
invoice retries and historical charges without a verified failure timestamp cannot
be turned into dated failure facts. Their historical coverage stays partial.

The subscription value mirror is separate from billing_subscriptions. No historical
price approval mutation is needed to value a verified item; Finance is not an
entitlement decision. No browser-supplied user/scope is a trusted identity source.

## Normalization contract

`finance-types.ts`, `finance-normalize.ts` and `finance-metrics.ts` are server-only.
Normalizers are pure: no Stripe client, Supabase, network, RPC or side effects.
Input is unknown and runtime-validated, then a new allowlisted row is constructed.
Malformed mandatory facts throw FINANCE_MALFORMED_STRIPE_DATA. Ambiguous valuations
return explicit unsupported/incomplete status and reason, never a zero substitute.

Money and SQL bigint fields cross JSON boundaries as canonical decimal strings.
Unsafe JS numbers are rejected; bigint arithmetic performs calculation. Recurring
unit_amount_decimal is retained as a decimal string, with at most 26 whole digits
and 12 fractional digits (numeric(38,12)); it is never parsed through Number.
No raw Stripe object, card PAN/CVC, billing details, client_secret, or free-form
provider error is persisted by these normalizers.

Context supplies scope, API version, verification instant and optional event
provenance. The future caller must verify the signature and resolve actual Stripe
account identity before constructing context. A Stripe object's livemode alone
cannot prove which account returned it. Customer/user attribution is a separate
trusted resolution step. Charges default to unresolved attribution.

Event completion timestamps require matching object ID, event type and snapshot
outcome. Charge collection additionally requires matching captured amount and
captured=true in event evidence. A currently captured charge plus an old authorized
event is insufficient. Refund.updated needs previousStatus distinct from succeeded;
a later metadata update cannot fabricate a success date. Unproven dates stay null.
Phase 2 must preserve previously verified timestamps when later refreshes have none.

Invoice payments_complete is false until Phase 2 verifies all allocation pages.
PaymentIntent allocations do not fabricate a charge ID. Invoice total arrays set
explicitly to null mean no entries; missing/invalid amounts are rejected. Negative
invoice subtotal/tax/total are retained where Stripe represents adjustments, while
collection amounts remain nonnegative. All API consumers must avoid Number(bigint).

### Supported recurring valuation

Flat licensed per-unit month/year prices, positive interval counts, quantities,
exclusive-tax basis, and zero or one expanded forever coupon per valued item.
A subscription-level coupon is supported for a single-item subscription. Percentage
and same-currency fixed discounts are supported. Values are calculated with rational
arithmetic and rounded half-up once at the effective cycle amount in minor units;
MRR normalization never rounds individual annual contributions.

Tiered/metered/transformed quantities, mixed intervals/currencies, multiple-item
subscription discount allocation, stacked/temporary/product-scoped coupons,
unexpanded coupons and inclusive/unspecified tax basis are explicit unsupported or
incomplete states. Their input price/quantity/allowlisted discount metadata remains
available. No fictitious net-of-tax value is derived. Future support can expand the
normalizer without replacing the schema.

Current created_at/updated_at/revision are database/writer metadata; original Stripe
creation is stripe_created_at. No subscription original date is inferred from the
local billing mirror creation date. Unknown Stripe statuses remain visible but are
not considered paid recurring value.

## Pure metric contracts

- GBP reporting only. Different currency/scope is an incomplete result, never silently
  dropped or converted. Coverage has exact scope/currency and a valid UTC range.
- Empty input is zero only when coverage explicitly says complete; partial coverage
  returns value:null/status:incomplete. Phase 2 must supply verified coverage and
  freshness, not manufacture a complete marker.
- Paid MRR requires active, verified linked, unpaused, complete supported items in the
  current period. Trialing/past_due/unpaid/canceled/incomplete are excluded.
- Scheduled period-end cancellation remains in MRR until its end and never contributes
  to expected renewal. A noncanceling expired mirror is incomplete pending refresh.
- Active data must have a valid verification timestamp. No arbitrary entitlement grace
  or implicit mirror freshness promise is introduced. Coverage/freshness acceptance
  beyond the period check belongs to the future synchronization/read model.
- £5.99 monthly = 599p. £59.99 annual = rational 5999/12 pence before aggregation.
  ARR multiplies the unrounded MRR rational by 12. Display rounding happens last.
- London calendar month boundaries are converted to UTC with Intl's Europe/London
  zone, accounting for DST. Stored timestamps remain UTC, ranges are [start,end).
- These are recurring contract-value functions, not a collections/ledger aggregate.
  There are no database aggregates or Finance API in Phase 1.

## Existing-code correctness corrections

Admin subscriptions now resolves the actual Stripe account scope using the existing
server config and applies an exact stripe_scope predicate before pagination of every
billing_subscriptions query. Unknown/null/other-account/live rows do not enter the
current report. Scope discovery failure returns the existing safe 503 rather than
an unscoped result. Price-display fallback is otherwise unchanged.

supabase-admin.ts now explicitly imports server-only. The validation traverses local
imports/re-exports/dynamic imports from every use-client entry; none reaches this
module. Existing direct imports are server helpers or API routes. Its temporary
raw diagnostic is retained; the diagnostic validation mock accepts server-only.

## Validation commands

Run from the deployment clone (no env pull required):

```
node scripts/validate-finance-foundation.mjs
node scripts/validate-finance-postgres.mjs /absolute/postgres/bin /absolute/pg/module
node scripts/validate-stripe-billing-foundation.mjs
node scripts/validate-stripe-reliability.mjs
node scripts/validate-stripe-reliability-postgres.mjs /absolute/postgres/bin /absolute/pg/module
node scripts/validate-admin-subscriptions.mjs
node scripts/validate-stripe-runtime-check.mjs
./node_modules/.bin/tsc --noEmit --incremental false
git diff --check
```

PostgreSQL validators create their own temporary clusters, disable TCP listening,
connect only through their private Unix socket, and destroy the fixture cluster on
exit. They do not accept a DATABASE_URL or use application environment credentials.
Test binaries/pg can be installed separately under /private/tmp; no application
dependency changes are required. Targeted ESLint covers all changed TS/MJS files.

## Phase 2 prerequisites / stop point

Review the migration before any hosted application. Verify deployed Stripe API version
and captured signed fixture shapes before webhook work. Implement account/namespace
attribution, fenced writer RPCs, independent finance_v1 consumer, full allocation
pagination, deterministic activity, coverage/cursors and backfill/reconciliation only
in the next separately authorized phase. Missing historical occurrence times and
unsupported valuations must remain visible as partial coverage.

No scheduler, authenticated financial endpoint or webhook consumer exists yet.
The old Finance UI is unchanged in this phase; its fake values MUST be removed when
real Finance UI is separately built. Remove the temporary runtime diagnostic only
after the new foundation is verified in staging. No Phase 1 deployment is implied.
