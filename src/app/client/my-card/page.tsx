import { CreditCard } from "lucide-react";
import ClientSidebar from "@/components/ClientSidebar";

export default function ClientMyCardPage() {
  return (
    <main className="flex min-h-screen bg-[#070B1A] text-white">
      <ClientSidebar />

      <section className="flex-1 p-10">
        <div className="mb-10">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#AC00FF]">
            Client Portal
          </p>
          <h1 className="mt-3 text-4xl font-bold">My Card</h1>
          <p className="mt-3 max-w-3xl text-white/50">
            Review and customise your digital business card.
          </p>
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/5 p-8">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#AC00FF]/15 text-purple-200">
            <CreditCard className="h-6 w-6" />
          </div>
          <h2 className="mt-6 text-2xl font-semibold">Card editor coming soon</h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-white/50">
            This area will let clients update their card details, branding,
            links, and public profile content.
          </p>
        </div>
      </section>
    </main>
  );
}
