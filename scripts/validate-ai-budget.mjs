import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync("src/lib/ai/budget.ts", "utf8");
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleRecord = { exports: {} };
vm.runInNewContext(javascript, {
  exports: moduleRecord.exports,
  module: moduleRecord,
  BigInt,
  Number,
  Object,
  Array,
  Set,
  Math,
  TypeError,
  RangeError,
});

const budget = moduleRecord.exports;
const admin = { type: "admin" };
const alice = { type: "individual_pro", userId: "alice-internal-id" };
const bob = { type: "individual_pro", userId: "bob-internal-id" };
const period = "2026-10";
const modelPricing = Object.freeze({
  "test-model-v1": Object.freeze({
    inputPencePerMillionTokens: 2_000,
    outputPencePerMillionTokens: 8_000,
  }),
});

assert.equal(budget.ADMIN_MONTHLY_AI_BUDGET_PENCE, 5_000);
assert.equal(budget.INDIVIDUAL_PRO_MONTHLY_AI_CEILING_PENCE, 50);
assert.deepEqual(JSON.parse(JSON.stringify(budget.aiFeatures)), [
  "system_health",
  "finance_insight",
  "subscription_insight",
  "business_onboarding",
  "admin_assistant",
  "card_writing",
  "card_design",
  "analytics_summary",
  "lead_insight",
]);
assert.equal(budget.isAiFeature("system_health"), true);
assert.equal(budget.isAiFeature("unknown_feature"), false);
assert.equal(budget.remainingAiBudgetMicroPence(admin, period, []), 5_000_000_000);
assert.equal(budget.remainingAiBudgetMicroPence(alice, period, []), 50_000_000);

const usage = [
  { scope: admin, period, feature: "finance_insight", costMicroPence: 4_000_000_000 },
  { scope: alice, period, feature: "card_writing", costMicroPence: 30_000_000 },
  { scope: bob, period, feature: "card_writing", costMicroPence: 50_000_000 },
];
assert.equal(budget.remainingAiBudgetMicroPence(admin, period, usage), 1_000_000_000);
assert.equal(budget.remainingAiBudgetMicroPence(alice, period, usage), 20_000_000);
assert.equal(budget.remainingAiBudgetMicroPence(bob, period, usage), 0);
assert.equal(budget.remainingAiBudgetMicroPence(
  { type: "individual_pro", userId: "charlie-internal-id" },
  period,
  usage
), 50_000_000);
assert.equal(budget.remainingAiBudgetMicroPence(alice, period, usage), 20_000_000);
assert.equal(budget.remainingAiBudgetMicroPence(bob, period, usage), 0);
assert.equal(budget.remainingAiBudgetMicroPence(alice, "2026-11", usage), 50_000_000);

assert.deepEqual(
  JSON.parse(JSON.stringify(budget.isAiRequestAllowed(
    admin,
    "system_health",
    period,
    1_000_000_001,
    usage
  ))),
  { allowed: false, reason: "monthly_budget_exceeded", remainingMicroPence: 1_000_000_000 }
);
assert.equal(budget.isAiRequestAllowed(alice, "card_writing", period, 20_000_001, usage).allowed, false);
assert.equal(budget.isAiRequestAllowed(alice, "card_design", period, 20_000_000, usage).allowed, true);
assert.equal(budget.isAiRequestAllowed(bob, "card_writing", period, 1, usage).allowed, false);
assert.equal(budget.remainingAiBudgetMicroPence(alice, period, [
  { scope: alice, period, feature: "card_writing", costMicroPence: 500_000_000 },
]), 0);

const featureLimitedPolicy = {
  ...budget.DEFAULT_AI_BUDGET_POLICY,
  featureMonthlyPence: { card_writing: 10 },
};
const featureUsage = [{ scope: alice, period, feature: "card_writing", costMicroPence: 9_000_000 }];
assert.equal(budget.remainingAiBudgetMicroPence(alice, period, featureUsage, featureLimitedPolicy, "card_writing"), 1_000_000);
assert.equal(budget.isAiRequestAllowed(alice, "card_writing", period, 1_000_001, featureUsage, featureLimitedPolicy).reason, "feature_budget_exceeded");
assert.equal(budget.isAiRequestAllowed(alice, "card_design", period, 1_000_001, featureUsage, featureLimitedPolicy).allowed, true);

assert.equal(
  budget.calculateAiCostMicroPence(
    "test-model-v1",
    { inputTokens: 1_000, outputTokens: 500 },
    modelPricing
  ),
  6_000_000
);
assert.equal(
  budget.calculateAiCostMicroPence(
    "test-model-v1",
    { inputTokens: 1_000, outputTokens: 500 },
    modelPricing
  ),
  6_000_000
);
assert.throws(() => budget.calculateAiCostMicroPence(
  "unknown-model",
  { inputTokens: 1, outputTokens: 1 },
  modelPricing
), /trusted pricing catalog/i);
assert.throws(() => budget.calculateAiCostMicroPence(
  "test-model-v1",
  { inputTokens: 1, outputTokens: 1, costPence: 0 },
  modelPricing
), /only inputTokens and outputTokens/i);
assert.throws(() => budget.calculateAiCostMicroPence(
  "test-model-v1",
  { inputTokens: -1, outputTokens: 1 },
  modelPricing
), /non-negative safe integers/i);
assert.throws(() => budget.calculateAiCostMicroPence(
  "test-model-v1",
  { inputTokens: 0, outputTokens: 0 },
  budget.EMPTY_AI_MODEL_PRICING_CATALOG
), /trusted pricing catalog/i);
assert.equal(budget.isAiRequestAllowed(alice, "unknown_feature", 0, usage).allowed, false);

assert.throws(() => budget.recordAiUsage(
  alice,
  "card_writing",
  period,
  20_000_001,
  usage
), /monthly_budget_exceeded|feature_budget_exceeded/);
assert.throws(() => budget.recordAiUsage(
  { type: "individual_pro", userId: " " },
  "card_writing",
  period,
  0,
  []
), /invalid/i);

console.log("PASS: Admin/Pro budget separation, per-user isolation, feature sublimits, non-negative remaining budgets, hard request gates, deterministic token pricing, and rejection of untrusted cost/model data.");
