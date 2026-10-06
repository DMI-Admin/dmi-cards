import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const typesPath = "src/lib/system-health/types.ts";
const apiPath = "src/app/api/admin/system-health/route.ts";
const pagePath = "src/app/system-health/page.tsx";
const typesSource = fs.readFileSync(typesPath, "utf8");
const apiSource = fs.readFileSync(apiPath, "utf8");
const pageSource = fs.readFileSync(pagePath, "utf8");
const exports = {};
const compiled = ts.transpileModule(typesSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
vm.runInNewContext(compiled, { exports });

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

assert.match(apiSource, /Email Automations exists in Production but its complete Staging foundation has not yet been migrated/);
assert.match(apiSource, /known staging-parity gap, not a service incident/);
assert.match(apiSource, /status: "not_migrated"/);
assert.match(apiSource, /observed: false/);
assert.doesNotMatch(apiSource, /providerStatus/);
assert.match(apiSource, /Persisted webhook records have no suitable indexed, bounded health query/i);
assert.match(apiSource, /No bounded operational signal is available without scanning billing records/);
assert.match(apiSource, /The template catalogue can be read\. This does not test every database operation/);
assert.match(apiSource, /The published-card read query succeeded\. Public page delivery and publishing are not tested/);
assert.match(apiSource, /Google Wallet token generation and class lookup succeeded/);
assert.match(apiSource, /The configured Redis endpoint answered a read-only ping/);

assert.match(typesSource, /evidenceSummary: string/);
assert.match(typesSource, /details: Record<string, SafeHealthDetail>/);
assert.match(apiSource, /details: result\.details \|\| \{\}/);
assert.match(pageSource, /<details className=/);
assert.match(pageSource, /check\.message/);
assert.match(pageSource, /check\.evidenceSummary/);
assert.doesNotMatch(apiSource, /customer_email|stripe_customer_id|stripe_subscription_id|access_token|refresh_token|provider_account_email|contact_email/i);
assert.doesNotMatch(apiSource, /uptimePercentage|uptime_percent|responseTimeHistory|incidentHistory|sampleIncident/i);
assert.doesNotMatch(typesSource, /uptimePercentage|uptime_percent|responseTimeHistory|incidentHistory|sampleIncident/i);
assert.doesNotMatch(pageSource, /uptimePercentage|uptime_percent|responseTimeHistory|incidentHistory|sampleIncident/i);
assert.doesNotMatch(apiSource, /stripe\.accounts\.retrieve|stripe\.balance\.retrieve|billingRuntime\(/);
assert.match(apiSource, /limit\(1\)/);

console.log("PASS: six statuses, overall aggregation/severity, no-outage unknown states, approved groups, Staging Email Automations parity, evidence separation, sensitive-data exclusions, and no fabricated history.");
