"use client";

import { useId, useLayoutEffect, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { adminAppearanceKey, isAdminAppearancePath, normalizeAdminAppearance, type AdminAppearance } from "@/lib/admin-appearance";

const changeEvent = "dmi-admin-appearance-change";
let temporaryPreference: AdminAppearance | undefined;
function readPreference(): AdminAppearance {
  if (temporaryPreference) return temporaryPreference;
  try { return normalizeAdminAppearance(localStorage.getItem(adminAppearanceKey)); }
  catch { return "system"; }
}
function subscribe(notify: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === adminAppearanceKey || event.key === null) { temporaryPreference = undefined; notify(); }
  };
  window.addEventListener(changeEvent, notify);
  window.addEventListener("storage", onStorage);
  return () => { window.removeEventListener(changeEvent, notify); window.removeEventListener("storage", onStorage); };
}
const serverPreference = (): AdminAppearance => "system";
function usePreference() { return useSyncExternalStore(subscribe, readPreference, serverPreference); }

export function AdminAppearanceInitializer() {
  const pathname = usePathname();
  const preference = usePreference();
  useLayoutEffect(() => {
    if (isAdminAppearancePath(pathname)) document.documentElement.dataset.adminAppearance = readPreference();
    else delete document.documentElement.dataset.adminAppearance;
  }, [pathname, preference]);
  return null;
}

export default function AdminAppearanceControl() {
  const preference = usePreference();
  const id = useId();
  function select(value: string) {
    const next = normalizeAdminAppearance(value);
    temporaryPreference = next;
    try { localStorage.setItem(adminAppearanceKey, next); temporaryPreference = undefined; } catch { /* Still works for this session when storage is blocked. */ }
    if (isAdminAppearancePath(window.location.pathname)) document.documentElement.dataset.adminAppearance = next;
    window.dispatchEvent(new Event(changeEvent));
  }
  return <div className="admin-appearance-control">
    <label htmlFor={id}>Admin appearance</label>
    <select id={id} value={preference} onChange={event => select(event.target.value)}>
      <option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option>
    </select>
  </div>;
}
