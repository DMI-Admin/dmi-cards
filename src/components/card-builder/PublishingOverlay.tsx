"use client";

import { useEffect, useRef } from "react";
import styles from "./PublishingOverlay.module.css";

export default function PublishingOverlay({ finishing, onFinished }: {
  finishing: boolean;
  onFinished: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    panel.current?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  useEffect(() => {
    if (!finishing) return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const finishIfStatic = () => { if (preference.matches || document.hidden) onFinished(); };
    if (preference.matches || document.hidden) { onFinished(); return; }
    preference.addEventListener("change", finishIfStatic);
    document.addEventListener("visibilitychange", finishIfStatic);
    // Animation events can be suppressed by the browser. Never hold success indefinitely.
    const fallback = window.setTimeout(onFinished, 1900);
    return () => {
      window.clearTimeout(fallback);
      preference.removeEventListener("change", finishIfStatic);
      document.removeEventListener("visibilitychange", finishIfStatic);
    };
  }, [finishing, onFinished]);
  return (
    <div ref={panel} className={styles.backdrop} role="dialog" aria-modal="true"
      aria-labelledby="publishing-heading" aria-describedby="publishing-support" tabIndex={-1}
      onKeyDown={event => { if (event.key === "Tab" || event.key === "Escape") event.preventDefault(); }}>
      <div className={styles.card} role="status" aria-live="polite">
        <svg className={styles.mark} viewBox="0 0 600 600" aria-hidden="true">
          <use href="/devmaster-publishing-outline.svg#devmaster-mark" className={styles.outline} />
          <use href="/devmaster-publishing-outline.svg#devmaster-mark" className={styles.trace}
            onAnimationIteration={() => { if (finishing) onFinished(); }} />
        </svg>
        <h2 id="publishing-heading" className={styles.heading}>Publishing your card…</h2>
        <p id="publishing-support" className={styles.support}>Saving your latest changes and media.</p>
        <ul className={styles.stages} aria-label="Publishing stages">
          <li>Uploading media</li>
          <li>Saving changes</li>
          <li>Finalising</li>
        </ul>
        <p className={styles.notice}>Please don’t close this window or navigate away.</p>
      </div>
    </div>
  );
}
