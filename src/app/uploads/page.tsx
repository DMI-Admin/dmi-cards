import AdminShell from "@/components/admin/AdminShell";
import { AdminPageHeader } from "@/components/admin/AdminUI";
import styles from "@/components/admin/AdminSimplePages.module.css";

export default function UploadsPage() {
  return <AdminShell>
    <section className={styles.page}>
      <AdminPageHeader title="Uploads" subtitle="Admin uploads placeholder page." />
    </section>
  </AdminShell>;
}
