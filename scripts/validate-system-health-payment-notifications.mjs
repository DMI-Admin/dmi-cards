import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import ts from "typescript";
import { execFileSync } from "node:child_process";

// All environment/configuration and ledger data below are synthetic. No server or real credentials.
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const record = { exports: {} }; cache.set(file, record.exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports: record.exports, module: record,
    require(name) {
      if (name === "server-only") return {};
      assert.ok(name.startsWith("."), `Unexpected runtime dependency ${name}`);
      return load(path.resolve(path.dirname(file), name + ".ts"));
    },
    Date, AbortController, setTimeout, clearTimeout, performance, TextEncoder,
    process: { env: {} }, fetch: () => { throw Error("No provider or network allowed"); },
  });
  return record.exports;
}
const probeFile = path.resolve("src/lib/system-health/payment-notification-probe.ts");
const probe = load(probeFile);
const core = load(path.resolve("src/lib/system-health/monitoring-core.ts"));
const owner = load(path.resolve("src/lib/system-health/owner-presentation.ts"));
const presentation = load(path.resolve("src/lib/system-health/presentation.ts"));
const now = Date.parse("2026-10-08T12:00:00Z"), scope = "acct_fixture:test";
const grace = probe.PAYMENT_NOTIFICATION_GRACE_MS;
assert.equal(grace, 600_000); assert.equal(probe.PAYMENT_NOTIFICATION_SAMPLE_LIMIT, 20);
const row = (state = "processed", age = 60_000) => ({
  stripe_scope: scope, state, created_at: new Date(now - age).toISOString(),
  processed_at: state === "processed" ? new Date(now - Math.min(age, 30_000)).toISOString() : null,
  stripe_event_id: "evt_SYNTHETIC_PRIVATE", subject_id: "cus_SYNTHETIC_PRIVATE",
  payload: "SYNTHETIC_PRIVATE_PAYLOAD", last_error_code: "SYNTHETIC_PRIVATE_ERROR", lease_token: "SYNTHETIC_PRIVATE_TOKEN",
});
function database(rows = [], options = {}) {
  const calls = [];
  const db = { from(table) {
    assert.equal(table, "stripe_webhook_events");
    const call = { table, filters: [] }; calls.push(call);
    const q = {
      select(columns) { assert.equal(columns, "state,created_at,processed_at"); call.columns = columns; return q; },
      eq(key, value) { assert.equal(key, "stripe_scope"); assert.equal(value, scope); call.filters.push(r => r[key] === value); return q; },
      gte(key, value) { assert.equal(key, "created_at"); assert.equal(value, new Date(now - 86_400_000).toISOString()); call.filters.push(r => r[key] >= value); call.recent = true; return q; },
      neq(key, value) { assert.equal(key, "state"); assert.equal(value, "processed"); call.filters.push(r => r[key] !== value); call.unresolved = true; return q; },
      order(key, { ascending }) { assert.equal(key, "created_at"); call.ascending = ascending; return q; },
      limit(value) { assert.equal(value, 20); call.limit = value; return q; },
      abortSignal(signal) { call.signal = signal; return q; },
      retry(value) { assert.equal(value, false); call.retry = value; return q; },
      then(resolve, reject) {
        assert.equal(call.retry, false); assert.equal(call.limit, 20); assert.ok(call.signal instanceof AbortSignal);
        if (options.throwError) return Promise.reject(Error("SYNTHETIC_PRIVATE_EXCEPTION")).then(resolve, reject);
        if (options.stall) return new Promise((_, fail) => call.signal.addEventListener("abort", () => fail(Error("SYNTHETIC_PRIVATE_ABORT")), { once: true })).then(resolve, reject);
        let selected = rows.filter(r => call.filters.every(f => f(r))).sort((a,b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0) * (call.ascending ? 1 : -1)).slice(0, call.limit);
        if (options.oversized) selected = Array.from({ length: 21 }, () => row());
        // Ensure unsafe fields cannot be relied on: actual query projection removes them.
        const data = selected.map(r => Object.fromEntries(call.columns.split(",").map(k => [k,r[k]])));
        return Promise.resolve({ data: options.nullData ? null : data, error: options.queryError ? { message: "SYNTHETIC_PRIVATE_DB_ERROR" } : null }).then(resolve, reject);
      },
    };
    return q;
  } };
  return { db, calls };
}
async function run(rows, options = {}, inputScope = scope) {
  const harness = database(rows, options), controller = new AbortController();
  const observation = await probe.checkPaymentNotifications(harness.db, inputScope, controller.signal, now);
  assert.equal(harness.calls.length, 2);
  assert.ok(harness.calls[0].recent && harness.calls[1].unresolved);
  assert.equal(observation.status === "incident", false);
  const sanitized = core.sanitizeEvidence(observation.evidence);
  assert.deepEqual(JSON.parse(JSON.stringify(sanitized)), JSON.parse(JSON.stringify(observation.evidence)));
  assert.doesNotMatch(JSON.stringify(observation), /SYNTHETIC_PRIVATE|acct_fixture|evt_|cus_|payload|lease_token|last_error/);
  assert.deepEqual(Object.keys(observation.evidence).sort(), ["sampled_rows","failed_count","overdue_count","sample_limit_reached","query_bounded"].sort());
  const check = { serviceKey: "stripe_webhook_processing", checkKey: "operational_evidence", storedStatus: observation.status,
    severity: observation.severity, reasonCode: observation.reasonCode, safeSummary: observation.safeSummary, evidence: observation.evidence,
    checkedAt: new Date(now).toISOString(), verifiedAt: observation.verified ? new Date(now).toISOString() : null };
  assert.notEqual(owner.ownerState(check), "critical");
  return { observation, check, calls: harness.calls };
}
for (const rows of [[], [row()], [row("processed", 86_400_001)], [row("received")], [row("processing", grace)], [row("processed"), { ...row("failed"), stripe_scope: "acct_other:test" }, { ...row("failed"), stripe_scope: "acct_fixture:live" }]]) {
  const { observation, check } = await run(rows);
  assert.equal(observation.status, "operational"); assert.equal(owner.ownerState(check), "working");
  assert.equal(observation.safeSummary, "Recent Stripe webhook processing records show no failed or overdue processing in the bounded sample.");
  assert.equal(owner.ownerCheck(check).explanation, observation.safeSummary);
}
// Ignored/terminal events are ledger state=processed, not invented processing states.
assert.equal((await run([{ ...row(), outcome: "ignored" }, { ...row(), outcome: "terminal" }])).observation.status, "operational");
for (const rows of [[row("failed")], [row("failed"), row("failed")], [row("received", grace + 1)], [row("processing", 86_400_001)]]) {
  const { observation, check } = await run(rows);
  assert.equal(observation.status, "degraded"); assert.equal(observation.reasonCode, "payment_notification_processing_problem");
  assert.equal(owner.ownerState(check), "attention");
}
assert.equal((await run([row("failed"), row("failed")])).observation.evidence.failed_count, 2, "Overlapping samples do not double-count");
assert.equal((await run([row("processing", grace + 1)])).observation.evidence.overdue_count, 1);
const saturation = await run(Array.from({ length: 20 }, () => row()));
assert.equal(saturation.observation.status, "unknown"); assert.equal(saturation.observation.reasonCode, "payment_notification_sample_incomplete");
assert.equal(saturation.observation.evidence.sample_limit_reached, true); assert.equal(owner.ownerState(saturation.check), "unknown");
assert.match(owner.ownerCheck(saturation.check).explanation, /Monitoring evidence is incomplete; no service failure is established/);
assert.match(presentation.getFixGuidance(saturation.check).recommendedNextStep, /does not establish a service failure/);
assert.equal((await run(Array.from({ length: 20 }, () => row("failed")))).observation.status, "degraded", "Observed problems remain actionable even when saturated");
assert.equal((await run(Array.from({ length: 20 }, () => row("processing", grace)))).observation.status, "unknown", "Unresolved sample saturation is non-green");
for (const inputScope of [undefined, "", "acct_fixture:live", "acct_fixture:test,acct_other:test", "acct_fixture:test "]) {
  const h = database(); await assert.rejects(probe.checkPaymentNotifications(h.db, inputScope, new AbortController().signal, now), /SCOPE_OR_CLOCK_INVALID/);
  assert.equal(h.calls.length, 0);
}
for (const rows of [[{ ...row(), created_at: "invalid" }], [{ ...row("processing"), created_at: "2026-02-30T12:00:00Z" }], [{ ...row(), state: "unknown" }], [{ ...row(), processed_at: null }], [{ ...row("received"), processed_at: new Date(now).toISOString() }], [row("processing", -1)], [{ ...row(), processed_at: "invalid" }]]) {
  await assert.rejects(run(rows), /ROWS_INVALID/);
}
for (const options of [{ queryError:true }, { nullData:true }, { oversized:true }, { throwError:true }]) {
  const h = database([], options);
  const results = await core.executeChecks([{ serviceKey: "stripe_webhook_processing", checkKey: "operational_evidence", run: signal => probe.checkPaymentNotifications(h.db, scope, signal, now) }]);
  assert.equal(results[0].reasonCode, "check_failed"); assert.equal(results[0].status, "unknown");
  assert.equal(results[0].verifiedAt, null); assert.doesNotMatch(JSON.stringify(results), /SYNTHETIC_PRIVATE/);
}
const h = database([], { stall:true });
const timed = await core.executeChecks([{ serviceKey: "stripe_webhook_processing", checkKey: "operational_evidence", run: signal => probe.checkPaymentNotifications(h.db, scope, signal, now) }], 10);
assert.equal(timed[0].reasonCode, "check_timed_out"); assert.equal(timed[0].status, "unknown"); assert.ok(h.calls.every(c => c.signal.aborted));
const aborted = new AbortController(); aborted.abort(); await assert.rejects(probe.checkPaymentNotifications(database().db, scope, aborted.signal, now), /READ_FAILED/);
assert.deepEqual(JSON.parse(JSON.stringify(core.sanitizeEvidence({ sampled_rows:-1,failed_count:21,overdue_count:1.5,sample_limit_reached:"yes",payload:"SYNTHETIC_PRIVATE" }))), {});
const source = fs.readFileSync(probeFile,"utf8");
assert.doesNotMatch(source, /from\("(?:billing_|cards|customers|accounts)|\.(?:insert|update|delete|upsert|rpc|range)\(|fetch\(|console\.|process\.env|resolveStripeAccountScope|billingRuntime|reconcile|lease_until/);
assert.equal((source.match(/database.from\("stripe_webhook_events"\)/g) || []).length, 2);
assert.equal((source.match(/\.retry\(false\)/g) || []).length, 2);
const runner = fs.readFileSync("src/lib/system-health/monitoring.ts","utf8");
assert.match(runner, /createMonitoringDatabaseClient\(signal\), process\.env\.STRIPE_ACCOUNT_SCOPE, signal/);
// Prove the other 15 definitions, runner persistence/retention and timeout infrastructure were not changed.
const baseline = file => execFileSync('git', ['show', `bb60aa38230322afa2163dbb4b54df41d2d0c70a:${file}`], { encoding:'utf8' });
const oldRunner = runner.replace('import { checkPaymentNotifications } from "./payment-notification-probe";\n\n', '')
 .replace('run: (signal) => checkPaymentNotifications(\n      createMonitoringDatabaseClient(signal), process.env.STRIPE_ACCOUNT_SCOPE, signal\n    ),', 'run: async () => unknown("No bounded service-level webhook health signal is available."),');
assert.equal(oldRunner, baseline('src/lib/system-health/monitoring.ts'));
for (const file of ['src/app/system-health/page.tsx','src/app/system-health/system-health.module.css','src/app/api/internal/system-health-monitor/route.ts','src/app/api/admin/system-health/route.ts','src/app/api/admin/system-health/analysis/route.ts','src/lib/system-health/analysis-provider.ts','src/lib/system-health/analysis-server.ts','src/lib/system-health/analysis-contract.ts','src/lib/system-health/analysis-types.ts','src/lib/system-health/investigation-prompt.ts','.github/workflows/staging-system-health-monitor.yml','vercel.json']) {
 assert.equal(fs.readFileSync(file,'utf8'),baseline(file), `${file} remains unchanged`);
}
// New safe evidence must remain compatible with the existing diagnostic/AI and Codex contracts.
const contract = load(path.resolve('src/lib/system-health/analysis-contract.ts'));
const handoff = load(path.resolve('src/lib/system-health/investigation-prompt.ts'));
for (const rows of [[], [row('failed')], Array.from({ length:20 },()=>row())]) {
 const { check } = await run(rows);
 const snapshot = { environment:'staging', runId:'00000000-0000-4000-8000-000000000001', generatedAt:new Date(now).toISOString(), checks:[check] };
 const input = contract.buildAnalysisInput(presentation.buildDiagnosticReport(snapshot));
 assert.equal(input.checks[0].stored_status,check.storedStatus);
 assert.equal(input.checks[0].evidence.sampled_rows,check.evidence.sampled_rows);
 const prepared = handoff.prepareSystemHealthInvestigation(snapshot);
 assert.equal(prepared.kind,check.storedStatus==='degraded'?'ready':'none');
 if(prepared.kind==='ready')assert.doesNotMatch(prepared.investigation.prompt,/SYNTHETIC_PRIVATE|evt_|cus_|payload|lease_token/);
}
console.log("PASS: isolated test scope, two bounded non-retrying ledger reads, processed/ignored/terminal and in-flight states, 10-minute boundary/overdue/failures, saturation, malformed/query/timeout/abort failures, aggregate-only evidence, no PII/mutations/provider calls and no Critical classification.");
