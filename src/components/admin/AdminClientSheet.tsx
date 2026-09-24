"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import styles from "./AdminClientsPage.module.css";

// Native modal dialogs provide inert background content, focus containment and
// focus restoration. Keeping the component mounted allows create → success.
export default function AdminClientSheet({ title, children, onClose, busy = false, wide = false, confirm = false, notice }: {
  title: string; children: ReactNode; onClose: () => void; busy?: boolean; wide?: boolean; confirm?: boolean; notice?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  useEffect(() => {
    const node = dialog.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (node && !node.open) node.showModal();
    return () => { node?.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  return (
    <dialog ref={dialog} aria-labelledby={heading} aria-busy={busy}
      className={[styles.sheet, wide ? styles.wideSheet : "", confirm ? styles.confirmSheet : ""].join(" ")}
      onKeyDown={event => {
        if (event.key !== "Tab") return;
        const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex="0"]')]
          .filter(node => !node.matches(":disabled") && node.offsetParent !== null);
        const first = controls[0], last = controls.at(-1);
        if (!first) { event.preventDefault(); return; }
        if (event.shiftKey && (document.activeElement === first || !event.currentTarget.contains(document.activeElement))) {
          event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first.focus();
        }
      }}
      onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
      <header className={styles.sheetHeader}>
        <h2 id={heading}>{title}</h2>
        <button type="button" disabled={busy} onClick={onClose} aria-label={`Close ${title}`}>×</button>
      </header>
      <div className={styles.sheetBody}>{notice && <p role="status" className={styles.inlineNotice}>{notice}</p>}{children}</div>
    </dialog>
  );
}
