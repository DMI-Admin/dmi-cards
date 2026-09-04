import { NextRequest } from "next/server";
import { ApiRouteError, apiErrorFromUnknown, apiSuccess } from "@/lib/api/responses";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  normalizeLeadCaptureSettings,
  type LeadField,
} from "@/lib/services/card-payload";
import { enforcePublicLeadRateLimit } from "@/lib/security/public-lead-rate-limit";
import { logError, logInfo, logWarn, safeErrorMetadata } from "@/lib/observability/logger";
import { requestIdFromRequest, withRequestIdHeader } from "@/lib/observability/request";
import { normalizeInternationalPhoneNumber } from "@/lib/phone-number";

type RouteContext = {
  params: Promise<{
    slug: string;
  }>;
};

type PublicLeadCardRow = {
  id: string;
  user_id: string | null;
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
const splitNameFieldLimits = {
  first_name: 90,
  last_name: 90,
} as const;
const minimumSuspiciousFormTimeMs = envInt("PUBLIC_LEAD_MIN_FORM_TIME_MS", 800);

export async function POST(request: NextRequest, context: RouteContext) {
  const requestId = requestIdFromRequest(request);
  const route = "/api/public/cards/[slug]/leads";

  try {
    const { slug } = await context.params;
    const normalizedSlug = normalizeSlug(slug);
    await enforcePublicLeadRateLimit({ request, slug: normalizedSlug, requestId });

    const body = await request.json().catch(() => null);
    if (!isRecord(body)) {
      throw new ApiRouteError(400, "INVALID_REQUEST", "Lead payload is invalid.");
    }

    const antiBot = normalizeAntiBotPayload(body.anti_bot);
    if (antiBot.honeypotFilled) {
      throw new ApiRouteError(400, "INVALID_REQUEST", "Lead payload is invalid.");
    }

    if (antiBot.submittedTooQuickly) {
      await enforcePublicLeadRateLimit({
        request,
        slug: normalizedSlug,
        phase: "suspicious",
        requestId,
      });
    }

    const supabaseAdmin = createSupabaseAdminClient();
    const { data: card, error: cardError } = await supabaseAdmin
      .from("cards")
      .select("id, user_id, slug, status, is_published, card_slot, lead_capture_settings")
      .eq("slug", normalizedSlug)
      .maybeSingle();

    if (cardError) {
      logError({
        code: "PUBLIC_LEAD_CARD_LOOKUP_FAILED",
        requestId,
        route,
        metadata: {
          databaseCode: cardError.code,
        },
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

    const ownerUserId = publicCard.user_id;
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

    const { data: leadResult, error: leadError } = await supabaseAdmin.rpc(
      "create_public_card_lead_v2",
      {
        p_card_slug: normalizedSlug,
        p_name: contactPayload.name || null,
        p_first_name: contactPayload.first_name || null,
        p_last_name: contactPayload.last_name || null,
        p_email: contactPayload.email || null,
        p_phone: contactPayload.phone || null,
        p_company: contactPayload.company || null,
        p_job_title: contactPayload.job_title || null,
        p_website: contactPayload.website || null,
        p_message: contactPayload.message || null,
        p_consent_given: null,
        p_consent_notice: settings.consent_notice,
        p_terms_url: privacyPolicyUrl,
        p_submitted_at: submittedAt,
        p_metadata: {
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
      }
    );

    if (leadError) {
      logError({
        code: "PUBLIC_LEAD_CONTACT_CREATION_FAILED",
        requestId,
        route,
        metadata: {
          databaseCode: leadError.code,
        },
      });
      throw new ApiRouteError(500, "INTERNAL_ERROR", "Could not submit your details.");
    }

    const normalizedLeadResult = normalizeLeadResult(leadResult);
    logInfo({
      code: "PUBLIC_LEAD_SUBMITTED",
      requestId,
      route,
      metadata: {
        created: normalizedLeadResult.created,
        fieldCount: settings.fields.length,
        marketingEnabled: settings.marketing_opt_in_enabled === true,
      },
    });

    return withRequestIdHeader(
      apiSuccess({
        contactId: normalizedLeadResult.contactId,
        created: normalizedLeadResult.created,
      }),
      requestId
    );
  } catch (error) {
    if (error instanceof ApiRouteError) {
      const log = error.status >= 500 ? logError : error.status === 429 ? logWarn : logInfo;
      log({
        code: error.status === 429 ? "PUBLIC_LEAD_RATE_LIMITED" : "PUBLIC_LEAD_REJECTED",
        requestId,
        route,
        metadata: {
          status: error.status,
          errorCode: error.code,
        },
      });
    } else {
      logError({
        code: "PUBLIC_LEAD_FAILED",
        requestId,
        route,
        metadata: safeErrorMetadata(error),
      });
    }

    return withRequestIdHeader(apiErrorFromUnknown(error), requestId);
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
    if (field === "name") {
      const firstName = normalizeSubmittedTextField(
        submittedFields.first_name,
        splitNameFieldLimits.first_name,
        "first_name"
      );
      const lastName = normalizeSubmittedTextField(
        submittedFields.last_name,
        splitNameFieldLimits.last_name,
        "last_name"
      );
      const legacyName = normalizeSubmittedTextField(
        submittedFields.name,
        fieldLimits.name,
        "name"
      );
      const combinedName = [firstName, lastName].filter(Boolean).join(" ").trim();

      if (firstName) payload.first_name = firstName;
      if (lastName) payload.last_name = lastName;
      if (combinedName || legacyName) payload.name = combinedName || legacyName;
      continue;
    }

    const rawValue = submittedFields[field];
    const value = normalizeSubmittedTextField(rawValue, fieldLimits[field], field);
    if (!value) continue;
    payload[field] = field === "phone" ? normalizeInternationalPhoneNumber(value) || value : value;
  }

  return payload;
}

function normalizeSubmittedTextField(
  rawValue: unknown,
  limit: number,
  field: string
) {
  if (rawValue === undefined || rawValue === null || rawValue === "") return null;
  if (typeof rawValue !== "string") {
    throw new ApiRouteError(400, "INVALID_REQUEST", `${field} must be text.`);
  }

  const value = rawValue.trim();
  if (!value) return null;
  if (value.length > limit) {
    throw new ApiRouteError(400, "INVALID_REQUEST", `${field} is too long.`);
  }

  return value;
}

function isPublished(card: PublicLeadCardRow) {
  return card.status === "published" || card.is_published === true;
}

function normalizeAntiBotPayload(value: unknown) {
  const payload = isRecord(value) ? value : {};
  const honeypot = typeof payload.website_confirm === "string" ? payload.website_confirm : "";
  const renderedAt =
    typeof payload.rendered_at === "string" || typeof payload.rendered_at === "number"
      ? Number(payload.rendered_at)
      : NaN;
  const elapsedMs = Number.isFinite(renderedAt) ? Date.now() - renderedAt : null;

  return {
    honeypotFilled: honeypot.trim().length > 0,
    submittedTooQuickly:
      elapsedMs !== null && elapsedMs >= 0 && elapsedMs < minimumSuspiciousFormTimeMs,
  };
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

function normalizeLeadResult(value: unknown) {
  if (!isRecord(value)) {
    throw new ApiRouteError(500, "INTERNAL_ERROR", "Could not submit your details.");
  }

  const contactId = typeof value.contact_id === "string" ? value.contact_id : "";
  const created = value.created === true;

  if (!contactId) {
    throw new ApiRouteError(500, "INTERNAL_ERROR", "Could not submit your details.");
  }

  return { contactId, created };
}

function envInt(name: string, fallback: number) {
  const value = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}
