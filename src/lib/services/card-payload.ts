import {
  displayName,
  type CardRendererData,
  type CardRendererTemplate,
} from "@/components/CardRenderer";
import type { DmiPlan } from "@/lib/entitlements";
import { normalizeColourPalette, type SharedTemplate } from "@/lib/templates";

export type ClientCardStatus = "published" | "unpublished";
export type ClientCardPlan = DmiPlan;
export type CardSectionKey = "personal" | "company" | "contact" | "social";
export type CardFieldVisibility = Record<string, boolean>;
export type CardFieldOrder = Record<CardSectionKey, string[]>;
export type LeadField =
  | "name"
  | "email"
  | "phone"
  | "company"
  | "job_title"
  | "website"
  | "message";
export type LeadCaptureSettings = {
  flow: "collect_first" | "share_first";
  fields: LeadField[];
  consent_notice: string;
  terms_url: string;
  follow_up_enabled: boolean;
};
export type SharedClientCard = CardRendererData & {
  id: string;
  card_name: string;
  template_id: string;
  template_name: string;
  status: ClientCardStatus;
  public_url: string;
  last_updated: string;
  card_slot?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  selected_colour?: string;
  hidden_fields?: string[];
  field_visibility?: CardFieldVisibility;
  slug?: string;
  field_order?: CardFieldOrder;
  lead_capture_settings?: LeadCaptureSettings;
};
export type SupabaseCardRow = CardRendererData & {
  id: string;
  card_name?: string | null;
  template_id?: string | null;
  profile_id?: string | null;
  status?: string | null;
  is_published?: boolean | null;
  slug?: string | null;
  profile_image_url?: string | null;
  company_logo_url?: string | null;
  company_banner_url?: string | null;
  selected_colour?: string | null;
  selected_text_colour?: string | null;
  hidden_fields?: string[] | null;
  field_visibility?: CardFieldVisibility | null;
  field_order?: CardFieldOrder | null;
  lead_capture_settings?: LeadCaptureSettings | null;
  card_slot?: number | null;
  updated_at?: string | null;
  created_at?: string | null;
};

export type CardTemplate = SharedTemplate;

export const defaultLeadCaptureSettings: LeadCaptureSettings = {
  flow: "share_first",
  fields: ["name", "email"],
  consent_notice:
    "I consent to sharing my details so this card owner can follow up.",
  terms_url: "https://www.devmasterinc.com/terms",
  follow_up_enabled: false,
};

export const fallbackColour = "#AC00FF";

const editableCardFields = new Set<string>([
  "title",
  "first_name",
  "last_name",
  "full_name",
  "job_title",
  "bio",
  "company_name",
  "department",
  "website",
  "address",
  "email",
  "phone",
  "whatsapp",
  "linkedin",
  "instagram",
  "facebook",
  "youtube",
  "booking_link",
  "custom_url",
]);

const sectionDefaults: CardFieldOrder = {
  personal: ["job_title", "bio", "department"],
  company: ["company_name", "website", "address"],
  contact: ["email", "phone"],
  social: [
    "whatsapp",
    "linkedin",
    "instagram",
    "facebook",
    "youtube",
    "booking_link",
    "custom_url",
  ],
};

export function templateColourPalette(
  template: CardTemplate | CardRendererTemplate | null
) {
  if (!template) return [];

  const freePalette = normalizeColourPalette(template.free_colour_palette);
  if (freePalette.length) return freePalette;

  const colourPalette = normalizeColourPalette(template.colour_palette);
  if (colourPalette.length) return colourPalette;

  return normalizeColourPalette(template.primary_color);
}

export function firstTemplateColour(
  template: CardTemplate | CardRendererTemplate | null
) {
  return templateColourPalette(template)[0] || fallbackColour;
}

export function templateTextColourPalette(
  template: CardTemplate | CardRendererTemplate | null,
  backgroundColour?: string | null
) {
  if (!template) return [readableTextForColour(backgroundColour || fallbackColour)];

  const templateRecord = template as CardRendererTemplate & {
    text_colours?: unknown;
  };
  const textPalette = normalizeColourPalette(templateRecord.text_colours);
  if (textPalette.length) return textPalette;

  const textColor = normalizeColourPalette(template.text_color);
  if (textColor.length) return textColor;

  return [readableTextForColour(backgroundColour || firstTemplateColour(template))];
}

