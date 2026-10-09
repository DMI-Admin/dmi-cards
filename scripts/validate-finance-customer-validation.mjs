import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import {execFileSync} from "node:child_process";
const cache=new Map(),timers=new Map(),logs=[];let now=0,sequence=0;
function load(file){
 if(cache.has(file))return cache.get(file);
 const exports={};cache.set(file,exports);
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{
 exports,Error,AbortController,structuredClone,performance:{now:()=>now},setTimeout:(fn,ms)=>{assert.equal(ms,2000);timers.set(++sequence,fn);return sequence;},clearTimeout:id=>timers.delete(id),
 console:{log:(...args)=>logs.push(args),warn:(...args)=>logs.push(args),error:(...args)=>logs.push(args)},
 require:name=>{if(name==="server-only")return {};if(name.startsWith("."))return load(path.join(path.dirname(file),name)+".ts");throw Error("Forbidden dependency");},
 });return exports;
}
const {validateFinanceCustomerPreparation:validate}=load("src/lib/stripe/finance-customer-validation.ts");
const {financeRoutingEvents:events}=load("src/lib/stripe/finance-customer-routing.ts");
const scope="acct_fixture:test",customer="cus_fixture";
const row=(id,fields)=>({stripe_scope:scope,stripe_object_id:id,...fields});
const rows={subscriptions:row("sub_fixture",{stripe_customer_id:customer}),items:row("si_fixture",{stripe_subscription_id:"sub_fixture"}),invoices:row("in_fixture",{stripe_customer_id:customer,stripe_subscription_id:"sub_fixture"}),payments:row("ch_fixture",{stripe_customer_id:customer,stripe_payment_intent_id:"pi_fixture"}),refunds:row("re_fixture",{stripe_charge_id:"ch_fixture",stripe_payment_intent_id:"pi_fixture"}),allocations:row("inpay_fixture",{stripe_invoice_id:"in_fixture",stripe_charge_id:"ch_fixture",stripe_payment_intent_id:"pi_fixture"}),attempts:{stripe_scope:scope,attempt_key:"charge:ch_fixture",stripe_customer_id:customer,stripe_charge_id:"ch_fixture",stripe_invoice_id:"in_fixture",stripe_payment_intent_id:"pi_fixture"},activity:{stripe_scope:scope,activity_key:"activity_fixture",stripe_customer_id:customer,object_type:"subscriptions",object_id:"sub_fixture",stripe_subscription_id:"sub_fixture"}};
const records={billing_finance_subscriptions:{sub_fixture:rows.subscriptions},billing_invoices:{in_fixture:rows.invoices},billing_payments:{ch_fixture:rows.payments},billing_refunds:{re_fixture:rows.refunds}};
function db(data=records,read){const calls=[];return {calls,from(table){assert.ok(Object.hasOwn(records,table));const filters=[];calls.push({table,filters});const q={select(columns){assert.doesNotMatch(columns,/\*/);return q;},eq(k,v){filters.push([k,v]);return q;},abortSignal(signal){assert.equal(signal.aborted,false);return q;},async maybeSingle(){assert.equal(filters.length,2);assert.deepEqual(filters.map(x=>x[0]),["stripe_scope","stripe_object_id"]);assert.equal(filters[0][1],scope);return read?read(table,filters):{data:structuredClone(data[table]?.[filters[1][1]]??null),error:null};}};return q;}};}
const graph={complete:true,customers:[{id:customer,livemode:false}],subscriptions:[{id:"sub_fixture",livemode:false,customer,items:{has_more:false,data:[{id:"si_fixture",subscription:"sub_fixture"}]}}],invoices:[{id:"in_fixture",livemode:false,customer,subscription:"sub_fixture"}],charges:[{id:"ch_fixture",livemode:false,customer,payment_intent:"pi_fixture"}],refunds:[{id:"re_fixture",livemode:false,charge:"ch_fixture",payment_intent:"pi_fixture"}],allocations:[{id:"inpay_fixture",livemode:false,invoice:"in_fixture",payment:{type:"charge",charge:"ch_fixture"}}]};
const bundle=Object.fromEntries(Object.entries(rows).map(([kind,r])=>[kind,[{row:r,expected_revision:"0"}]]));
const event=(type="invoice.paid",object={id:"in_fixture",customer})=>({id:"evt_fixture",type,created:1760000000,livemode:false,api_version:"2023-10-16",data:{object}});
const input=()=>({db:db(),scope,verifiedEvent:event(),graph:structuredClone(graph),bundle:structuredClone(bundle)});
const reasons=new Set(["MALFORMED_EVIDENCE","ROUTING_UNRESOLVED","RELATIONSHIP_UNAVAILABLE","RELATIONSHIP_TIMEOUT_AMBIGUOUS","RELATIONSHIP_CANCELLED_AMBIGUOUS","ROUTING_OWNERSHIP_CONFLICT","GRAPH_OWNERSHIP_REJECTED","BUNDLE_OWNERSHIP_REJECTED","STORED_IDENTITY_CONFLICT"]);
const reject=async(i,expected)=>{const r=await validate(i);assert.equal(r.status,"rejected");assert.equal(r.reason,expected);assert.deepEqual(Object.keys(r).sort(),["reason","status"]);assert.ok(reasons.has(r.reason));assert.doesNotMatch(JSON.stringify(r),/cus_|acct_|sub_|in_|ch_|evt_|PRIVATE/);assert.equal(timers.size,0);};
for(const [type,kind] of Object.entries(events)){
 const raw={id:{subscription:"sub_fixture",invoice:"in_fixture",charge:"ch_fixture",refund:"re_fixture"}[kind],...(kind==="refund"?{charge:"ch_fixture"}:{customer})};
 if(type==="charge.failed")Object.assign(raw,{status:"failed",paid:false,amount_captured:0,livemode:false});
 const i=input();i.verifiedEvent=event(type,raw);const before=JSON.stringify({graph:i.graph,bundle:i.bundle});
 const r=await validate(i);assert.equal(r.status,"approved");assert.equal(r.partition.customer,customer);assert.equal(Object.isFrozen(r.partition),true);assert.equal(JSON.stringify({graph:i.graph,bundle:i.bundle}),before);
 delete raw.customer;delete raw.charge;i.verifiedEvent=event(type,raw);assert.equal((await validate(i)).status,"approved");
}
const first=input();first.db=db({});assert.equal((await validate(first)).status,"approved");
for(const change of [g=>g.subscriptions[0].customer="cus_other",g=>g.invoices[0].customer="cus_other",g=>g.charges[0].customer="cus_other",g=>g.refunds[0].charge="ch_other",g=>g.customers.push({id:"cus_other",livemode:false}),g=>g.complete=false]){const i=input();change(i.graph);await reject(i,"GRAPH_OWNERSHIP_REJECTED");}
for(const change of [b=>b.subscriptions[0].row.stripe_customer_id="cus_other",b=>b.invoices[0].row.stripe_customer_id="cus_other",b=>b.payments[0].row.stripe_customer_id="cus_other",b=>b.refunds[0].row.stripe_charge_id="ch_other",b=>b.allocations[0].row.stripe_invoice_id="in_other",b=>b.activity[0].row.object_id="sub_other",b=>b.attempts[0].row.stripe_customer_id="cus_other",b=>b.items[0].row.stripe_subscription_id="sub_other"]){const i=input();change(i.bundle);await reject(i,"BUNDLE_OWNERSHIP_REJECTED");}
// Retired rows must be covered even when absent from the freshly fetched graph.
const retired=input();retired.bundle.items.push({row:row("si_retired",{stripe_subscription_id:"sub_fixture",removed_at:"2026-10-09T00:00:00Z"}),expected_revision:"1"});
retired.stored={items:[row("si_retired",{stripe_subscription_id:"sub_other"})]};await reject(retired,"STORED_IDENTITY_CONFLICT");
const goodRetired=input();goodRetired.bundle.items.push({row:row("si_retired",{stripe_subscription_id:"sub_fixture",removed_at:"2026-10-09T00:00:00Z"}),expected_revision:"1"});goodRetired.stored={items:[row("si_retired",{stripe_subscription_id:"sub_fixture"})]};assert.equal((await validate(goodRetired)).status,"approved");
const stale=input();stale.stored={payments:[{...rows.payments,stripe_customer_id:"cus_other"}]};await reject(stale,"STORED_IDENTITY_CONFLICT");
const mixed=input();mixed.bundle.subscriptions.push({row:row("sub_other",{stripe_customer_id:"cus_other"}),expected_revision:"0"});await reject(mixed,"BUNDLE_OWNERSHIP_REJECTED");
const unresolved=input();unresolved.db=db({});unresolved.verifiedEvent=event("invoice.paid",{id:"in_fixture"});await reject(unresolved,"ROUTING_UNRESOLVED");
const conflict=input();const changed=structuredClone(records);changed.billing_invoices.in_fixture.stripe_customer_id="cus_other";changed.billing_finance_subscriptions.sub_fixture.stripe_customer_id="cus_other";conflict.db=db(changed);await reject(conflict,"ROUTING_OWNERSHIP_CONFLICT");
const unavailable=input();unavailable.db=db({},async()=>({data:null,error:{message:"PRIVATE_SECRET",details:"PRIVATE_PAYLOAD"}}));await reject(unavailable,"RELATIONSHIP_UNAVAILABLE");
const exception=input();exception.db=db({},async()=>{throw Error("PRIVATE_RAW_ERROR");});await reject(exception,"RELATIONSHIP_UNAVAILABLE");
const malformed=input();malformed.verifiedEvent=event("invoice.paid",{id:"user_PRIVATE",customer});await reject(malformed,"MALFORMED_EVIDENCE");
for(const cancel of [false,true]){let finish;const i=input();i.verifiedEvent=event("refund.updated",{id:"re_fixture",charge:"ch_fixture"});i.db=db({},()=>new Promise(r=>{finish=()=>r({data:rows.refunds,error:null});}));const controller=new AbortController();i.signal=controller.signal;const pending=validate(i);if(cancel)controller.abort();else {now+=2000;for(const fn of [...timers.values()])fn();}const r=await pending;assert.equal(r.reason,cancel?"RELATIONSHIP_CANCELLED_AMBIGUOUS":"RELATIONSHIP_TIMEOUT_AMBIGUOUS");finish();for(let n=0;n<8;n++)await Promise.resolve();assert.equal(i.db.calls.length,1);assert.equal(timers.size,0);}
assert.deepEqual(logs,[]);
const source=fs.readFileSync("src/lib/stripe/finance-customer-validation.ts","utf8");assert.match(source,/import "server-only"/);assert.doesNotMatch(source,/console\.|fetch\(|\.rpc\(|process\.env|\.command\(|\.insert\(|\.update\(|\.delete\(|assertClaimEligible|assertFence|withFinanceLease/);
for(const file of ["src/lib/stripe/finance-sync.ts","src/lib/stripe/finance-webhook.ts","src/lib/stripe/finance-store.ts","src/lib/stripe/finance-reconciliation.ts","src/lib/stripe/webhook-consumers.ts","src/app/api/stripe/webhook/route.ts"]){assert.equal(execFileSync("git",["diff","HEAD","--",file],{encoding:"utf8"}),"");assert.doesNotMatch(fs.readFileSync(file,"utf8"),/finance-customer-validation|finance-routing-evidence|finance-customer-relationship-adapter/);}
assert.equal(execFileSync("git",["diff","HEAD","--","supabase/migrations"],{encoding:"utf8"}),"");
assert.throws(()=>execFileSync("git",["grep","-n","billing_finance_partition_command","HEAD","--","src"],{encoding:"utf8",stdio:"pipe"}),e=>e.status===1);
console.log("PASS: inactive 17-event routing/graph/final-bundle composition; first-time/fallback; cross-customer/stale/retired/indirect rejection; bounded timeout/cancellation; fixed private diagnostics; no provider/mutation/lease/RPC/HTTP/schema changes (offline).");
