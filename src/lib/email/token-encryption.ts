import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const encryptedTokenVersion = "v1";
const algorithm = "aes-256-gcm";

export class EmailTokenEncryptionError extends Error {
  code:
    | "EMAIL_TOKEN_ENCRYPTION_KEY_MISSING"
    | "EMAIL_TOKEN_ENCRYPTION_KEY_INVALID"
    | "EMAIL_TOKEN_ENCRYPTION_FAILED"
    | "EMAIL_TOKEN_DECRYPTION_FAILED";

  constructor(code: EmailTokenEncryptionError["code"]) {
    super(code);
    this.name = "EmailTokenEncryptionError";
    this.code = code;
  }
}

export function isEmailTokenEncryptionConfigured() {
  try {
    getEncryptionKey();
    return true;
  } catch {
    return false;
  }
}

export function encryptEmailToken(token: string) {
  if (!token) {
    throw new EmailTokenEncryptionError("EMAIL_TOKEN_ENCRYPTION_FAILED");
  }

  try {
    const key = getEncryptionKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv(algorithm, key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(token, "utf8"),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    return [
      encryptedTokenVersion,
      base64Url(iv),
      base64Url(tag),
      base64Url(ciphertext),
    ].join(":");
  } catch (error) {
    if (error instanceof EmailTokenEncryptionError) throw error;
    throw new EmailTokenEncryptionError("EMAIL_TOKEN_ENCRYPTION_FAILED");
  }
}

export function decryptEmailToken(encryptedToken: string) {
  try {
    const [version, encodedIv, encodedTag, encodedCiphertext] =
      encryptedToken.split(":");

    if (
      version !== encryptedTokenVersion ||
      !encodedIv ||
      !encodedTag ||
      !encodedCiphertext
    ) {
      throw new EmailTokenEncryptionError("EMAIL_TOKEN_DECRYPTION_FAILED");
    }

    const iv = fromBase64Url(encodedIv);
    const tag = fromBase64Url(encodedTag);
    const ciphertext = fromBase64Url(encodedCiphertext);

    if (iv.length !== 12 || tag.length !== 16) {
      throw new EmailTokenEncryptionError("EMAIL_TOKEN_DECRYPTION_FAILED");
    }

    const decipher = createDecipheriv(algorithm, getEncryptionKey(), iv);
    decipher.setAuthTag(tag);

    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch (error) {
    if (error instanceof EmailTokenEncryptionError) throw error;
    throw new EmailTokenEncryptionError("EMAIL_TOKEN_DECRYPTION_FAILED");
  }
}

function getEncryptionKey() {
  const rawKey = process.env.EMAIL_TOKEN_ENCRYPTION_KEY?.trim();

  if (!rawKey) {
    throw new EmailTokenEncryptionError("EMAIL_TOKEN_ENCRYPTION_KEY_MISSING");
  }

  const candidates = [
    rawKey,
    rawKey.replace(/^base64:/i, ""),
    rawKey.replace(/^hex:/i, ""),
  ];

  for (const candidate of candidates) {
    const key = parseKey(candidate);
    if (key?.length === 32) return key;
  }

  throw new EmailTokenEncryptionError("EMAIL_TOKEN_ENCRYPTION_KEY_INVALID");
}

function parseKey(value: string) {
  if (/^[0-9a-f]{64}$/i.test(value)) {
    return Buffer.from(value, "hex");
  }

  try {
    const decoded = Buffer.from(value, "base64");
    const roundTrip = decoded.toString("base64").replace(/=+$/, "");
    const normalized = value.replace(/=+$/, "");

    if (
      decoded.length === 32 &&
      timingSafeEqual(Buffer.from(roundTrip), Buffer.from(normalized))
    ) {
      return decoded;
    }
  } catch {
    return null;
  }

  return null;
}

function base64Url(value: Buffer) {
  return value
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);

  return Buffer.from(`${normalized}${padding}`, "base64");
}
