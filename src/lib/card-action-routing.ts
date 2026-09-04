import {
  actionFileReference,
  cardActionValue,
  fieldKeyForActionType,
  type CardActionConfig,
  type CardActionConfigItem,
  type CardActionDestinationField,
  type CardActionType,
} from "@/lib/card-actions";
import {
  normalizeInternationalPhoneNumber,
  phoneNumberForWhatsApp,
} from "@/lib/phone-number";

export type CardActionRoutingData = Partial<
  Record<CardActionDestinationField, string | null | undefined>
> & {
  title?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  job_title?: string | null;
  company_name?: string | null;
  website?: string | null;
  address?: string | null;
  action_config?: CardActionConfig | null;
};

export function resolveCardActionHref(
  action: CardActionConfigItem,
  cardData: CardActionRoutingData
) {
  if (action.type === "save_contact") {
    return vCardDataHref(cardData);
  }

  if (action.type === "download_pdf") {
    const fileReference = actionFileReference(action);

    return fileReference?.public_url ? safeWebUrl(fileReference.public_url) : null;
  }

  const fieldKey = fieldKeyForActionType(action.type);

  if (!fieldKey) return null;

  return resolveCardActionTypeHref(action.type, cardActionValue(cardData, action.type));
}

export function resolveCardActionTypeHref(
  type: CardActionType,
  value: string | null | undefined
) {
  switch (type) {
    case "call":
      return phoneHref(value);
    case "email":
      return emailHref(value);
    case "whatsapp":
      return whatsappHref(value);
    case "book_meeting":
    case "custom_link":
    case "linkedin":
    case "instagram":
    case "facebook":
    case "youtube":
      return safeWebUrl(value);
    case "save_contact":
    case "download_pdf":
      return null;
    default:
      return null;
  }
}

export function resolveCardFieldHref(field: string, value: string | null | undefined) {
  const displayValue = toDisplayValue(value);
  if (!displayValue) return null;

  switch (field.toLowerCase()) {
    case "website":
      return safeWebUrl(displayValue);
    case "address":
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
        displayValue
      )}`;
    case "email":
      return emailHref(displayValue);
    case "phone":
      return phoneHref(displayValue);
    case "whatsapp":
      return whatsappHref(displayValue);
    case "linkedin":
    case "instagram":
    case "facebook":
    case "youtube":
    case "booking_link":
    case "custom_url":
      return safeWebUrl(displayValue);
    default:
      return null;
  }
}

export function safeWebUrl(value: string | null | undefined) {
  const trimmed = value?.trim() || "";
  if (!trimmed) return null;

  if (trimmed.startsWith("//")) {
    return validHttpUrl(`https:${trimmed}`);
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    return /^https?:\/\//i.test(trimmed) ? validHttpUrl(trimmed) : null;
  }

  return validHttpUrl(`https://${trimmed}`);
}

export function phoneHref(value: string | null | undefined) {
  const normalized = normalizeInternationalPhoneNumber(value);

  return normalized ? `tel:${normalized}` : null;
}

export function emailHref(value: string | null | undefined) {
  const trimmed = value?.trim() || "";
  if (!trimmed || /[\r\n]/.test(trimmed)) return null;

  return `mailto:${trimmed}`;
}

export function whatsappHref(value: string | null | undefined) {
  const trimmed = value?.trim() || "";
  if (!trimmed) return null;

  const existingUrl = safeWebUrl(trimmed);

  if (existingUrl && isWhatsAppUrl(existingUrl)) {
    const fromUrl = normalizeWhatsAppUrl(existingUrl);
    return fromUrl || existingUrl;
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.startsWith("//")) {
    return null;
  }

  const normalizedPhone = phoneNumberForWhatsApp(trimmed);
  return normalizedPhone ? `https://wa.me/${normalizedPhone}` : null;
}

export function vCardDataHref(cardData: CardActionRoutingData) {
  return `data:text/vcard;charset=utf-8,${encodeURIComponent(vCardText(cardData))}`;
}

export function vCardFilename(cardData: CardActionRoutingData) {
  return `${slugifyFilename(displayName(cardData, "dmi-card"))}.vcf`;
}

export function vCardText(cardData: CardActionRoutingData) {
  const title = toDisplayValue(cardData.title);
  const firstName = toDisplayValue(cardData.first_name);
  const lastName = toDisplayValue(cardData.last_name);
  const fallbackName =
    [title, firstName, lastName].filter(Boolean).join(" ") || "DMI Card";
  const fullName = displayName(cardData, fallbackName);
  const jobTitle = toDisplayValue(cardData.job_title);
  const companyName = toDisplayValue(cardData.company_name);
  const email = toDisplayValue(cardData.email);
  const phone = toDisplayValue(cardData.phone);
  const website = toDisplayValue(cardData.website);
  const websiteUrl = website ? safeWebUrl(website) : null;
  const address = toDisplayValue(cardData.address);
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `N:${vCardEscape(lastName || "")};${vCardEscape(firstName || "")};;;${vCardEscape(
      title || ""
    )}`,
    `FN:${vCardEscape(fullName)}`,
  ];

  if (jobTitle) lines.push(`TITLE:${vCardEscape(jobTitle)}`);
  if (companyName) lines.push(`ORG:${vCardEscape(companyName)}`);
  if (email) lines.push(`EMAIL;TYPE=INTERNET:${vCardEscape(email)}`);
  if (phone) lines.push(`TEL;TYPE=CELL:${vCardEscape(phone)}`);
  if (websiteUrl) lines.push(`URL:${vCardEscape(websiteUrl)}`);
  if (address) lines.push(`ADR;TYPE=WORK:;;${vCardEscape(address)};;;;`);

  lines.push("END:VCARD");

  return lines.join("\r\n");
}

function normalizeWhatsAppUrl(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();

    if (host === "wa.me") {
      const number = phoneNumberForWhatsApp(url.pathname.replace(/^\/+/, ""));
      return number ? `https://wa.me/${number}` : null;
    }

    if (host === "api.whatsapp.com" || host === "web.whatsapp.com") {
      const number = phoneNumberForWhatsApp(url.searchParams.get("phone"));
      return number ? `https://wa.me/${number}` : null;
    }

    return null;
  } catch {
    return null;
  }
}

function isWhatsAppUrl(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      (host === "wa.me" ||
        host === "api.whatsapp.com" ||
        host === "web.whatsapp.com" ||
        host.endsWith(".whatsapp.com"))
    );
  } catch {
    return false;
  }
}

function validHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function displayName(
  cardData: Pick<CardActionRoutingData, "title" | "first_name" | "last_name" | "full_name">,
  fallback = "Full Name"
) {
  const splitName = [cardData.title, cardData.first_name, cardData.last_name]
    .map(toDisplayValue)
    .filter(Boolean)
    .join(" ");

  return toDisplayValue(cardData.full_name) || splitName || fallback;
}

function toDisplayValue(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }

  if (typeof value === "object") {
    for (const nestedValue of Object.values(value)) {
      const displayValue = toDisplayValue(nestedValue);

      if (displayValue) return displayValue;
    }

    return null;
  }

  return String(value);
}

function vCardEscape(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function slugifyFilename(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "dmi-card";
}
