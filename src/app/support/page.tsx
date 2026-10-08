import AdminShell from "@/components/admin/AdminShell";
import { AdminPageHeader } from "@/components/admin/AdminUI";
import styles from "@/components/admin/AdminSimplePages.module.css";

export default function SupportPage() {
  return <AdminShell>
    <section className={styles.page}>
      <AdminPageHeader title="Support" subtitle="Admin support placeholder page." />
    </section>
  </AdminShell>;
}
