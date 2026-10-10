import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import ts from "typescript";
import {execFileSync} from "node:child_process";
const cache = new Map();
function load(file) {
 if(cache.has(file))return cache.get(file);
 const exports={};cache.set(file,exports);
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{
  exports,require:name=>{if(name==="server-only")return {};if(name.startsWith("."))return load(path.join(path.dirname(file),name)+".ts");throw Error("Unexpected dependency");},
 });return exports;
}
const {routeFinanceCustomer:route,financeRoutingEvents:types}=load("src/lib/stripe/finance-customer-routing.ts");
const scope="acct_fixture:test";
const event=(type,object)=>({id:"evt_fixture",type,created:1760000000,livemode:false,api_version:"2023-10-16",data:{object}});
const result=(type,object,rows=[])=>JSON.parse(JSON.stringify(route(scope,event(type,object),rows)));
const edge=(kind,subject,related)=>({scope,kind,subject,related});
const prefix={subscription:"sub",invoice:"in",charge:"ch",refund:"re"};
const expected=["customer.subscription.created","customer.subscription.updated","customer.subscription.deleted","invoice.finalized","invoice.updated","invoice.paid","invoice.payment_failed","invoice.voided","invoice.marked_uncollectible","charge.succeeded","charge.failed","charge.captured","charge.refunded","charge.refund.updated","refund.created","refund.updated","refund.failed"];
assert.deepEqual(Object.keys(types).sort(),expected.sort());
// Guard the inventory against the live consumer's root map without modifying it.
const consumer=fs.readFileSync("src/lib/stripe/finance-webhook.ts","utf8");
const rootBlock=consumer.split("const eventRoots")[1].split("};")[0];
const liveTypes=[...rootBlock.matchAll(/"([a-z_.]+)":"(?:subscription|invoice|charge|refund)"/g)].map(x=>x[1]);
assert.deepEqual(liveTypes.sort(),expected.sort());
for(const [type,kind] of Object.entries(types)){
 const object={id:prefix[kind]+"_fixture",...(kind==="refund"?{charge:"ch_fixture"}:{customer:"cus_fixture"})};
 if(type==="charge.failed")Object.assign(object,{status:"failed",paid:false,amount_captured:0,livemode:false});
 const rows=kind==="refund"?[edge("charge","ch_fixture","cus_fixture")]:[];
 assert.deepEqual(result(type,object,rows).partition,{scope,customer:"cus_fixture"});
 // Missing ownership fails closed even when user metadata names an account.
 const missing={...object};delete missing.customer;delete missing.charge;
 missing.metadata={dmi_user_id:"PRIVATE_USER"};
 assert.equal(result(type,missing).reason,"missing_relationship");
 assert.equal(result(type,object,kind==="refund"?[edge("charge","ch_fixture","cus_other"),edge("charge","ch_fixture","cus_conflict")]:[edge(kind,object.id,"cus_other")]).reason,"conflicting_ownership");
}
assert.equal(result("customer.subscription.created",{id:"sub_fixture",customer:{id:"cus_fixture",email:"PRIVATE_EMAIL"}}).status,"routed");
assert.equal(result("invoice.paid",{id:"in_fixture"},[edge("invoice","in_fixture","cus_fixture")]).basis,"verified_relationship");
assert.equal(result("refund.updated",{id:"re_fixture"},[edge("refund","re_fixture","ch_fixture"),edge("charge","ch_fixture","cus_fixture")]).status,"routed");
assert.equal(result("refund.updated",{id:"re_fixture",charge:"ch_fixture"},[edge("refund","re_fixture","ch_other")]).reason,"conflicting_ownership");
for(const type of ["checkout.session.completed","invoice.payment_succeeded","customer.created","invoice_payment.paid"])
 assert.equal(result(type,{id:"cs_fixture",customer:"cus_fixture"}).reason,"unsupported_event");
for(const customer of ["sub_fixture","ch_fixture","PRIVATE_USER",123,{},[],{id:42}])
 assert.equal(result("invoice.paid",{id:"in_fixture",customer}).reason,"invalid_evidence");
