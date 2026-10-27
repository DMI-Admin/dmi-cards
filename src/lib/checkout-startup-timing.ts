// Shared server/browser diagnostics. Callers enable this only from the exact
// server-side custom-Staging guard. No request, identity or provider data enters
// this boundary; records contain fixed labels and elapsed milliseconds only.
const stages = [
  "page_initialization", "session_request", "client_auth", "auth", "runtime",
  "account_operation", "account_checks", "individual_check", "approved_price", "customer_lookup",
  "customer_prepare", "customer_create", "customer_verify", "customer_bind",
  "subscription_inventory", "session_lookup", "session_retrieve", "checkout_prepare",
  "checkout_touch", "session_create", "attempt_record", "api_response_prepare",
  "stripe_js_load", "stripe_js_overlap", "stripe_js_remaining_after_session", "embedded_initialize", "embedded_mount", "form_ready",
] as const;
export type CheckoutStartupStage = typeof stages[number];
export type CheckoutTiming = <T>(stage: CheckoutStartupStage, run: () => Promise<T>) => Promise<T>;
export function checkoutStartupObserver(enabled: boolean,
  sink: (record: string) => void | PromiseLike<void> = record => { console.info(record); }) {
  if (!enabled) return undefined;
  return (stage: CheckoutStartupStage, duration: number) => {
    try {
      if (!stages.includes(stage) || typeof duration !== "number" || !Number.isFinite(duration) || duration < 0 || duration > 86_400_000) return;
      const pending = sink(JSON.stringify({ component: "checkout_startup", stage, duration_ms: Math.round(duration) }));
      if (pending) void Promise.resolve(pending).catch(() => {});
    } catch { /* Observational only, including hostile sinks. */ }
  };
}
export function checkoutStartupTiming(observe: ReturnType<typeof checkoutStartupObserver>): CheckoutTiming {
  return async (stage, run) => {
    if (!observe) return run();
    const started = performance.now();
    try { return await run(); }
    finally { try { observe(stage, performance.now() - started); } catch { /* Observational only. */ } }
  };
}
