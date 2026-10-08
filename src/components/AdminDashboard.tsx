import AdminShell from "@/components/admin/AdminShell";
import { AdminPageHeader, AdminKpiCard, AdminSurface } from "@/components/admin/AdminUI";
import styles from "@/components/admin/AdminSimplePages.module.css";

export default function AdminDashboard() {
  return <AdminShell>
    <section className={styles.page}>
      <div>
        <p className={styles.eyebrow}>DMI Cards Admin</p>
        <AdminPageHeader title="Dashboard" subtitle="Welcome back to DMI Cards Admin Panel." />
      </div>
      <div>
        <p className={styles.metricContext}>Static example figures; not live metrics.</p>
        <div className={styles.kpis}>
          <AdminKpiCard label="Total Clients" value="128" />
          <AdminKpiCard label="Active Cards" value="421" />
          <AdminKpiCard label="Monthly Revenue" value="£8,420" />
          <AdminKpiCard label="QR Scans" value="14.2K" />
        </div>
      </div>
      <AdminSurface>
        <h2 className={styles.sectionHeading}>Platform Overview</h2>
        <div className={styles.placeholder}>Analytics Charts Coming Soon</div>
      </AdminSurface>
    </section>
  </AdminShell>;
}
