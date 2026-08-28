import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import {
  emailFromClerkUser,
  requireAdminAccess,
} from "@/lib/admin-auth";
import {
  isStepThreeOwnedTemplateField,
  normalizeTemplateAllowedActions,
} from "@/lib/card-actions";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

type TemplatePayload = Record<string, unknown>;
type TemplateWriteResult = {
  data: unknown;
  error: { message: string } | null;
};
const criticalTemplatePersistenceColumns = new Set(["allowed_actions"]);

export async function PATCH(
  request: Request,
  context: { params: Promise<{ templateId: string }> }
) {
  const adminAccess = await requireAdminAccess(await auth(), async () =>
    emailFromClerkUser(await currentUser())
  );

  if (!adminAccess.authorized) {
    return NextResponse.json(
      { error: adminAccess.error },
      { status: adminAccess.status }
    );
  }

  const { templateId } = await context.params;

  if (!templateId) {
    return NextResponse.json({ error: "Missing template id." }, { status: 400 });
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

  const result = await writeTemplateWithSchemaRetry((databasePayload) =>
    supabaseAdmin
      .from("templates")
      .update(databasePayload)
      .eq("id", templateId)
      .select("*")
      .single(),
    payload
  );

  if (result.error) {
    return NextResponse.json({ error: result.error.message }, { status: 500 });
  }

  return NextResponse.json({ template: result.data });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ templateId: string }> }
) {
  const adminAccess = await requireAdminAccess(await auth(), async () =>
    emailFromClerkUser(await currentUser())
  );

  if (!adminAccess.authorized) {
    return NextResponse.json(
      { error: adminAccess.error },
      { status: adminAccess.status }
    );
  }

  const { templateId } = await context.params;

  if (!templateId) {
    return NextResponse.json({ error: "Missing template id." }, { status: 400 });
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

  const { error } = await supabaseAdmin
    .from("templates")
    .delete()
    .eq("id", templateId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ deleted: true, templateId });
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

  if ("allowed_actions" in databasePayload) {
    databasePayload.allowed_actions = normalizeTemplateAllowedActions(
      databasePayload.allowed_actions
    );
  }

  if (Array.isArray(databasePayload.allowed_fields)) {
    databasePayload.allowed_fields = sanitizeAllowedFields(
      databasePayload.allowed_fields
    );
  }

  return databasePayload;
}

function sanitizeAllowedFields(fields: unknown[]) {
  return Array.from(
    new Set(
      fields
        .filter((field): field is string => typeof field === "string")
        .map((field) => field.trim())
        .filter(Boolean)
        .filter((field) => !isStepThreeOwnedTemplateField(field))
    )
  );
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
    if (criticalTemplatePersistenceColumns.has(missingColumn)) break;

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
