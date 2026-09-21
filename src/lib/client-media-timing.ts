// Bounded User Timing entries, visible locally in DevTools; never sent/logged.
export function startClientMediaTiming(phase: "publish" | "reconciliation" | "auth" | "session" | "save_response" | "upload_profile" | "upload_logo" | "upload_banner" | "request") {
  const clock = globalThis.performance;
  const start = clock?.now();
  return () => {
    if (start === undefined) return;
    try {
      const name = `dmi-media:${phase}`;
      clock.clearMeasures(name);
      clock.measure(name, { start, end: clock.now() });
    } catch { /* Diagnostics must never affect saving in older browsers. */ }
  };
}
