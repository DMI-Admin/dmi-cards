"use client";
import { useCallback, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { CardReadinessReporter, PageCardReadiness, initialCardsSettled } from "@/lib/page-card-readiness";

/** One initial content-area reveal; no fetches, timers, or global-shell changes. */
export default function InitialCardsReadyBoundary({ children, resolved, expected, generation }: {
  children: ReactNode; resolved: boolean; expected: string[]; generation: object;
}) {
  const [revealed, setRevealed] = useState(false);
  const [reports, setReports] = useState(new Map<object, Map<string, boolean>>());
  const report = useCallback((id: string, ready: boolean) => {
    if (revealed) return;
    setReports(previous => {
      const current = previous.get(generation);
      if (current?.get(id) === ready) return previous;
      const next = new Map(previous);
      next.set(generation, new Map(current).set(id, ready));
      return next;
    });
  }, [generation, revealed]);
  const ready = revealed || initialCardsSettled(resolved, expected, reports.get(generation) || new Map());
  // Latch during render so a subsequent refresh cannot re-conceal this page.
  if (ready && !revealed) setRevealed(true);
  return <PageCardReadiness.Provider value={report}>
    <div className="relative min-h-[20rem]" aria-busy={!ready}>
      <div inert={!ready} aria-hidden={!ready || undefined} style={{ visibility: ready ? "visible" : "hidden", opacity: ready ? 1 : 0 }}>
        {children}
      </div>
      {!ready && <div role="status" aria-live="polite" className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[var(--dmi-bg)]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/dmi-cards-logo.svg" alt="" width={160} height={64} className="h-16 w-40 object-contain motion-safe:animate-pulse" />
        <span className="text-sm text-[var(--text-secondary)]">Loading your cards…</span>
      </div>}
    </div>
  </PageCardReadiness.Provider>;
}

export function InventoryCardReadiness({ id, unavailable, children }: { id: string; unavailable: boolean; children: ReactNode }) {
  const report = useContext(PageCardReadiness);
  const reportCard = useMemo(() => report ? (ready: boolean) => report(id, ready) : null, [report, id]);
  useLayoutEffect(() => { if (unavailable) reportCard?.(true); }, [unavailable, reportCard]);
  return <CardReadinessReporter.Provider value={reportCard}>{children}</CardReadinessReporter.Provider>;
}
