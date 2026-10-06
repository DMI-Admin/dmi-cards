"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Menu, X } from "lucide-react";
import Sidebar from "@/components/Sidebar";
import styles from "./AdminShell.module.css";

export default function AdminShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const menu = useRef<HTMLButtonElement>(null);
  const dialogId = useId();
  useEffect(() => {
    if (!open) return;
    const node = dialog.current;
    if (!node) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : menu.current;
    const overflow = document.body.style.overflow;
    const htmlOverflow = document.documentElement.style.overflow;
    node.showModal();
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    node.querySelector<HTMLButtonElement>("button")?.focus();
    const desktop = window.matchMedia("(min-width: 1200px)");
    const closeOnDesktop = () => { if (desktop.matches) setOpen(false); };
    desktop.addEventListener("change", closeOnDesktop);
    closeOnDesktop();
    return () => {
      desktop.removeEventListener("change", closeOnDesktop);
      node.close();
      document.body.style.overflow = overflow;
      document.documentElement.style.overflow = htmlOverflow;
      if (previous?.isConnected) previous.focus();
    };
  }, [open]);

  return <div className={styles.shell}>
    <div className={styles.desktop}><Sidebar variant="compact" /></div>
    <div className={styles.workspace}>
      <div className={styles.mobileBar}>
        <span>DMI Cards <span className={styles.muted}>Admin</span></span>
        <button ref={menu} type="button" aria-haspopup="dialog" aria-controls={dialogId} aria-expanded={open} onClick={() => setOpen(true)}><Menu size={18} aria-hidden="true" /> Menu</button>
      </div>
      <main className={styles.content}>{children}</main>
    </div>
    {open && <dialog ref={dialog} id={dialogId} aria-label="Admin navigation" className={styles.drawer}
      onCancel={event => { event.preventDefault(); setOpen(false); }}
      onClick={event => {
        if (event.target === event.currentTarget) {
          const bounds = event.currentTarget.getBoundingClientRect();
          if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) setOpen(false);
        }
        if (event.target instanceof Element && event.target.closest("a[href]")) setOpen(false);
      }}
      onKeyDown={event => {
        if (event.key !== "Tab") return;
        const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('a[href],button:not(:disabled)')].filter(node => node.getClientRects().length);
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}>
      <div className={styles.drawerHeader}><span>Navigation</span><button type="button" aria-label="Close Admin navigation" onClick={() => setOpen(false)}><X size={18} aria-hidden="true" /></button></div>
      <div className={styles.drawerNavigation}><Sidebar variant="compact" /></div>
    </dialog>}
  </div>;
}
