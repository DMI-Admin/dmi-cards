import Sidebar from "@/components/Sidebar";

export default function HomePage() {
  return (
    <div className="dmi-app-shell flex min-h-screen">
      <Sidebar />

      <main className="dmi-page overflow-auto">
        <div className="mb-10">
          <h1 className="text-4xl font-bold">
            Dashboard
          </h1>

          <p className="dmi-muted mt-2">
            Welcome to your DMI Cards admin platform.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="dmi-card p-6">
            <p className="dmi-muted text-sm">Total Clients</p>

            <h2 className="mt-3 text-4xl font-bold">
              128
            </h2>
          </div>

          <div className="dmi-card p-6">
            <p className="dmi-muted text-sm">
              Monthly Revenue
            </p>

            <h2 className="gradient-text mt-3 text-4xl font-bold">
              £4,820
            </h2>
          </div>

          <div className="dmi-card p-6">
            <p className="dmi-muted text-sm">Active Cards</p>

            <h2 className="mt-3 text-4xl font-bold">
              742
            </h2>
          </div>
        </div>
      </main>
    </div>
  );
}
