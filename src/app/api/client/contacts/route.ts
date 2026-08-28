import {
  bearerTokenFromRequest,
  createApiSupabaseClient,
  requireApiClient,
  requireApiClientFeature,
} from "@/lib/api/client-context";
import { apiErrorFromUnknown, apiSuccess } from "@/lib/api/responses";
import {
  createContactForUser,
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
      limit: url.searchParams.get("limit") || undefined,
    });

    return apiSuccess({ contacts });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function POST(request: Request) {
  try {
    const client = await requireApiClient(request);
    requireApiClientFeature(client, "contacts");
    const supabase = createApiSupabaseClient(bearerTokenFromRequest(request));
    const body = await request.json();
    const contact = await createContactForUser(supabase, client.userId, body);

    return apiSuccess({ contact }, { status: 201 });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
