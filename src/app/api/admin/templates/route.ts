import { validateAdminTemplateWrite } from "@/lib/admin-template-write";
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

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const adminAccess = await requireAdminAccess(await auth());

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
  const adminAccess = await requireAdminAccess(await auth());

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

  try { payload = validateAdminTemplateWrite(payload); }
  catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 400 }); }

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

  const result = await writeTemplate((databasePayload) =>
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

function isDuplicateSlugError(error: { message: string } | null) {
  return /templates_slug_key|duplicate key value/i.test(error?.message || "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
