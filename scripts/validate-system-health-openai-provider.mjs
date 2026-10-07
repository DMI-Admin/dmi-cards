import assert from "node:assert/strict";
import fs from "node:fs";
import { resolve, dirname, relative } from "node:path";
import vm from "node:vm";
import ts from "typescript";

// Isolated environment: never read process.env or load dotenv/real credentials.
const syntheticKey = "synthetic-system-health-test-key";
const env = { OPENAI_API_KEY: syntheticKey };
let fetchMock;
const cache = new Map();
function load(path) {
  if (cache.has(path)) return cache.get(path);
  const source = fs.readFileSync(path, "utf8");
  const javascript = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const moduleRecord = { exports: {} };
  cache.set(path, moduleRecord.exports);
  vm.runInNewContext(javascript, {
    module: moduleRecord,
    exports: moduleRecord.exports,
    require: (specifier) => {
      if (specifier === "server-only") return {};
      assert.ok(specifier.startsWith("."), "Only local modules may be loaded");
      return load(resolve(dirname(path), `${specifier}.ts`));
    },
    process: { env },
    fetch: (...args) => fetchMock(...args),
    TextEncoder, TextDecoder, AbortController, setTimeout, clearTimeout,
  });
  return moduleRecord.exports;
}
const root = process.cwd();
const provider = load(resolve(root, "src/lib/system-health/analysis-provider.ts"));
const contract = load(resolve(root, "src/lib/system-health/analysis-contract.ts"));
const server = load(resolve(root, "src/lib/system-health/analysis-server.ts"));
const pricing = load(resolve(root, "src/lib/ai/openai-pricing-server.ts"));
const input = { environment: "staging", overall_assessment_source: { headline: "No verified incidents", counts: {} }, checks: [] };
const narrative = {
  overall: { headline: "Monitoring incomplete", plain_english: "Some checks are not yet monitored." },
  sections: contract.SYSTEM_HEALTH_ANALYSIS_JSON_SCHEMA.properties.sections.items.properties.section.enum.map((section) => ({
    section, headline: "Monitoring incomplete", plain_english: "Coverage is incomplete.", codex_recommended: false,
  })),
  limitations: ["Advisory summary only."],
};
const usage = { input_tokens: 1000, output_tokens: 500, input_tokens_details: { cached_tokens: 400 } };
function envelope(overrides = {}) {
  return {
    object: "response", status: "completed", error: null, incomplete_details: null, usage,
    output: [{ id: "msg_test", type: "message", role: "assistant", status: "completed", content: [
      { type: "output_text", text: JSON.stringify(narrative), annotations: [], logprobs: [] },
    ] }],
    ...overrides,
  };
}
const jsonResponse = (value) => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
let calls = 0;
let capturedSignal;
fetchMock = async (url, options) => {
  calls++;
  assert.equal(url, "https://api.openai.com/v1/responses");
  assert.equal(options.method, "POST");
  assert.equal(options.cache, "no-store");
  assert.equal(options.redirect, "error");
  assert.equal(options.headers.Authorization, `Bearer ${syntheticKey}`);
  assert.equal(options.headers["Content-Type"], "application/json");
  capturedSignal = options.signal;
  const body = JSON.parse(options.body);
  assert.deepEqual(Object.keys(body).sort(), ["model", "instructions", "input", "store", "stream", "background", "tools", "max_output_tokens", "text"].sort());
  assert.equal(body.model, "gpt-5.6-luna");
  assert.equal(body.store, false);
  assert.equal(body.stream, false);
  assert.equal(body.background, false);
  assert.deepEqual(body.tools, []);
  assert.equal(body.max_output_tokens, 2048);
  assert.match(body.instructions, /untrusted data/);
  assert.deepEqual(body.input, [{ role: "user", content: [{ type: "input_text", text: JSON.stringify(input) }] }]);
  assert.equal(body.text.format.type, "json_schema");
  assert.equal(body.text.format.name, "system_health_analysis");
  assert.equal(body.text.format.strict, true);
  assert.deepEqual(body.text.format.schema, JSON.parse(JSON.stringify(contract.SYSTEM_HEALTH_ANALYSIS_JSON_SCHEMA)));
  for (const schema of [body.text.format.schema, body.text.format.schema.properties.overall, body.text.format.schema.properties.sections.items]) {
    assert.equal(schema.additionalProperties, false);
    assert.deepEqual(schema.required.slice().sort(), Object.keys(schema.properties).sort());
  }
  assert.equal(options.body.includes(syntheticKey), false);
  return jsonResponse(envelope());
};
const adapter = provider.getSystemHealthAnalysisProvider();
const signal = new AbortController().signal;
const result = await adapter.analyze(input, provider.SYSTEM_HEALTH_ANALYSIS_INSTRUCTIONS, signal);
assert.equal(capturedSignal, signal);
assert.equal(result.usage.inputTokens, 1000);
assert.equal(result.usage.outputTokens, 500);
assert.equal(result.usage.cachedInputTokens, 400);
assert.equal(result.usage.costNanoUsd, 728000); // $0.000728
assert.equal(result.usage.pricingStatus, "available");
assert.equal(result.usage.costBasis, "reported_cached_tokens");
assert.equal(JSON.stringify(result).includes(syntheticKey), false);
const browserResult = await server.runSystemHealthAnalysis(input, adapter);
assert.equal(browserResult.overall.level, "monitoring_incomplete");
assert.deepEqual(Object.keys(browserResult).sort(), ["limitations", "overall", "sections"]);
assert.equal(browserResult.sections.every((section) => section.level === "monitoring_incomplete" && section.affected_checks.length === 0), true);
assert.doesNotMatch(JSON.stringify(browserResult), /costNanoUsd|costBasis|pricingStatus|cachedInputTokens|inputTokens|outputTokens|usage/);
assert.equal(calls, 2);

