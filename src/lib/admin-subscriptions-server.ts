import "server-only";
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { requireAdminAccess } from "@/lib/admin-auth";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { getStripeServerClient, resolveStripeAccountScope } from "@/lib/stripe/config";
import { subscriptionStatus, subscriptionSummary, subscriptionPaying, subscriptionRenewal, configuredUnitPrice, verifiedInterval, type SubscriptionItem } from "@/lib/admin-subscriptions";

const headers = { "Cache-Control": "private, no-store" };
type Row = Record<string, unknown>;
const str = (x: unknown) => typeof x === "string" ? x : "";
type Price = { interval: string; display: string };
// These reasons prevent effective valuation, not knowledge of a configured unit price.
const unitPriceOnlyReasons = new Set(["tax_basis_unresolved", "unexpanded_discount", "unexpanded_coupon", "deleted_coupon", "ambiguous_discount", "unsupported_discount_context", "discount_requires_refresh", "stacked_discounts", "discount_currency_mismatch"]);
function permitsUnitPrice(row: Row) {
  return row.valuation_status === "complete" || (["unsupported", "incomplete"].includes(str(row.valuation_status)) && unitPriceOnlyReasons.has(str(row.valuation_reason)));
}
function financeUnitPrice(item: Row): string {
  const integer=item.unit_amount_minor, decimal=item.unit_amount_decimal_minor;
  if(integer!=null && (typeof integer!=="string" || !/^\d{1,19}$/.test(integer) || BigInt(integer)>BigInt("9223372036854775807")))return "Unavailable";
  if(decimal!=null && (typeof decimal!=="string" || !/^\d{1,26}(\.\d{1,12})?$/.test(decimal)))return "Unavailable";
  if(integer==null && decimal==null)return "Unavailable";
  if(typeof integer==="string" && typeof decimal==="string"){
    const [whole,fraction=""]=decimal.split(".");
    if(BigInt(whole+fraction)!==BigInt(integer)*BigInt(10)**BigInt(fraction.length))return "Unavailable";
  }
  return configuredUnitPrice(decimal ?? integer,item.currency);
}
// Cache is scoped to the actual Stripe client, never shared across credentials.
const cache = new WeakMap<Stripe, Map<string, { until: number; value: Promise<Price | null> }>>();
async function priceMetadata(stripe: Stripe, id: string, scope: string): Promise<Price | null> {
  let entries = cache.get(stripe);
  if (!entries) { entries = new Map(); cache.set(stripe, entries); }
  const key=`${scope}:${id}`;
  const hit = entries.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  if (entries.size >= 200) entries.clear();
  const value = stripe.prices.retrieve(id, {}, { timeout: 5000, maxNetworkRetries: 0 }).then(p => {
    if(p.id!==id || p.livemode!==scope.endsWith(":live") || !p.recurring) return null;
    const interval=verifiedInterval(p.recurring.interval,p.recurring.interval_count);
    const minor=p.unit_amount_decimal!=null ? p.unit_amount_decimal.toString() : typeof p.unit_amount==="number" && Number.isSafeInteger(p.unit_amount) ? String(p.unit_amount) : null;
    const display=p.billing_scheme==="per_unit" && p.recurring.usage_type==="licensed" && p.transform_quantity==null ? configuredUnitPrice(minor,p.currency) : "Unavailable";
    return {interval,display};
  }).catch(() => null);
  entries.set(key, { until: Date.now() + 60000, value });
  return value;
}
export async function readAdminSubscriptions(request: Request) {
  try {
    const access = await requireAdminAccess(await auth());
    if (!access.authorized) return NextResponse.json({ error: "Admin access required." }, { status: 403, headers });
    const params = new URL(request.url).searchParams;
    const search = (params.get("search") || "").trim().toLowerCase();
    const pageText = params.get("page") || "1";
    if (!/^[1-9]\d{0,3}$/.test(pageText) || search.length > 100 || [...params.keys()].some(k => !["search","page","plan","status","interval"].includes(k) || params.getAll(k).length !== 1)) return NextResponse.json({ error: "Invalid filters." }, { status: 400, headers });
    const { stripeScope } = await resolveStripeAccountScope();
    if (!/^acct_[A-Za-z0-9]+:(test|live)$/.test(stripeScope)) throw Error("Invalid billing scope");
    const db = createSupabaseAdminClient();
    async function read(table: string, columns: string, limit: number, ids?: string[], field = "id") {
      const result: Row[] = [];
      for (let offset = 0; offset <= limit; offset += 500) {
        const finance=table.startsWith("billing_finance_");
        let query = db.from(table).select(columns).order(finance ? "stripe_object_id" : "id").range(offset, offset + 499);
        if (table === "billing_subscriptions" || finance) query = query.eq("stripe_scope", stripeScope);
        if (ids) query = query.in(field, ids);
        const { data, error } = await query;
        if (error) throw Error("Read unavailable");
        result.push(...((data || []) as unknown as Row[]));
        if (result.length > limit) throw Error("Inventory bound exceeded");
        if (!data || data.length < 500) break;
      }
      return result;
    }
    const subscriptions = await read("billing_subscriptions", "id,stripe_scope,stripe_subscription_id,user_id,profile_id,stripe_price_id,stripe_subscription_status,dmi_plan,cancel_at_period_end,current_period_start,current_period_end,created_at", 2000);
    const financeSubs: Row[] = [], financeItems: Row[] = [];
    const subscriptionIds=[...new Set(subscriptions.map(r=>str(r.stripe_subscription_id)).filter(Boolean))];
    // Optional enrichment: one failed/bounded batch never removes operational rows.
    for(let i=0;i<subscriptionIds.length;i+=100){
      const ids=subscriptionIds.slice(i,i+100);
      try {
        const [parents,items]=await Promise.all([
          read("billing_finance_subscriptions","stripe_scope,stripe_object_id,items_complete,valuation_status,valuation_reason,verified_at",100,ids,"stripe_object_id"),
          read("billing_finance_subscription_items","stripe_scope,stripe_object_id,stripe_subscription_id,stripe_price_id,recurring_interval,interval_count,currency,quantity::text,unit_amount_minor::text,unit_amount_decimal_minor::text,valuation_status,valuation_reason,billing_scheme,usage_type,removed_at",20000,ids,"stripe_subscription_id"),
        ]);
        financeSubs.push(...parents);financeItems.push(...items);
      } catch { /* Missing/unavailable Finance coverage uses bounded Price fallback. */ }
    }
    function enrichment(row:Row) {
      const id=str(row.stripe_subscription_id);
      const parent=financeSubs.find(s=>s.stripe_scope===stripeScope && s.stripe_object_id===id);
      if(!parent)return null;
      const current=financeItems.filter(s=>s.stripe_scope===stripeScope && s.stripe_subscription_id===id && s.removed_at===null);
      const intervals=current.map(s=>verifiedInterval(s.recurring_interval,s.interval_count));
      const matching=current.length===1 && current[0].stripe_price_id===row.stripe_price_id;
      const complete=parent.items_complete===true;
      const interval=complete && current.some(s=>s.stripe_price_id===row.stripe_price_id) && intervals.every(x=>x===intervals[0]) ? intervals[0] : "Unavailable";
      const coverage:SubscriptionItem["coverage"]=!complete || !matching ? "incomplete" : parent.valuation_status==="complete" && current[0].valuation_status==="complete" ? "complete" : parent.valuation_status==="unsupported" || current[0].valuation_status==="unsupported" ? "unsupported" : "incomplete";
      const item=matching?current[0]:undefined;
      return {interval,coverage,quantity:item && typeof item.quantity==="string" && /^\d+$/.test(item.quantity) ? item.quantity : null,
        display:complete && item && interval!=="Unavailable" && permitsUnitPrice(parent) && permitsUnitPrice(item) && item.billing_scheme==="per_unit" && item.usage_type==="licensed" ? financeUnitPrice(item) : "Unavailable"};
    }
    const users = [...new Set(subscriptions.flatMap(r => [str(r.user_id), str(r.profile_id)]).filter(Boolean))];
    const profiles: Row[] = [], clients: Row[] = [], cards: Row[] = [];
    // Only read identity/card metadata linked to this bounded subscription inventory.
    for (let i=0; i<users.length; i+=100) {
      const ids = users.slice(i,i+100);
      const [p,c1,c2,c] = await Promise.all([
        read("profiles", "id,full_name,email", 200, ids),
        read("clients", "id,user_id,profile_id,full_name,email,account_type", 1000, ids, "user_id"),
        read("clients", "id,user_id,profile_id,full_name,email,account_type", 1000, ids, "profile_id"),
        read("cards", "id,user_id", 10000, ids, "user_id"),
      ]);
      profiles.push(...p); clients.push(...c1,...c2); cards.push(...c);
    }
    const profileMap = new Map(profiles.map(p => [str(p.id),p]));
    const uniqueClients = [...new Map(clients.map(c => [str(c.id),c])).values()];
    const cardCounts = new Map<string,number>();
    for (const c of new Map(cards.map(c => [str(c.id),c])).values()) cardCounts.set(str(c.user_id), (cardCounts.get(str(c.user_id)) || 0)+1);
    const prices = new Map<string,Price | null>();
    // At most 20 distinct price GETs; four concurrent requests. Others remain visible.
    const priceIds = [...new Set(subscriptions.filter(r=>!enrichment(r)).map(r => str(r.stripe_price_id)).filter(id => /^price_[A-Za-z0-9]+$/.test(id)))].sort().slice(0,20);
    try {
      const stripe = getStripeServerClient();
      for (let i=0;i<priceIds.length;i+=4) await Promise.all(priceIds.slice(i,i+4).map(async id => { prices.set(id,await priceMetadata(stripe,id,stripeScope)); }));
    } catch { /* Missing Stripe configuration affects price metadata only. */ }
    const now=Date.now();
    const items: SubscriptionItem[] = subscriptions.map((r): SubscriptionItem => {
      const user = str(r.user_id), profileId = str(r.profile_id), priceId = str(r.stripe_price_id), status = str(r.stripe_subscription_status);
      const profile = profileMap.get(user) || profileMap.get(profileId);
      const matches = uniqueClients.filter(c => c.account_type === "individual" && [user,profileId].filter(Boolean).some(id => c.user_id === id || c.profile_id === id));
      const client = matches.length === 1 ? matches[0] : undefined;
      const finance=enrichment(r), metadata=finance || prices.get(priceId);
      const cancelling=r.cancel_at_period_end===true, periodEnd=str(r.current_period_end)||null;
      return {
        id: str(r.id), name: str(profile?.full_name) || str(client?.full_name) || "Unresolved client", email: str(profile?.email) || str(client?.email),
        plan: r.dmi_plan === "pro" ? "Individual Pro" : r.dmi_plan === "free" ? "Individual Free" : str(r.dmi_plan) || "Unknown",
        status: subscriptionStatus(status, r.cancel_at_period_end === true),
        rawStatus:status,cancelling,renewal:subscriptionRenewal(status,cancelling,periodEnd,now),
        paying:subscriptionPaying(r.dmi_plan,status,cancelling,periodEnd,now),trialling:status==="trialing",
        coverage:finance?.coverage||"missing",priceSource:finance ? "finance" : metadata ? "stripe" : "unavailable",quantity:finance?.quantity||null,
        interval: metadata?.interval || "Unavailable",
        price: metadata?.display || "Unavailable", periodStart: str(r.current_period_start) || null, periodEnd: str(r.current_period_end) || null,
        cards: cardCounts.get(user) || 0, clientLinked: Boolean(client), createdAt: str(r.created_at),
      };
    }).sort((a,b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
    const filtered = items.filter(r => (!search || `${r.name} ${r.email}`.toLowerCase().includes(search)) && (["plan","status","interval"] as const).every(k => !params.get(k) || params.get(k) === r[k]));
    const pageSize=25, page=Math.min(Number(pageText), Math.max(1,Math.ceil(filtered.length/pageSize)));
    return NextResponse.json({ items: filtered.slice((page-1)*pageSize,page*pageSize), total: filtered.length, page, pageSize, summary: subscriptionSummary(items), plans: [...new Set(items.map(x=>x.plan))].sort(), statuses: [...new Set(items.map(x=>x.status))].sort(), intervals: [...new Set(items.map(x=>x.interval))].sort() }, { headers });
  } catch { return NextResponse.json({ error: "Subscriptions could not be loaded. Please retry or contact support." }, { status: 503, headers }); }
}
