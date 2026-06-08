import { supabase } from "@/lib/supabase";
import type { CardRendererTemplate } from "@/components/CardRenderer";

export type TemplatePlan = "free" | "individual_pro" | "business" | "enterprise";

export type SharedTemplate = CardRendererTemplate & {
  id: string;
  name: string;
  slug?: string | null;
  status?: "draft" | "published" | null;
  colour_palette?: string[] | null;
  is_published: boolean;
  usage_count?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  supports_company_banner?: boolean | null;
  supports_gradient?: boolean | null;
  font_family?: string | null;
};

type TemplatePayload = Partial<SharedTemplate> & {
  name: string;
  slug?: string | null;
};

export async function getAdminTemplates() {
  const { data, error } = await supabase
    .from("templates")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Could not load templates from Supabase: ${error.message}`);
  }

  return normalizeTemplates((data || []) as SharedTemplate[]);
}

export async function getPublishedTemplates() {
  const { data, error } = await supabase
    .from("templates")
    .select("*")
    .eq("status", "published")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Could not load published templates from Supabase: ${error.message}`);
  }

  return normalizeTemplates((data || []) as SharedTemplate[]).filter(
    isPublishedTemplate
  );
}

export async function getClientVisibleTemplates(plan: TemplatePlan) {
  const published = await getPublishedTemplates();

  if (plan === "free") return published;

  return published.filter(
    (template) =>
      template.access_level === "free" || template.access_level === "paid"
  );
}

export async function saveAdminTemplate(
  payload: TemplatePayload,
  editingTemplateId?: string | null
) {
  const normalizedPayload = normalizeTemplate({
    ...payload,
    id: editingTemplateId || payload.id || "",
    is_published: payload.is_published ?? payload.status === "published",
    status: payload.status || (payload.is_published ? "published" : "draft"),
  });
  const result = editingTemplateId
    ? await requestAdminTemplate(`/api/admin/templates/${editingTemplateId}`, {
        method: "PATCH",
        body: JSON.stringify(normalizedPayload),
      })
    : await requestAdminTemplate("/api/admin/templates", {
        method: "POST",
        body: JSON.stringify(normalizedPayload),
      });

  return {
    template: normalizeTemplate(result.template as SharedTemplate),
    source: "database" as const,
  };
}

export async function publishAdminTemplate(
  template: SharedTemplate,
  published: boolean
) {
  const normalizedPayload = normalizeTemplate({
      ...template,
      is_published: published,
      status: published ? "published" : "draft",
    });
  const result = await requestAdminTemplate(`/api/admin/templates/${template.id}`, {
    method: "PATCH",
    body: JSON.stringify(normalizedPayload),
  });

  return {
    template: normalizeTemplate(result.template as SharedTemplate),
    source: "database" as const,
  };
}

export async function deleteAdminTemplate(templateId: string) {
  await requestAdminTemplate(`/api/admin/templates/${templateId}`, {
    method: "DELETE",
  });

  return { source: "database" as const };
}

export function normalizeTemplates(templates: SharedTemplate[]) {
  return templates.map(normalizeTemplate);
}

async function requestAdminTemplate(
  url: string,
  init: RequestInit
): Promise<{ template?: unknown; deleted?: boolean }> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message =
      typeof result.error === "string"
        ? result.error
        : "Template could not be saved. Please try again.";

    throw new Error(message);
  }

  return result;
}

export function normalizeTemplate(template: SharedTemplate | TemplatePayload): SharedTemplate {
  const sanitizedPalette = normalizeTemplateColourPalette(template);
  const isPublished = isPublishedTemplate(template);
  const requiresBanner =
    template.requires_banner ?? template.supports_company_banner ?? false;
  const gradientEnabled =
    template.gradient_enabled ?? template.supports_gradient ?? false;
  const defaultFont = template.default_font || template.font_family || null;
  const accessLevel = template.access_level === "paid" ? "paid" : "free";

  return {
    ...template,
    id: template.id || "",
    name: template.name,
    slug: template.slug || slugify(template.name),
    access_level: accessLevel,
    layout_type:
      accessLevel === "free" ? "classic_free" : template.layout_type || "premium_classic",
    status: isPublished ? "published" : "draft",
    is_published: isPublished,
    requires_banner: requiresBanner,
    gradient_enabled: gradientEnabled,
    supports_company_banner: requiresBanner,
    supports_gradient: gradientEnabled,
    default_font: defaultFont,
    font_family: defaultFont,
    colour_palette: sanitizedPalette,
    free_colour_palette: sanitizedPalette,
    allowed_fields: template.allowed_fields || [],
    custom_fields: normalizeTemplateCustomFields(template.custom_fields),
    show_personal_section: template.show_personal_section ?? true,
    show_company_section: template.show_company_section ?? true,
    show_contact_section: template.show_contact_section ?? true,
    show_social_section: template.show_social_section ?? false,
  };
}

function normalizeTemplateCustomFields(value: SharedTemplate["custom_fields"]) {
  if (!value) return value;

  return {
    ...value,
    contact: Array.isArray(value.contact)
      ? value.contact.filter((field) => field !== "website")
      : value.contact,
  };
}

function isPublishedTemplate(template: Partial<SharedTemplate> | TemplatePayload) {
  return template.status === "published" || Boolean(template.is_published);
}

export function normalizeColourPalette(value: unknown): string[] {
  if (value == null) return [];

  if (Array.isArray(value)) {
    return sanitizeColourPalette(value);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();

    if (!trimmed) return [];

    if (trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        return normalizeColourPalette(parsed);
      } catch {
        return sanitizeColourPalette([trimmed]);
      }
    }

    return sanitizeColourPalette(trimmed.split(/[\s,;|]+/));
  }

  return [];
}

function normalizeTemplateColourPalette(
  template: SharedTemplate | TemplatePayload
) {
  const templateRecord = template as Record<string, unknown>;
  const candidates = [
    templateRecord.colour_palette,
    templateRecord.free_colour_palette,
    templateRecord.free_colors,
    templateRecord.approved_colours,
    templateRecord.approved_colors,
  ];

  for (const candidate of candidates) {
    const palette = normalizeColourPalette(candidate);

    if (palette.length > 0) {
      return palette;
    }
  }

  return [];
}

function sanitizeColourPalette(colours: unknown[]) {
  return colours
    .filter((colour): colour is string => typeof colour === "string")
    .map((colour) => colour.trim())
    .filter((colour) => /^#[0-9a-fA-F]{6}$/.test(colour))
    .slice(0, 6);
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replaceAll(" ", "-")
    .replace(/[^a-z0-9-]/g, "");
}
