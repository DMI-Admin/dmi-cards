export const ADMIN_MONTHLY_AI_BUDGET_PENCE = 5_000;
export const INDIVIDUAL_PRO_MONTHLY_AI_CEILING_PENCE = 50;
export const MICRO_PENCE_PER_PENCE = 1_000_000;

export const aiFeatures = [
  "system_health",
  "finance_insight",
  "subscription_insight",
  "business_onboarding",
  "admin_assistant",
  "card_writing",
  "card_design",
  "analytics_summary",
  "lead_insight",
] as const;

export type AiFeature = (typeof aiFeatures)[number];

export type AiUsageScope =
  | { type: "admin" }
  | { type: "individual_pro"; userId: string };

export type AiTokenUsage = {
  inputTokens: number;
  outputTokens: number;
};

export type AiModelPricing = {
  inputPencePerMillionTokens: number;
  outputPencePerMillionTokens: number;
};

export type AiModelPricingCatalog = Readonly<Record<string, AiModelPricing>>;

export type AiUsageEntry = {
  scope: AiUsageScope;
  period: string;
  feature: AiFeature;
  costMicroPence: number;
};

export type AiBudgetPolicy = {
  adminMonthlyPence: number;
  individualProMonthlyPence: number;
  featureMonthlyPence?: Partial<Record<AiFeature, number>>;
};

export type AiRequestDecision =
  | { allowed: true; remainingMicroPence: number }
  | {
      allowed: false;
      reason: "monthly_budget_exceeded" | "feature_budget_exceeded" | "invalid_request";
      remainingMicroPence: number;
    };

export const DEFAULT_AI_BUDGET_POLICY: AiBudgetPolicy = {
  adminMonthlyPence: ADMIN_MONTHLY_AI_BUDGET_PENCE,
  individualProMonthlyPence: INDIVIDUAL_PRO_MONTHLY_AI_CEILING_PENCE,
};

export const EMPTY_AI_MODEL_PRICING_CATALOG: AiModelPricingCatalog = Object.freeze({});

export function isAiFeature(value: unknown): value is AiFeature {
  return typeof value === "string" && aiFeatures.includes(value as AiFeature);
}

export function calculateAiCostMicroPence(
  model: string,
  tokenUsage: unknown,
  pricingCatalog: AiModelPricingCatalog
): number {
  if (!hasExactProperties(tokenUsage, ["inputTokens", "outputTokens"])) {
    throw new TypeError("AI token usage must contain only inputTokens and outputTokens.");
  }
  const { inputTokens, outputTokens } = tokenUsage;
  if (!isTokenCount(inputTokens) || !isTokenCount(outputTokens)) {
    throw new TypeError("AI token counts must be non-negative safe integers.");
  }

  const pricing = pricingCatalog[model];
  if (!pricing || !isPricing(pricing)) {
    throw new TypeError("AI model is not present in the trusted pricing catalog.");
  }

  const cost = BigInt(inputTokens) * BigInt(pricing.inputPencePerMillionTokens) +
    BigInt(outputTokens) * BigInt(pricing.outputPencePerMillionTokens);
  if (cost > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("Calculated AI cost exceeds the supported integer range.");
  }
  return Number(cost);
}

export function remainingAiBudgetMicroPence(
  scope: AiUsageScope,
  period: string,
  entries: readonly AiUsageEntry[],
  policy: AiBudgetPolicy = DEFAULT_AI_BUDGET_POLICY,
  feature?: AiFeature
): number {
  if (
    !isAiUsageScope(scope) ||
    !isMonthPeriod(period) ||
    !isValidPolicy(policy) ||
    (feature !== undefined && !isAiFeature(feature)) ||
    !entries.every(isUsageEntry)
  ) {
    throw new TypeError("AI budget query is invalid.");
  }
  const ceiling = budgetCeilingMicroPence(scope, policy, feature);
  const used = usageForScope(scope, period, entries, feature);
  return Math.max(0, ceiling - used);
}

export function isAiRequestAllowed(
  scope: AiUsageScope,
  feature: AiFeature,
  period: string,
  reservedCostMicroPence: number,
  entries: readonly AiUsageEntry[],
  policy: AiBudgetPolicy = DEFAULT_AI_BUDGET_POLICY
): AiRequestDecision {
  if (
    !isAiUsageScope(scope) ||
    !isAiFeature(feature) ||
    !isMonthPeriod(period) ||
    !Number.isSafeInteger(reservedCostMicroPence) ||
    reservedCostMicroPence < 0 ||
    !isValidPolicy(policy) ||
    !entries.every(isUsageEntry)
  ) {
    return { allowed: false, reason: "invalid_request", remainingMicroPence: 0 };
  }

  const monthlyRemaining = remainingAiBudgetMicroPence(scope, period, entries, policy);
  const featureRemaining = remainingAiBudgetMicroPence(scope, period, entries, policy, feature);
  if (reservedCostMicroPence > monthlyRemaining) {
    return {
      allowed: false,
      reason: "monthly_budget_exceeded",
      remainingMicroPence: monthlyRemaining,
    };
  }
  if (reservedCostMicroPence > featureRemaining) {
    return {
      allowed: false,
      reason: "feature_budget_exceeded",
      remainingMicroPence: featureRemaining,
    };
  }
  return { allowed: true, remainingMicroPence: monthlyRemaining - reservedCostMicroPence };
}

