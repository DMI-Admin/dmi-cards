import { apiErrorFromUnknown, apiSuccess } from "@/lib/api/responses";
import { requireApiClient } from "@/lib/api/client-context";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  normalizeTemplates,
  type SharedTemplate,
} from "@/lib/templates";
import { canResolveExistingTemplate } from "@/lib/template-layouts";

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

    // Include published legacy records for existing-card display. New selection
    // and server card creation independently require canonical registry eligibility.
    const templates = normalizeTemplates((data || []) as SharedTemplate[])
      .filter(template => canResolveExistingTemplate(template, client.plan));

    return apiSuccess({ templates });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
