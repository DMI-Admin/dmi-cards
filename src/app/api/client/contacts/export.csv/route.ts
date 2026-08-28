import {
  bearerTokenFromRequest,
  createApiSupabaseClient,
  requireApiClient,
  requireApiClientFeature,
} from "@/lib/api/client-context";
import { apiErrorFromUnknown } from "@/lib/api/responses";
import {
  contactsToCsv,
  listContactsForUser,
} from "@/lib/services/contact-service";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const client = await requireApiClient(request);
    requireApiClientFeature(client, "contacts");
    const supabase = createApiSupabaseClient(bearerTokenFromRequest(request));
    const url = new URL(request.url);
    const contacts = await listContactsForUser(supabase, client.userId, {
      search: url.searchParams.get("search") || undefined,
      source: url.searchParams.get("source") || undefined,
      cardId: url.searchParams.get("cardId") || undefined,
      cardSlot: url.searchParams.get("cardSlot") || undefined,
      status: url.searchParams.get("status") || undefined,
      dateFrom: url.searchParams.get("dateFrom") || undefined,
      dateTo: url.searchParams.get("dateTo") || undefined,
      limit: "250",
    });

    return new Response(contactsToCsv(contacts), {
      headers: {
        "Content-Type": "text/csv;charset=utf-8",
        "Content-Disposition": 'attachment; filename="dmi-card-contacts.csv"',
      },
    });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
