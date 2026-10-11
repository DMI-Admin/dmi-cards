import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import {execFileSync} from "node:child_process";
const file="src/lib/stripe/finance-partition-protocol.ts",exports={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports,require:name=>{assert.equal(name,"server-only");return {};}});
const m=exports,p={scope:"acct_fixture:test",customer:"cus_fixture"};
const gate={mode:"legacy",epoch:4},empty={exclusiveAuthority:true,activeLegacyLeases:0,incompatibleLegacyWork:0,activeCustomerLeases:0,incompatibleCustomerWork:0};
const claim=(writer,kind,epoch=4,customer=undefined)=>({writer,kind,scope:p.scope,epoch,...(customer?{customer}:{})});
const legacy=claim("legacy","legacy_scope"),legacyLease={...legacy,token:"lease_one",revision:"3",expiresAt:120000};
const fence=lease=>({...lease,expectedRevision:lease.revision});
const rejects=(fn,code)=>assert.throws(fn,e=>e.code===code&&e.message===code);
const clone=value=>JSON.parse(JSON.stringify(value));
m.assertClaimEligible(gate,legacy);
m.assertClaimEligible(gate,claim("legacy","coordinator"));
m.assertFence(gate,legacyLease,fence(legacyLease),1000);
rejects(()=>m.assertClaimEligible(gate,claim("customer","customer",4,p.customer)),"PROTOCOL_CLAIM_BLOCKED");
rejects(()=>m.transitionProtocol(gate,4,"customer",empty),"PROTOCOL_INVALID");
rejects(()=>m.transitionProtocol(gate,4,"draining_to_customer",{...empty,exclusiveAuthority:false}),"PROTOCOL_AUTHORITY_REQUIRED");
const draining=m.transitionProtocol(gate,4,"draining_to_customer",empty);assert.equal(gate.mode,"legacy");assert.equal(draining.epoch,4);
rejects(()=>m.assertClaimEligible(draining,legacy),"PROTOCOL_CLAIM_BLOCKED");
rejects(()=>m.assertClaimEligible(draining,claim("legacy","coordinator")),"PROTOCOL_CLAIM_BLOCKED");
m.assertFence(draining,legacyLease,fence(legacyLease),1000);
for(const key of ["activeLegacyLeases","incompatibleLegacyWork"])
 rejects(()=>m.transitionProtocol(draining,4,"customer",{...empty,[key]:1}),"PROTOCOL_DRAIN_REQUIRED");
rejects(()=>m.transitionProtocol(draining,4,"customer",{...empty,exclusiveAuthority:false}),"PROTOCOL_AUTHORITY_REQUIRED");
const active=m.transitionProtocol(draining,4,"customer",empty);assert.equal(active.epoch,5);
const c=claim("customer","customer",5,p.customer),lease={...c,token:"lease_customer",revision:"7",expiresAt:120000};
m.assertClaimEligible(active,c);m.assertClaimEligible(active,claim("customer","coordinator",5));
rejects(()=>m.assertClaimEligible(active,{...legacy,epoch:5}),"PROTOCOL_CLAIM_BLOCKED");
rejects(()=>m.assertClaimEligible(active,{...c,epoch:4}),"PROTOCOL_EPOCH_STALE");
rejects(()=>m.assertClaimEligible(active,{...c,customer:"PRIVATE_USER"}),"PROTOCOL_INVALID");
rejects(()=>m.assertClaimEligible(active,{...c,kind:"legacy_scope"}),"PROTOCOL_INVALID");
m.assertFence(active,lease,fence(lease),1000);
for(const patch of [{token:"stale_token"},{expectedRevision:"6"},{expectedRevision:"9223372036854775808"}])
 rejects(()=>m.assertFence(active,lease,{...fence(lease),...patch},1000),"PROTOCOL_FENCE");
