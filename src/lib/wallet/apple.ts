import "server-only";

import { lookup } from "node:dns/promises";
import net from "node:net";
import { readFile } from "node:fs/promises";
import path from "node:path";
import forge from "node-forge";
import { PKPass, type Barcode, type OverridablePassProps } from "passkit-generator";
import sharp from "sharp";
import { buildPublicCardUrl } from "@/lib/public-url";
import type { WalletCardForPass } from "@/lib/wallet/card-loader";

const dmiBrandColor = "#AC00FF";
const walletAssetDirectory = path.join(process.cwd(), "public", "apple-wallet");
const walletLogoSize = 50;
const walletLogoScale = 2;
const maxProfileImageBytes = 5 * 1024 * 1024;
const maxProfileImageRedirects = 3;
const allowedProfileImageTypes = new Set([
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

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
  foregroundColor: string;
  labelColor: string;
  updatedAt: string;
};

class WalletProfileImageError extends Error {
  code: string;

  constructor(code: string) {
    super(code);
    this.name = "WalletProfileImageError";
    this.code = code;
  }
}

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
  config: AppleWalletConfig,
  options: { backgroundColor?: string; foregroundColor?: string; labelColor?: string } = {}
): ApplePassData {
  const serialNumber = buildApplePassSerialNumber(card.id);
  const backgroundColor = options.backgroundColor || card.backgroundColor || dmiBrandColor;
  const foregroundColor =
    options.foregroundColor || readableTextForColor(safeHexColor(backgroundColor) || dmiBrandColor);

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
    backgroundColor,
    foregroundColor,
    labelColor: options.labelColor || labelColorForPass(backgroundColor, foregroundColor),
    updatedAt: card.updatedAt,
  };
}

