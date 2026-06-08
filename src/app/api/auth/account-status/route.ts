import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    email?: string;
  } | null;
  const email = body?.email?.trim().toLowerCase();

  if (!email) {
    return NextResponse.json({ exists: false });
  }

  try {
    const supabaseAdmin = createSupabaseAdminClient();
    const exists = await authUserExistsByEmail(supabaseAdmin, email);

    return NextResponse.json({ exists });
  } catch (error) {
    console.error("[DMI auth] account status lookup failed", error);
    return NextResponse.json({ exists: null }, { status: 200 });
  }
}

async function authUserExistsByEmail(
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
  email: string
) {
  const perPage = 1000;

  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage,
    });

    if (error) throw error;

    if (
      data.users.some((user) => user.email?.trim().toLowerCase() === email)
    ) {
      return true;
    }

    if (data.users.length < perPage) break;
  }

  return false;
}
