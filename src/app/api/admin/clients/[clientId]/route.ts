import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

type ClientRecord = {
  id: string;
  profile_id: string | null;
  user_id: string | null;
  email: string | null;
};

type ClientUserRecord = {
  id: string;
  profile_id: string | null;
  user_id: string | null;
  email: string | null;
};

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ clientId: string }> }
) {
  const { userId: adminUserId } = await auth();

  if (!adminUserId) {
    return NextResponse.json({ error: "Admin sign-in is required." }, { status: 401 });
  }

  const { clientId } = await context.params;

  if (!clientId) {
    return NextResponse.json({ error: "Missing client id." }, { status: 400 });
  }

  let supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>;

  try {
    supabaseAdmin = createSupabaseAdminClient();
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Supabase admin client is not configured.",
      },
      { status: 500 }
    );
  }

  const { data: client, error: clientError } = await supabaseAdmin
    .from("clients")
    .select("id, profile_id, user_id, email")
    .eq("id", clientId)
    .maybeSingle<ClientRecord>();

  if (clientError) {
    return NextResponse.json({ error: clientError.message }, { status: 500 });
  }

  const { data: clientUsers, error: clientUsersError } = await supabaseAdmin
    .from("client_users")
    .select("id, profile_id, user_id, email")
    .eq("client_id", clientId)
    .returns<ClientUserRecord[]>();

  if (clientUsersError) {
    return NextResponse.json({ error: clientUsersError.message }, { status: 500 });
  }

  const authUserIds = uniqueIds([
    client?.user_id,
    client?.profile_id,
    ...(clientUsers || []).flatMap((user) => [user.user_id, user.profile_id]),
  ]);

  const deletionErrors: string[] = [];

  const { error: clientCardsError } = await supabaseAdmin
    .from("cards")
    .delete()
    .eq("client_id", clientId);

  if (clientCardsError) deletionErrors.push(`cards by client_id: ${clientCardsError.message}`);

  for (const authUserId of authUserIds) {
    const { error: userCardsError } = await supabaseAdmin
      .from("cards")
      .delete()
      .eq("user_id", authUserId);

    if (userCardsError) deletionErrors.push(`cards for user ${authUserId}: ${userCardsError.message}`);
  }

  const { error: clientUsersDeleteError } = await supabaseAdmin
    .from("client_users")
    .delete()
    .eq("client_id", clientId);

  if (clientUsersDeleteError) {
    deletionErrors.push(`client_users: ${clientUsersDeleteError.message}`);
  }

  for (const authUserId of authUserIds) {
    const { error: linkedClientUsersDeleteError } = await supabaseAdmin
      .from("client_users")
      .delete()
      .or(`user_id.eq.${authUserId},profile_id.eq.${authUserId}`);

    if (linkedClientUsersDeleteError) {
      deletionErrors.push(`client_users for user ${authUserId}: ${linkedClientUsersDeleteError.message}`);
    }
  }

  const { error: clientDeleteError } = await supabaseAdmin
    .from("clients")
    .delete()
    .eq("id", clientId);

  if (clientDeleteError) {
    deletionErrors.push(`clients: ${clientDeleteError.message}`);
  }

  for (const authUserId of authUserIds) {
    const { error: profileDeleteError } = await supabaseAdmin
      .from("profiles")
      .delete()
      .eq("id", authUserId);

    if (profileDeleteError) {
      deletionErrors.push(`profile ${authUserId}: ${profileDeleteError.message}`);
    }

    const { error: authDeleteError } = await supabaseAdmin.auth.admin.deleteUser(authUserId);

    if (authDeleteError && !isMissingAuthUserError(authDeleteError)) {
      deletionErrors.push(`auth user ${authUserId}: ${authDeleteError.message}`);
    }
  }

  if (deletionErrors.length) {
    return NextResponse.json(
      { error: `Client delete was incomplete: ${deletionErrors.join("; ")}` },
      { status: 500 }
    );
  }

  return NextResponse.json({
    deleted: true,
    clientId,
    authUserIds,
    alreadyMissing: !client,
  });
}

function uniqueIds(ids: Array<string | null | undefined>) {
  return Array.from(new Set(ids.filter((id): id is string => Boolean(id))));
}

function isMissingAuthUserError(error: { message?: string; status?: number }) {
  return error.status === 404 || /not found|does not exist/i.test(error.message || "");
}
