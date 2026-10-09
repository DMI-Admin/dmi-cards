// Offline only: real lease helpers and webhook code, synthetic stores and fake time.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import {randomUUID} from "node:crypto";
import {loadFinance, memoryHarness} from "./validate-finance-consumer.mjs";
const transpile = text => ts.transpileModule(text, {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS}}).outputText;
function load(file, deps) {
 const exports = {};
 vm.runInNewContext(transpile(fs.readFileSync(file, "utf8")), {exports, Error, performance, AbortController, setTimeout, clearTimeout,
  require: name => {assert.ok(name in deps, `Unexpected import ${name}`); return deps[name];}});
 return exports;
}
const timingModule = load("src/lib/stripe/lease-acquisition-timing.ts", {"server-only": {}});
const {createAcquisitionTiming, createLeaseRetryPolicy, acquireLeaseWithRetry, boundedLeaseAcquisition} = timingModule;
function fixture(jitter = 50) {
 let now = 100, id = 0, onWait;
 const timers = new Map(), logs = [], delays = [];
 function advance(ms) {now += ms; for (const [key, timer] of [...timers]) if (timer.at <= now) {timers.delete(key); timer.work();}}
 const clock = {now: () => now, setTimer: (work, ms) => {
  const key = ++id; timers.set(key, {at: now + ms, work});
  if (ms < 5000) {delays.push(ms); queueMicrotask(async () => {if(onWait)await onWait(); advance(ms);});}
  return key;
 }, clearTimer: key => timers.delete(key)};
 const timing = createAcquisitionTiming(now, () => {}, clock);
 const policy = createLeaseRetryPolicy(timing, fields => logs.push(fields), () => jitter);
 return {timing, policy, logs, delays, advance, set onWait(value) {onWait = value;}};
}
// Exercise the reusable retry loop through a bounded RPC each time.
for (const [sequence, attempts, outcome, expectedWait] of [
 [["success"],1,null,0], [["busy","success"],2,"acquired_after_retry",150],
 [["busy","busy","success"],3,"acquired_after_retry",400],
 [["busy","busy","busy"],3,"retry_exhausted",400],
]) {
 const f = fixture(); let calls = 0;
 const busy = Error("FINANCE_BUSY");
 const operation = () => boundedLeaseAcquisition(f.timing, "finance", async () => {const item = sequence[calls++]; if(item === "busy")throw busy; return "fresh";});
 const pending = acquireLeaseWithRetry(f.policy, "finance", operation, error => error instanceof Error && error.message === "FINANCE_BUSY");
 if(outcome === "retry_exhausted")await assert.rejects(pending, error => error === busy); else assert.equal(await pending, "fresh");
 assert.equal(calls, attempts); assert.equal(f.delays.reduce((a,b)=>a+b,0), expectedWait);
 assert.equal(f.logs.length, outcome ? 1 : 0);
 if(outcome)assert.deepEqual({...f.logs[0]}, {consumer:"finance",lease_kind:"scope",attempts_used:attempts,retries_used:attempts-1,deliberate_wait_ms:expectedWait,elapsed_ms:expectedWait,outcome});
}
// Non-busy errors (including spoofed/unknown codes) never qualify for another attempt.
for(const error of [Error("FINANCE_FENCE"),Error("FINANCE_REVISION"),Error("FINANCE_IDENTITY"),Error("FINANCE_STORE_UNAVAILABLE"),Error("P0001"),Error("PRIVATE FINANCE_BUSY"),Object.assign(Error("PRIVATE_NETWORK_PAYLOAD"),{code:"ECONNRESET"})]){
 const f=fixture();let calls=0;
 await assert.rejects(acquireLeaseWithRetry(f.policy,"finance",async()=>{calls++;throw error;}, e=>e instanceof Error&&e.message==="FINANCE_BUSY"),e=>e===error);
 assert.equal(calls,1);assert.equal(f.delays.length,0);assert.equal(f.logs.length,0);
}
// Headroom includes the planned delay before sleep and is rechecked after sleep.
for(const beforeSleep of [true,false]){
 const f=fixture(0),busy=Error("FINANCE_BUSY");let calls=0;
 if(beforeSleep)f.advance(114950);
 else f.onWait=()=>f.advance(116000);
 await assert.rejects(acquireLeaseWithRetry(f.policy,"finance",async()=>{calls++;throw busy;}, e=>e===busy),e=>e===busy);
 assert.equal(calls,1);assert.equal(f.logs[0].outcome,"budget_exhausted");
 assert.equal(f.delays.length,beforeSleep?0:1);
}
// Ambiguous timeout on attempt 1 or 2 stops permanently; late results stay unused.
for(const priorBusy of [false,true]){
 const f=fixture(0);let calls=0,finish;
 const busy=Error("FINANCE_BUSY");
 const pending=acquireLeaseWithRetry(f.policy,"finance",()=>boundedLeaseAcquisition(f.timing,"finance",()=>{
  calls++;if(priorBusy&&calls===1)throw busy;
  return new Promise(resolve=>{finish=resolve;});
 }),e=>e===busy);
 const reject=assert.rejects(pending,e=>e.outcome==="timeout_ambiguous");
 await new Promise(setImmediate);f.advance(5000);await reject;finish("late");await new Promise(setImmediate);
 assert.equal(calls,priorBusy?2:1);assert.equal(f.delays.length,priorBusy?1:0);
 if(priorBusy)assert.equal(f.logs[0].outcome,"non_busy_failure");
 await assert.rejects(acquireLeaseWithRetry(f.policy,"finance",()=>boundedLeaseAcquisition(f.timing,"finance",async()=>{calls++;return "bad";}),e=>e===busy));
 assert.equal(calls,priorBusy?2:1);
}
// A non-busy failure after one busy attempt emits one aggregate record without raw text.
{
 const f=fixture(),busy=Error("FINANCE_BUSY"),raw=Error("PRIVATE_SECRET_ACCOUNT_PAYLOAD");let calls=0;
 await assert.rejects(acquireLeaseWithRetry(f.policy,"finance",async()=>{if(++calls===1)throw busy;throw raw;},e=>e===busy),e=>e===raw);
 assert.equal(calls,2);assert.equal(f.logs.length,1);assert.equal(f.logs[0].outcome,"non_busy_failure");assert.doesNotMatch(JSON.stringify(f.logs),/PRIVATE|SECRET|PAYLOAD/);
}
// Jitter is always clamped, including hooks used by offline tests.
for(const jitter of [-100,999]){
 const f=fixture(jitter);let calls=0;const busy=Error("FINANCE_BUSY");
 await acquireLeaseWithRetry(f.policy,"finance",async()=>{if(++calls<3)throw busy;return "ok";},e=>e===busy);
 assert.equal(f.delays.reduce((a,b)=>a+b,0),jitter<0?300:400);
}
// Real entitlement fixture: atomic leases, event receipts, fencing and current Stripe reads.
const billingSource=fs.readFileSync("scripts/validate-stripe-reliability.mjs","utf8"), billing={};
vm.runInNewContext(transpile(billingSource.split("let f=fixture();")[0]+"\nexports.fixture=fixture;exports.rel=rel;exports.webhook=webhook;exports.advanceClock=ms=>now+=ms;"),{
 exports:billing,Error,performance,AbortController,setTimeout,clearTimeout,Date,URL,Buffer,console,Promise,setImmediate,
 require:name=>({"node:assert/strict":{default:assert},"node:fs":{default:fs},"node:vm":{default:vm},typescript:{default:ts},"node:crypto":{randomUUID}}[name]),
});
const user="11111111-1111-4111-8111-111111111111";
function enableEntitlement(b, f){
 const original=b.r.db.rpc;let claims=0;
 b.r.db.rpc=(...args)=>{if(args[1].p_action==="claim")claims++;const pending=original(...args);pending.abortSignal=()=>pending;return pending;};
 b.r.acquisitionTiming=f.timing;b.r.leaseRetry=f.policy;
 return ()=>claims;
}
// Different events for the same account: only claim repeats; Stripe reads do not.
{
 const b=billing.fixture(),f=fixture(0),claims=enableEntitlement(b,f);
 let finish,reads=0;const original=b.r.stripe.subscriptions.retrieve;
 b.r.stripe.subscriptions.retrieve=async(...args)=>{reads++;if(reads===2)await new Promise(resolve=>{finish=resolve;});return original(...args);};
 const event=(id,created)=>({id,created,type:"customer.subscription.updated",livemode:false,data:{object:b.sub}});
 const first=billing.webhook.handleStripeWebhookEvent(event("evt_first",100),b.r);
 await new Promise(setImmediate);
 // Same event receipt contention must not enter an account retry loop.
 await assert.rejects(billing.webhook.handleStripeWebhookEvent(event("evt_first",100),b.r),/BILLING_BUSY/);
 assert.equal(claims(),1);assert.equal(f.delays.length,0);
 f.onWait=async()=>{finish();await first;};
 await billing.webhook.handleStripeWebhookEvent(event("evt_second",101),b.r);
 assert.equal(claims(),3);assert.equal(reads,4);assert.equal(f.logs.length,1);
 assert.equal(b.events.get("evt_first").state,"processed");assert.equal(b.events.get("evt_second").state,"processed");
 const saved=b.mirrors[0].revision, readsBefore=reads;
 assert.equal((await billing.webhook.handleStripeWebhookEvent(event("evt_second",101),b.r)).reason,"duplicate_event");
 assert.equal(b.mirrors[0].revision,saved);assert.equal(reads,readsBefore);
 b.sub.status="canceled";
 await billing.webhook.handleStripeWebhookEvent({...event("evt_terminal",102),type:"customer.subscription.deleted"},b.r);
 b.sub.status="active";
 assert.equal((await billing.webhook.handleStripeWebhookEvent(event("evt_late",103),b.r)).reason,"terminal_ignored");
 assert.equal(b.mirrors[0].sync_snapshot.status,"canceled");
}
// Lease held by a crashed worker: exhaustion does not run callbacks or release its token.
{
 const b=billing.fixture(),f=fixture(),claims=enableEntitlement(b,f);
 const lease=await billing.rel.command(b.r,"claim",user,null);let callbacks=0;
 await assert.rejects(billing.rel.withAccount(b.r,user,async()=>{callbacks++;}),/BILLING_BUSY/);
 assert.equal(claims(),4);assert.equal(callbacks,0);assert.equal(b.accounts.get(user).lease_token,lease.lease_token);
 // Expiry produces a fresh fencing token; an old worker cannot bind with its token.
 billing.advanceClock(90001);
 await billing.rel.withAccount(b.r,user,async account=>{
  assert.notEqual(account.lease_token,lease.lease_token);
  await assert.rejects(billing.rel.command(b.r,"bind",user,lease.lease_token,{customer:"cus_owned"}),/BILLING_FENCE/);
 });
}
// Real Finance scope lease helper: two customer workloads share one scope lease.
const {sync,storeModule}=loadFinance();
{
 const f=fixture(0),h=memoryHarness("acct_fixture:test",()=>new storeModule.FinanceLeaseBusyFailure());let finish,firstToken,callbacks=0,commits=0,releases=0,claims=0;
 const original=h.store.command;h.store.command=async(...args)=>{if(args[0]==="claim")claims++;if(args[0]==="commit")commits++;if(args[0]==="release")releases++;return original(...args);};
 const r={scope:"acct_fixture:test",store:h.store,leaseRetry:f.policy};
 const first=sync.withFinanceLease(r,async lease=>{firstToken=lease.token;callbacks++;await new Promise(resolve=>{finish=resolve;});await r.store.command("commit",r.scope,lease.token,{expected_scope_revision:lease.revision});});
 await new Promise(setImmediate);f.onWait=async()=>{finish();await first;};
 await sync.withFinanceLease({...r},async lease=>{callbacks++;await assert.rejects(original("commit",r.scope,firstToken,{expected_scope_revision:lease.revision}),/FINANCE_FENCE/);await r.store.command("commit",r.scope,lease.token,{expected_scope_revision:lease.revision});});
 assert.equal(claims,3);assert.equal(callbacks,2);assert.equal(commits,2);assert.equal(releases,2);assert.equal(f.logs.length,1);
}
// Integration: bounded real Finance store + retry helper; commit/release never repeat.
function syntheticDb(sequence){
 let index=0;const calls=[];let finish;
 return {calls,finish:()=>finish?.(),db:{rpc(_name,args){
  const builder={abortSignal(signal){builder.signal=signal;return builder;},then(resolve,reject){
   calls.push(args);
   if(args.p_action!=="claim"){assert.equal(builder.signal,undefined);return Promise.resolve({data:{}}).then(resolve,reject);}
   const result=sequence[index++];
   if(result==="stall")return new Promise(done=>{finish=()=>done({data:{token:"late",revision:"1"}});}).then(resolve,reject);
   return Promise.resolve(result==="busy"?{error:{message:"FINANCE_BUSY"}}:result==="failure"?{error:{message:"PRIVATE_STORE_ERROR",code:"P0001"}}:{data:{token:"fresh",revision:"1"}}).then(resolve,reject);
  }};return builder;
 }}};
}
for(const sequence of [["success"],["busy","success"],["busy","busy","success"],["busy","busy","busy"],["failure"],["busy","failure"],["stall"],["busy","stall"]]){
 const f=fixture(0),db=syntheticDb(sequence);let callbacks=0;
 const r={store:storeModule.createFinanceStore(db.db,f.timing),scope:"acct_fixture:test",leaseRetry:f.policy};
 const pending=sync.withFinanceLease(r,async lease=>{callbacks++;await r.store.command("commit",r.scope,lease.token,{expected_scope_revision:lease.revision});});
 if(sequence.at(-1)==="success"){
  await pending;assert.equal(callbacks,1);assert.equal(db.calls.filter(x=>x.p_action==="commit").length,1);assert.equal(db.calls.filter(x=>x.p_action==="release").length,1);
 }else{
  const reject=assert.rejects(pending);if(sequence.includes("stall")){await new Promise(setImmediate);f.advance(5000);}await reject;db.finish();await new Promise(setImmediate);
  assert.equal(callbacks,0);assert.equal(db.calls.filter(x=>x.p_action!=="claim").length,0);
 }
 assert.equal(db.calls.filter(x=>x.p_action==="claim").length,sequence.length);
}
// Without opt-in, busy is returned once. Timing alone cannot activate retry.
{
 const b=billing.fixture(),f=fixture(),claims=enableEntitlement(b,f);delete b.r.leaseRetry;
 await billing.rel.command(b.r,"claim",user,null);
 await assert.rejects(billing.rel.withAccount(b.r,user,async()=>{throw Error("must not run");}),/BILLING_BUSY/);
 assert.equal(claims(),2);assert.equal(f.delays.length,0);
 const db=syntheticDb(["busy"]);
 await assert.rejects(sync.withFinanceLease({store:storeModule.createFinanceStore(db.db,f.timing),scope:"acct_fixture:test"},async()=>{}),/FINANCE_BUSY/);
 assert.equal(db.calls.length,1);
}
console.log("PASS: bounded acquisition retry, jitter/headroom, ambiguity/non-busy isolation, concurrency/receipts/fencing, single callbacks/commits/releases, no extra Stripe reads and explicit opt-in (offline).");

