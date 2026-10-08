import AdminShell from "@/components/admin/AdminShell";
import { AdminPageHeader } from "@/components/admin/AdminUI";
import styles from "@/components/admin/AdminSimplePages.module.css";

export default function AnalyticsPage() {
  return <AdminShell>
    <section className={styles.page}>
      <AdminPageHeader title="Analytics" subtitle="Admin analytics placeholder." />
    </section>
  </AdminShell>;
}
