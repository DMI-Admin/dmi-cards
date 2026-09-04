import "server-only";

const maxEmailLength = 320;
const maxSubjectLength = 180;
const maxBodyLength = 10_000;
const emailPattern = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

export class EmailMimeError extends Error {
  code:
    | "EMAIL_RECIPIENT_INVALID"
    | "EMAIL_FROM_INVALID"
    | "EMAIL_SUBJECT_INVALID"
    | "EMAIL_BODY_INVALID";

  constructor(code: EmailMimeError["code"]) {
    super(code);
    this.name = "EmailMimeError";
    this.code = code;
  }
}

export type PlainTextEmailInput = {
  to: string;
  from?: string | null;
  subject: string;
  body: string;
};

export function buildPlainTextEmailRaw(input: PlainTextEmailInput) {
  const to = sanitizeEmailAddress(input.to, "EMAIL_RECIPIENT_INVALID");
  const from = input.from
    ? sanitizeEmailAddress(input.from, "EMAIL_FROM_INVALID")
    : null;
  const subject = sanitizeHeaderValue(
    input.subject,
    maxSubjectLength,
    "EMAIL_SUBJECT_INVALID"
  );
  const body = sanitizeBody(input.body);
  const headers = [
    from ? `From: ${from}` : null,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
  ].filter(Boolean);

  return base64UrlEncode(`${headers.join("\r\n")}\r\n\r\n${body}`);
}

function sanitizeEmailAddress(
  value: string,
  errorCode: "EMAIL_RECIPIENT_INVALID" | "EMAIL_FROM_INVALID"
) {
  const trimmed = value.trim();

  if (
    !trimmed ||
    trimmed.length > maxEmailLength ||
    hasHeaderBreak(trimmed) ||
    !emailPattern.test(trimmed)
  ) {
    throw new EmailMimeError(errorCode);
  }

  return trimmed;
}

function sanitizeHeaderValue(
  value: string,
  maxLength: number,
  errorCode: "EMAIL_SUBJECT_INVALID"
) {
  const trimmed = value.trim();

  if (!trimmed || trimmed.length > maxLength || hasHeaderBreak(trimmed)) {
    throw new EmailMimeError(errorCode);
  }

  return trimmed;
}

function sanitizeBody(value: string) {
  const normalized = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();

  if (!normalized || normalized.length > maxBodyLength) {
    throw new EmailMimeError("EMAIL_BODY_INVALID");
  }

  return normalized.replace(/\n/g, "\r\n");
}

function encodeHeader(value: string) {
  if (/^[\x20-\x7e]*$/.test(value)) return value;

  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function hasHeaderBreak(value: string) {
  return /[\r\n]/.test(value);
}

function base64UrlEncode(value: string) {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
