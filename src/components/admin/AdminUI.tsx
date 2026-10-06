import type { ReactNode } from "react";
import styles from "./AdminUI.module.css";

export function AdminPageHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return <header className={styles.header}><h1>{title}</h1><p>{subtitle}</p></header>;
}

export function AdminKpiCard({ label, value }: { label: string; value: ReactNode }) {
  return <div className={styles.kpi}><p>{label}</p><strong>{value}</strong></div>;
}

export function AdminStatusBadge({ label }: { label: string }) {
  const tone = label === "Active" ? "success" : label === "Cancelling" ? "warning"
    : label === "Past Due" || label === "Failed" ? "danger"
    : label === "Trialling" ? "trial" : "neutral";
  return <span className={styles.badge} data-tone={tone}>{label}</span>;
}