// Commit failure is outside acquisition retry; one callback, one commit, one release.
for(const consumer of ["entitlement","finance"]){
 const f=fixture(0);let claims=0,callbacks=0,commits=0,releases=0;
 const failure=Error("PRIVATE_COMMIT_FAILURE");
 if(consumer==="entitlement"){
  const b=billing.fixture();enableEntitlement(b,f);const original=b.r.db.rpc;
  b.r.db.rpc=(name,args)=>{if(args.p_action==="claim")claims++;if(args.p_action==="commit"){commits++;throw failure;}if(args.p_action==="release")releases++;return original(name,args);};
  await assert.rejects(billing.rel.withAccount(b.r,user,async account=>{callbacks++;await billing.rel.command(b.r,"commit",user,account.lease_token);}),e=>e===failure);
 }else{
  const store={command:async(action)=>{if(action==="claim"){claims++;return {token:"fresh",revision:"1"};}if(action==="commit"){commits++;throw failure;}if(action==="release")releases++;}};
  await assert.rejects(sync.withFinanceLease({scope:"acct_fixture:test",store,leaseRetry:f.policy},async lease=>{callbacks++;await store.command("commit","acct_fixture:test",lease.token);}),e=>e===failure);
 }
 assert.equal(claims,1);assert.equal(callbacks,1);assert.equal(commits,1);assert.equal(releases,1);assert.deepEqual(f.logs,[]);
}
// One safe aggregate event through the real logger; no identifiers or exceptions.
{
 const logs=[],exports={};
 vm.runInNewContext(transpile(fs.readFileSync("src/lib/observability/logger.ts","utf8")),{exports,Date,console:{info:line=>logs.push(line)}});
 const f=fixture(50);const policy=createLeaseRetryPolicy(f.timing,metadata=>exports.logInfo({code:"BILLING_LEASE_ACQUISITION_RETRY",route:"/api/stripe/webhook",metadata}),()=>50);
 let calls=0;const busy=Error("FINANCE_BUSY");
 await acquireLeaseWithRetry(policy,"finance",async()=>{if(++calls<3)throw busy;return "PRIVATE_LEASE_TOKEN";},e=>e===busy);
 assert.equal(logs.length,1);const log=JSON.parse(logs[0].replace(/^\[DMI\] /,""));assert.equal(log.requestId,null);
 assert.deepEqual(Object.keys(log.metadata).sort(),["consumer","lease_kind","attempts_used","retries_used","deliberate_wait_ms","elapsed_ms","outcome"].sort());
 assert.doesNotMatch(logs.join(""),/PRIVATE|evt_|acct_|cus_|sub_|user_id|payload|details|hint|stack/);
 const noLogs=createLeaseRetryPolicy(f.timing,()=>{throw Error("PRIVATE_LOG_ERROR");},()=>0);let tries=0;
 assert.equal(await acquireLeaseWithRetry(noLogs,"entitlement",async()=>{if(++tries===1)throw busy;return "ok";},e=>e===busy),"ok");
}
console.log("PASS: terminal cancellation preserved; commit failures are not retried; safe aggregate retry metadata and harmless logging failures.");

