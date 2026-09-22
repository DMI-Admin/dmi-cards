"use client";

import { useContext, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { CardReadinessReporter } from "@/lib/page-card-readiness";
import { watchCardImages } from "@/lib/card-media-readiness";

/** The real layout determines sizing and starts requests; the overlay has no content semantics. */
export default function CardReadyBoundary({ children, hasMedia }: { children: ReactNode; hasMedia: boolean }) {
  const reportReady = useContext(CardReadinessReporter);
  const reporter = useRef(reportReady);
  useLayoutEffect(() => { reporter.current = reportReady; }, [reportReady]);
  const root = useRef<HTMLDivElement>(null);
  const watcher = useRef<ReturnType<typeof watchCardImages> | null>(null);
  const [ready, setReady] = useState(!hasMedia);
  useLayoutEffect(() => {
    if (!root.current) return;
    watcher.current = watchCardImages(root.current, value => { setReady(value); reporter.current?.(value); });
    return () => { watcher.current?.(); watcher.current = null; };
  }, []);
  // Reconcile React replacements before paint; the observer also handles blob arrival.
  useLayoutEffect(() => { watcher.current?.refresh(); });
  return <div className="relative w-full" aria-busy={!ready} data-card-ready={ready}>
    <div ref={root} inert={!ready} aria-hidden={!ready || undefined}
      style={{ visibility: ready ? "visible" : "hidden" }}>
      {children}
    </div>
    {!ready && <div aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[inherit] bg-slate-100"
      style={{ borderRadius: "1.75rem", background: "linear-gradient(135deg, #f1f5f9, #e2e8f0)" }} />}
  </div>;
}
