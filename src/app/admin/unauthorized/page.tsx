import Link from "next/link";
import { SignOutButton } from "@clerk/nextjs";
import { currentUser } from "@clerk/nextjs/server";
import { LogOut, ShieldAlert } from "lucide-react";

import { emailFromClerkUser } from "@/lib/admin-auth";

export default async function AdminUnauthorizedPage() {
  const email = emailFromClerkUser(await currentUser());

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
        {email && (
          <p className="mt-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-red-50">
            Signed in as: <span className="font-semibold">{email}</span>
          </p>
        )}
        <div className="mt-6 flex flex-col gap-3">
          <Link
            href="/client/dashboard"
            className="inline-flex justify-center rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-[#0F172A] transition hover:bg-red-50"
          >
            Go to client portal
          </Link>
          <SignOutButton redirectUrl="/sign-in">
            <button
              type="button"
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/5 px-5 py-3 text-sm font-semibold text-white transition hover:border-white/30 hover:bg-white/10"
            >
              <LogOut className="h-4 w-4" />
              Sign out and use another account
            </button>
          </SignOutButton>
        </div>
      </div>
    </main>
  );
}
