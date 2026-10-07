import "server-only";

import {
  buildValidatedAnalysisResult,
  MAX_ANALYSIS_INPUT_BYTES,
  MAX_PROVIDER_OUTPUT_BYTES,
} from "./analysis-contract";
import type {
  SystemHealthAnalysisInput,
  SystemHealthAnalysisResult,
} from "./analysis-types";
import {
  AnalysisInputTooLargeError,
  AnalysisProviderOutputInvalidError,
  AnalysisProviderTimeoutError,
  SYSTEM_HEALTH_ANALYSIS_INSTRUCTIONS,
  analysisFailureMetadata,
  type AnalysisProviderProgress,
  type SystemHealthAnalysisProvider,
} from "./analysis-provider";

export const SYSTEM_HEALTH_ANALYSIS_TIMEOUT_MS = 8_000;

export async function runSystemHealthAnalysis(
  input: SystemHealthAnalysisInput,
  provider: SystemHealthAnalysisProvider,
  timeoutMs = SYSTEM_HEALTH_ANALYSIS_TIMEOUT_MS
): Promise<SystemHealthAnalysisResult> {
  if (byteLength(input) > MAX_ANALYSIS_INPUT_BYTES) throw new AnalysisInputTooLargeError();
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > SYSTEM_HEALTH_ANALYSIS_TIMEOUT_MS) {
    throw new RangeError("SYSTEM_HEALTH_ANALYSIS_TIMEOUT_INVALID");
  }

  const controller = new AbortController();
  const startedAt = Date.now();
  const progress: AnalysisProviderProgress = { fetch_attempted: false, response_received: false };
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let rawOutput: unknown;
  try {
    const providerResult = await Promise.race([
      provider.analyze(input, SYSTEM_HEALTH_ANALYSIS_INSTRUCTIONS, controller.signal, progress),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new AnalysisProviderTimeoutError(analysisFailureMetadata("timeout", progress, startedAt)));
        }, timeoutMs);
      }),
    ]);
    // Usage/cost stays inside the server-only provider envelope; never return it to the browser.
    rawOutput = providerResult.narrative;
  } finally {
    if (timeout) clearTimeout(timeout);
  }

  if (byteLength(rawOutput) > MAX_PROVIDER_OUTPUT_BYTES) {
    throw new AnalysisProviderOutputInvalidError("response_too_large", progress, startedAt);
  }

  const result = buildValidatedAnalysisResult(rawOutput, input);
  if (!result) throw new AnalysisProviderOutputInvalidError("final_result_invalid", progress, startedAt);
  return result;
}

function byteLength(value: unknown): number {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return Number.POSITIVE_INFINITY;
  }
  return typeof serialized === "string"
    ? new TextEncoder().encode(serialized).byteLength
    : Number.POSITIVE_INFINITY;
}
