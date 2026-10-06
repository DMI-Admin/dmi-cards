import "server-only";
import type {RecurringBreakdown,InvoiceTaxEvidence,ForecastTaxEvidence} from "./stripe/finance-types";
import { add, arr, rational, roundMinor } from "./stripe/finance-metrics";

export type ReportingStatus = "complete" | "unavailable" | "incomplete" | "unsupported" | "stale";
export type Metric = { status: ReportingStatus; value: string | null; currency?: "gbp"; supportingCount?: string; basis: "authoritative" | "observed"; reasonCode?: string };
export type CoverageState = { status: ReportingStatus; reasonCode?: string; lastVerifiedAt: string | null };
export type Run = { resource_type: string; status: string; coverage_quality: string; coverage_start: string | null; coverage_end: string | null; completed_at: string | null; error_count: string };
export type ReportEvidence = {
 subscriptionPopulation: { paidActiveCount: string; verifiedUserCount: string; unresolvedIdentityCount: string; unsupportedCount: string; incompleteItemCount: string; missingMirrorCount: string; oldestVerifiedAt: string | null };
 recurringRevenue: { groups: {numerator: string; denominator: string}[]; blockerCount: string; includedCount: string; groupLimitExceeded: boolean };
 collections: {minor: string; includedCount: string; missingTimestampCount: string; excludedCount: string};
 invoices: {minor: string; openCount: string; blockerCount: string; oldestVerifiedAt: string | null};
 failedAttempts: {count: string}; coverage: Run[];
};
const count = (x: string) => { if (!/^\d+$/.test(x)) throw Error("REPORT_EVIDENCE_INVALID"); return BigInt(x); };
const unknown = (reasonCode: string, status: ReportingStatus="unavailable"): CoverageState => ({status,reasonCode,lastVerifiedAt:null});
// A completed scan proves enumeration at completion, not current population forever.
// No freshness SLA/continuous delivery watermark is installed: old snapshots are stale.
function snapshot(runs: Run[], resource: string, asOf: string): CoverageState {
 const r=runs.find(x=>x.resource_type===resource);
 if(!r)return unknown("population_unproven");
 if(r.status!=="completed" || r.coverage_quality!=="complete" || r.error_count!=="0")return {...unknown("scan_incomplete","incomplete"),lastVerifiedAt:r.completed_at};
 if(!r.completed_at || !r.coverage_start || !r.coverage_end || !Number.isFinite(Date.parse(r.completed_at)))return unknown("coverage_invalid","incomplete");
 // Even a fresh run enumerates Stripe over multiple requests, not an atomic as-of snapshot.
 return {status:Date.parse(r.completed_at)<Date.parse(asOf)?"stale":"incomplete",reasonCode:"current_population_unproven",lastVerifiedAt:r.completed_at};
}
export function reportingResult(e: ReportEvidence, asOf: string) {
 let subscriptions=snapshot(e.coverage,"active_subscriptions",asOf);
 if(count(e.subscriptionPopulation.unsupportedCount)>0)subscriptions={...subscriptions,status:"unsupported",reasonCode:"unsupported_valuation"};
 else if(count(e.subscriptionPopulation.incompleteItemCount)+count(e.subscriptionPopulation.missingMirrorCount)+count(e.recurringRevenue.blockerCount)>0 || e.recurringRevenue.groupLimitExceeded)subscriptions={...subscriptions,status:"incomplete",reasonCode:"subscription_evidence_incomplete"};
 const payments=unknown("collection_period_unproven"), refunds=unknown("refund_history_unproven");
 const invoices=snapshot(e.coverage,"open_invoices",asOf);
 const coverage={overall:"incomplete" as ReportingStatus,subscriptions,payments,invoices,refunds,failedAttempts:unknown("recorded_only","incomplete"),activity:unknown("recorded_only","incomplete")};
 const monetary=(c:CoverageState):Metric=>({status:c.status,value:null,currency:"gbp",basis:"authoritative",reasonCode:c.reasonCode});
 const linked=count(e.subscriptionPopulation.unresolvedIdentityCount)===BigInt(0);
 return {coverage,kpis:{mrr:monetary(subscriptions),arr:monetary(subscriptions),collectedThisMonth:monetary(payments),
 activePaidCustomers:{status:linked?"complete":"incomplete",value:linked?count(e.subscriptionPopulation.verifiedUserCount).toString():null,basis:"observed",reasonCode:linked?"verified_mirror_users":"identity_unresolved"} as Metric,
 recordedFailedAttempts:{status:"complete",value:count(e.failedAttempts.count).toString(),basis:"observed",reasonCode:"recorded_only"} as Metric,
 outstandingInvoices:monetary(invoices)}};
}
/** Exact candidate arithmetic only. Never authorizes population coverage. */
export function recurringTotals(groups: {numerator:string;denominator:string}[]) {
 if(groups.length>256)throw Error("REPORT_GROUP_LIMIT");
 let total=rational(BigInt(0));
 for(const g of groups)total=add(total,rational(count(g.numerator),count(g.denominator)));
 return {mrr:roundMinor(total),arr:roundMinor(arr(total))};
}
export const listNames=["payments","invoices","refunds","renewals","activity"] as const;
export type FinanceList = typeof listNames[number];
export type FinanceListRow = { id:string; client:{name:string|null;userId:string}|null; status:string; amount:string|null; currency:string|null; date:string|null; reference:string|null; recurringValuation?:RecurringBreakdown; invoiceTax?:InvoiceTaxEvidence; forecastTax?:ForecastTaxEvidence; recurringInterval?:string|null; intervalCount?:number|null; amountRemaining?:string|null; paidAt?:string|null; dueAt?:string|null };
