import { NextRequest } from "next/server";
import { ApiRouteError, apiErrorFromUnknown, apiSuccess } from "@/lib/api/responses";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { createContactForUser } from "@/lib/services/contact-service";
import {
  normalizeLeadCaptureSettings,
  type LeadField,
} from "@/lib/services/card-payload";

type RouteContext = {
  params: Promise<{
    slug: string;
  }>;
};

type PublicLeadCardRow = {
  id: string;
  user_id: string | null;
  profile_id: string | null;
  slug: string | null;
  status: string | null;
  is_published: boolean | null;
  card_slot: number | null;
  lead_capture_settings: unknown;
};

const allowedLeadFields = new Set<LeadField>([
  "name",
  "email",
  "phone",
  "company",
  "job_title",
  "website",
  "message",
]);
const fieldLimits: Record<LeadField, number> = {
  name: 180,
  email: 254,
  phone: 60,
  company: 180,
  job_title: 180,
  website: 2048,
  message: 2000,
};
const requestBuckets = new Map<string, number[]>();
const rateLimitWindowMs = 60_000;
const rateLimitMax = 10;

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { slug } = await context.params;
    const normalizedSlug = normalizeSlug(slug);
    enforcePublicLeadRateLimit(request, normalizedSlug);

    const body = await request.json().catch(() => null);
    if (!isRecord(body)) {
      throw new ApiRouteError(400, "INVALID_REQUEST", "Lead payload is invalid.");
    }

    const supabaseAdmin = createSupabaseAdminClient();
    const { data: card, error: cardError } = await supabaseAdmin
      .from("cards")
      .select("id, user_id, profile_id, slug, status, is_published, card_slot, lead_capture_settings")
      .eq("slug", normalizedSlug)
      .maybeSingle();

    if (cardError) {
      console.error("[DMI public leads] card lookup failed", {
        code: cardError.code,
      });
      throw new ApiRouteError(500, "INTERNAL_ERROR", "Could not submit your details.");
    }

    if (!card) {
      throw new ApiRouteError(404, "NOT_FOUND", "Card not found.");
    }

    const publicCard = card as PublicLeadCardRow;
    if (!isPublished(publicCard)) {
      throw new ApiRouteError(404, "NOT_FOUND", "Card not found.");
    }

    const ownerUserId = publicCard.user_id || publicCard.profile_id;
    if (!ownerUserId) {
      throw new ApiRouteError(500, "INTERNAL_ERROR", "Could not submit your details.");
    }

    const settings = normalizeLeadCaptureSettings(publicCard.lead_capture_settings);
    if (settings.flow !== "collect_first") {
      throw new ApiRouteError(400, "INVALID_REQUEST", "This card is not collecting details.");
    }

    if (settings.fields.length === 0) {
      throw new ApiRouteError(409, "CONFLICT", "This card is not ready to collect details.");
    }

    const submittedFields = isRecord(body.fields) ? body.fields : {};
    const contactPayload = buildContactPayloadFromConfiguredFields(
      submittedFields,
      settings.fields
    );

    if (!Object.keys(contactPayload).some((key) => Boolean(contactPayload[key]))) {
      throw new ApiRouteError(400, "INVALID_REQUEST", "Enter at least one contact detail.");
    }

    const marketingOptedIn = body.marketing_opted_in === true;
    const marketingLabel =
      settings.marketing_opt_in_label ||
      "I would like to receive occasional updates and marketing from this card owner.";
    const submittedAt = new Date().toISOString();
    const privacyPolicyUrl = normalizeOptionalPublicUrl(
      settings.privacy_policy_url || settings.terms_url
    );

    const contact = await createContactForUser(supabaseAdmin, ownerUserId, {
      ...contactPayload,
      card_id: publicCard.id,
      source: "digital_card",
      status: "new",
      consent_notice: settings.consent_notice,
      terms_url: privacyPolicyUrl,
      submitted_at: submittedAt,
      metadata: {
        public_submission: true,
        card_slug: normalizedSlug,
        configured_fields: settings.fields,
        marketing_consent: {
          enabled: settings.marketing_opt_in_enabled === true,
          opted_in: settings.marketing_opt_in_enabled === true ? marketingOptedIn : false,
          submitted_at: submittedAt,
          label: marketingLabel,
          version: settings.marketing_opt_in_version || null,
        },
        privacy_notice: {
          wording: settings.consent_notice,
          privacy_policy_url: privacyPolicyUrl,
        },
      },
    });

    return apiSuccess({ contactId: contact.id });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

function normalizeSlug(value: string) {
  const slug = value.trim();
  if (!/^[a-z0-9-]{1,120}$/i.test(slug)) {
    throw new ApiRouteError(400, "INVALID_REQUEST", "Card link is invalid.");
  }
  return slug;
}

function buildContactPayloadFromConfiguredFields(
  submittedFields: Record<string, unknown>,
  configuredFields: LeadField[]
) {
  const payload: Record<string, string | null> = {};

  for (const field of configuredFields) {
    if (!allowedLeadFields.has(field)) continue;
    const rawValue = submittedFields[field];
    if (rawValue === undefined || rawValue === null || rawValue === "") continue;
    if (typeof rawValue !== "string") {
      throw new ApiRouteError(400, "INVALID_REQUEST", `${field} must be text.`);
    }

    const value = rawValue.trim();
    if (!value) continue;
    if (value.length > fieldLimits[field]) {
      throw new ApiRouteError(400, "INVALID_REQUEST", `${field} is too long.`);
    }

    payload[field] = value;
  }

  return payload;
}

function enforcePublicLeadRateLimit(request: NextRequest, slug: string) {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip =
    forwardedFor ||
    request.headers.get("x-real-ip") ||
    request.headers.get("cf-connecting-ip") ||
    "unknown";
  const key = `${ip}:${slug}`;
  const now = Date.now();
  const recent = (requestBuckets.get(key) || []).filter(
    (timestamp) => now - timestamp < rateLimitWindowMs
  );

  if (recent.length >= rateLimitMax) {
    throw new ApiRouteError(429, "INVALID_REQUEST", "Please wait before trying again.");
  }

  recent.push(now);
  requestBuckets.set(key, recent);
}

function isPublished(card: PublicLeadCardRow) {
  return card.status === "published" || card.is_published === true;
}

function normalizeOptionalPublicUrl(value: string | undefined) {
  if (!value) return null;

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
