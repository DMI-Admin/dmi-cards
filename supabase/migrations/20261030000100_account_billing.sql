-- Simple Stripe billing: one access mirror; Stripe owns financial history.
BEGIN;
CREATE TABLE public.account_billing (
 account_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 stripe_customer_id text UNIQUE,
 stripe_subscription_id text UNIQUE,
 plan text NOT NULL DEFAULT 'free' CHECK (plan IN ('free','pro','enterprise')),
 status text NOT NULL DEFAULT 'free' CHECK (status IN ('free','active','trialing','past_due','canceled','unpaid','paused','incomplete','incomplete_expired','unknown')),
 current_period_end timestamptz,
 cancel_at_period_end boolean NOT NULL DEFAULT false,
 seat_quantity integer NOT NULL DEFAULT 1 CHECK (seat_quantity>0),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (plan='free' OR (stripe_customer_id IS NOT NULL AND stripe_subscription_id IS NOT NULL AND status IN ('active','trialing','past_due')))
);
ALTER TABLE public.account_billing ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_billing FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_billing FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.account_billing TO authenticated;
GRANT SELECT,INSERT,UPDATE ON public.account_billing TO service_role;
CREATE POLICY account_billing_owner_read ON public.account_billing FOR SELECT TO authenticated
 USING (account_id=auth.uid());
COMMIT;
