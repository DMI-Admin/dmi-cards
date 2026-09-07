import {
  ApiRouteError,
  apiErrorFromUnknown,
  apiSuccess,
} from "@/lib/api/responses";
import { requireApiClient } from "@/lib/api/client-context";
import { canSelectTemplate, type SharedClientCard } from "@/lib/services/card-payload";
import {
  saveClientCardRecord,
  type CardWriteMode,
} from "@/lib/services/card-service";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { normalizeTemplate, type SharedTemplate } from "@/lib/templates";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type CardSaveBody = {
  card?: SharedClientCard;
  mode?: CardWriteMode;
};

export async function POST(request: Request) {
  try {
    const client = await requireApiClient(request);
    const body = (await request.json().catch(() => null)) as CardSaveBody | null;
    const card = body?.card;
    const mode = body?.mode;

    if (!card || (mode !== "create" && mode !== "edit")) {
      throw new ApiRouteError(
        400,
        "INVALID_REQUEST",
        "Invalid card save request."
      );
    }

    const supabaseAdmin = createSupabaseAdminClient();
    const template = await loadSelectableTemplate(
      supabaseAdmin,
      card.template_id,
      client.plan
    );

    const { data, error } = await saveClientCardRecord({
      card: {
        ...card,
        template_id: template.id,
        template_name: template.name,
      },
      userId: client.userId,
      mode,
      database: supabaseAdmin,
    });

    if (error || !data) {
      throw new ApiRouteError(
        500,
        "INTERNAL_ERROR",
        error?.message || "Failed to save card. Please try again."
      );
    }

    return apiSuccess({ card: data });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

async function loadSelectableTemplate(
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
  templateId: string | null | undefined,
  plan: Parameters<typeof canSelectTemplate>[1]
) {
  const normalizedTemplateId = templateId?.trim() || "";

  if (!normalizedTemplateId) {
    throw new ApiRouteError(400, "INVALID_REQUEST", "Please select a template.");
  }

  const { data, error } = await supabaseAdmin
    .from("templates")
    .select("*")
    .eq("id", normalizedTemplateId)
    .or("status.eq.published,is_published.eq.true")
    .maybeSingle();

  if (error) {
    throw new ApiRouteError(
      500,
      "INTERNAL_ERROR",
      "Could not validate the selected template."
    );
  }

  if (!data) {
    throw new ApiRouteError(
      404,
      "NOT_FOUND",
      "The selected template is no longer available."
    );
  }

  const template = normalizeTemplate(data as SharedTemplate);

  if (!canSelectTemplate(template, plan)) {
    throw new ApiRouteError(
      403,
      "FORBIDDEN",
      "Your plan does not include this template."
    );
  }

  return template;
}
