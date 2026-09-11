"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Sidebar from "@/components/Sidebar";
import CardRenderer, {
  type CardRendererData,
  type CardRendererTemplate,
} from "@/components/CardRenderer";
import ColourPicker from "@/components/ColourPicker";
import CardEditorModalShell from "@/components/card-builder/CardEditorModalShell";
import {
  EditorPanel,
  EditorStepNavigation,
  PreviewPanelContent,
  filterDeviceGroups,
  findDevice,
  previewFrameDimensions,
} from "@/components/card-builder/ClientCardEditor";
import {
  getAdminTemplates,
  normalizeColourPalette,
  saveAdminTemplate,
  type SharedTemplate,
} from "@/lib/templates";
import {
  actionLabelIsConfigurable,
  cardActionDefinitions,
  defaultLabelForActionType,
  effectiveCardActionConfig,
  isStepThreeOwnedTemplateField,
  normalizeTemplateAllowedActions,
  type CardActionConfig,
  type CardActionType,
  type TemplateAllowedActions,
} from "@/lib/card-actions";
import {
  defaultLeadCaptureSettings,
  normalizeLeadCaptureSettings,
  type LeadCaptureSettings,
  type SharedClientCard,
} from "@/lib/services/card-payload";

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
  profile_image_allowed?: boolean | null;
  profile_image_default_enabled?: boolean | null;
  logo_allowed?: boolean | null;
  logo_default_enabled?: boolean | null;
  banner_allowed?: boolean | null;
  banner_default_enabled?: boolean | null;
  custom_colour_allowed?: boolean | null;
  custom_text_colour_allowed?: boolean | null;
  field_config?: TemplateFieldConfig | null;
  renderer_options?: Record<string, unknown> | null;
  template_contract_version?: number | null;
  gradient_enabled?: boolean | null;
  colour_palette?: string[] | null;
  free_colour_palette?: string[] | null;
  text_colours?: string[] | null;
  allowed_fonts?: string[] | null;
  default_font?: string | null;
  supports_bio: boolean | null;
  supports_save_contact: boolean | null;
  allowed_actions?: TemplateAllowedActions | null;
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
  | string
  | boolean
  | number
  | null
  | string[]
  | CustomFields
  | TemplateAllowedActions
  | TemplateFieldConfig
  | Record<string, unknown>
>;

type ActionPermissionDraft = {
  type: CardActionType;
  enabled: boolean;
  default_visible: boolean;
  default_label: string;
};

type TemplateBuilderStep = "setup" | "design" | "content" | "actions" | "review";
type ClientPreviewStep = 0 | 1 | 2 | 3;
type TemplateExampleValues = Partial<Record<string, string>>;

type TemplateFieldConfig = {
  version: 1;
  allowed_fields: string[];
  sections: Record<string, string[]>;
  default_visibility: Record<string, boolean>;
  required_fields: string[];
};

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
    description: "Legacy custom social details. Visitor actions are configured below.",
    fields: [],
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
  social: [],
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
];

const freeLayouts = [
  { value: "classic_free", label: "Classic Free" },
];