async function rejectsSafely(mock, errorCode = "SYSTEM_HEALTH_ANALYSIS_PROVIDER_OUTPUT_INVALID") {
  fetchMock = mock;
  await assert.rejects(adapter.analyze(input, provider.SYSTEM_HEALTH_ANALYSIS_INSTRUCTIONS, new AbortController().signal), (error) => {
    assert.equal(error.message, errorCode);
    assert.equal(error.cause, undefined);
    assert.equal(error.stack.includes(syntheticKey), false);
    assert.equal(error.stack.includes("raw upstream secret"), false);
    return true;
  });
}
let unexpectedNetworkCall = false;
delete env.OPENAI_API_KEY;
await rejectsSafely(async () => { unexpectedNetworkCall = true; }, "SYSTEM_HEALTH_ANALYSIS_PROVIDER_NOT_CONFIGURED");
assert.equal(unexpectedNetworkCall, false);
env.OPENAI_API_KEY = syntheticKey;
for (const status of [400, 401, 403, 429, 500, 503]) {
  let bodyRead = false;
  let cancelled = false;
  await rejectsSafely(async () => ({ ok: false, body: { cancel: async () => { cancelled = true; } }, json: () => { bodyRead = true; } }));
  assert.equal(bodyRead, false);
  assert.equal(cancelled, true);
  await rejectsSafely(async () => new Response(`raw upstream secret ${syntheticKey}`, { status }));
}
await rejectsSafely(async () => { throw new Error(`raw upstream secret ${syntheticKey}`); });
await rejectsSafely(async () => new Response("not json"));
await rejectsSafely(async () => new Response(new Uint8Array([0xff])));
await rejectsSafely(async () => new Response("x".repeat(provider.MAX_OPENAI_RESPONSE_BYTES + 1)));
await rejectsSafely(async () => jsonResponse(envelope({ padding: "é".repeat(40000) })));
for (const body of [
  null, {}, envelope({ status: "incomplete" }), envelope({ status: "failed" }),
  envelope({ error: { message: "raw upstream secret" } }), envelope({ incomplete_details: { reason: "max_output_tokens" } }),
  envelope({ output: [] }), envelope({ output: [{ type: "function_call" }] }),
  envelope({ output: [...envelope().output, ...envelope().output] }),
  envelope({ output: [{ ...envelope().output[0], role: "user" }] }),
  envelope({ output: [{ ...envelope().output[0], content: [{ type: "refusal", refusal: "raw upstream secret" }] }] }),
  envelope({ output: [{ ...envelope().output[0], content: [{ type: "output_text", text: "not json", annotations: [] }] }] }),
  envelope({ output: [{ ...envelope().output[0], content: [{ type: "output_text", text: "x".repeat(17000), annotations: [] }] }] }),
  envelope({ output: [{ ...envelope().output[0], content: [{ type: "output_text", text: JSON.stringify({ ...narrative, level: "critical" }), annotations: [] }] }] }),
  envelope({ output: [{ ...envelope().output[0], content: [{ type: "output_text", text: JSON.stringify({ ...narrative, sections: [] }), annotations: [] }] }] }),
]) await rejectsSafely(async () => jsonResponse(body));
const reasoning = { type: "reasoning", id: "rs_test", summary: [] };
fetchMock = async () => jsonResponse(envelope({ output: [reasoning, ...envelope().output] }));
await server.runSystemHealthAnalysis(input, adapter);
await rejectsSafely(async () => jsonResponse(envelope({ output: [{ ...reasoning, summary: [{ type: "summary_text", text: "unexpected" }] }, ...envelope().output] })));

