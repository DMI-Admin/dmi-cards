import Sidebar from "@/components/Sidebar";

export default function AdminDashboard() {
  return (
    <main className="dmi-app-shell flex">
      <Sidebar />

      <section className="dmi-page">
        <div className="dmi-hero-panel mb-10 rounded-[var(--radius-xl)] border p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-white/70">
            DMI Cards Admin
          </p>
          <h1 className="mt-3 text-4xl font-bold">Dashboard</h1>

          <p className="mt-2 text-white/70">
            Welcome back to DMI Cards Admin Panel.
          </p>
        </div>

        <div className="grid grid-cols-4 gap-6">
          <div className="dmi-card p-6">
            <p className="dmi-muted text-sm">Total Clients</p>

            <h2 className="text-4xl font-bold mt-3">128</h2>
          </div>

          <div className="dmi-card p-6">
            <p className="dmi-muted text-sm">Active Cards</p>

            <h2 className="text-4xl font-bold mt-3">421</h2>
          </div>

          <div className="dmi-card p-6">
            <p className="dmi-muted text-sm">Monthly Revenue</p>

            <h2 className="text-4xl font-bold mt-3">£8,420</h2>
          </div>

          <div className="dmi-card p-6">
            <p className="dmi-muted text-sm">QR Scans</p>

            <h2 className="text-4xl font-bold mt-3">14.2K</h2>
          </div>
        </div>

        <div className="dmi-card mt-10 p-8">
          <h2 className="text-2xl font-semibold mb-4">
            Platform Overview
          </h2>

          <div className="dmi-card-muted flex h-80 items-center justify-center text-[var(--dmi-muted)]">
            Analytics Charts Coming Soon
          </div>
        </div>
      </section>
    </main>
  );
}
