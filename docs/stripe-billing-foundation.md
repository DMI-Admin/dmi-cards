# Stripe Billing Foundation

Stage 2B prepares Stripe as the future paid-plan authority for DMI Cards.
No live Stripe configuration or Supabase migration is applied by this stage.

## Required Environment Variables

Set these only in secure server environments such as Vercel project
environment variables. Do not expose them with a `NEXT_PUBLIC_` prefix.

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_PRO_MONTHLY`
- `STRIPE_PRICE_PRO_ANNUAL`
- `SUPABASE_SERVICE_ROLE_KEY`

Existing public Supabase variables are still required for normal app and API
authentication:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## Manual Stripe Configuration Later

- Create subscription prices for the DMI Pro plan.
- Use one recurring monthly Pro price and one recurring annual Pro price.
- Store the resulting Stripe price IDs in the matching environment variables.
- Enterprise is quote-based and must not use public self-service Checkout.
- Create a Stripe webhook endpoint for `/api/stripe/webhook`.
- Configure the webhook endpoint secret as `STRIPE_WEBHOOK_SECRET`.
- Send at least:
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_failed`

## Supabase Migration

The proposed migration is:

`supabase/migrations/20260807143000_create_stripe_billing_state.sql`

Apply it only after review. It creates server-controlled billing tables and
does not grant client write policies.

Until the migration is applied and API plan resolution is deliberately switched
to trusted billing state, `/api/v1` remains capped at `temporary_free_cap`.
