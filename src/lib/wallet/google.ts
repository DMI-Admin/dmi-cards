import "server-only";

import { createSign } from "node:crypto";
import { buildPublicCardUrl, getCanonicalPublicAppOrigin } from "@/lib/public-url";
import type { WalletCardForPass } from "@/lib/wallet/card-loader";

const googleWalletClassSuffix = "dmi-cards-v1";
const googleWalletSaveBaseUrl = "https://pay.google.com/gp/v/save";
const googleWalletApiBaseUrl = "https://walletobjects.googleapis.com/walletobjects/v1";
const googleOAuthTokenUrl = "https://oauth2.googleapis.com/token";
const googleWalletIssuerScope = "https://www.googleapis.com/auth/wallet_object.issuer";
const dmiBrandColor = "#AC00FF";

const requiredGoogleWalletVariables = [
  "GOOGLE_WALLET_ISSUER_ID",
  "GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL",
  "GOOGLE_WALLET_PRIVATE_KEY",
] as const;

type GoogleWalletVariable = (typeof requiredGoogleWalletVariables)[number];

type GoogleWalletConfig = {
  issuerId: string;
  serviceAccountEmail: string;
  privateKey: string;
};

export type GoogleWalletConfigResult =
  | {
      configured: true;
      config: GoogleWalletConfig;
      missingVariables: [];
    }
  | {
      configured: false;
      config: null;
      missingVariables: GoogleWalletVariable[];
    };

export type GoogleWalletSaveLink = {
  classId: string;
  objectId: string;
  publicCardUrl: string;
  saveUrl: string;
};

class GoogleWalletApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "GoogleWalletApiError";
    this.status = status;
    this.code = code;
  }
}

export class GoogleWalletGenerationError extends Error {
  code: string;

  constructor(code: string) {
    super("Google Wallet pass generation failed.");
    this.name = "GoogleWalletGenerationError";
    this.code = code;
  }
}

export function getGoogleWalletConfig(): GoogleWalletConfigResult {
  const values = Object.fromEntries(
    requiredGoogleWalletVariables.map((name) => [name, process.env[name]?.trim() || ""])
  ) as Record<GoogleWalletVariable, string>;
  const missingVariables = requiredGoogleWalletVariables.filter((name) => !values[name]);

  if (missingVariables.length > 0) {
    return {
      configured: false,
      config: null,
      missingVariables,
    };
  }

  return {
    configured: true,
    config: {
      issuerId: values.GOOGLE_WALLET_ISSUER_ID,
      serviceAccountEmail: values.GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL,
      privateKey: normalisePrivateKey(values.GOOGLE_WALLET_PRIVATE_KEY),
    },
    missingVariables: [],
  };
}

export function buildGoogleWalletClassId(issuerId: string) {
  return `${issuerId}.${googleWalletClassSuffix}`;
}

export function buildGoogleWalletObjectId(issuerId: string, cardId: string) {
  return `${issuerId}.${buildGoogleWalletObjectSuffix(cardId)}`;
}

export function buildGoogleWalletObjectSuffix(cardId: string) {
  const safeCardId = cardId
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return `dmi-card-${safeCardId}`;
}

export async function createGoogleWalletSaveLink(
  card: WalletCardForPass,
  config: GoogleWalletConfig,
  options: { backgroundColor?: string } = {}
): Promise<GoogleWalletSaveLink> {
  const accessToken = await createGoogleWalletAccessToken(config);
  const classId = buildGoogleWalletClassId(config.issuerId);
  const objectId = buildGoogleWalletObjectId(config.issuerId, card.id);
  const publicCardUrl = buildPublicCardUrl(card.slug);
  const backgroundColor = options.backgroundColor || card.backgroundColor;
  const object = await buildGoogleWalletObject({
    card,
    backgroundColor,
    classId,
    objectId,
    publicCardUrl,
  });

  await ensureGoogleWalletClass(accessToken, classId);
  await upsertGoogleWalletObject(accessToken, object);

  return {
    classId,
    objectId,
    publicCardUrl,
    saveUrl: `${googleWalletSaveBaseUrl}/${createGoogleWalletSaveJwt({
      config,
      classId,
      objectId,
    })}`,
  };
}

