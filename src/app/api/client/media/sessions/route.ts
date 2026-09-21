import { MediaRequestTiming } from "@/lib/media-request-timing";
import { beginCardMediaSession } from "@/lib/card-media-staging-server";
import { ApiRouteError, apiErrorFromUnknown, apiSuccess } from "@/lib/api/responses";
export async function POST(request: Request) {
  const timing = new MediaRequestTiming();
  try {
    const body = await request.text();
    if (body.length > 2048) throw new ApiRouteError(400, "INVALID_REQUEST", "Invalid media session request.");
    let parsed;
    try { parsed = JSON.parse(body); } catch { throw new ApiRouteError(400, "INVALID_REQUEST", "Invalid media session request."); }
    if (!parsed || typeof parsed !== "object") throw new ApiRouteError(400, "INVALID_REQUEST", "Invalid media session request.");
    const { templateId, cardId } = parsed;
    if (typeof templateId !== "string" || (cardId != null && typeof cardId !== "string")) throw new ApiRouteError(400, "INVALID_REQUEST", "Invalid media session request.");
    return timing.response(apiSuccess(await beginCardMediaSession(request, templateId, cardId || undefined, timing)));
  } catch (error) { return timing.response(apiErrorFromUnknown(error)); }
}
