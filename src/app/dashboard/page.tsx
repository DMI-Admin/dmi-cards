import Sidebar from "@/components/Sidebar";

export default function DashboardPage() {
  return (
    <main className="flex min-h-screen bg-[#070B1A] text-white">
      <Sidebar />

      <section className="flex-1 p-10">
        <div className="dmi-hero-panel mb-10 rounded-3xl border border-white/10 p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-white/70">
            DMI Cards Admin
          </p>
          <h1 className="mt-3 text-4xl font-bold">Dashboard</h1>

          <p className="text-white/50 mt-2">
            Welcome back to DMI Cards Admin Panel.
          </p>
        </div>

        <div className="grid grid-cols-4 gap-6">
          <div className="rounded-3xl bg-white/5 p-6 border border-white/10">
            <p className="text-white/50 text-sm">Total Clients</p>

            <h2 className="text-4xl font-bold mt-3">128</h2>
          </div>

          <div className="rounded-3xl bg-white/5 p-6 border border-white/10">
            <p className="text-white/50 text-sm">Active Cards</p>

            <h2 className="text-4xl font-bold mt-3">421</h2>
          </div>

          <div className="rounded-3xl bg-white/5 p-6 border border-white/10">
            <p className="text-white/50 text-sm">Monthly Revenue</p>

            <h2 className="text-4xl font-bold mt-3">£8,420</h2>
          </div>

          <div className="rounded-3xl bg-white/5 p-6 border border-white/10">
            <p className="text-white/50 text-sm">QR Scans</p>

            <h2 className="text-4xl font-bold mt-3">14.2K</h2>
          </div>
        </div>

        <div className="mt-10 rounded-3xl bg-white/5 border border-white/10 p-8">
          <h2 className="text-2xl font-semibold mb-4">
            Platform Overview
          </h2>

          <div className="h-80 rounded-2xl bg-[#101935] flex items-center justify-center text-white/30">
            Analytics Charts Coming Soon
          </div>
        </div>
      </section>
    </main>
  );
}
