import "server-only";
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/admin-auth";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { clientRelationshipCounts, linkedUser, type AccountLink, type StaffLink, type CardLink } from "@/lib/admin-client-contract";

export async function readAdminClientCounts() {
  const access = await requireAdminAccess(await auth());
  const headers = { "Cache-Control": "private, no-store" };
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: 403, headers });
  try {
    const db = createSupabaseAdminClient();
    async function rows<T>(table: "clients" | "client_users" | "cards", fields: string): Promise<T[]> {
      const result: T[] = [];
      for (let offset = 0;; offset += 500) {
        const { data, error } = await db.from(table).select(fields).order("id").range(offset, offset + 499);
        if (error) throw error;
        result.push(...data as T[]);
        if (data.length < 500) return result;
      }
    }
    const [clients, staff, cards] = await Promise.all([
      rows<AccountLink>("clients", "id,user_id,profile_id,account_type"),
      rows<StaffLink>("client_users", "id,client_id,user_id,profile_id"),
      rows<CardLink>("cards", "id,user_id,client_id"),
    ]);
    const owners = [...new Set([...clients, ...staff].map(linkedUser).filter((id): id is string => Boolean(id)))];
    const realUsers = new Set<string>();
    // Verify identity existence without exposing Auth records or requiring direct auth.users SELECT.
    for (let offset = 0; offset < owners.length; offset += 10) {
      await Promise.all(owners.slice(offset, offset + 10).map(async id => {
        const { data, error } = await db.auth.admin.getUserById(id);
        if (error && error.status !== 404) throw error;
        if (data.user?.id === id) realUsers.add(id);
      }));
    }
    return NextResponse.json(clientRelationshipCounts(clients, staff, cards, realUsers), { headers });
  } catch {
    return NextResponse.json({ error: "Could not verify account/card counts." }, { status: 500, headers });
  }
}
