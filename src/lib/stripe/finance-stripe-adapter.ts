import "server-only";
import type Stripe from "stripe";
import {FINANCE_API_VERSION,record,objectId,type FinanceSource,type Graph,type Root} from "./finance-contract";

/** Read-only adapter. Not instantiated or called by a route in Phase 2A. */
export function stripeFinanceSource(stripe:Stripe):FinanceSource {
 const options={apiVersion:FINANCE_API_VERSION,timeout:10000,maxNetworkRetries:0};
 async function bounded<T extends {id:string}>(page:(after?:string)=>Promise<{data:T[];has_more:boolean}>) {
  const all:T[]=[];let after:string|undefined;
  for(let n=0;n<2;n++){const result=await page(after);all.push(...result.data);if(!result.has_more)return all;if(!result.data.length)break;after=result.data.at(-1)!.id;}
  throw Error("FINANCE_PAGINATION_BOUND");
 }
 return {
  async identity(){const [account,balance]=await Promise.all([stripe.accounts.retrieve(null,{},options),stripe.balance.retrieve({},options)]);return {scope:`${account.id}:${balance.livemode?"live":"test"}`,apiVersion:FINANCE_API_VERSION};},
  async graph(root:Root){
   const graph:Graph={subscriptions:[],customers:[],invoices:[],charges:[],allocations:[],refunds:[],complete:true};
   const seen=new Set<string>();let requests=0;
   async function call<T>(read:()=>Promise<T>){if(++requests>60)throw Error("FINANCE_GRAPH_BOUND");return read();}
   async function customer(id:string){if(seen.has(`customer:${id}`))return;seen.add(`customer:${id}`);const value=await call(()=>stripe.customers.retrieve(id,{},options));if(value.deleted)throw Error("FINANCE_CUSTOMER_MISSING");graph.customers.push(record(value));}
   async function ensure(kind:Root["kind"],id:string):Promise<void>{
    const prefix={subscription:"sub",invoice:"in",allocation:"inpay",charge:"ch",refund:"re"}[kind];
    if(!new RegExp(`^${prefix}_[A-Za-z0-9]+$`).test(id))throw Error("FINANCE_OBJECT_ID");
    if(seen.has(`${kind}:${id}`))return;seen.add(`${kind}:${id}`);
    if(kind==="subscription"){
     const s=await call(()=>stripe.subscriptions.retrieve(id,{expand:["items.data.price","discounts.source.coupon"]},options));
     if(s.items.has_more)throw Error("FINANCE_ITEMS_BOUND");graph.subscriptions.push(record(s));await customer(objectId(s.customer));
    }else if(kind==="invoice"){
     const inv=await call(()=>stripe.invoices.retrieve(id,{},options));graph.invoices.push(record(inv));await customer(objectId(inv.customer));
     const sub=objectId(inv.parent?.subscription_details?.subscription);if(sub)await ensure("subscription",sub);
     const allocations=await bounded(after=>call(()=>stripe.invoicePayments.list({invoice:id,limit:100,...(after?{starting_after:after}:{})},options)));
     for(const allocation of allocations)await ensure("allocation",allocation.id);
    }else if(kind==="allocation"){
     const a=await call(()=>stripe.invoicePayments.retrieve(id,{},options));graph.allocations.push(record(a));await ensure("invoice",objectId(a.invoice));
     if(a.payment.type==="charge")await ensure("charge",objectId(a.payment.charge));
     else if(a.payment.type==="payment_intent"){
      const charges=await bounded(after=>call(()=>stripe.charges.list({payment_intent:objectId(a.payment.payment_intent),limit:100,...(after?{starting_after:after}:{})},options)));
      for(const charge of charges)await ensure("charge",charge.id);
     }
    }else if(kind==="charge"){
     const ch=await call(()=>stripe.charges.retrieve(id,{},options));graph.charges.push(record(ch));await customer(objectId(ch.customer));
     const pi=objectId(ch.payment_intent);
     if(pi){const allocations=await bounded(after=>call(()=>stripe.invoicePayments.list({payment:{type:"payment_intent",payment_intent:pi},limit:100,...(after?{starting_after:after}:{})},options)));for(const a of allocations)await ensure("allocation",a.id);}
     // Legacy direct-charge invoices may expose invoice; otherwise remain unresolved.
     const legacy=record(ch).invoice;if(legacy)await ensure("invoice",objectId(legacy));
     const refunds=await bounded(after=>call(()=>stripe.refunds.list({charge:id,limit:100,...(after?{starting_after:after}:{})},options)));for(const refund of refunds){
      await ensure("refund",refund.id);
      if(objectId(graph.refunds.find(row=>row.id===refund.id)?.charge)!==id)throw Error("FINANCE_REFUND_CHARGE");
     }
    }else{const refund=await call(()=>stripe.refunds.retrieve(id,{},options));graph.refunds.push(record(refund));await ensure("charge",objectId(refund.charge));}
   }
   await ensure(root.kind,root.id);return graph;
  },
  async scan(input){
   const range={gte:Math.floor(Date.parse(input.start)/1000),lt:Math.floor(Date.parse(input.end)/1000)};
   if(!Number.isFinite(range.gte)||!Number.isFinite(range.lt)||range.gte>=range.lt)throw Error("FINANCE_WINDOW");
   const paging={limit:20,...(input.after?{starting_after:input.after}:{})};
   let page:{data:{id:string}[];has_more:boolean};let roots:Root[];
   if(input.resource==="recent_invoices"||input.resource==="open_invoices"){
    const result=await stripe.invoices.list({...paging,...(input.resource==="open_invoices"?{status:"open" as const}:{created:range})},options);
    page=result;roots=result.data.map(o=>({kind:"invoice",id:o.id}));
   }else if(input.resource==="recent_failures"){
    const result=await stripe.charges.list({...paging,created:range},options);page=result;roots=result.data.filter(o=>o.status==="failed").map(o=>({kind:"charge",id:o.id}));
   }else if(input.resource==="pending_refunds"){
    // Scan all creation dates: old refunds can still be pending.
    const result=await stripe.refunds.list(paging,options);page=result;roots=result.data.filter(o=>["pending","requires_action"].includes(o.status||"")).map(o=>({kind:"refund",id:o.id}));
   }else{
    const result=await stripe.subscriptions.list({...paging,status:"all"},options);page=result;roots=result.data.filter(o=>["active","trialing","past_due","unpaid"].includes(o.status)).map(o=>({kind:"subscription",id:o.id}));
   }
   if(page.has_more&&!page.data.length)throw Error("FINANCE_CURSOR");
   // Failed attempts have no reliable historical occurrence timestamp from list alone.
   return {roots,next:page.has_more?page.data.at(-1)!.id:null,complete:input.resource!=="recent_failures"};
  },
 };
}
