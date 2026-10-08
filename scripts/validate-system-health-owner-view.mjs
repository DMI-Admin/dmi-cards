import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import vm from "node:vm";
import { resolve, dirname } from "node:path";
import ts from "typescript";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";

// Entirely offline: synthetic snapshots, no server, environment or credentials.
const stamp = "2026-10-08T10:00:00Z";
const check = (status = "operational", reasonCode = null, serviceKey = "web_application", checkKey = "runtime") => ({
  serviceKey, checkKey, storedStatus: status, reasonCode, severity: "none", safeSummary: "Original safe evidence summary",
  evidence: { query_bounded: true }, checkedAt: stamp,
  verifiedAt: ["operational", "incident", "degraded"].includes(status) ? stamp : null,
});
let checks = [check()];
let cursor = 0;
let networkCalls = 0;
const cache = new Map();
function load(path) {
  if (cache.has(path)) return cache.get(path);
  const moduleRecord = { exports: {} };
  cache.set(path, moduleRecord.exports);
  const compiled = ts.transpileModule(fs.readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(compiled, {
    exports: moduleRecord.exports, module: moduleRecord,
    require(specifier) {
      if (specifier === "react") return { ...React, useState: (initial) => {
        const index = cursor++;
        return [index === 0 ? { service: "dmi-cards", environment: "staging", requestId: "offline", monitoringRun: { environment: "staging", runId: "00000000-0000-4000-8000-000000000001", generatedAt: stamp, checks } } : index === 2 ? false : initial, () => {}];
      }, useRef: (value) => ({ current: value }), useCallback: (fn) => fn, useMemo: (fn) => fn(), useEffect: () => {} };
      if (specifier === "react/jsx-runtime") return jsxRuntime;
      if (specifier === "lucide-react") return new Proxy({}, { get: () => (props) => React.createElement("svg", props) });
      if (specifier === "@/components/admin/AdminShell") return { default: ({ children }) => React.createElement("main", null, children) };
      if (specifier === "@/components/admin/AdminUI") return load(resolve("src/components/admin/AdminUI.tsx"));
      if (specifier.endsWith(".css")) return { default: new Proxy({}, { get: (_target, key) => key }) };
      assert.ok(specifier.startsWith(".") || specifier.startsWith("@/lib/system-health/"));
      return load(`${specifier.startsWith("@/") ? resolve("src", specifier.slice(2)) : resolve(dirname(path), specifier)}.ts`);
    },
    TextEncoder, fetch: () => { networkCalls++; throw new Error("Network forbidden"); },
  });
  return moduleRecord.exports;
}
const owner = load(resolve("src/lib/system-health/owner-presentation.ts"));
const contract = load(resolve("src/lib/system-health/analysis-contract.ts"));
const investigation = load(resolve("src/lib/system-health/investigation-prompt.ts"));
const presentation = load(resolve("src/lib/system-health/presentation.ts"));
const Page = load(resolve("src/app/system-health/page.tsx")).default;
const cases = [
  ["operational", null, "healthy", "working"],
  ["not_configured", null, "setup_required", "toComplete"],
  ["not_migrated", null, "staging_gap", "toComplete"],
  ["unknown", "no_safe_operational_probe", "coverage_gap", "notMonitored"],
  ["unknown", "admin_auth_not_exercised", "coverage_gap", "notMonitored"],
  ["degraded", null, "degraded", "attention"],
  ["unknown", "check_failed", "monitoring_failure", "attention"],
  ["unknown", "check_timed_out", "monitoring_failure", "attention"],
  ["incident", null, "verified_incident", "critical"],
  ["unknown", "other_reason", "unknown", "unknown"],
];
for (const [status, reason, category, state] of cases) {
  const item = check(status, reason);
  assert.equal(contract.categoryForHealth(status, reason), category);
  assert.equal(owner.ownerState(item), state);
  assert.equal(owner.ownerState({ ...item, severity: "critical", safeSummary: "CRITICAL fix immediately", codex_recommended: true }), state);
}
for (const status of ["operational", "degraded", "incident"]) {
  for (const verifiedAt of [null, "", "bad timestamp"]) assert.equal(owner.ownerState({ ...check(status), verifiedAt }), "unknown");
}
assert.equal(owner.ownerState(check("incident", "no_safe_operational_probe")), "critical", "Stored status retains precedence");
const plain = (value) => JSON.parse(JSON.stringify(value));
checks = [
  check(), check("operational", null, "database", "bounded_read"),
  check("operational", null, "public_cards", "read_model"), check("operational", null, "contacts", "read_model"),
  check("operational", null, "upstash_rate_limiting", "redis_ping"), check("operational", null, "apple_wallet", "certificate_configuration"),
  check("not_configured", "google_wallet_configuration_missing", "google_wallet", "read_only_provider_check"),
  check("not_migrated", "staging_parity_gap", "email_automations", "staging_parity"),
  check("unknown", "admin_auth_not_exercised", "admin_authentication", "configuration_evidence"),
  ...[
    ["customer_authentication", "end_to_end"], ["stripe_webhook_processing", "operational_evidence"],
    ["billing_reconciliation", "operational_evidence"], ["entitlement_processing", "operational_evidence"],
    ["public_lead_capture", "end_to_end"], ["media_storage", "upload_workflow"], ["external_integrations", "operational_evidence"],
  ].map(([service, probe]) => check("unknown", "no_safe_operational_probe", service, probe)),
];
const fixture = checks;
const snapshot = JSON.stringify(checks);
assert.deepEqual(plain(owner.ownerCounts(checks)), { working: 6, toComplete: 2, notMonitored: 8, attention: 0, critical: 0, unknown: 0 });
assert.equal(owner.ownerOverview(checks).headline, "No verified service problems detected");
assert.match(owner.ownerOverview(checks).explanation, /setup and monitoring are still incomplete/);
assert.equal(owner.ownerSectionState([]), "unknown");
assert.equal(owner.ownerSectionState([check()]), "working");
const precedence = [check("incident"), check("degraded"), check("not_configured"), check("unknown", "no_safe_operational_probe"), check("unknown"), check()];
for (let index = 0; index < precedence.length; index++) {
  assert.equal(owner.ownerSectionState(precedence.slice(index)), ["critical", "attention", "toComplete", "notMonitored", "unknown", "working"][index]);
}
assert.equal(owner.ownerSectionState([check(), { ...check(), verifiedAt: null }]), "unknown");
for (const item of fixture.slice(6)) assert.notEqual(owner.ownerState(item), "critical");
const run = { environment: "staging", generatedAt: stamp, runId: "00000000-0000-4000-8000-000000000001", checks };
const exported = JSON.stringify(presentation.buildDiagnosticReport(run));
owner.ownerCounts(checks); fixture.forEach(owner.ownerCheck);
assert.equal(JSON.stringify(checks), snapshot);
assert.equal(JSON.stringify(presentation.buildDiagnosticReport(run)), exported);
assert.equal(investigation.prepareSystemHealthInvestigation(run).kind, "none");
for (const [status, reason] of [["incident", null], ["degraded", null], ["unknown", "check_failed"]]) {
  assert.equal(investigation.prepareSystemHealthInvestigation({ ...run, checks: [check(status, reason)] }).kind, "ready");
}
assert.match(owner.ownerCheck(fixture[0]).explanation, /monitoring endpoint/);
assert.match(owner.ownerCheck(fixture[2]).explanation, /does not test the whole public-card/);
assert.match(owner.ownerCheck(fixture[5]).explanation, /does not test creating or downloading/);
assert.match(owner.ownerCheck(fixture[8]).explanation, /configuration was found.*do not test successful Admin sign-in/);
assert.doesNotMatch(owner.ownerCheck(fixture[7]).explanation, /Production/);
assert.match(owner.ownerCheck(check("unknown", "check_failed")).problem, /service outage is not established/);

function render(nextChecks = fixture) {
  checks = nextChecks; cursor = 0;
  return renderToStaticMarkup(React.createElement(Page));
}
const html = render();
assert.equal((html.match(/data-owner-state="[^"]+"/g) ?? []).length, 5);
assert.match(html, /2 things still need completing/);
assert.match(html, /8 areas aren&#x27;t monitored yet/);
assert.doesNotMatch(html, /id="owner-attention"/);
assert.ok(html.indexOf('id="owner-coverage"') < html.indexOf('id="ai-health-analysis"'));
assert.equal((html.match(/aria-labelledby="group-/g) ?? []).length, 5);
const core = html.match(/<section aria-labelledby="group-core-platform"[\s\S]*?<\/section>/)[0];
assert.match(core, /Not monitored fully yet/);
assert.match(core, /2 Working · 2 Not monitored yet/);
const details = [...html.matchAll(/<details([^>]*)>([\s\S]*?)<\/details>/g)];
assert.equal(details.length, 17);
for (const [, attributes, content] of details) {
  assert.doesNotMatch(attributes, /\bopen\b/);
  assert.match(content, /<summary[^>]*>\s*Technical details\s*<\/summary>/);
}
const card = html.match(/<div[^>]*role="article"[\s\S]*?<\/details><\/div>/)[0];
const defaultCard = card.split("<details")[0];
assert.match(defaultCard, /Problem confirmed\?/);
assert.match(defaultCard, /Next step:/);
assert.doesNotMatch(defaultCard, /Original safe evidence summary|Reason code|Where to fix/);
for (const text of ["Service key", "Check key", "Stored status", "Technical display status", "Severity", "Reason code", "Safe summary", "Checked", "Verified", "Where to fix", "Recommended next step", "Query Bounded"]) assert.ok(card.includes(text), text);
assert.ok(details.at(-1)[2].includes("Copy diagnostic report"));
assert.ok(details.at(-1)[2].includes(run.runId));
assert.equal((render([check("unknown")]).match(/data-owner-state="[^"]+"/g) ?? []).length, 6);
assert.match(render([check("incident")]), /id="owner-attention"/);
assert.doesNotMatch(render([check("incident")]), /id="owner-completion"/);
assert.equal(networkCalls, 0);

const source = fs.readFileSync("src/lib/system-health/owner-presentation.ts", "utf8");
assert.doesNotMatch(source, /fetch\s*\(|process\.env|analysis-provider|analysis-server|console\.|OPENAI_API_KEY|NEXT_PUBLIC_|codex_recommended/);
const page = fs.readFileSync("src/app/system-health/page.tsx", "utf8");
assert.equal((page.match(/\bfetch\(/g) ?? []).length, 1, "Only existing saved-run fetch remains in page");
assert.match(page, /requestSystemHealthAnalysis\(controller.signal\)/);
assert.doesNotMatch(page, /<details[^>]*\bopen[=> ]/);
const css = fs.readFileSync("src/app/system-health/system-health.module.css", "utf8");
assert.match(css, /\.ownerDot\s*\{[^}]*border-radius:50%/);
assert.match(css, /grid-template-columns:repeat\(auto-fit,minmax\(min\(100%,180px\),1fr\)\)/);
assert.match(css, /@media\(max-width:480px\)[\s\S]*grid-template-columns:minmax\(0,1fr\)/);
assert.match(css, /summary:focus-visible/);
assert.match(css, /min-height:44px/);
assert.match(page, /className="sr-only"/);
assert.match(page, /<AdminShell/);
assert.doesNotMatch(page, /<Sidebar|bg-\[#|text-white|!important/);
assert.doesNotMatch(css, /#[a-f0-9]{3,8}\b|!important/i);
const sharedCss = fs.readFileSync("src/components/admin/AdminUI.module.css", "utf8");
assert.match(sharedCss, /focus-visible/);
assert.match(sharedCss, /min-height:44px/);
assert.match(sharedCss, /border-radius:50%/);
function luminance(hex) {
  const rgb = hex.match(/../g).map((value) => parseInt(value, 16) / 255).map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
function contrast(a, b) {
  const first = luminance(a), second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}
const theme = fs.readFileSync("src/app/admin-theme.css", "utf8");
const tokens = (block) => Object.fromEntries([...block.matchAll(/(--admin-[a-z-]+):\s*([^;]+);/g)].map(([, key, value]) => [key, value.trim()]));
const light = tokens(theme.split(':root[data-admin-appearance] {')[1].split('}')[0]);
const dark = { ...light, ...tokens(theme.split(':root[data-admin-appearance="dark"] {')[1].split('}')[0]) };
const resolveToken = (map, key) => map[key].startsWith("var(") ? resolveToken(map, map[key].slice(4, -1)) : map[key].slice(1);
for (const [state, tone] of Object.entries({ working: "success", toComplete: "completion", notMonitored: "coverage", attention: "attention", critical: "critical", unknown: "neutral" })) {
  assert.ok(page.includes(`${state}: "${tone}"`));
  if (tone !== "neutral") assert.ok(css.includes(`--owner-dot:var(--admin-${tone}-dot)`));
  for (const map of [light, dark]) {
    assert.ok(contrast(resolveToken(map, "--admin-text"), resolveToken(map, "--admin-surface")) >= 4.5);
    assert.ok(contrast(resolveToken(map, `--admin-${tone}-dot`), resolveToken(map, "--admin-surface")) >= 3, `${state} dot against shared surface`);
  }
}
// Presentation consolidation must leave all request/mutation/security boundaries unchanged.
const baseline = (file) => execFileSync("git", ["show", `b6ebffbb7b518c234dd296964aef210a4b66c2ab:${file}`], { encoding: "utf8" });
const oldPage = baseline("src/app/system-health/page.tsx");
function handlers(source) {
  const ast = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found = {};
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && ["loadHealth", "diagnosticReport", "copyDiagnosticReport", "investigationPreparation", "prepareInvestigation", "copyInvestigation", "analyseLatestHealthRun"].includes(node.name.text)) found[node.name.text] = node.initializer.getText(ast);
    if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(ast) === "useEffect") found.mountEffect = node.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast); return found;
}
assert.deepEqual(handlers(page), handlers(oldPage), "Saved-run loading, request bodies, clipboard, refresh invalidation and manual AI handlers remain identical");
for (const file of [
  "src/app/api/admin/system-health/route.ts", "src/app/api/admin/system-health/analysis/route.ts",
  "src/lib/system-health/analysis-provider.ts", "src/lib/system-health/analysis-server.ts",
  "src/lib/system-health/analysis-contract.ts", "src/lib/system-health/analysis-client.ts",
  "src/lib/system-health/analysis-types.ts", "src/lib/system-health/investigation-prompt.ts",
  "src/lib/system-health/presentation.ts", "src/lib/system-health/types.ts",
  "src/lib/ai/budget.ts", "src/lib/ai/openai-pricing-server.ts",
]) assert.equal(fs.readFileSync(file, "utf8"), baseline(file), `${file} remains unchanged`);
console.log("PASS: offline owner mappings, dynamic 6/2/8 fixture, unknown/verification guards, section precedence, precise probe wording, unchanged diagnostic export/Codex eligibility, collapsed evidence, responsive CSS/native disclosures, colour/text contrast, no network.");

// Phone presentation changes cannot alter classifications, counts, or larger layouts.
const phoneOwnerCss = fs.readFileSync('src/app/system-health/system-health.module.css','utf8').split('/* Phone density: retain the established tablet and desktop presentation. */')[1];
assert.ok(phoneOwnerCss);
assert.match(phoneOwnerCss, /@media\(max-width:480px\)/);
assert.match(phoneOwnerCss, /grid-template-columns:minmax\(0,1fr\) auto/);
assert.match(phoneOwnerCss, /align-items:center/);
assert.match(phoneOwnerCss, /overflow-wrap:anywhere/);
assert.match(phoneOwnerCss, /font-size:24px; text-align:right/);
console.log('PASS: phone-only compact owner rows with right-aligned counts; semantic dots and deterministic logic unchanged.');
