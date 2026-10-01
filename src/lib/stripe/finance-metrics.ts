import "server-only";
import type { Coverage, FinanceItem, FinanceSubscription, MetricResult, Rational } from "./finance-types";

const zero = BigInt(0), one = BigInt(1);
export function rational(numerator: bigint, denominator = one): Rational {
  if (denominator <= zero) throw Error("FINANCE_INVALID_DENOMINATOR");
  let a = numerator < zero ? -numerator : numerator, b = denominator;
  while (b !== zero) { const next = a % b; a = b; b = next; }
  const divisor = a || one;
  return { numerator: numerator / divisor, denominator: denominator / divisor };
}
export function add(a: Rational, b: Rational) { return rational(a.numerator*b.denominator+b.numerator*a.denominator,a.denominator*b.denominator); }
export function decimal(value: string): Rational {
  if (!/^\d{1,26}(\.\d{1,12})?$/.test(value)) throw Error("FINANCE_INVALID_DECIMAL");
  const [whole, fraction = ""] = value.split(".");
  return rational(BigInt(whole+fraction),BigInt(10)**BigInt(fraction.length));
}
export function roundMinor(value: Rational): string {
  if (value.numerator < zero) throw Error("FINANCE_NEGATIVE_VALUE");
  return ((value.numerator*BigInt(2)+value.denominator)/(value.denominator*BigInt(2))).toString();
}
export function arr(mrr: Rational) { return rational(mrr.numerator*BigInt(12),mrr.denominator); }
function incomplete<T>(reason: string): MetricResult<T> { return {status:"incomplete",value:null,reason}; }
function instant(value: string) { const n=Date.parse(value); if (!Number.isFinite(n)) throw Error("FINANCE_INVALID_TIME"); return n; }
export function recurringEligibility(sub: FinanceSubscription, item: FinanceItem, scope: string, now: string): MetricResult<boolean> {
  if (!/^acct_[A-Za-z0-9]+:(test|live)$/.test(scope)) return incomplete("invalid_scope");
  if (sub.stripe_scope!==scope || item.stripe_scope!==scope) return incomplete("scope_mismatch");
  if (item.stripe_subscription_id!==sub.stripe_object_id) return incomplete("subscription_mismatch");
  if (item.currency!=="gbp") return incomplete("currency_not_gbp");
  if (sub.linkage_status!=="verified") return incomplete("unverified_linkage");
  const at=instant(now);
  if (sub.status!=="active" || sub.collection_paused || item.removed_at || (sub.ended_at && instant(sub.ended_at)<=at)) return {status:"complete",value:false};
  if (!item.period_start || !item.period_end) return incomplete("missing_period");
  if ((sub.cancel_at && instant(sub.cancel_at)<=at) || (sub.cancel_at_period_end && instant(item.period_end)<=at)) return {status:"complete",value:false};
  if (instant(item.period_end)<=at) return incomplete("expired_period_requires_refresh");
  if (instant(item.period_start)>at) return incomplete("future_period");
  if (instant(sub.verified_at)>at || instant(item.verified_at)>at) return incomplete("future_verification");
  if (!sub.items_complete || sub.valuation_status!=="complete" || item.valuation_status!=="complete") return incomplete(item.valuation_reason || sub.valuation_reason || "incomplete_valuation");
  return {status:"complete",value:true};
}
export function expectedRenewalEligibility(sub: FinanceSubscription, item: FinanceItem, scope: string, now: string): MetricResult<boolean> {
  const eligible=recurringEligibility(sub,item,scope,now);
  if (eligible.status!=="complete" || !eligible.value) return eligible;
  return {status:"complete",value:!sub.cancel_at_period_end && !(sub.cancel_at && item.period_end && instant(sub.cancel_at)<=instant(item.period_end))};
}
export function mrrContribution(sub: FinanceSubscription, item: FinanceItem, scope: string, now: string): MetricResult<Rational> {
  const eligibility=recurringEligibility(sub,item,scope,now);
  if(eligibility.status!=="complete")return eligibility;
  if(!eligibility.value)return {status:"complete",value:rational(zero)};
  if(item.effective_cycle_amount_minor===null || !/^\d+$/.test(item.effective_cycle_amount_minor) || !Number.isSafeInteger(item.interval_count) || item.interval_count<=0) return incomplete("invalid_cycle_value");
  if(!["month","year"].includes(item.recurring_interval))return incomplete("unsupported_interval");
  return {status:"complete",value:rational(BigInt(item.effective_cycle_amount_minor),BigInt(item.interval_count)*BigInt(item.recurring_interval==="year"?12:1))};
}
export function aggregateGbp(rows: {scope:string;currency:string;value:Rational|null}[], scope: string, coverage: Coverage): MetricResult<Rational> {
  if(coverage.scope!==scope || coverage.currency!=="gbp" || coverage.quality!=="complete" || !coverage.start || !coverage.end || instant(coverage.start)>=instant(coverage.end))return incomplete("incomplete_coverage");
  let total=rational(zero);
  for(const row of rows){
    if(row.scope!==scope)return incomplete("scope_mismatch");
    if(row.currency!=="gbp")return incomplete("currency_not_gbp");
    if(!row.value || row.value.denominator<=zero || row.value.numerator<zero)return incomplete("missing_or_invalid_value");
    total=add(total,row.value);
  }
  return {status:"complete",value:total};
}
/** London local midnight -> UTC, including BST; never use host timezone. */
function londonMidnight(year:number,month:number) {
  const target=Date.UTC(year,month-1,1); let guess=target;
  const formatter=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"});
  for(let i=0;i<3;i++){
    const parts=Object.fromEntries(formatter.formatToParts(new Date(guess)).filter(x=>x.type!=="literal").map(x=>[x.type,Number(x.value)]));
    guess+=target-Date.UTC(parts.year,parts.month-1,parts.day,parts.hour,parts.minute,parts.second);
  }
  return new Date(guess).toISOString();
}
export function londonMonthBounds(year:number,month:number) {
  if(!Number.isInteger(year)||year<2000||year>9998||!Number.isInteger(month)||month<1||month>12)throw Error("FINANCE_INVALID_MONTH");
  return {start:londonMidnight(year,month),end:londonMidnight(month===12?year+1:year,month===12?1:month+1),timeZone:"Europe/London" as const};
}