for(const object of [null,[],{}, {id:"sub_fixture",customer:"cus_fixture"}])
 assert.equal(result("invoice.paid",object).reason,"invalid_evidence");
assert.equal(result("invoice.paid",{id:"in_fixture",customer:null}).reason,"missing_relationship");
assert.equal(result("refund.updated",{id:"re_fixture",customer:"cus_fixture"}).reason,"invalid_evidence");
assert.equal(result("invoice.paid",{id:"in_fixture"},[edge("invoice","in_other","cus_fixture")]).reason,"invalid_evidence");
assert.equal(result("invoice.paid",{id:"in_fixture"},[{...edge("invoice","in_fixture","cus_fixture"),scope:"acct_other:test"}]).reason,"invalid_evidence");
assert.equal(result("invoice.paid",{id:"in_fixture"},Array(3).fill(edge("invoice","in_fixture","cus_fixture"))).reason,"invalid_evidence");
for(const patch of [{livemode:true},{account:"acct_other"},{api_version:"wrong"},{created:-1}])
 assert.equal(route(scope,{...event("invoice.paid",{id:"in_fixture",customer:"cus_fixture"}),...patch}).reason,"invalid_evidence");
assert.equal(route("invalid",event("invoice.paid",{id:"in_fixture",customer:"cus_fixture"})).reason,"invalid_evidence");
const first=result("invoice.paid",{id:"in_fixture",customer:"cus_fixture"}).partition;
assert.deepEqual(result("charge.succeeded",{id:"ch_fixture",customer:"cus_fixture"}).partition,first);
assert.notDeepEqual(result("charge.succeeded",{id:"ch_fixture",customer:"cus_other"}).partition,first);
// No input payload or raw errors appear in fixed failure results, nor extras in success.
const privateObject={id:"in_fixture",customer:"cus_fixture",email:"PRIVATE_EMAIL",metadata:{secret:"PRIVATE_SECRET"},user_id:"PRIVATE_USER"};
assert.doesNotMatch(JSON.stringify(result("invoice.paid",privateObject)),/PRIVATE|metadata|user_id|email/);
assert.doesNotMatch(JSON.stringify(result("invoice.paid",{...privateObject,customer:"PRIVATE_CUSTOMER"})),/PRIVATE/);
// Keys are internal identifiers: intentionally present only in successful partition output.
// No runtime integration, lease/RPC/schema/HTTP/reconciliation edits in this phase.
const protectedFiles=["src/lib/stripe/finance-event-evidence.ts","src/lib/stripe/finance-webhook.ts","src/lib/stripe/finance-store.ts","src/lib/stripe/finance-sync.ts","src/lib/stripe/finance-reconciliation.ts","src/lib/stripe/webhook-consumers.ts","src/app/api/stripe/webhook/route.ts"];
for(const file of protectedFiles){
 if(!["src/lib/stripe/finance-sync.ts","src/lib/stripe/finance-reconciliation.ts","src/lib/stripe/finance-webhook.ts","src/lib/stripe/finance-store.ts","src/lib/stripe/webhook-consumers.ts"].includes(file))assert.equal(execFileSync("git",["diff","HEAD","--",file,':(exclude)src/app/api/stripe/webhook/route.ts',':(exclude)src/middleware.ts'],{encoding:"utf8"}),"");
 assert.doesNotMatch(fs.readFileSync(file,"utf8"),/finance-customer-routing/);
}
assert.equal(execFileSync("git",["diff","HEAD","--","supabase/migrations"],{encoding:"utf8"}),"");
const source=fs.readFileSync("src/lib/stripe/finance-customer-routing.ts","utf8");
assert.doesNotMatch(source,/console\.|fetch\(|\.rpc\(|process\.env|stripe\./);
console.log("PASS: all 17 Finance event routes, direct/indirect ownership, bounded relationships, conflicts, malformed evidence, scope/mode, no identity guessing or data leakage; runtime/locks/HTTP/reconciliation unchanged (offline).");