export function firstTemplateTextColour(
  template: CardTemplate | CardRendererTemplate | null
) {
  return templateTextColourPalette(template, firstTemplateColour(template))[0] || "";
}

export function selectedColourForTemplate(
  template: CardTemplate | CardRendererTemplate | null,
  selectedColour: string | null | undefined
) {
  const palette = templateColourPalette(template);

  if (!palette.length) {
    return selectedColour || fallbackColour;
  }

  if (template?.access_level === "free") {
    return selectedColour && palette.includes(selectedColour)
      ? selectedColour
      : palette[0];
  }

  return selectedColour || palette[0];
}

export function selectedTextColourForTemplate(
  template: CardTemplate | CardRendererTemplate | null,
  selectedTextColour: string | null | undefined,
  backgroundColour?: string | null
) {
  const palette = templateTextColourPalette(
    template,
    backgroundColour || firstTemplateColour(template)
  );

  if (selectedTextColour && palette.includes(selectedTextColour)) {
    return selectedTextColour;
  }

  return palette[0] || readableTextForColour(backgroundColour || fallbackColour);
}

export function readableTextForColour(colour: string) {
  const hex = colour.replace("#", "");

  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return "#FFFFFF";

  const red = parseInt(hex.slice(0, 2), 16);
  const green = parseInt(hex.slice(2, 4), 16);
  const blue = parseInt(hex.slice(4, 6), 16);
  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;

  return luminance > 0.62 ? "#0F172A" : "#FFFFFF";
}

export function normalizeCardTemplates(templates: CardTemplate[]) {
  return templates
    .filter((template) => template.status === "published")
    .map((template) => {
      const colourPalette = normalizeColourPalette(template.colour_palette);
      const freeColourPalette = normalizeColourPalette(template.free_colour_palette);
      const primaryPalette = normalizeColourPalette(template.primary_color);
      const templatePalette =
        freeColourPalette.length
          ? freeColourPalette
          : colourPalette.length
            ? colourPalette
            : primaryPalette;

      return {
        ...template,
        access_level: template.access_level === "free" ? "free" : "paid",
        layout_type:
          template.access_level === "free"
            ? "classic_free"
            : template.layout_type || "premium_classic",
        colour_palette: colourPalette.length ? colourPalette : templatePalette,
        free_colour_palette: templatePalette,
      };
    });
}

export function visibleTemplatesForPlan(
  templates: CardTemplate[],
  plan: ClientCardPlan
) {
  const published = normalizeCardTemplates(templates);

  if (plan === "free") return published;

  return published.filter(
    (template) => template.access_level === "free" || isPaidTemplate(template)
  );
}

export function defaultTemplateForPlan(
  templates: CardTemplate[],
  plan: ClientCardPlan
) {
  const published = normalizeCardTemplates(templates);
  const freeTemplate =
    published.find((template) => template.access_level === "free") || null;

  if (plan === "free") return freeTemplate;

  return (
    published.find((template) => canSelectTemplate(template, plan)) ||
    freeTemplate ||
    null
  );
}

export function templateForCard(
  card: Pick<SharedClientCard, "template_id"> | null,
  templates: CardTemplate[],
  plan: ClientCardPlan
) {
  if (!card?.template_id) return null;

  const template =
    normalizeCardTemplates(templates).find((item) => item.id === card.template_id) ||
    null;

  if (template && canSelectTemplate(template, plan)) return template;

  return null;
}

export function isPaidTemplate(template: CardTemplate | CardRendererTemplate) {
  return template.access_level !== "free";
}

export function canSelectTemplate(
  template: CardTemplate | CardRendererTemplate,
  plan: ClientCardPlan
) {
  if (!isPaidTemplate(template)) {
    return template.layout_type === "classic_free" || template.layout_type === "classic";
  }

  return plan !== "free";
}

