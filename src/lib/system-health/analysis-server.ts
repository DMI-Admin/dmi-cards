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
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let rawOutput: unknown;
  try {
    rawOutput = await Promise.race([
      provider.analyze(input, SYSTEM_HEALTH_ANALYSIS_INSTRUCTIONS, controller.signal),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new AnalysisProviderTimeoutError());
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }

  if (byteLength(rawOutput) > MAX_PROVIDER_OUTPUT_BYTES) {
    throw new AnalysisProviderOutputInvalidError();
  }

  const result = buildValidatedAnalysisResult(rawOutput, input);
  if (!result) throw new AnalysisProviderOutputInvalidError();
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