async function ensureGoogleWalletClass(accessToken: string, classId: string) {
  const existingClass = await googleWalletRequest(accessToken, `genericClass/${resourceId(classId)}`);

  if (existingClass.ok) return;

  if (existingClass.status !== 404) {
    throw await googleWalletApiError(existingClass, "GOOGLE_WALLET_CLASS_LOOKUP_FAILED");
  }

  const response = await googleWalletRequest(accessToken, "genericClass", {
    method: "POST",
    body: {
      id: classId,
    },
  });

  if (!response.ok && response.status !== 409) {
    throw await googleWalletApiError(response, "GOOGLE_WALLET_CLASS_CREATE_FAILED");
  }
}

async function upsertGoogleWalletObject(
  accessToken: string,
  object: Record<string, unknown>
) {
  const objectId = String(object.id);
  const existingObject = await googleWalletRequest(
    accessToken,
    `genericObject/${resourceId(objectId)}`
  );

  if (existingObject.ok) {
    const patchResponse = await googleWalletRequest(
      accessToken,
      `genericObject/${resourceId(objectId)}`,
      {
        method: "PATCH",
        body: object,
      }
    );

    if (!patchResponse.ok) {
      throw await googleWalletApiError(patchResponse, "GOOGLE_WALLET_OBJECT_UPDATE_FAILED");
    }

    return;
  }

  if (existingObject.status !== 404) {
    throw await googleWalletApiError(existingObject, "GOOGLE_WALLET_OBJECT_LOOKUP_FAILED");
  }

  const insertResponse = await googleWalletRequest(accessToken, "genericObject", {
    method: "POST",
    body: object,
  });

  if (!insertResponse.ok && insertResponse.status !== 409) {
    throw await googleWalletApiError(insertResponse, "GOOGLE_WALLET_OBJECT_CREATE_FAILED");
  }
}

async function buildGoogleWalletObject({
  backgroundColor,
  card,
  classId,
  objectId,
  publicCardUrl,
}: {
  backgroundColor: string;
  card: WalletCardForPass;
  classId: string;
  objectId: string;
  publicCardUrl: string;
}) {
  const companyOrFallback = card.companyName || "DMI Cards";
  const subtitle = [card.jobTitle, card.companyName].filter(Boolean).join(" · ");
  const profileImageUrl = await resolveGoogleWalletProfileImageUrl(card);
  const logo = googleWalletImage(
    profileImageUrl,
    `${card.displayName || "DMI Card"} profile image`
  );

  return {
    id: objectId,
    classId,
    state: "ACTIVE",
    hexBackgroundColor: safeHexColor(backgroundColor) || dmiBrandColor,
    cardTitle: localizedString(companyOrFallback),
    header: localizedString(card.displayName || "DMI Card"),
    ...(subtitle ? { subheader: localizedString(subtitle) } : {}),
    ...(logo ? { logo } : {}),
    barcode: {
      type: "QR_CODE",
      value: publicCardUrl,
      alternateText: "Open digital card",
    },
    linksModuleData: {
      uris: [
        {
          uri: publicCardUrl,
          description: "Open digital card",
        },
      ],
    },
    textModulesData: [
      {
        id: "public_card",
        header: "Digital business card",
        body: publicCardUrl,
      },
    ],
  };
}

function googleWalletImage(uri: string, description: string) {
  const safeUri = safeGoogleWalletImageUri(uri);

  if (!safeUri) return null;

  return {
    sourceUri: {
      uri: safeUri,
    },
    contentDescription: localizedString(description),
  };
}

