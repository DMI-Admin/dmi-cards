import "server-only";

import type {
  CardRendererData,
  CardRendererTemplate,
} from "@/components/CardRenderer";
import {
  normalizeCardActionConfig,
  type CardActionConfig,
} from "@/lib/card-actions";
import { supabase } from "@/lib/supabase";
import {
  fallbackColour,
  fieldVisibilityValue,
  isFieldHidden,
  mergeFieldOrderWithTemplate,
  normalizeFieldVisibility,
  readableTextForColour,
  normalizeLeadCaptureSettings,
  type CardFieldOrder,
  type CardFieldVisibility,
  type LeadCaptureSettings,
} from "@/lib/services/card-payload";
import { normalizeColourPalette, normalizeTemplate } from "@/lib/templates";

export type PublicCardData = CardRendererData & {
  id: string;
  slug: string;
};

export type PublicCardResolveResult =
  | { status: "not_found" }
  | { status: "not_published" }
  | { status: "template_unavailable" }
  | {
      status: "ok";
      card: PublicCardData;
      template: CardRendererTemplate;
      leadCaptureSettings: LeadCaptureSettings;
    };

type PublicCardRow = CardRendererData & {
  id?: string | null;
  slug?: string | null;
  card_name?: string | null;
  template_id?: string | null;
  status?: string | null;
  is_published?: boolean | null;
  updated_at?: string | null;
  selected_colour?: string | null;
  selected_text_colour?: string | null;
  hidden_fields?: string[] | null;
  field_visibility?: CardFieldVisibility | null;
  field_order?: Partial<CardFieldOrder> | null;
  lead_capture_settings?: LeadCaptureSettings | null;
  action_config?: CardActionConfig | null;
};

export async function getPublishedPublicCardBySlug(
  slug: string
): Promise<PublicCardResolveResult> {
  const { data: card, error: cardError } = await supabase
    .from("cards")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();

  if (cardError || !card) {
    return { status: "not_found" };
  }

  const publicCardRow = card as PublicCardRow;

  if (!isPublicCardPublished(publicCardRow)) {
    return { status: "not_published" };
  }

  const template = await loadPublicTemplate(publicCardRow.template_id);

  if (!template) {
    return { status: "template_unavailable" };
  }

  const publicTemplate = buildPublicTemplate(template, publicCardRow);

  return {
    status: "ok",
    card: toPublicCardData(publicCardRow),
    template: publicTemplate,
    leadCaptureSettings: normalizeLeadCaptureSettings(
      publicCardRow.lead_capture_settings
    ),
  };
}

async function loadPublicTemplate(templateId?: string | null) {
  if (templateId) {
    const { data } = await supabase
      .from("templates")
      .select("*")
      .eq("id", templateId)
      .or("status.eq.published,is_published.eq.true")
      .maybeSingle();

    if (data) return data;
  }

  const { data } = await supabase
    .from("templates")
    .select("*")
    .eq("access_level", "free")
    .or("status.eq.published,is_published.eq.true")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  return data;
}

