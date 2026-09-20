import { redirect } from "next/navigation";
import { auth, currentUser } from "@clerk/nextjs/server";

import AdminSignIn from "@/components/AdminSignIn";
import {
  adminUnauthorizedPath,
  emailFromClerkUser,
  requireAdminAccess,
} from "@/lib/admin-auth";

export default async function AdminPage() {
  const adminAuth = await auth();

  if (!adminAuth.userId) {
    return <AdminSignIn redirectUrl="/admin/dashboard" />;
  }

  const adminAccess = await requireAdminAccess(adminAuth, async () =>
    emailFromClerkUser(await currentUser())
  );

  if (!adminAccess.authorized) {
    redirect(adminUnauthorizedPath);
  }

  redirect("/admin/dashboard");
}
