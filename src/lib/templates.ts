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

const templateColumnSupport = {
  status: null as boolean | null,
  requires_banner: null as boolean | null,
  gradient_enabled: null as boolean | null,
  supports_company_banner: null as boolean | null,
  supports_gradient: null as boolean | null,
};

export async function getAdminTemplates() {
  const { data, error } = await supabase
    .from("templates")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Could not load templates from Supabase: ${error.message}`);
  }

  learnTemplateColumns(data || []);

  return normalizeTemplates((data || []) as SharedTemplate[]);
}

export async function getPublishedTemplates() {
  const statusAwareResult = await supabase
    .from("templates")
    .select("*")
    .or("status.eq.published,is_published.eq.true")
    .order("created_at", { ascending: false });
  let data = statusAwareResult.data;
  let error = statusAwareResult.error;

  if (error && isMissingColumnError(error, "status")) {
    templateColumnSupport.status = false;
    const isPublishedResult = await supabase
      .from("templates")
      .select("*")
      .eq("is_published", true)
      .order("created_at", { ascending: false });

    data = isPublishedResult.data;
    error = isPublishedResult.error;
  }

  if (error) {
    throw new Error(`Could not load published templates from Supabase: ${error.message}`);
  }

  learnTemplateColumns(data || []);

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
    ? await writeTemplateWithSchemaRetry((databasePayload) =>
        supabase
          .from("templates")
          .update(databasePayload)
          .eq("id", editingTemplateId)
          .select("*")
          .single(),
        normalizedPayload
      )
    : await writeTemplateWithSchemaRetry((databasePayload) =>
        supabase
          .from("templates")
          .insert([databasePayload])
          .select("*")
          .single(),
        normalizedPayload
      );

  if (result.error) {
    throw new Error(`Could not save template to Supabase: ${result.error.message}`);
  }

  learnTemplateColumns(result.data ? [result.data] : []);

  return {
    template: normalizeTemplate(result.data as SharedTemplate),
    source: "database" as const,
  };
}

export async function publishAdminTemplate(
  template: SharedTemplate,
  published: boolean
) {
  const result = await writeTemplateWithSchemaRetry((databasePayload) =>
    supabase
      .from("templates")
      .update(databasePayload)
      .eq("id", template.id)
      .select("*")
      .single(),
    {
      ...template,
      is_published: published,
      status: published ? "published" : "draft",
    }
  );

  if (result.error) {
    throw new Error(`Could not update template publish state: ${result.error.message}`);
  }

  learnTemplateColumns(result.data ? [result.data] : []);

  return {
    template: normalizeTemplate(result.data as SharedTemplate),
    source: "database" as const,
  };
}

export async function deleteAdminTemplate(templateId: string) {
  const { error } = await supabase.from("templates").delete().eq("id", templateId);

  if (error) {
    throw new Error(`Could not delete template from Supabase: ${error.message}`);
  }

  return { source: "database" as const };
}

export function normalizeTemplates(templates: SharedTemplate[]) {
  return templates.map(normalizeTemplate);
}

export function normalizeTemplate(template: SharedTemplate | TemplatePayload): SharedTemplate {
  const sanitizedPalette = normalizeTemplateColourPalette(template);
  const isPublished = isPublishedTemplate(template);
  const requiresBanner =
    template.requires_banner ?? template.supports_company_banner ?? false;
  const gradientEnabled =
    template.gradient_enabled ?? template.supports_gradient ?? false;
  const defaultFont = template.default_font || template.font_family || null;

  return {
    ...template,
    id: template.id || "",
    name: template.name,
    slug: template.slug || slugify(template.name),
    access_level: template.access_level === "paid" ? "paid" : "free",
    layout_type: template.layout_type || "classic_free",
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
    show_personal_section: template.show_personal_section ?? true,
    show_company_section: template.show_company_section ?? true,
    show_contact_section: template.show_contact_section ?? true,
    show_social_section: template.show_social_section ?? false,
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

function stripLocalOnlyFields(template: SharedTemplate) {
  const { id, created_at, updated_at, ...databasePayload } = template;
  void id;
  void created_at;
  void updated_at;

  if (templateColumnSupport.status === false) {
    delete databasePayload.status;
  }

  if (templateColumnSupport.requires_banner === false) {
    delete databasePayload.requires_banner;
  }

  if (templateColumnSupport.gradient_enabled === false) {
    delete databasePayload.gradient_enabled;
  }

  if (templateColumnSupport.supports_company_banner === false) {
    delete databasePayload.supports_company_banner;
  }

  if (templateColumnSupport.supports_gradient === false) {
    delete databasePayload.supports_gradient;
  }

  return databasePayload;
}

async function writeTemplateWithSchemaRetry(
  write: (databasePayload: ReturnType<typeof stripLocalOnlyFields>) => PromiseLike<{
    data: unknown;
    error: { message: string } | null;
  }>,
  template: SharedTemplate
) {
  let result = await write(stripLocalOnlyFields(template));

  while (result.error) {
    const missingColumn = missingColumnFromError(result.error);

    if (!missingColumn || !markUnsupportedColumn(missingColumn)) {
      break;
    }

    result = await write(stripLocalOnlyFields(template));
  }

  return result;
}

function learnTemplateColumns(rows: unknown[]) {
  const firstRow = rows.find(
    (row): row is Record<string, unknown> =>
      Boolean(row) && typeof row === "object" && !Array.isArray(row)
  );

  if (!firstRow) return;

  for (const column of Object.keys(templateColumnSupport) as Array<
    keyof typeof templateColumnSupport
  >) {
    templateColumnSupport[column] = Object.prototype.hasOwnProperty.call(
      firstRow,
      column
    );
  }
}

function markUnsupportedColumn(column: string) {
  if (column in templateColumnSupport) {
    templateColumnSupport[column as keyof typeof templateColumnSupport] = false;
    return true;
  }

  return false;
}

function missingColumnFromError(error: { message: string } | null) {
  const message = error?.message || "";
  const match = message.match(/'([^']+)' column of 'templates'/);
  return match?.[1] || null;
}

function isMissingColumnError(error: { message: string } | null, column: string) {
  return missingColumnFromError(error) === column;
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
