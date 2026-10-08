import assert from "node:assert/strict";
import fs from "node:fs";
import { resolve, dirname } from "node:path";
import vm from "node:vm";
import ts from "typescript";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";

// Offline hook harness and mocked transport. No server, credentials, or live requests.
const state = [];
let cursor = 0;
let mounted = false;
const effects = [];
const timers = [];
const requests = [];
let fetchMock;
const clipboardWrites = [];
let clipboardFails = false;
let clipboardPending;
const react = {
  ...React,
  useState(initial) {
    const index = cursor++;
    if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial;
    return [state[index], (next) => { state[index] = typeof next === "function" ? next(state[index]) : next; }];
  },
  useRef(initial) {
    const index = cursor++;
    if (!(index in state)) state[index] = { current: initial };
    return state[index];
  },
  useCallback: (callback) => callback,
  useMemo: (factory) => factory(),
  useEffect: (effect) => { if (!mounted) effects.push(effect); },
};
const cache = new Map();
function load(path) {
  if (cache.has(path)) return cache.get(path);
  const source = fs.readFileSync(path, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const moduleRecord = { exports: {} };
  cache.set(path, moduleRecord.exports);
  vm.runInNewContext(compiled, {
    exports: moduleRecord.exports, module: moduleRecord,
    require(specifier) {
      if (specifier === "react") return react;
      if (specifier === "react/jsx-runtime") return jsxRuntime;
      if (specifier === "lucide-react") return new Proxy({}, { get: () => (props) => React.createElement("span", props) });
      if (specifier === "@/components/admin/AdminShell") return { default: ({ children }) => React.createElement("main", null, children) };
      if (specifier === "@/components/admin/AdminUI") return load(resolve("src/components/admin/AdminUI.tsx"));
      if (specifier.endsWith(".css")) return { default: new Proxy({}, { get: (_target, key) => key }) };
      const base = specifier.startsWith("@/") ? resolve("src", specifier.slice(2)) : resolve(dirname(path), specifier);
      assert.ok(specifier.startsWith("@/lib/system-health/") || specifier.startsWith("."), "Unexpected dependency");
      return load(`${base}.ts`);
    },
    fetch: (...args) => { requests.push(args); return fetchMock(...args); },
    AbortController, TextEncoder,
    navigator: { clipboard: { writeText: async (text) => {
      clipboardWrites.push(text);
      if (clipboardFails) throw new Error("synthetic private clipboard failure");
      if (clipboardPending) await clipboardPending;
    } } },
    window: { setTimeout: (callback) => { timers.push(callback); return timers.length; }, clearTimeout: () => {} },
  });
  return moduleRecord.exports;
}
const client = load(resolve("src/lib/system-health/analysis-client.ts"));
const types = load(resolve("src/lib/system-health/types.ts"));
const Page = load(resolve("src/app/system-health/page.tsx")).default;
const tick = () => new Promise(setImmediate);
const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status });
const check = {
  serviceKey: "web_application", checkKey: "runtime", storedStatus: "operational", severity: "none",
  reasonCode: null, safeSummary: "The application is available.", evidence: {},
  checkedAt: "2026-10-07T12:00:00Z", verifiedAt: "2026-10-07T12:00:00Z",
};
const health = {
  service: "dmi-cards", requestId: "offline-test", environment: "staging",
  monitoringRun: { environment: "staging", generatedAt: check.checkedAt, runId: "00000000-0000-4000-8000-000000000001", checks: [check] },
};
const storedCheck = JSON.stringify(health.monitoringRun.checks);
const levels = ["all_good", "monitoring_incomplete", "needs_attention", "critical"];
const analysis = {
  overall: { level: "all_good", headline: "Overall advisory headline", plain_english: "Plain English overall explanation." },
  sections: types.healthGroups.map(({ id }, index) => ({
    section: id, level: levels[index % 4], headline: `AI headline ${id}`,
    plain_english: "Critical words here do not change the server level.", codex_recommended: false, affected_checks: [],
  })),
  limitations: ["AI analysis is advisory."],
};
function render() {
  cursor = 0;
  const tree = Page();
  mounted = true;
  return { tree, html: renderToStaticMarkup(tree) };
}
function find(tree, predicate) {
  if (!React.isValidElement(tree)) return null;
  if (predicate(tree)) return tree;
  if (typeof tree.type === "function" && tree.type.name === "AdminButton") return find(tree.type(tree.props), predicate);
  for (const child of React.Children.toArray(tree.props.children)) {
    const match = find(child, predicate);
    if (match) return match;
  }
  return null;
}
const analyseButton = (tree) => find(tree, (node) => node.type === "button" && String(node.props.children).includes("Analyse latest health run"));
fetchMock = async (url) => {
  assert.equal(url, "/api/admin/system-health");
  return jsonResponse(health);
};
assert.match(render().html, /AI Health Analysis/);
assert.equal(requests.length, 0);
const cleanups = effects.map((effect) => effect());
timers.forEach((timer) => timer());
await tick();
assert.equal(requests.length, 1);
assert.equal(requests[0][0], "/api/admin/system-health");
const beforeAi = render().html;
assert.ok(beforeAi.indexOf('aria-label="Owner status summary"') < beforeAi.indexOf('id="ai-health-analysis"'));
assert.equal((beforeAi.match(/data-owner-state="[^"]+"/g) ?? []).length, 5);
assert.doesNotMatch(beforeAi, /id="owner-attention"|id="owner-completion"/);
const ownerSummaryHtml = (html) => html.match(/<section aria-label="Owner status summary"[\s\S]*?<\/section>/)[0];
const initialOwnerSummary = ownerSummaryHtml(beforeAi);
let pendingResolve;
fetchMock = (_url, options) => {
  assert.equal(options.method, "POST");
  assert.equal(options.credentials, "same-origin");
  assert.equal(options.cache, "no-store");
  assert.equal("body" in options, false);
  return new Promise((resolveResponse) => { pendingResolve = resolveResponse; });
};
let current = render();
assert.equal(analyseButton(current.tree).props.disabled, false);
analyseButton(current.tree).props.onClick();
assert.equal(requests.length, 2);
assert.equal(requests[1][0], "/api/admin/system-health/analysis");
current = render();
assert.match(current.html, /Analysing…/);
assert.match(current.html, /aria-busy="true"/);
const loadingButton = find(current.tree, (node) => node.type === "button" && String(node.props.children).includes("Analysing…"));
assert.equal(loadingButton.props.disabled, true);
loadingButton.props.onClick();
assert.equal(requests.length, 2, "Repeated clicks cannot create concurrent analysis requests");
pendingResolve(jsonResponse(analysis));
await tick();
current = render();
assert.match(current.html, /Overall advisory headline/);
assert.equal(ownerSummaryHtml(current.html), initialOwnerSummary, "AI words and levels cannot alter owner counts or colours");
assert.equal((current.html.match(/AI headline /g) ?? []).length, 5);
assert.equal((current.html.match(/AI advisory/g) ?? []).length, 6);
for (const { id, label } of types.healthGroups) {
  const section = find(current.tree, (node) => node.type === "section" && node.props["aria-labelledby"] === `group-${label.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}`);
  assert.ok(section);
  const sectionHtml = renderToStaticMarkup(section);
  const returnedLevel = analysis.sections.find((summary) => summary.section === id).level;
  assert.ok(sectionHtml.includes(client.analysisLevelDisplay[returnedLevel].label));
  assert.ok(sectionHtml.includes(`data-tone="${({ all_good: "success", monitoring_incomplete: "coverage", needs_attention: "attention", critical: "critical" })[returnedLevel]}"`));
  assert.equal((sectionHtml.match(new RegExp(`AI headline ${id}`, "g")) ?? []).length, 1);
  assert.ok(sectionHtml.indexOf("<h2") < sectionHtml.indexOf("aiExplanation"));
  if (sectionHtml.includes("<article")) assert.ok(sectionHtml.indexOf("aiExplanation") < sectionHtml.indexOf("<article"));
}
for (const level of levels) assert.match(current.html, new RegExp(client.analysisLevelDisplay[level].label));
assert.match(current.html, /Not yet monitored does not mean the service is broken\./);
assert.match(current.html, /Operational/);
assert.doesNotMatch(current.html, /Tell Codex|Prepare Codex|automatic fix|costNanoUsd|inputTokens|outputTokens/);
assert.match(current.html, /No checks in this saved run currently require an incident investigation\./);
assert.equal(JSON.stringify(health.monitoringRun.checks), storedCheck);
assert.equal(requests.length, 2, "Rendering a successful result must not request another analysis");

const diagnosticButton = find(current.tree, (node) => node.type === "button" && String(node.props.children).includes("Copy diagnostic report"));
const technicalReport = find(current.tree, (node) => node.type === "details" && renderToStaticMarkup(node).includes("Safe diagnostic report JSON"));
assert.ok(technicalReport && !technicalReport.props.open);
assert.ok(find(technicalReport, (node) => node.type === "button" && node.props.onClick === diagnosticButton.props.onClick));
diagnosticButton.props.onClick();
await tick();
const presentation = load(resolve("src/lib/system-health/presentation.ts"));
assert.equal(clipboardWrites.pop(), JSON.stringify(presentation.buildDiagnosticReport(health.monitoringRun), null, 2));

// Eligibility is driven by the displayed run, even when AI says all_good and
// codex_recommended is false. Preparing/reviewing/copying is entirely local.
health.monitoringRun.checks = [{ ...check, storedStatus: "incident", severity: "critical", safeSummary: "synthetic-private-summary" }];
fetchMock = async (url) => jsonResponse(url === "/api/admin/system-health" ? health : analysis);
const refreshButton = (tree) => find(tree, (node) => node.type === "button" && String(node.props.children).includes("Refresh"));
const prepareButton = (tree) => find(tree, (node) => node.type === "button" && node.props.children === "Prepare Codex investigation");
const copyButton = (tree) => find(tree, (node) => node.type === "button" && node.props.children === "Copy Codex investigation");
refreshButton(current.tree).props.onClick();
await tick();
current = render();
assert.equal(prepareButton(current.tree), null, "Handoff UX waits for analysis success");
analyseButton(current.tree).props.onClick();
await tick();
current = render();
assert.ok(prepareButton(current.tree));
assert.equal(copyButton(current.tree), null, "Copy cannot happen before review is opened");
const beforePreparation = requests.length;
prepareButton(current.tree).props.onClick();
current = render();
assert.match(current.html, /Based on the displayed saved health run/);
assert.match(current.html, /not necessarily the same run the AI analysed/);
assert.match(current.html, /web_application\/runtime/);
assert.match(current.html, /00000000-0000-4000-8000-000000000001/);
const promptField = find(current.tree, (node) => node.type === "textarea" && node.props.id === "codex-investigation-prompt");
assert.ok(promptField.props.readOnly);
assert.ok(promptField.props.value.endsWith("Make no changes. Stop after reporting."));
assert.doesNotMatch(promptField.props.value, /synthetic-private-summary|Overall advisory headline|codex_recommended/);
assert.equal(clipboardWrites.length, 0, "Prepare only opens review; it must not copy");
assert.equal(requests.length, beforePreparation);
copyButton(current.tree).props.onClick();
await tick();
assert.deepEqual(clipboardWrites, [promptField.props.value]);
assert.match(render().html, /Codex investigation copied/);
clipboardFails = true;
copyButton(current.tree).props.onClick();
await tick();
current = render();
assert.match(current.html, /full prompt remains visible/);
assert.doesNotMatch(current.html, /synthetic private clipboard failure/);
assert.equal(find(current.tree, (node) => node.type === "textarea").props.value, promptField.props.value);
assert.equal(requests.length, beforePreparation, "Prepare and copy cannot perform network calls");
clipboardFails = false;
let resolveClipboard;
clipboardPending = new Promise((resolveCopy) => { resolveClipboard = resolveCopy; });
copyButton(current.tree).props.onClick();
refreshButton(current.tree).props.onClick();
resolveClipboard();
await tick();
clipboardPending = undefined;
current = render();
assert.doesNotMatch(current.html, /Review Codex investigation|Codex investigation copied|full prompt remains visible/);
assert.equal(copyButton(current.tree), null, "Refresh clears prepared prompt and stale copy completion");
analyseButton(current.tree).props.onClick();
await tick();
current = render();

assert.equal(client.isSystemHealthAnalysisResult(analysis), true);
for (const invalid of [
  null, {}, { ...analysis, usage: {} }, { ...analysis, sections: analysis.sections.slice(1) },
  { ...analysis, sections: [...analysis.sections.slice(1), analysis.sections[1]] },
  { ...analysis, overall: { ...analysis.overall, level: "outage" } },
  { ...analysis, overall: { ...analysis.overall, headline: "x".repeat(121) } },
]) assert.equal(client.isSystemHealthAnalysisResult(invalid), false);
const errors = [
  [503, { code: "SYSTEM_HEALTH_ANALYSIS_UNAVAILABLE" }, /unavailable/],
  [503, { error: "SYSTEM_HEALTH_ANALYSIS_NOT_CONFIGURED" }, /not been set up/],
  [502, { code: "SYSTEM_HEALTH_ANALYSIS_INVALID_RESPONSE" }, /checked safely/],
  [429, { error: "SYSTEM_HEALTH_ANALYSIS_RATE_LIMITED" }, /wait a minute/],
  [503, { error: "System Health AI analysis is not configured." }, /not been set up/],
  [504, {}, /took too long/], [403, {}, /Admin access/],
];
for (const [status, payload, wording] of errors) {
  await assert.rejects(client.requestSystemHealthAnalysis(new AbortController().signal, async () => jsonResponse(payload, status)), wording);
}
for (const response of [jsonResponse({ error: "raw provider stack trace synthetic-secret" }, 500), jsonResponse({ secret: "synthetic-secret" }), new Response("not json")]) {
  await assert.rejects(client.requestSystemHealthAnalysis(new AbortController().signal, async () => response), (error) => {
    assert.ok(error instanceof client.SystemHealthAnalysisClientError);
    assert.doesNotMatch(error.message, /raw provider|stack trace|synthetic-secret|not json/);
    return true;
  });
}
fetchMock = async () => jsonResponse({ error: "raw provider stack trace synthetic-secret" }, 429);
analyseButton(current.tree).props.onClick();
await tick();
current = render();
assert.match(current.html, /wait a minute/);
assert.doesNotMatch(current.html, /raw provider|stack trace|synthetic-secret|Overall advisory headline/);
const failedRequestCount = requests.length;
render();
await tick();
assert.equal(requests.length, failedRequestCount, "Errors must not trigger automatic retries");

// Refresh cancels in-flight analysis and prevents stale results from being displayed.
fetchMock = (url) => url === "/api/admin/system-health" ? Promise.resolve(jsonResponse(health)) : new Promise((resolveResponse) => { pendingResolve = resolveResponse; });
analyseButton(current.tree).props.onClick();
const inFlightSignal = requests.at(-1)[1].signal;
current = render();
find(current.tree, (node) => node.type === "button" && String(node.props.children).includes("Refresh")).props.onClick();
assert.equal(inFlightSignal.aborted, true);
pendingResolve(jsonResponse(analysis));
await tick();
assert.doesNotMatch(render().html, /Overall advisory headline/);
cleanups.forEach((cleanup) => cleanup?.());

const pageSource = fs.readFileSync("src/app/system-health/page.tsx", "utf8");
const clientSource = fs.readFileSync("src/lib/system-health/analysis-client.ts", "utf8");
const css = fs.readFileSync("src/app/system-health/system-health.module.css", "utf8");
assert.doesNotMatch(pageSource + clientSource, /OPENAI_API_KEY|NEXT_PUBLIC_.*OPENAI|api\.openai\.com|analysis-provider|analysis-server|dangerouslySetInnerHTML|localStorage|setInterval/);
assert.doesNotMatch(clientSource, /body\s*:|prompt\s*:|diagnostic\s*:/);
assert.match(pageSource, /requestError instanceof SystemHealthAnalysisClientError/);
assert.match(pageSource, /onClick=\{\(\) => void analyseLatestHealthRun\(\)\}/);
for (const [level, tone] of Object.entries({ all_good: "success", monitoring_incomplete: "coverage", needs_attention: "attention", critical: "critical" })) {
  assert.ok(pageSource.includes(`${level}: "${tone}"`));
}
assert.match(css, /background:var\(--admin-input\)/);
assert.match(css, /color:var\(--admin-text\)/);
assert.match(css, /\.investigationPrompt[^}]*width:100%/);
assert.doesNotMatch(css, /#[a-f0-9]{3,8}\b|!important/i);
console.log("PASS: offline manual-only AI UI and local Codex handoff: deterministic eligibility, review before explicit copy, clipboard fallback, refresh/stale-copy cancellation, no preparation network calls, five summaries, trusted levels, safe errors and strong contrast. No client secrets or fix controls.");