export async function generateAppleWalletPass(data: ApplePassData, config: AppleWalletConfig) {
  const certificates = decodeAppleWalletCertificates(config);
  const pass = new PKPass(await loadAppleWalletAssetBuffers(data), certificates, buildPassProps(data));

  pass.type = "generic";
  pass.primaryFields.push({
    key: "name",
    value: compactWalletText(data.displayName, 42),
  });

  if (data.jobTitle) {
    pass.secondaryFields.push({
      key: "jobTitle",
      value: compactWalletText(data.jobTitle, 32),
    });
  }

  if (data.companyName) {
    pass.secondaryFields.push({
      key: "company",
      value: compactWalletText(data.companyName, 32),
    });
  }

  pass.setBarcodes({
    format: "PKBarcodeFormatQR",
    message: data.publicCardUrl,
    messageEncoding: "iso-8859-1",
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

function buildPassProps(data: ApplePassData): OverridablePassProps {
  const backgroundColor = safeHexColor(data.backgroundColor) || dmiBrandColor;
  const foregroundColor = safeHexColor(data.foregroundColor) || readableTextForColor(backgroundColor);
  const labelColor = safeHexColor(data.labelColor) || labelColorForPass(backgroundColor, foregroundColor);

  return {
    formatVersion: 1,
    passTypeIdentifier: data.passTypeIdentifier,
    teamIdentifier: data.teamIdentifier,
    organizationName: data.organizationName,
    serialNumber: data.serialNumber,
    description: "DMI Cards Digital Business Card",
    logoText: compactWalletText(data.companyName || "DMI Cards", 32),
    foregroundColor,
    backgroundColor,
    labelColor,
    userInfo: {
      walletContentRevision: buildWalletContentRevision(data),
    },
  };
}

function buildWalletContentRevision(data: ApplePassData) {
  return [data.updatedAt || new Date().toISOString(), data.profileImageUrl ? "profile" : "fallback"]
    .join("|")
    .trim();
}

async function loadAppleWalletAssetBuffers(data: ApplePassData) {
  try {
    const [icon, icon2x, fallbackLogo, fallbackLogo2x] = await Promise.all([
      readWalletAsset("icon.png"),
      readWalletAsset("icon@2x.png"),
      readWalletAsset("logo.png"),
      readWalletAsset("logo@2x.png"),
    ]);
    const profileLogos = await loadProfileLogoAssets(data.profileImageUrl);

    return {
      "icon.png": icon,
      "icon@2x.png": icon2x,
      "logo.png": profileLogos?.logo || fallbackLogo,
      "logo@2x.png": profileLogos?.logo2x || fallbackLogo2x,
    };
  } catch (error) {
    console.error("Apple Wallet asset load failed", {
      code: "APPLE_WALLET_ASSET_LOAD_FAILED",
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    throw new ApplePassGenerationError("APPLE_WALLET_ASSET_LOAD_FAILED");
  }
}

async function readWalletAsset(name: string) {
  return readFile(path.join(walletAssetDirectory, name));
}

async function loadProfileLogoAssets(profileImageUrl: string) {
  if (!profileImageUrl) {
    logWalletProfileImageFallback("WALLET_PROFILE_IMAGE_MISSING");
    return null;
  }

  try {
    const source = await loadProfileImageSource(profileImageUrl);
    const [logo, logo2x] = await Promise.all([
      processProfileLogo(source, walletLogoSize),
      processProfileLogo(source, walletLogoSize * walletLogoScale),
    ]);

    return { logo, logo2x };
  } catch (error) {
    const code =
      error instanceof WalletProfileImageError
        ? error.code
        : "WALLET_PROFILE_IMAGE_PROCESSING_FAILED";
    logWalletProfileImageFallback(code);
    return null;
  }
}

async function loadProfileImageSource(profileImageUrl: string) {
  const trimmed = profileImageUrl.trim();

  if (trimmed.startsWith("data:")) {
    return decodeProfileImageDataUrl(trimmed);
  }

  return fetchProfileImage(trimmed);
}

function decodeProfileImageDataUrl(value: string) {
  const match = value.match(/^data:([^;,]+);base64,([a-z0-9+/=\s]+)$/i);

  if (!match) {
    throw new WalletProfileImageError("WALLET_PROFILE_IMAGE_BLOCKED");
  }

  const contentType = match[1].toLowerCase();

  if (!allowedProfileImageTypes.has(contentType)) {
    throw new WalletProfileImageError("WALLET_PROFILE_IMAGE_INVALID_TYPE");
  }

  const buffer = Buffer.from(match[2].replace(/\s/g, ""), "base64");

  if (buffer.length === 0) {
    throw new WalletProfileImageError("WALLET_PROFILE_IMAGE_FETCH_FAILED");
  }

  if (buffer.length > maxProfileImageBytes) {
    throw new WalletProfileImageError("WALLET_PROFILE_IMAGE_TOO_LARGE");
  }

  return buffer;
}

async function fetchProfileImage(profileImageUrl: string) {
  let url: URL;

  try {
    url = new URL(profileImageUrl);
  } catch {
    throw new WalletProfileImageError("WALLET_PROFILE_IMAGE_BLOCKED");
  }

  await validateProfileImageUrl(url);

  const response = await fetchProfileImageWithSafeRedirects(url);
  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();

  if (!contentType || !allowedProfileImageTypes.has(contentType)) {
    throw new WalletProfileImageError("WALLET_PROFILE_IMAGE_INVALID_TYPE");
  }

  const contentLength = Number(response.headers.get("content-length") || 0);

  if (contentLength > maxProfileImageBytes) {
    throw new WalletProfileImageError("WALLET_PROFILE_IMAGE_TOO_LARGE");
  }

  const buffer = Buffer.from(await response.arrayBuffer());

  if (buffer.length === 0) {
    throw new WalletProfileImageError("WALLET_PROFILE_IMAGE_FETCH_FAILED");
  }

  if (buffer.length > maxProfileImageBytes) {
    throw new WalletProfileImageError("WALLET_PROFILE_IMAGE_TOO_LARGE");
  }

  return buffer;
}

async function fetchProfileImageWithSafeRedirects(initialUrl: URL) {
  let currentUrl = initialUrl;

  for (let redirectCount = 0; redirectCount <= maxProfileImageRedirects; redirectCount += 1) {
    const response = await fetch(currentUrl, {
      signal: AbortSignal.timeout(5000),
      redirect: "manual",
    }).catch(() => {
      throw new WalletProfileImageError("WALLET_PROFILE_IMAGE_FETCH_FAILED");
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");

      if (!location || redirectCount === maxProfileImageRedirects) {
        throw new WalletProfileImageError("WALLET_PROFILE_IMAGE_BLOCKED");
      }

      currentUrl = new URL(location, currentUrl);
      await validateProfileImageUrl(currentUrl);
      continue;
    }

    if (!response.ok) {
      throw new WalletProfileImageError("WALLET_PROFILE_IMAGE_FETCH_FAILED");
    }

    return response;
  }

  throw new WalletProfileImageError("WALLET_PROFILE_IMAGE_BLOCKED");
}

async function validateProfileImageUrl(url: URL) {
  if (url.protocol !== "https:" || isBlockedProfileImageHost(url.hostname)) {
    throw new WalletProfileImageError("WALLET_PROFILE_IMAGE_BLOCKED");
  }

  await assertPublicHostname(url.hostname);
}

async function assertPublicHostname(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const ipVersion = net.isIP(host);

  if (ipVersion) {
    if (isBlockedIpAddress(host, ipVersion)) {
      throw new WalletProfileImageError("WALLET_PROFILE_IMAGE_BLOCKED");
    }
    return;
  }

  const addresses = await lookup(host, { all: true }).catch(() => {
    throw new WalletProfileImageError("WALLET_PROFILE_IMAGE_FETCH_FAILED");
  });

  if (
    addresses.length === 0 ||
    addresses.some((address) => isBlockedIpAddress(address.address, address.family))
  ) {
    throw new WalletProfileImageError("WALLET_PROFILE_IMAGE_BLOCKED");
  }
}

function isBlockedIpAddress(address: string, family: number) {
  if (family === 4) {
    const octets = address.split(".").map(Number);
    const [first, second] = octets;

    if (octets.length !== 4 || octets.some((octet) => octet < 0 || octet > 255)) {
      return true;
    }

    return (
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168)
    );
  }

  if (family === 6) {
    const normalized = address.toLowerCase();

    return (
      normalized === "::1" ||
      normalized === "::" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe80:")
    );
  }

  return true;
}

function isBlockedProfileImageHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);

  if (host === "localhost" || host.endsWith(".localhost")) {
    return true;
  }

  if (
    host === "::1" ||
    host === "::" ||
    host.startsWith("fc") ||
    host.startsWith("fd") ||
    host.startsWith("fe80:")
  ) {
    return true;
  }

  if (!ipv4Match) {
    return false;
  }

  const octets = ipv4Match.slice(1).map(Number);
  const [first, second] = octets;

  if (octets.some((octet) => octet < 0 || octet > 255)) {
    return true;
  }

  return (
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

async function processProfileLogo(source: Buffer, size: number) {
  try {
    return await sharp(source, { limitInputPixels: 16_000_000, animated: false })
      .rotate()
      .resize(size, size, {
        fit: "cover",
        position: "attention",
      })
      .png()
      .toBuffer();
  } catch {
    throw new WalletProfileImageError("WALLET_PROFILE_IMAGE_PROCESSING_FAILED");
  }
}

function logWalletProfileImageFallback(code: string) {
  console.warn("Apple Wallet profile image fallback used", { code });
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

function labelColorForPass(backgroundColor: string, foregroundColor: string) {
  const safeForegroundColor = safeHexColor(foregroundColor) || readableTextForColor(backgroundColor);

  if (safeForegroundColor === "#FFFFFF") {
    return "#D1D5DB";
  }

  return "#4B5563";
}

function compactWalletText(value: string, maxLength: number) {
  const compacted = value.replace(/\s+/g, " ").trim();

  if (compacted.length <= maxLength) {
    return compacted;
  }

  return `${compacted.slice(0, maxLength - 3).trim()}...`;
}
