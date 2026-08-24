import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { buildPublicCardUrl, getCanonicalPublicAppOrigin } from "@/lib/public-url";

const walletPassTokenTtlSeconds = 10 * 60;

type WalletPassTokenPayload = {
  backgroundColor?: string;
  cardId: string;
  exp: number;
  foregroundColor?: string;
  labelColor?: string;
};

export function createWalletPassToken({
  backgroundColor,
  cardId,
  foregroundColor,
  labelColor,
}: {
  backgroundColor?: string;
  cardId: string;
  foregroundColor?: string;
  labelColor?: string;
}) {
  const payload: WalletPassTokenPayload = {
    cardId,
    exp: Math.floor(Date.now() / 1000) + walletPassTokenTtlSeconds,
    ...(backgroundColor ? { backgroundColor } : {}),
    ...(foregroundColor ? { foregroundColor } : {}),
    ...(labelColor ? { labelColor } : {}),
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = sign(encodedPayload);

  return `${encodedPayload}.${signature}`;
}

export function verifyWalletPassToken(token: string): WalletPassTokenPayload {
  const [encodedPayload, signature] = token.split(".");

  if (!encodedPayload || !signature) {
    throw new Error("INVALID_WALLET_PASS_TOKEN");
  }

  const expectedSignature = sign(encodedPayload);
  const signatureBuffer = Buffer.from(signature);
  const expectedSignatureBuffer = Buffer.from(expectedSignature);

  if (
    signatureBuffer.length !== expectedSignatureBuffer.length ||
    !timingSafeEqual(signatureBuffer, expectedSignatureBuffer)
  ) {
    throw new Error("INVALID_WALLET_PASS_TOKEN");
  }

  const payload = JSON.parse(base64UrlDecode(encodedPayload)) as WalletPassTokenPayload;

  if (!payload.cardId || payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error("INVALID_WALLET_PASS_TOKEN");
  }

  return {
    cardId: payload.cardId,
    exp: payload.exp,
    backgroundColor: safeHexColor(payload.backgroundColor || ""),
    foregroundColor: safeHexColor(payload.foregroundColor || ""),
    labelColor: safeHexColor(payload.labelColor || ""),
  };
}

export function buildWalletPassPath(token: string) {
  return `/api/client/wallet/apple/pass/${encodeURIComponent(token)}`;
}

export function buildPublicWalletPassUrl(token: string) {
  return `${getCanonicalPublicAppOrigin()}${buildWalletPassPath(token)}`;
}

export { buildPublicCardUrl };

export function walletPassColoursAreReadable({
  backgroundColor,
  foregroundColor,
}: {
  backgroundColor?: string;
  foregroundColor?: string;
}) {
  if (!backgroundColor || !foregroundColor) return true;

  return colourContrastRatio(backgroundColor, foregroundColor) >= 4.5;
}

function sign(value: string) {
  return createHmac("sha256", walletPassLinkSecret()).update(value).digest("base64url");
}

function walletPassLinkSecret() {
  const secret =
    process.env.WALLET_PASS_LINK_SECRET ||
    process.env.CLERK_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!secret) {
    throw new Error("WALLET_PASS_LINK_SECRET_NOT_CONFIGURED");
  }

  return secret;
}

function base64UrlEncode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function safeHexColor(value: string) {
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value.toUpperCase() : undefined;
}

function colourContrastRatio(firstColour: string, secondColour: string) {
  const firstLuminance = relativeLuminance(firstColour);
  const secondLuminance = relativeLuminance(secondColour);
  const lighter = Math.max(firstLuminance, secondLuminance);
  const darker = Math.min(firstLuminance, secondLuminance);

  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(colour: string) {
  const safeColour = safeHexColor(colour) || "#000000";
  const red = parseInt(safeColour.slice(1, 3), 16) / 255;
  const green = parseInt(safeColour.slice(3, 5), 16) / 255;
  const blue = parseInt(safeColour.slice(5, 7), 16) / 255;
  const [linearRed, linearGreen, linearBlue] = [red, green, blue].map((channel) =>
    channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4
  );

  return linearRed * 0.2126 + linearGreen * 0.7152 + linearBlue * 0.0722;
}