export function mapSupabaseCard(
  row: SupabaseCardRow,
  templates: CardTemplate[] = [],
  plan: ClientCardPlan = "free",
  defaultTemplate = defaultTemplateForPlan(templates, plan)
): SharedClientCard {
  const rowName = displayName(row, "");
  const slug = row.slug || slugify(rowName || row.card_name || "digital-card");
  const rowTemplate =
    templateForCard({ template_id: row.template_id || "" }, templates, plan) ||
    defaultTemplate;
  const templateName = rowTemplate?.name || "Free Classic";
  const fieldOrder = mergeFieldOrderWithTemplate(row.field_order, rowTemplate);
  const fieldVisibility = fieldVisibilityWithHiddenFallback(
    row.field_visibility,
    row.hidden_fields,
    fieldOrder
  );

  return {
    id: row.id,
    card_name: row.card_name || "Primary Digital Card",
    template_id: rowTemplate?.id || row.template_id || "",
    template_name: templateName,
    status: row.is_published || row.status === "published" ? "published" : "unpublished",
    public_url: `/u/${slug}`,
    last_updated: row.updated_at || row.created_at || "Saved",
    card_slot: normalizedCardSlot(row.card_slot),
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    slug,
    title: row.title || "",
    first_name: row.first_name || "",
    last_name: row.last_name || "",
    full_name: row.full_name || rowName,
    job_title: row.job_title || customFieldValue(row, "job_title"),
    department: row.department || customFieldValue(row, "department"),
    bio: row.bio || customFieldValue(row, "bio"),
    company_name: row.company_name || customFieldValue(row, "company_name"),
    email: row.email || customFieldValue(row, "email"),
    phone: row.phone || customFieldValue(row, "phone"),
    website: row.website || customFieldValue(row, "website"),
    address: row.address || customFieldValue(row, "address"),
    whatsapp: row.whatsapp || customFieldValue(row, "whatsapp"),
    linkedin: row.linkedin || customFieldValue(row, "linkedin"),
    instagram: row.instagram || customFieldValue(row, "instagram"),
    facebook: row.facebook || customFieldValue(row, "facebook"),
    youtube: row.youtube || customFieldValue(row, "youtube"),
    booking_link: row.booking_link || customFieldValue(row, "booking_link"),
    custom_url: row.custom_url || customFieldValue(row, "custom_url"),
    profile_image_url: row.profile_image_url || "",
    company_logo_url: row.company_logo_url || "",
    company_banner_url: row.company_banner_url || "",
    custom_fields: row.custom_fields || {},
    selected_colour: selectedColourForTemplate(rowTemplate, row.selected_colour),
    selected_text_colour: selectedTextColourForTemplate(
      rowTemplate,
      row.selected_text_colour,
      row.selected_colour || undefined
    ),
    hidden_fields: row.hidden_fields || [],
    field_visibility: fieldVisibility,
    field_order: fieldOrder,
    lead_capture_settings: row.lead_capture_settings || defaultLeadCaptureSettings,
  };
}

export function buildSupabaseCardPayload(
  card: SharedClientCard,
  userId: string
) {
  const isPublished = card.status === "published";
  const combinedName = displayName(card, "");
  const fieldOrder = card.field_order || getInitialFieldOrder(null);
  const fieldVisibility = buildPersistedFieldVisibility(card, fieldOrder);
  const cardSlot = normalizedCardSlot(card.card_slot);

  return {
    user_id: userId,
    profile_id: userId,
    template_id: card.template_id || null,
    card_name: card.card_name || "Primary Digital Card",
    slug: card.slug || slugify(combinedName || card.card_name || "digital-card"),
    title: card.title || null,
    first_name: card.first_name || "",
    last_name: card.last_name || "",
    full_name: combinedName || card.full_name || "",
    job_title: card.job_title || "",
    department: card.department || "",
    bio: card.bio || "",
    company_name: card.company_name || "",
    email: card.email || "",
    phone: card.phone || "",
    website: card.website || "",
    address: card.address || "",
    whatsapp: card.whatsapp || "",
    linkedin: card.linkedin || "",
    instagram: card.instagram || "",
    facebook: card.facebook || "",
    youtube: card.youtube || "",
    booking_link: card.booking_link || "",
    custom_url: card.custom_url || "",
    profile_image_url: card.profile_image_url || "",
    company_logo_url: card.company_logo_url || "",
    company_banner_url: card.company_banner_url || "",
    selected_colour: card.selected_colour || fallbackColour,
    selected_text_colour:
      card.selected_text_colour ||
      selectedTextColourForTemplate(null, null, card.selected_colour || fallbackColour),
    hidden_fields: hiddenFieldsFromVisibility(fieldVisibility, fieldOrder),
    field_visibility: fieldVisibility,
    field_order: fieldOrder,
    lead_capture_settings: card.lead_capture_settings || defaultLeadCaptureSettings,
    custom_fields: buildPersistedCustomFields(card),
    status: isPublished ? "published" : "draft",
    is_published: isPublished,
    ...(cardSlot ? { card_slot: cardSlot } : {}),
  };
}

