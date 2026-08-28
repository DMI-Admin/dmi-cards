import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiRouteError } from "@/lib/api/responses";

export const contactSources = [
  "digital_card",
  "business_card_scan",
  "manual",
  "import",
  "integration",
] as const;

export const contactStatuses = [
  "new",
  "contacted",
  "qualified",
  "archived",
] as const;

export type ContactSource = (typeof contactSources)[number];
export type ContactStatus = (typeof contactStatuses)[number];

export type ContactRow = {
  id: string;
  owner_user_id: string;
  card_id: string | null;
  card_slot: number | null;
  source: ContactSource;
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  company: string | null;
  job_title: string | null;
  website: string | null;
  address: string | null;
  message: string | null;
  notes: string | null;
  tags: string[];
  status: ContactStatus;
  consent_given: boolean | null;
  consent_notice: string | null;
  terms_url: string | null;
  submitted_at: string | null;
  crm_status: string | null;
  crm_provider: string | null;
  crm_external_id: string | null;
  crm_last_synced_at: string | null;
  crm_error: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type ContactListFilters = {
  search?: string;
  source?: string;
  cardId?: string;
  cardSlot?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: string;
};

type ContactWriteInput = Record<string, unknown>;

type CardAttribution = {
  card_id: string | null;
  card_slot: number | null;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const maxMetadataBytes = 8000;
const fieldLimits = {
  name: 180,
  first_name: 90,
  last_name: 90,
  email: 254,
  phone: 60,
  mobile: 60,
  company: 180,
  job_title: 180,
  website: 2048,
  address: 500,
  message: 2000,
  notes: 3000,
  consent_notice: 1000,
  terms_url: 2048,
} as const;

export async function listContactsForUser(
  supabase: SupabaseClient,
  ownerUserId: string,
  filters: ContactListFilters
) {
  const normalized = normalizeListFilters(filters);
  let query = supabase
    .from("contacts")
    .select("*")
    .eq("owner_user_id", ownerUserId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(normalized.limit);

  if (normalized.source) query = query.eq("source", normalized.source);
  if (normalized.status) query = query.eq("status", normalized.status);
  if (normalized.cardId) query = query.eq("card_id", normalized.cardId);
  if (normalized.cardSlot) query = query.eq("card_slot", normalized.cardSlot);
  if (normalized.dateFrom) query = query.gte("created_at", normalized.dateFrom);
  if (normalized.dateTo) query = query.lt("created_at", normalized.dateTo);
  if (normalized.search) {
    const value = escapeSearchValue(normalized.search);
    query = query.or(
      [
        `name.ilike.%${value}%`,
        `first_name.ilike.%${value}%`,
        `last_name.ilike.%${value}%`,
        `email.ilike.%${value}%`,
        `phone.ilike.%${value}%`,
        `mobile.ilike.%${value}%`,
        `company.ilike.%${value}%`,
        `job_title.ilike.%${value}%`,
      ].join(",")
    );
  }

  const { data, error } = await query;

  if (error) {
    console.error("[DMI contacts] list failed", { code: error.code });
    throw new ApiRouteError(500, "INTERNAL_ERROR", "Could not load contacts.");
  }

  return (data || []) as ContactRow[];
}

export async function getContactForUser(
  supabase: SupabaseClient,
  ownerUserId: string,
  contactId: string
) {
  assertUuid(contactId, "Contact not found.");

  const { data, error } = await supabase
    .from("contacts")
    .select("*")
    .eq("id", contactId)
    .eq("owner_user_id", ownerUserId)
    .maybeSingle();

  if (error) {
    console.error("[DMI contacts] get failed", { code: error.code });
    throw new ApiRouteError(500, "INTERNAL_ERROR", "Could not load contact.");
  }

  if (!data) {
    throw new ApiRouteError(404, "NOT_FOUND", "Contact not found.");
  }

  return data as ContactRow;
}

export async function createContactForUser(
  supabase: SupabaseClient,
  ownerUserId: string,
  input: ContactWriteInput
) {
  const payload = await buildContactPayload(supabase, ownerUserId, input, "create");
  const { data, error } = await supabase
    .from("contacts")
    .insert([{ ...payload, owner_user_id: ownerUserId }])
    .select("*")
    .single();

  if (error) {
    console.error("[DMI contacts] create failed", { code: error.code });
    throw new ApiRouteError(500, "INTERNAL_ERROR", "Could not create contact.");
  }

  return data as ContactRow;
}

export async function updateContactForUser(
  supabase: SupabaseClient,
  ownerUserId: string,
  contactId: string,
  input: ContactWriteInput
) {
  assertUuid(contactId, "Contact not found.");
  await getContactForUser(supabase, ownerUserId, contactId);
  const payload = await buildContactPayload(supabase, ownerUserId, input, "update");

  const { data, error } = await supabase
    .from("contacts")
    .update(payload)
    .eq("id", contactId)
    .eq("owner_user_id", ownerUserId)
    .select("*")
    .single();

  if (error) {
    console.error("[DMI contacts] update failed", { code: error.code });
    throw new ApiRouteError(500, "INTERNAL_ERROR", "Could not update contact.");
  }

  return data as ContactRow;
}

export async function deleteContactForUser(
  supabase: SupabaseClient,
  ownerUserId: string,
  contactId: string
) {
  assertUuid(contactId, "Contact not found.");

  const { data, error } = await supabase
    .from("contacts")
    .delete()
    .eq("id", contactId)
    .eq("owner_user_id", ownerUserId)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[DMI contacts] delete failed", { code: error.code });
    throw new ApiRouteError(500, "INTERNAL_ERROR", "Could not delete contact.");
  }

  if (!data) {
    throw new ApiRouteError(404, "NOT_FOUND", "Contact not found.");
  }

  return { id: contactId };
}

export function contactsToCsv(contacts: ContactRow[]) {
  const headers = [
    "name",
    "first_name",
    "last_name",
    "email",
    "phone",
    "mobile",
    "company",
    "job_title",
    "website",
    "address",
    "source",
    "card_slot",
    "status",
    "created_at",
    "submitted_at",
    "notes",
    "tags",
  ];

  return [
    headers.join(","),
    ...contacts.map((contact) =>
      headers
        .map((header) => csvEscape(csvValue(contact, header)))
        .join(",")
    ),
  ].join("\n");
}

async function buildContactPayload(
  supabase: SupabaseClient,
  ownerUserId: string,
  input: ContactWriteInput,
  mode: "create" | "update"
) {
  if (!isObjectRecord(input)) {
    throw new ApiRouteError(400, "INVALID_REQUEST", "Contact payload is invalid.");
  }

  const attribution = await resolveCardAttribution(supabase, ownerUserId, input, mode);
  const payload: Record<string, unknown> = attribution ? { ...attribution } : {};

  if (mode === "create") {
    payload.source = normalizeSource(input.source, "manual");
    payload.status = normalizeStatus(input.status, "new");
  } else {
    if ("source" in input) payload.source = normalizeSource(input.source);
    if ("status" in input) payload.status = normalizeStatus(input.status);
  }

  for (const field of Object.keys(fieldLimits) as Array<keyof typeof fieldLimits>) {
    if (field in input) {
      payload[field] = normalizeText(input[field], fieldLimits[field], field);
    }
  }

  if ("email" in payload && payload.email && !emailPattern.test(String(payload.email))) {
    throw new ApiRouteError(400, "INVALID_REQUEST", "Enter a valid email address.");
  }

  for (const urlField of ["website", "terms_url"] as const) {
    if (urlField in payload && payload[urlField]) {
      payload[urlField] = normalizeUrl(String(payload[urlField]), urlField);
    }
  }

  if ("tags" in input) payload.tags = normalizeTags(input.tags);
  if ("consent_given" in input) payload.consent_given = normalizeBoolean(input.consent_given);
  if ("submitted_at" in input) payload.submitted_at = normalizeTimestamp(input.submitted_at);
  if ("metadata" in input) payload.metadata = normalizeMetadata(input.metadata);

  if (mode === "create") {
    payload.tags = payload.tags || [];
    payload.metadata = payload.metadata || {};
  }

  if (Object.keys(payload).length === 0) {
    throw new ApiRouteError(400, "INVALID_REQUEST", "No contact fields were provided.");
  }

  return payload;
}

async function resolveCardAttribution(
  supabase: SupabaseClient,
  ownerUserId: string,
  input: ContactWriteInput,
  mode: "create" | "update"
): Promise<CardAttribution | null> {
  if (mode === "update" && !("card_id" in input) && !("card_slot" in input)) {
    return null;
  }

  const cardIdValue = typeof input.card_id === "string" ? input.card_id.trim() : "";

  if (cardIdValue) {
    assertUuid(cardIdValue, "Card attribution is invalid.", 400);

    const { data, error } = await supabase
      .from("cards")
      .select("id, card_slot")
      .eq("id", cardIdValue)
      .eq("user_id", ownerUserId)
      .maybeSingle();

    if (error) {
      console.error("[DMI contacts] card attribution lookup failed", {
        code: error.code,
      });
      throw new ApiRouteError(500, "INTERNAL_ERROR", "Could not validate card attribution.");
    }

    if (!data) {
      throw new ApiRouteError(400, "INVALID_REQUEST", "Card attribution is invalid.");
    }

    const card = data as { id: string; card_slot: number | null };
    return {
      card_id: card.id,
      card_slot: normalizeCardSlot(card.card_slot),
    };
  }

  if (input.card_id === null) {
    return {
      card_id: null,
      card_slot: normalizeNullableCardSlot(input.card_slot),
    };
  }

  if ("card_slot" in input) {
    return {
      card_id: null,
      card_slot: normalizeNullableCardSlot(input.card_slot),
    };
  }

  return { card_id: null, card_slot: null };
}

function normalizeListFilters(filters: ContactListFilters) {
  const source = filters.source ? normalizeSource(filters.source) : null;
  const status = filters.status ? normalizeStatus(filters.status) : null;
  const cardId = filters.cardId ? filters.cardId.trim() : "";
  const cardSlot =
    filters.cardSlot === undefined || filters.cardSlot === ""
      ? null
      : normalizeRequiredCardSlot(filters.cardSlot);
  const limit = Math.min(Math.max(Number(filters.limit) || 100, 1), 250);

  if (cardId) assertUuid(cardId, "Card filter is invalid.", 400);

  return {
    search: normalizeText(filters.search, 120, "search"),
    source,
    status,
    cardId: cardId || null,
    cardSlot,
    dateFrom: filters.dateFrom ? normalizeDateBoundary(filters.dateFrom, false) : null,
    dateTo: filters.dateTo ? normalizeDateBoundary(filters.dateTo, true) : null,
    limit,
  };
}

function normalizeSource(value: unknown, fallback?: ContactSource) {
  if (value === undefined || value === null || value === "") {
    if (fallback) return fallback;
    throw new ApiRouteError(400, "INVALID_REQUEST", "Contact source is invalid.");
  }

  if (contactSources.includes(value as ContactSource)) {
    return value as ContactSource;
  }

  throw new ApiRouteError(400, "INVALID_REQUEST", "Contact source is invalid.");
}

function normalizeStatus(value: unknown, fallback?: ContactStatus) {
  if (value === undefined || value === null || value === "") {
    if (fallback) return fallback;
    throw new ApiRouteError(400, "INVALID_REQUEST", "Contact status is invalid.");
  }

  if (contactStatuses.includes(value as ContactStatus)) {
    return value as ContactStatus;
  }

  throw new ApiRouteError(400, "INVALID_REQUEST", "Contact status is invalid.");
}

function normalizeText(value: unknown, limit: number, field: string) {
  if (value === undefined) return undefined;
  if (value === null) return null;

  if (typeof value !== "string") {
    throw new ApiRouteError(400, "INVALID_REQUEST", `${field} must be text.`);
  }

  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > limit) {
    throw new ApiRouteError(400, "INVALID_REQUEST", `${field} is too long.`);
  }

  return trimmed;
}

function normalizeUrl(value: string, field: string) {
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;

  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Unsupported protocol");
    }
    return url.toString();
  } catch {
    throw new ApiRouteError(400, "INVALID_REQUEST", `${field} must be a valid URL.`);
  }
}

