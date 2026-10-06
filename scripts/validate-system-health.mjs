import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const typesPath = "src/lib/system-health/types.ts";
const apiPath = "src/app/api/admin/system-health/route.ts";
const pagePath = "src/app/system-health/page.tsx";
const presentationPath = "src/lib/system-health/presentation.ts";
const typesSource = fs.readFileSync(typesPath, "utf8");
const apiSource = fs.readFileSync(apiPath, "utf8");
const pageSource = fs.readFileSync(pagePath, "utf8");
const presentationSource = fs.readFileSync(presentationPath, "utf8");
const exports = {};
const compiled = ts.transpileModule(typesSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
vm.runInNewContext(compiled, { exports });
const presentationExports = {};
const compiledPresentation = ts.transpileModule(presentationSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
vm.runInNewContext(compiledPresentation, { exports: presentationExports });

const statuses = [
  "operational",
  "degraded",
  "incident",
  "not_configured",
  "not_migrated",
  "unknown",
];
for (const status of statuses) assert.equal(exports.isHealthStatus(status), true, status);
assert.equal(exports.isHealthStatus("outage"), false);
assert.equal(exports.isHealthStatus(null), false);
assert.equal(exports.healthSeverity("incident"), "critical");
assert.equal(exports.healthSeverity("degraded"), "warning");

const check = (status, verified = false) => ({
  service: status,
  status,
  verifiedAt: verified ? "2026-10-05T13:00:00.000Z" : null,
});
assert.equal(exports.summarizeHealth([check("operational", true)]).status, "operational");
for (const status of ["unknown", "not_configured", "not_migrated"]) {
  const result = exports.summarizeHealth([check(status)]);
  assert.equal(result.status, "limited_visibility", `${status} must not become an incident`);
  assert.equal(result.attentionCount, 0);
  assert.equal(result.incidentCount, 0);
}
const unverifiedDegraded = exports.summarizeHealth([check("degraded")]);
assert.equal(unverifiedDegraded.status, "limited_visibility");
assert.equal(unverifiedDegraded.attentionCount, 0);
const degraded = exports.summarizeHealth([check("degraded", true)]);
assert.equal(degraded.status, "attention_required");
assert.equal(degraded.attentionCount, 1);
assert.equal(degraded.incidentCount, 0);
const incident = exports.summarizeHealth([check("incident", true)]);
assert.equal(incident.status, "attention_required");
assert.equal(incident.attentionCount, 1);
assert.equal(incident.incidentCount, 1);
assert.match(incident.explanation, /important service.*verified as broken/);
const mixed = exports.summarizeHealth([check("incident", true), check("degraded", true)]);
assert.equal(mixed.attentionCount, 2);
assert.equal(mixed.incidentCount, 1);
assert.deepEqual(JSON.parse(JSON.stringify(exports.healthGroups.map((group) => group.id))), [
  "core_platform",
  "payments_access",
  "card_services",
  "infrastructure",
  "communications_integrations",
]);
assert.deepEqual(JSON.parse(JSON.stringify(exports.healthGroups.map((group) => group.label))), [
  "Core Platform",
  "Payments & Access",
  "Card Services",
  "Infrastructure",
  "Communications & Integrations",
]);

assert.match(typesSource, /evidenceSummary: string/);
assert.match(typesSource, /details: Record<string, SafeHealthDetail>/);
assert.match(pageSource, /<details className=/);
assert.match(pageSource, /check\.safeSummary/);
assert.match(pageSource, /check\.evidence/);
assert.match(pageSource, /This view does not report Production health/);
assert.match(pageSource, /Copy diagnostic report/);
assert.match(pageSource, /Refresh reloads the latest saved run/);
assert.match(apiSource, /requireAdminAccess\(await auth\(\)\)/);
assert.match(apiSource, /process\.env\.VERCEL_ENV !== "preview"/);
assert.match(apiSource, /NEXT_PUBLIC_SUPABASE_URL\?\.trim\(\) !== stagingSupabaseUrl/);
assert.match(apiSource, /\.eq\("environment", "staging"\)/);
assert.match(apiSource, /sanitizeEvidence/);
assert.match(apiSource, /\.limit\(16\)/);
assert.match(apiSource, /verifiedStatus && row\.verified_at === null/);
assert.doesNotMatch(apiSource, /\.from\("system_health_check_runs"\)[\s\S]{0,200}\.(?:insert|update|delete|rpc)\(/);
assert.doesNotMatch(apiSource, /CRON_SECRET|SUPABASE_SERVICE_ROLE_KEY|Authorization/);
assert.doesNotMatch(apiSource, /uptimePercentage|uptime_percent|responseTimeHistory|incidentHistory|sampleIncident/i);
assert.doesNotMatch(typesSource, /uptimePercentage|uptime_percent|responseTimeHistory|incidentHistory|sampleIncident/i);
assert.doesNotMatch(pageSource, /uptimePercentage|uptime_percent|responseTimeHistory|incidentHistory|sampleIncident/i);
assert.doesNotMatch(apiSource, /customer_email|stripe_customer_id|stripe_subscription_id|access_token|refresh_token|provider_account_email|contact_email/i);

const display = presentationExports.displayStatus;
assert.equal(display("operational", null), "Operational");
assert.equal(display("degraded", null), "Degraded");
assert.equal(display("incident", null), "Incident");
assert.equal(display("not_configured", null), "Setup required");
assert.equal(display("not_migrated", null), "Staging gap");
assert.equal(display("unknown", "no_safe_operational_probe"), "Not yet monitored");
assert.equal(display("unknown", "admin_auth_not_exercised"), "Not yet monitored");
assert.equal(display("unknown", "check_timed_out"), "Needs investigation");
assert.equal(display("unknown", "check_failed"), "Needs investigation");
assert.equal(display("unknown", "other_reason"), "Unknown");
assert.equal(presentationExports.isActionable("Not yet monitored"), false);
assert.equal(presentationExports.isActionable("Setup required"), true);
assert.equal(presentationExports.isActionable("Staging gap"), true);
assert.equal(presentationExports.needsAttention("Not yet monitored"), false);
assert.equal(presentationExports.needsAttention("Needs investigation"), true);

const run = {
  environment: "staging",
  generatedAt: "2026-10-06T12:00:00.000Z",
  runId: "11111111-1111-4111-8111-111111111111",
  checks: [
    {
      serviceKey: "google_wallet",
      checkKey: "read_only_provider_check",
      storedStatus: "not_configured",
      severity: "info",
      reasonCode: "google_wallet_configuration_missing",
      safeSummary: "Google Wallet configuration is incomplete.",
      evidence: { configuration_present_count: 0, configuration_required_count: 3 },
      checkedAt: "2026-10-06T12:00:00.000Z",
      verifiedAt: null,
    },
    {
      serviceKey: "stripe_webhook_processing",
      checkKey: "operational_evidence",
      storedStatus: "unknown",
      severity: "info",
      reasonCode: "no_safe_operational_probe",
      safeSummary: "No bounded service-level webhook health signal is available.",
      evidence: {},
      checkedAt: "2026-10-06T12:00:00.000Z",
      verifiedAt: null,
    },
    {
      serviceKey: "database",
      checkKey: "bounded_read",
      storedStatus: "operational",
      severity: "none",
      reasonCode: null,
      safeSummary: "The template catalogue can be read.",
      evidence: { query_bounded: true },
      checkedAt: "2026-10-06T12:00:00.000Z",
      verifiedAt: "2026-10-06T12:00:00.000Z",
    },
  ],
};
assert.equal(presentationExports.overallHeadline(run.checks), "No verified incidents");
const report = presentationExports.buildDiagnosticReport(run);
assert.deepEqual(Object.keys(report).sort(), [
  "checks",
  "counts_by_display_status",
  "environment",
  "generated_at",
  "overall_headline",
  "run_id",
].sort());
assert.equal(report.counts_by_display_status.Operational, 1);
assert.equal(report.counts_by_display_status["Not yet monitored"], 1);
assert.equal(report.counts_by_display_status["Setup required"], 1);
assert.equal(report.counts_by_display_status["Needs investigation"], 0);
assert.deepEqual(Object.keys(report.checks[0]).sort(), [
  "checked_at",
  "check_key",
  "display_status",
  "evidence",
  "reason_code",
  "recommended_next_step",
  "safe_summary",
  "service_key",
  "severity",
  "stored_status",
  "verified_at",
  "where_to_fix",
].sort());
assert.equal(report.checks.find((item) => item.service_key === "stripe_webhook_processing").display_status, "Not yet monitored");
assert.equal(report.checks.find((item) => item.service_key === "google_wallet").where_to_fix, "Vercel → Staging environment variables / Google Wallet configuration");
assert.equal(
  presentationExports.getFixGuidance({
    serviceKey: "email_automations",
    checkKey: "staging_parity",
    storedStatus: "not_migrated",
    reasonCode: "staging_parity_gap",
  }).whereToFix,
  "Staging Supabase / Email Automations foundation"
);
assert.equal(presentationExports.displayStatus("not_migrated", "staging_parity_gap"), "Staging gap");
assert.equal(presentationExports.overallHeadline([
  { ...run.checks[0], storedStatus: "not_configured" },
  { ...run.checks[1], storedStatus: "unknown", reasonCode: "no_safe_operational_probe" },
]), "No verified incidents");
assert.equal(presentationExports.overallHeadline([
  { ...run.checks[1], storedStatus: "unknown", reasonCode: "check_timed_out" },
]), "Attention required");
assert.equal(presentationExports.overallHeadline([
  { ...run.checks[1], storedStatus: "degraded", reasonCode: "bounded_read_failed" },
]), "Attention required");
assert.doesNotMatch(JSON.stringify(report), /secret|token|api_key|customer|email|phone|card_payload|authorization/i);

console.log("PASS: stored health semantics; owner-facing status mapping; Staging-only report API guard; safe allowlisted diagnostic export; no fabricated Production health.");
