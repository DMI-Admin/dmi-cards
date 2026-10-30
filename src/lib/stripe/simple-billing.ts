import "server-only";
import type Stripe from "stripe";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { getStripeServerClient } from "./config";
import type { DmiPlan } from "@/lib/entitlements";

export type AccountBilling = {
  account_id: string; stripe_customer_id: string | null; stripe_subscription_id: string | null;
  plan: DmiPlan; status: string; current_period_end: string | null;
  cancel_at_period_end: boolean; seat_quantity: number; updated_at: string;
};
type Prices = { monthly: string; annual: string; enterpriseProduct?: string };
type Store = {
  hasAccount: (account: string) => Promise<boolean>;
  read: (account: string) => Promise<AccountBilling | null>;
  save: (row: AccountBilling) => Promise<void>;
  bind: (account: string, customer: string) => Promise<void>;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const paid = new Set(['active','trialing','past_due']);
const statuses = new Set(['active','trialing','past_due','canceled','unpaid','paused','incomplete','incomplete_expired']);
const ref = (value: string | {id: string} | null | undefined) => typeof value === 'string' ? value : value?.id;
export const relevantEvents = new Set(['customer.subscription.created','customer.subscription.updated','customer.subscription.deleted','invoice.payment_failed']);

// Fixed categories only: never return/log provider payloads or exception messages.
export class BillingRejection extends Error {}
export class BillingUnavailable extends Error {}
export function isTransientBillingFailure(error: unknown) {
  const e = error as {type?: string; statusCode?: number} | null;
  return error instanceof BillingUnavailable || ['StripeConnectionError','StripeAPIError','StripeRateLimitError'].includes(e?.type || '') || e?.statusCode === 429 || (e?.statusCode ?? 0) >= 500;
}
function storageFailure(error: {code?: string}, status: number) {
  if (status === 429 || status >= 500 || !error.code || /^(08|53|58|57P)/.test(error.code) || ['40001','40P01','PGRST000','PGRST001','PGRST002','PGRST003'].includes(error.code)) throw new BillingUnavailable();
  throw new BillingRejection();
}

// A small injectable boundary for offline tests, not a second sync implementation.
export function billingService(stripe: Stripe, store: Store, prices: Prices, origin: string, live: boolean) {
  if (!prices.monthly || !prices.annual || prices.monthly === prices.annual) throw new BillingRejection();
  const owned = (metadata: Stripe.Metadata | null, account: string) => metadata?.dmi_app === 'dmi_cards' && metadata.dmi_user_id === account;
  async function customer(account: string, customerId: string, allowDeleted = false) {
    const c = await stripe.customers.retrieve(customerId);
    if (c.deleted) {if(allowDeleted)return c;throw new BillingRejection();}
    if (c.livemode !== live || !owned(c.metadata, account)) throw new BillingRejection();
    return c;
  }
  async function syncSubscriptionFromStripe(subscriptionId: string, expectedAccount?: string): Promise<AccountBilling> {
    const s = await stripe.subscriptions.retrieve(subscriptionId);
    const account = s.metadata?.dmi_user_id;
    if (s.livemode !== live || !uuid.test(account || '') || !owned(s.metadata, account || '') || (expectedAccount && account !== expectedAccount)) throw new BillingRejection();
    if (!await store.hasAccount(account)) throw new BillingRejection();
    const customerId = ref(s.customer);
    if (!customerId) throw new BillingRejection();
    const before = await store.read(account);
    if (before?.stripe_customer_id && before.stripe_customer_id !== customerId) throw new BillingRejection();
    await customer(account, customerId, !paid.has(s.status) && before?.stripe_customer_id === customerId);
    // A delayed event for an old canceled Subscription must not replace a current one.
    // Consult Stripe again, not local event timestamps or an event-ordering ledger.
    if (before?.stripe_subscription_id && before.stripe_subscription_id !== s.id) {
      const current = await stripe.subscriptions.retrieve(before.stripe_subscription_id);
      if (paid.has(current.status)) {
        if (paid.has(s.status)) throw new BillingRejection();
        return syncSubscriptionFromStripe(current.id,account);
      }
    }
    const item = s.items.data[0], price = item?.price.id;
    const mapped = price === prices.monthly || price === prices.annual ? 'pro' : prices.enterpriseProduct && ref(item?.price.product) === prices.enterpriseProduct ? 'enterprise' : 'free';
    const plan: DmiPlan = paid.has(s.status) && !s.items.has_more && s.items.data.length === 1 ? mapped : 'free';
    const quantity = item?.quantity ?? 1;
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 2147483647) throw new BillingRejection();
    const row: AccountBilling = {
      account_id: account, stripe_customer_id: customerId, stripe_subscription_id: s.id,
      plan, status: statuses.has(s.status) ? s.status : 'unknown', current_period_end: item?.current_period_end ? new Date(item.current_period_end * 1000).toISOString() : null,
      cancel_at_period_end: s.cancel_at_period_end, seat_quantity: mapped === 'enterprise' ? quantity : 1,
      updated_at: new Date().toISOString(),
    };
    await store.save(row);
    return row;
  }
  async function checkout(account: string, interval: 'monthly' | 'annual', requestId: string) {
    if (!uuid.test(account) || !uuid.test(requestId) || !['monthly','annual'].includes(interval)) throw Error('Invalid checkout');
    let row = await store.read(account);
    if (!row?.stripe_customer_id) {
      const c = await stripe.customers.create({ metadata: {dmi_app:'dmi_cards',dmi_user_id:account} }, {idempotencyKey:`dmi:customer:${live}:${account}`});
      await store.bind(account,c.id);
      row = await store.read(account);
    }
    if (!row?.stripe_customer_id) throw Error('Customer unavailable');
    const c = await customer(account,row.stripe_customer_id);
    const subscriptions = await stripe.subscriptions.list({customer:c.id,status:'all',limit:100});
    if (subscriptions.has_more || subscriptions.data.some(s => !['canceled','incomplete_expired'].includes(s.status))) throw Error('Manage your existing subscription in Billing');
    const sessions = await stripe.checkout.sessions.list({customer:c.id,status:'open',limit:100});
    if (sessions.has_more) throw Error('Checkout inventory unavailable');
    let open = sessions.data.find(s => s.mode === 'subscription');
    if (open && (!owned(open.metadata,account) || open.ui_mode !== 'embedded_page' || open.client_reference_id !== account)) throw Error('An unrelated checkout already exists');
    if (open && open.metadata?.billing_interval !== interval) {await stripe.checkout.sessions.expire(open.id);open=undefined;}
    const session = open || await stripe.checkout.sessions.create({
      mode:'subscription',ui_mode:'embedded_page',customer:c.id,client_reference_id:account,
      payment_method_types:['card'],line_items:[{price:prices[interval],quantity:1}],
      metadata:{dmi_app:'dmi_cards',dmi_user_id:account,billing_interval:interval},
      subscription_data:{metadata:{dmi_app:'dmi_cards',dmi_user_id:account}},
      return_url:`${origin}/client/billing/complete?session_id={CHECKOUT_SESSION_ID}`,
      redirect_on_completion:'if_required',
      branding_settings:{display_name:'DMI Cards',button_color:'#8C16EB',font_family:'inter'},
    }, {idempotencyKey:`dmi:checkout:${live}:${account}:${requestId}`});
    if (session.livemode !== live || !session.client_secret) throw Error('Checkout unavailable');
    return {sessionId:session.id,clientSecret:session.client_secret};
  }
  async function complete(account: string, sessionId: string) {
    const s = await stripe.checkout.sessions.retrieve(sessionId);
    if (s.livemode !== live || s.mode !== 'subscription' || s.status !== 'complete' || !['paid','no_payment_required'].includes(s.payment_status) || s.client_reference_id !== account || !owned(s.metadata,account) || !ref(s.subscription)) throw Error('Checkout is not confirmed for this account');
    await customer(account,ref(s.customer)!);
    return syncSubscriptionFromStripe(ref(s.subscription)!,account);
  }
  async function portal(account: string) {
    const row = await store.read(account);
    if (!row?.stripe_customer_id) throw Error('No Stripe customer');
    await customer(account,row.stripe_customer_id);
    if (row.plan === 'enterprise') throw Error('Enterprise is managed through Contact Sales');
    if (row.stripe_subscription_id) {
      const s = await stripe.subscriptions.retrieve(row.stripe_subscription_id);
      if (s.items.data.some(i => ![prices.monthly,prices.annual].includes(i.price.id))) throw Error('Only Pro subscriptions use the self-service Portal');
    }
    const configurations = await stripe.billingPortal.configurations.list({active:true,is_default:true,limit:1});
    const configuration = configurations.data[0];
    const products = configuration?.features.subscription_update.products;
    const allowed = new Set([prices.monthly,prices.annual]);
    if (!configuration || !products?.length || new Set(products.flatMap(p=>p.prices)).size!==2 || products.some(p => p.prices.some(p => !allowed.has(p))) || !configuration.features.subscription_update.enabled || !configuration.features.subscription_update.default_allowed_updates.includes('price') || !configuration.features.payment_method_update.enabled || !configuration.features.subscription_cancel.enabled || configuration.features.subscription_cancel.mode!=='at_period_end') throw Error('Pro-only Stripe Portal configuration is required');
    return stripe.billingPortal.sessions.create({customer:row.stripe_customer_id,configuration:configuration.id,return_url:`${origin}/client/billing`});
  }
  async function webhook(event: Stripe.Event) {
    if (event.livemode !== live) throw new BillingRejection();
    if (!relevantEvents.has(event.type)) return false;
    const object = event.data.object;
    const subscriptionEvent = event.type.startsWith('customer.subscription.');
    const expectedAccount = subscriptionEvent ? (object as Stripe.Subscription).metadata?.dmi_user_id : undefined;
    if (subscriptionEvent && (!uuid.test(expectedAccount || '') || !owned((object as Stripe.Subscription).metadata,expectedAccount || ''))) throw new BillingRejection();
    let subscription = event.type.startsWith('customer.subscription.') ? (object as Stripe.Subscription).id : ref((object as Stripe.Invoice).parent?.subscription_details?.subscription);
    if (!subscription && event.type === 'invoice.payment_failed') subscription = ref((await stripe.invoices.retrieve((object as Stripe.Invoice).id)).parent?.subscription_details?.subscription);
    if (!subscription) throw new BillingRejection();
    await syncSubscriptionFromStripe(subscription,expectedAccount);
    return true;
  }
  return {syncSubscriptionFromStripe,checkout,complete,portal,webhook};
}

