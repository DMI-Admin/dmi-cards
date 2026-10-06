import "server-only";
import {auth} from "@clerk/nextjs/server";
import {NextResponse} from "next/server";
import {requireAdminAccess} from "@/lib/admin-auth";
import {createSupabaseAdminClient} from "@/lib/supabase-admin";
import {londonMonthBounds, expectedRenewalEligibility} from "@/lib/stripe/finance-metrics";
import {contractualRecurring} from "@/lib/stripe/finance-contractual";
import type {FinanceSubscription,FinanceItem} from "@/lib/stripe/finance-types";
import {reportingResult,recurringTotals,listNames,type FinanceList,type FinanceListRow,type ReportEvidence} from "@/lib/admin-finance";
const headers={"Cache-Control":"private, no-store"};
type Row=Record<string,unknown>;
const text=(v:unknown)=>typeof v==="string"?v:null;
export function reportingScope(env:NodeJS.ProcessEnv=process.env) {
 const scope=env.STRIPE_ACCOUNT_SCOPE;
 if(!scope || !/^acct_[A-Za-z0-9]+:(test|live)$/.test(scope))throw Error("REPORT_SCOPE_UNAVAILABLE");
 const target=env.VERCEL_TARGET_ENV||env.VERCEL_ENV;
 if((env.VERCEL_ENV==="production" || target==="production")&&!scope.endsWith(":live"))throw Error("REPORT_MODE_MISMATCH");
 if((target==="staging" || target==="preview" || env.VERCEL_ENV==="preview")&&!scope.endsWith(":test"))throw Error("REPORT_MODE_MISMATCH");
 return scope;
}
const specs={
 payments:{table:"billing_payments",key:"stripe_object_id",columns:"stripe_object_id,stripe_customer_id,status,amount_captured_minor::text,currency,collected_at"},
 invoices:{table:"billing_invoices",key:"stripe_object_id",columns:"stripe_object_id,stripe_customer_id,number,status,total_minor::text,amount_remaining_minor::text,currency,due_at,paid_at,tax_evidence"},
 refunds:{table:"billing_refunds",key:"stripe_object_id",columns:"stripe_object_id,stripe_charge_id,status,amount_minor::text,currency,succeeded_at"},
 renewals:{table:"billing_finance_subscription_items",key:"stripe_object_id",columns:"stripe_scope,stripe_object_id,stripe_subscription_id,recurring_interval,interval_count,currency,period_start,period_end,removed_at,valuation_status,valuation_reason,effective_cycle_amount_minor::text,verified_at,normalizer_version,unit_amount_minor::text,unit_amount_decimal_minor::text,quantity::text,billing_scheme,usage_type,tax_behavior,discount_context,forecast_tax_evidence"},
 activity:{table:"billing_finance_activity",key:"activity_key",columns:"activity_key,stripe_customer_id,kind,object_id,occurred_at,amount_minor::text,currency"},
} as const;
export function parseFinanceQuery(url:string) {
 const q=new URL(url).searchParams;
 if([...q.keys()].some(k=>!["list","cursor","limit"].includes(k)||q.getAll(k).length!==1))throw Error("REPORT_QUERY_INVALID");
 const list=q.get("list");
 if(list&&!listNames.includes(list as FinanceList))throw Error("REPORT_QUERY_INVALID");
 if(!list&&(q.has("cursor")||q.has("limit")))throw Error("REPORT_QUERY_INVALID");
 const limit=q.get("limit")||"25";
 if(!/^[1-9]\d?$/.test(limit)||Number(limit)>50)throw Error("REPORT_QUERY_INVALID");
 // Opaque-ish static key cursor, bound to list; never embedded into PostgREST expressions.
 const cursor=q.get("cursor");let after:string|null=null;
 if(cursor){if(cursor.length>512)throw Error("REPORT_QUERY_INVALID");const split=cursor.indexOf("|");if(cursor.slice(0,split)!==list)throw Error("REPORT_QUERY_INVALID");after=cursor.slice(split+1);if(!/^[A-Za-z0-9_:.-]{1,400}$/.test(after))throw Error("REPORT_QUERY_INVALID");}
 return {list:list as FinanceList|null,limit:Number(limit),after};
}
async function listRows(db:ReturnType<typeof createSupabaseAdminClient>,scope:string,list:FinanceList,limit:number,after:string|null,now:string) {
 const spec: {table:string;key:string;columns:string}=specs[list];
 let query=db.from(spec.table).select(spec.columns).eq("stripe_scope",scope).order(spec.key,{ascending:true}).limit(limit+1);
 if(after)query=query.gt(spec.key,after);
 if(list==="renewals")query=query.is("removed_at",null).gt("period_end",now);
 const {data,error}=await query;
 if(error)throw Error("REPORT_READ_UNAVAILABLE");
 const fetched=(data||[]) as unknown as Row[],page=fetched.slice(0,limit);
 async function related(table:string,columns:string,field:string,ids:string[],bound:number) {
 if(!ids.length)return [];
 const result=await db.from(table).select(columns).eq("stripe_scope",scope).in(field,[...new Set(ids)]).limit(bound+1);
 if(result.error || (result.data?.length||0)>bound)throw Error("REPORT_READ_UNAVAILABLE");
 return (result.data||[]) as unknown as Row[];
 }
 const ids=(rows:Row[],key:string)=>rows.map(r=>text(r[key])).filter((x):x is string=>!!x);
 const parents=list==="renewals"?await related("billing_finance_subscriptions","stripe_scope,stripe_object_id,user_id,stripe_customer_id,status,cancel_at_period_end,cancel_at,ended_at,collection_paused,linkage_status,valuation_status,valuation_reason,items_complete,verified_at,normalizer_version,discount_context","stripe_object_id",ids(page,"stripe_subscription_id"),limit):[];
 const charges=list==="refunds"?await related("billing_payments","stripe_object_id,stripe_customer_id","stripe_object_id",ids(page,"stripe_charge_id"),limit):[];
 const customer=(r:Row)=>text(r.stripe_customer_id)||text((list==="refunds"?charges.find(c=>c.stripe_object_id===r.stripe_charge_id):parents.find(s=>s.stripe_object_id===r.stripe_subscription_id))?.stripe_customer_id);
 const customers=page.map(customer).filter((x):x is string=>!!x);
 const accounts=await related("billing_accounts","user_id,stripe_customer_id,verified_at","stripe_customer_id",customers,limit);
 const verified=accounts.filter(a=>typeof a.verified_at==="string"&&Date.parse(a.verified_at)<=Date.parse(now));
 const users=ids(verified,"user_id");let profiles:Row[]=[];
 if(users.length){const r=await db.from("profiles").select("id,full_name").in("id",[...new Set(users)]).limit(limit+1);if(r.error)throw Error("REPORT_READ_UNAVAILABLE");profiles=(r.data||[]) as Row[];}
 const allocations=list==="payments"?await related("billing_invoice_payments","stripe_charge_id,stripe_invoice_id","stripe_charge_id",ids(page,"stripe_object_id"),500):[];
 const rows:FinanceListRow[]=[];
 for(const r of page){
 const bindings=verified.filter(a=>a.stripe_customer_id===customer(r));const account=bindings.length===1?bindings[0]:null;
 const profile=account?profiles.find(p=>p.id===account.user_id):null;
 let amount=text(r.amount_captured_minor??r.total_minor??r.amount_minor),date=text(r.collected_at??r.due_at??r.succeeded_at??r.occurred_at),reference=text(r.number??r.object_id),status=text(r.status??r.kind)||"unknown";
 if(list==="payments"){const links=[...new Set(allocations.filter(a=>a.stripe_charge_id===r.stripe_object_id).map(a=>text(a.stripe_invoice_id)))];reference=links.length===1?links[0]:null;}
 let recurringValuation:FinanceListRow["recurringValuation"];
 if(list==="renewals"){
 const parent=parents.find(s=>s.stripe_object_id===r.stripe_subscription_id);
 if(!parent||parent.status!=="active"||parent.cancel_at_period_end===true||parent.collection_paused===true||(typeof parent.cancel_at==="string"&&Date.parse(parent.cancel_at)<=Date.parse(String(r.period_end))))continue;
 date=text(r.period_end);reference=text(r.stripe_subscription_id);status="upcoming";amount=null;
 if(account&&account.user_id===parent.user_id){recurringValuation=contractualRecurring(parent as unknown as FinanceSubscription,r as unknown as FinanceItem,scope,now);const eligible=expectedRenewalEligibility(parent as unknown as FinanceSubscription,r as unknown as FinanceItem,scope,now);if(eligible.status==="complete"&&eligible.value)amount=text(r.effective_cycle_amount_minor);}
 }
 rows.push({id:String(r[spec.key]),client:account?{userId:String(account.user_id),name:text(profile?.full_name)}:null,status,amount,currency:text(r.currency),date,reference,
 ...(list==="invoices"&&r.tax_evidence?{invoiceTax:r.tax_evidence as FinanceListRow["invoiceTax"]}:{}),
 ...(list==="renewals"?{forecastTax:r.forecast_tax_evidence as FinanceListRow["forecastTax"],recurringValuation,recurringInterval:text(r.recurring_interval),intervalCount:typeof r.interval_count==="number" && Number.isSafeInteger(r.interval_count) && r.interval_count>0?r.interval_count:null}:{}),
 ...(list==="invoices"?{amountRemaining:text(r.amount_remaining_minor),dueAt:text(r.due_at),paidAt:text(r.paid_at)}:{})});
 }
 return {items:rows,nextCursor:fetched.length>limit&&page.length?`${list}|${String(page[page.length-1][spec.key])}`:null,ordering:"identity_ascending",basis:"observed"};
}
export async function readAdminFinance(request:Request) {
 const access=await requireAdminAccess(await auth());
 if(!access.authorized)return NextResponse.json({error:"Admin access required."},{status:403,headers});
 if(new URL(request.url).searchParams.has("view")){
  try{const {readFinanceV1}=await import("./admin-finance-v1-server");return await readFinanceV1(request,reportingScope());}
  catch{return NextResponse.json({error:"Finance reporting unavailable."},{status:503,headers});}
 }

 let params:ReturnType<typeof parseFinanceQuery>;
 try{params=parseFinanceQuery(request.url);}catch{return NextResponse.json({error:"Invalid reporting query."},{status:400,headers});}
 try{
 const scope=reportingScope(),now=new Date().toISOString(),db=createSupabaseAdminClient();
 if(params.list)return NextResponse.json(await listRows(db,scope,params.list,params.limit,params.after,now),{headers});
 const parts=Object.fromEntries(new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",year:"numeric",month:"numeric"}).formatToParts(new Date(now)).map(p=>[p.type,p.value]));
 const period=londonMonthBounds(Number(parts.year),Number(parts.month));
 const {data,error}=await db.rpc("admin_finance_report",{p_scope:scope,p_as_of:now,p_period_start:period.start,p_period_end:period.end});
 if(error||!data)throw Error("REPORT_READ_UNAVAILABLE");
 const evidence=data as ReportEvidence;
 recurringTotals(evidence.recurringRevenue.groups); // Validate exact candidate arithmetic, never publish without coverage.
 return NextResponse.json({...reportingResult(evidence,now),asOf:now,period},{headers});
 }catch{return NextResponse.json({error:"Finance reporting unavailable."},{status:503,headers});}
}
