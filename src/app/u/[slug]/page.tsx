import CardRenderer from "@/components/CardRenderer";
import type { CardRendererTemplate } from "@/components/CardRenderer";
import { supabase } from "@/lib/supabase";
import { normalizeColourPalette, normalizeTemplate } from "@/lib/templates";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

type PublicCardPageProps = {
  params: Promise<{
    slug: string;
  }>;
};

export default async function PublicCardPage({ params }: PublicCardPageProps) {
  const { slug } = await params;

  const { data: card, error: cardError } = await supabase
    .from("cards")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();

  if (cardError || !card) {
    return (
      <PublicMessage
        title="Card not found"
        message="The digital card you are looking for does not exist."
      />
    );
  }

  if (!(card.status === "published" || card.is_published)) {
    return (
      <PublicMessage
        title="This card is not currently published."
        message="Please contact the card owner or try again later."
      />
    );
  }

  const template = await loadPublicTemplate(card.template_id);

  if (!template) {
    return (
      <PublicMessage
        title="Card template unavailable"
        message="This digital card cannot be displayed right now."
      />
    );
  }

  const publicTemplate = buildPublicTemplate(template, card);

  console.log("[DMI public card] fetched by slug", {
    slug,
    cardId: card.id || null,
    templateId: card.template_id || null,
    status: card.status || null,
    isPublished: Boolean(card.is_published),
    updatedAt: card.updated_at || null,
    department: card.department || null,
    hiddenFields: card.hidden_fields || [],
    fieldVisibility: card.field_visibility || {},
    fieldOrder: card.field_order || null,
    allowedFields: publicTemplate.allowed_fields || [],
    rendererFields: publicTemplate.custom_fields || null,
  });

  return (
    <main className="min-h-screen bg-[#070B1A] px-4 py-8 text-white sm:px-6">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-md items-center justify-center">
        <div className="w-full">
          <CardRenderer
            mode="public"
            template={publicTemplate}
            cardData={card}
          />
        </div>
      </div>
    </main>
  );
}

type PublicCardRow = {
  template_id?: string | null;
  selected_colour?: string | null;
  hidden_fields?: string[] | null;
  field_visibility?: Record<string, boolean> | null;
  field_order?: Partial<Record<"personal" | "company" | "contact" | "social", string[]>> | null;
};

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
  const fieldOrder = normalizeFieldOrder(card.field_order, normalizedTemplate);
  const rendererFieldOrder = {
    personal: fieldOrder.personal.filter(
      (field) => isFieldVisible(field, fieldVisibility, hiddenFields)
    ),
    company: fieldOrder.company.filter(
      (field) => isFieldVisible(field, fieldVisibility, hiddenFields)
    ),
    contact: fieldOrder.contact.filter(
      (field) =>
        field !== "website" && isFieldVisible(field, fieldVisibility, hiddenFields)
    ),
    social: fieldOrder.social.filter(
      (field) => isFieldVisible(field, fieldVisibility, hiddenFields)
    ),
  };
  const allowedFields = mergeAllowedFieldsWithFieldOrder(
    normalizedTemplate.allowed_fields || [],
    rendererFieldOrder,
    fieldVisibility,
    hiddenFields
  );
  const selectedColour =
    card.selected_colour ||
    normalizeColourPalette(normalizedTemplate.free_colour_palette)[0] ||
    "#AC00FF";

  return {
    ...normalizedTemplate,
    allowed_fields: allowedFields,
    custom_fields: rendererFieldOrder,
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

function mergeAllowedFieldsWithFieldOrder(
  allowedFields: string[],
  fieldOrder: Record<"personal" | "company" | "contact" | "social", string[]>,
  fieldVisibility: Record<string, boolean>,
  hiddenFieldSet: Set<string>
) {
  const orderedFields = Object.values(fieldOrder).flat();
  const seen = new Set<string>();

  return [...allowedFields, ...orderedFields].filter((field) => {
    const key = field.toLowerCase();

    if (!isFieldVisible(field, fieldVisibility, hiddenFieldSet) || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function isFieldHidden(field: string, hiddenFieldSet: Set<string>) {
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

function isFieldVisible(
  field: string,
  fieldVisibility: Record<string, boolean>,
  hiddenFieldSet: Set<string>
) {
  const visible = fieldVisibilityValue(field, fieldVisibility);

  if (typeof visible === "boolean") return visible;

  return !isFieldHidden(field, hiddenFieldSet);
}

function fieldVisibilityValue(
  field: string,
  fieldVisibility: Record<string, boolean> | null | undefined
) {
  const visibility = normalizeFieldVisibility(fieldVisibility);

  for (const candidate of fieldKeyVariants(field)) {
    if (typeof visibility[candidate] === "boolean") {
      return visibility[candidate];
    }
  }

  return null;
}

function normalizeFieldVisibility(
  fieldVisibility: Record<string, boolean> | null | undefined
) {
  if (!fieldVisibility || typeof fieldVisibility !== "object") return {};

  return Object.fromEntries(
    Object.entries(fieldVisibility).filter(
      (entry): entry is [string, boolean] => typeof entry[1] === "boolean"
    )
  );
}

function fieldKeyVariants(field: string) {
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

function customFieldStorageKey(field: string) {
  return field.startsWith("custom:")
    ? field.split(":").at(-1)?.trim().toLowerCase() || field
    : field;
}

function normalizeFieldOrder(
  fieldOrder: PublicCardRow["field_order"],
  template: CardRendererTemplate
) {
  const templateOrder = {
    personal: template.custom_fields?.personal || ["job_title", "bio", "department"],
    company: template.custom_fields?.company || ["company_name", "website", "address"],
    contact: (template.custom_fields?.contact || ["email", "phone"]).filter(
      (field) => field !== "website"
    ),
    social: template.custom_fields?.social || [
      "whatsapp",
      "linkedin",
      "instagram",
      "facebook",
      "youtube",
      "booking_link",
      "custom_url",
    ],
  };

  return {
    personal: mergeSectionFields(fieldOrder?.personal, templateOrder.personal),
    company: mergeSectionFields(fieldOrder?.company, templateOrder.company),
    contact: mergeSectionFields(fieldOrder?.contact, templateOrder.contact).filter(
      (field) => field !== "website"
    ),
    social: mergeSectionFields(fieldOrder?.social, templateOrder.social),
  };
}

function mergeSectionFields(
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

function PublicMessage({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#070B1A] px-6 text-white">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-white/5 p-8 text-center shadow-2xl shadow-[#AC00FF]/10">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-white/50">{message}</p>
      </div>
    </main>
  );
}
