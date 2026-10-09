// Offline only: real acquisition code, synthetic RPCs, monotonic clock and timers.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import {loadFinance} from "./validate-finance-consumer.mjs";
function load(file, deps) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
  }).outputText, {exports, Error, Number, Set, performance, console, Date, AbortController, setTimeout, clearTimeout,
    require: name => {assert.ok(name in deps, `Unexpected import ${name}`); return deps[name];}});
  return exports;
}
const timingModule = load("src/lib/stripe/lease-acquisition-timing.ts", {"server-only": {}});
const {createAcquisitionTiming, boundedLeaseAcquisition, CLAIM_RPC_TIMEOUT_MS,
  ACQUISITION_DEADLINE_MS, ACQUISITION_RESERVE_MS, AcquisitionTimingFailure} = timingModule;
assert.equal(ACQUISITION_DEADLINE_MS, 240000);
assert.equal(ACQUISITION_RESERVE_MS, 120000);
assert.equal(CLAIM_RPC_TIMEOUT_MS, 5000);
function fixture() {
  let now = 100, id = 0;
  const timers = new Map(), logs = [];
  const clock = {now: () => now, setTimer: (work, ms) => {const key = ++id; timers.set(key, {work, at: now + ms}); return key;}, clearTimer: key => timers.delete(key)};
  const timing = createAcquisitionTiming(now, metadata => logs.push(metadata), clock);
  return {timing, logs, timers, advance(ms, fire = true) {now += ms; if (fire) for (const [key, timer] of timers) if (timer.at <= now) {timers.delete(key); timer.work();}}};
}
let f = fixture(), sends = 0;
assert.equal(await boundedLeaseAcquisition(f.timing, "entitlement", async signal => {sends++; assert.equal(signal.aborted, false); return "fresh-token";}), "fresh-token");
assert.equal(sends, 1); assert.equal(f.timers.size, 0); assert.deepEqual(f.logs, []);
// Deterministic busy is unchanged and there is still only ONE attempt.
const busy = Error("BILLING_BUSY");
await assert.rejects(boundedLeaseAcquisition(f.timing, "entitlement", () => {sends++; throw busy;}), error => error === busy);
assert.equal(sends, 2); assert.deepEqual(f.logs, []);
// Timeout sends AbortSignal, is ambiguous, ignores a late successful lease response.
f = fixture(); sends = 0; let signal, settle;
const pending = boundedLeaseAcquisition(f.timing, "finance", s => {sends++; signal = s; return new Promise(resolve => {settle = resolve;});});
const rejected = assert.rejects(pending, error => error instanceof AcquisitionTimingFailure && error.outcome === "timeout_ambiguous");
f.advance(CLAIM_RPC_TIMEOUT_MS); await rejected;
assert.equal(signal.aborted, true); assert.equal(sends, 1); settle("late-token"); await Promise.resolve();
assert.equal(f.logs.length, 1); assert.equal(f.logs[0].outcome, "timeout_ambiguous");
await assert.rejects(boundedLeaseAcquisition(f.timing, "finance", () => {sends++; return Promise.resolve("must-not-send");}), error => error.outcome === "timeout_ambiguous");
assert.equal(sends, 1);
// Native abort is ambiguous, never retried, and exception text never reaches logs.
f = fixture();
await assert.rejects(boundedLeaseAcquisition(f.timing, "entitlement", () => {throw Object.assign(Error("PRIVATE_SECRET_ID_PAYLOAD"), {name: "AbortError"});}), error => error.outcome === "timeout_ambiguous");
assert.equal(JSON.stringify(f.logs).includes("PRIVATE"), false);
// A delayed event loop cannot turn an over-bound response into acquired work.
f = fixture();
await assert.rejects(boundedLeaseAcquisition(f.timing, "finance", async () => {f.advance(5000, false); return "late";}), error => error.outcome === "timeout_ambiguous");
// Budget/headroom failures do not send an RPC. Wall clock is not consulted.
for (const [advance, outcome] of [[115001, "headroom_insufficient"], [240000, "budget_exhausted"]]) {
  f = fixture(); f.advance(advance); sends = 0;
  await assert.rejects(boundedLeaseAcquisition(f.timing, "finance", () => {sends++; return Promise.resolve("bad");}), error => error.outcome === outcome);
  assert.equal(sends, 0); assert.equal(f.logs[0].outcome, outcome);
}
assert.doesNotMatch(fs.readFileSync("src/lib/stripe/lease-acquisition-timing.ts", "utf8"), /Date\.now|new Date/);
// The real entitlement/store integrations bound claim only; callback/commit/release once.
class ApiRouteError extends Error {constructor(status, code, message) {super(message); this.status = status; this.code = code;}}
const observer = load("src/lib/stripe/webhook-observer.ts", {"server-only": {}});
const rel = load("src/lib/stripe/reliability.ts", {"server-only": {}, "./lease-acquisition-timing": timingModule,
  "./webhook-observer": observer, "@/lib/supabase-admin": {}, "@/lib/stripe/config": {}, "@/lib/stripe/app-namespace": {}, "@/lib/api/responses": {ApiRouteError}});
const storeModule = load("src/lib/stripe/finance-store.ts", {"server-only": {}, "./lease-acquisition-timing": timingModule,
  "@/lib/supabase-admin": {}, "./finance-contract": {resources: {}}});
