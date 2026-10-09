import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import {execFileSync} from "node:child_process";
const cache=new Map(),timers=new Map();let now=0,sequence=0;
function load(file){
 if(cache.has(file))return cache.get(file);
 const exports={};cache.set(file,exports);
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{
 exports,Error,AbortController,performance:{now:()=>now},setTimeout:(fn,ms)=>{assert.equal(ms,2000);timers.set(++sequence,fn);return sequence;},clearTimeout:id=>timers.delete(id),
 require:name=>{if(name==="server-only")return {};if(name.startsWith("."))return load(path.join(path.dirname(file),name)+".ts");throw Error("Unexpected dependency");},
 });return exports;
}
const rel=load("src/lib/stripe/finance-customer-relationships.ts"),own=load("src/lib/stripe/finance-customer-ownership.ts"),routing=load("src/lib/stripe/finance-customer-routing.ts");
const p={scope:"acct_fixture:test",customer:"cus_fixture"};
const row=(id,fields={})=>({stripe_scope:p.scope,stripe_object_id:id,...fields});
const records={subscriptions:{sub_fixture:row("sub_fixture",{stripe_customer_id:p.customer})},items:{si_fixture:row("si_fixture",{stripe_subscription_id:"sub_fixture"})},invoices:{in_fixture:row("in_fixture",{stripe_customer_id:p.customer,stripe_subscription_id:"sub_fixture"})},payments:{ch_fixture:row("ch_fixture",{stripe_customer_id:p.customer,stripe_payment_intent_id:"pi_fixture"})},refunds:{re_fixture:row("re_fixture",{stripe_charge_id:"ch_fixture"})},allocations:{inpay_fixture:row("inpay_fixture",{stripe_invoice_id:"in_fixture",stripe_charge_id:"ch_fixture"})},attempts:{"charge:ch_fixture":{stripe_scope:p.scope,attempt_key:"charge:ch_fixture",stripe_customer_id:p.customer,stripe_charge_id:"ch_fixture"}},activity:{activity:{stripe_scope:p.scope,activity_key:"activity",stripe_customer_id:p.customer,object_type:"subscriptions",object_id:"sub_fixture"}}};
function storage(data=records){const calls=[];return {calls,readExact:async request=>{calls.push(request);assert.deepEqual([...request.columns],[...rel.relationshipColumns[request.resource]]);assert.equal(request.scope,p.scope);assert.ok(request.signal);return structuredClone(data[request.resource]?.[request.id]??null);}};}
for(const [resource,objects] of Object.entries(records))for(const id of Object.keys(objects)){
 const s=storage();const value=await rel.resolveFinanceRelationship(s,p.scope,resource,id);
 assert.equal(value.status,"resolved");assert.equal(value.partition.customer,p.customer);assert.ok(s.calls.length<=2);assert.equal(timers.size,0);
}
assert.equal((await rel.resolveFinanceRelationship(storage(),p.scope,"refunds","re_missing")).reason,"missing_relationship");
assert.equal((await rel.resolveFinanceRelationship(storage(),p.scope,"payments","sub_fixture")).reason,"invalid_evidence");
const bad=structuredClone(records);bad.payments.ch_fixture.stripe_customer_id="cus_other";
assert.equal((await rel.resolveFinanceRelationship(storage(bad),p.scope,"attempts","charge:ch_fixture")).reason,"conflicting_ownership");
const invoiceConflict=structuredClone(records);invoiceConflict.subscriptions.sub_fixture.stripe_customer_id="cus_other";
assert.equal((await rel.resolveFinanceRelationship(storage(invoiceConflict),p.scope,"invoices","in_fixture")).reason,"conflicting_ownership");
const deep=structuredClone(records);deep.activity.activity.object_type="refunds";deep.activity.activity.object_id="re_fixture";
const bounded=storage(deep);assert.equal((await rel.resolveFinanceRelationship(bounded,p.scope,"activity","activity")).reason,"hop_limit");assert.equal(bounded.calls.length,2);
assert.equal((await rel.resolveFinanceRelationship({readExact:async()=>{throw Error("PRIVATE_DATABASE_SECRET");}},p.scope,"payments","ch_fixture")).reason,"lookup_unavailable");
assert.equal((await rel.resolveFinanceRelationship({readExact:async()=>{throw Object.assign(Error("PRIVATE_ABORT"),{name:"AbortError"});}},p.scope,"payments","ch_fixture")).reason,"lookup_cancelled_ambiguous");
// Timeout/cancellation are ambiguous; a late response cannot start the next read.
for(const cancel of [false,true]){
 let finish,calls=0;const controller=new AbortController();
 const pending=rel.resolveFinanceRelationship({readExact:()=>{calls++;return new Promise(resolve=>{finish=()=>resolve(records.refunds.re_fixture);});}},p.scope,"refunds","re_fixture",{signal:controller.signal});
 if(cancel)controller.abort();else {now+=2000;for(const fn of [...timers.values()])fn();}
 const value=await pending;assert.equal(value.reason,cancel?"lookup_cancelled_ambiguous":"lookup_timeout_ambiguous");
 finish();await Promise.resolve();await Promise.resolve();assert.equal(calls,1);assert.equal(timers.size,0);
}
const preAbort=new AbortController();preAbort.abort();const noReads=storage();
assert.equal((await rel.resolveFinanceRelationship(noReads,p.scope,"payments","ch_fixture",{signal:preAbort.signal})).reason,"lookup_cancelled_ambiguous");assert.equal(noReads.calls.length,0);
const wrongScope=structuredClone(records);wrongScope.payments.ch_fixture.stripe_scope="acct_other:test";
assert.equal((await rel.resolveFinanceRelationship(storage(wrongScope),p.scope,"payments","ch_fixture")).reason,"invalid_evidence");
const event=(type,object)=>({id:"evt_fixture",type,created:1760000000,livemode:false,api_version:"2023-10-16",data:{object}});
for(const [type,kind] of Object.entries(routing.financeRoutingEvents)){
 const prefix={subscription:"sub",invoice:"in",charge:"ch",refund:"re"}[kind];
 const raw={id:prefix+"_fixture",...(kind==="refund"?{charge:"ch_fixture"}:{customer:p.customer})};
 if(type==="charge.failed")Object.assign(raw,{status:"failed",paid:false,amount_captured:0,livemode:false});
 const resolved=await rel.resolveFinanceEventCustomer(storage(),p.scope,event(type,raw));assert.equal(resolved.partition.customer,p.customer);
 const missing={...raw};delete missing.customer;delete missing.charge;
 assert.equal((await rel.resolveFinanceEventCustomer(storage(),p.scope,event(type,missing))).partition.customer,p.customer);
}
assert.equal((await rel.resolveFinanceEventCustomer(storage(bad),p.scope,event("charge.succeeded",{id:"ch_fixture",customer:p.customer}))).reason,"conflicting_ownership");
const other=await rel.resolveFinanceEventCustomer(storage(bad),p.scope,event("charge.succeeded",{id:"ch_fixture",customer:"cus_other"}));assert.equal(other.partition.customer,"cus_other");
// Complete normalized bundle including stored/retired item, allocations, attempts and activity.
const bundle=Object.fromEntries(Object.entries(records).map(([kind,objects])=>[kind,Object.values(objects).map(r=>({row:structuredClone(r),expected_revision:"0"}))]));
bundle.items[0].row.removed_at="2026-10-09T00:00:00Z";
assert.equal(own.validateFinanceBundleOwnership(p,bundle).valid,true);
const failed=mutate=>{const b=structuredClone(bundle);mutate(b);const result=own.validateFinanceBundleOwnership(p,b);assert.equal(result.valid,false);assert.match(result.code,/^FINANCE_OWNERSHIP_/);assert.doesNotMatch(JSON.stringify(result),/cus_|sub_|PRIVATE/);};
failed(b=>{b.payments[0].row.stripe_customer_id="cus_other";});
failed(b=>{b.subscriptions=[];});
failed(b=>{b.refunds[0].row.stripe_charge_id="ch_missing";});
failed(b=>{b.items.push(structuredClone(b.items[0]));});
failed(b=>{b.items[0].row.stripe_subscription_id="sub_missing";});
failed(b=>{b.invoices[0].row.stripe_scope="acct_other:test";});
failed(b=>{b.allocations[0].row.stripe_charge_id=null;b.allocations[0].row.stripe_payment_intent_id="pi_missing";});
failed(b=>{b.attempts[0].row.stripe_customer_id=undefined;});
failed(b=>{b.activity[0].row.object_id="sub_missing";});
failed(b=>{b.subscriptions[0].row.stripe_customer_id="PRIVATE_USER";});
const stale={payments:[{...records.payments.ch_fixture,stripe_customer_id:"cus_other"}]};
assert.equal(own.validateFinanceBundleOwnership(p,bundle,stale).valid,false);
const duplicateStored={payments:[records.payments.ch_fixture,records.payments.ch_fixture]};
assert.equal(own.validateFinanceBundleOwnership(p,bundle,duplicateStored).valid,false);
failed(b=>{b.allocations[0].row.stripe_payment_intent_id="pi_other";});
failed(b=>{b.refunds[0].row.stripe_payment_intent_id="pi_other";});
failed(b=>{b.attempts[0].row.attempt_key="charge:ch_other";});
failed(b=>{b.activity[0].row.stripe_customer_id="cus_other";});
const retired=structuredClone(bundle);retired.subscriptions=[];
assert.equal(own.validateFinanceBundleOwnership(p,retired,{subscriptions:[records.subscriptions.sub_fixture]}).valid,true);
assert.equal(own.validateFinanceBundleOwnership(p,retired,{subscriptions:[{...records.subscriptions.sub_fixture,stripe_customer_id:"cus_other"}]}).valid,false);
const graph={complete:true,customers:[{id:p.customer,livemode:false}],subscriptions:[{id:"sub_fixture",livemode:false,customer:p.customer,items:{has_more:false,data:[{id:"si_fixture",subscription:"sub_fixture"}]}}],invoices:[{id:"in_fixture",livemode:false,customer:p.customer,parent:{subscription_details:{subscription:"sub_fixture"}}}],charges:[{id:"ch_fixture",livemode:false,customer:p.customer,payment_intent:"pi_fixture"}],refunds:[{id:"re_fixture",livemode:false,charge:"ch_fixture",payment_intent:"pi_fixture"}],allocations:[{id:"inpay_fixture",livemode:false,invoice:"in_fixture",payment:{type:"payment_intent",payment_intent:"pi_fixture"}}]};
assert.equal(own.validateFinanceGraphOwnership(p,graph).valid,true);
for(const change of [g=>g.charges[0].customer="cus_other",g=>g.refunds[0].charge="ch_missing",g=>g.invoices[0].livemode=true,g=>g.subscriptions[0].items.data[0].subscription="sub_other",g=>g.customers.push({id:"cus_other",livemode:false}),g=>g.subscriptions[0].items.has_more=true,g=>g.charges.push(structuredClone(g.charges[0])),g=>g.complete=false]){
 const g=structuredClone(graph);change(g);assert.equal(own.validateFinanceGraphOwnership(p,g).valid,false);
}
assert.equal(own.validateFinanceGraphOwnership(p,graph,stale).valid,false);
for(const file of ["src/lib/stripe/finance-sync.ts","src/lib/stripe/finance-webhook.ts","src/lib/stripe/finance-reconciliation.ts","src/lib/stripe/finance-store.ts","src/lib/stripe/finance-stripe-adapter.ts","src/lib/stripe/finance-event-evidence.ts","src/lib/stripe/webhook-consumers.ts","src/app/api/stripe/webhook/route.ts"]){
 assert.equal(execFileSync("git",["diff","HEAD","--",file],{encoding:"utf8"}),"");
 assert.doesNotMatch(fs.readFileSync(file,"utf8"),/finance-customer-(relationships|ownership)/);
}
assert.equal(execFileSync("git",["diff","HEAD","--","supabase/migrations"],{encoding:"utf8"}),"");
for(const file of ["src/lib/stripe/finance-customer-relationships.ts","src/lib/stripe/finance-customer-ownership.ts"])
 assert.doesNotMatch(fs.readFileSync(file,"utf8"),/console\.|fetch\(|\.rpc\(|process\.env|stripe\./);
console.log("PASS: 17 events, exact minimal two-read relationships, deadline/cancellation/late settlement, fixed diagnostics, graph/bundle ownership and stale/retired rows; live locks/HTTP/reconciliation/provider/schema unchanged (offline).");
