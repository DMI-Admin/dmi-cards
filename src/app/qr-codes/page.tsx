import Sidebar from "@/components/Sidebar";

export default function QRCodesPage() {
  return (
    <main className="flex min-h-screen bg-[#070B1A] text-white">
      <Sidebar />

      <section className="flex-1 p-10">
        <div className="mb-8">
          <h1 className="text-4xl font-bold">QR Codes</h1>

          <p className="text-white/50 mt-2">
            Manage dynamic QR codes linked to digital business cards.
          </p>
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/5 p-8">
          <div className="h-96 rounded-2xl bg-[#101935] flex items-center justify-center text-white/30">
            QR code management coming soon
          </div>
        </div>
      </section>
    </main>
  );
}