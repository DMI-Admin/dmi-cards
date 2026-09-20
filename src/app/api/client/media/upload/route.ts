import { requireApiClient } from "@/lib/api/client-context";
import { uploadCardMedia } from "@/lib/card-media-server";
import { mediaFields, type MediaKind } from "@/lib/card-media";
import { ApiRouteError, apiErrorFromUnknown, apiSuccess } from "@/lib/api/responses";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    await requireApiClient(request);
    // Bound the streamed multipart body before parsing or image decoding.
    const reader = request.body?.getReader();
    if (!reader) throw new ApiRouteError(400, "INVALID_REQUEST", "Image required.");
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.length;
      if (size > 2 * 1024 * 1024 + 16384) { await reader.cancel(); throw new ApiRouteError(400, "INVALID_REQUEST", "Image exceeds 2 MiB upload limit."); }
      chunks.push(chunk.value);
    }
    const form = await new Response(Buffer.concat(chunks), { headers: { "Content-Type": request.headers.get("content-type") || "" } }).formData();
    const file = form.get("file"); const sessionId = form.get("sessionId"); const kind = form.get("kind");
    if (!(file instanceof File) || typeof sessionId !== "string" || typeof kind !== "string" || !Object.hasOwn(mediaFields, kind)) throw new ApiRouteError(400, "INVALID_REQUEST", "Invalid image upload.");
    return apiSuccess(await uploadCardMedia(request, sessionId, kind as MediaKind, Buffer.from(await file.arrayBuffer())));
  } catch (error) { return apiErrorFromUnknown(error); }
}
