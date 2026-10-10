// Offline injected-storage tests only. No provider, SQL, network or runtime integration.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import {execFileSync} from "node:child_process";
const file="src/lib/stripe/finance-charge-ownership-proof.ts";
function load(source,deps={}) {
 const exports={};
 const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(js,{exports,require:name=>name==="server-only"?{}:deps[name],AbortController,setTimeout,clearTimeout,performance});
 return exports;
}
const source=fs.readFileSync(file,"utf8");
const classifier=load(fs.readFileSync("src/lib/stripe/finance-application-ownership.ts","utf8"));
const relationships=load(fs.readFileSync("src/lib/stripe/finance-customer-relationships.ts","utf8"));
const deps={"./finance-application-ownership":classifier,"./finance-customer-relationships":relationships};
const proofModule=load(source,deps),scope="acct_fixture:test";
const input={scope,type:"charge.succeeded",charge:"ch_fixture",customer:"cus_fixture",paymentIntent:"pi_fixture"};
const allocation={stripe_scope:scope,stripe_object_id:"inpay_fixture",stripe_invoice_id:"in_fixture",stripe_charge_id:input.charge,stripe_payment_intent_id:input.paymentIntent};
const snapshot={scope,invoice:"in_fixture",customer:input.customer,subscription:"sub_fixture",invoiceRevision:"3",complete:true,prices:[{id:"price_fixture",ownershipRevision:1}]};
const owner=(id="price_fixture",extra={})=>({scope,type:"price",id,application:"dmi_cards",basis:"price_owner",provenance:"reviewed_dmi_price",revision:1,state:"active",applicationActive:true,...extra});
function fixture() {
 const calls=[];
 const data={payment:{stripe_scope:scope,stripe_object_id:input.charge,stripe_customer_id:input.customer,stripe_payment_intent_id:input.paymentIntent},
   invoice:{stripe_scope:scope,stripe_object_id:snapshot.invoice,stripe_customer_id:input.customer,stripe_subscription_id:snapshot.subscription,revision:"3"},
   byCharge:{rows:[structuredClone(allocation)],complete:true},byIntent:{rows:[structuredClone(allocation)],complete:true},owners:[owner()]};
 const storage={
  async readPayment(r){calls.push(["payment",r]);return data.payment;},
  async readAllocations(r){calls.push(["allocation",r]);assert.equal(r.limit,3);assert.ok(r.field==="stripe_charge_id"||r.field==="stripe_payment_intent_id");return r.field==="stripe_charge_id"?data.byCharge:data.byIntent;},
  async readInvoice(r){calls.push(["invoice",r]);return data.invoice;},
  async readOwnership(r){calls.push(["ownership",r]);return data.owners.find(o=>o.id===r.key.id)??null;},
 };
 return {calls,data,storage,evidence:[structuredClone(snapshot)],input:structuredClone(input)};
}
let tests=0;
async function test(name,run){await run();tests++;console.log("PASS "+name);}
const resolve=h=>proofModule.resolveChargeOwnershipProof(h.storage,h.input,h.evidence);
await test("exact positive DMI proof and exact minimal lookup contract",async()=>{
 const h=fixture(),r=await resolve(h);assert.equal(r.state,"dmi");assert.equal(h.calls.length,5);
 assert.equal(r.proof.invoiceRevision,"3");assert.equal(r.proof.prices[0].revision,1);
 for(const [kind,q] of h.calls){assert.equal(q.scope??q.key.scope,scope);assert.ok(q.signal instanceof AbortSignal);
  if(q.columns)assert.equal(q.columns.join(","),proofModule.chargeProofColumns[kind].join(","));}
});
await test("charge-family evidence uses the same positive path",async()=>{
 for(const type of ["charge.succeeded","charge.failed","charge.captured","charge.refunded"]){const h=fixture();h.input.type=type;assert.equal((await resolve(h)).state,"dmi");}
});
await test("positive known foreign proof; absence never means foreign",async()=>{
 const h=fixture();h.data.owners=[owner("price_fixture",{application:"known_other",provenance:"operator_review"})];assert.equal((await resolve(h)).state,"foreign");
 h.data.owners=[];assert.equal((await resolve(h)).reason,"ownership_unresolved");
});
await test("missing allocation",async()=>{const h=fixture();h.data.byCharge.rows=[];h.data.byIntent.rows=[];assert.equal((await resolve(h)).reason,"missing_relationship");});
await test("multiple different invoice allocations are ambiguous",async()=>{
 const h=fixture(),other={...allocation,stripe_object_id:"inpay_other",stripe_invoice_id:"in_other"};h.data.byCharge.rows.push(other);h.data.byIntent.rows.push(other);assert.equal((await resolve(h)).reason,"allocation_ambiguous");
});
await test("conflicting duplicate allocation identity",async()=>{
 const h=fixture();h.data.byIntent.rows[0].stripe_invoice_id="in_other";assert.equal((await resolve(h)).reason,"allocation_ambiguous");
});
await test("inconsistent complete allocation reads fail closed",async()=>{
 const h=fixture();h.data.byIntent.rows=[];assert.equal((await resolve(h)).reason,"allocation_ambiguous");
});
await test("pre-cancelled invocation performs no reads",async()=>{
 const h=fixture(),c=new AbortController();c.abort();assert.equal((await proofModule.resolveChargeOwnershipProof(h.storage,h.input,h.evidence,{signal:c.signal})).reason,"lookup_cancelled_ambiguous");assert.equal(h.calls.length,0);
});
await test("payment-intent mismatch",async()=>{
 const h=fixture();h.data.payment.stripe_payment_intent_id="pi_other";assert.equal((await resolve(h)).reason,"allocation_ambiguous");assert.equal(h.calls.length,1);
 const a=fixture();a.data.byIntent.rows[0].stripe_charge_id="ch_other";assert.equal((await resolve(a)).reason,"allocation_ambiguous");
});
await test("cross-customer payment, invoice and snapshot conflict",async()=>{
 for(const part of ["payment","invoice","snapshot"]){const h=fixture();if(part==="snapshot")h.evidence[0].customer="cus_other";else h.data[part].stripe_customer_id="cus_other";assert.equal((await resolve(h)).state,"conflict");}
});
await test("complete two-price invoice evidence and six-read ceiling",async()=>{
 const h=fixture();h.evidence[0].prices.push({id:"price_second",ownershipRevision:1});h.data.owners.push(owner("price_second"));assert.equal((await resolve(h)).state,"dmi");assert.equal(h.calls.length,6);
});
await test("incomplete, absent, excessive and duplicate invoice evidence",async()=>{
 for(const change of [h=>h.evidence[0].complete=false,h=>h.evidence=[],h=>h.evidence[0].prices=[],h=>h.evidence[0].prices.push({id:"price_two",ownershipRevision:1},{id:"price_three",ownershipRevision:1})]){const h=fixture();change(h);assert.equal((await resolve(h)).reason,"incomplete_evidence");}
 const h=fixture();h.evidence.push(structuredClone(snapshot));assert.equal((await resolve(h)).reason,"allocation_ambiguous");
});
await test("stored revision/subscription changed: snapshot is stale",async()=>{
 for(const field of ["revision","stripe_subscription_id"]){const h=fixture();h.data.invoice[field]=field==="revision"?"4":"sub_other";assert.equal((await resolve(h)).reason,"ownership_stale");}
});
await test("changed or missing price never substitutes current subscription price",async()=>{
 const h=fixture();h.evidence[0].prices[0].id="price_changed";assert.equal((await resolve(h)).reason,"ownership_unresolved");
 assert.ok(h.calls.every(([kind])=>kind!=="subscription"));
});
await test("mixed application ownership is conflict",async()=>{
 const h=fixture();h.evidence[0].prices.push({id:"price_other",ownershipRevision:1});h.data.owners.push(owner("price_other",{application:"known_other",provenance:"operator_review"}));assert.equal((await resolve(h)).state,"conflict");
});
await test("revoked, stale revision and inactive application fail closed",async()=>{
 for(const change of [{state:"revoked",revision:2},{revision:2},{applicationActive:false}]){const h=fixture();h.data.owners[0]={...h.data.owners[0],...change};assert.equal((await resolve(h)).reason,"ownership_stale");}
});
await test("truncated/over-cap allocations and mismatched scoped identity",async()=>{
 for(const change of [h=>h.data.byCharge.complete=false,h=>h.data.byCharge.rows=[allocation,allocation,allocation]]){const h=fixture();change(h);assert.equal((await resolve(h)).reason,"incomplete_evidence");}
 const h=fixture();h.data.invoice.stripe_scope="acct_other:test";assert.equal((await resolve(h)).reason,"invalid_evidence");
});
await test("malformed input performs no reads; missing relationship is unresolved",async()=>{
 const h=fixture();h.input.charge="PAYLOAD_SECRET";assert.equal((await resolve(h)).reason,"invalid_evidence");assert.equal(h.calls.length,0);
 const missing=fixture();missing.data.payment=null;assert.equal((await resolve(missing)).reason,"missing_relationship");
});
await test("read-budget exhaustion cannot perform another read",async()=>{
 const limited=load(source.replace("CHARGE_PROOF_MAX_READS = 6","CHARGE_PROOF_MAX_READS = 2"),deps),h=fixture();
 assert.equal((await limited.resolveChargeOwnershipProof(h.storage,h.input,h.evidence)).reason,"read_budget_exhausted");assert.equal(h.calls.length,2);
});
await test("deadline and cancellation: late response never continues resolution",async()=>{
 for(const cancelled of [false,true]){
  let elapsed=0,expire,late;const h=fixture();h.storage.readPayment=r=>{h.calls.push(["payment",r]);return new Promise(resolve=>{late=()=>resolve(h.data.payment);});};
  const clock={now:()=>elapsed,setTimer(fn,ms){assert.equal(ms,2000);expire=fn;return 1;},clearTimer(){}};
  const controller=new AbortController();const pending=proofModule.resolveChargeOwnershipProof(h.storage,h.input,h.evidence,{clock,signal:controller.signal});
  if(cancelled)controller.abort();else{elapsed=2000;expire();}
  const r=await pending;assert.equal(r.reason,cancelled?"lookup_cancelled_ambiguous":"lookup_timeout_ambiguous");late();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(h.calls.length,1);
 }
});
await test("monotonic time exhaustion without timer dispatch",async()=>{
 let elapsed=0;const h=fixture(),original=h.storage.readPayment;h.storage.readPayment=async r=>{const row=await original(r);elapsed=2000;return row;};
 const clock={now:()=>elapsed,setTimer(){return 1;},clearTimer(){}};assert.equal((await proofModule.resolveChargeOwnershipProof(h.storage,h.input,h.evidence,{clock})).reason,"lookup_timeout_ambiguous");assert.equal(h.calls.length,1);
});
await test("raw errors and unexpected identifier-bearing properties excluded",async()=>{
 const h=fixture();h.storage.readPayment=async()=>{throw Error("secret_payload cus_private user_private");};const r=await resolve(h);
 assert.equal(r.reason,"lookup_unavailable");assert.doesNotMatch(JSON.stringify(r),/secret|payload|cus_|user_/);
 const good=fixture();good.data.payment.rawSecret="secret_payload";const result=await resolve(good);assert.equal(result.state,"dmi");assert.doesNotMatch(JSON.stringify(result),/secret_payload|rawSecret/);
});
assert.doesNotMatch(source,/console\.|logInfo|logError|fetch\(|\.rpc\(|\.insert\(|\.update\(|\.delete\(|process\.env|stripe\./);
for(const name of execFileSync("git",["ls-files","src"],{encoding:"utf8"}).trim().split("\n"))assert.doesNotMatch(fs.readFileSync(name,"utf8"),/finance-charge-ownership-proof/);
assert.equal(execFileSync("git",["diff","--name-only","HEAD","--","src","supabase/migrations",':(exclude)src/lib/stripe/finance-contract.ts',':(exclude)src/lib/stripe/finance-customer-webhook.ts',':(exclude)src/lib/stripe/finance-store.ts',':(exclude)src/lib/stripe/webhook-consumers.ts',':(exclude)src/app/api/stripe/webhook/route.ts',':(exclude)src/middleware.ts',':(exclude)src/lib/stripe/billing-work-recovery.ts'],{encoding:"utf8"}),"","Tracked runtime/schema unchanged");
console.log(`PASS ${tests}/${tests} charge-proof cases; inactive, bounded, no provider/mutation/logging/runtime integration`);
