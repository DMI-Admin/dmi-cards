import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import ts from "typescript";

const root = process.cwd();
const read = async (path) => readFile(resolve(root, path), "utf8");
const [coreSource, runner, route, migration, vercel, workflow, v1Validator, types] = await Promise.all([
  read("src/lib/system-health/monitoring-core.ts"),
  read("src/lib/system-health/monitoring.ts"),
  read("src/app/api/internal/system-health-monitor/route.ts"),
  read("supabase/migrations/20261006130000_system_health_check_runs.sql"),
  read("vercel.json"),
  read(".github/workflows/staging-system-health-monitor.yml"),
  read("scripts/validate-system-health.mjs"),
  read("src/lib/system-health/types.ts"),
]);

const compiledCore = ts.transpileModule(coreSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const core = await import(`data:text/javascript;base64,${Buffer.from(compiledCore).toString("base64")}`);

assert.deepEqual(core.monitorStatuses, [
  "operational", "degraded", "incident", "unknown", "not_configured", "not_migrated",
]);
assert.deepEqual(core.monitorSeverities, ["none", "info", "warning", "critical"]);

const unsafeEvidence = core.sanitizeEvidence({
  returned_rows: 1,
  email: "person@example.com",
  customer_id: "customer-id",
  token: "secret-token",
  api_key: "secret-key",
  cookie: "session-cookie",
  contact: "personal data",
  reason: "unrestricted text",
});
assert.deepEqual(unsafeEvidence, { returned_rows: 1 });

let continuedAfterFailure = false;
const independentResults = await core.executeChecks([
  { serviceKey: "one", checkKey: "failure", run: async () => { throw new Error("sensitive error"); } },
  { serviceKey: "two", checkKey: "success", run: async () => {
    continuedAfterFailure = true;
    return {
      status: "operational", severity: "none", verified: true,
      reasonCode: null, safeSummary: "Bounded test check succeeded.", evidence: { query_bounded: true },
    };
  } },
]);
assert.equal(continuedAfterFailure, true);
assert.equal(independentResults[0].status, "unknown");
assert.equal(independentResults[0].reasonCode, "check_failed");
assert.equal(independentResults[1].status, "operational");
assert.equal(independentResults[0].evidence.query_bounded, undefined);
assert.ok(core.CHECK_TIMEOUT_MS > 0 && core.CHECK_TIMEOUT_MS <= 10_000);
assert.match(coreSource, /Promise\.all\(definitions\.map/);
assert.match(coreSource, /new CheckTimeoutError/);
assert.match(coreSource, /setTimeout\(\(\) => \{/);

let timedOutCheckFinished = false;
let timedOutCheckAborted = false;
const timeoutResults = await core.executeChecks([
  { serviceKey: "slow", checkKey: "bounded", run: async (signal) => {
    signal.addEventListener("abort", () => { timedOutCheckAborted = true; }, { once: true });
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 40));
    timedOutCheckFinished = true;
    return {
      status: "operational", severity: "none", verified: true,
      reasonCode: null, safeSummary: "Late check.",
    };
  } },
], 5);
assert.equal(timeoutResults[0].status, "unknown");
assert.equal(timeoutResults[0].reasonCode, "check_timed_out");
assert.equal(timedOutCheckAborted, true);
await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
assert.equal(timedOutCheckFinished, true);

const runId = "11111111-1111-4111-8111-111111111111";
const groupedRows = independentResults.map((result) => ({ run_id: runId, ...result }));
assert.ok(groupedRows.every((row) => row.run_id === runId));
assert.match(migration, /UNIQUE \(run_id, service_key, check_key\)/);
assert.match(migration, /environment, service_key, checked_at DESC/);
assert.match(migration, /environment, checked_at DESC/);
assert.match(migration, /checked_at < p_cutoff/);
assert.match(migration, /ORDER BY checked_at ASC, id ASC\s+LIMIT p_batch_size/);
assert.match(migration, /p_batch_size > 500/);
assert.match(runner, /RETENTION_MAX_BATCHES/);
assert.match(runner, /RETENTION_DAYS/);
assert.match(runner, /p_environment: environment/);
assert.match(runner, /p_cutoff: cutoff/);
assert.match(runner, /p_batch_size: RETENTION_BATCH_SIZE/);

const listedServiceKeys = [...runner.matchAll(/serviceKey: "([^"]+)"/g)].map((match) => match[1]);
assert.equal(new Set(listedServiceKeys).size, listedServiceKeys.length, "checks must use unique service keys");
assert.ok(listedServiceKeys.every((key) => !/customer_id|card_id|user_id/i.test(key)));
assert.match(runner, /serviceKey: "email_automations"[\s\S]*?status: "not_migrated"/);
assert.match(runner, /This is a known staging-parity gap, not a service incident\./);
for (const service of [
  "billing_reconciliation", "entitlement_processing",
  "public_lead_capture", "media_storage", "customer_authentication", "external_integrations",
]) {
  assert.match(runner, new RegExp(`serviceKey: "${service}"[\\s\\S]*?run: async \\(\\) => unknown\\(`));
}
assert.match(runner, /serviceKey: "stripe_webhook_processing"[\s\S]*?checkPaymentNotifications\(/);
assert.match(runner, /createMonitoringDatabaseClient\(signal\), process\.env\.STRIPE_ACCOUNT_SCOPE, signal/);
assert.match(runner, /status: "unknown"/);
assert.doesNotMatch(runner, /status:\s*"incident"/);
assert.match(coreSource, /case "unknown":[\s\S]*?counts\.unknown\+\+/);
assert.match(coreSource, /case "not_configured":[\s\S]*?counts\.notConfigured\+\+/);
assert.match(coreSource, /case "not_migrated":[\s\S]*?counts\.notMigrated\+\+/);
assert.doesNotMatch(runner, /from\("contacts"\)[\s\S]{0,100}\.insert/);
assert.doesNotMatch(runner, /from\("cards"\)[\s\S]{0,100}\.insert/);
assert.doesNotMatch(runner, /stripe_event_id|customer_id|card_id|user_id/);
assert.match(runner, /\.from\(table\)[\s\S]*?\.select\("id"\)[\s\S]*?\.limit\(1\)/);
assert.match(runner, /AbortSignal\.timeout\(1_500\)/);
assert.match(runner, /AbortSignal\.timeout\(2_500\)/);
assert.match(runner, /validateAppleWalletConfig/);
assert.match(runner, /checkGoogleWalletReadOnlyHealth/);
assert.match(runner, /checkGoogleWalletReadOnlyHealth\(signal\)/);
assert.match(runner, /AbortSignal\.any\(\[signal, AbortSignal\.timeout\(1_500\)\]\)/);
assert.match(coreSource, /controller\.abort\(\)/);
assert.match(runner, /\/ping/);

assert.match(route, /process\.env\.CRON_SECRET/);
assert.match(route, /timingSafeEqual/);
assert.match(route, /VERCEL_ENV === "production"/);
assert.match(route, /process\.env\.VERCEL_ENV !== "preview"/);
assert.match(route, /NEXT_PUBLIC_SUPABASE_URL\?\.trim\(\) !== stagingSupabaseUrl/);
assert.match(route, /uohdkewufeivdpaljnng\.supabase\.co/);
assert.match(route, /runSystemHealthMonitoring\(\)/);
assert.match(route, /runId: result\.runId/);
assert.match(route, /retentionDeleted: result\.retentionDeleted/);
assert.doesNotMatch(route, /serviceKey|safeSummary|evidence|customer|email|token/i);
assert.doesNotMatch(route, /auth\(\)|requireAdminAccess/);

const cronConfig = JSON.parse(vercel);
assert.ok(cronConfig.crons.some((cron) =>
  cron.path === "/api/internal/card-media-cleanup" && cron.schedule === "*/15 * * * *"
));
assert.ok(cronConfig.crons.every((cron) => cron.path !== "/api/internal/system-health-monitor"));
assert.match(workflow, /schedule:\s*\n\s+- cron:\s*"\*\/5 \* \* \* \*"/);
assert.match(workflow, /workflow_dispatch:/);
assert.match(workflow, /https:\/\/staging\.dmicards\.com\/api\/internal\/system-health-monitor/);
assert.doesNotMatch(workflow, /https:\/\/(?!staging\.dmicards\.com)/);
assert.match(workflow, /secrets\.DMI_STAGING_CRON_SECRET/);
assert.doesNotMatch(workflow, /CRON_SECRET\s*[:=]\s*["'][^$]/);
assert.match(workflow, /concurrency:/);
assert.match(workflow, /timeout-minutes:\s*2/);
assert.match(workflow, /--connect-timeout 10/);
assert.match(workflow, /--max-time 45/);
assert.match(workflow, /--fail/);
assert.match(workflow, /http_status < 200 \|\| http_status >= 300/);
assert.doesNotMatch(workflow, /--verbose|-v\s/);
assert.match(workflow, /jq -e/);
assert.match(workflow, /workflow failures are not owner alerts/);
assert.ok(core.summarizeCheckResults([
  { status: "unknown" },
  { status: "not_configured" },
  { status: "not_migrated" },
]).incident === 0);
assert.equal(core.summarizeCheckResults([{ status: "degraded" }]).degraded, 1);
assert.equal(core.summarizeCheckResults([{ status: "incident" }]).incident, 1);
assert.match(types, /"incident"/);
assert.match(v1Validator, /Email Automations|email_automations/);

console.log("System Health monitoring validation passed.");
