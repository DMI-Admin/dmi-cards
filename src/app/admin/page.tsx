import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

import AdminSignIn from "@/components/AdminSignIn";
import {
  adminUnauthorizedPath,
  requireAdminAccess,
} from "@/lib/admin-auth";

export default async function AdminPage() {
  const adminAuth = await auth();

  if (!adminAuth.userId) {
    return <AdminSignIn redirectUrl="/admin/dashboard" />;
  }

  const adminAccess = await requireAdminAccess(adminAuth);

  if (!adminAccess.authorized) {
    redirect(adminUnauthorizedPath);
  }

  redirect("/admin/dashboard");
}
