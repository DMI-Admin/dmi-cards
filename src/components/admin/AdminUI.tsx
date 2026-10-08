import type { ComponentProps, ReactNode } from "react";
import styles from "./AdminUI.module.css";

export type AdminPresentationTone = "success" | "completion" | "coverage" | "attention" | "critical" | "neutral";

export function AdminPageHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return <header className={styles.header}><h1>{title}</h1><p>{subtitle}</p></header>;
}

export function AdminKpiCard({ label, value }: { label: string; value: ReactNode }) {
  return <div className={styles.kpi}><p>{label}</p><strong>{value}</strong></div>;
}

export function AdminStatusBadge({ label, tone, indicator = false }: {
  label: string;
  tone?: AdminPresentationTone;
  indicator?: boolean;
}) {
  // Preserve existing Subscriptions/Finance label defaults. Explicit tones are
  // presentation only; callers retain authority over their domain status.
  const resolvedTone = tone ?? (label === "Active" ? "success" : label === "Cancelling" ? "warning"
    : label === "Past Due" || label === "Failed" ? "danger"
    : label === "Trialling" ? "trial" : "neutral");
  if (!indicator) return <span className={styles.badge} data-tone={resolvedTone}>{label}</span>;
  return <span className={styles.badge} data-tone={resolvedTone}>
    {indicator ? <span className={styles.statusDot} aria-hidden="true" /> : null}
    {label}
  </span>;
}

export function AdminSurface({ className = "", ...props }: ComponentProps<"div">) {
  return <div {...props} className={`${styles.surface} ${className}`} />;
}

export function AdminButton({ variant = "secondary", type = "button", className = "", ...props }: ComponentProps<"button"> & {
  variant?: "primary" | "secondary" | "danger";
}) {
  return <button {...props} type={type} data-variant={variant} className={`${styles.button} ${className}`} />;
}

export function AdminInput({ className = "", ...props }: ComponentProps<"input">) {
  return <input {...props} className={`${styles.control} ${className}`} />;
}

export function AdminSelect({ className = "", ...props }: ComponentProps<"select">) {
  return <select {...props} className={`${styles.control} ${className}`} />;
}

export function AdminTableWrapper({ label, children }: { label: string; children: ReactNode }) {
  return <div className={styles.tableWrapper} role="region" aria-label={label} tabIndex={0}>{children}</div>;
}
