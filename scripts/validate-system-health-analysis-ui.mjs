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
      if (specifier === "@/components/Sidebar") return { default: () => React.createElement("aside", null, "Admin navigation") };
      if (specifier.endsWith(".css")) return { default: new Proxy({}, { get: (_target, key) => key }) };
      const base = specifier.startsWith("@/") ? resolve("src", specifier.slice(2)) : resolve(dirname(path), specifier);
      assert.ok(specifier.startsWith("@/lib/system-health/") || specifier.startsWith("."), "Unexpected dependency");
      return load(`${base}.ts`);
    },
    fetch: (...args) => { requests.push(args); return fetchMock(...args); },
    AbortController,
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
  monitoringRun: { environment: "staging", generatedAt: check.checkedAt, runId: "offline-run", checks: [check] },
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
assert.equal((current.html.match(/AI headline /g) ?? []).length, 5);
assert.equal((current.html.match(/AI advisory/g) ?? []).length, 6);
for (const { id, label } of types.healthGroups) {
  const section = find(current.tree, (node) => node.type === "section" && node.props["aria-labelledby"] === `group-${label.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}`);
  assert.ok(section);
  const sectionHtml = renderToStaticMarkup(section);
  const returnedLevel = analysis.sections.find((summary) => summary.section === id).level;
  assert.ok(sectionHtml.includes(client.analysisLevelDisplay[returnedLevel].label));
  assert.ok(sectionHtml.includes(client.analysisLevelDisplay[returnedLevel].tone));
  assert.equal((sectionHtml.match(new RegExp(`AI headline ${id}`, "g")) ?? []).length, 1);
  assert.ok(sectionHtml.indexOf("<h2") < sectionHtml.indexOf("aiExplanation"));
  if (sectionHtml.includes("<article")) assert.ok(sectionHtml.indexOf("aiExplanation") < sectionHtml.indexOf("<article"));
}
for (const level of levels) assert.match(current.html, new RegExp(client.analysisLevelDisplay[level].label));
assert.match(current.html, /Not yet monitored does not mean the service is broken\./);
assert.match(current.html, /Operational/);
assert.doesNotMatch(current.html, /Tell Codex|Prepare Codex|automatic fix|costNanoUsd|inputTokens|outputTokens/);
assert.equal(JSON.stringify(health.monitoringRun.checks), storedCheck);
assert.equal(requests.length, 2, "Rendering a successful result must not request another analysis");

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
for (const tone of ["aiAllGood", "aiMonitoringIncomplete", "aiNeedsAttention", "aiCritical"]) assert.match(css, new RegExp(`\\.${tone} \\{`));
function luminance(hex) {
  const components = hex.match(/../g).map((component) => parseInt(component, 16) / 255);
  const linear = components.map((component) => component <= 0.04045 ? component / 12.92 : ((component + 0.055) / 1.055) ** 2.4);
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}
for (const { tone } of Object.values(client.analysisLevelDisplay)) {
  const rule = css.match(new RegExp(`\\.${tone} \\{([^}]+)\\}`))[1];
  const foreground = luminance(rule.match(/--ai-text: #([0-9a-f]{6})/)[1]);
  const background = luminance(rule.match(/--ai-background: #([0-9a-f]{6})/)[1]);
  assert.ok((Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05) >= 7, `${tone}: strong text contrast required`);
}
assert.match(css, /color: var\(--ai-text\) !important/);
assert.match(css, /background: var\(--ai-background\) !important/);
console.log("PASS: offline manual-only AI UI, bodyless POST, loading/double-click protection, five section summaries, four server levels, safe errors/no retries, refresh cancellation, contrast styling, and no client secrets or fix controls.");
