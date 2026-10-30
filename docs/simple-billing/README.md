# Billing

Embedded Checkout → Stripe subscription → shared sync → `account_billing` →
`client-context.ts` → the existing entitlement map.

`src/lib/stripe/simple-billing.ts` contains the only subscription synchronizer.
Webhook subscription-created/updated/deleted and invoice-payment-failed events
re-fetch the current Subscription. The authenticated checkout return calls the
same function once, waits for its database write, then opens Billing. No polling,
queue, worker or financial projections exist. Duplicate events upsert one row;
webhook payload status is never the authoritative status.

`account_id` is the existing Supabase authenticated user UUID. Stripe Customer and
Subscription metadata must both contain `dmi_app=dmi_cards` and `dmi_user_id`.
For manual Enterprise subscriptions in Stripe:

- Use the DMI Cards Enterprise Product (`STRIPE_PRODUCT_ENTERPRISE`).
- Any appropriate Price under that Product may be used; no fixed Enterprise Price ID is required.
- Set subscription quantity to the agreed seat count.
- Add metadata to BOTH Customer and Subscription: `dmi_app=dmi_cards` and
  `dmi_user_id=<DMI user id>`.

Enterprise uses Stripe quantity and the existing Enterprise → Pro-feature map; this does not
invent organisation membership or a seat-allocation engine. Existing business
onboarding/commercial-approval records remain independent of application access.

Access remains paid for active, trialing and past_due. Canceled/unpaid, paused,
incomplete, incomplete_expired and unknown statuses are Free. Unknown/multiple
prices fail closed to Free. Cancellation at period end retains access until Stripe
changes the status. Customer/subscription IDs are unique and browser writes denied.

Environment: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_PRICE_PRO_MONTHLY`,
`STRIPE_PRICE_PRO_ANNUAL`, optional `STRIPE_PRODUCT_ENTERPRISE`, plus existing
Supabase credentials and trusted Vercel deployment metadata. Staging accepts only
TEST and Production only LIVE; signature verification precedes the mode guard
and every database operation. Unknown deployments fail closed. Local tests mock
Stripe; no local credential file is required. No billing-worker flags are used.

Stripe Customer Portal manages Pro price changes, payment methods and cancellation.
Its active default configuration must offer exactly the two approved Pro prices,
allow price/payment-method changes, and cancel at period end. The route verifies
this configuration and refuses Enterprise access. Enterprise is Contact Sales only.
No Stripe configuration was changed by this branch. Stripe account branding plus
the DMI logo, button colour and supported font keep Embedded Checkout branded.

## Incidents

- Paid but Free: check the Stripe Subscription, trusted metadata and approved
  Price mapping; inspect the return response/webhook delivery in Stripe. Do not
  grant access from the payment screen or profile plan. Stripe retries failed
  webhook deliveries; the return is an independent immediate sync path.
- past_due: access intentionally remains paid; use Portal to update the card.
- canceled/unpaid: access is Free. Scheduled cancellation alone retains access.
- Webhook failure: signature verification is unchanged (invalid signatures return
  400). Validly signed foreign/unknown ownership, mode, metadata or permanent
  validation failures return 200 with handled=false and a fixed sanitized warning;
  no exception text or identifiers are logged. The referenced DMI user must exist.
  Transient Stripe API/transport/rate-limit or database/auth-storage failures return
  503 for Stripe retry. Inspect Stripe delivery history; no local recovery engine.
- Wrong seats: inspect Enterprise Subscription quantity and the latest webhook.

## Local checks and later rollout

`npm run validate:billing`; `node scripts/validate-canonical-portal-entitlement.mjs`.
PostgreSQL tests accept explicit local binary/driver paths only:
`node scripts/validate-simple-billing-postgres.mjs /local/postgres/bin /local/pg`.
The cleanup test uses the same arguments with `validate-simple-billing-cleanup.mjs`.

All historical migrations are retained. The new table migration is additive.
`supabase/cleanup/retire_legacy_billing.review.sql` is a **future review artifact**,
outside automatic migrations. Its exact objects are in `CLEANUP-OBJECTS.json`.
It uses RESTRICT, aborts on unknown functions/dependencies and removes no profiles,
cards, business records or generic health monitoring. Never use CASCADE.

Before any separately authorised hosted rollout, review the new table, cleanup,
Stripe Portal configuration and removal of the external legacy QStash schedule.
Nothing here changes hosted configuration, runs a checkout or invokes a worker.
Finance links to Stripe financial history; admin subscriptions read this one mirror.
Generic health monitoring remains; webhook health is explicitly unverified without
an event ledger. Stripe remains source of truth for invoices/payments/refunds.
