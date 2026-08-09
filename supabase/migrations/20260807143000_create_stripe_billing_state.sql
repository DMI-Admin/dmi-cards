create table if not exists public.billing_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete cascade,
  stripe_customer_id text not null,
  stripe_subscription_id text not null,
  stripe_subscription_status text not null default 'unknown',
  stripe_price_id text,
  dmi_plan text not null default 'free',
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  latest_invoice_id text,
  checkout_session_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_subscriptions_status_check check (
    stripe_subscription_status in (
      'active',
      'trialing',
      'past_due',
      'unpaid',
      'canceled',
      'incomplete',
      'incomplete_expired',
      'paused',
      'unknown'
    )
  ),
  constraint billing_subscriptions_plan_check check (
    dmi_plan in ('free', 'individual_pro', 'business', 'enterprise')
  )
);

create unique index if not exists billing_subscriptions_subscription_id_unique_idx
  on public.billing_subscriptions (stripe_subscription_id);

create index if not exists billing_subscriptions_user_id_idx
  on public.billing_subscriptions (user_id);

create index if not exists billing_subscriptions_profile_id_idx
  on public.billing_subscriptions (profile_id);

create index if not exists billing_subscriptions_customer_id_idx
  on public.billing_subscriptions (stripe_customer_id);

create table if not exists public.stripe_webhook_events (
  stripe_event_id text primary key,
  event_type text not null,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.billing_subscriptions enable row level security;
alter table public.stripe_webhook_events enable row level security;

drop policy if exists "Users can read own billing subscription" on public.billing_subscriptions;
create policy "Users can read own billing subscription"
  on public.billing_subscriptions
  for select
  to authenticated
  using (auth.uid() = user_id or auth.uid() = profile_id);

-- Intentionally no client insert/update/delete policies.
-- Stripe webhook writes must use the server-only Supabase service-role client.
-- stripe_webhook_events is intentionally unreadable/unwritable by client roles.
