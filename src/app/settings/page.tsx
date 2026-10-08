import AdminAppearanceControl from "@/components/admin/AdminAppearance";
import AdminShell from "@/components/admin/AdminShell";
import { AdminPageHeader, AdminSurface } from "@/components/admin/AdminUI";
import styles from "@/components/admin/AdminSimplePages.module.css";

export default function SettingsPage() {
  return <AdminShell>
    <section className={styles.page}>
      <AdminPageHeader title="Settings" subtitle="Admin settings placeholder page." />
      <AdminSurface className={styles.settings}>
        <AdminAppearanceControl />
      </AdminSurface>
    </section>
  </AdminShell>;
}
