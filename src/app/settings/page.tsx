import ThemeSelector from "@/components/ThemeSelector";

export default function SettingsPage() {
  return (
    <main className="min-h-screen bg-[#090B14] p-10 text-white">
      <h1 className="text-3xl font-bold">Settings</h1>
      <p className="mt-2 text-white/60">Admin settings placeholder page.</p>
      <div className="mt-8 max-w-3xl">
        <ThemeSelector />
      </div>
    </main>
  );
}
