import {
  bearerTokenFromRequest,
  createApiSupabaseClient,
  requireApiClient,
  requireApiClientFeature,
} from "@/lib/api/client-context";
import { apiErrorFromUnknown, apiSuccess } from "@/lib/api/responses";
import {
  deleteContactForUser,
  getContactForUser,
  updateContactForUser,
} from "@/lib/services/contact-service";

type ContactRouteContext = {
  params: Promise<{
    contactId: string;
  }>;
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request, context: ContactRouteContext) {
  const { contactId } = await context.params;

  try {
    const client = await requireApiClient(request);
    requireApiClientFeature(client, "contacts");
    const supabase = createApiSupabaseClient(bearerTokenFromRequest(request));
    const contact = await getContactForUser(supabase, client.userId, contactId);

    return apiSuccess({ contact });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function PATCH(request: Request, context: ContactRouteContext) {
  const { contactId } = await context.params;

  try {
    const client = await requireApiClient(request);
    requireApiClientFeature(client, "contacts");
    const supabase = createApiSupabaseClient(bearerTokenFromRequest(request));
    const body = await request.json();
    const contact = await updateContactForUser(
      supabase,
      client.userId,
      contactId,
      body
    );

    return apiSuccess({ contact });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function DELETE(request: Request, context: ContactRouteContext) {
  const { contactId } = await context.params;

  try {
    const client = await requireApiClient(request);
    requireApiClientFeature(client, "contacts");
    const supabase = createApiSupabaseClient(bearerTokenFromRequest(request));
    const deleted = await deleteContactForUser(supabase, client.userId, contactId);

    return apiSuccess({ deleted });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
