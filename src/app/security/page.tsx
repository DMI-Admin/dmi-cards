import AdminShell from "@/components/admin/AdminShell";
import { AdminPageHeader, AdminSurface } from "@/components/admin/AdminUI";
import styles from "@/components/admin/AdminSimplePages.module.css";

export default function SecurityPage() {
  return <AdminShell>
    <section className={styles.page}>
      <AdminPageHeader title="Security" subtitle="Manage platform security and permissions." />
      <AdminSurface>
        <div className={styles.placeholder}>Security tools coming soon</div>
      </AdminSurface>
    </section>
  </AdminShell>;
}
