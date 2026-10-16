export type ActivationState = "checking" | "activating" | "delayed" | "ready" | "waiting" | "unavailable";

// One request at a time, one bounded window, no detached work. Injectable
// boundaries allow lifecycle tests without Stripe, a database, or real timers.
export function startActivationPolling(options: {
  acknowledge: (signal: AbortSignal) => Promise<boolean>;
  readReady: (signal: AbortSignal) => Promise<boolean>;
  onState: (state: ActivationState) => void;
  onReady: () => void;
  schedule?: typeof setTimeout;
  cancel?: typeof clearTimeout;
}) {
  const schedule = options.schedule || setTimeout;
  const cancel = options.cancel || clearTimeout;
  const controller = new AbortController();
  let stopped = false;
  let acknowledged = false;
  let slow = false;
  let next: ReturnType<typeof setTimeout> | undefined;
  const emit = (state: ActivationState) => { if (!stopped) options.onState(state); };
  const stop = () => { stopped = true; controller.abort(); cancel(next); cancel(phase); cancel(deadline); };
  const deadline = schedule(() => {
    emit(acknowledged ? "waiting" : "unavailable");
    stop();
  }, 90000);
  // Switching cadence never aborts or overlaps an in-flight read. A pending
  // fast timer is replaced; an active read schedules its slow successor itself.
  const phase = schedule(() => {
    if (stopped) return;
    slow = true;
    if (acknowledged) emit("delayed");
    if (next !== undefined) { cancel(next); next = schedule(runPoll, 4000); }
  }, 20000);
  const runPoll = () => { next = undefined; void poll(); };
  const poll = async () => {
    try {
      if (await options.readReady(controller.signal)) {
        if (stopped) return;
        cancel(phase);
        cancel(deadline);
        emit("ready");
        next = schedule(() => { if (!stopped) options.onReady(); stop(); }, 250);
        return;
      }
    } catch { /* Temporary read failure stays pending until the bounded deadline. */ }
    if (!stopped) next = schedule(runPoll, slow ? 4000 : 1000);
  };
  emit("checking");
  void (async () => {
    try {
      acknowledged = await options.acknowledge(controller.signal);
      if (stopped) return;
      if (!acknowledged) { emit("unavailable"); stop(); return; }
      emit(slow ? "delayed" : "activating");
      await poll();
    } catch { if (!stopped) { emit("unavailable"); stop(); } }
  })();
  return stop;
}
