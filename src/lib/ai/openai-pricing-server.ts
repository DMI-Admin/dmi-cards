import "server-only";

export const SYSTEM_HEALTH_OPENAI_MODEL = "gpt-5.6-luna";

// Explicitly approved standard text API rates, in USD cents per million tokens.
// No currency conversion or model fallback is permitted.
export const SYSTEM_HEALTH_OPENAI_PRICING = Object.freeze({
  currency: "USD",
  inputCentsPerMillionTokens: 20,
  cachedInputCentsPerMillionTokens: 2,
  outputCentsPerMillionTokens: 120,
});

export type OpenAiRequestUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  // 1 USD = 1,000,000,000 nano-USD. No FX conversion.
  costNanoUsd: number;
  pricingStatus: "available";
  costBasis: "reported_cached_tokens" | "standard_input_fallback";
};

export function parseOpenAiRequestUsage(
  value: unknown,
  model: string = SYSTEM_HEALTH_OPENAI_MODEL
): OpenAiRequestUsage {
  if (model !== SYSTEM_HEALTH_OPENAI_MODEL) throw new TypeError("OPENAI_MODEL_PRICING_UNKNOWN");
  if (!isRecord(value) || !isCount(value.input_tokens) || !isCount(value.output_tokens)) {
    throw new TypeError("OPENAI_TOKEN_USAGE_INVALID");
  }
  let cachedInputTokens: number | undefined;
  if (value.input_tokens_details !== undefined) {
    if (!isRecord(value.input_tokens_details)) throw new TypeError("OPENAI_TOKEN_USAGE_INVALID");
    const cached = value.input_tokens_details.cached_tokens;
    if (cached !== undefined) {
      if (!isCount(cached) || cached > value.input_tokens) {
        throw new TypeError("OPENAI_TOKEN_USAGE_INVALID");
      }
      cachedInputTokens = cached;
    }
  }
  const pricing = SYSTEM_HEALTH_OPENAI_PRICING;
  // One USD cent per million tokens equals ten nano-USD per token.
  // Missing cache detail conservatively uses the standard input rate, without fabricating usage.
  const cached = cachedInputTokens ?? 0;
  const cost = BigInt(value.input_tokens - cached) * BigInt(pricing.inputCentsPerMillionTokens * 10) +
    BigInt(cached) * BigInt(pricing.cachedInputCentsPerMillionTokens * 10) +
    BigInt(value.output_tokens) * BigInt(pricing.outputCentsPerMillionTokens * 10);
  if (cost > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError("OPENAI_COST_OUT_OF_RANGE");
  return {
    inputTokens: value.input_tokens,
    outputTokens: value.output_tokens,
    ...(cachedInputTokens === undefined ? {} : { cachedInputTokens }),
    costNanoUsd: Number(cost),
    pricingStatus: "available",
    costBasis: cachedInputTokens === undefined ? "standard_input_fallback" : "reported_cached_tokens",
  };
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
