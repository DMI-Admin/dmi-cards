import { supabase } from "@/lib/supabase";
import type { CardRendererTemplate } from "@/components/CardRenderer";
import {
  normalizeTemplateAllowedActions,
  type TemplateAllowedActions,
} from "@/lib/card-actions";
import type { DmiPlan } from "@/lib/entitlements";

export type TemplatePlan = DmiPlan;

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
  allowed_actions?: TemplateAllowedActions | null;
};

export type TemplateFieldConfig = {
  version: 1;
  allowed_fields: string[];
  sections: Record<string, string[]>;
  default_visibility: Record<string, boolean>;
  required_fields: string[];
};

export type TemplateRendererOptions = {
  version: 1;
  [key: string]: unknown;
};

type TemplatePayload = Partial<SharedTemplate> & {
  name: string;
  slug?: string | null;
};

const templateContractFields = [
  "profile_image_allowed",
  "profile_image_default_enabled",
  "logo_allowed",
  "logo_default_enabled",
  "banner_allowed",
  "banner_default_enabled",
  "custom_colour_allowed",
  "custom_text_colour_allowed",
  "field_config",
  "renderer_options",
  "template_contract_version",
] as const;

export async function getAdminTemplates() {
  const response = await fetch(`/api/admin/templates?ts=${Date.now()}`, {
    method: "GET",
    cache: "no-store",
    credentials: "same-origin",
  });
  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message =
      typeof result.error === "string"
        ? result.error
        : "Could not load templates from Supabase.";

    throw new Error(message);
  }

  return normalizeTemplates((result.templates || []) as SharedTemplate[]);
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
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new Error("Please sign in to load templates.");
  }

  const response = await fetch("/api/client/templates", {
    method: "GET",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
    },
  });
  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message =
      typeof result?.error?.message === "string"
        ? result.error.message
        : "Could not load templates from Supabase.";

    throw new Error(message);
  }

  const templates = normalizeTemplates((result?.data?.templates || []) as SharedTemplate[]);

  return plan === "free"
    ? templates.filter((template) => template.access_level === "free")
    : templates.filter(
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
  const requestPayload = templateWritePayload(normalizedPayload, payload);
  const result = editingTemplateId
    ? await requestAdminTemplate(`/api/admin/templates/${editingTemplateId}`, {
        method: "PATCH",
        body: JSON.stringify(requestPayload),
      })
    : await requestAdminTemplate("/api/admin/templates", {
        method: "POST",
        body: JSON.stringify(requestPayload),
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
  const requestPayload = templateWritePayload(normalizedPayload, {
    is_published: published,
    status: published ? "published" : "draft",
  });
  const result = await requestAdminTemplate(`/api/admin/templates/${template.id}`, {
    method: "PATCH",
    body: JSON.stringify(requestPayload),
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

function templateWritePayload(
  normalizedPayload: SharedTemplate,
  explicitPayload: Partial<SharedTemplate>
) {
  const requestPayload = { ...normalizedPayload } as Record<string, unknown>;

  for (const field of templateContractFields) {
    if (!(field in explicitPayload)) {
      delete requestPayload[field];
    }
  }

  return requestPayload;
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
  const textColours = normalizeTextColourPalette(template);
  const isPublished = isPublishedTemplate(template);
  const requiresBanner =
    template.requires_banner ?? template.supports_company_banner ?? false;
  const gradientEnabled =
    template.gradient_enabled ?? template.supports_gradient ?? false;
  const defaultFont = template.default_font || template.font_family || null;
  const accessLevel = template.access_level === "paid" ? "paid" : "free";
  const requiresProfileImage = template.requires_profile_image ?? true;
  const requiresLogo = template.requires_logo ?? false;
  const profileImageAllowed = template.profile_image_allowed ?? true;
  const logoAllowed = template.logo_allowed ?? requiresLogo;
  const bannerAllowed = template.banner_allowed ?? requiresBanner;
  const customColourAllowed =
    template.custom_colour_allowed ?? accessLevel === "paid";
  const customTextColourAllowed =
    template.custom_text_colour_allowed ?? accessLevel === "paid";
  const customFields = normalizeTemplateCustomFields(template.custom_fields);
  const allowedFields = template.allowed_fields || [];

  return {
    ...template,
    id: template.id || "",
    name: template.name,
    slug: template.slug || slugify(template.name),
    access_level: accessLevel,
    layout_type:
      template.layout_type ||
      (accessLevel === "free" ? "classic_free" : "premium_classic"),
    status: isPublished ? "published" : "draft",
    is_published: isPublished,
    requires_profile_image: requiresProfileImage,
    requires_banner: requiresBanner,
    requires_logo: requiresLogo,
    profile_image_allowed: profileImageAllowed,
    profile_image_default_enabled:
      template.profile_image_default_enabled ?? profileImageAllowed,
    logo_allowed: logoAllowed,
    logo_default_enabled: template.logo_default_enabled ?? logoAllowed,
    banner_allowed: bannerAllowed,
    banner_default_enabled: template.banner_default_enabled ?? bannerAllowed,
    custom_colour_allowed: customColourAllowed,
    custom_text_colour_allowed: customTextColourAllowed,
    gradient_enabled: gradientEnabled,
    supports_company_banner: requiresBanner,
    supports_gradient: gradientEnabled,
    default_font: defaultFont,
    font_family: defaultFont,
    colour_palette: sanitizedPalette,
    free_colour_palette: sanitizedPalette,
    text_colours: textColours,
    allowed_fields: allowedFields,
    allowed_actions: normalizeTemplateAllowedActions(template.allowed_actions),
    custom_fields: customFields,
    field_config: normalizeTemplateFieldConfig(
      template.field_config,
      allowedFields,
      customFields
    ),
    renderer_options: normalizeTemplateRendererOptions(template.renderer_options),
    show_personal_section: template.show_personal_section ?? true,
    show_company_section: template.show_company_section ?? true,
    show_contact_section: template.show_contact_section ?? true,
    show_social_section: template.show_social_section ?? false,
  };
}

function normalizeTextColourPalette(template: SharedTemplate | TemplatePayload) {
  const templateRecord = template as Record<string, unknown>;
  const palette = normalizeColourPalette(templateRecord.text_colours);

  if (palette.length > 0) return palette;

  const textColor = normalizeColourPalette(templateRecord.text_color);

  return textColor.length > 0 ? textColor : [];
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

function normalizeTemplateFieldConfig(
  value: SharedTemplate["field_config"],
  allowedFields: string[],
  customFields: SharedTemplate["custom_fields"]
): TemplateFieldConfig {
  if (isRecord(value)) {
    return {
      version: 1,
      allowed_fields: stringArrayValue(value.allowed_fields, allowedFields),
      sections: sectionArrayValue(value.sections, customFields),
      default_visibility: booleanMapValue(value.default_visibility),
      required_fields: stringArrayValue(value.required_fields, []),
    };
  }

  return {
    version: 1,
    allowed_fields: allowedFields,
    sections: sectionArrayValue(customFields, customFields),
    default_visibility: {},
    required_fields: [],
  };
}

function normalizeTemplateRendererOptions(
  value: SharedTemplate["renderer_options"]
): TemplateRendererOptions {
  return isRecord(value) ? { version: 1, ...value } : { version: 1 };
}

function sectionArrayValue(
  value: unknown,
  fallback: SharedTemplate["custom_fields"]
) {
  const source = isRecord(value) ? value : fallback;
  const sections: Record<string, string[]> = {};

  if (!isRecord(source)) return sections;

  for (const [key, fields] of Object.entries(source)) {
    sections[key] = stringArrayValue(fields, []);
  }

  return sections;
}

function stringArrayValue(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) return fallback;

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function booleanMapValue(value: unknown) {
  if (!isRecord(value)) return {};

  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, boolean] => {
      const [key, enabled] = entry;
      return typeof key === "string" && typeof enabled === "boolean";
    })
  );
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
