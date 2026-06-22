import Link from "next/link";
import { ShieldAlert } from "lucide-react";

export default function AdminUnauthorizedPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#070B1A] px-6 text-white">
      <div className="max-w-md rounded-3xl border border-red-400/20 bg-red-500/10 p-7 text-center shadow-2xl shadow-black/25">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-red-500/15 text-red-100">
          <ShieldAlert className="h-7 w-7" />
        </div>
        <h1 className="mt-6 text-2xl font-semibold">Admin access required</h1>
        <p className="mt-3 text-sm leading-6 text-red-100/80">
          Your account is signed in, but it is not approved for the DMI Cards
          admin area.
        </p>
        <Link
          href="/client/dashboard"
          className="mt-6 inline-flex rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-[#0F172A]"
        >
          Go to client portal
        </Link>
      </div>
    </main>
  );
}
