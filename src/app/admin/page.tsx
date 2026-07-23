import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

import AdminSignIn from "@/components/AdminSignIn";
import { adminUnauthorizedPath, isApprovedAdmin } from "@/lib/admin-auth";

export default async function AdminPage() {
  const adminAuth = await auth();

  if (!adminAuth.userId) {
    return <AdminSignIn redirectUrl="/admin/dashboard" />;
  }

  if (
    !isApprovedAdmin({
      userId: adminAuth.userId,
      sessionClaims: adminAuth.sessionClaims,
    })
  ) {
    redirect(adminUnauthorizedPath);
  }

  redirect("/admin/dashboard");
}
