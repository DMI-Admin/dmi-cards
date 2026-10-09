import "server-only";

// Application admission limits, not provider contracts or whole-handler cancellation.
// Verified Staging platform limit is 300s. Keep 60s outside our acquisition deadline.
export const ACQUISITION_DEADLINE_MS = 240_000;
// Reserve for remaining consumers, Stripe reads, commit/release and response handling.
// This is an admission reserve, not a guarantee/bound on that subsequent work.
export const ACQUISITION_RESERVE_MS = 120_000;
export const CLAIM_RPC_TIMEOUT_MS = 5_000;
export type AcquisitionOutcome = "timeout_ambiguous" | "budget_exhausted" | "headroom_insufficient";
export type AcquisitionMetadata = {
  consumer: "entitlement" | "finance";
  outcome: AcquisitionOutcome;
  elapsed_ms: number;
  remaining_ms: number;
};
type Clock = {
  now: () => number;
  setTimer: (work: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer: (timer: ReturnType<typeof setTimeout>) => void;
};
export type AcquisitionTiming = {
  readonly ambiguousConsumers: Set<AcquisitionMetadata["consumer"]>;
  readonly startedAt: number;
  readonly deadline: number;
  readonly clock: Clock;
  readonly emit: (metadata: AcquisitionMetadata) => void;
};
export class AcquisitionTimingFailure extends Error {
  constructor(public readonly outcome: AcquisitionOutcome) {
    super("LEASE_ACQUISITION_TIMING_FAILURE");
  }
}
export function createAcquisitionTiming(
  startedAt: number = performance.now(),
  emit: AcquisitionTiming["emit"] = () => {},
  clock: Clock = {now: () => performance.now(), setTimer: setTimeout, clearTimer: clearTimeout},
): AcquisitionTiming {
  return Object.freeze({ambiguousConsumers: new Set<AcquisitionMetadata["consumer"]>(), startedAt, deadline: startedAt + ACQUISITION_DEADLINE_MS, clock, emit});
}

/** Exactly one sent RPC. Abort cannot prove server cancellation; never retry here. */
export async function boundedLeaseAcquisition<T>(
  timing: AcquisitionTiming,
  consumer: AcquisitionMetadata["consumer"],
  send: (signal: AbortSignal) => PromiseLike<T>,
): Promise<T> {
  const now = timing.clock.now();
  const remaining = timing.deadline - now;
  function failure(outcome: AcquisitionOutcome) {
    const current = timing.clock.now();
    if (outcome === "timeout_ambiguous") timing.ambiguousConsumers.add(consumer);
    const safeMilliseconds = (value: number, maximum: number) =>
      Number.isFinite(value) ? Math.max(0, Math.min(maximum, Math.floor(value))) : 0;
    try {
      timing.emit({consumer, outcome,
        elapsed_ms: safeMilliseconds(current - timing.startedAt, 300_000),
        remaining_ms: safeMilliseconds(timing.deadline - current, ACQUISITION_DEADLINE_MS)});
    } catch { /* Diagnostics never affect billing. */ }
    return new AcquisitionTimingFailure(outcome);
  }
  if (timing.ambiguousConsumers.has(consumer)) throw failure("timeout_ambiguous");
  if (![now, timing.startedAt, timing.deadline, remaining].every(Number.isFinite) || now < timing.startedAt || remaining <= 0)
    throw failure("budget_exhausted");
  if (remaining < ACQUISITION_RESERVE_MS + CLAIM_RPC_TIMEOUT_MS)
    throw failure("headroom_insufficient");
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const timeout = new Promise<never>((_, reject) => {
    timer = timing.clock.setTimer(() => {
      timedOut = true;
      reject(failure("timeout_ambiguous"));
      controller.abort();
    }, CLAIM_RPC_TIMEOUT_MS);
  });
  try {
    // Observe late settlements via Promise.race; no callback/mutation runs after timeout.
    const response = Promise.resolve(send(controller.signal));
    const value = await Promise.race([response, timeout]);
    // Check monotonic elapsed time too: event-loop delay may postpone the timer.
    if (timing.clock.now() - now >= CLAIM_RPC_TIMEOUT_MS) {
      controller.abort();
      throw failure("timeout_ambiguous");
    }
    return value;
  } catch (error) {
    if (!(error instanceof AcquisitionTimingFailure) && !timedOut &&
        error instanceof Error && error.name === "AbortError")
      throw failure("timeout_ambiguous");
    throw error;
  } finally {
    if (timer !== undefined) timing.clock.clearTimer(timer);
  }
}