export function recordAiUsage(
  scope: AiUsageScope,
  feature: AiFeature,
  period: string,
  costMicroPence: number,
  entries: readonly AiUsageEntry[],
  policy: AiBudgetPolicy = DEFAULT_AI_BUDGET_POLICY
): AiUsageEntry {
  if (
    !isAiUsageScope(scope) ||
    !isAiFeature(feature) ||
    !isMonthPeriod(period) ||
    !Number.isSafeInteger(costMicroPence) ||
    costMicroPence < 0
  ) {
    throw new TypeError("AI usage entry is invalid.");
  }
  const decision = isAiRequestAllowed(scope, feature, period, costMicroPence, entries, policy);
  if (!decision.allowed) throw new RangeError(decision.reason);
  return { scope: { ...scope }, period, feature, costMicroPence };
}

function budgetCeilingMicroPence(
  scope: AiUsageScope,
  policy: AiBudgetPolicy,
  feature?: AiFeature
): number {
  if (!isAiUsageScope(scope) || !isValidPolicy(policy) || (feature !== undefined && !isAiFeature(feature))) {
    return 0;
  }
  const monthlyPence = scope.type === "admin"
    ? policy.adminMonthlyPence
    : policy.individualProMonthlyPence;
  const featureLimitPence = feature === undefined
    ? undefined
    : policy.featureMonthlyPence?.[feature];
  return Math.min(monthlyPence, featureLimitPence ?? monthlyPence) * MICRO_PENCE_PER_PENCE;
}

function usageForScope(
  scope: AiUsageScope,
  period: string,
  entries: readonly AiUsageEntry[],
  feature?: AiFeature
): number {
  let used = BigInt(0);
  for (const entry of entries) {
    if (
      sameScope(scope, entry.scope) &&
      entry.period === period &&
      (feature === undefined || entry.feature === feature)
    ) {
      used += BigInt(entry.costMicroPence);
    }
  }
  return used > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(used);
}

function sameScope(left: AiUsageScope, right: AiUsageScope): boolean {
  return left.type === right.type &&
    (left.type === "admin" ||
      (right.type === "individual_pro" && left.userId === right.userId));
}

function isAiUsageScope(value: unknown): value is AiUsageScope {
  if (!isRecord(value)) return false;
  if (value.type === "admin") return hasExactProperties(value, ["type"]);
  return value.type === "individual_pro" &&
    hasExactProperties(value, ["type", "userId"]) &&
    typeof value.userId === "string" &&
    value.userId.trim().length > 0;
}

function isUsageEntry(value: unknown): value is AiUsageEntry {
  return isRecord(value) &&
    hasExactProperties(value, ["scope", "period", "feature", "costMicroPence"]) &&
    isAiUsageScope(value.scope) &&
    isMonthPeriod(value.period) &&
    isAiFeature(value.feature) &&
    Number.isSafeInteger(value.costMicroPence) &&
    (value.costMicroPence as number) >= 0;
}

function isPricing(value: unknown): value is AiModelPricing {
  return isRecord(value) &&
    hasExactProperties(value, ["inputPencePerMillionTokens", "outputPencePerMillionTokens"]) &&
    isNonNegativeSafeInteger(value.inputPencePerMillionTokens) &&
    isNonNegativeSafeInteger(value.outputPencePerMillionTokens);
}

function isValidPolicy(value: unknown): value is AiBudgetPolicy {
  const maxPence = Math.floor(Number.MAX_SAFE_INTEGER / MICRO_PENCE_PER_PENCE);
  if (
    !isRecord(value) ||
    !isBudgetPence(value.adminMonthlyPence, maxPence) ||
    !isBudgetPence(value.individualProMonthlyPence, maxPence) ||
    Object.keys(value).some((key) =>
      key !== "adminMonthlyPence" &&
      key !== "individualProMonthlyPence" &&
      key !== "featureMonthlyPence"
    )
  ) return false;
  if (value.featureMonthlyPence === undefined) return true;
  if (!isRecord(value.featureMonthlyPence)) return false;
  return Object.entries(value.featureMonthlyPence).every(([feature, limit]) =>
    isAiFeature(feature) && isBudgetPence(limit, maxPence)
  );
}

function isBudgetPence(value: unknown, maxPence: number): value is number {
  return isNonNegativeSafeInteger(value) && value <= maxPence;
}

function isTokenCount(value: unknown): value is number {
  return isNonNegativeSafeInteger(value);
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isMonthPeriod(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return false;
  return true;
}

function hasExactProperties(
  value: unknown,
  properties: readonly string[]
): value is Record<string, unknown> {
  return isRecord(value) &&
    Object.keys(value).length === properties.length &&
    Object.keys(value).every((property) => properties.includes(property));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
