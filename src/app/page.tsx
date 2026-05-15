import Sidebar from "@/components/Sidebar";

export default function HomePage() {
  return (
    <div className="flex h-screen bg-[#F8FAFC]">
      <Sidebar />

      <main className="flex-1 p-10 overflow-auto">
        <div className="mb-10">
          <h1 className="text-4xl font-bold text-[#111827]">
            Dashboard
          </h1>

          <p className="mt-2 text-gray-500">
            Welcome to your DMI Cards admin platform.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="rounded-3xl bg-white p-6 shadow-sm border border-gray-100">
            <p className="text-sm text-gray-500">Total Clients</p>

            <h2 className="mt-3 text-4xl font-bold text-[#0F0E38]">
              128
            </h2>
          </div>

          <div className="rounded-3xl bg-white p-6 shadow-sm border border-gray-100">
            <p className="text-sm text-gray-500">
              Monthly Revenue
            </p>

            <h2 className="mt-3 text-4xl font-bold text-[#D621A2]">
              £4,820
            </h2>
          </div>

          <div className="rounded-3xl bg-white p-6 shadow-sm border border-gray-100">
            <p className="text-sm text-gray-500">Active Cards</p>

            <h2 className="mt-3 text-4xl font-bold text-[#0F0E38]">
              742
            </h2>
          </div>
        </div>
      </main>
    </div>
  );
}