function normalizeTags(value: unknown) {
  if (!Array.isArray(value)) {
    throw new ApiRouteError(400, "INVALID_REQUEST", "Tags must be a list.");
  }

  const tags = value
    .map((tag) => {
      if (typeof tag !== "string") return "";
      return tag.trim();
    })
    .filter(Boolean)
    .slice(0, 20);

  for (const tag of tags) {
    if (tag.length > 60) {
      throw new ApiRouteError(400, "INVALID_REQUEST", "Tags must be 60 characters or fewer.");
    }
  }

  return Array.from(new Set(tags));
}

function normalizeBoolean(value: unknown) {
  if (value === null) return null;
  if (typeof value === "boolean") return value;
  throw new ApiRouteError(400, "INVALID_REQUEST", "Consent must be true or false.");
}

function normalizeTimestamp(value: unknown) {
  if (value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new ApiRouteError(400, "INVALID_REQUEST", "Submitted date is invalid.");
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ApiRouteError(400, "INVALID_REQUEST", "Submitted date is invalid.");
  }

  return date.toISOString();
}

function normalizeDateBoundary(value: string, exclusiveEnd: boolean) {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = new Date(dateOnly ? `${value}T00:00:00.000Z` : value);

  if (Number.isNaN(date.getTime())) {
    throw new ApiRouteError(400, "INVALID_REQUEST", "Date filter is invalid.");
  }

  if (exclusiveEnd && dateOnly) {
    date.setUTCDate(date.getUTCDate() + 1);
  }

  return date.toISOString();
}

