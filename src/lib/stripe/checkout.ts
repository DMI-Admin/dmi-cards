import "server-only";
import type Stripe from "stripe";
import { DMI_STRIPE_APP_NAMESPACE } from "@/lib/stripe/app-namespace";
import { getStripeServerClient } from "@/lib/stripe/config";
import type { CheckoutBillingPlan, StripeBillingInterval } from "@/lib/stripe/billing-state";
import { approvedPrices, billingRuntime, BillingFailure, command, objectId, subscriptionsForCustomer, verifiedCustomerForUser, verifyCustomer, withAccount, type BillingAccount, type BillingRuntime } from "@/lib/stripe/reliability";

type CheckoutSessionInput = { userId: string; profileId?: string | null; email: string | null; plan: CheckoutBillingPlan; billingInterval: StripeBillingInterval; priceId: string } & (
  | { presentation?: "hosted"; successUrl: string; cancelUrl: string }
  | { presentation: "embedded"; returnUrl: string }
);

function presentation(mode: Stripe.Checkout.Session["ui_mode"] | undefined) {
  if (mode == null || mode === "hosted_page") return "hosted";
  if (mode === "embedded_page") return "embedded";
  throw new BillingFailure("CHECKOUT_PRESENTATION_UNAVAILABLE", 409);
}

function assertCheckoutOwner(session: Stripe.Checkout.Session, account: Pick<BillingAccount, "stripe_customer_id" | "checkout_attempt" | "checkout_parameters">, userId: string, live: boolean) {
  if (objectId(session.customer) !== account.stripe_customer_id || session.client_reference_id !== userId ||
      session.mode !== "subscription" || session.metadata?.dmi_app !== DMI_STRIPE_APP_NAMESPACE ||
      session.metadata?.dmi_user_id !== userId || session.metadata?.dmi_checkout_attempt !== account.checkout_attempt ||
      session.livemode !== live || presentation(session.ui_mode) !== presentation(account.checkout_parameters?.ui_mode)) {
    throw new BillingFailure("IDENTITY_CONFLICT", 409);
  }
}