const paidLayouts = [
  { value: "premium_classic", label: "Premium Classic" },
  { value: "modern_minimal", label: "Modern Minimal" },
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
const defaultTextColourPalette = ["#FFFFFF", "#0F172A"];
const modernMinimalColourPalette = [
  "#FFFFFF",
  "#F8FAFC",
  "#EEF2FF",
  "#FDF2F8",
  "#ECFEFF",
  "#101935",
];
const modernMinimalTextColours = ["#101935", "#334155", "#FFFFFF"];
const modernMinimalFonts = ["Inter", "DM Sans", "Poppins", "Montserrat"];
const defaultTemplateExampleValues: TemplateExampleValues = {
  title: "",
  first_name: "Alex",
  last_name: "Carter",
  job_title: "Creative Director",
  department: "Creative Department",
  bio:
    "I help brands create meaningful digital experiences through design, strategy and technology.",
  company_name: "DevMaster Inc",
  website: "https://www.devmasterinc.com",
  address: "London, United Kingdom",
  email: "alex@devmasterinc.com",
  phone: "+44 7000 000000",
};
const defaultTemplateActionPermissions: ActionPermissionDraft[] =
  cardActionDefinitions.map((definition) => ({
    type: definition.type,
    enabled: true,
    default_visible: definition.type === "save_contact",
    default_label: definition.label,
  }));

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

const templateBuilderSteps: {
  key: TemplateBuilderStep;
  label: string;
  title: string;
}[] = [
  { key: "setup", label: "Setup", title: "Template setup" },
  { key: "design", label: "Design", title: "Design system" },
  { key: "content", label: "Content", title: "Content structure" },
  { key: "actions", label: "Actions", title: "Action buttons" },
  { key: "review", label: "Review", title: "Review template" },
];

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
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(
    null
  );
  const appliedEditTemplateIdRef = useRef<string | null>(null);
  const editTemplateRef = useRef<(template: Template) => void>(() => undefined);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateMessage, setTemplateMessage] = useState("");
  const [templateError, setTemplateError] = useState("");
  const [activeBuilderStep, setActiveBuilderStep] =
    useState<TemplateBuilderStep>("setup");
  const [clientPreviewOpen, setClientPreviewOpen] = useState(false);
  const [clientPreviewStep, setClientPreviewStep] = useState<ClientPreviewStep>(0);
  const [previewSelectedColour, setPreviewSelectedColour] = useState(
    defaultFreeColourPalette[0]
  );
  const [previewSelectedTextColour, setPreviewSelectedTextColour] = useState(
    defaultTextColourPalette[0]
  );
  const [previewSelectedFont, setPreviewSelectedFont] = useState("");
  const [previewFieldOrder, setPreviewFieldOrder] =
    useState<Required<CustomFields>>(defaultCustomFields);
  const [previewActionConfig, setPreviewActionConfig] =
    useState<CardActionConfig | null>(null);
  const [previewCardOverrides, setPreviewCardOverrides] = useState<
    Partial<SharedClientCard>
  >({});
  const [previewEditedFields, setPreviewEditedFields] = useState<string[]>([]);
  const [previewLeadSettings, setPreviewLeadSettings] =
    useState<LeadCaptureSettings>(defaultLeadCaptureSettings);

  const [name, setName] = useState("");
  const [accessLevel, setAccessLevel] = useState("free");
  const [layoutType, setLayoutType] = useState("classic_free");

  const [profileImageAllowed, setProfileImageAllowed] = useState(true);
  const [profileImageDefaultEnabled, setProfileImageDefaultEnabled] =
    useState(true);
  const [requiresProfileImage, setRequiresProfileImage] = useState(true);
  const [logoAllowed, setLogoAllowed] = useState(false);
  const [logoDefaultEnabled, setLogoDefaultEnabled] = useState(false);
  const [requiresLogo, setRequiresLogo] = useState(false);
  const [bannerAllowed, setBannerAllowed] = useState(false);
  const [bannerDefaultEnabled, setBannerDefaultEnabled] = useState(false);
  const [requiresBanner, setRequiresBanner] = useState(false);
  const [gradientEnabled, setGradientEnabled] = useState(true);
  const [customColourAllowed, setCustomColourAllowed] = useState(false);
  const [customTextColourAllowed, setCustomTextColourAllowed] = useState(false);
  const [freeColourPalette, setFreeColourPalette] = useState<string[]>(
    defaultFreeColourPalette
  );
  const [textColourPalette, setTextColourPalette] = useState<string[]>(
    defaultTextColourPalette
  );
  const [allowedFonts, setAllowedFonts] =
    useState<string[]>(defaultAllowedFonts);
  const [defaultFont, setDefaultFont] = useState("");
  const [allowedFields, setAllowedFields] = useState<string[]>(freeFields);
  const [actionPermissions, setActionPermissions] = useState<
    ActionPermissionDraft[]
  >(defaultTemplateActionPermissions);
  const [customFields, setCustomFields] =
    useState<CustomFields>(defaultCustomFields);
  const [exampleValues, setExampleValues] = useState<TemplateExampleValues>(
    defaultTemplateExampleValues
  );

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

  const layoutOptions = accessLevel === "free" ? freeLayouts : paidLayouts;

  const hydrateTemplateFromUrl = useCallback((loadedTemplates: Template[]) => {
    if (typeof window === "undefined") return;

    const editTemplateId = new URLSearchParams(window.location.search).get("edit");

    if (!editTemplateId || appliedEditTemplateIdRef.current === editTemplateId) {
      return;
    }

    const templateToEdit = loadedTemplates.find(
      (template) => template.id === editTemplateId
    );

    if (!templateToEdit) return;

    editTemplateRef.current(templateToEdit);
    appliedEditTemplateIdRef.current = editTemplateId;
  }, []);

  async function fetchTemplates() {
    try {
      const loadedTemplates = await getAdminTemplates();
      const normalizedTemplates = loadedTemplates as Template[];
      setTemplates(normalizedTemplates);
      hydrateTemplateFromUrl(normalizedTemplates);
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

        const normalizedTemplates = loadedTemplates as Template[];
        setTemplates(normalizedTemplates);
        hydrateTemplateFromUrl(normalizedTemplates);
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
  }, [hydrateTemplateFromUrl]);

  function resetBuilder() {
    setEditingTemplateId(null);
    setActiveBuilderStep("setup");
    setName("");
    setAccessLevel("free");
    setLayoutType("classic_free");
    setProfileImageAllowed(true);
    setProfileImageDefaultEnabled(true);
    setRequiresProfileImage(true);
    setLogoAllowed(false);
    setLogoDefaultEnabled(false);
    setRequiresLogo(false);
    setBannerAllowed(false);
    setBannerDefaultEnabled(false);
    setRequiresBanner(false);
    setGradientEnabled(true);
    setCustomColourAllowed(false);
    setCustomTextColourAllowed(false);
    setFreeColourPalette(defaultFreeColourPalette);
    setTextColourPalette(defaultTextColourPalette);
    setAllowedFonts(defaultAllowedFonts);
    setDefaultFont("");
    setAllowedFields(freeFields);
    setActionPermissions(defaultTemplateActionPermissions);
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
    setPreviewSelectedColour(defaultFreeColourPalette[0]);
    setPreviewSelectedTextColour(defaultTextColourPalette[0]);
    setPreviewSelectedFont("");
    setPreviewFieldOrder(defaultCustomFields);
    setPreviewActionConfig(null);
    setPreviewCardOverrides({});
    setPreviewEditedFields([]);
    setPreviewLeadSettings(defaultLeadCaptureSettings);
    setExampleValues(defaultTemplateExampleValues);
  }

  function applyAccessLevel(value: string) {
    setAccessLevel(value);

    if (value === "free") {
      setLayoutType("classic_free");
      setProfileImageAllowed(true);
      setProfileImageDefaultEnabled(true);
      setRequiresProfileImage(true);
      setLogoAllowed(false);
      setLogoDefaultEnabled(false);
      setRequiresLogo(false);
      setBannerAllowed(false);
      setBannerDefaultEnabled(false);
      setRequiresBanner(false);
      setGradientEnabled(false);
      setCustomColourAllowed(false);
      setCustomTextColourAllowed(false);
      setFreeColourPalette(defaultFreeColourPalette);
      setTextColourPalette(defaultTextColourPalette);
      setAllowedFonts(defaultAllowedFonts);
      setDefaultFont("");
      setAllowedFields(freeFields);
      setActionPermissions(defaultTemplateActionPermissions);
      setCustomFields(defaultCustomFields);
      setShowPersonalSection(true);
      setShowCompanySection(true);
      setShowContactSection(true);
      setShowSocialSection(false);
      setPreviewSelectedColour(defaultFreeColourPalette[0]);
      setPreviewSelectedTextColour(defaultTextColourPalette[0]);
      setPreviewSelectedFont("");
      setPreviewFieldOrder(defaultCustomFields);
      setPreviewActionConfig(null);
      setPreviewCardOverrides({});
      setPreviewEditedFields([]);
      setPreviewLeadSettings(defaultLeadCaptureSettings);
      setExampleValues(defaultTemplateExampleValues);
    }

    if (value === "paid") {
      setLayoutType("premium_classic");
      setProfileImageAllowed(true);
      setProfileImageDefaultEnabled(true);
      setRequiresProfileImage(true);
      setLogoAllowed(true);
      setLogoDefaultEnabled(true);
      setRequiresLogo(true);
      setBannerAllowed(true);
      setBannerDefaultEnabled(true);
      setRequiresBanner(true);
      setGradientEnabled(true);
      setCustomColourAllowed(true);
      setCustomTextColourAllowed(true);
      setAllowedFonts([...fontChoices]);
      setDefaultFont("");
      setAllowedFields(paidFields);
      setActionPermissions(defaultTemplateActionPermissions);
      setCustomFields(defaultCustomFields);
      setShowPersonalSection(true);
      setShowCompanySection(true);
      setShowContactSection(true);
      setShowSocialSection(false);
      setPreviewSelectedColour(defaultFreeColourPalette[0]);
      setPreviewSelectedTextColour(defaultTextColourPalette[0]);
      setPreviewSelectedFont("");
      setPreviewFieldOrder(defaultCustomFields);
      setPreviewActionConfig(null);
      setPreviewCardOverrides({});
      setPreviewEditedFields([]);
      setPreviewLeadSettings(defaultLeadCaptureSettings);
      setExampleValues(defaultTemplateExampleValues);
    }
  }

  function actionPermissionsForTypes(
    allowedTypes: CardActionType[],
    defaultTypes: CardActionType[]
  ): ActionPermissionDraft[] {
    return cardActionDefinitions.map((definition) => {
      const enabled = allowedTypes.includes(definition.type);

      return {
        type: definition.type,
        enabled,
        default_visible: enabled && defaultTypes.includes(definition.type),
        default_label: definition.label,
      };
    });
  }

  function applyPaidLayoutDefaults(nextLayoutType: string) {
    setLayoutType(nextLayoutType);

    if (nextLayoutType !== "modern_minimal") return;

    setProfileImageAllowed(false);
    setProfileImageDefaultEnabled(false);
    setRequiresProfileImage(false);
    setLogoAllowed(true);
    setLogoDefaultEnabled(true);
    setRequiresLogo(false);
    setBannerAllowed(false);
    setBannerDefaultEnabled(false);
    setRequiresBanner(false);
    setGradientEnabled(false);
    setCustomColourAllowed(true);
    setCustomTextColourAllowed(true);
    setFreeColourPalette(modernMinimalColourPalette);
    setTextColourPalette(modernMinimalTextColours);
    setAllowedFonts(modernMinimalFonts);
    setDefaultFont("DM Sans");
    setPrimaryColor("#FFFFFF");
    setSecondaryColor("#F8FAFC");
    setTextColor("#101935");
    setButtonColor("#F8FAFC");
    setButtonTextColor("#101935");
    setAllowedFields(paidFields);
    setCustomFields(defaultCustomFields);
    setPreviewFieldOrder(defaultCustomFields);
    setPreviewSelectedColour(modernMinimalColourPalette[0]);
    setPreviewSelectedTextColour(modernMinimalTextColours[0]);
    setPreviewSelectedFont("DM Sans");
    setActionPermissions(
      actionPermissionsForTypes(
        ["save_contact", "email", "linkedin", "custom_link", "call"],
        ["save_contact", "email", "linkedin"]
      )
    );
    setPreviewActionConfig(null);
    setPreviewCardOverrides({});
    setPreviewEditedFields([]);
    setExampleValues(defaultTemplateExampleValues);
  }

  function toggleAllowedField(field: string) {
    if (isStepThreeOwnedTemplateField(field)) return;

    if (allowedFields.includes(field)) {
      setAllowedFields(allowedFields.filter((item) => item !== field));
    } else {
      setAllowedFields([...allowedFields, field]);
    }
  }

  function toggleActionPermission(type: CardActionType) {
    setPreviewActionConfig(null);
    setActionPermissions((current) =>
      current.map((action) =>
        action.type === type
          ? {
              ...action,
              enabled: !action.enabled,
              default_visible: action.enabled ? false : action.default_visible,
            }
          : action
      )
    );
  }

  function toggleActionDefault(type: CardActionType) {
    setPreviewActionConfig(null);
    setActionPermissions((current) =>
      current.map((action) =>
        action.type === type && action.enabled
          ? { ...action, default_visible: !action.default_visible }
          : action
      )
    );
  }

  function updateActionDefaultLabel(type: CardActionType, label: string) {
    setPreviewActionConfig(null);
    setActionPermissions((current) =>
      current.map((action) =>
        action.type === type ? { ...action, default_label: label } : action
      )
    );
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

  function updateExampleValue(field: string, value: string) {
    setExampleValues((current) => ({
      ...current,
      [field]: value,
    }));
    setPreviewCardOverrides({});
    setPreviewEditedFields([]);
  }

  function updateFreePaletteColour(index: number, value: string) {
    setFreeColourPalette((current) =>
      sanitizeFreeColourPalette(current).map((colour, colourIndex) =>
        colourIndex === index ? value : colour
      )
    );
  }

  function updateTextPaletteColour(index: number, value: string) {
    setTextColourPalette((current) =>
      sanitizeFreeColourPalette(current).map((colour, colourIndex) =>
        colourIndex === index ? value : colour
      )
    );
  }

  function updateDefaultSolidColour(value: string) {
    setPrimaryColor(value);

    if (accessLevel === "paid") {
      setPreviewSelectedColour(value);
    }
  }

  function updateDefaultTextColour(value: string) {
    setTextColor(value);

    if (accessLevel === "paid") {
      setPreviewSelectedTextColour(value);
    }
  }

  function addFreePaletteColour() {
    setFreeColourPalette((current) => {
      const palette = sanitizeFreeColourPalette(current);

      if (palette.length >= 6) return palette;

      return [...palette, "#AC00FF"];
    });
  }

  function addTextPaletteColour() {
    setTextColourPalette((current) => {
      const palette = sanitizeFreeColourPalette(current);

      if (palette.length >= 6) return palette;

      return [...palette, "#0F172A"];
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

  function removeTextPaletteColour(index: number) {
    setTextColourPalette((current) => {
      const palette = sanitizeFreeColourPalette(current).filter(
        (_, colourIndex) => colourIndex !== index
      );

      return palette.length ? palette : defaultTextColourPalette;
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
    setActiveBuilderStep("setup");
    setProfileImageAllowed(template.profile_image_allowed ?? true);
    setProfileImageDefaultEnabled(
      template.profile_image_default_enabled ??
        (template.requires_profile_image ?? true)
    );
    setRequiresProfileImage(template.requires_profile_image ?? true);
    setLogoAllowed(
      normalizedAccessLevel === "paid" &&
        (template.logo_allowed ?? template.requires_logo ?? false)
    );
    setLogoDefaultEnabled(
      normalizedAccessLevel === "paid" &&
        (template.logo_default_enabled ?? template.requires_logo ?? false)
    );
    setRequiresLogo(
      normalizedAccessLevel === "paid" && (template.requires_logo ?? false)
    );
    setBannerAllowed(
      normalizedAccessLevel === "paid" &&
        (template.banner_allowed ?? template.requires_banner ?? false)
    );
    setBannerDefaultEnabled(
      normalizedAccessLevel === "paid" &&
        (template.banner_default_enabled ?? template.requires_banner ?? false)
    );
    setRequiresBanner(
      normalizedAccessLevel === "paid" && (template.requires_banner ?? false)
    );
    setGradientEnabled(template.gradient_enabled ?? normalizedAccessLevel === "paid");
    setCustomColourAllowed(
      template.custom_colour_allowed ?? normalizedAccessLevel === "paid"
    );
    setCustomTextColourAllowed(
      template.custom_text_colour_allowed ?? normalizedAccessLevel === "paid"
    );
    setFreeColourPalette(
      sanitizeFreeColourPalette(template.free_colour_palette)
    );
    setTextColourPalette(
      sanitizeTextColourPalette(template.text_colours, template.text_color)
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
    setAllowedFields(sanitizeAllowedFields(template.allowed_fields || freeFields));
    setActionPermissions(actionPermissionsFromTemplate(template));
    const normalizedCustomFields = normalizeCustomFields(template.custom_fields);
    setCustomFields(normalizedCustomFields);
    setPreviewFieldOrder(normalizedCustomFields);
    setPrimaryColor(template.primary_color || "#AC00FF");
    setSecondaryColor(template.secondary_color || "#101935");
    setTextColor(template.text_color || "#FFFFFF");
    setButtonColor(template.button_color || "#FFFFFF");
    setButtonTextColor(template.button_text_color || "#0F0E38");
    setShowPersonalSection(template.show_personal_section ?? true);
    setShowCompanySection(template.show_company_section ?? true);
    setShowContactSection(template.show_contact_section ?? true);
    setShowSocialSection(template.show_social_section ?? false);
    setPreviewSelectedColour(
      normalizedAccessLevel === "paid"
        ? template.primary_color || "#AC00FF"
        : sanitizeFreeColourPalette(template.free_colour_palette)[0] || "#AC00FF"
    );
    setPreviewSelectedTextColour(
      normalizedAccessLevel === "paid"
        ? template.text_color || "#FFFFFF"
        : sanitizeTextColourPalette(template.text_colours, template.text_color)[0] ||
            "#FFFFFF"
    );
    setPreviewSelectedFont(
      template.default_font && normalizedAllowedFonts.includes(template.default_font)
        ? template.default_font
        : ""
    );
    setExampleValues(
      readTemplateExampleValues(template.renderer_options, defaultTemplateExampleValues)
    );
    setPreviewActionConfig(null);
    setPreviewCardOverrides({});
    setPreviewEditedFields([]);
    setPreviewLeadSettings(defaultLeadCaptureSettings);

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  useEffect(() => {
    editTemplateRef.current = editTemplate;
  });

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
      text_colours: sanitizeTextColourPalette(textColourPalette, textColor),
      requires_profile_image: requiresProfileImage,
      requires_logo: accessLevel === "paid" && requiresLogo,
      requires_banner: accessLevel === "paid" && requiresBanner,
      profile_image_allowed: profileImageAllowed,
      profile_image_default_enabled: profileImageDefaultEnabled,
      logo_allowed: accessLevel === "paid" && logoAllowed,
      logo_default_enabled: accessLevel === "paid" && logoDefaultEnabled,
      banner_allowed: accessLevel === "paid" && bannerAllowed,
      banner_default_enabled: accessLevel === "paid" && bannerDefaultEnabled,
      custom_colour_allowed: customColourAllowed,
      custom_text_colour_allowed: customTextColourAllowed,
      gradient_enabled: accessLevel === "paid" && gradientEnabled,
      free_colour_palette: sanitizeFreeColourPalette(freeColourPalette),
      allowed_fonts:
        accessLevel === "paid" ? sanitizeTemplateFonts(allowedFonts) : defaultAllowedFonts,
      default_font: accessLevel === "paid" ? defaultFont || null : "Inter",
      allowed_fields: allowedFields,
      allowed_actions: buildTemplateAllowedActions(actionPermissions),
      custom_fields: customFields,
      field_config: buildTemplateFieldConfig(allowedFields, customFields),
      renderer_options: buildTemplateRendererOptions(
        layoutType,
        exampleValues,
        primaryColor,
        secondaryColor
      ),
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

  const activeStepIndex = Math.max(
    0,
    templateBuilderSteps.findIndex((step) => step.key === activeBuilderStep)
  );
  const currentEditingTemplate = templates.find(
    (template) => template.id === editingTemplateId
  );
  const currentPublicationStatus = currentEditingTemplate?.is_published
    ? "Published"
    : "Draft";
  const enabledSections = sectionFieldGroups
    .filter((section) => sectionState(section.key).enabled)
    .map((section) => section.title);
  const allowedActionCount = actionPermissions.filter((action) => action.enabled).length;
  const defaultActionCount = actionPermissions.filter(
    (action) => action.enabled && action.default_visible
  ).length;
  const availablePreviewColours = sanitizeFreeColourPalette(freeColourPalette);
  const availablePreviewTextColours = sanitizeTextColourPalette(
    textColourPalette,
    textColor
  );
  const effectivePreviewSelectedColour =
    accessLevel === "paid"
      ? previewSelectedColour || primaryColor
      : availablePreviewColours.includes(previewSelectedColour)
      ? previewSelectedColour
      : availablePreviewColours[0] || "#AC00FF";
  const effectivePreviewSelectedTextColour =
    accessLevel === "paid"
      ? previewSelectedTextColour || textColor
      : availablePreviewTextColours.includes(previewSelectedTextColour)
      ? previewSelectedTextColour
      : availablePreviewTextColours[0] || "#FFFFFF";
  const availablePreviewFonts =
    accessLevel === "paid"
      ? sanitizeTemplateFonts(allowedFonts)
      : defaultAllowedFonts;
  const effectivePreviewSelectedFont = availablePreviewFonts.includes(
    previewSelectedFont
  )
    ? previewSelectedFont
    : defaultFont || availablePreviewFonts[0] || "Inter";
  const previewProfileImageEnabled =
    profileImageAllowed && (requiresProfileImage || profileImageDefaultEnabled);
  const previewLogoEnabled =
    accessLevel === "paid" && logoAllowed && (requiresLogo || logoDefaultEnabled);
  const previewBannerEnabled =
    accessLevel === "paid" &&
    bannerAllowed &&
    (requiresBanner || bannerDefaultEnabled);
  const effectiveExampleValues = useMemo(
    () => sanitizeTemplateExampleValues(exampleValues),
    [exampleValues]
  );
  const previewTemplate = useMemo(
    () => ({
      id: editingTemplateId || "admin-preview-template",
      name: name || "Admin Preview Template",
      slug: "admin-preview-template",
      status: "draft" as const,
      is_published: false,
      layout_type: layoutType,
      logo_size: "standard",
      access_level: accessLevel,
      requires_profile_image: previewProfileImageEnabled,
      requires_logo: previewLogoEnabled,
      requires_banner: previewBannerEnabled,
      profile_image_allowed: profileImageAllowed,
      profile_image_default_enabled: profileImageDefaultEnabled,
      logo_allowed: accessLevel === "paid" && logoAllowed,
      logo_default_enabled: accessLevel === "paid" && logoDefaultEnabled,
      banner_allowed: accessLevel === "paid" && bannerAllowed,
      banner_default_enabled: accessLevel === "paid" && bannerDefaultEnabled,
      custom_colour_allowed: customColourAllowed,
      custom_text_colour_allowed: customTextColourAllowed,
      gradient_enabled: accessLevel === "paid" && gradientEnabled,
      free_colour_palette: sanitizeFreeColourPalette(freeColourPalette),
      text_colours: sanitizeTextColourPalette(textColourPalette, textColor),
      allowed_fonts:
        accessLevel === "paid"
          ? sanitizeTemplateFonts(allowedFonts)
          : defaultAllowedFonts,
      default_font: accessLevel === "paid" ? defaultFont || null : "Inter",
      supports_bio: true,
      supports_save_contact: actionPermissionEnabled(
        actionPermissions,
        "save_contact"
      ),
      allowed_fields: allowedFields,
      allowed_actions: buildTemplateAllowedActions(actionPermissions),
      custom_fields: customFields,
      primary_color: primaryColor,
      secondary_color: secondaryColor,
      text_color: textColor,
      button_color: buttonColor,
      button_text_color: buttonTextColor,
      renderer_options: buildTemplateRendererOptions(
        layoutType,
        effectiveExampleValues,
        primaryColor,
        secondaryColor
      ),
      show_personal_section: showPersonalSection,
      show_company_section: showCompanySection,
      show_contact_section: showContactSection,
      show_social_section: showSocialSection,
    }),
    [
      accessLevel,
      actionPermissions,
      allowedFields,
      allowedFonts,
      buttonColor,
      buttonTextColor,
      bannerAllowed,
      bannerDefaultEnabled,
      customFields,
      customColourAllowed,
      customTextColourAllowed,
      defaultFont,
      editingTemplateId,
      effectiveExampleValues,
      freeColourPalette,
      gradientEnabled,
      layoutType,
      logoAllowed,
      logoDefaultEnabled,
      name,
      primaryColor,
      profileImageAllowed,
      profileImageDefaultEnabled,
      previewBannerEnabled,
      previewLogoEnabled,
      previewProfileImageEnabled,
      secondaryColor,
      showCompanySection,
      showContactSection,
      showPersonalSection,
      showSocialSection,
      textColor,
      textColourPalette,
    ]
  );
  const previewClientTemplate = {
    ...previewTemplate,
    default_font:
      accessLevel === "paid"
        ? effectivePreviewSelectedFont || defaultFont || null
        : effectivePreviewSelectedFont || "Inter",
  };
  const previewCardData = {
    title: effectiveExampleValues.title || "",
    first_name: effectiveExampleValues.first_name || "Alex",
    last_name: effectiveExampleValues.last_name || "Carter",
    full_name:
      [effectiveExampleValues.title, effectiveExampleValues.first_name, effectiveExampleValues.last_name]
        .filter(Boolean)
        .join(" ") || "Alex Carter",
    job_title: effectiveExampleValues.job_title || "Creative Director",
    bio: effectiveExampleValues.bio || defaultTemplateExampleValues.bio,
    company_name: effectiveExampleValues.company_name || "DevMaster Inc",
    company_logo_url: previewLogoEnabled ? "/logo.png" : null,
    company_banner_url: previewBannerEnabled ? "" : null,
    department: effectiveExampleValues.department || "Creative Department",
    email: effectiveExampleValues.email || "alex@devmasterinc.com",
    phone: effectiveExampleValues.phone || "+44 7000 000000",
    website: effectiveExampleValues.website || "https://www.devmasterinc.com",
    address: effectiveExampleValues.address || "London, United Kingdom",
    whatsapp: "+44 7000 000000",
    linkedin: "linkedin.com/company/devmasterinc",
    instagram: "@devmasterinc",
    facebook: "facebook.com/devmasterinc",
    youtube: "youtube.com/@devmasterinc",
    booking_link: "devmasterinc.com/book",
    custom_url: "devmasterinc.com",
    selected_colour: effectivePreviewSelectedColour,
    selected_text_colour: effectivePreviewSelectedTextColour,
    selected_background_mode:
      accessLevel === "paid" && gradientEnabled ? "gradient" : "solid",
    selected_gradient_start: primaryColor,
    selected_gradient_end: secondaryColor,
    action_config: effectiveCardActionConfig(
      { action_config: null, field_visibility: {}, hidden_fields: [] },
      previewTemplate
    ),
    hidden_fields: [],
    field_visibility: {},
    custom_fields: previewCustomFieldValues(customFields),
  };
  const clientExampleFields = Object.keys(effectiveExampleValues).filter(
    (field) => !previewEditedFields.includes(field)
  );
  const clientExperienceCardData: SharedClientCard = {
    id: "admin-client-preview-card",
    card_name: previewCardOverrides.card_name || "Primary Digital Card",
    template_id: previewClientTemplate.id,
    template_name: previewClientTemplate.name,
    status: "unpublished",
    public_url: "/u/admin-client-preview",
    last_updated: "Preview only",
    card_slot: 1,
    ...previewCardData,
    ...previewCardOverrides,
    selected_colour: effectivePreviewSelectedColour,
    selected_text_colour: effectivePreviewSelectedTextColour,
    selected_background_mode:
      previewCardOverrides.selected_background_mode ||
      previewCardData.selected_background_mode,
    selected_gradient_start:
      previewCardOverrides.selected_gradient_start ||
      previewCardData.selected_gradient_start,
    selected_gradient_end:
      previewCardOverrides.selected_gradient_end ||
      previewCardData.selected_gradient_end,
    example_fields: clientExampleFields,
    action_config:
      previewActionConfig ||
      effectiveCardActionConfig(
        { action_config: null, field_visibility: {}, hidden_fields: [] },
        previewTemplate
      ),
    custom_fields: previewCustomFieldValues(previewFieldOrder),
    field_order: previewFieldOrder,
    lead_capture_settings: previewLeadSettings,
  };

  function updatePreviewCard(field: keyof SharedClientCard, value: string) {
    if (field === "selected_colour") {
      setPreviewSelectedColour(value);
    }

    if (field === "selected_text_colour") {
      setPreviewSelectedTextColour(value);
    }

    if (field in defaultTemplateExampleValues) {
      setPreviewEditedFields((current) =>
        current.includes(field) ? current : [...current, String(field)]
      );
    }

    setPreviewCardOverrides((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function updatePreviewCustomField(field: string, value: string) {
    setPreviewCardOverrides((current) => ({
      ...current,
      custom_fields: {
        ...(current.custom_fields || clientExperienceCardData.custom_fields || {}),
        [field]: value,
      },
    }));
  }

  function togglePreviewFieldVisibility(field: string) {
    const visibilityKey = field;
    setPreviewCardOverrides((current) => {
      const hiddenFields = new Set(current.hidden_fields || []);
      const isHidden = hiddenFields.has(visibilityKey);

      if (isHidden) {
        hiddenFields.delete(visibilityKey);
      } else {
        hiddenFields.add(visibilityKey);
      }

      return {
        ...current,
        hidden_fields: Array.from(hiddenFields),
        field_visibility: {
          ...(current.field_visibility || {}),
          [visibilityKey]: isHidden,
        },
      };
    });
  }

  function movePreviewField(
    section: SectionKey,
    draggedField: string,
    targetField: string,
    position: "before" | "after" = "before"
  ) {
    setPreviewFieldOrder((current) => {
      const fields = [...current[section]];
      const fromIndex = fields.indexOf(draggedField);
      const toIndex = fields.indexOf(targetField);

      if (fromIndex < 0 || toIndex < 0 || draggedField === targetField) {
        return current;
      }

      const [moved] = fields.splice(fromIndex, 1);
      const adjustedIndex =
        position === "after"
          ? fields.indexOf(targetField) + 1
          : fields.indexOf(targetField);
      fields.splice(Math.max(0, adjustedIndex), 0, moved);

      return { ...current, [section]: fields };
    });
  }

  function goToBuilderStep(index: number) {
    const step = templateBuilderSteps[index];
    if (!step) return;

    setActiveBuilderStep(step.key);
  }

  function renderBuilderStep() {
    if (activeBuilderStep === "setup") {
      return (
        <StepPanel
          title="Setup"
          description="Name the template, choose who can use it, and define media capabilities."
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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
                onChange={(e) => applyPaidLayoutDefaults(e.target.value)}
                className="inputStyle"
              >
                {layoutOptions.map((layout) => (
                  <option key={layout.value} value={layout.value}>
                    {layout.label}
                  </option>
                ))}
              </select>
            </Field>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <span className="mb-2 block text-sm font-medium text-white/55">
                Publication
              </span>
              <p className="text-sm font-semibold text-white">
                {currentPublicationStatus}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-white/45">
                Save changes from Review. Publishing controls remain explicit
                on saved templates.
              </p>
            </div>
          </div>

          <div className="mt-6 rounded-3xl border border-white/10 bg-[#101935]/50 p-5 shadow-[0_22px_70px_rgba(0,0,0,0.24)]">
            <div>
              <h3 className="text-lg font-semibold">Images &amp; Branding</h3>
              <p className="mt-1 text-sm text-white/45">
                Choose which media elements are available for clients to use.
              </p>
            </div>

            <div className="mt-5 space-y-3">
              <MediaCapabilityRow
                title="Profile Picture"
                description="Allow clients to upload a profile photo. Clients can choose to show or hide it."
                enabled={profileImageAllowed}
                disabled={false}
                onEnabledChange={(value) => {
                  setProfileImageAllowed(value);
                  setRequiresProfileImage(false);
                  setProfileImageDefaultEnabled(value);
                }}
              />
              <MediaCapabilityRow
                title="Company Logo"
                description="Allow clients to upload a company logo. Modern Minimal displays it as a watermark."
                disabled={accessLevel !== "paid"}
                enabled={accessLevel === "paid" && logoAllowed}
                onEnabledChange={(value) => {
                  setLogoAllowed(value);
                  setRequiresLogo(false);
                  setLogoDefaultEnabled(value);
                }}
              />
              <MediaCapabilityRow
                title="Banner Image"
                description="Allow clients to upload a banner image. Clients can choose to show or hide it."
                disabled={accessLevel !== "paid"}
                enabled={accessLevel === "paid" && bannerAllowed}
                onEnabledChange={(value) => {
                  setBannerAllowed(value);
                  setRequiresBanner(false);
                  setBannerDefaultEnabled(value);
                }}
              />
            </div>

            <div className="mt-5 rounded-2xl border border-[#AC00FF]/15 bg-[#AC00FF]/10 px-4 py-3 text-xs leading-5 text-purple-100/80">
              These settings only control whether media options are available.
              Clients control visibility for enabled media on each card they create.
            </div>
          </div>
        </StepPanel>
      );
    }

    if (activeBuilderStep === "design") {
      return (
        <StepPanel
          title="Design"
          description={
            accessLevel === "paid"
              ? "Set paid template startup colours and typography. Clients can choose any branding colours later."
              : "Configure approved colour choices and typography for this free template."
          }
        >
          {accessLevel === "free" ? (
            <>
              <div className="grid gap-4 md:grid-cols-2">
                <ContractToggle
                  label="Custom card colours"
                  description="Free templates remain restricted unless this legacy flag is enabled."
                  enabled={customColourAllowed}
                  onToggle={setCustomColourAllowed}
                />
                <ContractToggle
                  label="Custom text colours"
                  description="Free templates remain restricted unless this legacy flag is enabled."
                  enabled={customTextColourAllowed}
                  onToggle={setCustomTextColourAllowed}
                />
              </div>

              <ColourPalette
                title="Predefined Colour Choices"
                description="Approved card colour choices. The first colour remains the default background."
                colours={freeColourPalette}
                addLabel="Add Colour"
                itemLabel="Colour"
                onChange={updateFreePaletteColour}
                onAdd={addFreePaletteColour}
                onRemove={removeFreePaletteColour}
              />
              <ColourPalette
                title="Text Colour Options"
                description="Approved text colours for card name and main card text."
                colours={textColourPalette}
                addLabel="Add Text Colour"
                itemLabel="Text"
                onChange={updateTextPaletteColour}
                onAdd={addTextPaletteColour}
                onRemove={removeTextPaletteColour}
              />
            </>
          ) : (
            <>
              <div className="rounded-3xl border border-white/10 bg-white/[0.045] p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="text-lg font-semibold">Paid Colour Defaults</h3>
                    <p className="mt-1 text-sm text-white/45">
                      These values seed new cards only. Paid clients can choose any
                      solid, gradient and text colours in the Client Builder.
                    </p>
                  </div>
                  <select
                    value={gradientEnabled ? "gradient" : "solid"}
                    onChange={(event) =>
                      setGradientEnabled(event.target.value === "gradient")
                    }
                    className="inputStyle min-w-[12rem]"
                    aria-label="Default background mode"
                  >
                    <option value="solid">Default solid</option>
                    <option value="gradient">Default gradient</option>
                  </select>
                </div>

                <div className="mt-5 grid gap-4 lg:grid-cols-2">
                  <ColourPicker
                    label="Default solid colour"
                    value={primaryColor}
                    onChange={updateDefaultSolidColour}
                    helperText="Also used as gradient colour 1."
                    className="[--dmi-surface-soft:rgba(255,255,255,0.05)] [--dmi-surface:rgba(255,255,255,0.08)] [--dmi-border:rgba(255,255,255,0.12)] [--input-bg:#101935] [--input-border:rgba(255,255,255,0.12)] [--input-text:#FFFFFF] [--text-primary:#FFFFFF] [--text-secondary:rgba(255,255,255,0.55)]"
                  />
                  <ColourPicker
                    label="Default gradient colour 2"
                    value={secondaryColor}
                    onChange={setSecondaryColor}
                    className="[--dmi-surface-soft:rgba(255,255,255,0.05)] [--dmi-surface:rgba(255,255,255,0.08)] [--dmi-border:rgba(255,255,255,0.12)] [--input-bg:#101935] [--input-border:rgba(255,255,255,0.12)] [--input-text:#FFFFFF] [--text-primary:#FFFFFF] [--text-secondary:rgba(255,255,255,0.55)]"
                  />
                  <ColourPicker
                    label="Default text colour"
                    value={textColor}
                    onChange={updateDefaultTextColour}
                    className="[--dmi-surface-soft:rgba(255,255,255,0.05)] [--dmi-surface:rgba(255,255,255,0.08)] [--dmi-border:rgba(255,255,255,0.12)] [--input-bg:#101935] [--input-border:rgba(255,255,255,0.12)] [--input-text:#FFFFFF] [--text-primary:#FFFFFF] [--text-secondary:rgba(255,255,255,0.55)]"
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
        </StepPanel>
      );
    }

    if (activeBuilderStep === "content") {
      return (
        <StepPanel
          title="Content"
          description="Configure the profile header and the card sections that clients can fill in."
        >
          <div className="space-y-4">
            <CardHeaderControl
              fields={cardHeaderFields}
              allowedFields={allowedFields}
              exampleValues={effectiveExampleValues}
              onToggleField={toggleAllowedField}
              onUpdateExampleValue={updateExampleValue}
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
                  exampleValues={effectiveExampleValues}
                  onToggleSection={() => onChange(!enabled)}
                  onToggleField={toggleAllowedField}
                  onUpdateExampleValue={updateExampleValue}
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
        </StepPanel>
      );
    }

    if (activeBuilderStep === "actions") {
      return (
        <StepPanel
          title="Actions"
          description="Choose the action buttons available to clients and the defaults for new cards."
        >
          <ActionButtonsControl
            actions={actionPermissions}
            onToggleAction={toggleActionPermission}
            onToggleDefault={toggleActionDefault}
            onUpdateDefaultLabel={updateActionDefaultLabel}
          />
        </StepPanel>
      );
    }

    return (
      <StepPanel
        title="Review"
        description="Check the template contract and visual preview before saving."
      >
        <div className="grid gap-4 xl:grid-cols-2">
          <ReviewCard
            title="Setup"
            items={[
              ["Template", name || "Untitled template"],
              ["Access", accessLevel === "free" ? "Free" : "Paid"],
              [
                "Layout",
                layoutOptions.find((layout) => layout.value === layoutType)?.label ||
                  layoutType,
              ],
              ["Status", currentPublicationStatus],
            ]}
          />
          <ReviewCard
            title="Media"
            items={[
              [
                "Profile picture",
                mediaSummary(
                  profileImageAllowed,
                  requiresProfileImage,
                  profileImageDefaultEnabled
                ),
              ],
              [
                "Company logo",
                mediaSummary(
                  accessLevel === "paid" && logoAllowed,
                  accessLevel === "paid" && requiresLogo,
                  accessLevel === "paid" && logoDefaultEnabled
                ),
              ],
              [
                "Company banner",
                mediaSummary(
                  accessLevel === "paid" && bannerAllowed,
                  accessLevel === "paid" && requiresBanner,
                  accessLevel === "paid" && bannerDefaultEnabled
                ),
              ],
            ]}
          />
          <ReviewCard
            title="Design"
            items={[
              accessLevel === "paid"
                ? ["Default background", gradientEnabled ? "Gradient" : "Solid"]
                : ["Colours", `${sanitizeFreeColourPalette(freeColourPalette).length} predefined`],
              accessLevel === "paid"
                ? ["Default solid", primaryColor]
                : [
                    "Text colours",
                    `${sanitizeTextColourPalette(textColourPalette, textColor).length} options`,
                  ],
              accessLevel === "paid"
                ? ["Default text", textColor]
                : ["Custom colours", customColourAllowed ? "Allowed" : "Not allowed"],
              accessLevel === "paid"
                ? ["Paid client colours", "Unrestricted"]
                : [
                    "Custom text colours",
                    customTextColourAllowed ? "Allowed" : "Not allowed",
                  ],
              [
                "Typography",
                `${sanitizeTemplateFonts(allowedFonts).length} fonts · ${
                  defaultFont || "No custom default"
                }`,
              ],
            ]}
          />
          <ReviewCard
            title="Content"
            items={[
              ["Sections", enabledSections.length ? enabledSections.join(", ") : "None"],
              ["Fields", `${sanitizeAllowedFields(allowedFields).length} allowed`],
              ["Field defaults", "Stored in contract metadata; client behavior unchanged"],
            ]}
          />
          <ReviewCard
            title="Actions"
            items={[
              ["Allowed actions", String(allowedActionCount)],
              ["Default visible", String(defaultActionCount)],
              ["Download PDF", "Catalogue only; upload/storage not enabled yet"],
            ]}
          />
        </div>
      </StepPanel>
    );
  }

  return (
    <main className="flex min-h-screen bg-[#070B1A] text-white">
      <Sidebar />

      <section className="flex-1 p-10">
        <div className="mb-8">
          <h1 className="text-4xl font-bold">Template Builder</h1>
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

            <TemplateStepNavigation
              steps={templateBuilderSteps}
              activeStep={activeBuilderStep}
              onStepChange={setActiveBuilderStep}
            />

            {renderBuilderStep()}

            <div className="mt-8 flex flex-col gap-3 border-t border-white/10 pt-5 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                onClick={() => goToBuilderStep(activeStepIndex - 1)}
                disabled={activeStepIndex === 0}
                className="rounded-2xl bg-white/10 px-5 py-3 text-sm font-medium transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Back
              </button>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                {activeBuilderStep !== "review" && (
                  <button
                    type="button"
                    onClick={() => goToBuilderStep(activeStepIndex + 1)}
                    className="rounded-2xl bg-white/10 px-5 py-3 text-sm font-medium transition hover:bg-white/15"
                  >
                    Next
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => void saveTemplate()}
                  disabled={savingTemplate}
                  className="rounded-2xl bg-[#AC00FF] px-6 py-3 font-medium transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {savingTemplate
                    ? "Saving..."
                    : editingTemplateId
                    ? "Save Changes"
                    : "Create Template"}
                </button>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-[0_28px_90px_rgba(0,0,0,0.24)] lg:sticky lg:top-6 lg:self-start">
            <div className="mb-6">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div>
                  <h2 className="text-2xl font-semibold">Live Preview</h2>
                  <p className="mt-1 text-sm text-white/45">
                    Current Admin draft rendered by the existing CardRenderer.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setPreviewFieldOrder(normalizeCustomFields(customFields));
                    setPreviewActionConfig(null);
                    setClientPreviewOpen(true);
                  }}
                  className="rounded-2xl border border-[#AC00FF]/35 bg-[#AC00FF]/15 px-4 py-2.5 text-sm font-semibold text-purple-100 transition hover:border-[#AC00FF]/60 hover:bg-[#AC00FF]/25 focus:outline-none focus:ring-2 focus:ring-[#AC00FF]/60"
                >
                  Preview Client Experience
                </button>
              </div>
            </div>

            <AdminLivePhonePreview
              template={previewTemplate}
              cardData={previewCardData}
            />

            {clientPreviewOpen && (
              <ClientExperiencePreview
                step={clientPreviewStep}
                onStepChange={setClientPreviewStep}
                onClose={() => setClientPreviewOpen(false)}
                template={previewClientTemplate}
                cardData={clientExperienceCardData}
                fieldOrder={previewFieldOrder}
                onActionConfigChange={setPreviewActionConfig}
                onUpdateCard={updatePreviewCard}
                onUpdateCustomField={updatePreviewCustomField}
                onToggleFieldVisibility={togglePreviewFieldVisibility}
                onMoveField={movePreviewField}
                leadSettings={previewLeadSettings}
                onLeadSettingsChange={setPreviewLeadSettings}
                onSelectFont={setPreviewSelectedFont}
              />
            )}
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

function ClientExperiencePreview({
  step,
  onStepChange,
  onClose,
  template,
  cardData,
  fieldOrder,
  onActionConfigChange,
  onUpdateCard,
  onUpdateCustomField,
  onToggleFieldVisibility,
  onMoveField,
  leadSettings,
  onLeadSettingsChange,
  onSelectFont,
}: {
  step: ClientPreviewStep;
  onStepChange: (step: ClientPreviewStep) => void;
  onClose: () => void;
  template: SharedTemplate;
  cardData: SharedClientCard;
  fieldOrder: Required<CustomFields>;
  onActionConfigChange: (config: CardActionConfig) => void;
  onUpdateCard: (field: keyof SharedClientCard, value: string) => void;
  onUpdateCustomField: (field: string, value: string) => void;
  onToggleFieldVisibility: (field: string) => void;
  onMoveField: (
    section: SectionKey,
    draggedField: string,
    targetField: string,
    position?: "before" | "after"
  ) => void;
  leadSettings: LeadCaptureSettings;
  onLeadSettingsChange: (settings: LeadCaptureSettings) => void;
  onSelectFont: (font: string) => void;
}) {
  const [devicePreview, setDevicePreview] = useState("iphone_15");
  const [deviceSearch, setDeviceSearch] = useState("");
  const [devicePickerOpen, setDevicePickerOpen] = useState(false);
  const [stepFourPreviewMode, setStepFourPreviewMode] =
    useState<"card" | "lead_form">("card");

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const selectedDevice = findDevice(devicePreview as Parameters<typeof findDevice>[0]);
  const filteredDeviceGroups = filterDeviceGroups(deviceSearch);
  const previewDimensions = previewFrameDimensions(selectedDevice);
  const previewTemplate = {
    ...template,
    custom_fields: fieldOrder,
  };

  return (
    <CardEditorModalShell
      title="Client Experience Preview"
      description={`Previewing ${template.name || "current Admin draft"} with local sample data.`}
      ariaLabel="Client experience preview"
      actionBar={
        <EditorStepNavigation
          activeStep={step}
          saveStatus="idle"
          onBack={() => onStepChange(Math.max(0, step - 1) as ClientPreviewStep)}
          onNext={() => onStepChange(Math.min(3, step + 1) as ClientPreviewStep)}
          onPublish={onClose}
          publishLabel="Preview Complete"
        />
      }
      onClose={onClose}
    >
      <div className="grid gap-5 min-[1180px]:grid-cols-[minmax(0,1fr)_minmax(340px,420px)] min-[1500px]:grid-cols-[minmax(0,1fr)_minmax(380px,460px)]">
        <EditorPanel
          key={step}
          activeStep={step}
          draftCard={cardData}
          fieldOrder={fieldOrder}
          template={template}
          templates={[template]}
          currentPlan={template.access_level === "paid" ? "pro" : "free"}
          isPaid={template.access_level === "paid"}
          onStepChange={onStepChange}
          onUpdate={onUpdateCard}
          onSelectTemplate={() => undefined}
          onUpdateCustomField={onUpdateCustomField}
          onUpdateLeadSettings={onLeadSettingsChange}
          onActionConfigChange={onActionConfigChange}
          onToggleFieldVisibility={onToggleFieldVisibility}
          onMoveField={onMoveField}
          onSelectFont={onSelectFont}
          showTemplateContractControls
          saveStatus="idle"
          saveMessage=""
          saveError=""
        />

        <aside className="min-w-0">
          <div className="client-portal-panel sticky top-0 p-5">
            <PreviewPanelContent
              title="Live Edit Preview"
              previewCard={cardData}
              previewTemplate={previewTemplate}
              selectedDevice={selectedDevice}
              selectedKey={devicePreview as Parameters<typeof findDevice>[0]}
              search={deviceSearch}
              open={devicePickerOpen}
              filteredGroups={filteredDeviceGroups}
              dimensions={previewDimensions}
              leadSettings={step === 3 ? normalizeLeadCaptureSettings(leadSettings) : undefined}
              previewMode={step === 3 ? stepFourPreviewMode : "card"}
              onSearchChange={setDeviceSearch}
              onOpenChange={setDevicePickerOpen}
              onSelect={(key) => {
                setDevicePreview(key);
                setDevicePickerOpen(false);
              }}
              onPreviewModeChange={setStepFourPreviewMode}
            />
          </div>
        </aside>
      </div>
    </CardEditorModalShell>
  );
}

function AdminLivePhonePreview({
  template,
  cardData,
}: {
  template: CardRendererTemplate;
  cardData: CardRendererData;
}) {
  return (
    <div className="flex min-h-[620px] items-center justify-center overflow-hidden rounded-3xl border border-white/10 bg-black/20 p-5">
      <div className="relative w-full max-w-[360px] rounded-[2.7rem] bg-gradient-to-br from-black via-[#101016] to-[#1B1230] p-2.5 shadow-2xl shadow-[#AC00FF]/20">
        <div className="pointer-events-none absolute left-1/2 top-[18px] z-20 h-7 w-24 -translate-x-1/2 rounded-full bg-black shadow-inner shadow-white/10" />
        <div className="h-[560px] overflow-y-auto overflow-x-hidden rounded-[2rem] bg-[#070B1A] [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <CardRenderer mode="preview" template={template} cardData={cardData} />
        </div>
      </div>
    </div>
  );
}

function TemplateStepNavigation({
  steps,
  activeStep,
  onStepChange,
}: {
  steps: typeof templateBuilderSteps;
  activeStep: TemplateBuilderStep;
  onStepChange: (step: TemplateBuilderStep) => void;
}) {
  return (
    <div className="mt-6 rounded-3xl border border-white/10 bg-[#101935]/45 p-3">
      <ol className="grid gap-2 md:grid-cols-5">
        {steps.map((step, index) => {
          const selected = step.key === activeStep;

          return (
            <li key={step.key}>
              <button
                type="button"
                onClick={() => onStepChange(step.key)}
                className={`flex w-full items-center gap-2 rounded-2xl px-3 py-2 text-left text-sm transition ${
                  selected
                    ? "bg-[#AC00FF] text-white shadow-[0_0_22px_rgba(172,0,255,0.24)]"
                    : "bg-white/5 text-white/55 hover:bg-white/10 hover:text-white"
                }`}
              >
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                    selected ? "bg-white text-[#101935]" : "bg-white/10 text-white/60"
                  }`}
                >
                  {index + 1}
                </span>
                <span className="font-medium">{step.label}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function StepPanel({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-6">
      <div className="mb-5">
        <h3 className="text-xl font-semibold">{title}</h3>
        <p className="mt-1 text-sm leading-6 text-white/45">{description}</p>
      </div>
      {children}
    </div>
  );
}

function MediaCapabilityRow({
  title,
  description,
  enabled,
  disabled = false,
  onEnabledChange,
}: {
  title: string;
  description: string;
  enabled: boolean;
  disabled?: boolean;
  onEnabledChange: (value: boolean) => void;
}) {
  return (
    <div
      className={`grid gap-4 rounded-2xl border border-white/10 bg-white/[0.045] p-4 transition md:grid-cols-[minmax(0,1fr)_auto] md:items-center ${
        disabled ? "opacity-55" : ""
      }`}
    >
      <div className="flex gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/10 text-white/65">
          <span className="text-[10px] font-bold uppercase tracking-[0.14em]">
            IMG
          </span>
        </div>
        <div>
          <p className="font-semibold">{title}</p>
          <p className="mt-1 text-xs leading-relaxed text-white/55">
            {description}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <TogglePill
          label={enabled ? "Enabled" : "Disabled"}
          enabled={enabled}
          disabled={disabled}
          onToggle={() => onEnabledChange(!enabled)}
        />
      </div>
    </div>
  );
}

function ContractToggle({
  label,
  description,
  enabled,
  onToggle,
}: {
  label: string;
  description: string;
  enabled: boolean;
  onToggle: (value: boolean) => void;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-semibold">{label}</p>
          <p className="mt-1 text-xs leading-relaxed text-white/45">
            {description}
          </p>
        </div>
        <TogglePill
          label={enabled ? "Allowed" : "Not allowed"}
          enabled={enabled}
          onToggle={() => onToggle(!enabled)}
        />
      </div>
    </div>
  );
}

function TogglePill({
  label,
  enabled,
  disabled = false,
  onToggle,
}: {
  label: string;
  enabled: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  const enabledStyle = label === "Required"
    ? "border-amber-300/50 bg-amber-400/20 text-amber-100 shadow-[0_0_0_2px_rgba(251,191,36,0.12)]"
    : label === "Default enabled"
    ? "border-sky-300/50 bg-sky-400/20 text-sky-100 shadow-[0_0_0_2px_rgba(56,189,248,0.12)]"
    : "border-[#AC00FF]/55 bg-[#AC00FF]/25 text-white shadow-[0_0_0_2px_rgba(172,0,255,0.14)]";

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onToggle}
      className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
        enabled
          ? enabledStyle
          : "border-white/10 bg-white/5 text-white/55 hover:border-white/20 hover:bg-white/10 hover:text-white/75"
      } disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-white/10 disabled:hover:bg-white/5`}
    >
      {label}
    </button>
  );
}

function ReviewCard({
  title,
  items,
}: {
  title: string;
  items: [string, string][];
}) {
  return (
    <div className="rounded-3xl border border-white/10 bg-[#101935]/50 p-5">
      <h3 className="text-lg font-semibold">{title}</h3>
      <dl className="mt-4 space-y-3">
        {items.map(([label, value]) => (
          <div key={`${title}-${label}`} className="flex gap-4 text-sm">
            <dt className="w-32 shrink-0 text-white/45">{label}</dt>
            <dd className="min-w-0 flex-1 text-white">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function ActionButtonsControl({
  actions,
  onToggleAction,
  onToggleDefault,
  onUpdateDefaultLabel,
}: {
  actions: ActionPermissionDraft[];
  onToggleAction: (type: CardActionType) => void;
  onToggleDefault: (type: CardActionType) => void;
  onUpdateDefaultLabel: (type: CardActionType, label: string) => void;
}) {
  const enabledCount = actions.filter((action) => action.enabled).length;
  const defaultCount = actions.filter(
    (action) => action.enabled && action.default_visible
  ).length;

  return (
    <div className="mt-8 rounded-3xl border border-white/10 bg-white/5 p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h3 className="text-lg font-semibold">Action Buttons</h3>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-white/45">
            Choose which visitor actions clients can add to cards using this
            template. Defaults apply only when a new card is created.
          </p>
        </div>
        <span className="w-fit rounded-full border border-[#AC00FF]/30 bg-[#AC00FF]/10 px-3 py-1 text-xs font-semibold text-purple-100">
          {enabledCount} allowed · {defaultCount} default
        </span>
      </div>

      <div className="mt-5 space-y-2.5">
        {actions.map((action) => {
          const definition = cardActionDefinitions.find(
            (item) => item.type === action.type
          );
          const destinationLabel =
            definition?.destination === "file"
              ? "Stored file metadata"
              : definition?.destination === "scalar"
              ? "Uses card field"
              : "No destination required";
          const configurable = actionLabelIsConfigurable(action.type);

          return (
            <div
              key={action.type}
              className="grid gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center"
            >
              <div className="min-w-0">
                <p className="font-semibold">
                  {definition?.label || defaultLabelForActionType(action.type)}
                </p>
                <p className="mt-1 text-xs text-white/45">
                  {destinationLabel}
                  {action.type === "download_pdf"
                    ? " · upload/storage is not enabled in this phase"
                    : ""}
                </p>
                {configurable && (
                  <label className="mt-3 block max-w-sm">
                    <span className="mb-1 block text-xs font-medium text-white/45">
                      Default label
                    </span>
                    <input
                      value={action.default_label}
                      onChange={(event) =>
                        onUpdateDefaultLabel(action.type, event.target.value)
                      }
                      className="inputStyle h-10"
                    />
                  </label>
                )}
              </div>

              <button
                type="button"
                onClick={() => onToggleAction(action.type)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                  action.enabled
                    ? "bg-[#AC00FF] text-white"
                    : "bg-white/10 text-white/50 hover:bg-white/15"
                }`}
              >
                {action.enabled ? "Allowed" : "Not allowed"}
              </button>

              <button
                type="button"
                onClick={() => onToggleDefault(action.type)}
                disabled={!action.enabled}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                  action.enabled && action.default_visible
                    ? "bg-[#AC00FF]/25 text-purple-100"
                    : "bg-white/10 text-white/50 hover:bg-white/15"
                } disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-white/10`}
              >
                {action.default_visible ? "Default" : "Not default"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ColourPalette({
  title,
  description,
  colours,
  addLabel,
  itemLabel,
  onChange,
  onAdd,
  onRemove,
}: {
  title: string;
  description: string;
  colours: string[];
  addLabel: string;
  itemLabel: string;
  onChange: (index: number, value: string) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
}) {
  const palette = sanitizeFreeColourPalette(colours);

  return (
    <div className="mt-8 rounded-3xl border border-white/10 bg-[#101935]/50 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold">{title}</h3>
          <p className="mt-1 text-sm text-white/45">{description}</p>
        </div>

        <button
          type="button"
          onClick={onAdd}
          disabled={palette.length >= 6}
          className="rounded-2xl bg-white/10 px-4 py-2 text-xs font-medium transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-45"
        >
          {addLabel}
        </button>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3">
        {palette.map((colour, index) => (
          <div
            key={`${title}-${index}`}
            className="rounded-2xl border border-white/10 bg-white/5 p-3"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-white/50">
                {itemLabel} {index + 1}
                {index === 0 ? " · Default" : ""}
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
  exampleValues,
  onToggleSection,
  onToggleField,
  onUpdateExampleValue,
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
  exampleValues: TemplateExampleValues;
  onToggleSection: () => void;
  onToggleField: (field: string) => void;
  onUpdateExampleValue: (field: string, value: string) => void;
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
                  className={`grid cursor-grab gap-3 rounded-2xl border px-4 py-3 transition active:cursor-grabbing sm:grid-cols-[auto_minmax(0,1fr)_minmax(180px,260px)_auto_auto] sm:items-center ${
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
                  {field in defaultTemplateExampleValues ? (
                    <input
                      type="text"
                      value={exampleValues[field] || ""}
                      onDragStart={(event) => event.preventDefault()}
                      onChange={(event) =>
                        onUpdateExampleValue(field, event.target.value)
                      }
                      placeholder="Example value"
                      className="min-w-0 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-white outline-none transition placeholder:text-white/25 focus:border-[#AC00FF]/60 focus:ring-2 focus:ring-[#AC00FF]/20"
                    />
                  ) : (
                    <span className="hidden text-xs text-white/30 sm:block">
                      Custom field
                    </span>
                  )}
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
  exampleValues,
  onToggleField,
  onUpdateExampleValue,
}: {
  fields: string[];
  allowedFields: string[];
  exampleValues: TemplateExampleValues;
  onToggleField: (field: string) => void;
  onUpdateExampleValue: (field: string, value: string) => void;
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
              className="grid gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 transition hover:border-[#AC00FF]/30 hover:bg-white/[0.07] sm:grid-cols-[minmax(0,1fr)_minmax(180px,260px)_auto] sm:items-center"
            >
              <span className="min-w-0 flex-1 text-sm font-medium capitalize">
                {formatFieldLabel(field)}
              </span>
              <input
                type="text"
                value={exampleValues[field] || ""}
                onChange={(event) =>
                  onUpdateExampleValue(field, event.target.value)
                }
                placeholder="Example value"
                className="min-w-0 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-white outline-none transition placeholder:text-white/25 focus:border-[#AC00FF]/60 focus:ring-2 focus:ring-[#AC00FF]/20"
              />
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
        .filter(
          (field) =>
            section.key !== "social" || !isStepThreeOwnedTemplateField(field)
        )
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
  text_colours,
  button_color,
  button_text_color,
  requires_profile_image,
  requires_logo,
  requires_banner,
  profile_image_allowed,
  profile_image_default_enabled,
  logo_allowed,
  logo_default_enabled,
  banner_allowed,
  banner_default_enabled,
  custom_colour_allowed,
  custom_text_colour_allowed,
  gradient_enabled,
  free_colour_palette,
  allowed_fonts,
  default_font,
  allowed_fields,
  allowed_actions,
  custom_fields,
  field_config,
  renderer_options,
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
  text_colours: string[];
  button_color: string;
  button_text_color: string;
  requires_profile_image: boolean;
  requires_logo: boolean;
  requires_banner: boolean;
  profile_image_allowed: boolean;
  profile_image_default_enabled: boolean;
  logo_allowed: boolean;
  logo_default_enabled: boolean;
  banner_allowed: boolean;
  banner_default_enabled: boolean;
  custom_colour_allowed: boolean;
  custom_text_colour_allowed: boolean;
  gradient_enabled: boolean;
  free_colour_palette: string[];
  allowed_fonts: string[];
  default_font: string | null;
  allowed_fields: string[];
  allowed_actions: TemplateAllowedActions;
  custom_fields: CustomFields;
  field_config: TemplateFieldConfig;
  renderer_options: Record<string, unknown>;
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
    text_colours: sanitizeTextColourPalette(text_colours, text_color),
    button_color,
    button_text_color,
    requires_profile_image,
    requires_logo,
    requires_banner,
    profile_image_allowed,
    profile_image_default_enabled,
    logo_allowed,
    logo_default_enabled,
    banner_allowed,
    banner_default_enabled,
    custom_colour_allowed,
    custom_text_colour_allowed,
    gradient_enabled,
    free_colour_palette: sanitizeFreeColourPalette(free_colour_palette),
    colour_palette: sanitizeFreeColourPalette(free_colour_palette),
    allowed_fonts: sanitizeTemplateFonts(allowed_fonts),
    default_font: sanitizeDefaultFont(default_font, allowed_fonts),
    supports_bio: true,
    supports_save_contact: templateAllowedActionsIncludes(
      allowed_actions,
      "save_contact"
    ),
    allowed_fields: sanitizeAllowedFields(allowed_fields),
    allowed_actions: sanitizeTemplateAllowedActions(allowed_actions),
    custom_fields: sanitizeCustomFields(custom_fields),
    field_config,
    renderer_options,
    template_contract_version: 1,
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
        .filter((field) => !isStepThreeOwnedTemplateField(field))
    )
  );
}

function actionPermissionsFromTemplate(
  template: Pick<Template, "allowed_actions" | "supports_save_contact">
): ActionPermissionDraft[] {
  const configured = normalizeTemplateAllowedActions(template.allowed_actions);
  const configuredByType = new Map(
    configured?.actions.map((action) => [action.type, action]) || []
  );

  return cardActionDefinitions.map((definition) => {
    const configuredAction = configuredByType.get(definition.type);
    const legacySaveContactDisabled =
      !configured && definition.type === "save_contact" &&
      template.supports_save_contact === false;

    return {
      type: definition.type,
      enabled: configured ? Boolean(configuredAction) : !legacySaveContactDisabled,
      default_visible:
        configuredAction?.default_visible === true ||
        (!configured && definition.type === "save_contact" && !legacySaveContactDisabled),
      default_label:
        configuredAction?.default_label ||
        defaultLabelForActionType(definition.type),
    };
  });
}

function buildTemplateAllowedActions(
  permissions: ActionPermissionDraft[]
): TemplateAllowedActions {
  return {
    version: 1,
    actions: permissions
      .filter((action) => action.enabled)
      .map((action) => ({
        type: action.type,
        enabled: true,
        default_visible: action.default_visible,
        default_label: actionLabelIsConfigurable(action.type)
          ? action.default_label
          : undefined,
      })),
  };
}

function buildTemplateFieldConfig(
  allowedFields: string[],
  customFields: CustomFields
): TemplateFieldConfig {
  const sections = normalizeCustomFields(customFields);

  return {
    version: 1,
    allowed_fields: sanitizeAllowedFields(allowedFields),
    sections,
    default_visibility: {},
    required_fields: [],
  };
}

function buildTemplateRendererOptions(
  layoutType: string,
  exampleValues: TemplateExampleValues,
  gradientStart: string,
  gradientEnd: string
): Record<string, unknown> {
  return {
    version: 1,
    layout_type: layoutType,
    example_values: sanitizeTemplateExampleValues(exampleValues),
    gradient_defaults: {
      start: gradientStart,
      end: gradientEnd,
    },
  };
}

function sanitizeTemplateExampleValues(
  values?: TemplateExampleValues | null
): TemplateExampleValues {
  const source = values || {};

  return Object.keys(defaultTemplateExampleValues).reduce<TemplateExampleValues>(
    (sanitized, field) => {
      const value = source[field];

      sanitized[field] =
        typeof value === "string"
          ? value.trim().slice(0, field === "bio" ? 500 : 160)
          : defaultTemplateExampleValues[field] || "";

      return sanitized;
    },
    {}
  );
}

function readTemplateExampleValues(
  rendererOptions: Record<string, unknown> | null | undefined,
  fallback: TemplateExampleValues
): TemplateExampleValues {
  if (!rendererOptions || typeof rendererOptions !== "object") {
    return sanitizeTemplateExampleValues(fallback);
  }

  const rawExamples = rendererOptions.example_values;

  if (!rawExamples || typeof rawExamples !== "object" || Array.isArray(rawExamples)) {
    return sanitizeTemplateExampleValues(fallback);
  }

  return sanitizeTemplateExampleValues({
    ...fallback,
    ...(rawExamples as TemplateExampleValues),
  });
}

function mediaSummary(
  allowed: boolean,
  required: boolean,
  defaultEnabled: boolean
) {
  if (!allowed) return "Not allowed";

  const parts = ["Allowed"];

  if (required) parts.push("Required");
  if (defaultEnabled) parts.push("Default enabled");

  return parts.join(" · ");
}

function sanitizeTemplateAllowedActions(
  value: TemplateAllowedActions
): TemplateAllowedActions {
  return (
    normalizeTemplateAllowedActions(value) ||
    buildTemplateAllowedActions(defaultTemplateActionPermissions)
  );
}

function templateAllowedActionsIncludes(
  allowedActions: TemplateAllowedActions,
  type: CardActionType
) {
  return allowedActions.actions.some((action) => action.type === type);
}

function actionPermissionEnabled(
  permissions: ActionPermissionDraft[],
  type: CardActionType
) {
  return permissions.some((action) => action.type === type && action.enabled);
}

function sanitizeFreeColourPalette(colours?: unknown) {
  const palette = normalizeColourPalette(colours);

  return palette.length ? palette : ["#AC00FF"];
}

function sanitizeTextColourPalette(colours?: unknown, fallback?: string | null) {
  const palette = normalizeColourPalette(colours);
  const fallbackPalette = normalizeColourPalette(fallback);
  const nextPalette = palette.length ? palette : fallbackPalette;

  return nextPalette.length ? nextPalette : defaultTextColourPalette;
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