rejects(()=>m.assertFence(active,lease,fence(lease),120000),"PROTOCOL_FENCE");
rejects(()=>m.assertFence(active,lease,{...fence(lease),epoch:4},1000),"PROTOCOL_EPOCH_STALE");
rejects(()=>m.assertFence(active,lease,{...fence(lease),customer:"cus_other"},1000),"PROTOCOL_PARTITION_MISMATCH");
const other={...lease,customer:"cus_other",token:"lease_other",revision:"1"};
m.assertFence(active,other,fence(other),1000);m.assertFence(active,lease,fence(lease),1000);
m.assertPartitionOwners(p,[p,p]);
rejects(()=>m.assertPartitionOwners(p,[{...p,customer:"cus_other"}]),"PROTOCOL_PARTITION_MISMATCH");
rejects(()=>m.assertPartitionOwners(p,[{...p,scope:"acct_other:test"}]),"PROTOCOL_PARTITION_MISMATCH");
const receipt={scope:p.scope,consumer:"finance_v1",event:"evt_fixture",status:"processing",token:"receipt_token",expiresAt:120000};
const bound=m.bindReceipt(receipt,"receipt_token",p,1000);assert.equal(receipt.customer,undefined);assert.equal(bound.customer,p.customer);
assert.deepEqual(clone(m.bindReceipt(bound,"receipt_token",p,1000)),clone(bound));
rejects(()=>m.bindReceipt(bound,"receipt_token",{...p,customer:"cus_other"},1000),"PROTOCOL_RECEIPT_CONFLICT");
rejects(()=>m.completeReceipt(active,bound,"receipt_token",other,fence(other),receipt.event,1000),"PROTOCOL_RECEIPT_CONFLICT");
rejects(()=>m.completeReceipt(active,bound,"receipt_token",lease,fence(lease),"evt_other",1000),"PROTOCOL_RECEIPT_CONFLICT");
rejects(()=>m.completeReceipt(active,receipt,"receipt_token",lease,fence(lease),receipt.event,1000),"PROTOCOL_RECEIPT_CONFLICT");
const completed=m.completeReceipt(active,bound,"receipt_token",lease,fence(lease),receipt.event,1000);assert.equal(completed.status,"processed");assert.equal(bound.status,"processing");
rejects(()=>m.bindReceipt(completed,"receipt_token",p,1000),"PROTOCOL_RECEIPT_TERMINAL");
rejects(()=>m.completeReceipt(active,completed,"receipt_token",lease,fence(lease),receipt.event,1000),"PROTOCOL_RECEIPT_TERMINAL");
const legacyComplete=m.completeReceipt(draining,receipt,"receipt_token",legacyLease,fence(legacyLease),receipt.event,1000);assert.equal(legacyComplete.status,"processed");
const ignored=m.completeIgnoredReceipt(active,5,receipt,"receipt_token","unsupported_event",0,1000);assert.equal(ignored.status,"ignored");
rejects(()=>m.completeIgnoredReceipt(active,5,receipt,"receipt_token","unsupported_event",1,1000),"PROTOCOL_RECEIPT_CONFLICT");
rejects(()=>m.completeIgnoredReceipt(active,5,receipt,"receipt_token","arbitrary",0,1000),"PROTOCOL_RECEIPT_CONFLICT");
rejects(()=>m.completeIgnoredReceipt(active,5,ignored,"receipt_token","unsupported_event",0,1000),"PROTOCOL_RECEIPT_TERMINAL");
const unit={run:"run_one",page:"page_one",unit:"unit_one",partition:p,epoch:5,status:"pending"};
const started=m.beginReconciliationUnit(active,unit,lease,fence(lease),1000);assert.equal(started.status,"processing");assert.equal(unit.status,"pending");
rejects(()=>m.beginReconciliationUnit(active,{...unit,partition:{...p,customer:"cus_other"}},lease,fence(lease),1000),"PROTOCOL_PARTITION_MISMATCH");
rejects(()=>m.beginReconciliationUnit(active,{...unit,epoch:4},lease,fence(lease),1000),"PROTOCOL_EPOCH_STALE");
rejects(()=>m.beginReconciliationUnit(active,{...unit,run:"x".repeat(129)},lease,fence(lease),1000),"PROTOCOL_WORK_CONFLICT");
const rollbackDrain=m.transitionProtocol(active,5,"draining_to_legacy",empty);
rejects(()=>m.assertClaimEligible(rollbackDrain,c),"PROTOCOL_CLAIM_BLOCKED");
m.assertFence(rollbackDrain,lease,fence(lease),1000);
const finished=m.finishReconciliationUnit(rollbackDrain,started,lease,fence(lease),"completed",1000);assert.equal(finished.status,"completed");
rejects(()=>m.finishReconciliationUnit(rollbackDrain,finished,lease,fence(lease),"completed",1000),"PROTOCOL_WORK_CONFLICT");
const retryable=m.finishReconciliationUnit(active,started,lease,fence(lease),"retryable",1000);assert.equal(m.beginReconciliationUnit(active,retryable,lease,fence(lease),1000).status,"processing");
rejects(()=>m.finishReconciliationUnit(active,started,other,fence(other),"completed",1000),"PROTOCOL_WORK_CONFLICT");
for(const key of ["activeCustomerLeases","incompatibleCustomerWork"])
 rejects(()=>m.transitionProtocol(rollbackDrain,5,"legacy",{...empty,[key]:1}),"PROTOCOL_DRAIN_REQUIRED");
