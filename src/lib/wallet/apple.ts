import "server-only";

import type { WalletCardForPass } from "@/lib/wallet/card-loader";

const productionAppUrl = "https://app.dmicards.com";

const requiredAppleWalletVariables = [
  "APPLE_WALLET_TEAM_ID",
  "APPLE_WALLET_PASS_TYPE_ID",
  "APPLE_WALLET_CERTIFICATE_BASE64",
  "APPLE_WALLET_CERTIFICATE_PASSWORD",
  "APPLE_WALLET_WWDR_CERTIFICATE_BASE64",
  "APPLE_WALLET_ORGANIZATION_NAME",
] as const;

type AppleWalletVariable = (typeof requiredAppleWalletVariables)[number];

export type AppleWalletConfig = {
  teamIdentifier: string;
  passTypeIdentifier: string;
  certificateBase64: string;
  certificatePassword: string;
  wwdrCertificateBase64: string;
  organizationName: string;
};

export type AppleWalletConfigResult =
  | {
      configured: true;
      config: AppleWalletConfig;
      missingVariables: [];
    }
  | {
      configured: false;
      config: null;
      missingVariables: AppleWalletVariable[];
    };

export type ApplePassData = {
  cardId: string;
  serialNumber: string;
  passTypeIdentifier: string;
  teamIdentifier: string;
  organizationName: string;
  displayName: string;
  companyName: string;
  jobTitle: string;
  publicCardUrl: string;
  profileImageUrl: string;
  cardSlug: string;
};

export function getAppleWalletConfig(): AppleWalletConfigResult {
  const values = Object.fromEntries(
    requiredAppleWalletVariables.map((name) => [name, process.env[name]?.trim() || ""])
  ) as Record<AppleWalletVariable, string>;
  const missingVariables = requiredAppleWalletVariables.filter((name) => !values[name]);

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
      teamIdentifier: values.APPLE_WALLET_TEAM_ID,
      passTypeIdentifier: values.APPLE_WALLET_PASS_TYPE_ID,
      certificateBase64: values.APPLE_WALLET_CERTIFICATE_BASE64,
      certificatePassword: values.APPLE_WALLET_CERTIFICATE_PASSWORD,
      wwdrCertificateBase64: values.APPLE_WALLET_WWDR_CERTIFICATE_BASE64,
      organizationName: values.APPLE_WALLET_ORGANIZATION_NAME,
    },
    missingVariables: [],
  };
}

export function buildApplePassData(
  card: WalletCardForPass,
  config: AppleWalletConfig
): ApplePassData {
  const serialNumber = buildApplePassSerialNumber(card.id);

  return {
    cardId: card.id,
    serialNumber,
    passTypeIdentifier: config.passTypeIdentifier,
    teamIdentifier: config.teamIdentifier,
    organizationName: config.organizationName,
    displayName: card.displayName,
    companyName: card.companyName,
    jobTitle: card.jobTitle,
    publicCardUrl: buildPublicCardUrl(card.slug),
    profileImageUrl: card.profileImageUrl,
    cardSlug: card.slug,
  };
}

export function buildApplePassSerialNumber(cardId: string) {
  const safeCardId = cardId
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return `dmi-card-${safeCardId}`;
}

function buildPublicCardUrl(slug: string) {
  const baseUrl = applicationBaseUrl();

  return `${baseUrl}/u/${encodeURIComponent(slug)}`;
}

function applicationBaseUrl() {
  const configuredUrl = process.env.DMI_CARDS_APP_URL?.trim();

  if (!configuredUrl) {
    return productionAppUrl;
  }

  try {
    const url = new URL(configuredUrl);

    if (url.protocol !== "https:" && process.env.NODE_ENV === "production") {
      return productionAppUrl;
    }

    return url.origin.replace(/\/$/, "");
  } catch {
    return productionAppUrl;
  }
}
