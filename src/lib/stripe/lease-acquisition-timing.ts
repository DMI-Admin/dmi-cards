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

// Staging webhook opt-in only. A timing context alone does not enable retries.
export const LEASE_ACQUISITION_ATTEMPTS = 3;
export const LEASE_RETRY_MAX_WAIT_MS = 400;
export type LeaseRetryOutcome = "acquired_after_retry" | "retry_exhausted" | "budget_exhausted" | "non_busy_failure";
export type LeaseRetryMetadata = {
  consumer: AcquisitionMetadata["consumer"];
  lease_kind: "account" | "scope" | "customer";
  attempts_used: number;
  retries_used: number;
  deliberate_wait_ms: number;
  elapsed_ms: number;
  outcome: LeaseRetryOutcome;
};
export type LeaseRetryPolicy = {
  readonly timing: AcquisitionTiming;
  readonly jitter: () => number;
  readonly emit: (metadata: LeaseRetryMetadata) => void;
};
export function createLeaseRetryPolicy(
  timing: AcquisitionTiming,
  emit: LeaseRetryPolicy["emit"] = () => {},
  jitter: () => number = () => Math.floor(Math.random() * 51),
): LeaseRetryPolicy {
  return Object.freeze({timing, emit, jitter});
}
function retryHeadroom(timing: AcquisitionTiming, consumer: AcquisitionMetadata["consumer"], delay: number): boolean {
  const now = timing.clock.now();
  return !timing.ambiguousConsumers.has(consumer) &&
    [now, timing.startedAt, timing.deadline, delay].every(Number.isFinite) &&
    now >= timing.startedAt && delay >= 0 &&
    timing.deadline - now >= ACQUISITION_RESERVE_MS + CLAIM_RPC_TIMEOUT_MS + delay;
}

/** Only acquire() repeats. The caller owns callback, commit and release outside this loop. */
export async function acquireLeaseWithRetry<T>(
  policy: LeaseRetryPolicy,
  consumer: AcquisitionMetadata["consumer"],
  acquire: () => Promise<T>,
  isDefinitivelyBusy: (error: unknown) => boolean,
): Promise<T> {
  const {timing} = policy;
  const startedAt = timing.clock.now();
  let attempts = 0, wait = 0;
  let lastBusy: unknown;
  function emit(outcome: LeaseRetryOutcome) {
    const elapsed = timing.clock.now() - startedAt;
    try {
      policy.emit({consumer, lease_kind: consumer === "entitlement" ? "account" : "scope",
        attempts_used: attempts, retries_used: Math.max(0, attempts - 1),
        deliberate_wait_ms: wait,
        elapsed_ms: Number.isFinite(elapsed) ? Math.max(0, Math.min(300_000, Math.floor(elapsed))) : 0,
        outcome});
    } catch { /* Diagnostics must never change billing outcomes. */ }
  }
  while (attempts < LEASE_ACQUISITION_ATTEMPTS) {
    if (attempts > 0 && !retryHeadroom(timing, consumer, 0)) {
      emit("budget_exhausted"); throw lastBusy;
    }
    attempts++;
    try {
      const lease = await acquire();
      if (attempts > 1) emit("acquired_after_retry");
      return lease;
    } catch (error) {
      if (timing.ambiguousConsumers.has(consumer) || !isDefinitivelyBusy(error)) {
        if (attempts > 1) emit("non_busy_failure");
        throw error;
      }
      lastBusy = error;
      if (attempts === LEASE_ACQUISITION_ATTEMPTS) {
        emit("retry_exhausted"); throw error;
      }
      let jitter: number;
      try { jitter = policy.jitter(); } catch { emit("non_busy_failure"); throw error; }
      if (!Number.isFinite(jitter)) { emit("non_busy_failure"); throw error; }
      const delay = (attempts === 1 ? 100 : 200) + Math.max(0, Math.min(50, Math.floor(jitter)));
      if (wait + delay > LEASE_RETRY_MAX_WAIT_MS || !retryHeadroom(timing, consumer, delay)) {
        emit("budget_exhausted"); throw error;
      }
      await new Promise<void>(resolve => timing.clock.setTimer(resolve, delay));
      wait += delay;
    }
  }
  // The third busy attempt throws above; never start a fourth acquisition.
  throw lastBusy;
}
