import AdminShell from "@/components/admin/AdminShell";
import { AdminPageHeader } from "@/components/admin/AdminUI";
import styles from "@/components/admin/AdminSimplePages.module.css";

export default function AuditLogsPage() {
  return <AdminShell>
    <section className={styles.page}>
      <AdminPageHeader title="Audit Logs" subtitle="Audit logs placeholder page." />
    </section>
  </AdminShell>;
}