function normalizeMetadata(value: unknown) {
  if (!isObjectRecord(value)) {
    throw new ApiRouteError(400, "INVALID_REQUEST", "Metadata must be an object.");
  }

  const json = JSON.stringify(value);
  if (json.length > maxMetadataBytes) {
    throw new ApiRouteError(400, "INVALID_REQUEST", "Metadata is too large.");
  }

  const {
    owner_user_id: _ownerUserId,
    user_id: _userId,
    card_id: _cardId,
    card_slot: _cardSlot,
    ...metadata
  } = value;
  void _ownerUserId;
  void _userId;
  void _cardId;
  void _cardSlot;

  return metadata;
}

function normalizeNullableCardSlot(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const slot = Number(value);
  const normalized = normalizeCardSlot(slot);

  if (!normalized) {
    throw new ApiRouteError(400, "INVALID_REQUEST", "Card slot is invalid.");
  }

  return normalized;
}

function normalizeRequiredCardSlot(value: unknown) {
  const slot = Number(value);
  const normalized = normalizeCardSlot(slot);

  if (!normalized) {
    throw new ApiRouteError(400, "INVALID_REQUEST", "Card slot is invalid.");
  }

  return normalized;
}

function normalizeCardSlot(value: unknown) {
  return value === 1 || value === 2 || value === 3 ? value : null;
}

function assertUuid(
  value: string,
  message: string,
  status: 400 | 404 = 404
) {
  if (!uuidPattern.test(value)) {
    throw new ApiRouteError(
      status,
      status === 400 ? "INVALID_REQUEST" : "NOT_FOUND",
      message
    );
  }
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function escapeSearchValue(value: string) {
  return value.replace(/[%_,]/g, "\\$&");
}

function csvValue(contact: ContactRow, header: string) {
  if (header === "tags") return contact.tags.join("; ");
  const value = contact[header as keyof ContactRow];
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function csvEscape(value: string) {
  const safeValue = neutralizeSpreadsheetFormula(value);
  return `"${safeValue.replaceAll('"', '""')}"`;
}

function neutralizeSpreadsheetFormula(value: string) {
  const firstMeaningfulCharacter = value.trimStart().charAt(0);

  if (
    firstMeaningfulCharacter === "=" ||
    firstMeaningfulCharacter === "+" ||
    firstMeaningfulCharacter === "-" ||
    firstMeaningfulCharacter === "@"
  ) {
    return `'${value}`;
  }

  return value;
}
