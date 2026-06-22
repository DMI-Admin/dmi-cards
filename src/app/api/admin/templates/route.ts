import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import {
  emailFromClerkUser,
  requireAdminAccess,
} from "@/lib/admin-auth";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

type TemplatePayload = Record<string, unknown>;
type TemplateWriteResult = {
  data: unknown;
  error: { message: string } | null;
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const adminAccess = await requireAdminAccess(await auth(), async () =>
    emailFromClerkUser(await currentUser())
  );

  if (!adminAccess.authorized) {
    return NextResponse.json(
      { error: adminAccess.error },
      { status: adminAccess.status }
    );
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

  const { data, error } = await supabaseAdmin
    .from("templates")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ templates: data || [] });
}

export async function POST(request: Request) {
  const adminAccess = await requireAdminAccess(await auth(), async () =>
    emailFromClerkUser(await currentUser())
  );

  if (!adminAccess.authorized) {
    return NextResponse.json(
      { error: adminAccess.error },
      { status: adminAccess.status }
    );
  }

  let payload: TemplatePayload;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid template payload." }, { status: 400 });
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

  const slug = typeof payload.slug === "string" ? payload.slug.trim() : "";

  if (slug) {
    const { data: existingTemplate, error: existingError } = await supabaseAdmin
      .from("templates")
      .select("id, name, slug")
      .eq("slug", slug)
      .maybeSingle();

    if (existingError) {
      return NextResponse.json({ error: existingError.message }, { status: 500 });
    }

    if (existingTemplate) {
      return NextResponse.json(
        {
          error:
            "A template with this name already exists. Please edit the existing template or choose another name.",
          template: existingTemplate,
        },
        { status: 409 }
      );
    }
  }

  const result = await writeTemplateWithSchemaRetry((databasePayload) =>
    supabaseAdmin
      .from("templates")
      .insert([databasePayload])
      .select("*")
      .single(),
    payload
  );

  if (result.error) {
    if (isDuplicateSlugError(result.error)) {
      return NextResponse.json(
        {
          error:
            "A template with this name already exists. Please edit the existing template or choose another name.",
        },
        { status: 409 }
      );
    }

    return NextResponse.json({ error: result.error.message }, { status: 500 });
  }

  return NextResponse.json({ template: result.data });
}

function stripLocalOnlyFields(payload: TemplatePayload) {
  const {
    id,
    created_at,
    updated_at,
    ...databasePayload
  } = payload;

  void id;
  void created_at;
  void updated_at;

  return databasePayload;
}

async function writeTemplateWithSchemaRetry(
  write: (databasePayload: ReturnType<typeof stripLocalOnlyFields>) => PromiseLike<TemplateWriteResult>,
  payload: TemplatePayload
) {
  let databasePayload = stripLocalOnlyFields(payload);
  let result = await write(databasePayload);
  const removedColumns = new Set<string>();

  while (result.error) {
    const missingColumn = missingColumnFromError(result.error);

    if (!missingColumn || removedColumns.has(missingColumn)) break;

    removedColumns.add(missingColumn);
    const nextPayload = { ...databasePayload };
    delete nextPayload[missingColumn];
    databasePayload = nextPayload;
    result = await write(databasePayload);
  }

  return result;
}

function missingColumnFromError(error: { message: string } | null) {
  const message = error?.message || "";
  const quotedColumnMatch = message.match(/'([^']+)' column of 'templates'/);
  const qualifiedColumnMatch = message.match(/column templates\.([a-zA-Z0-9_]+) does not exist/);

  return quotedColumnMatch?.[1] || qualifiedColumnMatch?.[1] || null;
}

function isDuplicateSlugError(error: { message: string } | null) {
  return /templates_slug_key|duplicate key value/i.test(error?.message || "");
}
