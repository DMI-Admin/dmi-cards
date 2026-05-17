import { supabase } from "@/lib/supabase";
import type { CardRendererTemplate } from "@/components/CardRenderer";

export type TemplatePlan = "free" | "individual_pro" | "business" | "enterprise";

export type SharedTemplate = CardRendererTemplate & {
  id: string;
  name: string;
  slug?: string | null;
  is_published: boolean;
  usage_count?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type TemplatePayload = Partial<SharedTemplate> & {
  name: string;
  slug?: string | null;
};

export const adminTemplatesStorageKey = "dmi-admin-templates-v1";

export const defaultTemplatesFallback: SharedTemplate[] = [
  {
    id: "template-free-classic",
    name: "Free Classic",
    slug: "free-classic",
    is_published: true,
    access_level: "free",
    layout_type: "classic_free",
    requires_profile_image: true,
    requires_logo: false,
    requires_banner: false,
    gradient_enabled: false,
    primary_color: "#AC00FF",
    secondary_color: "#101935",
    text_color: "#FFFFFF",
    button_color: "#FFFFFF",
    button_text_color: "#0F0E38",
    default_font: "Inter",
    free_colour_palette: [
      "#AC00FF",
      "#7C3AED",
      "#2563EB",
      "#059669",
      "#DC2626",
      "#101935",
    ],
    allowed_fields: [
      "full_name",
      "job_title",
      "bio",
      "department",
      "company_name",
      "website",
      "address",
      "email",
      "phone",
    ],
    custom_fields: {
      personal: ["job_title", "bio", "department"],
      company: ["company_name", "website", "address"],
      contact: ["email", "phone", "website"],
      social: [
        "whatsapp",
        "linkedin",
        "instagram",
        "facebook",
        "youtube",
        "booking_link",
        "custom_url",
      ],
    },
    show_personal_section: true,
    show_company_section: true,
    show_contact_section: true,
    show_social_section: false,
  },
  {
    id: "template-paid-classic",
    name: "Premium Classic",
    slug: "premium-classic",
    is_published: true,
    access_level: "paid",
    layout_type: "premium_classic",
    requires_profile_image: true,
    requires_logo: true,
    requires_banner: true,
    gradient_enabled: true,
    primary_color: "#AC00FF",
    secondary_color: "#101935",
    text_color: "#FFFFFF",
    button_color: "#FFFFFF",
    button_text_color: "#0F0E38",
    default_font: "Inter",
    allowed_fields: [
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
      "custom_url",
    ],
    show_personal_section: true,
    show_company_section: true,
    show_contact_section: true,
    show_social_section: true,
  },
];

export async function getPublishedTemplates() {
  const templates = await getAdminTemplates();
  return templates.filter((template) => template.is_published);
}

export async function getClientVisibleTemplates(plan: TemplatePlan) {
  const published = await getPublishedTemplates();

  if (plan === "free") return published;

  return published.filter(
    (template) => template.access_level === "free" || template.access_level === "paid"
  );
}

export async function getAdminTemplates() {
  try {
    const { data, error } = await supabase
      .from("templates")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;

    if (data) {
      const templates = normalizeTemplates(data as SharedTemplate[]);
      writeLocalTemplates(templates);
      return templates;
    }
  } catch (error) {
    console.warn("Templates database unavailable; using local templates.", error);
  }

  return readLocalTemplates();
}

export async function saveAdminTemplate(
  payload: TemplatePayload,
  editingTemplateId?: string | null
) {
  const localTemplate = normalizeTemplate({
    ...payload,
    id: editingTemplateId || payload.id || createLocalTemplateId(),
    is_published: payload.is_published ?? false,
    usage_count: payload.usage_count ?? 0,
  });

  try {
    const databasePayload = stripLocalOnlyFields(payload);
    const result = editingTemplateId
      ? await supabase
          .from("templates")
          .update(databasePayload)
          .eq("id", editingTemplateId)
          .select("*")
          .single()
      : await supabase
          .from("templates")
          .insert([{ ...databasePayload, is_published: payload.is_published ?? false }])
          .select("*")
          .single();

    if (result.error) throw result.error;

    const savedTemplate = normalizeTemplate(
      (result.data as SharedTemplate | null) || localTemplate
    );
    upsertLocalTemplate(savedTemplate);
    return { template: savedTemplate, source: "database" as const };
  } catch (error) {
    console.warn("Template save used local fallback.", error);
    upsertLocalTemplate(localTemplate);
    return { template: localTemplate, source: "local" as const, error };
  }
}

export async function publishAdminTemplate(template: SharedTemplate, published: boolean) {
  const nextTemplate = normalizeTemplate({ ...template, is_published: published });

  try {
    const { data, error } = await supabase
      .from("templates")
      .update({ is_published: published })
      .eq("id", template.id)
      .select("*")
      .single();

    if (error) throw error;

    const savedTemplate = normalizeTemplate((data as SharedTemplate | null) || nextTemplate);
    upsertLocalTemplate(savedTemplate);
    return { template: savedTemplate, source: "database" as const };
  } catch (error) {
    console.warn("Template publish used local fallback.", error);
    upsertLocalTemplate(nextTemplate);
    return { template: nextTemplate, source: "local" as const, error };
  }
}

export async function deleteAdminTemplate(templateId: string) {
  try {
    const { error } = await supabase.from("templates").delete().eq("id", templateId);
    if (error) throw error;
    deleteLocalTemplate(templateId);
    return { source: "database" as const };
  } catch (error) {
    console.warn("Template delete used local fallback.", error);
    deleteLocalTemplate(templateId);
    return { source: "local" as const, error };
  }
}

export function normalizeTemplates(templates: SharedTemplate[]) {
  return templates.map(normalizeTemplate);
}

export function normalizeTemplate(template: SharedTemplate | TemplatePayload): SharedTemplate {
  const freeColourPalette =
    template.free_colour_palette ||
    readAliasArray(template, "free_colors") ||
    readAliasArray(template, "colour_palette") ||
    readAliasArray(template, "approved_colours") ||
    readAliasArray(template, "approved_colors") ||
    null;

  return {
    ...template,
    id: template.id || createLocalTemplateId(),
    name: template.name,
    slug: template.slug || slugify(template.name),
    access_level: template.access_level === "free" ? "free" : "paid",
    layout_type: template.layout_type || "classic_free",
    is_published: Boolean(template.is_published),
    free_colour_palette: sanitizeColourPalette(freeColourPalette),
    allowed_fields: template.allowed_fields || [],
    show_personal_section: template.show_personal_section ?? true,
    show_company_section: template.show_company_section ?? true,
    show_contact_section: template.show_contact_section ?? true,
    show_social_section: template.show_social_section ?? false,
  };
}

function readLocalTemplates() {
  if (typeof window === "undefined") return defaultTemplatesFallback;

  try {
    const stored = window.localStorage.getItem(adminTemplatesStorageKey);
    if (!stored) {
      writeLocalTemplates(defaultTemplatesFallback);
      return defaultTemplatesFallback;
    }

    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return defaultTemplatesFallback;

    const templates = normalizeTemplates(parsed);
    return templates.length ? templates : defaultTemplatesFallback;
  } catch (error) {
    console.warn("Failed to read local templates.", error);
    return defaultTemplatesFallback;
  }
}

function writeLocalTemplates(templates: SharedTemplate[]) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      adminTemplatesStorageKey,
      JSON.stringify(normalizeTemplates(templates))
    );
  } catch (error) {
    console.warn("Failed to write local templates.", error);
  }
}

function upsertLocalTemplate(template: SharedTemplate) {
  const templates = readLocalTemplates();
  const exists = templates.some((item) => item.id === template.id);
  const nextTemplates = exists
    ? templates.map((item) => (item.id === template.id ? template : item))
    : [template, ...templates];

  writeLocalTemplates(nextTemplates);
}

function deleteLocalTemplate(templateId: string) {
  writeLocalTemplates(readLocalTemplates().filter((template) => template.id !== templateId));
}

function stripLocalOnlyFields(template: TemplatePayload) {
  const { id, created_at, updated_at, ...databasePayload } = template;
  void id;
  void created_at;
  void updated_at;
  return databasePayload;
}

function readAliasArray(template: Record<string, unknown>, key: string) {
  const value = template[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : null;
}

function sanitizeColourPalette(colours?: string[] | null) {
  const palette = (colours || [])
    .filter((colour): colour is string => typeof colour === "string")
    .map((colour) => colour.trim())
    .filter((colour) => /^#[0-9a-fA-F]{6}$/.test(colour))
    .slice(0, 6);

  return palette.length ? palette : null;
}

function createLocalTemplateId() {
  return `template-local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replaceAll(" ", "-")
    .replace(/[^a-z0-9-]/g, "");
}
