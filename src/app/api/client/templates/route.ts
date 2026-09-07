import { apiErrorFromUnknown, apiSuccess } from "@/lib/api/responses";
import { requireApiClient } from "@/lib/api/client-context";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  normalizeTemplates,
  type SharedTemplate,
} from "@/lib/templates";
import { visibleTemplatesForPlan } from "@/lib/services/card-payload";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const client = await requireApiClient(request);
    const supabaseAdmin = createSupabaseAdminClient();
    const { data, error } = await supabaseAdmin
      .from("templates")
      .select("*")
      .eq("status", "published")
      .order("created_at", { ascending: false });

    if (error) {
      throw error;
    }

    const templates = visibleTemplatesForPlan(
      normalizeTemplates((data || []) as SharedTemplate[]),
      client.plan
    );

    return apiSuccess({ templates });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