async function resolveGoogleWalletProfileImageUrl(card: WalletCardForPass) {
  const directImageUrl = safeGoogleWalletImageUri(card.profileImageUrl);

  if (directImageUrl && (await isPublicGoogleWalletImage(directImageUrl))) {
    return directImageUrl;
  }

  if (!card.profileImageUrl.trim().startsWith("data:")) return "";

  const url = new URL(`/api/public/wallet/profile-image/${card.id}`, getCanonicalPublicAppOrigin());

  if (card.updatedAt) {
    url.searchParams.set("v", card.updatedAt);
  }

  const profileImageUrl = url.toString();

  return (await isPublicGoogleWalletImage(profileImageUrl)) ? profileImageUrl : "";
}

async function createGoogleWalletAccessToken(config: GoogleWalletConfig) {
  const now = Math.floor(Date.now() / 1000);
  const assertion = signJwt(
    {
      alg: "RS256",
      typ: "JWT",
    },
    {
      iss: config.serviceAccountEmail,
      scope: googleWalletIssuerScope,
      aud: googleOAuthTokenUrl,
      exp: now + 3600,
      iat: now,
    },
    config.privateKey
  );
  const response = await fetch(googleOAuthTokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  if (!response.ok) {
    throw await googleWalletApiError(response, "GOOGLE_WALLET_AUTH_FAILED");
  }

  const body = (await response.json()) as { access_token?: string };

  if (!body.access_token) {
    throw new GoogleWalletGenerationError("GOOGLE_WALLET_AUTH_FAILED");
  }

  return body.access_token;
}

function createGoogleWalletSaveJwt({
  config,
  classId,
  objectId,
}: {
  config: GoogleWalletConfig;
  classId: string;
  objectId: string;
}) {
  return signJwt(
    {
      alg: "RS256",
      typ: "JWT",
    },
    {
      iss: config.serviceAccountEmail,
      aud: "google",
      typ: "savetowallet",
      iat: Math.floor(Date.now() / 1000),
      origins: [getCanonicalPublicAppOrigin()],
      payload: {
        genericObjects: [
          {
            id: objectId,
            classId,
          },
        ],
      },
    },
    config.privateKey
  );
}

async function googleWalletRequest(
  accessToken: string,
  path: string,
  options: {
    body?: Record<string, unknown>;
    method?: "GET" | "PATCH" | "POST";
  } = {}
) {
  return fetch(`${googleWalletApiBaseUrl}/${path}`, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
}

async function googleWalletApiError(response: Response, fallbackCode: string) {
  let code = fallbackCode;
  let message = "Google Wallet request failed.";

  try {
    const body = (await response.json()) as {
      error?: {
        code?: number;
        message?: string;
        status?: string;
      };
    };

    code = body.error?.status || fallbackCode;
    message = body.error?.message || message;
  } catch {
    // Keep the stable fallback for non-JSON Google errors.
  }

  return new GoogleWalletApiError(response.status, code, message);
}

function signJwt(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
  privateKey: string
) {
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = createSign("RSA-SHA256").update(signingInput).sign(privateKey, "base64url");

  return `${signingInput}.${signature}`;
}

function localizedString(value: string) {
  return {
    defaultValue: {
      language: "en-US",
      value,
    },
  };
}

function normalisePrivateKey(value: string) {
  return value.replace(/\\n/g, "\n");
}

function safeGoogleWalletImageUri(value: string) {
  const trimmedValue = value.trim();

  if (!trimmedValue) return "";

  try {
    const url = new URL(trimmedValue);

    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

async function isPublicGoogleWalletImage(value: string) {
  try {
    const response = await fetch(value, {
      method: "GET",
      signal: AbortSignal.timeout(3000),
    });
    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();

    return response.ok && Boolean(contentType?.startsWith("image/"));
  } catch {
    return false;
  }
}

function resourceId(value: string) {
  return encodeURIComponent(value);
}

function base64UrlEncode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function safeHexColor(value: string) {
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value.toUpperCase() : undefined;
}