for (const invalid of [undefined, null, {}, { input_tokens: -1, output_tokens: 0 }, { input_tokens: 0.5, output_tokens: 0 },
  { input_tokens: "1", output_tokens: 0 }, { input_tokens: 0, output_tokens: -1 }, { input_tokens: 0, output_tokens: Number.MAX_SAFE_INTEGER + 1 },
  { input_tokens: 0, output_tokens: Number.MAX_SAFE_INTEGER }, { ...usage, input_tokens_details: null },
  { ...usage, input_tokens_details: { cached_tokens: -1 } }, { ...usage, input_tokens_details: { cached_tokens: 1001 } },
  { ...usage, input_tokens_details: { cached_tokens: 0.1 } }, { ...usage, input_tokens_details: { cached_tokens: "400" } },
]) await rejectsSafely(async () => jsonResponse(envelope({ usage: invalid })));
for (const details of [undefined, {}]) {
  const parsed = pricing.parseOpenAiRequestUsage({ input_tokens: 1000, output_tokens: 500, ...(details === undefined ? {} : { input_tokens_details: details }) });
  assert.equal(parsed.costNanoUsd, 800000);
  assert.equal(parsed.pricingStatus, "available");
  assert.equal(parsed.costBasis, "standard_input_fallback");
  assert.equal("cachedInputTokens" in parsed, false);
}
for (const tokens of [0, 1000000]) {
  const parsed = pricing.parseOpenAiRequestUsage({ input_tokens: tokens, output_tokens: tokens });
  assert.equal(parsed.inputTokens, tokens);
  assert.equal(parsed.outputTokens, tokens);
  assert.equal(parsed.costNanoUsd, tokens * 1400);
  assert.equal(parsed.pricingStatus, "available");
}
const fullyCached = pricing.parseOpenAiRequestUsage({ ...usage, input_tokens_details: { cached_tokens: 1000 } });
assert.equal(fullyCached.cachedInputTokens, 1000);
assert.equal(fullyCached.costNanoUsd, 620000);
assert.equal(pricing.parseOpenAiRequestUsage({ ...usage, input_tokens_details: { cached_tokens: 0 } }).costNanoUsd, 800000);
assert.equal(pricing.SYSTEM_HEALTH_OPENAI_PRICING.currency, "USD");
assert.equal(pricing.SYSTEM_HEALTH_OPENAI_PRICING.inputCentsPerMillionTokens / 100, 0.20);
assert.equal(pricing.SYSTEM_HEALTH_OPENAI_PRICING.cachedInputCentsPerMillionTokens / 100, 0.02);
assert.equal(pricing.SYSTEM_HEALTH_OPENAI_PRICING.outputCentsPerMillionTokens / 100, 1.20);
assert.equal(Object.isFrozen(pricing.SYSTEM_HEALTH_OPENAI_PRICING), true);
for (const model of ["unknown-model", "gpt-6-luna", "", "GPT-5.6-LUNA"]) {
  assert.throws(() => pricing.parseOpenAiRequestUsage(usage, model), /OPENAI_MODEL_PRICING_UNKNOWN/);
}
assert.throws(() => pricing.parseOpenAiRequestUsage({ input_tokens: Number.MAX_SAFE_INTEGER, output_tokens: 0 }), /OPENAI_COST_OUT_OF_RANGE/);
assert.equal(pricing.parseOpenAiRequestUsage(usage, "gpt-5.6-luna").costNanoUsd, 728000);

