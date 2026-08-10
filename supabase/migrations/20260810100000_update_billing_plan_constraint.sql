alter table public.billing_subscriptions
  drop constraint if exists billing_subscriptions_plan_check;

update public.billing_subscriptions
set dmi_plan = 'pro'
where dmi_plan in ('individual_pro', 'business');

alter table public.billing_subscriptions
  add constraint billing_subscriptions_plan_check
  check (dmi_plan in ('free', 'pro', 'enterprise'));
