import "server-only";
import { classifyClaimStoreError } from "./webhook-observer";
import type {ClaimFailureCategory, Observer, Stage} from "./webhook-observer";
import type Stripe from "stripe";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { getStripeServerClient, resolveStripeAccountScope } from "@/lib/stripe/config";
import { ApiRouteError } from "@/lib/api/responses";
import { hasDmiStripeAppNamespace } from "@/lib/stripe/app-namespace";

export class BillingFailure extends ApiRouteError {
  constructor(public reason: string, status: 409 | 503 = 503, public readonly claimFailureCategory?: ClaimFailureCategory) {
    super(status, status === 409 ? "CONFLICT" : "INTERNAL_ERROR", `Billing operation unavailable (${reason}). Please retry or contact support.`);
  }
}
export type BillingRuntime = { observer?: Observer; db: ReturnType<typeof createSupabaseAdminClient>; stripe: Stripe; scope: string; live: boolean };
export type BillingAccount = {
  user_id: string; stripe_customer_id: string | null; lease_token: string;
  customer_attempt: string | null; customer_attempt_at: string | null; customer_parameters: Stripe.CustomerCreateParams | null;
  checkout_attempt: string | null; checkout_attempt_at: string | null; checkout_parameters: Stripe.Checkout.SessionCreateParams | null; checkout_session_id: string | null;
};
export type Mirror = { user_id: string; stripe_customer_id: string; stripe_subscription_id: string; stripe_scope: string | null; revision: number; last_event_created: number | null; terminal: boolean; sync_snapshot: Snapshot | null };
export type Snapshot = { subscription_id: string; customer_id: string; status: string; price_id: string | null; plan: "free" | "pro"; period_start: string | null; period_end: string | null; trial_end: string | null; ended_at: string | null; cancel_at_period_end: boolean; invoice_id: string | null; terminal: boolean };
export type EventClaim = { id: string; created: number; token: string };
let scopePromise: Promise<{ scope: string; live: boolean }> | null = null;
export async function billingRuntime(): Promise<BillingRuntime> {
  const stripe = getStripeServerClient();
  scopePromise ||= resolveStripeAccountScope().then(result => ({ scope: result.stripeScope, live: result.livemode })).catch(() => { scopePromise = null; throw new BillingFailure("SCOPE_UNAVAILABLE"); });
  return { stripe, db: createSupabaseAdminClient(), ...await scopePromise };
}
export async function command<T>(r: BillingRuntime, action: string, user: string | null, token: string | null, input: object = {}): Promise<T> {
  const work = async () => {
  const { data, error } = await r.db.rpc("billing_foundation_command", { p_action: action, p_scope: r.scope, p_user: user, p_token: token, p_input: input });
  if (error) {
    const reason = /BILLING_(BUSY|FENCE|REVISION|IDENTITY|SCOPE|UNKNOWN_PRICE)/.exec(error.message || "")?.[0] || "BILLING_STORE_UNAVAILABLE";
    throw new BillingFailure(reason, reason === "BILLING_IDENTITY" ? 409 : 503, action === "claim" ? (reason === "BILLING_BUSY" ? "LEASE_BUSY" : classifyClaimStoreError(error)) : undefined);
  }
  return data as T;
  };
  return r.observer ? r.observer.run(action as Stage, work) : work();
}
export async function withAccount<T>(r: BillingRuntime, userId: string, run: (account: BillingAccount) => Promise<T>): Promise<T> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) throw new BillingFailure("IDENTITY_CONFLICT", 409);
  const account = await command<BillingAccount>(r, "claim", userId, null);
  try { return await run(account); }
  finally { await command(r, "release", userId, account.lease_token).catch(() => undefined); }
}
export async function mirrorsFor(r: BillingRuntime, field: "user_id" | "stripe_customer_id", value: string): Promise<Mirror[]> {
  const rows: Mirror[] = [];
  for (let offset = 0; ;) {
    const { data, error } = await r.db.from("billing_subscriptions").select("user_id,stripe_customer_id,stripe_subscription_id,stripe_scope,revision,last_event_created,terminal,sync_snapshot").eq(field, value).order("stripe_subscription_id").range(offset, offset + 499);
    if (error || !data) throw new BillingFailure("MIRROR_UNAVAILABLE");
    rows.push(...data as Mirror[]);
    if (rows.length > 10000) throw new BillingFailure("INVENTORY_LIMIT");
    if (!data.length) return rows;
    offset += data.length;
  }
}
export async function approvedPrices(r: BillingRuntime) {
  const { data, error } = await r.db.from("billing_approved_prices").select("stripe_price_id,entitlement_enabled,checkout_enabled").eq("stripe_scope", r.scope).limit(1001);
  if (error || !data || data.length > 1000) throw new BillingFailure("PRICE_REGISTRY_UNAVAILABLE");
  return data as { stripe_price_id: string; entitlement_enabled: boolean; checkout_enabled: boolean }[];
}
export function objectId(value: string | { id: string } | null | undefined) { return typeof value === "string" ? value : value?.id || ""; }
export function invoiceSubscription(invoice: Stripe.Invoice): string | null {
  const parent = invoice.parent;
  if (parent?.type === "subscription_details") {
    const id = objectId(parent.subscription_details?.subscription);
    if (!id) throw new BillingFailure("MALFORMED_INVOICE");
    return id;
  }
  if (parent?.subscription_details) throw new BillingFailure("MALFORMED_INVOICE");
  const legacy = invoice as Stripe.Invoice & { subscription?: string | { id: string } | null };
  if (legacy.subscription != null) {
    const id = objectId(legacy.subscription);
    if (!id) throw new BillingFailure("MALFORMED_INVOICE");
    return id;
  }
  return null;
}
export async function verifyCustomer(r: BillingRuntime, userId: string, customerId: string) {
  const customer = await r.stripe.customers.retrieve(customerId);
  if (customer.deleted || customer.livemode !== r.live) throw new BillingFailure("CUSTOMER_UNAVAILABLE");
  const rows = await mirrorsFor(r, "stripe_customer_id", customerId);
  if (rows.some(row => row.user_id !== userId || (row.stripe_scope && row.stripe_scope !== r.scope)) || (customer.metadata.dmi_user_id && customer.metadata.dmi_user_id !== userId)
    || (customer.metadata.dmi_app && !hasDmiStripeAppNamespace(customer.metadata))) throw new BillingFailure("IDENTITY_CONFLICT", 409);
  return { customer, mirrored: rows.some(row => row.user_id === userId) };
}
export async function verifiedCustomerForUser(r: BillingRuntime, account: BillingAccount, persist = true): Promise<string | null> {
  const rows = await mirrorsFor(r, "user_id", account.user_id);
  if (rows.some(row => row.stripe_scope && row.stripe_scope !== r.scope)) throw new BillingFailure("SCOPE_CONFLICT", 409);
  const ids = [...new Set([account.stripe_customer_id, ...rows.map(row => row.stripe_customer_id)].filter((id): id is string => Boolean(id)))];
  if (ids.length > 1) throw new BillingFailure("MULTIPLE_CUSTOMERS", 409);
  if (!ids.length) return null;
  const { customer, mirrored } = await verifyCustomer(r, account.user_id, ids[0]);
  if (!account.stripe_customer_id && !mirrored && !(hasDmiStripeAppNamespace(customer.metadata) && customer.metadata.dmi_user_id === account.user_id)) throw new BillingFailure("IDENTITY_CONFLICT", 409);
  if (persist) await command(r, "bind", account.user_id, account.lease_token, { customer: ids[0] });
  account.stripe_customer_id = ids[0];
  return ids[0];
}
export async function subscriptionsForCustomer(r: BillingRuntime, customer: string) {
  const rows: Stripe.Subscription[] = [];
  for await (const subscription of r.stripe.subscriptions.list({ customer, status: "all", limit: 100 })) {
    if (rows.length >= 10000) throw new BillingFailure("INVENTORY_LIMIT");
    rows.push(subscription);
  }
  return rows;
}
function iso(n: number | null | undefined) { return n ? new Date(n * 1000).toISOString() : null; }
export async function subscriptionSnapshot(r: BillingRuntime, subscription: Stripe.Subscription): Promise<Snapshot> {
  if (!hasDmiStripeAppNamespace(subscription.metadata) || subscription.livemode !== r.live) throw new BillingFailure("SCOPE_CONFLICT", 409);
  if (subscription.items.has_more) throw new BillingFailure("AMBIGUOUS_ITEMS", 409);
  const prices = await approvedPrices(r);
  const approved = subscription.items.data.filter(item => prices.some(price => price.stripe_price_id === item.price.id && price.entitlement_enabled));
  if (approved.length > 1) throw new BillingFailure("AMBIGUOUS_ITEMS", 409);
  const paid = subscription.status === "active" || subscription.status === "trialing";
  if (paid && !approved.length) throw new BillingFailure("UNKNOWN_PRICE", 409);
  const item = approved[0] || subscription.items.data[0];
  return { subscription_id: subscription.id, customer_id: objectId(subscription.customer), status: subscription.status, price_id: item?.price.id || null,
    plan: paid && approved.length ? "pro" : "free", period_start: iso(item?.current_period_start), period_end: iso(item?.current_period_end), trial_end: iso(subscription.trial_end),
    ended_at: iso(subscription.ended_at), cancel_at_period_end: subscription.cancel_at_period_end, invoice_id: objectId(subscription.latest_invoice) || null, terminal: subscription.status === "canceled" };
}
export async function synchronizeSubscription(r: BillingRuntime, subscriptionId: string, options: { userId?: string; event?: EventClaim; deleted?: Stripe.Subscription; dryRun?: boolean } = {}) {
  // This first retrieval resolves identity only. Retrieve AGAIN under the account
  // lease so a pre-lock snapshot can never overwrite a later completed writer.
  async function retrieve() {
    try {
      const current = await r.stripe.subscriptions.retrieve(subscriptionId, { expand: ["items.data.price"] });
      return options.deleted?.id === subscriptionId && options.deleted.status === "canceled" ? options.deleted : current;
    }
    catch (error) {
      if ((error as { code?: string }).code === "resource_missing" && options.deleted?.id === subscriptionId && options.deleted.status === "canceled") return options.deleted;
      if ((error as { code?: string }).code === "resource_missing") throw new BillingFailure("MISSING_OBJECT");
      throw new BillingFailure("STRIPE_UNAVAILABLE");
    }
  }
  const initial = await retrieve();
  if (!hasDmiStripeAppNamespace(initial.metadata) || initial.livemode !== r.live) throw new BillingFailure("SCOPE_CONFLICT", 409);
  const userId = initial.metadata.dmi_user_id;
  if (!userId || (options.userId && options.userId !== userId) || (initial.metadata.dmi_profile_id && initial.metadata.dmi_profile_id !== userId)) throw new BillingFailure("IDENTITY_CONFLICT", 409);
  return withAccount(r, userId, async account => {
    const subscription = await retrieve();
    if (subscription.metadata.dmi_user_id !== userId || (subscription.metadata.dmi_profile_id && subscription.metadata.dmi_profile_id !== userId)) throw new BillingFailure("IDENTITY_CONFLICT", 409);
    const customerId = objectId(subscription.customer);
    await verifyCustomer(r, userId, customerId);
    const mirrors = await mirrorsFor(r, "user_id", userId);
    if (mirrors.some(row => row.stripe_customer_id !== customerId || (row.stripe_scope && row.stripe_scope !== r.scope)) || (account.stripe_customer_id && account.stripe_customer_id !== customerId)) throw new BillingFailure("IDENTITY_CONFLICT", 409);
    const before = mirrors.find(row => row.stripe_subscription_id === subscriptionId);
    const stale = options.event && before?.last_event_created != null && options.event.created < before.last_event_created;
    if (stale) {
      if (options.event) await command(r, "event_finish", null, options.event.token, { id: options.event.id, outcome: "stale_ignored" });
      return { outcome: "stale_ignored", beforeRevision: before.revision, revision: before.revision };
    }
    const snapshot = await subscriptionSnapshot(r, subscription);
    const terminal = before?.terminal && !snapshot.terminal;
    const unchanged = Boolean(before?.sync_snapshot && Object.entries(snapshot).every(([key, value]) => before.sync_snapshot?.[key as keyof Snapshot] === value));
    if (options.dryRun) return { outcome: terminal ? "terminal_ignored" : unchanged ? "unchanged" : "would_repair", beforeRevision: before?.revision || 0, revision: before?.revision || 0 };
    await command(r, "bind", userId, account.lease_token, { customer: customerId });
    const result = await command<{ outcome: string; revision: number }>(r, "commit", userId, account.lease_token, {
      snapshot, expected_revision: before?.revision || 0,
      ...(options.event ? { event_id: options.event.id, event_created: options.event.created, event_token: options.event.token } : {}),
    });
    return { ...result, beforeRevision: before?.revision || 0 };
  });
}