// Upstream monetary claims cannot override trusted server rates or calculated cost.
const monetaryClaims = { costNanoUsd: 123, cost_usd: 99, pricingStatus: "provider_override", inputCentsPerMillionTokens: 0 };
const parsedClaims = pricing.parseOpenAiRequestUsage({ ...usage, ...monetaryClaims });
assert.equal(parsedClaims.costNanoUsd, 728000);
assert.equal(parsedClaims.pricingStatus, "available");
assert.equal("cost_usd" in parsedClaims, false);
assert.equal("inputCentsPerMillionTokens" in parsedClaims, false);
fetchMock = async () => jsonResponse(envelope({ ...monetaryClaims, usage: { ...usage, ...monetaryClaims } }));
const claimedResult = await adapter.analyze(input, provider.SYSTEM_HEALTH_ANALYSIS_INSTRUCTIONS, new AbortController().signal);
assert.equal(claimedResult.usage.costNanoUsd, 728000);
assert.equal(claimedResult.usage.pricingStatus, "available");
const claimedBrowserResult = await server.runSystemHealthAnalysis(input, adapter);
assert.doesNotMatch(JSON.stringify(claimedBrowserResult), /costNanoUsd|cost_usd|costBasis|pricingStatus|inputTokens|outputTokens|usage/);
await rejectsSafely(async () => jsonResponse(envelope({ output: [{ ...envelope().output[0], content: [
  { type: "output_text", text: JSON.stringify({ ...narrative, ...monetaryClaims }), annotations: [] },
] }] })));

// Fetch and body-reading must both stay within the existing server timeout.
for (const phase of ["fetch", "body"]) {
  let aborted = false;
  fetchMock = async (_url, options) => {
    capturedSignal = options.signal;
    if (phase === "fetch") return new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => { aborted = true; reject(new Error("synthetic abort")); }, { once: true });
    });
    return new Response(new ReadableStream({ start(controller) {
      options.signal.addEventListener("abort", () => { aborted = true; controller.error(new Error("synthetic abort")); }, { once: true });
    } }));
  };
  await assert.rejects(server.runSystemHealthAnalysis(input, adapter, 5), /SYSTEM_HEALTH_ANALYSIS_PROVIDER_TIMEOUT/);
  assert.equal(capturedSignal.aborted, true);
  assert.equal(aborted, true);
}
for (const path of ["src/lib/system-health/analysis-provider.ts", "src/lib/ai/openai-pricing-server.ts"]) {
  const source = fs.readFileSync(resolve(root, path), "utf8");
  assert.match(source, /import "server-only"/);
  assert.doesNotMatch(source, /console\.|logError|logWarn|NEXT_PUBLIC_OPENAI/);
}
console.log(`PASS: ${relative(root, resolve(root, "src/lib/system-health/analysis-provider.ts"))}: mocked transport, strict schema, deterministic status, private usage/trusted USD pricing, unknown-model rejection, untrusted monetary claims, safe errors, bounded bodies, and timeout/abort. No real credentials or API requests.`);