const {sync} = loadFinance();
function rpcDb(mode) {
  const calls = [], aborted = []; let settle;
  const db = {rpc(_name, args) {
    const builder = {abortSignal(s) {builder.signal = s; return builder;}, then(resolve, reject) {
      calls.push(args);
      if (args.p_action !== "claim") {assert.equal(builder.signal, undefined); return Promise.resolve({data: {}}).then(resolve, reject);}
      if (builder.signal) builder.signal.addEventListener("abort", () => aborted.push(true));
      if (mode === "stall") return new Promise(done => {settle = () => done({data: {lease_token: "late", token: "late", revision: "1"}});}).then(resolve, reject);
      if (mode === "busy") return Promise.resolve({error: {message: _name === "billing_foundation_command" ? "BILLING_BUSY" : "FINANCE_BUSY"}}).then(resolve, reject);
      return Promise.resolve({data: {lease_token: "fresh", token: "fresh", revision: "1"}}).then(resolve, reject);
    }};
    return builder;
  }};
  return {db, calls, aborted, finish: () => settle?.()};
}
const user = "11111111-1111-4111-8111-111111111111", scope = "acct_fixture:test";
for (const consumer of ["entitlement", "finance"]) {
  for (const mode of ["success", "busy", "stall", "headroom"]) {
    f = fixture(); if (mode === "headroom") f.advance(116000);
    const mock = rpcDb(mode); let callbacks = 0;
    const r = {db: mock.db, scope, acquisitionTiming: f.timing};
    const store = storeModule.createFinanceStore(mock.db, f.timing);
    const run = consumer === "entitlement"
      ? () => rel.withAccount(r, user, async account => {callbacks++; await rel.command(r, "commit", user, account.lease_token); return account.lease_token;})
      : () => sync.withFinanceLease({store, scope}, async lease => {callbacks++; await store.command("commit", scope, lease.token); return lease.token;});
    if (mode === "success") {
      assert.equal(await run(), "fresh"); assert.equal(callbacks, 1);
      assert.deepEqual(mock.calls.map(x => x.p_action), ["claim", "commit", "release"]);
      assert.equal(mock.calls[1].p_token, "fresh"); assert.deepEqual(f.logs, []);
    } else {
      const reject = assert.rejects(run(), error => mode === "busy"
        ? (error.reason || error.message) === (consumer === "entitlement" ? "BILLING_BUSY" : "FINANCE_BUSY")
        : (error.reason || error.message) === (consumer === "entitlement" ? "BILLING_STORE_UNAVAILABLE" : "FINANCE_STORE_UNAVAILABLE"));
      if (mode === "stall") {await new Promise(setImmediate); f.advance(5000);}
      await reject; mock.finish(); await new Promise(setImmediate);
      assert.equal(callbacks, 0); assert.equal(mock.calls.length, mode === "headroom" ? 0 : 1);
      if (mode === "stall") assert.equal(mock.aborted.length, 1);
    }
  }
  // Untimed callers retain original behaviour and do not attach AbortSignal.
  const mock = rpcDb("success");
  if (consumer === "entitlement") await rel.withAccount({db: mock.db, scope}, user, async () => {});
  else await sync.withFinanceLease({store: storeModule.createFinanceStore(mock.db), scope}, async () => {});
  assert.deepEqual(mock.aborted, []);
}
for (const metadata of f.logs) assert.deepEqual(Object.keys(metadata).sort(), ["consumer", "elapsed_ms", "outcome", "remaining_ms"]);
console.log("Billing lease acquisition timing validation passed (offline; no retries or provider calls).");

const serialized = [];
const loggerExports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/lib/observability/logger.ts", "utf8"), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
}).outputText, {exports: loggerExports, Date, console: {info: line => serialized.push(line)}});
const logFixture = fixture();
const realLogTiming = createAcquisitionTiming(logFixture.timing.startedAt, metadata => loggerExports.logInfo({code: "BILLING_LEASE_ACQUISITION_TIMING", route: "/api/stripe/webhook", metadata}), logFixture.timing.clock);
logFixture.advance(116000);
await assert.rejects(boundedLeaseAcquisition(realLogTiming, "entitlement", () => {throw Error("PRIVATE_TOKEN_ACCOUNT_PAYLOAD");}), error => error.outcome === "headroom_insufficient");
assert.equal(serialized.length, 1);
const safeLog = JSON.parse(serialized[0].replace(/^\[DMI\] /, ""));
assert.equal(safeLog.requestId, null);
assert.deepEqual(Object.keys(safeLog.metadata).sort(), ["consumer", "elapsed_ms", "outcome", "remaining_ms"]);
assert.doesNotMatch(serialized.join(""), /PRIVATE|evt_|acct_|cus_|sub_|user_id|token|payload|details|hint|stack/);
const failingSink = createAcquisitionTiming(100, () => {throw Error("PRIVATE_LOG_ERROR");}, logFixture.timing.clock);
await assert.rejects(boundedLeaseAcquisition(failingSink, "finance", () => Promise.resolve("bad")), error => error.outcome === "headroom_insufficient");
console.log("PASS: safe fixed timing metadata through real logger; no IDs or raw errors; logging failure is harmless.");