export function simpleBilling() {
  const env = process.env;
  const live = env.VERCEL_ENV === 'production' && env.VERCEL_TARGET_ENV === 'production';
  const staging = env.VERCEL_ENV === 'preview' && env.VERCEL_TARGET_ENV === 'staging';
  if (!(live ? /^pk_live_/ : /^pk_test_/).test(env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || '') || (!live && !staging) || env.VERCEL_PROJECT_ID !== 'prj_FPTsXDokhm5uSDMaxieuo5Cmp0Rn' || !(live ? /^(sk|rk)_live_/ : /^(sk|rk)_test_/).test(env.STRIPE_SECRET_KEY || '')) throw new BillingRejection();
  const db = createSupabaseAdminClient();
  const read: Store['read'] = async account => {
    const {data,error,status} = await db.from('account_billing').select('*').eq('account_id',account).maybeSingle();
    if (error) storageFailure(error,status);
    return data;
  };
  return billingService(getStripeServerClient(), {
    read,
    hasAccount: async account => {
      const {data,error}=await db.auth.admin.getUserById(account);
      if(error && (error.status === 0 || error.status === 429 || error.name === 'AuthRetryableFetchError' || (error.status ?? 0) >= 500)) throw new BillingUnavailable();
      return !error && data.user?.id === account;
    },
    save: async row => {const {error,status}=await db.from('account_billing').upsert(row,{onConflict:'account_id'});if(error)storageFailure(error,status);},
    bind: async (account,cus) => {
      const {error}=await db.from('account_billing').upsert({account_id:account,stripe_customer_id:cus},{onConflict:'account_id',ignoreDuplicates:true});
      if(error)throw Error('Customer binding unavailable');
      const {error:updateError}=await db.from('account_billing').update({stripe_customer_id:cus}).eq('account_id',account).is('stripe_customer_id',null);
      if(updateError || (await read(account))?.stripe_customer_id !== cus)throw Error('Customer binding conflict');
    },
  }, {monthly:env.STRIPE_PRICE_PRO_MONTHLY || '',annual:env.STRIPE_PRICE_PRO_ANNUAL || '',enterpriseProduct:env.STRIPE_PRODUCT_ENTERPRISE}, live ? 'https://app.dmicards.com' : 'https://staging.dmicards.com',live);
}
