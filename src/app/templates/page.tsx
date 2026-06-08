"use client";

import { useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";
import CardRenderer from "@/components/CardRenderer";
import {
  deleteAdminTemplate,
  getAdminTemplates,
  normalizeColourPalette,
  publishAdminTemplate,
  saveAdminTemplate,
  type SharedTemplate,
} from "@/lib/templates";

type Template = {
  id: string;
  name: string;
  slug: string;
  layout_type: string | null;
  access_level: string | null;
  status?: "draft" | "published" | null;
  logo_size: LogoSize | null;
  requires_profile_image: boolean | null;
  requires_logo: boolean | null;
  requires_banner?: boolean | null;
  gradient_enabled?: boolean | null;
  colour_palette?: string[] | null;
  free_colour_palette?: string[] | null;
  allowed_fonts?: string[] | null;
  default_font?: string | null;
  supports_bio: boolean | null;
  supports_save_contact: boolean | null;
  allowed_fields: string[] | null;
  primary_color: string | null;
  secondary_color: string | null;
  text_color: string | null;
  button_color: string | null;
  button_text_color: string | null;
  custom_fields: CustomFields | null;
  show_personal_section: boolean | null;
  show_company_section: boolean | null;
  show_contact_section: boolean | null;
  show_social_section: boolean | null;
  is_published: boolean;
  usage_count: number | null;
};

type LogoSize = "compact" | "standard" | "large" | "banner";
type SectionKey = "personal" | "company" | "contact" | "social";
type CustomFields = Partial<Record<SectionKey, string[]>>;
type DraggedField = { section: SectionKey; field: string } | null;
type TemplatePayload = Record<
  string,
  string | boolean | number | null | string[] | CustomFields
>;

const cardHeaderFields = ["title", "first_name", "last_name"];

const sectionFieldGroups: {
  key: SectionKey;
  title: string;
  description: string;
  fields: string[];
}[] = [
  {
    key: "personal",
    title: "Personal Details",
    description: "Role and department details shown below the fixed name header.",
    fields: ["job_title", "department", "bio"],
  },
  {
    key: "company",
    title: "Company Details",
    description: "Company identity and location information.",
    fields: ["company_name", "website", "address"],
  },
  {
    key: "contact",
    title: "Contact",
    description: "Direct contact actions for the digital card.",
    fields: ["email", "phone"],
  },
  {
    key: "social",
    title: "Social",
    description: "Optional social and custom links.",
    fields: [
      "whatsapp",
      "linkedin",
      "instagram",
      "facebook",
      "youtube",
      "booking_link",
      "custom_url",
    ],
  },
];

const freeFields = [
  "title",
  "first_name",
  "last_name",
  "job_title",
  "department",
  "bio",
  "company_name",
  "website",
  "address",
  "email",
  "phone",
];

const defaultCustomFields: Required<CustomFields> = {
  personal: ["job_title", "department", "bio"],
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

const paidFields = [
  "title",
  "first_name",
  "last_name",
  "job_title",
  "department",
  "bio",
  "company_name",
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
];

const freeLayouts = [
  { value: "classic_free", label: "Classic Free" },
];

const paidLayouts = [
  { value: "premium_classic", label: "Premium Classic" },
  { value: "glassmorphism", label: "Glassmorphism" },
  { value: "banner_card", label: "Banner Card" },
  { value: "split_card", label: "Split Card" },
  { value: "monogram_card", label: "Monogram Card" },
];

const defaultFreeColourPalette = [
  "#AC00FF",
  "#101935",
  "#2563EB",
  "#059669",
  "#DC2626",
  "#0F172A",
];

const fontChoices = [
  "Inter",
  "Poppins",
  "Montserrat",
  "Lato",
  "Roboto",
  "Playfair Display",
  "DM Sans",
  "Outfit",
  "Nunito",
  "Space Mono",
  "Syne",
] as const;

const defaultAllowedFonts = ["Inter"];

function sanitizeAllowedFonts(fonts: unknown): string[] {
  if (!Array.isArray(fonts)) return defaultAllowedFonts;

  const cleanFonts = fonts.filter((font): font is string => {
    return typeof font === "string" && fontChoices.includes(font as typeof fontChoices[number]);
  });

  return cleanFonts.length > 0 ? cleanFonts : defaultAllowedFonts;
}

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateSearch, setTemplateSearch] = useState("");
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(
    null
  );
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateMessage, setTemplateMessage] = useState("");
  const [templateError, setTemplateError] = useState("");

  const [name, setName] = useState("");
  const [accessLevel, setAccessLevel] = useState("free");
  const [layoutType, setLayoutType] = useState("classic_free");

  const [requiresProfileImage, setRequiresProfileImage] = useState(true);
  const [requiresLogo, setRequiresLogo] = useState(false);
  const [requiresBanner, setRequiresBanner] = useState(false);
  const [gradientEnabled, setGradientEnabled] = useState(true);
  const [freeColourPalette, setFreeColourPalette] = useState<string[]>(
    defaultFreeColourPalette
  );
  const [allowedFonts, setAllowedFonts] =
    useState<string[]>(defaultAllowedFonts);
  const [defaultFont, setDefaultFont] = useState("");
  const [allowedFields, setAllowedFields] = useState<string[]>(freeFields);
  const [customFields, setCustomFields] =
    useState<CustomFields>(defaultCustomFields);

  const [primaryColor, setPrimaryColor] = useState("#AC00FF");
  const [secondaryColor, setSecondaryColor] = useState("#101935");
  const [textColor, setTextColor] = useState("#FFFFFF");
  const [buttonColor, setButtonColor] = useState("#FFFFFF");
  const [buttonTextColor, setButtonTextColor] = useState("#0F0E38");
  const [showPersonalSection, setShowPersonalSection] = useState(true);
  const [showCompanySection, setShowCompanySection] = useState(true);
  const [showContactSection, setShowContactSection] = useState(true);
  const [showSocialSection, setShowSocialSection] = useState(false);
  const [draggedField, setDraggedField] = useState<DraggedField>(null);

  const filteredTemplates = templates.filter((template) =>
    template.name.toLowerCase().includes(templateSearch.trim().toLowerCase())
  );
  const layoutOptions = accessLevel === "free" ? freeLayouts : paidLayouts;

  async function fetchTemplates() {
    try {
      const loadedTemplates = await getAdminTemplates();
      setTemplates(loadedTemplates as Template[]);
      setTemplateError("");
    } catch (error) {
      console.error("Template load failed", error);
      setTemplateError(
        error instanceof Error
          ? error.message
          : "Templates could not be loaded from Supabase."
      );
      setTemplates([]);
    }
  }

  useEffect(() => {
    let ignore = false;

    async function loadTemplates() {
      try {
        const loadedTemplates = await getAdminTemplates();

        if (ignore) return;

        setTemplates(loadedTemplates as Template[]);
        setTemplateError("");
      } catch (error) {
        if (ignore) return;

        console.error("Template load failed", error);
        setTemplateError(
          error instanceof Error
            ? error.message
            : "Templates could not be loaded from Supabase."
        );
      }
    }

    void loadTemplates();

    return () => {
      ignore = true;
    };
  }, []);

  function resetBuilder() {
    setEditingTemplateId(null);
    setName("");
    setAccessLevel("free");
    setLayoutType("classic_free");
    setRequiresProfileImage(true);
    setRequiresLogo(false);
    setRequiresBanner(false);
    setGradientEnabled(true);
    setFreeColourPalette(defaultFreeColourPalette);
    setAllowedFonts(defaultAllowedFonts);
    setDefaultFont("");
    setAllowedFields(freeFields);
    setCustomFields(defaultCustomFields);
    setPrimaryColor("#AC00FF");
    setSecondaryColor("#101935");
    setTextColor("#FFFFFF");
    setButtonColor("#FFFFFF");
    setButtonTextColor("#0F0E38");
    setShowPersonalSection(true);
    setShowCompanySection(true);
    setShowContactSection(true);
    setShowSocialSection(false);
  }

  function applyAccessLevel(value: string) {
    setAccessLevel(value);

    if (value === "free") {
      setLayoutType("classic_free");
      setRequiresProfileImage(true);
      setRequiresLogo(false);
      setRequiresBanner(false);
      setGradientEnabled(false);
      setFreeColourPalette(defaultFreeColourPalette);
      setAllowedFonts(defaultAllowedFonts);
      setDefaultFont("");
      setAllowedFields(freeFields);
      setCustomFields(defaultCustomFields);
      setShowPersonalSection(true);
      setShowCompanySection(true);
      setShowContactSection(true);
      setShowSocialSection(false);
    }

    if (value === "paid") {
      setLayoutType("premium_classic");
      setRequiresProfileImage(true);
      setRequiresLogo(true);
      setRequiresBanner(true);
      setGradientEnabled(true);
      setAllowedFonts([...fontChoices]);
      setDefaultFont("");
      setAllowedFields(paidFields);
      setCustomFields(defaultCustomFields);
      setShowPersonalSection(true);
      setShowCompanySection(true);
      setShowContactSection(true);
      setShowSocialSection(true);
    }
  }

  function toggleAllowedField(field: string) {
    if (allowedFields.includes(field)) {
      setAllowedFields(allowedFields.filter((item) => item !== field));
    } else {
      setAllowedFields([...allowedFields, field]);
    }
  }

  function addCustomField(section: SectionKey) {
    const fieldName = window.prompt("Field name");
    const normalized = fieldName?.trim();

    if (!normalized) return;

    const key = customFieldKey(section, normalized);

    setCustomFields((current) => {
      const existingFields = orderedSectionFields(section, current);
      const duplicate = existingFields.some(
        (field) =>
          field.toLowerCase() === key.toLowerCase() ||
          formatFieldLabel(field).toLowerCase() === normalized.toLowerCase()
      );

      if (duplicate) return current;

      return {
        ...current,
        [section]: [...existingFields, key],
      };
    });

    setAllowedFields((current) =>
      current.includes(key) ? current : [...current, key]
    );
  }

  function reorderField(section: SectionKey, dragged: string, target: string) {
    if (dragged === target) return;

    setCustomFields((current) => {
      const fields = orderedSectionFields(section, current);
      const currentIndex = fields.indexOf(dragged);
      const targetIndex = fields.indexOf(target);

      if (currentIndex < 0 || targetIndex < 0) {
        return current;
      }

      const reordered = [...fields];
      const [movedField] = reordered.splice(currentIndex, 1);
      reordered.splice(targetIndex, 0, movedField);

      return {
        ...current,
        [section]: reordered,
      };
    });
  }

  function dropField(section: SectionKey, target: string) {
    if (!draggedField || draggedField.section !== section) return;

    reorderField(section, draggedField.field, target);
    setDraggedField(null);
  }

  function deleteCustomField(section: SectionKey, field: string) {
    if (!isCustomFieldKey(field)) return;

    setCustomFields((current) => ({
      ...current,
      [section]: orderedSectionFields(section, current).filter(
        (item) => item !== field
      ),
    }));

    setAllowedFields((current) => current.filter((item) => item !== field));
  }

  function updateFreePaletteColour(index: number, value: string) {
    setFreeColourPalette((current) =>
      sanitizeFreeColourPalette(current).map((colour, colourIndex) =>
        colourIndex === index ? value : colour
      )
    );
  }

  function addFreePaletteColour() {
    setFreeColourPalette((current) => {
      const palette = sanitizeFreeColourPalette(current);

      if (palette.length >= 6) return palette;

      return [...palette, "#AC00FF"];
    });
  }

  function removeFreePaletteColour(index: number) {
    setFreeColourPalette((current) => {
      const palette = sanitizeFreeColourPalette(current).filter(
        (_, colourIndex) => colourIndex !== index
      );

      return palette.length ? palette : ["#AC00FF"];
    });
  }

  function toggleAllowedFont(font: string) {
    setAllowedFonts((current) => {
      const next = current.includes(font)
        ? current.filter((item) => item !== font)
        : [...current, font];
      const sanitized = sanitizeTemplateFonts(next);

      if (defaultFont && !sanitized.includes(defaultFont)) {
        setDefaultFont(sanitized[0] || "Inter");
      }

      return sanitized;
    });
  }

  function selectDefaultFont(font: string) {
    setDefaultFont(font);
    setAllowedFonts((current) =>
      current.includes(font) ? current : sanitizeTemplateFonts([...current, font])
    );
  }

  function sectionState(section: string) {
    if (section === "personal") {
      return {
        enabled: showPersonalSection,
        onChange: setShowPersonalSection,
      };
    }

    if (section === "company") {
      return {
        enabled: showCompanySection,
        onChange: setShowCompanySection,
      };
    }

    if (section === "contact") {
      return {
        enabled: showContactSection,
        onChange: setShowContactSection,
      };
    }

    return {
      enabled: showSocialSection,
      onChange: setShowSocialSection,
    };
  }

  function editTemplate(template: Template) {
    setEditingTemplateId(template.id);
    setName(template.name);
    const normalizedAccessLevel = template.access_level === "free" ? "free" : "paid";
    setAccessLevel(normalizedAccessLevel);
    setLayoutType(
      normalizeTemplateLayout(template.layout_type, normalizedAccessLevel)
    );
    setRequiresProfileImage(template.requires_profile_image ?? true);
    setRequiresLogo(
      normalizedAccessLevel === "paid" && (template.requires_logo ?? false)
    );
    setRequiresBanner(
      normalizedAccessLevel === "paid" && (template.requires_banner ?? false)
    );
    setGradientEnabled(template.gradient_enabled ?? normalizedAccessLevel === "paid");
    setFreeColourPalette(
      sanitizeFreeColourPalette(template.free_colour_palette)
    );
    const normalizedAllowedFonts = sanitizeAllowedFonts(
      template.allowed_fonts || defaultAllowedFonts
    );
    setAllowedFonts(normalizedAllowedFonts);
    setDefaultFont(
      template.default_font && normalizedAllowedFonts.includes(template.default_font)
        ? template.default_font
        : ""
    );
    setAllowedFields(template.allowed_fields || freeFields);
    setCustomFields(normalizeCustomFields(template.custom_fields));
    setPrimaryColor(template.primary_color || "#AC00FF");
    setSecondaryColor(template.secondary_color || "#101935");
    setTextColor(template.text_color || "#FFFFFF");
    setButtonColor(template.button_color || "#FFFFFF");
    setButtonTextColor(template.button_text_color || "#0F0E38");
    setShowPersonalSection(template.show_personal_section ?? true);
    setShowCompanySection(template.show_company_section ?? true);
    setShowContactSection(template.show_contact_section ?? true);
    setShowSocialSection(template.show_social_section ?? false);

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveTemplate() {
    if (savingTemplate) return;

    if (!name.trim()) {
      setTemplateError("Template name is required.");
      return;
    }

    const slug = name
      .toLowerCase()
      .trim()
      .replaceAll(" ", "-")
      .replace(/[^a-z0-9-]/g, "");

    const payload = buildTemplatePayload({
      name,
      slug,
      layout_type: normalizeTemplateLayout(layoutType, accessLevel),
      access_level: accessLevel,
      primary_color: primaryColor,
      secondary_color: secondaryColor,
      text_color: textColor,
      button_color: buttonColor,
      button_text_color: buttonTextColor,
      requires_profile_image: requiresProfileImage,
      requires_logo: accessLevel === "paid" && requiresLogo,
      requires_banner: accessLevel === "paid" && requiresBanner,
      gradient_enabled: accessLevel === "paid" && gradientEnabled,
      free_colour_palette: sanitizeFreeColourPalette(freeColourPalette),
      allowed_fonts:
        accessLevel === "paid" ? sanitizeTemplateFonts(allowedFonts) : defaultAllowedFonts,
      default_font: accessLevel === "paid" ? defaultFont || null : "Inter",
      allowed_fields: allowedFields,
      custom_fields: customFields,
      show_personal_section: showPersonalSection,
      show_company_section: showCompanySection,
      show_contact_section: showContactSection,
      show_social_section: showSocialSection,
    });

    try {
      setSavingTemplate(true);
      setTemplateError("");
      setTemplateMessage("");

      const existingTemplate = templates.find(
        (template) => template.id === editingTemplateId
      );
      const result = await saveAdminTemplate(
        {
          ...payload,
          is_published: existingTemplate?.is_published ?? false,
          status: existingTemplate?.is_published ? "published" : "draft",
          usage_count: existingTemplate?.usage_count ?? 0,
        } as unknown as SharedTemplate,
        editingTemplateId
      );
      const savedTemplate = result.template as Template;

      setTemplates((current) => {
        const withoutSaved = current.filter((template) => template.id !== savedTemplate.id);
        return [savedTemplate, ...withoutSaved];
      });
      setTemplateSearch("");

      resetBuilder();
      await fetchTemplates();
      setTemplateMessage("Template saved successfully.");
    } catch (error) {
      console.error("Template save failed", error);
      setTemplateError(
        error instanceof Error
          ? error.message
          : "Template could not be saved. Your current edits are still on screen."
      );
    } finally {
      setSavingTemplate(false);
    }
  }

  async function duplicateTemplate(template: Template) {
    const newName = `${template.name} Copy`;

    const newSlug = `${template.slug}-copy-${Date.now()}`;

    const duplicatePayload = buildTemplatePayload({
      name: newName,
      slug: newSlug,
      layout_type: normalizeTemplateLayout(
        template.layout_type,
        template.access_level === "free" ? "free" : "paid"
      ),
      access_level: template.access_level === "free" ? "free" : "paid",
      primary_color: template.primary_color || "#AC00FF",
      secondary_color: template.secondary_color || "#101935",
      text_color: template.text_color || "#FFFFFF",
      button_color: template.button_color || "#FFFFFF",
      button_text_color: template.button_text_color || "#0F0E38",
      requires_profile_image: template.requires_profile_image ?? true,
      requires_logo:
        template.access_level !== "free" && (template.requires_logo ?? false),
      requires_banner:
        template.access_level !== "free" && (template.requires_banner ?? false),
      gradient_enabled:
        template.access_level !== "free" && (template.gradient_enabled ?? true),
      free_colour_palette: sanitizeFreeColourPalette(template.free_colour_palette),
      allowed_fonts:
        template.access_level === "free"
          ? defaultAllowedFonts
          : sanitizeTemplateFonts(template.allowed_fonts || defaultAllowedFonts),
      default_font:
        template.access_level === "free"
          ? "Inter"
          : sanitizeDefaultFont(template.default_font, template.allowed_fonts),
      allowed_fields: template.allowed_fields || freeFields,
      custom_fields: normalizeCustomFields(template.custom_fields),
      show_personal_section: template.show_personal_section ?? true,
      show_company_section: template.show_company_section ?? true,
      show_contact_section: template.show_contact_section ?? true,
      show_social_section: template.show_social_section ?? false,
    });

    const insertPayload = {
      ...duplicatePayload,
      is_published: false,
      status: "draft",
      usage_count: 0,
    };

    try {
      await saveAdminTemplate(insertPayload as unknown as SharedTemplate);
      setTemplateMessage("Template duplicated successfully.");
      setTemplateError("");
      await fetchTemplates();
    } catch (error) {
      console.error("Template duplicate failed", error);
      setTemplateError(
        error instanceof Error
          ? error.message
          : "Template could not be duplicated. Please try again."
      );
    }
  }

  async function togglePublished(template: Template) {
    try {
      const result = await publishAdminTemplate(
        template as unknown as SharedTemplate,
        !template.is_published
      );
      setTemplates((current) =>
        current.map((item) =>
          item.id === template.id ? (result.template as Template) : item
        )
      );
      setTemplateMessage(
        `Template ${result.template.is_published ? "published" : "unpublished"}.`
      );
      setTemplateError("");
    } catch (error) {
      console.error("Template publish failed", error);
      setTemplateError(
        error instanceof Error
          ? error.message
          : "Template publish state could not be updated. Please try again."
      );
    }
  }

  async function deleteTemplate(template: Template) {
    const confirmed = window.confirm(
      `Delete template "${template.name}"? This cannot be undone.`
    );

    if (!confirmed) return;

    try {
      await deleteAdminTemplate(template.id);
      setTemplates((current) =>
        current.filter((currentTemplate) => currentTemplate.id !== template.id)
      );
      setTemplateMessage("Template deleted successfully.");
      setTemplateError("");
    } catch (error) {
      console.error("Template delete failed", error);
      setTemplateError(
        error instanceof Error
          ? error.message
          : "Template could not be deleted. Please try again."
      );
      return;
    }

    if (editingTemplateId === template.id) {
      resetBuilder();
    }
  }

  return (
    <main className="flex min-h-screen bg-[#070B1A] text-white">
      <Sidebar />

      <section className="flex-1 p-10">
        <div className="mb-8">
          <h1 className="text-4xl font-bold">Templates</h1>
          <p className="mt-2 text-white/50">
            Create and edit reusable card layouts. Clients will customise
            colours and content later.
          </p>
        </div>

        {templateMessage && (
          <div className="mb-6 rounded-2xl border border-green-400/20 bg-green-500/10 px-5 py-4 text-sm text-green-100">
            {templateMessage}
          </div>
        )}

        {templateError && (
          <div className="mb-6 rounded-2xl border border-yellow-400/20 bg-yellow-500/10 px-5 py-4 text-sm text-yellow-100">
            {templateError}
          </div>
        )}

        <div className="mb-10 grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-start">
          <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-2xl font-semibold">
                  {editingTemplateId ? "Edit Template" : "Template Builder"}
                </h2>

                <p className="mt-1 text-sm text-white/45">
                  {editingTemplateId
                    ? "Update this template and save your changes."
                    : "Choose sensible defaults by access level, then manually tune the template rules."}
                </p>
              </div>

              {editingTemplateId && (
                <button
                  onClick={resetBuilder}
                  className="rounded-2xl bg-white/10 px-4 py-2 text-sm hover:bg-white/15"
                >
                  Cancel Edit
                </button>
              )}
            </div>

            <div className="mt-6 grid grid-cols-2 gap-4">
              <Field label="Template Name">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Classic"
                  className="inputStyle"
                />
              </Field>

              <Field label="Access Level">
                <select
                  value={accessLevel}
                  onChange={(e) => applyAccessLevel(e.target.value)}
                  className="inputStyle"
                >
                  <option value="free">Free</option>
                  <option value="paid">Paid</option>
                </select>
              </Field>

              <Field label="Layout Style">
                <select
                  value={layoutType}
                  onChange={(e) => setLayoutType(e.target.value)}
                  className="inputStyle"
                >
                  {layoutOptions.map((layout) => (
                    <option key={layout.value} value={layout.value}>
                      {layout.label}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Profile Picture">
                <select
                  value={requiresProfileImage ? "yes" : "no"}
                  onChange={(e) =>
                    setRequiresProfileImage(e.target.value === "yes")
                  }
                  className="inputStyle"
                >
                  <option value="yes">Enabled</option>
                  <option value="no">Disabled</option>
                </select>
              </Field>

              {accessLevel === "paid" && (
                <Field label="Company Logo">
                  <select
                    value={requiresLogo ? "yes" : "no"}
                    onChange={(e) => setRequiresLogo(e.target.value === "yes")}
                    className="inputStyle"
                  >
                    <option value="yes">Enabled</option>
                    <option value="no">Disabled</option>
                  </select>
                </Field>
              )}

              {accessLevel === "paid" && (
                <Field label="Company Banner">
                  <select
                    value={requiresBanner ? "yes" : "no"}
                    onChange={(e) => setRequiresBanner(e.target.value === "yes")}
                    className="inputStyle"
                  >
                    <option value="yes">Enabled</option>
                    <option value="no">Disabled</option>
                  </select>
                </Field>
              )}

              {accessLevel === "paid" && (
                <Field label="Gradient Background">
                  <select
                    value={gradientEnabled ? "yes" : "no"}
                    onChange={(e) => setGradientEnabled(e.target.value === "yes")}
                    className="inputStyle"
                  >
                    <option value="yes">Enabled</option>
                    <option value="no">Disabled</option>
                  </select>
                </Field>
              )}
            </div>

            {accessLevel === "free" ? (
              <FreeColourPalette
                colours={freeColourPalette}
                onChange={updateFreePaletteColour}
                onAdd={addFreePaletteColour}
                onRemove={removeFreePaletteColour}
              />
            ) : (
              <>
                <div className="mt-8">
                  <h3 className="text-lg font-semibold">Paid Branding Colours</h3>
                  <p className="mt-1 text-sm text-white/45">
                    Paid templates unlock full branding defaults for company cards.
                  </p>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
                    <ColorField
                      label="Primary Colour"
                      value={primaryColor}
                      onChange={setPrimaryColor}
                    />
                    <ColorField
                      label="Secondary Colour"
                      value={secondaryColor}
                      onChange={setSecondaryColor}
                    />
                    <ColorField
                      label="Text Colour"
                      value={textColor}
                      onChange={setTextColor}
                    />
                    <ColorField
                      label="Button Colour"
                      value={buttonColor}
                      onChange={setButtonColor}
                    />
                    <ColorField
                      label="Button Text Colour"
                      value={buttonTextColor}
                      onChange={setButtonTextColor}
                    />
                  </div>
                </div>

                <TypographyControls
                  allowedFonts={allowedFonts}
                  defaultFont={defaultFont}
                  onToggleFont={toggleAllowedFont}
                  onSelectDefaultFont={selectDefaultFont}
                />
              </>
            )}

            <div className="mt-8">
              <h3 className="text-lg font-semibold">Classic Sections</h3>
              <p className="mt-1 text-sm text-white/45">
                Toggle each card section, then choose which fields are allowed
                inside it. The profile image and name header always stay
                visible on Classic cards.
              </p>

              <div className="mt-4 space-y-4">
                <CardHeaderControl
                  fields={cardHeaderFields}
                  allowedFields={allowedFields}
                  onToggleField={toggleAllowedField}
                />

                {sectionFieldGroups.map((section) => {
                  const { enabled, onChange } = sectionState(section.key);

                  return (
                    <SectionControl
                      key={section.key}
                      section={section.key}
                      title={section.title}
                      description={section.description}
                      fields={orderedSectionFields(section.key, customFields)}
                      builtInFields={section.fields}
                      enabled={enabled}
                      allowedFields={allowedFields}
                      onToggleSection={() => onChange(!enabled)}
                      onToggleField={toggleAllowedField}
                      onAddField={() => addCustomField(section.key)}
                      onDeleteField={(field) => deleteCustomField(section.key, field)}
                      draggedField={draggedField}
                      onDragStart={(field) =>
                        setDraggedField({ section: section.key, field })
                      }
                      onDragEnd={() => setDraggedField(null)}
                      onDropField={(field) => dropField(section.key, field)}
                    />
                  );
                })}
              </div>
            </div>

            <button
              type="button"
              onClick={() => void saveTemplate()}
              disabled={savingTemplate}
              className="mt-8 rounded-2xl bg-[#AC00FF] px-6 py-3 font-medium hover:opacity-90 transition disabled:cursor-not-allowed disabled:opacity-50"
            >
              {savingTemplate
                ? "Saving..."
                : editingTemplateId
                ? "Save Changes"
                : "Create Template"}
            </button>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/5 p-6 lg:sticky lg:top-6 lg:self-start">
            <h2 className="mb-6 text-2xl font-semibold">Live Preview</h2>

            <div className="max-w-full overflow-hidden">
              <CardRenderer
                mode="preview"
                template={{
                  layout_type: layoutType,
                  logo_size: "standard",
                  access_level: accessLevel,
                  requires_profile_image: requiresProfileImage,
                  requires_logo: accessLevel === "paid" && requiresLogo,
                  requires_banner: accessLevel === "paid" && requiresBanner,
                  gradient_enabled: accessLevel === "paid" && gradientEnabled,
                  free_colour_palette: sanitizeFreeColourPalette(freeColourPalette),
                  allowed_fonts:
                    accessLevel === "paid"
                      ? sanitizeTemplateFonts(allowedFonts)
                      : defaultAllowedFonts,
                  default_font: accessLevel === "paid" ? defaultFont || null : "Inter",
                  supports_bio: true,
                  supports_save_contact: true,
                  allowed_fields: allowedFields,
                  custom_fields: customFields,
                  primary_color: primaryColor,
                  secondary_color: secondaryColor,
                  text_color: textColor,
                  button_color: buttonColor,
                  button_text_color: buttonTextColor,
                  show_personal_section: showPersonalSection,
                  show_company_section: showCompanySection,
                  show_contact_section: showContactSection,
                  show_social_section: showSocialSection,
                }}
                cardData={{
                  title: "Dr",
                  first_name: "First Name",
                  last_name: "Last Name",
                  full_name: "Full Name",
                  job_title: "Creative Director",
                  bio:
                    "A short professional bio can describe experience, services, or the best way to connect.",
                  company_name: "DevMaster Inc",
                  company_logo_url:
                    accessLevel === "paid" && requiresLogo ? "" : null,
                  company_banner_url:
                    accessLevel === "paid" && requiresBanner ? "" : null,
                  department: "Creative Department",
                  email: "hello@devmasterinc.com",
                  phone: "+44 7000 000000",
                  website: "https://www.devmasterinc.com",
                  address: "London, United Kingdom",
                  whatsapp: "+44 7000 000000",
                  linkedin: "linkedin.com/company/devmasterinc",
                  instagram: "@devmasterinc",
                  facebook: "facebook.com/devmasterinc",
                  youtube: "youtube.com/@devmasterinc",
                  booking_link: "devmasterinc.com/book",
                  custom_url: "devmasterinc.com",
                  custom_fields: previewCustomFieldValues(customFields),
                }}
              />
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/5">
          <div className="flex flex-col gap-4 border-b border-white/10 p-6 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-semibold">Current Templates</h2>
              <span className="rounded-full border border-[#AC00FF]/30 bg-[#AC00FF]/15 px-3 py-1 text-xs font-medium text-purple-100">
                {templates.length} total
              </span>
            </div>

            <div className="w-full md:max-w-sm">
              <label htmlFor="template-search" className="sr-only">
                Search templates by name
              </label>
              <input
                id="template-search"
                value={templateSearch}
                onChange={(e) => setTemplateSearch(e.target.value)}
                placeholder="Search templates..."
                className="inputStyle"
              />
            </div>
          </div>

          <div className="max-h-[760px] overflow-y-auto p-6">
            <div className="flex flex-wrap justify-center gap-6">
              {filteredTemplates.map((template) => (
                <div
                  key={template.id}
                  className="w-[260px] shrink-0 rounded-2xl border border-white/10 bg-white/5 p-3 transition hover:border-[#AC00FF]/35 hover:bg-white/[0.07]"
                >
                  <div className="mb-3 flex h-36 items-start justify-center overflow-hidden rounded-xl bg-[#070B1A]/60">
                    <div className="mx-auto origin-top scale-[0.28]">
                      <div className="mx-auto w-[560px]">
                        <CardRenderer
                          mode="compact"
                          template={template}
                          cardData={{
                            title: "Dr",
                            first_name: "First Name",
                            last_name: "Last Name",
                            full_name: "Full Name",
                            job_title: "Creative Director",
                            bio: "Professional bio",
                            company_name: "DevMaster Inc",
                            department: "Creative Department",
                            email: "hello@devmasterinc.com",
                            phone: "+44 7000 000000",
                            website: "devmasterinc.com",
                            address: "London, United Kingdom",
                            custom_fields: previewCustomFieldValues(
                              template.custom_fields || {}
                            ),
                          }}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="truncate text-base font-semibold">
                        {template.name}
                      </h2>
                    </div>

                    <AccessBadge level={template.access_level || "free"} />
                  </div>

                  <div className="mt-3 border-t border-white/10 pt-3">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs ${
                        template.is_published
                          ? "bg-green-500/20 text-green-300"
                          : "bg-white/10 text-white/50"
                      }`}
                    >
                      {template.is_published ? "Published" : "Draft"}
                    </span>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      onClick={() => editTemplate(template)}
                      className="rounded-lg bg-white/10 py-2 text-xs hover:bg-white/15"
                    >
                      Edit
                    </button>

                    <button
                      onClick={() => duplicateTemplate(template)}
                      className="rounded-lg bg-white/10 py-2 text-xs hover:bg-white/15"
                    >
                      Duplicate
                    </button>

                    <button
                      onClick={() => togglePublished(template)}
                      className="rounded-lg bg-[#AC00FF] py-2 text-xs hover:opacity-90"
                    >
                      {template.is_published ? "Unpublish" : "Publish"}
                    </button>

                    <button
                      onClick={() => deleteTemplate(template)}
                      className="rounded-lg bg-white/10 py-2 text-xs hover:bg-red-500/20"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-white/55">
        {label}
      </span>
      {children}
    </label>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block rounded-2xl border border-white/10 bg-white/5 p-3">
      <span className="mb-2 block text-xs font-medium text-white/45">
        {label}
      </span>
      <div className="flex items-center gap-3">
        <input
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-11 w-12 shrink-0 rounded-xl border border-white/10 bg-transparent"
        />
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="min-w-[96px] flex-1 rounded-xl border border-white/10 bg-[#101935] px-3 py-2 text-sm font-semibold uppercase tracking-[0.04em] outline-none transition focus:border-[#AC00FF]"
        />
      </div>
    </label>
  );
}

function FreeColourPalette({
  colours,
  onChange,
  onAdd,
  onRemove,
}: {
  colours: string[];
  onChange: (index: number, value: string) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
}) {
  const palette = sanitizeFreeColourPalette(colours);

  return (
    <div className="mt-8 rounded-3xl border border-white/10 bg-[#101935]/50 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold">Free Colour Palette</h3>
          <p className="mt-1 text-sm text-white/45">
            Free templates use admin-approved solid colours only. The first
            colour becomes the default card background.
          </p>
        </div>

        <button
          type="button"
          onClick={onAdd}
          disabled={palette.length >= 6}
          className="rounded-2xl bg-white/10 px-4 py-2 text-xs font-medium transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-45"
        >
          Add Colour
        </button>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3">
        {palette.map((colour, index) => (
          <div
            key={`free-colour-${index}`}
            className="rounded-2xl border border-white/10 bg-white/5 p-3"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-white/50">
                Colour {index + 1}
              </span>
              {palette.length > 1 && (
                <button
                  type="button"
                  onClick={() => onRemove(index)}
                  className="text-xs text-red-300 hover:text-red-200"
                >
                  Remove
                </button>
              )}
            </div>
            <div className="mt-3 flex items-center gap-3">
              <input
                type="color"
                value={colour}
                onChange={(event) => onChange(index, event.target.value)}
                className="h-10 w-12 cursor-pointer rounded-xl border border-white/10 bg-transparent"
              />
              <input
                value={colour}
                onChange={(event) => onChange(index, event.target.value)}
                className="min-w-0 flex-1 rounded-xl border border-white/10 bg-[#070B1A] px-3 py-2 text-sm outline-none transition focus:border-[#AC00FF]"
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TypographyControls({
  allowedFonts,
  defaultFont,
  onToggleFont,
  onSelectDefaultFont,
}: {
  allowedFonts: string[];
  defaultFont: string;
  onToggleFont: (font: string) => void;
  onSelectDefaultFont: (font: string) => void;
}) {
  return (
    <div className="mt-8 rounded-3xl border border-white/10 bg-[#101935]/50 p-5">
      <div>
        <h3 className="text-lg font-semibold">Typography (Paid Templates Only)</h3>
        <p className="mt-1 text-sm text-white/45">
          Select allowed fonts, then choose the default font for this paid card
          preview.
        </p>
      </div>

      <div className="mt-5 grid grid-cols-[repeat(auto-fit,minmax(135px,1fr))] gap-3">
        {fontChoices.map((font) => {
          const enabled = allowedFonts.includes(font);
          const isDefault = defaultFont === font;

          return (
            <div
              key={font}
              className={`relative rounded-2xl border p-4 transition ${
                isDefault
                  ? "border-[#AC00FF] bg-[#AC00FF]/18 shadow-[0_0_28px_rgba(172,0,255,0.22)]"
                  : enabled
                  ? "border-[#AC00FF]/45 bg-[#AC00FF]/10 shadow-[0_0_18px_rgba(172,0,255,0.10)]"
                  : "border-white/10 bg-white/5 text-white/50 hover:border-white/20 hover:text-white/80"
              }`}
            >
              {isDefault && (
                <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-md bg-[#AC00FF] text-xs text-white">
                  ✓
                </span>
              )}

              <button
                type="button"
                onClick={() => onSelectDefaultFont(font)}
                className="block w-full text-left"
              >
                <p className="pr-7 text-sm font-semibold text-white">{font}</p>
                <p
                  className="mt-5 text-3xl font-semibold leading-none text-white"
                  style={{ fontFamily: font }}
                >
                  Aa
                </p>
              </button>

              <button
                type="button"
                onClick={() => onToggleFont(font)}
                className={`mt-4 w-full rounded-xl px-3 py-2 text-xs font-medium transition ${
                  isDefault
                    ? "bg-[#AC00FF] text-white hover:opacity-90"
                    : enabled
                    ? "bg-white/10 text-purple-100 hover:bg-white/15"
                    : "bg-white/5 text-white/45 hover:bg-white/10 hover:text-white/70"
                }`}
              >
                {isDefault ? "Default" : enabled ? "Allowed" : "Allow Font"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SectionControl({
  section,
  title,
  description,
  fields,
  builtInFields,
  enabled,
  allowedFields,
  onToggleSection,
  onToggleField,
  onAddField,
  onDeleteField,
  draggedField,
  onDragStart,
  onDragEnd,
  onDropField,
}: {
  section: SectionKey;
  title: string;
  description: string;
  fields: string[];
  builtInFields: string[];
  enabled: boolean;
  allowedFields: string[];
  onToggleSection: () => void;
  onToggleField: (field: string) => void;
  onAddField: () => void;
  onDeleteField: (field: string) => void;
  draggedField: DraggedField;
  onDragStart: (field: string) => void;
  onDragEnd: () => void;
  onDropField: (field: string) => void;
}) {
  return (
    <div
      className={`rounded-3xl border p-5 transition ${
        enabled
          ? "border-[#AC00FF]/35 bg-[#AC00FF]/10"
          : "border-white/10 bg-white/5"
      }`}
    >
      <button
        type="button"
        onClick={onToggleSection}
        className="flex w-full items-center justify-between gap-4 text-left"
      >
        <span>
          <span className="block font-semibold">{title}</span>
          <span className="mt-1 block text-xs leading-relaxed text-white/45">
            {description}
          </span>
        </span>
        <span
          className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${
            enabled
              ? "bg-[#AC00FF] text-white"
              : "bg-white/10 text-white/45"
          }`}
        >
          {enabled ? "On" : "Off"}
        </span>
      </button>

      {enabled && (
        <>
          <div className="mt-5 space-y-2.5">
            {fields.map((field) => {
              const active = allowedFields.includes(field);
              const custom = isCustomFieldKey(field);
              const dragging =
                draggedField?.section === section && draggedField.field === field;

              return (
                <div
                  key={`${section}-${field}`}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move";
                    onDragStart(field);
                  }}
                  onDragEnd={onDragEnd}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    onDropField(field);
                  }}
                  className={`flex cursor-grab items-center gap-3 rounded-2xl border px-4 py-3 transition active:cursor-grabbing ${
                    dragging
                      ? "border-[#AC00FF] bg-[#AC00FF]/20 shadow-lg shadow-[#AC00FF]/10"
                      : "border-white/10 bg-white/5 hover:border-[#AC00FF]/30 hover:bg-white/[0.07]"
                  }`}
                >
                  <span className="shrink-0 select-none text-sm tracking-[-0.2em] text-white/30">
                    ::
                  </span>
                  <span className="min-w-0 flex-1 text-sm font-medium capitalize">
                    {formatFieldLabel(field)}
                  </span>
                  <button
                    type="button"
                    onDragStart={(event) => event.preventDefault()}
                    onClick={() => onToggleField(field)}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                      active
                        ? "bg-[#AC00FF] text-white"
                        : "bg-white/10 text-white/45"
                    }`}
                  >
                    {active ? "On" : "Off"}
                  </button>
                  <button
                    type="button"
                    onDragStart={(event) => event.preventDefault()}
                    onClick={() => onDeleteField(field)}
                    disabled={!custom || builtInFields.includes(field)}
                    className="rounded-lg bg-white/10 px-3 py-1 text-xs text-red-200 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:text-white/25 disabled:hover:bg-white/10"
                  >
                    Delete
                  </button>
                </div>
              );
            })}
          </div>

          <button
            type="button"
            onClick={onAddField}
            className="mt-3 w-full rounded-2xl border border-dashed border-[#AC00FF]/35 bg-[#AC00FF]/10 px-4 py-2 text-sm font-medium text-purple-100 transition hover:border-[#AC00FF]/60 hover:bg-[#AC00FF]/15"
          >
            Add Field
          </button>
        </>
      )}
    </div>
  );
}

function CardHeaderControl({
  fields,
  allowedFields,
  onToggleField,
}: {
  fields: string[];
  allowedFields: string[];
  onToggleField: (field: string) => void;
}) {
  return (
    <div className="rounded-3xl border border-[#AC00FF]/35 bg-[#AC00FF]/10 p-5">
      <div className="flex w-full items-start justify-between gap-4 text-left">
        <span>
          <span className="block font-semibold">Card Header</span>
          <span className="mt-1 block text-xs leading-relaxed text-white/45">
            Controls the name shown under the profile image.
          </span>
        </span>
        <span className="shrink-0 rounded-full bg-[#AC00FF] px-3 py-1 text-xs font-medium text-white">
          Fixed
        </span>
      </div>

      <div className="mt-5 space-y-2.5">
        {fields.map((field) => {
          const active = allowedFields.includes(field);

          return (
            <div
              key={`header-${field}`}
              className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 transition hover:border-[#AC00FF]/30 hover:bg-white/[0.07]"
            >
              <span className="min-w-0 flex-1 text-sm font-medium capitalize">
                {formatFieldLabel(field)}
              </span>
              <button
                type="button"
                onClick={() => onToggleField(field)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                  active
                    ? "bg-[#AC00FF] text-white"
                    : "bg-white/10 text-white/45"
                }`}
              >
                {active ? "On" : "Off"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function customFieldKey(section: SectionKey, label: string) {
  return `custom:${section}:${label}`;
}

function isCustomFieldKey(field: string) {
  return field.startsWith("custom:");
}

function orderedSectionFields(section: SectionKey, customFields: CustomFields) {
  return normalizeCustomFields(customFields)[section];
}

function normalizeCustomFields(customFields?: CustomFields | null) {
  return sectionFieldGroups.reduce<Required<CustomFields>>(
    (normalized, section) => {
      const defaultFields = section.fields;
      const incomingFields = customFields?.[section.key] || [];
      const seen = new Set<string>();
      const fields = [...incomingFields, ...defaultFields]
        .filter((field) => field !== "full_name")
        .filter((field) => !(section.key === "personal" && cardHeaderFields.includes(field)))
        .map((field) => normalizeSectionField(section.key, field))
        .filter((field) => {
          const key = field.toLowerCase();

          if (seen.has(key)) return false;

          seen.add(key);
          return true;
        });

      normalized[section.key] = fields;
      return normalized;
    },
    {
      personal: [],
      company: [],
      contact: [],
      social: [],
    }
  );
}

function normalizeSectionField(section: SectionKey, field: string) {
  const builtInFields =
    sectionFieldGroups.find((group) => group.key === section)?.fields || [];

  if (builtInFields.includes(field) || isCustomFieldKey(field)) {
    return field;
  }

  return customFieldKey(section, field);
}

function previewCustomFieldValues(customFields: CustomFields) {
  return Object.values(customFields)
    .flat()
    .filter((field) => isCustomFieldKey(field))
    .reduce<Record<string, string>>((values, label) => {
      values[formatFieldLabel(label)] = `${formatFieldLabel(label)} details`;
      return values;
    }, {});
}

function formatFieldLabel(field: string) {
  if (field.startsWith("custom:")) {
    return field.split(":").at(-1) || field;
  }

  return field.replaceAll("_", " ");
}

function buildTemplatePayload({
  name,
  slug,
  layout_type,
  access_level,
  primary_color,
  secondary_color,
  text_color,
  button_color,
  button_text_color,
  requires_profile_image,
  requires_logo,
  requires_banner,
  gradient_enabled,
  free_colour_palette,
  allowed_fonts,
  default_font,
  allowed_fields,
  custom_fields,
  show_personal_section,
  show_company_section,
  show_contact_section,
  show_social_section,
}: {
  name: string;
  slug: string;
  layout_type: string;
  access_level: string;
  primary_color: string;
  secondary_color: string;
  text_color: string;
  button_color: string;
  button_text_color: string;
  requires_profile_image: boolean;
  requires_logo: boolean;
  requires_banner: boolean;
  gradient_enabled: boolean;
  free_colour_palette: string[];
  allowed_fonts: string[];
  default_font: string | null;
  allowed_fields: string[];
  custom_fields: CustomFields;
  show_personal_section: boolean;
  show_company_section: boolean;
  show_contact_section: boolean;
  show_social_section: boolean;
}): TemplatePayload {
  return {
    name: name.trim(),
    slug,
    layout_type,
    access_level,
    is_premium: access_level !== "free",
    status: "draft",
    primary_color,
    secondary_color,
    text_color,
    button_color,
    button_text_color,
    requires_profile_image,
    requires_logo,
    requires_banner,
    gradient_enabled,
    free_colour_palette: sanitizeFreeColourPalette(free_colour_palette),
    colour_palette: sanitizeFreeColourPalette(free_colour_palette),
    allowed_fonts: sanitizeTemplateFonts(allowed_fonts),
    default_font: sanitizeDefaultFont(default_font, allowed_fonts),
    supports_bio: true,
    supports_save_contact: true,
    allowed_fields: sanitizeAllowedFields(allowed_fields),
    custom_fields: sanitizeCustomFields(custom_fields),
    logo_size: "standard",
    show_personal_section,
    show_company_section,
    show_contact_section,
    show_social_section,
  };
}

function sanitizeAllowedFields(fields: string[]) {
  return Array.from(
    new Set(
      fields
        .filter((field): field is string => typeof field === "string")
        .map((field) => field.trim())
        .filter(Boolean)
    )
  );
}

function sanitizeFreeColourPalette(colours?: unknown) {
  const palette = normalizeColourPalette(colours);

  return palette.length ? palette : ["#AC00FF"];
}

function sanitizeTemplateFonts(fonts?: string[] | null) {
  const sanitized = Array.from(
    new Set(
      (fonts || defaultAllowedFonts).filter((font) =>
        fontChoices.includes(font as typeof fontChoices[number])
      )
    )
  );

  return sanitized.length ? sanitized : defaultAllowedFonts;
}

function sanitizeDefaultFont(defaultFont?: string | null, fonts?: string[] | null) {
  if (!defaultFont) return null;

  const allowed = sanitizeTemplateFonts(fonts);

  if (allowed.includes(defaultFont)) {
    return defaultFont;
  }

  return null;
}

function normalizeTemplateLayout(layout: string | null | undefined, accessLevel: string) {
  if (accessLevel === "free") return "classic_free";

  const allowedPaidLayouts = paidLayouts.map((item) => item.value);

  if (layout && allowedPaidLayouts.includes(layout)) {
    return layout;
  }

  return "premium_classic";
}

function sanitizeCustomFields(customFields: CustomFields): CustomFields {
  const normalized = normalizeCustomFields(customFields);

  return {
    personal: sanitizeAllowedFields(normalized.personal),
    company: sanitizeAllowedFields(normalized.company),
    contact: sanitizeAllowedFields(normalized.contact).filter(
      (field) => field !== "website"
    ),
    social: sanitizeAllowedFields(normalized.social),
  };
}

function AccessBadge({ level }: { level: string }) {
  const displayLevel = level === "free" ? "Free" : "Paid";
  const styles =
    displayLevel === "Free"
      ? "bg-white/10 text-white/55"
      : "bg-yellow-500/20 text-yellow-300";

  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${styles}`}>
      {displayLevel}
    </span>
  );
}