// A transport exception with busy-looking text is not a definitive database response.
{
 const f=fixture();let calls=0;
 const raw=Error("FINANCE_BUSY");
 const db={rpc(){return {abortSignal(){return this;},then(_resolve,reject){calls++;return Promise.reject(raw).then(undefined,reject);}};}};
 await assert.rejects(sync.withFinanceLease({scope:"acct_fixture:test",store:storeModule.createFinanceStore(db,f.timing),leaseRetry:f.policy},async()=>{throw Error("must-not-run");}),error=>error===raw);
 assert.equal(calls,1);assert.equal(f.delays.length,0);
}
console.log("PASS: Finance retries require a received normalized busy response; busy-looking transport exceptions are not retried.");

// Real entitlement normalized busy responses: third attempt wins, callback/release once.
{
 const b=billing.fixture(),f=fixture(50);enableEntitlement(b,f);const original=b.r.db.rpc;
 let claims=0,callbacks=0,releases=0;
 b.r.db.rpc=(name,args)=>{
  if(args.p_action==="release")releases++;
  if(args.p_action==="claim"&&++claims<3){const pending=Promise.resolve({error:{message:"BILLING_BUSY",code:"P0001"}});pending.abortSignal=()=>pending;return pending;}
  return original(name,args);
 };
 await billing.rel.withAccount(b.r,user,async account=>{callbacks++;await billing.rel.command(b.r,"bind",user,account.lease_token,{customer:"cus_owned"});});
 assert.equal(claims,3);assert.equal(callbacks,1);assert.equal(releases,1);assert.equal(b.retrieves,0);
 assert.equal(f.logs.length,1);assert.equal(f.logs[0].lease_kind,"account");assert.equal(f.logs[0].deliberate_wait_ms,400);
}
console.log("PASS: entitlement third-attempt acquisition and Finance stale-token rejection with single processing/release.");
