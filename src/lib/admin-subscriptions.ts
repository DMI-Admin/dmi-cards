export type SubscriptionItem = {
  id: string; name: string; email: string; plan: string; status: string;
  rawStatus: string; cancelling: boolean; renewal: "renewal" | "ending" | "period";
  coverage: "complete" | "incomplete" | "unsupported" | "missing"; priceSource: "finance" | "stripe" | "unavailable"; quantity: string | null;
  interval: string; price: string; periodStart: string | null; periodEnd: string | null;
  cards: number; clientLinked: boolean; paying: boolean; trialling: boolean; createdAt: string;
};
export type SubscriptionInventory = {
  items: SubscriptionItem[]; total: number; page: number; pageSize: number;
  summary: Record<"paying" | "active" | "cancelling" | "pastDue" | "monthly" | "annual" | "trialling", number>;
  plans: string[]; statuses: string[]; intervals: string[];
};
export function subscriptionStatus(status: string, cancelling: boolean) {
  if (cancelling && status === "active") return "Cancelling";
  return ({ active: "Active", trialing: "Trialling", past_due: "Past Due", canceled: "Cancelled", incomplete: "Incomplete", incomplete_expired: "Incomplete expired", unpaid: "Unpaid", paused: "Paused" } as Record<string, string>)[status] || status || "Unknown";
}
export function subscriptionSummary(items: SubscriptionItem[]) {
  return {
    paying: items.filter(x => x.paying).length,
    active: items.filter(x => x.paying && !x.cancelling).length,
    cancelling: items.filter(x => x.paying && x.cancelling).length,
    pastDue: items.filter(x => x.rawStatus === "past_due").length,
    monthly: items.filter(x => x.paying && x.interval === "Monthly").length,
    annual: items.filter(x => x.paying && x.interval === "Annual").length,
    trialling: items.filter(x => x.trialling).length,
  };
}

export function subscriptionPaying(plan: unknown, status: string, cancelling: boolean, periodEnd: string | null, now: number) {
  return plan === "pro" && status === "active" && (!cancelling || (periodEnd !== null && Date.parse(periodEnd) > now));
}
export function subscriptionRenewal(status: string, cancelling: boolean, periodEnd: string | null, now: number): SubscriptionItem["renewal"] {
  if (status === "active" && cancelling) return "ending";
  return status === "active" && !cancelling && periodEnd !== null && Date.parse(periodEnd) > now ? "renewal" : "period";
}
export function subscriptionDate(value: string | null) {
  return value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat("en-GB", {dateStyle:"medium",timeZone:"Europe/London"}).format(new Date(value)) : "Not recorded";
}
export function subscriptionEndLabel(row: Pick<SubscriptionItem,"renewal"|"periodEnd">) {
  const date=subscriptionDate(row.periodEnd);
  return row.renewal === "ending" ? (date === "Not recorded" ? "End date not recorded" : `Ends ${date}`) : date;
}
// Exact configured unit price, never an invoice total or MRR. No Number conversion.
export function configuredUnitPrice(minor: unknown, currency: unknown): string {
  if (typeof minor !== "string" || !/^\d{1,26}(\.\d{1,12})?$/.test(minor) || typeof currency !== "string" || !/^[a-z]{3}$/.test(currency)) return "Unavailable";
  try {
    const formatter=new Intl.NumberFormat("en-GB",{style:"currency",currency});
    const places=formatter.resolvedOptions().maximumFractionDigits ?? 2;
    const [whole, fraction=""]=minor.split(".");
    const digits=whole.padStart(places+1,"0");
    const major=places ? digits.slice(0,-places) : digits;
    const remainder=((places ? digits.slice(-places) : "")+fraction).replace(/0+$/,"").padEnd(places,"0");
    const parts=formatter.formatToParts(BigInt(major));
    return parts.map(part=>part.type==="fraction" ? remainder : part.value).join("") + (places===0 && remainder ? `.${remainder}` : "");
  } catch { return "Unavailable"; }
}
export function verifiedInterval(interval: unknown, count: unknown): string {
  if (typeof interval !== "string" || !['month','year','week','day'].includes(interval) || typeof count !== "number" || !Number.isSafeInteger(count) || count <= 0) return "Unavailable";
  return count === 1 && interval === "month" ? "Monthly" : count === 1 && interval === "year" ? "Annual" : `Every ${count} ${interval}(s)`;
}
