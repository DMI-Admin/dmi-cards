import CardRenderer from "@/components/CardRenderer";
import type { CardRendererTemplate } from "@/components/CardRenderer";
import { supabase } from "@/lib/supabase";
import { normalizeColourPalette, normalizeTemplate } from "@/lib/templates";

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

  return (
    <main className="min-h-screen bg-[#070B1A] px-4 py-8 text-white sm:px-6">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-md items-center justify-center">
        <div className="w-full">
          <CardRenderer
            mode="public"
            template={buildPublicTemplate(template, card)}
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
  const fieldOrder = normalizeFieldOrder(card.field_order, normalizedTemplate);
  const allowedFields = (normalizedTemplate.allowed_fields || []).filter(
    (field) => !hiddenFields.has(field)
  );
  const rendererFieldOrder = {
    personal: fieldOrder.personal.filter((field) => !hiddenFields.has(field)),
    company: fieldOrder.company.filter((field) => !hiddenFields.has(field)),
    contact: fieldOrder.contact.filter((field) => !hiddenFields.has(field)),
    social: fieldOrder.social.filter((field) => !hiddenFields.has(field)),
  };
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

function normalizeFieldOrder(
  fieldOrder: PublicCardRow["field_order"],
  template: CardRendererTemplate
) {
  return {
    personal: fieldOrder?.personal?.length
      ? fieldOrder.personal
      : template.custom_fields?.personal || ["job_title", "bio", "department"],
    company: fieldOrder?.company?.length
      ? fieldOrder.company
      : template.custom_fields?.company || ["company_name", "website", "address"],
    contact: fieldOrder?.contact?.length
      ? fieldOrder.contact
      : template.custom_fields?.contact || ["email", "phone", "website"],
    social: fieldOrder?.social?.length
      ? fieldOrder.social
      : template.custom_fields?.social || [
          "whatsapp",
          "linkedin",
          "instagram",
          "facebook",
          "youtube",
          "booking_link",
          "custom_url",
        ],
  };
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