const rolled=m.transitionProtocol(rollbackDrain,5,"legacy",empty);assert.equal(rolled.epoch,6);
rejects(()=>m.assertFence(rolled,lease,fence(lease),1000),"PROTOCOL_EPOCH_STALE");
m.assertClaimEligible(rolled,{...legacy,epoch:6});
rejects(()=>m.beginReconciliationUnit(rolled,retryable,lease,fence(lease),1000),"PROTOCOL_EPOCH_STALE");
// No secret identifiers in diagnostics: every rejection contains a closed fixed code.
try{m.assertPartitionOwners(p,[{scope:p.scope,customer:"cus_PRIVATESECRET"}]);}catch(error){assert.doesNotMatch(error.message,/PRIVATE|cus_|acct_/);}
// No runtime imports, changes to existing tracked files, or migration changes.
const sourceFiles=execFileSync("git",["ls-files","src"],{encoding:"utf8"}).trim().split("\n");
const inactiveComposition="src/lib/stripe/finance-customer-validation.ts";
for(const tracked of sourceFiles){
 const source=fs.readFileSync(tracked,"utf8");
 if(tracked===inactiveComposition){
  assert.match(source,/import \{ assertPartitionOwners, type Partition \} from "\.\/finance-partition-protocol"/);
  assert.doesNotMatch(source,/assertClaimEligible|assertFence|transitionProtocol|bindReceipt|completeReceipt|beginReconciliationUnit|finishReconciliationUnit/);
 }else{
  assert.doesNotMatch(source,/finance-partition-protocol/);
  assert.doesNotMatch(source,/finance-customer-validation/);
 }
}
assert.equal(execFileSync("git",["diff","HEAD","--","src",":(exclude)src/lib/stripe/finance-customer-webhook.ts",":(exclude)src/lib/stripe/webhook-observer.ts",":(exclude)src/lib/stripe/finance-contract.ts",":(exclude)src/lib/stripe/lease-acquisition-timing.ts",":(exclude)src/lib/stripe/finance-sync.ts",":(exclude)src/lib/stripe/finance-webhook.ts",":(exclude)src/lib/stripe/finance-store.ts",":(exclude)src/lib/stripe/webhook-consumers.ts",":(exclude)src/lib/stripe/finance-routing-evidence.ts",":(exclude)src/lib/stripe/finance-customer-routing.ts",":(exclude)src/lib/stripe/finance-customer-relationship-adapter.ts",":(exclude)src/lib/stripe/finance-sync.ts",":(exclude)src/lib/stripe/finance-reconciliation.ts","supabase/migrations",':(exclude)src/app/api/stripe/webhook/route.ts',':(exclude)src/middleware.ts',':(exclude)src/lib/stripe/billing-work-recovery.ts',':(exclude)src/lib/stripe/billing-work-runtime.ts',':(exclude)src/lib/stripe/billing-work-store.ts',':(exclude)src/lib/stripe/billing-work-worker.ts'],{encoding:"utf8"}),"");
assert.doesNotMatch(fs.readFileSync(file,"utf8"),/console\.|process\.env|fetch\(|\.rpc\(|setTimeout|Date\.now|performance\./);
console.log("PASS: protocol modes/epochs, exclusive drain transitions, claim eligibility, partition fences, receipt binding/terminality, bounded reconciliation units and rollback; pure and unused (offline).");
