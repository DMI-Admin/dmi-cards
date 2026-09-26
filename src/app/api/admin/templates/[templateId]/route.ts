import { validateAdminTemplateWrite, templateUuid } from "@/lib/admin-template-write";
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
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

export async function PATCH(
  request: Request,
  context: { params: Promise<{ templateId: string }> }
) {
  const adminAccess = await requireAdminAccess(await auth());

  if (!adminAccess.authorized) {
    return NextResponse.json(
      { error: adminAccess.error },
      { status: adminAccess.status }
    );
  }

  const { templateId } = await context.params;

  if (!templateUuid.test(templateId)) {
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

  const existing = await supabaseAdmin.from("templates").select("*").eq("id", templateId).maybeSingle();
  if (existing.error) return NextResponse.json({ error: existing.error.message }, { status: 500 });
  if (!existing.data) return NextResponse.json({ error: "Template not found." }, { status: 404 });
  try { payload = validateAdminTemplateWrite(payload, existing.data); }
  catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 400 }); }
  if (!Object.keys(payload).length) return NextResponse.json({ template: existing.data });

  const result = await writeTemplate((databasePayload) =>
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
  const adminAccess = await requireAdminAccess(await auth());

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

  if ("field_config" in databasePayload) {
    databasePayload.field_config = isRecord(databasePayload.field_config)
      ? databasePayload.field_config
      : {};
  }

  if ("renderer_options" in databasePayload) {
    databasePayload.renderer_options = isRecord(databasePayload.renderer_options)
      ? databasePayload.renderer_options
      : {};
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

async function writeTemplate(
  write: (databasePayload: ReturnType<typeof stripLocalOnlyFields>) => PromiseLike<TemplateWriteResult>,
  payload: TemplatePayload
) {
  return write(stripLocalOnlyFields(payload));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
