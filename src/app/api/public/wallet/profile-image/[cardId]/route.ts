import { NextResponse } from "next/server";
import {
  WalletRouteError,
  loadPublishedWalletCardById,
} from "@/lib/wallet/card-loader";

type WalletProfileImageRouteContext = {
  params: Promise<{
    cardId: string;
  }>;
};

const allowedProfileImageTypes = new Set([
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const maxProfileImageBytes = 5 * 1024 * 1024;

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function GET(_request: Request, context: WalletProfileImageRouteContext) {
  const { cardId } = await context.params;

  let card;

  try {
    card = await loadPublishedWalletCardById(cardId);
  } catch (error) {
    if (error instanceof WalletRouteError) {
      return new NextResponse("Profile image not found.", { status: 404 });
    }

    throw error;
  }

  const image = decodeProfileImageDataUrl(card.profileImageUrl);

  if (!image) {
    return new NextResponse("Profile image not found.", { status: 404 });
  }

  return new NextResponse(image.body, {
    headers: {
      "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
      "Content-Type": image.contentType,
    },
  });
}

function decodeProfileImageDataUrl(value: string) {
  const match = value
    .trim()
    .match(/^data:([^;,]+);base64,([a-z0-9+/=\s]+)$/i);

  if (!match) return null;

  const contentType = match[1].toLowerCase();

  if (!allowedProfileImageTypes.has(contentType)) return null;

  const body = Buffer.from(match[2].replace(/\s/g, ""), "base64");

  if (body.length === 0) return null;
  if (body.length > maxProfileImageBytes) return null;

  return {
    body,
    contentType,
  };
}