// Read-only resumption of an already recorded attempt. Never creates around an
// arbitrary browser-supplied Session or acquires/mutates billing authority.
export async function readOwnedCheckoutSession(userId: string, sessionId: string, runtime?: BillingRuntime) {
  if (!/^cs_(?:test_|live_)?[A-Za-z0-9]{1,240}$/.test(sessionId)) throw new BillingFailure("INVALID_CHECKOUT", 409);
  const r = runtime || await billingRuntime();
  const { data, error } = await r.db.from("billing_accounts")
    .select("user_id,stripe_customer_id,verified_at,checkout_attempt,checkout_session_id,checkout_parameters")
    .eq("stripe_scope", r.scope).eq("user_id", userId).maybeSingle();
  if (error) throw new BillingFailure("BILLING_STORE_UNAVAILABLE");
  if (!data?.verified_at || !data.checkout_attempt || data.checkout_session_id !== sessionId) throw new BillingFailure("IDENTITY_CONFLICT", 409);
  const price = data.checkout_parameters?.line_items?.[0]?.price;
  if (!(await approvedPrices(r)).some(p => p.stripe_price_id === price && p.entitlement_enabled && p.checkout_enabled)) {
    throw new BillingFailure("UNKNOWN_CHECKOUT_PRICE", 409);
  }
  const session = await r.stripe.checkout.sessions.retrieve(sessionId, undefined, { timeout: 8000, maxNetworkRetries: 0 });
  assertCheckoutOwner(session, data, userId, r.live);
  return session;
}
const replayWindow = 20 * 60 * 60 * 1000;
function replayAllowed(at: string | null) { return Boolean(at && Date.now() - Date.parse(at) < replayWindow); }
async function assertIndividual(r: BillingRuntime, user: string) {
  // Identity UUID only; never email matching or Business entitlement writes.
  const [owners, staff] = await Promise.all([
    r.db.from("clients").select("id,account_type").or(`user_id.eq.${user},profile_id.eq.${user}`).limit(3),
    r.db.from("client_users").select("id,client:clients(account_type)").or(`user_id.eq.${user},profile_id.eq.${user}`).limit(3),
  ]);
  if (owners.error || staff.error || !owners.data || !staff.data) throw new BillingFailure("IDENTITY_UNAVAILABLE");
  if (owners.data.length > 1 || staff.data.length > 1 || owners.data.some(row => row.account_type !== "individual") || staff.data.some(row => {
    const client = row.client as unknown as { account_type: string } | null;
    return client?.account_type !== "individual";
  })) throw new BillingFailure("INDIVIDUAL_ACCOUNT_REQUIRED", 409);
}
async function customerForCheckout(r: BillingRuntime, initial: BillingAccount, input: CheckoutSessionInput): Promise<BillingAccount> {
  const existing = await verifiedCustomerForUser(r, initial);
  if (existing) return initial;
  let account = await command<BillingAccount>(r, "customer_prepare", input.userId, initial.lease_token, {
    ...(input.email ? { email: input.email } : {}), metadata: { dmi_app: DMI_STRIPE_APP_NAMESPACE, dmi_user_id: input.userId },
  });
  if (!account.customer_attempt || !account.customer_parameters) throw new BillingFailure("CUSTOMER_ATTEMPT_UNAVAILABLE");
  if (!replayAllowed(account.customer_attempt_at)) throw new BillingFailure("CUSTOMER_OUTCOME_UNKNOWN", 409);
  // Repeated attempts use the persisted parameters, not changed browser/profile values.
  await command(r, "touch", input.userId, account.lease_token);
  const customer = await r.stripe.customers.create({ ...account.customer_parameters, metadata: { ...account.customer_parameters.metadata, dmi_customer_attempt: account.customer_attempt } }, { idempotencyKey: `dmi:customer:${r.scope}:${account.customer_attempt}` });
  const verified = await verifyCustomer(r, input.userId, customer.id);
  if (verified.customer.metadata.dmi_user_id !== input.userId || verified.customer.metadata.dmi_app !== DMI_STRIPE_APP_NAMESPACE) throw new BillingFailure("IDENTITY_CONFLICT", 409);
  account = await command<BillingAccount>(r, "bind", input.userId, account.lease_token, { customer: customer.id });
  return account;
}
export async function createStripeCheckoutSession(input: CheckoutSessionInput, runtime?: BillingRuntime): Promise<Stripe.Checkout.Session> {
  const r = runtime || await billingRuntime();
  return withAccount(r, input.userId, async initial => {
    await assertIndividual(r, input.userId);
    const prices = await approvedPrices(r);
    if (!prices.some(price => price.stripe_price_id === input.priceId && price.entitlement_enabled && price.checkout_enabled)) throw new BillingFailure("UNKNOWN_CHECKOUT_PRICE", 409);
    let account = await customerForCheckout(r, initial, input);
    const customer = account.stripe_customer_id!;
    const subscriptions = await subscriptionsForCustomer(r, customer);
    // A dedicated customer must not contain ambiguous live subscriptions, even
    // if a foreign subscription cannot grant DMI access.
    const live = subscriptions.filter(sub => !["canceled", "incomplete_expired"].includes(sub.status));
    if (live.length > 1) throw new BillingFailure("MULTIPLE_SUBSCRIPTIONS", 409);
    const current = live[0];
    if (current && (current.metadata.dmi_user_id !== input.userId || current.metadata.dmi_app !== DMI_STRIPE_APP_NAMESPACE)) throw new BillingFailure("IDENTITY_CONFLICT", 409);
    if (current && current.status !== "incomplete") throw new BillingFailure(["past_due", "unpaid", "paused"].includes(current.status) ? "BILLING_RECOVERY_REQUIRED" : "SUBSCRIPTION_EXISTS", 409);
    if (account.checkout_attempt) {
      let session: Stripe.Checkout.Session | null = account.checkout_session_id ? await r.stripe.checkout.sessions.retrieve(account.checkout_session_id) : null;
      if (!session) {
        let seen = 0;
        for await (const candidate of r.stripe.checkout.sessions.list({ customer, limit: 100 })) {
          if (++seen > 10000) throw new BillingFailure("INVENTORY_LIMIT");
          if (candidate.metadata?.dmi_checkout_attempt === account.checkout_attempt) {
            if (session) throw new BillingFailure("MULTIPLE_CHECKOUTS", 409);
            session = candidate;
          }
        }
      }
      if (session) {
        assertCheckoutOwner(session, account, input.userId, r.live);
        await command(r, "checkout_record", input.userId, account.lease_token, { attempt: account.checkout_attempt, session: session.id });
        if (session.status === "open" && (presentation(session.ui_mode) === "embedded" ? session.client_secret : session.url)) {
          if (current && objectId(session.subscription) !== current.id) throw new BillingFailure("BILLING_RECOVERY_REQUIRED", 409);
          if (account.checkout_parameters?.line_items?.[0]?.price !== input.priceId) throw new BillingFailure("CHECKOUT_ALREADY_OPEN", 409);
          return session;
        }
        if (session.status === "complete") {
          const subscriptionId = objectId(session.subscription);
          if (!subscriptionId) throw new BillingFailure("BILLING_RECOVERY_REQUIRED", 409);
          const completed = await r.stripe.subscriptions.retrieve(subscriptionId);
          if (objectId(completed.customer) !== customer || completed.metadata.dmi_user_id !== input.userId || completed.metadata.dmi_app !== DMI_STRIPE_APP_NAMESPACE || completed.livemode !== r.live) throw new BillingFailure("IDENTITY_CONFLICT", 409);
          if (!["canceled", "incomplete_expired"].includes(completed.status)) throw new BillingFailure("BILLING_RECOVERY_REQUIRED", 409);
        } else if (session.status !== "expired") throw new BillingFailure("CHECKOUT_OUTCOME_UNKNOWN", 409);
        if (current) throw new BillingFailure("BILLING_RECOVERY_REQUIRED", 409);
        account = await command<BillingAccount>(r, "checkout_clear", input.userId, account.lease_token);
      } else if (!replayAllowed(account.checkout_attempt_at)) throw new BillingFailure("CHECKOUT_OUTCOME_UNKNOWN", 409);
    }
    if (current) throw new BillingFailure("BILLING_RECOVERY_REQUIRED", 409);
    if (account.checkout_attempt && account.checkout_parameters?.line_items?.[0]?.price !== input.priceId) throw new BillingFailure("CHECKOUT_ALREADY_OPEN", 409);
    if (!account.checkout_attempt) {
      // Do not create around an unrelated/unrecorded open Checkout session.
      let seen = 0;
      for await (const session of r.stripe.checkout.sessions.list({ customer, status: "open", limit: 100 })) {
        if (++seen > 10000) throw new BillingFailure("INVENTORY_LIMIT");
        if (session.mode === "subscription") throw new BillingFailure("UNRESOLVED_CHECKOUT", 409);
      }
    }
    account = await command<BillingAccount>(r, "checkout_prepare", input.userId, account.lease_token, {
      mode: "subscription", customer, client_reference_id: input.userId, line_items: [{ price: input.priceId, quantity: 1 }],
      metadata: { dmi_app: DMI_STRIPE_APP_NAMESPACE, dmi_user_id: input.userId, dmi_plan: "pro", billing_interval: input.billingInterval },
      subscription_data: { metadata: { dmi_app: DMI_STRIPE_APP_NAMESPACE, dmi_user_id: input.userId, dmi_profile_id: input.userId, dmi_plan: "pro", billing_interval: input.billingInterval } },
      allow_promotion_codes: true,
      ...(input.presentation === "embedded"
        ? { ui_mode: "embedded_page" as const, return_url: input.returnUrl, redirect_on_completion: "if_required" as const, payment_method_types: ["card" as const] }
        : { success_url: input.successUrl, cancel_url: input.cancelUrl }),
    });
    if (!account.checkout_attempt || !account.checkout_parameters || !replayAllowed(account.checkout_attempt_at)) throw new BillingFailure("CHECKOUT_OUTCOME_UNKNOWN", 409);
    await command(r, "touch", input.userId, account.lease_token);
    const session = await r.stripe.checkout.sessions.create({ ...account.checkout_parameters, metadata: { ...account.checkout_parameters.metadata, dmi_checkout_attempt: account.checkout_attempt } }, { idempotencyKey: `dmi:checkout:${r.scope}:${account.checkout_attempt}` });
    assertCheckoutOwner(session, account, input.userId, r.live);
    await command(r, "checkout_record", input.userId, account.lease_token, { attempt: account.checkout_attempt, session: session.id });
    return session;
  });
}
export async function billingCustomerForUser(userId: string, runtime?: BillingRuntime) {
  const r = runtime || await billingRuntime();
  return withAccount(r, userId, async account => {
    const customer = await verifiedCustomerForUser(r, account);
    if (!customer) throw new BillingFailure("NO_BILLING_ACCOUNT", 409);
    return customer;
  });
}
export async function createStripeBillingPortalSession({ customerId, returnUrl }: { customerId: string; returnUrl: string }) {
  return getStripeServerClient().billingPortal.sessions.create({ customer: customerId, return_url: returnUrl });
}
