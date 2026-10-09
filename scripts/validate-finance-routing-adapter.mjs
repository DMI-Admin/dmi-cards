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
 exports,Error,AbortController,performance:{now:()=>now},setTimeout:(fn,ms)=>{assert.equal(ms,2000);timers.set(++sequence,fn);return sequence;},clearTimeout:id=>timers.delete(id),
 console:{log:(...args)=>logs.push(args),warn:(...args)=>logs.push(args),error:(...args)=>logs.push(args)},
 require:name=>{if(name==="server-only")return {};if(name.startsWith("."))return load(path.join(path.dirname(file),name)+".ts");throw Error("Forbidden dependency: "+name);},
 });return exports;
}
const {projectVerifiedFinanceRouting:project}=load("src/lib/stripe/finance-routing-evidence.ts");
const {createFinanceRelationshipAdapter:adapter,resolveVerifiedFinanceRouting:resolve}=load("src/lib/stripe/finance-customer-relationship-adapter.ts");
const {financeRoutingEvents:types}=load("src/lib/stripe/finance-customer-routing.ts");
const rel=load("src/lib/stripe/finance-customer-relationships.ts");
const scope="acct_fixture:test",customer="cus_fixture";
const event=(type,object)=>({id:"evt_fixture",type,created:1760000000,livemode:false,api_version:"2023-10-16",data:{object}});
const row=(id,fields)=>({stripe_scope:scope,stripe_object_id:id,...fields});
const records={billing_finance_subscriptions:{sub_fixture:row("sub_fixture",{stripe_customer_id:customer})},billing_invoices:{in_fixture:row("in_fixture",{stripe_customer_id:customer,stripe_subscription_id:"sub_fixture"})},billing_payments:{ch_fixture:row("ch_fixture",{stripe_customer_id:customer,stripe_payment_intent_id:"pi_fixture"})},billing_refunds:{re_fixture:row("re_fixture",{stripe_charge_id:"ch_fixture"})}};
function db(data=records,read){
 const calls=[];
 return {calls,from(table){
  assert.ok(Object.hasOwn(records,table));const call={table,filters:[]};calls.push(call);
  const q={select(columns){call.columns=columns;return q;},eq(key,value){call.filters.push([key,value]);return q;},abortSignal(signal){call.signal=signal;return q;},async maybeSingle(){
   assert.deepEqual(call.filters.map(x=>x[0]),["stripe_scope","stripe_object_id"]);assert.equal(call.filters[0][1],scope);
   assert.equal(call.signal.aborted,false);assert.equal(call.filters.length,2);
   return read?read(call):{data:structuredClone(data[table]?.[call.filters[1][1]]??null),error:null};
  }};return q;
 }};
}
const prefixes={subscription:"sub",invoice:"in",charge:"ch",refund:"re"};
for(const [type,kind] of Object.entries(types)){
 const raw={id:prefixes[kind]+"_fixture",...(kind==="refund"?{charge:"ch_fixture"}:{customer:{id:customer,email:"PRIVATE_EMAIL"}}),metadata:{secret:"PRIVATE_SECRET"},payload:"PRIVATE_PAYLOAD"};
 if(type==="charge.failed")Object.assign(raw,{status:"failed",paid:false,amount_captured:0,livemode:false});
 const evidence=project(scope,event(type,raw));
 assert.doesNotMatch(JSON.stringify(evidence),/PRIVATE|email|metadata|payload/);
 assert.deepEqual(Object.keys(evidence.data.object).sort(),(type==="charge.failed"?["id","customer","status","paid","amount_captured","livemode"]:kind==="refund"?["id","charge"]:["id","customer"]).sort());
 const client=db();const result=await resolve(client,scope,evidence);
 assert.equal(result.partition.customer,customer);assert.ok(client.calls.length<=2);assert.equal(timers.size,0);
 const missing={...raw};delete missing.customer;delete missing.charge;
 const fallback=await resolve(db(),scope,project(scope,event(type,missing)));assert.equal(fallback.partition.customer,customer);
}
const invoice=project(scope,event("invoice.paid",{id:"in_fixture",customer}));
const noRows=db({});assert.equal((await resolve(noRows,scope,project(scope,event("invoice.paid",{id:"in_fixture"})))).reason,"missing_relationship");
assert.equal((await resolve(db({}),scope,invoice)).partition.customer,customer);
const different=structuredClone(records);different.billing_invoices.in_fixture.stripe_customer_id="cus_other";different.billing_finance_subscriptions.sub_fixture.stripe_customer_id="cus_other";
assert.equal((await resolve(db(different),scope,invoice)).reason,"conflicting_ownership");
assert.equal((await resolve(db(different),scope,project(scope,event("invoice.paid",{id:"in_fixture",customer:"cus_other"})))).partition.customer,"cus_other");
const stale=structuredClone(records);stale.billing_finance_subscriptions.sub_fixture.stripe_customer_id="cus_other";
assert.equal((await resolve(db(stale),scope,invoice)).reason,"conflicting_ownership");
const dangling=structuredClone(records);dangling.billing_finance_subscriptions={};
assert.equal((await resolve(db(dangling),scope,invoice)).reason,"missing_relationship");
const refund=project(scope,event("refund.updated",{id:"re_fixture",charge:"ch_fixture"}));
const refundConflict=structuredClone(records);refundConflict.billing_refunds.re_fixture.stripe_charge_id="ch_other";
assert.equal((await resolve(db(refundConflict),scope,refund)).reason,"conflicting_ownership");
const noRefund=structuredClone(records);noRefund.billing_refunds={};const fallback=db(noRefund);
assert.equal((await resolve(fallback,scope,refund)).partition.customer,customer);assert.equal(fallback.calls.length,2);
const noPayment=structuredClone(records);noPayment.billing_payments={};assert.equal((await resolve(db(noPayment),scope,refund)).reason,"hop_limit");
for(const raw of [{id:"sub_wrong",customer},{id:"in_fixture",customer:"user_secret"},{id:"in_fixture",customer:{id:5}},{id:"in_fixture",customer:{}},{id:"in_fixture",object:"charge",customer},{id:"in_fixture",customer:[customer]}])assert.throws(()=>project(scope,event("invoice.paid",raw)),/^Error: FINANCE_ROUTING_EVIDENCE_INVALID$/);
assert.throws(()=>project(scope,event("refund.updated",{id:"re_fixture",charge:"in_wrong"})),/FINANCE_ROUTING_EVIDENCE_INVALID/);
assert.throws(()=>project(scope,{...event("invoice.paid",{id:"in_fixture",customer}),livemode:true}),/FINANCE_ROUTING_EVIDENCE_INVALID/);
assert.throws(()=>project(scope,event("checkout.session.completed",{id:"cs_fixture",customer})),/FINANCE_ROUTING_EVIDENCE_INVALID/);
assert.equal((await resolve(db({},async()=>({data:null,error:{message:"PRIVATE_SECRET",details:"PRIVATE_ID",hint:"PRIVATE_PAYLOAD"}})),scope,invoice)).reason,"lookup_unavailable");
assert.equal((await resolve(db({},async()=>{throw Error("PRIVATE_EXCEPTION");}),scope,invoice)).reason,"lookup_unavailable");
for(const cancel of [false,true]){
 let finish;const client=db({},()=>new Promise(r=>{finish=()=>r({data:records.billing_refunds.re_fixture,error:null});}));
 const controller=new AbortController();const pending=resolve(client,scope,refund,{signal:controller.signal});
 if(cancel)controller.abort();else {now+=2000;for(const fn of [...timers.values()])fn();}
 const result=await pending;assert.equal(result.reason,cancel?"lookup_cancelled_ambiguous":"lookup_timeout_ambiguous");
 finish();for(let i=0;i<8;i++)await Promise.resolve();assert.equal(client.calls.length,1);assert.equal(timers.size,0);
}
const c=new AbortController();c.abort();const unused=db();assert.equal((await resolve(unused,scope,invoice,{signal:c.signal})).reason,"lookup_cancelled_ambiguous");assert.equal(unused.calls.length,0);
const exact=db();const store=adapter(exact);
await store.readExact({resource:"payments",scope,id:"ch_fixture",columns:rel.relationshipColumns.payments,signal:new AbortController().signal});
assert.equal(exact.calls[0].columns,rel.relationshipColumns.payments.join(","));
for(const patch of [{resource:"items",id:"si_fixture",columns:rel.relationshipColumns.items},{columns:["*"]},{id:"ch_fixture', secret"}])await assert.rejects(store.readExact({resource:"payments",scope,id:"ch_fixture",columns:rel.relationshipColumns.payments,signal:new AbortController().signal,...patch}),/FINANCE_RELATIONSHIP_INPUT/);
assert.equal(exact.calls.length,1);assert.deepEqual(logs,[]);
const liveTypes=[...fs.readFileSync("src/lib/stripe/finance-webhook.ts","utf8").split("const eventRoots")[1].split("};")[0].matchAll(/"([a-z_.]+)":"(?:subscription|invoice|charge|refund)"/g)].map(x=>x[1]);assert.deepEqual(Object.keys(types).sort(),liveTypes.sort());
for(const file of ["finance-sync","finance-webhook","finance-store","finance-reconciliation","finance-event-evidence","webhook-consumers"]){
 const name="src/lib/stripe/"+file+".ts";assert.equal(execFileSync("git",["diff","HEAD","--",name],{encoding:"utf8"}),"");assert.doesNotMatch(fs.readFileSync(name,"utf8"),/finance-routing-evidence|finance-customer-relationship-adapter/);
}
assert.equal(execFileSync("git",["diff","HEAD","--","supabase/migrations","src/app/api/stripe/webhook/route.ts"],{encoding:"utf8"}),"");
for(const name of ["finance-routing-evidence","finance-customer-relationship-adapter"]){const source=fs.readFileSync("src/lib/stripe/"+name+".ts","utf8");assert.match(source,/import "server-only"/);assert.doesNotMatch(source,/console\.|fetch\(|\.rpc\(|process\.env|\.insert\(|\.update\(|\.delete\(/);}
assert.throws(()=>execFileSync("git",["grep","-n","billing_finance_partition_command","HEAD","--","src"],{encoding:"utf8",stdio:"pipe"}),e=>e.status===1);
console.log("PASS: all 17 verified projections; exact read-only adapter; shared two-read/two-second deadline; conflicts/missing/errors/cancellation/late responses; no sensitive logs; legacy runtime/RPC/HTTP/reconciliation unchanged (mocked only).");
