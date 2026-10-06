import "server-only";
import {NextResponse} from "next/server";
import {createSupabaseAdminClient} from "@/lib/supabase-admin";
import {londonMonthBounds} from "@/lib/stripe/finance-metrics";
import {contractualRecurring} from "@/lib/stripe/finance-contractual";
import type {FinanceItem,FinanceSubscription} from "@/lib/stripe/finance-types";
import {financeViews,type FinanceV1Report,type FinanceV1Row,type FinanceView,type FinanceMonth} from "./admin-finance-v1";
const headers={"Cache-Control":"private, no-store",Vary:"Cookie, Authorization"};
type Row=Record<string,unknown>;
const object=(v:unknown):Row=>v&&typeof v==='object'&&!Array.isArray(v)?v as Row:{};
const text=(v:unknown)=>typeof v==='string'?v:null;
const minor=(v:unknown)=>typeof v==='string'&&/^-?\d+$/.test(v)?v:null;
export function parseV1Query(url:string){
 const q=new URL(url).searchParams;
 if([...q.keys()].some(k=>!['view','year','month','list','cursor','limit'].includes(k)||q.getAll(k).length!==1))throw Error('REPORT_QUERY_INVALID');
 const view=q.get('view'),ys=q.get('year')||'',ms=q.get('month')||'',list=q.get('list')||'new_customers',ls=q.get('limit')||'25';
 if(!['monthly','yearly'].includes(view||'')||!/^\d{4}$/.test(ys)||Number(ys)<2000||Number(ys)>9998||!financeViews.includes(list as FinanceView)||!/^\d+$/.test(ls)||Number(ls)<1||Number(ls)>50)throw Error('REPORT_QUERY_INVALID');
 if(view==='monthly'&&(!/^\d{1,2}$/.test(ms)||Number(ms)<1||Number(ms)>12)||view==='yearly'&&q.has('month'))throw Error('REPORT_QUERY_INVALID');
 const year=Number(ys),month=Number(ms),periods=(view==='monthly'?[month]:Array.from({length:12},(_,i)=>i+1)).map(m=>{const b=londonMonthBounds(year,m);return {label:`${year}-${String(m).padStart(2,'0')}`,start_at:b.start,end_at:b.end};});
 const prefix=`${view}|${year}|${ms}|${list}|`,cursor=q.get('cursor');
 if(cursor&&(cursor.length>512||!cursor.startsWith(prefix)||!/^\w{1,200}$/.test(cursor.slice(prefix.length))))throw Error('REPORT_QUERY_INVALID');
 return {periods,list,limit:Number(ls),after:cursor?cursor.slice(prefix.length):null,prefix};
}
/** Invoked only AFTER requireAdminAccess in the existing Finance route. No external Stripe reads. */
export async function readFinanceV1(request:Request,scope:string){
 let params;try{params=parseV1Query(request.url);}catch{return NextResponse.json({error:'Invalid reporting query.'},{status:400,headers});}
 try{
 const db=createSupabaseAdminClient(),now=new Date().toISOString();
 const {data,error}=await db.rpc('admin_finance_v1_report',{p_scope:scope,p_as_of:now,p_periods:params.periods,p_list:params.list,p_after:params.after,p_limit:params.limit});
 if(error||!data||!Array.isArray(data.items)||data.items.length>params.limit||!Array.isArray(data.months)||data.months.length!==params.periods.length)throw Error('REPORT_READ_UNAVAILABLE');
 const raw:Row[]=data.items,ids=[...new Set(raw.map(r=>text(r.userId)).filter((v):v is string=>!!v))];
 let profiles:Row[]=[];
 if(ids.length){const result=await db.from('profiles').select('id,full_name,email').in('id',ids).limit(params.limit);if(result.error)throw Error('REPORT_READ_UNAVAILABLE');profiles=result.data||[];}
 const items:FinanceV1Row[]=raw.map(r=>{
 const item=object(r.item),sub=object(r.sub),tax=object(r.invoiceTax),profile=profiles.find(p=>p.id===r.userId);
 let amount=minor(r.amount),vat:string|null=null,net:string|null=null;
 if(tax.version===1&&tax.status==='verified'&&tax.basis==='finalized_invoice'){vat=minor(tax.vatMinor);net=minor(tax.netMinor);}
 if(params.list==='upcoming'){
  amount=null;const forecast=object(item.forecast_tax_evidence),configuration=object(forecast.configuration);
  if(r.userId&&sub.user_id===r.userId&&item.stripe_scope===scope&&sub.stripe_scope===scope){
   // Scheduled ending is display-only: value the contract without calling it an expected renewal.
   const presentationSub={...sub,cancel_at_period_end:false,cancel_at:null} as unknown as FinanceSubscription;
   const value=contractualRecurring(presentationSub,item as unknown as FinanceItem,scope,now).contractualRecurring;
   if(value.status==='complete'&&value.taxBasis==='inclusive')amount=value.amountMinor;
   if(forecast.version===1&&forecast.status==='verified'&&forecast.basis==='stripe_invoice_preview'&&typeof forecast.verifiedAt==='string'&&forecast.verifiedAt===item.verified_at&&configuration.scope===scope&&configuration.itemId===item.stripe_object_id&&configuration.subscriptionId===item.stripe_subscription_id){
    amount=minor(forecast.grossMinor);net=minor(forecast.netMinor);
    // Forecast contract currently records generic tax, not verified VAT classification.
    vat=null;
   }
  }
 }
 const final=object(r.finalPayment);
 return {id:String(r.id),client:r.userId?{name:text(profile?.full_name),email:text(profile?.email)}:null,linked:!!r.userId,date:text(r.date),started:text(r.started),status:text(r.status)||'unknown',plan:text(r.plan),reference:text(r.reference),amount,currency:text(r.currency),vat,net,interval:text(item.recurring_interval),intervalCount:typeof item.interval_count==='number'?item.interval_count:null,attempts:minor(r.attempts),nextRetry:text(r.nextRetry),reason:text(r.reason),finalPayment:r.finalPayment?{amount:minor(final.amount),currency:text(final.currency),date:text(final.date)}:null};
 });
 const months:FinanceMonth[]=data.months.map((value:unknown)=>{const row=object(value);for(const k of ['newCustomers','invoiceCount','failedPayments','cancelledCustomers','refunds'])if(typeof row[k]!=='string'||!/^\d+$/.test(row[k] as string))throw Error('REPORT_READ_UNAVAILABLE');return {...row,gross:minor(row.gross),vat:minor(row.vat),net:minor(row.net)} as FinanceMonth;});
 const result:FinanceV1Report={items,nextCursor:data.nextAfter?params.prefix+data.nextAfter:null,months,activePaidCustomers:String(data.activePaidCustomers),recoveryCustomers:String(data.recoveryCustomers),undatedInvoices:String(data.undatedInvoices),undatedRefunds:String(data.undatedRefunds),basis:'observed_finance_history',asOf:now};
 return NextResponse.json(result,{headers});
 }catch{return NextResponse.json({error:'Finance reporting unavailable.'},{status:503,headers});}
}