function normalizedCardSlot(value: number | null | undefined) {
  return value === 1 || value === 2 || value === 3 ? value : null;
}

export function buildPersistedFieldVisibility(
  card: SharedClientCard,
  fieldOrder: CardFieldOrder
): CardFieldVisibility {
  const currentVisibility = normalizeFieldVisibility(card.field_visibility);
  const nextVisibility: CardFieldVisibility = { ...currentVisibility };

  Object.values(fieldOrder)
    .flat()
    .forEach((field) => {
      const key = customFieldStorageKey(field);
      nextVisibility[key] = isFieldVisible(field, card);
    });

  return nextVisibility;
}

export function hiddenFieldsFromVisibility(
  fieldVisibility: CardFieldVisibility,
  fieldOrder: CardFieldOrder
) {
  return Object.values(fieldOrder)
    .flat()
    .filter((field) => fieldVisibilityValue(field, fieldVisibility) === false);
}

export function hiddenFieldsForCard(
  card: Pick<SharedClientCard, "field_order" | "field_visibility" | "hidden_fields"> | null
) {
  if (!card) return [];

  const fieldOrder = card.field_order || getInitialFieldOrder(null);
  return Object.values(fieldOrder)
    .flat()
    .filter((field) => !isFieldVisible(field, card));
}

export function buildPersistedCustomFields(card: SharedClientCard) {
  const values: Record<string, string> = {};
  const fieldOrder = card.field_order || getInitialFieldOrder(null);
  const fields = Object.values(fieldOrder).flat();

  fields.forEach((field) => {
    const value = isEditableCardField(field)
      ? card[field]
      : customFieldValue(card, field);
    const textValue = typeof value === "string" ? value.trim() : "";

    if (!textValue) return;

    values[customFieldStorageKey(field)] = textValue;
  });

  return values;
}

export function customFieldStorageKey(field: string) {
  return field.startsWith("custom:")
    ? field.split(":").at(-1)?.trim().toLowerCase() || field
    : field;
}

export function buildCardSlugBase(
  card: Pick<SharedClientCard, "id" | "title" | "first_name" | "last_name" | "full_name">
) {
  const nameSlug = slugify(displayName(card, ""));

  if (nameSlug) {
    return nameSlug;
  }

  return `card-${shortCardId(card.id)}`;
}

export function shortCardId(cardId: string) {
  const cleanId = cardId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8).toLowerCase();
  const normalizedId = cleanId.replace(/^card/, "") || cleanId;

  if (normalizedId) {
    return normalizedId;
  }

  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  }

  return Math.random().toString(36).slice(2, 10);
}

export function cardSlugCandidate(baseSlug: string, suffix: number) {
  return suffix <= 1 ? baseSlug : `${baseSlug}-${suffix}`;
}

export function isDuplicateCardSlugError(
  error: { code?: string; message?: string } | null
) {
  const message = error?.message || "";

  return (
    error?.code === "23505" &&
    /cards_slug_key|cards_slug_unique_idx|slug|duplicate key value/i.test(message)
  );
}

export function isCardSlotLimitError(
  error: { code?: string; message?: string } | null
) {
  const message = error?.message || "";

  return /CARD_SLOT_LIMIT_REACHED|cards_user_id_card_slot_unique_idx|card_slot/i.test(
    message
  );
}

