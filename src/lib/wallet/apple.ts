import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";
import forge from "node-forge";
import { PKPass, type Barcode, type OverridablePassProps } from "passkit-generator";
import type { WalletCardForPass } from "@/lib/wallet/card-loader";

const productionAppUrl = "https://app.dmicards.com";
const dmiBrandColor = "#AC00FF";
const walletAssetDirectory = path.join(process.cwd(), "public", "apple-wallet");

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
  backgroundColor: string;
};

export class AppleWalletCertificateError extends Error {
  code: string;

  constructor(code: string) {
    super("Apple Wallet certificate material is invalid or unavailable.");
    this.name = "AppleWalletCertificateError";
    this.code = code;
  }
}

export class ApplePassGenerationError extends Error {
  code: string;

  constructor(code: string) {
    super("Apple Wallet pass generation failed.");
    this.name = "ApplePassGenerationError";
    this.code = code;
  }
}

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
    backgroundColor: card.backgroundColor || dmiBrandColor,
  };
}

export async function generateAppleWalletPass(data: ApplePassData, config: AppleWalletConfig) {
  const certificates = decodeAppleWalletCertificates(config);
  const pass = new PKPass(await loadAppleWalletAssetBuffers(), certificates, buildPassProps(data));

  pass.type = "generic";
  pass.primaryFields.push({
    key: "name",
    label: "Name",
    value: data.displayName,
  });

  if (data.jobTitle) {
    pass.secondaryFields.push({
      key: "jobTitle",
      label: "Job Title",
      value: data.jobTitle,
    });
  }

  if (data.companyName) {
    pass.secondaryFields.push({
      key: "company",
      label: "Company",
      value: data.companyName,
    });
  }

  pass.auxiliaryFields.push({
    key: "publicUrl",
    label: "Public Card",
    value: data.publicCardUrl,
  });

  pass.backFields.push(
    {
      key: "instructions",
      label: "How to use",
      value: "Scan or tap to view this digital business card",
    },
    {
      key: "publicCardUrl",
      label: "Public card URL",
      value: data.publicCardUrl,
    }
  );

  pass.setBarcodes({
    format: "PKBarcodeFormatQR",
    message: data.publicCardUrl,
    messageEncoding: "iso-8859-1",
    altText: `${data.displayName} public DMI Card`,
  } satisfies Barcode);

  try {
    return pass.getAsBuffer();
  } catch (error) {
    console.error("Apple Wallet pass generation failed", {
      code: "APPLE_PASS_SIGNING_FAILED",
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    throw new ApplePassGenerationError("APPLE_PASS_GENERATION_FAILED");
  }
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

function buildPassProps(data: ApplePassData): OverridablePassProps {
  const backgroundColor = safeHexColor(data.backgroundColor) || dmiBrandColor;
  const foregroundColor = readableTextForColor(backgroundColor);
  const labelColor = foregroundColor === "#FFFFFF" ? "#F5EAFE" : "#2B1640";

  return {
    formatVersion: 1,
    passTypeIdentifier: data.passTypeIdentifier,
    teamIdentifier: data.teamIdentifier,
    organizationName: data.organizationName,
    serialNumber: data.serialNumber,
    description: "DMI Cards Digital Business Card",
    logoText: "DMI Cards",
    foregroundColor,
    backgroundColor,
    labelColor,
  };
}

async function loadAppleWalletAssetBuffers() {
  try {
    const entries = await Promise.all(
      ["icon.png", "icon@2x.png", "logo.png", "logo@2x.png"].map(async (name) => [
        name,
        await readFile(path.join(walletAssetDirectory, name)),
      ])
    );

    return Object.fromEntries(entries);
  } catch (error) {
    console.error("Apple Wallet asset load failed", {
      code: "APPLE_WALLET_ASSET_LOAD_FAILED",
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    throw new ApplePassGenerationError("APPLE_WALLET_ASSET_LOAD_FAILED");
  }
}

function decodeAppleWalletCertificates(config: AppleWalletConfig) {
  try {
    const signerP12 = decodeBase64Buffer(config.certificateBase64);
    const wwdr = normalizeCertificateToPem(decodeBase64Buffer(config.wwdrCertificateBase64));
    const signer = extractSignerCertificateFromP12(signerP12, config.certificatePassword);

    return {
      wwdr,
      signerCert: signer.signerCert,
      signerKey: signer.signerKey,
      signerKeyPassphrase: config.certificatePassword,
    };
  } catch (error) {
    console.error("Apple Wallet certificate validation failed", {
      code: "APPLE_WALLET_CERTIFICATE_INVALID",
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    throw new AppleWalletCertificateError("APPLE_WALLET_CERTIFICATE_INVALID");
  }
}

function extractSignerCertificateFromP12(p12Buffer: Buffer, password: string) {
  const p12Der = forge.util.createBuffer(p12Buffer.toString("binary"));
  const p12Asn1 = forge.asn1.fromDer(p12Der);
  const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, password);
  const certBag = p12.getBags({ bagType: forge.pki.oids.certBag })[
    forge.pki.oids.certBag
  ]?.[0];
  const keyBag =
    p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[
      forge.pki.oids.pkcs8ShroudedKeyBag
    ]?.[0] ||
    p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag]?.[0];

  if (!certBag?.cert || !keyBag?.key) {
    throw new Error("Missing certificate or private key in p12.");
  }

  return {
    signerCert: forge.pki.certificateToPem(certBag.cert),
    signerKey: forge.pki.encryptRsaPrivateKey(keyBag.key, password),
  };
}

function normalizeCertificateToPem(buffer: Buffer) {
  const text = buffer.toString("utf8");

  if (text.includes("-----BEGIN CERTIFICATE-----")) {
    forge.pki.certificateFromPem(text);
    return text;
  }

  const certificate = forge.pki.certificateFromAsn1(
    forge.asn1.fromDer(forge.util.createBuffer(buffer.toString("binary")))
  );

  return forge.pki.certificateToPem(certificate);
}

function decodeBase64Buffer(value: string) {
  const buffer = Buffer.from(value, "base64");

  if (buffer.length === 0) {
    throw new Error("Empty base64 value.");
  }

  return buffer;
}

function safeHexColor(color: string) {
  const value = color.trim();

  return /^#[0-9a-fA-F]{6}$/.test(value) ? value.toUpperCase() : "";
}

function readableTextForColor(color: string) {
  const hex = color.replace("#", "");
  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);
  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;

  return luminance > 0.55 ? "#111827" : "#FFFFFF";
}
