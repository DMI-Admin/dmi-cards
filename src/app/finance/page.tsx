import Sidebar from "@/components/Sidebar";

export default function FinancePage() {
  return (
    <main className="flex min-h-screen bg-[#070B1A] text-white">
      <Sidebar />

      <section className="flex-1 p-10">
        <div className="mb-8">
          <h1 className="text-4xl font-bold">Finance</h1>

          <p className="text-white/50 mt-2">
            Monitor revenue, payouts, invoices, and financial performance.
          </p>
        </div>

        <div className="grid grid-cols-4 gap-6 mb-8">
          <div className="rounded-3xl bg-white/5 p-6 border border-white/10">
            <p className="text-white/50 text-sm">Monthly Revenue</p>
            <h2 className="text-4xl font-bold mt-3">£12,480</h2>
          </div>

          <div className="rounded-3xl bg-white/5 p-6 border border-white/10">
            <p className="text-white/50 text-sm">Active Subscriptions</p>
            <h2 className="text-4xl font-bold mt-3">482</h2>
          </div>

          <div className="rounded-3xl bg-white/5 p-6 border border-white/10">
            <p className="text-white/50 text-sm">Pending Invoices</p>
            <h2 className="text-4xl font-bold mt-3">16</h2>
          </div>

          <div className="rounded-3xl bg-white/5 p-6 border border-white/10">
            <p className="text-white/50 text-sm">Annual Growth</p>
            <h2 className="text-4xl font-bold mt-3">+28%</h2>
          </div>
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/5 p-8">
          <div className="h-96 rounded-2xl bg-[#101935] flex items-center justify-center text-white/30">
            Financial analytics coming soon
          </div>
        </div>
      </section>
    </main>
  );
}