export function isCardSlotOccupiedError(
  error: { message?: string } | null
) {
  const message = error?.message || "";

  return /CARD_SLOT_ALREADY_OCCUPIED/i.test(message);
}

export function missingCardColumnFromError(error: { message?: string } | null) {
  const message = error?.message || "";
  const quotedColumnMatch = message.match(/'([^']+)' column of 'cards'/);
  const qualifiedColumnMatch = message.match(/column cards\.([a-zA-Z0-9_]+) does not exist/);
  const missingColumnMatch = message.match(/Could not find the '([^']+)' column of 'cards'/);

  return (
    quotedColumnMatch?.[1] ||
    qualifiedColumnMatch?.[1] ||
    missingColumnMatch?.[1] ||
    null
  );
}

export function describeCardsDatabaseError(
  error: { code?: string; message?: string } | null
) {
  const message = error?.message || "Unknown Supabase error.";
  const missingColumn = missingCardColumnFromError(error);

  if (isDuplicateCardSlugError(error)) {
    return "That public card link is already in use. Please publish again and we will create a unique link automatically.";
  }

  if (isCardSlotOccupiedError(error)) {
    return "That card slot was just taken. Refresh My Cards and choose an available slot.";
  }

  if (isCardSlotLimitError(error)) {
    return "You can have up to three digital cards. Delete an existing card before creating another.";
  }

  if (missingColumn) {
    return `Database schema issue: public.cards is missing column "${missingColumn}". Run the cards schema migration before publishing.`;
  }

  if (
    message.includes("relation \"public.cards\" does not exist") ||
    message.includes("Could not find the table") ||
    message.includes("public.cards")
  ) {
    return "Database schema issue: public.cards table is missing or unavailable. Run the cards schema migration before publishing.";
  }

  return `Database save failed: ${message}`;
}

export function getInitialFieldOrder(
  template: CardTemplate | CardRendererTemplate | null
): CardFieldOrder {
  return {
    personal: template?.custom_fields?.personal?.length
      ? [...template.custom_fields.personal]
      : [...sectionDefaults.personal],
    company: template?.custom_fields?.company?.length
      ? [...template.custom_fields.company]
      : [...sectionDefaults.company],
    contact: template?.custom_fields?.contact?.length
      ? template.custom_fields.contact.filter((field) => field !== "website")
      : [...sectionDefaults.contact],
    social: template?.custom_fields?.social?.length
      ? [...template.custom_fields.social]
      : [...sectionDefaults.social],
  };
}

export function mergeFieldOrderWithTemplate(
  savedFieldOrder: CardFieldOrder | null | undefined,
  template: CardTemplate | CardRendererTemplate | null
): CardFieldOrder {
  const templateOrder = getInitialFieldOrder(template);

  return {
    personal: mergeSectionFields(savedFieldOrder?.personal, templateOrder.personal),
    company: mergeSectionFields(savedFieldOrder?.company, templateOrder.company),
    contact: mergeSectionFields(savedFieldOrder?.contact, templateOrder.contact).filter(
      (field) => field !== "website"
    ),
    social: mergeSectionFields(savedFieldOrder?.social, templateOrder.social),
  };
}

export function mergeSectionFields(
  savedFields: string[] | null | undefined,
  templateFields: string[]
) {
  const seen = new Set<string>();

  return [...(savedFields || []), ...templateFields].filter((field) => {
    const key = field.toLowerCase();

    if (seen.has(key)) return false;

    seen.add(key);
    return true;
  });
}

export function mergeAllowedFieldsWithFieldOrder(
  allowedFields: string[],
  fieldOrder: CardFieldOrder,
  hiddenFieldSet: Set<string>
) {
  const orderedFields = Object.values(fieldOrder).flat();
  const seen = new Set<string>();

  return [...allowedFields, ...orderedFields].filter((field) => {
    const key = field.toLowerCase();

    if (isFieldHidden(field, hiddenFieldSet) || seen.has(key)) return false;

    seen.add(key);
    return true;
  });
}