function buildPublicTemplate(
  template: Parameters<typeof normalizeTemplate>[0],
  card: PublicCardRow
): CardRendererTemplate {
  const normalizedTemplate = normalizeTemplate(template);
  const hiddenFields = new Set(
    Array.isArray(card.hidden_fields) ? card.hidden_fields : []
  );
  const fieldVisibility = normalizeFieldVisibility(card.field_visibility);
  const fieldOrder = mergeFieldOrderWithTemplate(
    card.field_order as CardFieldOrder | null | undefined,
    normalizedTemplate
  );
  const rendererFieldOrder = {
    personal: fieldOrder.personal.filter((field) =>
      isPublicFieldVisible(field, fieldVisibility, hiddenFields)
    ),
    company: fieldOrder.company.filter((field) =>
      isPublicFieldVisible(field, fieldVisibility, hiddenFields)
    ),
    contact: fieldOrder.contact.filter(
      (field) =>
        field !== "website" &&
        isPublicFieldVisible(field, fieldVisibility, hiddenFields)
    ),
    social: fieldOrder.social.filter((field) =>
      isPublicFieldVisible(field, fieldVisibility, hiddenFields)
    ),
  };
  const allowedFields = mergePublicAllowedFieldsWithFieldOrder(
    normalizedTemplate.allowed_fields || [],
    rendererFieldOrder,
    fieldVisibility,
    hiddenFields
  );
  const selectedColour =
    card.selected_colour ||
    normalizeColourPalette(normalizedTemplate.free_colour_palette)[0] ||
    fallbackColour;
  const selectedTextColour = selectedTextColourForPublicTemplate(
    normalizedTemplate,
    card.selected_text_colour,
    selectedColour
  );

  return {
    ...normalizedTemplate,
    allowed_fields: allowedFields,
    allowed_actions: normalizedTemplate.allowed_actions,
    custom_fields: rendererFieldOrder,
    text_color: selectedTextColour,
    free_colour_palette:
      normalizedTemplate.access_level === "free"
        ? [selectedColour]
        : normalizedTemplate.free_colour_palette,
    show_personal_section:
      (normalizedTemplate.show_personal_section ?? true) &&
      rendererFieldOrder.personal.length > 0,
    show_company_section:
      (normalizedTemplate.show_company_section ?? true) &&
      rendererFieldOrder.company.length > 0,
    show_contact_section:
      (normalizedTemplate.show_contact_section ?? true) &&
      rendererFieldOrder.contact.length > 0,
    show_social_section:
      (normalizedTemplate.show_social_section ?? false) &&
      rendererFieldOrder.social.length > 0,
  };
}

function selectedTextColourForPublicTemplate(
  template: CardRendererTemplate,
  selectedTextColour: string | null | undefined,
  backgroundColour: string
) {
  const palette = normalizeColourPalette(template.text_colours);

  if (selectedTextColour && palette.includes(selectedTextColour)) {
    return selectedTextColour;
  }

  if (selectedTextColour && palette.length === 0) {
    return selectedTextColour;
  }

  const templateTextColor = normalizeColourPalette(template.text_color)[0];
  if (templateTextColor) return templateTextColor;

  return readableTextForColour(backgroundColour);
}

function mergePublicAllowedFieldsWithFieldOrder(
  allowedFields: string[],
  fieldOrder: CardFieldOrder,
  fieldVisibility: CardFieldVisibility,
  hiddenFieldSet: Set<string>
) {
  const orderedFields = Object.values(fieldOrder).flat();
  const seen = new Set<string>();

  return [...allowedFields, ...orderedFields].filter((field) => {
    const key = field.toLowerCase();

    if (
      !isPublicFieldVisible(field, fieldVisibility, hiddenFieldSet) ||
      seen.has(key)
    ) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function isPublicFieldVisible(
  field: string,
  fieldVisibility: CardFieldVisibility,
  hiddenFieldSet: Set<string>
) {
  const visible = fieldVisibilityValue(field, fieldVisibility);

  if (typeof visible === "boolean") return visible;

  return !isFieldHidden(field, hiddenFieldSet);
}

function isPublicCardPublished(card: PublicCardRow) {
  return card.status === "published" || Boolean(card.is_published);
}

function toPublicCardData(card: PublicCardRow): PublicCardData {
  return {
    id: card.id || "",
    slug: card.slug || "",
    title: card.title || null,
    first_name: card.first_name || null,
    last_name: card.last_name || null,
    full_name: card.full_name || null,
    job_title: card.job_title || null,
    department: card.department || null,
    bio: card.bio || null,
    company_name: card.company_name || null,
    email: card.email || null,
    phone: card.phone || null,
    website: card.website || null,
    address: card.address || null,
    whatsapp: card.whatsapp || null,
    linkedin: card.linkedin || null,
    instagram: card.instagram || null,
    facebook: card.facebook || null,
    youtube: card.youtube || null,
    booking_link: card.booking_link || null,
    custom_url: card.custom_url || null,
    action_config: normalizeCardActionConfig(card.action_config),
    selected_text_colour: card.selected_text_colour || null,
    profile_image_url: card.profile_image_url || null,
    company_logo_url: card.company_logo_url || null,
    company_banner_url: card.company_banner_url || null,
    custom_fields: card.custom_fields || {},
  };
}