export function isFieldHidden(field: string, hiddenFieldSet: Set<string>) {
  const storageKey = customFieldStorageKey(field);

  return (
    hiddenFieldSet.has(field) ||
    hiddenFieldSet.has(storageKey) ||
    hiddenFieldSet.has(`custom:personal:${storageKey}`) ||
    hiddenFieldSet.has(`custom:company:${storageKey}`) ||
    hiddenFieldSet.has(`custom:contact:${storageKey}`) ||
    hiddenFieldSet.has(`custom:social:${storageKey}`)
  );
}

export function isFieldVisible(
  field: string,
  card: Pick<SharedClientCard, "field_visibility" | "hidden_fields">
) {
  const visible = fieldVisibilityValue(field, card.field_visibility);

  if (typeof visible === "boolean") return visible;

  return !isFieldHidden(field, new Set(card.hidden_fields || []));
}

export function fieldVisibilityValue(
  field: string,
  fieldVisibility: CardFieldVisibility | null | undefined
) {
  const visibility = normalizeFieldVisibility(fieldVisibility);
  const storageKey = customFieldStorageKey(field);
  const candidates = fieldKeyVariants(field);

  for (const candidate of candidates) {
    if (typeof visibility[candidate] === "boolean") {
      return visibility[candidate];
    }
  }

  if (typeof visibility[storageKey] === "boolean") {
    return visibility[storageKey];
  }

  return null;
}

export function fieldVisibilityWithHiddenFallback(
  fieldVisibility: CardFieldVisibility | null | undefined,
  hiddenFields: string[] | null | undefined,
  fieldOrder: CardFieldOrder
) {
  const visibility = normalizeFieldVisibility(fieldVisibility);
  const hasVisibility = Object.keys(visibility).length > 0;

  if (hasVisibility) return visibility;

  const hiddenFieldSet = new Set(hiddenFields || []);
  const fallback: CardFieldVisibility = {};

  Object.values(fieldOrder)
    .flat()
    .forEach((field) => {
      if (isFieldHidden(field, hiddenFieldSet)) {
        fallback[customFieldStorageKey(field)] = false;
      }
    });

  return fallback;
}

export function normalizeFieldVisibility(
  fieldVisibility: CardFieldVisibility | null | undefined
): CardFieldVisibility {
  if (!fieldVisibility || typeof fieldVisibility !== "object") return {};

  return Object.fromEntries(
    Object.entries(fieldVisibility).filter(
      (entry): entry is [string, boolean] => typeof entry[1] === "boolean"
    )
  );
}

export function fieldKeyVariants(field: string) {
  const storageKey = customFieldStorageKey(field);

  return Array.from(
    new Set([
      field,
      storageKey,
      field.toLowerCase(),
      storageKey.toLowerCase(),
      `custom:personal:${storageKey}`,
      `custom:company:${storageKey}`,
      `custom:contact:${storageKey}`,
      `custom:social:${storageKey}`,
    ])
  );
}

export function fieldKeyMatches(field: string, storageKey: string) {
  return fieldKeyVariants(field).includes(storageKey);
}

export function isEditableCardField(
  field: string
): field is keyof SharedClientCard {
  return editableCardFields.has(field);
}

export function customFieldValue(
  card: { custom_fields?: SharedClientCard["custom_fields"] | null },
  field: string
) {
  const storageKey = customFieldStorageKey(field);
  const value = card.custom_fields?.[field] || card.custom_fields?.[storageKey];

  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const firstValue = Object.values(value).find(
      (nestedValue) => typeof nestedValue === "string" && nestedValue
    );

    if (firstValue) return firstValue;
  }

  if (!card.custom_fields) return "";

  for (const nestedValue of Object.values(card.custom_fields)) {
    if (!nestedValue || typeof nestedValue !== "object") continue;

    const sectionValues = nestedValue as Record<string, string | null | undefined>;
    const sectionValue =
      sectionValues[field] ||
      sectionValues[field.toLowerCase()] ||
      sectionValues[storageKey] ||
      sectionValues[storageKey.toLowerCase()] ||
      "";

    if (sectionValue) return sectionValue;
  }

  return "";
}

export function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
