"use client";

import { builderLayouts, getTemplateLayout, canCreateTemplateLayout } from "@/lib/template-layouts";
import { templateEditPatch, templateUuid } from "@/lib/admin-template-write";
import { reconcileClientCard, clientFieldOrder as resolveClientFieldOrder } from "@/lib/client-template-view";
import { cardFontKey } from "@/lib/card-typography";
import { useAdminInteraction } from "@/components/AdminInteractionDialog";

import { useAdminDialog } from "@/hooks/useAdminDialog";

import {
  Briefcase,
  ClipboardList,
  Gamepad2,
  Globe,
  Image as ImageIcon,
  Layers,
  Music,
  Palette,
  Phone,
  Plus,
  Share2,
  type LucideIcon,
} from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import AdminShell from "@/components/admin/AdminShell";
import { AdminPageHeader } from "@/components/admin/AdminUI";
import adminStyles from "./templates-admin.module.css";
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
import ToggleSwitch from "@/components/card-builder/ToggleSwitch";
import {
  getAdminTemplates,
  normalizeColourPalette,
  normalizeTemplate,
  publishAdminTemplate,
  saveAdminTemplate,
  type SharedTemplate,
} from "@/lib/templates";
import {
  actionLabelIsConfigurable,
  cardActionDefinitions,
  defaultLabelForActionType,
  isStepThreeOwnedTemplateField,
  normalizeTemplateAllowedActions,
  type CardActionConfig,
  type CardActionType,
  type TemplateAllowedActions,
} from "@/lib/card-actions";
import {
  defaultLeadCaptureSettings,
  normalizeLeadCaptureSettings,
  type CardFieldOrder,
  type LeadCaptureSettings,
  type SharedClientCard,
} from "@/lib/services/card-payload";

type Template = {
  id: string;
  name: string;
  slug: string | null;
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
  supports_gradient?: boolean | null;
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
type SectionKey = string;
type CustomFields = Partial<Record<SectionKey, string[]>>;
type DraggedField = { section: SectionKey; field: string } | null;
type ContentSection = {
  key: SectionKey;
  title: string;
  description: string;
  fields: string[];
  custom?: boolean;
};
type DraggedSection = SectionKey | null;
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
  id: string;
  type: CardActionType;
  enabled: boolean;
  default_visible: boolean;
  default_label: string;
  custom_action?: boolean;
  action_name?: string;
  destination_type?: "url" | "email" | "phone" | "card_field";
  destination_field?: string;
};
type TemplateSaveResult = {
  template: Template;
  published: boolean;
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
  section_order?: string[];
  section_labels?: Record<string, string>;
};

const cardHeaderFields = ["title", "first_name", "last_name"];

const sectionFieldGroups: ContentSection[] = [
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
const defaultContentSections = sectionFieldGroups;

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

const modernMinimalFonts = ["Inter", "DM Sans", "Poppins", "Montserrat"];
const defaultTemplateBackgroundColour = "#000000";
const defaultTemplateGradientEnd = "#FFFFFF";
const defaultTemplateTextColour = "#FFFFFF";
type GradientDirection =
  | "to_bottom"
  | "to_top"
  | "to_right"
  | "to_left"
  | "to_bottom_right"
  | "to_bottom_left";
const defaultGradientDirection: GradientDirection = "to_bottom_right";
const gradientDirectionOptions: Array<{
  value: GradientDirection;
  label: string;
}> = [
  { value: "to_bottom", label: "Top to Bottom" },
  { value: "to_top", label: "Bottom to Top" },
  { value: "to_right", label: "Left to Right" },
  { value: "to_left", label: "Right to Left" },
  { value: "to_bottom_right", label: "Top Left to Bottom Right" },
  { value: "to_bottom_left", label: "Top Right to Bottom Left" },
];
const builderWorkspaceClass =
  "rounded-[24px] border border-[var(--dmi-border)] bg-[var(--dmi-surface)] p-4 shadow-[0_24px_80px_color-mix(in_srgb,var(--brand-navy)_12%,transparent)] sm:rounded-[28px] sm:p-6";
const builderPanelClass =
  "rounded-[24px] border border-[var(--dmi-border)] bg-[var(--dmi-surface)] p-4 shadow-[0_18px_50px_color-mix(in_srgb,var(--brand-navy)_8%,transparent)] sm:p-5";
const builderPanelHeadingClass =
  "text-lg font-semibold text-[var(--text-primary)]";
const builderPanelDescriptionClass =
  "mt-1 text-sm leading-6 text-[var(--dmi-muted)]";
const builderSelectClass =
  "inputStyle bg-[var(--input-bg)] text-[var(--input-text)] focus:border-[var(--border-brand)] focus:shadow-[0_0_0_4px_color-mix(in_srgb,var(--brand-secondary)_16%,transparent)]";
const builderPrimaryButtonClass =
  "inline-flex items-center justify-center rounded-2xl bg-[linear-gradient(135deg,var(--brand-primary),var(--brand-secondary))] px-5 py-3 text-sm font-semibold !text-white shadow-[0_14px_34px_color-mix(in_srgb,var(--brand-secondary)_24%,transparent)] transition hover:-translate-y-0.5 hover:shadow-[0_18px_42px_color-mix(in_srgb,var(--brand-secondary)_30%,transparent)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-secondary)] focus:ring-offset-2 focus:ring-offset-[var(--background)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 [&_*]:!text-white [&_svg]:!text-white";
const builderSecondaryButtonClass =
  "inline-flex items-center justify-center rounded-2xl border border-[var(--dmi-border)] bg-[var(--button-secondary-bg)] px-4 py-2 text-sm font-semibold text-[var(--button-secondary-text)] transition hover:border-[var(--border-brand)] hover:bg-[var(--button-hover-bg)] hover:text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-secondary)] focus:ring-offset-2 focus:ring-offset-[var(--background)]";
const builderModalPanelClass =
  "w-full max-w-md rounded-[24px] border border-[var(--dmi-border)] bg-[var(--dmi-surface)] p-5 text-[var(--text-primary)] shadow-[0_28px_90px_color-mix(in_srgb,var(--brand-navy)_24%,transparent)] sm:p-6";
const actionCategoryCardClass =
  "rounded-[24px] border border-[var(--dmi-border)] bg-[var(--dmi-surface)] shadow-[0_18px_50px_color-mix(in_srgb,var(--brand-navy)_8%,transparent)]";
const actionCategoryHeaderClass =
  "flex w-full flex-col gap-3 px-4 py-4 text-left sm:flex-row sm:items-center sm:justify-between";
const actionCategoryBodyClass =
  "space-y-2.5 border-t border-[var(--dmi-border)] p-3 sm:p-4";
const actionRowClass =
  "grid gap-4 rounded-2xl border border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] p-3 transition hover:border-[var(--border-brand)] hover:bg-[var(--button-hover-bg)] sm:p-4 md:grid-cols-2 2xl:grid-cols-[minmax(0,1fr)_220px_220px_auto] 2xl:items-center";
type MediaSlotKey = "profile" | "logo" | "banner";
type TemplateMediaSupport = "unsupported" | "optional" | "required";
type TemplateMediaDefinition = Record<MediaSlotKey, TemplateMediaSupport>;

const templateMediaDefinitions: Record<string, TemplateMediaDefinition> = {
  classic: {
    profile: "optional",
    logo: "unsupported",
    banner: "unsupported",
  },
  classic_free: {
    profile: "optional",
    logo: "unsupported",
    banner: "unsupported",
  },
  profile_free: {
    profile: "optional",
    logo: "unsupported",
    banner: "unsupported",
  },
  modern_minimal: {
    profile: "optional",
    logo: "optional",
    banner: "optional",
  },
  executive_paid: {
    profile: "optional",
    logo: "optional",
    banner: "unsupported",
  },
  brand_paid: {
    profile: "optional",
    logo: "optional",
    banner: "optional",
  },
};

const defaultMediaDefinition: TemplateMediaDefinition = {
  profile: "optional",
  logo: "optional",
  banner: "optional",
};

const optionalMediaDefaults: Record<string, Partial<Record<MediaSlotKey, boolean>>> = {
  classic: {
    profile: true,
  },
  classic_free: {
    profile: true,
  },
  profile_free: {
    profile: true,
  },
  modern_minimal: {
    profile: false,
    logo: true,
    banner: false,
  },
  executive_paid: {
    profile: true,
    logo: true,
    banner: false,
  },
  brand_paid: {
    profile: true,
    logo: true,
    banner: true,
  },
};

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
    id: definition.type,
    type: definition.type,
    enabled: true,
    default_visible: definition.type === "save_contact",
    default_label: definition.label,
  }));

const actionGroupOrder = [
  "Contact",
  "Web & Meetings",
  "Social",
  "Video & Music",
  "Gaming & Community",
  "Work & Developer",
] as const;

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

function mediaDefinitionForLayout(layoutType: string): TemplateMediaDefinition {
  return templateMediaDefinitions[layoutType] || defaultMediaDefinition;
}

function mediaEnabledForDefinition(
  support: TemplateMediaSupport,
  defaultEnabled = false
) {
  if (support === "unsupported") return false;
  if (support === "required") return true;
  return defaultEnabled;
}

function templateNameForLayout(layoutType: string) {
  return getTemplateLayout(layoutType)?.displayName || layoutType || "Unknown layout";
}

// Only UI-owned fields can change. There are no slug, tier, layout or font/colour
// permission controls in edit mode; defaults must never expand those permissions.
function existingEditPatch(payload: Record<string, unknown>, baseline: { payload: Record<string, unknown>; stored: Record<string, unknown> }) {
  const patch = templateEditPatch(payload, baseline.payload, baseline.stored);
  delete patch.slug;
  for (const key of ["layout_type", "access_level", "allowed_fonts", "free_colour_palette", "colour_palette", "text_colours", "custom_colour_allowed", "custom_text_colour_allowed"]) delete patch[key];
  return patch;
}

export default function TemplatesPage() {
  const interaction = useAdminInteraction();
  const router = useRouter();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(
    null
  );
  const [templateName, setTemplateName] = useState("");
  const [editBaseline, setEditBaseline] = useState<{ id: string; payload: Record<string, unknown>; stored: Record<string, unknown> } | null>(null);
  const pendingEdit = useRef<Template | null>(null);
  const saveLock = useRef(false);
  const [editTargetMissing, setEditTargetMissing] = useState(false);
  const appliedEditTemplateIdRef = useRef<string | null>(null);
  const editTemplateRef = useRef<(template: Template) => void>(() => undefined);
  const resetBuilderRef = useRef<() => void>(() => undefined);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateMessage, setTemplateMessage] = useState("");
  const [templateError, setTemplateError] = useState("");
  const [showLiveTemplateConfirm, setShowLiveTemplateConfirm] = useState(false);
  const [templateSaveResult, setTemplateSaveResult] =
    useState<TemplateSaveResult | null>(null);
  const [publishingTemplate, setPublishingTemplate] = useState(false);
  const [publishError, setPublishError] = useState("");
  const [activeBuilderStep, setActiveBuilderStep] =
    useState<TemplateBuilderStep>("setup");
  const [templateSelectionConfirmed, setTemplateSelectionConfirmed] =
    useState(false);
  const [clientPreviewOpen, setClientPreviewOpen] = useState(false);
  const [clientPreviewStep, setClientPreviewStep] = useState<ClientPreviewStep>(0);
  const [previewSelectedFont, setPreviewSelectedFont] = useState("Inter");
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
  const [collapsedActionGroups, setCollapsedActionGroups] = useState<
    Record<string, boolean>
  >({});

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
  const [gradientDirection, setGradientDirection] =
    useState<GradientDirection>(defaultGradientDirection);
  const [allowedFonts, setAllowedFonts] =
    useState<string[]>(defaultAllowedFonts);
  const [defaultFont, setDefaultFont] = useState("Inter");
  const [allowedFields, setAllowedFields] = useState<string[]>(freeFields);
  const [actionPermissions, setActionPermissions] = useState<
    ActionPermissionDraft[]
  >(defaultTemplateActionPermissions);
  const [customFields, setCustomFields] =
    useState<CustomFields>(defaultCustomFields);
  const [contentSections, setContentSections] =
    useState<ContentSection[]>(defaultContentSections);
  const [disabledContentSections, setDisabledContentSections] = useState<string[]>(
    []
  );
  const [exampleValues, setExampleValues] = useState<TemplateExampleValues>(
    defaultTemplateExampleValues
  );

  const [primaryColor, setPrimaryColor] = useState(defaultTemplateBackgroundColour);
  const [secondaryColor, setSecondaryColor] = useState(defaultTemplateGradientEnd);
  const [textColor, setTextColor] = useState(defaultTemplateTextColour);
  const [buttonColor, setButtonColor] = useState("#FFFFFF");
  const [buttonTextColor, setButtonTextColor] = useState("#0F0E38");
  const [showPersonalSection, setShowPersonalSection] = useState(true);
  const [showCompanySection, setShowCompanySection] = useState(true);
  const [showContactSection, setShowContactSection] = useState(true);
  const [showSocialSection, setShowSocialSection] = useState(false);
  const [draggedField, setDraggedField] = useState<DraggedField>(null);
  const [draggedSection, setDraggedSection] = useState<DraggedSection>(null);

  const currentMediaDefinition = mediaDefinitionForLayout(layoutType);
  const layoutOptions = builderLayouts(accessLevel).map(layout => ({ value: layout.id, label: layout.displayName }));
  const selectedTemplateName = templateName;

  const hydrateTemplateFromUrl = useCallback((loadedTemplates: Template[]) => {
    if (typeof window === "undefined") return;

    const editTemplateId = new URLSearchParams(window.location.search).get("edit");

    if (!editTemplateId) {
      appliedEditTemplateIdRef.current = null;
      resetBuilderRef.current();
      return;
    }

    if (appliedEditTemplateIdRef.current === editTemplateId) {
      return;
    }

    const templateToEdit = loadedTemplates.find(
      (template) => template.id === editTemplateId
    );

    if (!templateToEdit || !templateUuid.test(editTemplateId)) {
      setEditTargetMissing(true);
      setTemplateSelectionConfirmed(false);
      setTemplateError("The exact template UUID could not be loaded. Return to Current Templates and retry.");
      return;
    }
    setEditTargetMissing(false);

    editTemplateRef.current(templateToEdit);
    appliedEditTemplateIdRef.current = editTemplateId;
  }, []);

  useEffect(() => {
    let ignore = false;

    async function loadTemplates() {
      try {
        const loadedTemplates = await getAdminTemplates({ raw: true });

        if (ignore) return;

        const normalizedTemplates = loadedTemplates as Template[];
        setTemplates(normalizedTemplates);
        setTemplateError("");
        hydrateTemplateFromUrl(normalizedTemplates);
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
    setEditBaseline(null);
    pendingEdit.current = null;
    setTemplateName("");
    setEditTargetMissing(false);
    setShowLiveTemplateConfirm(false);
    setTemplateSaveResult(null);
    setPublishError("");
    setPublishingTemplate(false);
    setEditingTemplateId(null);
    setTemplateSelectionConfirmed(false);
    setActiveBuilderStep("setup");
    setAccessLevel("free");
    setLayoutType("classic_free");
    applyMediaDefinition("classic_free");
    setGradientEnabled(false);
    setGradientDirection(defaultGradientDirection);
    setAllowedFonts(["Inter"]);
    setDefaultFont("Inter");
    setAllowedFields(freeFields);
    setActionPermissions(defaultTemplateActionPermissions);
    setCustomFields(defaultCustomFields);
    setContentSections(defaultContentSections);
    setDisabledContentSections([]);
    setPrimaryColor(defaultTemplateBackgroundColour);
    setSecondaryColor(defaultTemplateGradientEnd);
    setTextColor(defaultTemplateTextColour);
    setButtonColor(defaultTemplateGradientEnd);
    setButtonTextColor(defaultTemplateBackgroundColour);
    setShowPersonalSection(true);
    setShowCompanySection(true);
    setShowContactSection(true);
    setShowSocialSection(false);
    setPreviewSelectedFont("Inter");
    setPreviewFieldOrder(defaultCustomFields);
    setPreviewActionConfig(null);
    setPreviewCardOverrides({});
    setPreviewEditedFields([]);
    setPreviewLeadSettings(defaultLeadCaptureSettings);
    setExampleValues(defaultTemplateExampleValues);
  }

  function applyTemplateLayout(nextLayoutType: string) {
    setLayoutType(nextLayoutType);
    applyMediaDefinition(nextLayoutType);
  }

  function applyMediaDefinition(nextLayoutType: string) {
    const definition = mediaDefinitionForLayout(nextLayoutType);
    const defaults = optionalMediaDefaults[nextLayoutType] || {};

    const profileEnabled = mediaEnabledForDefinition(
      definition.profile,
      defaults.profile
    );
    const logoEnabled = mediaEnabledForDefinition(definition.logo, defaults.logo);
    const bannerEnabled = mediaEnabledForDefinition(
      definition.banner,
      defaults.banner
    );

    setProfileImageAllowed(profileEnabled);
    setProfileImageDefaultEnabled(profileEnabled);
    setRequiresProfileImage(definition.profile === "required");
    setLogoAllowed(logoEnabled);
    setLogoDefaultEnabled(logoEnabled);
    setRequiresLogo(definition.logo === "required");
    setBannerAllowed(bannerEnabled);
    setBannerDefaultEnabled(bannerEnabled);
    setRequiresBanner(definition.banner === "required");
  }

  function updateMediaCapability(slot: MediaSlotKey, enabled: boolean) {
    const support = currentMediaDefinition[slot];

    if (support === "unsupported") return;

    const nextEnabled = support === "required" ? true : enabled;
    const nextRequired = support === "required";

    if (slot === "profile") {
      setProfileImageAllowed(nextEnabled);
      setProfileImageDefaultEnabled(nextEnabled);
      setRequiresProfileImage(nextRequired);
      return;
    }

    if (slot === "logo") {
      setLogoAllowed(accessLevel === "paid" && nextEnabled);
      setLogoDefaultEnabled(accessLevel === "paid" && nextEnabled);
      setRequiresLogo(accessLevel === "paid" && nextRequired);
      return;
    }

    setBannerAllowed(accessLevel === "paid" && nextEnabled);
    setBannerDefaultEnabled(accessLevel === "paid" && nextEnabled);
    setRequiresBanner(accessLevel === "paid" && nextRequired);
  }

  function applyAccessLevel(value: string) {
    setAccessLevel(value);

    if (value === "free") {
      applyTemplateLayout("classic_free");
      setGradientEnabled(false);
      setGradientDirection(defaultGradientDirection);
      setAllowedFonts(["Inter"]);
      setDefaultFont("Inter");
      setPrimaryColor(defaultTemplateBackgroundColour);
      setSecondaryColor(defaultTemplateGradientEnd);
      setTextColor(defaultTemplateTextColour);
      setButtonColor(defaultTemplateGradientEnd);
      setButtonTextColor(defaultTemplateBackgroundColour);
      setAllowedFields(freeFields);
      setActionPermissions(defaultTemplateActionPermissions);
      setCustomFields(defaultCustomFields);
      setContentSections(defaultContentSections);
      setDisabledContentSections([]);
      setShowPersonalSection(true);
      setShowCompanySection(true);
      setShowContactSection(true);
      setShowSocialSection(false);
      setPreviewSelectedFont("Inter");
      setPreviewFieldOrder(defaultCustomFields);
      setPreviewActionConfig(null);
      setPreviewCardOverrides({});
      setPreviewEditedFields([]);
      setPreviewLeadSettings(defaultLeadCaptureSettings);
      setExampleValues(defaultTemplateExampleValues);
    }

    if (value === "paid") {
      applyTemplateLayout("modern_minimal");
      setGradientEnabled(false);
      setGradientDirection(defaultGradientDirection);
      setAllowedFonts([...fontChoices]);
      setDefaultFont("DM Sans");
      setPrimaryColor(defaultTemplateBackgroundColour);
      setSecondaryColor(defaultTemplateGradientEnd);
      setTextColor(defaultTemplateTextColour);
      setButtonColor(defaultTemplateGradientEnd);
      setButtonTextColor(defaultTemplateBackgroundColour);
      setAllowedFields(paidFields);
      setActionPermissions(defaultTemplateActionPermissions);
      setCustomFields(defaultCustomFields);
      setContentSections(defaultContentSections);
      setDisabledContentSections([]);
      setShowPersonalSection(true);
      setShowCompanySection(true);
      setShowContactSection(true);
      setShowSocialSection(false);
      setPreviewSelectedFont("DM Sans");
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
        id: definition.type,
        type: definition.type,
        enabled,
        default_visible: enabled && defaultTypes.includes(definition.type),
        default_label: definition.label,
      };
    });
  }

  function applyPaidLayoutDefaults(nextLayoutType: string) {
    if (nextLayoutType === "executive_paid" || nextLayoutType === "brand_paid") {
      applyAccessLevel("paid");
      applyTemplateLayout(nextLayoutType);
      return;
    }

    applyTemplateLayout(nextLayoutType);

    if (nextLayoutType !== "modern_minimal") return;

    setGradientEnabled(false);
    setGradientDirection(defaultGradientDirection);
    setAllowedFonts(modernMinimalFonts);
    setDefaultFont("DM Sans");
    setPrimaryColor(defaultTemplateBackgroundColour);
    setSecondaryColor(defaultTemplateGradientEnd);
    setTextColor(defaultTemplateTextColour);
    setButtonColor(defaultTemplateGradientEnd);
    setButtonTextColor(defaultTemplateBackgroundColour);
    setAllowedFields(paidFields);
    setCustomFields(defaultCustomFields);
    setContentSections(defaultContentSections);
    setDisabledContentSections([]);
    setPreviewFieldOrder(defaultCustomFields);
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

  function selectAccessLevel(value: string) {
    if (editingTemplateId || editTargetMissing) return;
    setTemplateSelectionConfirmed(false);
    setTemplateName("");
    applyAccessLevel(value);
  }

  function selectLayout(value: string) {
    if (editingTemplateId || editTargetMissing || !canCreateTemplateLayout({ layout_type: value, access_level: accessLevel })) return;
    setEditBaseline(null);
    setTemplateSelectionConfirmed(true);
    setTemplateName(templateNameForLayout(value));
    if (accessLevel === "paid") applyPaidLayoutDefaults(value);
    else applyTemplateLayout(value);
  }

  function handleBuilderStepChange(step: TemplateBuilderStep) {
    if (step !== "setup" && !templateSelectionConfirmed) {
      setTemplateError("Choose a template before continuing.");
      setActiveBuilderStep("setup");
      return;
    }

    setTemplateError("");
    setActiveBuilderStep(step);
  }

  function toggleAllowedField(field: string) {
    if (isStepThreeOwnedTemplateField(field)) return;

    if (allowedFields.includes(field)) {
      setAllowedFields(allowedFields.filter((item) => item !== field));
    } else {
      setAllowedFields([...allowedFields, field]);
    }
  }

  function toggleActionPermission(actionId: string) {
    setPreviewActionConfig(null);
    setActionPermissions((current) =>
      current.map((action) =>
        action.id === actionId
          ? {
              ...action,
              enabled: !action.enabled,
              default_visible: action.enabled ? false : action.default_visible,
            }
          : action
      )
    );
  }

  function toggleActionDefault(actionId: string) {
    setPreviewActionConfig(null);
    setActionPermissions((current) =>
      current.map((action) =>
        action.id === actionId && action.enabled
          ? { ...action, default_visible: !action.default_visible }
          : action
      )
    );
  }

  function updateActionDefaultLabel(actionId: string, label: string) {
    setPreviewActionConfig(null);
    setActionPermissions((current) =>
      current.map((action) =>
        action.id === actionId ? { ...action, default_label: label } : action
      )
    );
  }

  async function addCustomAction() {
    const actionName = await interaction.prompt("Action name");
    const normalizedName = actionName?.trim();

    if (!normalizedName) return;

    const buttonLabel = (await interaction.prompt("Button label", normalizedName))?.trim();
    const destinationType = (await interaction.prompt("Destination type: URL, Email, Phone, or Card field", "URL"))
      ?.trim()
      .toLowerCase()
      .replace(/\s+/g, "_");
    const safeDestinationType =
      destinationType === "email" ||
      destinationType === "phone" ||
      destinationType === "card_field"
        ? destinationType
        : "url";
    const destinationField =
      safeDestinationType === "card_field"
        ? (await interaction.prompt("Card field key", "custom_url"))?.trim() || "custom_url"
        : undefined;
    const baseId = `custom_action_${slugifyKey(normalizedName)}`;
    let id = baseId;
    let count = 2;

    while (actionPermissions.some((action) => action.id === id)) {
      id = `${baseId}_${count}`;
      count += 1;
    }

    setPreviewActionConfig(null);
    setActionPermissions((current) => [
      ...current,
      {
        id,
        type: "custom_link",
        enabled: true,
        default_visible: false,
        default_label: buttonLabel || normalizedName,
        custom_action: true,
        action_name: normalizedName,
        destination_type: safeDestinationType,
        destination_field: destinationField,
      },
    ]);
  }

  async function deleteCustomAction(actionId: string) {
    const action = actionPermissions.find((item) => item.id === actionId);

    if (!action?.custom_action) return;
    if (!(await interaction.confirm(`Delete the "${action.action_name || action.default_label}" action?`))) {
      return;
    }

    setPreviewActionConfig(null);
    setActionPermissions((current) =>
      current.filter((item) => item.id !== actionId)
    );
  }

  function toggleActionGroup(group: string) {
    setCollapsedActionGroups((current) => ({
      ...current,
      [group]: !current[group],
    }));
  }

  async function addCustomField(section: SectionKey) {
    const fieldName = await interaction.prompt("Field name");
    const normalized = fieldName?.trim();

    if (!normalized) return;

    const key = customFieldKey(section, normalized);

    setCustomFields((current) => {
      const existingFields = orderedSectionFields(
        section,
        current,
        contentSections
      );
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
    setExampleValues((current) => ({
      ...current,
      [key]: `${normalized} details`,
    }));
  }

  function reorderField(section: SectionKey, dragged: string, target: string) {
    if (dragged === target) return;

    setCustomFields((current) => {
      const fields = orderedSectionFields(section, current, contentSections);
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
      [section]: orderedSectionFields(section, current, contentSections).filter(
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

  function updateDefaultSolidColour(value: string) {
    setPrimaryColor(value);
  }

  function updateDefaultTextColour(value: string) {
    setTextColor(value);
  }

  function selectDefaultFont(font: string) {
    setDefaultFont(font);
    setPreviewSelectedFont(font);
    if (!editingTemplateId) setAllowedFonts(accessLevel === "paid" ? allowedFonts : [font]);
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

    if (section === "social") {
      return {
        enabled: showSocialSection,
        onChange: setShowSocialSection,
      };
    }

    return {
      enabled: !disabledContentSections.includes(section),
      onChange: (enabled: boolean) => {
        setDisabledContentSections((current) =>
          enabled
            ? current.filter((item) => item !== section)
            : current.includes(section)
            ? current
            : [...current, section]
        );
      },
    };
  }

  async function addContentSection() {
    const sectionName = await interaction.prompt("Section name");
    const normalized = sectionName?.trim();

    if (!normalized) return;

    const baseKey = `custom_section:${slugifyKey(normalized)}`;
    let key = baseKey;
    let count = 2;

    while (contentSections.some((section) => section.key === key)) {
      key = `${baseKey}-${count}`;
      count += 1;
    }

    setContentSections((current) => [
      ...current,
      {
        key,
        title: normalized,
        description: "Custom content section.",
        fields: [],
        custom: true,
      },
    ]);
    setCustomFields((current) => ({ ...current, [key]: [] }));
    setDisabledContentSections((current) => current.filter((item) => item !== key));
  }

  function updateContentSectionTitle(sectionKey: SectionKey, title: string) {
    setContentSections((current) =>
      current.map((section) =>
        section.key === sectionKey
          ? { ...section, title: title.trimStart() }
          : section
      )
    );
  }

  function dropContentSection(targetSection: SectionKey) {
    if (!draggedSection || draggedSection === targetSection) return;

    setContentSections((current) => {
      const currentIndex = current.findIndex((section) => section.key === draggedSection);
      const targetIndex = current.findIndex((section) => section.key === targetSection);

      if (currentIndex < 0 || targetIndex < 0) return current;

      const reordered = [...current];
      const [movedSection] = reordered.splice(currentIndex, 1);
      reordered.splice(targetIndex, 0, movedSection);

      return reordered;
    });
    setDraggedSection(null);
  }

  async function deleteContentSection(sectionKey: SectionKey) {
    const section = contentSections.find((item) => item.key === sectionKey);

    if (!section?.custom) return;

    const confirmed = await interaction.confirm(
      `Delete the "${section.title || "custom"}" section and all of its fields?`
    );

    if (!confirmed) return;

    const sectionFields = orderedSectionFields(
      sectionKey,
      customFields,
      contentSections
    );

    setContentSections((current) =>
      current.filter((item) => item.key !== sectionKey)
    );
    setCustomFields((current) => {
      const next = { ...current };
      delete next[sectionKey];
      return next;
    });
    setPreviewFieldOrder((current) => {
      const next = { ...current };
      delete next[sectionKey];
      return next;
    });
    setDisabledContentSections((current) =>
      current.filter((item) => item !== sectionKey)
    );
    setAllowedFields((current) =>
      current.filter((field) => !sectionFields.includes(field))
    );
    setExampleValues((current) => {
      const next = { ...current };

      sectionFields.forEach((field) => {
        delete next[field];
      });

      return next;
    });

    if (draggedSection === sectionKey) setDraggedSection(null);
    if (draggedField?.section === sectionKey) setDraggedField(null);
  }

  function editTemplate(template: Template) {
    pendingEdit.current = template;
    setTemplateName(template.name);
    setEditBaseline(null);
    setShowLiveTemplateConfirm(false);
    setTemplateSaveResult(null);
    setPublishError("");
    setPublishingTemplate(false);
    setEditingTemplateId(template.id);
    setTemplateSelectionConfirmed(true);
    const normalizedAccessLevel = template.access_level === "free" ? "free" : "paid";
    setAccessLevel(normalizedAccessLevel);
    setLayoutType(template.layout_type || "");
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
    setGradientDirection(readTemplateGradientDirection(template.renderer_options));
    const normalizedAllowedFonts = sanitizeAllowedFonts(
      template.allowed_fonts || defaultAllowedFonts
    );
    const nextDefaultFont =
      template.default_font && normalizedAllowedFonts.includes(template.default_font)
        ? template.default_font
        : normalizedAccessLevel === "paid"
        ? "DM Sans"
        : "Inter";
    setAllowedFonts(normalizedAllowedFonts);
    setDefaultFont(nextDefaultFont);
    setAllowedFields(sanitizeAllowedFields(template.allowed_fields || freeFields));
    setActionPermissions(actionPermissionsFromTemplate(template));
    const nextContentSections = readTemplateContentSections(
      template.field_config,
      template.custom_fields
    );
    const normalizedCustomFields = normalizeCustomFields(
      readTemplateSectionFields(template.field_config, template.custom_fields),
      nextContentSections
    );
    setCustomFields(normalizedCustomFields);
    setContentSections(nextContentSections);
    setDisabledContentSections(readTemplateDisabledSections(template.field_config));
    setPreviewFieldOrder(normalizedCustomFields);
    setPrimaryColor(template.primary_color || defaultTemplateBackgroundColour);
    setSecondaryColor(template.secondary_color || defaultTemplateGradientEnd);
    setTextColor(template.text_color || defaultTemplateTextColour);
    setButtonColor(template.button_color || "#FFFFFF");
    setButtonTextColor(template.button_text_color || "#0F0E38");
    setShowPersonalSection(template.show_personal_section ?? true);
    setShowCompanySection(template.show_company_section ?? true);
    setShowContactSection(template.show_contact_section ?? true);
    setShowSocialSection(template.show_social_section ?? false);
    setPreviewSelectedFont(nextDefaultFont);
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
    resetBuilderRef.current = resetBuilder;
  });

  function currentDraftPayload() {
    return buildTemplatePayload({
      name: templateName,
      slug: templateName.toLowerCase().trim().replaceAll(" ", "-").replace(/[^a-z0-9-]/g, ""),
      layout_type: layoutType,
      access_level: accessLevel,
      primary_color: primaryColor,
      secondary_color: secondaryColor,
      text_color: textColor,
      button_color: buttonColor,
      button_text_color: buttonTextColor,
      text_colours: [textColor],
      requires_profile_image: requiresProfileImage,
      requires_logo: accessLevel === "paid" && requiresLogo,
      requires_banner: accessLevel === "paid" && requiresBanner,
      profile_image_allowed: profileImageAllowed,
      profile_image_default_enabled: profileImageDefaultEnabled,
      logo_allowed: accessLevel === "paid" && logoAllowed,
      logo_default_enabled: accessLevel === "paid" && logoDefaultEnabled,
      banner_allowed: accessLevel === "paid" && bannerAllowed,
      banner_default_enabled: accessLevel === "paid" && bannerDefaultEnabled,
      custom_colour_allowed: accessLevel === "paid",
      custom_text_colour_allowed: accessLevel === "paid",
      gradient_enabled: accessLevel === "paid" && gradientEnabled,
      free_colour_palette: [primaryColor],
      allowed_fonts:
        accessLevel === "paid" ? sanitizeTemplateFonts(allowedFonts) : [defaultFont || "Inter"],
      default_font: defaultFont || "Inter",
      allowed_fields: allowedFields,
      allowed_actions: buildTemplateAllowedActions(actionPermissions),
      custom_fields: customFields,
      field_config: buildTemplateFieldConfig(
        allowedFields,
        customFields,
        contentSections,
        disabledContentSections
      ),
      renderer_options: buildTemplateRendererOptions(
        layoutType,
        exampleValues,
        primaryColor,
        secondaryColor,
        gradientDirection,
        accessLevel,
        accessLevel === "paid" && gradientEnabled ? "gradient" : "solid"
      ),
      show_personal_section: showPersonalSection,
      show_company_section: showCompanySection,
      show_contact_section: showContactSection,
      show_social_section: showSocialSection,
    });

  }

  const draftSnapshot = JSON.stringify(currentDraftPayload());
  useEffect(() => {
    const stored = pendingEdit.current;
    if (stored && stored.id === editingTemplateId) {
      setEditBaseline({ id: stored.id, payload: JSON.parse(draftSnapshot), stored: { ...stored } });
      pendingEdit.current = null;
    }
  }, [editingTemplateId, draftSnapshot]);

  async function saveTemplate(confirmLiveUpdate = false) {
    if (savingTemplate || saveLock.current || editTargetMissing) return;

    const requestedId = new URLSearchParams(window.location.search).get("edit");
    if (requestedId && (requestedId !== editingTemplateId || !templateUuid.test(requestedId))) {
      setTemplateError("Reload the exact template before saving."); return;
    }
    if (!templateSelectionConfirmed) {
      setTemplateError("Choose a template before saving.");
      setActiveBuilderStep("setup");
      return;
    }

    const existingTemplate = templates.find(
      (template) => template.id === editingTemplateId
    );

    if (
      (existingTemplate?.is_published || existingTemplate?.status === "published") &&
      !confirmLiveUpdate
    ) {
      setShowLiveTemplateConfirm(true);
      return;
    }

    if (!templateName.trim()) { setTemplateError("Template name is required."); return; }
    const payload = currentDraftPayload();
    const baseline = editBaseline;
    if (editingTemplateId && (!baseline || baseline.id !== editingTemplateId)) {
      setTemplateError("Reload the exact template before saving."); return;
    }
    const patch = editingTemplateId && baseline
      ? existingEditPatch(payload, baseline)
      : { ...payload, is_published: false, status: "draft" };

    try {
      setSavingTemplate(true);
      setTemplateError("");
      setTemplateMessage("");
      setPublishError("");
      setTemplateSaveResult(null);

      setShowLiveTemplateConfirm(false);
      saveLock.current = true;
      const result = await saveAdminTemplate(patch as Partial<SharedTemplate>, editingTemplateId);
      // Retain raw stored permissions; normalized read defaults must not become writes.
      const stored = { ...(baseline?.stored || {}), ...patch, id: result.template.id };
      const savedTemplate = stored as unknown as Template;
      setEditBaseline({ id: savedTemplate.id, payload, stored });
      const savedIsPublished =
        savedTemplate.is_published || savedTemplate.status === "published";

      setTemplates((current) => {
        const withoutSaved = current.filter((template) => template.id !== savedTemplate.id);
        return [savedTemplate, ...withoutSaved];
      });
      setEditingTemplateId(savedTemplate.id);
      setTemplateSaveResult({
        template: savedTemplate,
        published: Boolean(savedIsPublished),
      });
    } catch (error) {
      console.error("Template save failed", error);
      setTemplateError(
        error instanceof Error
          ? error.message
          : "Template could not be saved. Your current edits are still on screen."
      );
    } finally {
      saveLock.current = false;
      setSavingTemplate(false);
    }
  }

  function goToCurrentTemplates() {
    router.push("/templates/current");
  }

  async function publishSavedTemplate() {
    if (!templateSaveResult || publishingTemplate) return;

    try {
      setPublishingTemplate(true);
      setPublishError("");

      await publishAdminTemplate(
        templateSaveResult.template as unknown as SharedTemplate,
        true
      );
      goToCurrentTemplates();
    } catch (error) {
      console.error("Template publish failed", error);
      setPublishError(
        error instanceof Error
          ? `The template was saved, but publication failed: ${error.message}`
          : "The template was saved, but publication failed. Please try again."
      );
    } finally {
      setPublishingTemplate(false);
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
  const effectiveExampleValues = useMemo(
    () => sanitizeTemplateExampleValues(exampleValues),
    [exampleValues]
  );
  const contentReviewSections = contentSections
    .map((section) => {
      const sectionEnabled = sectionState(section.key).enabled;
      const fields = orderedSectionFields(
        section.key,
        customFields,
        contentSections
      ).map((field) => ({
        key: field,
        label: formatFieldLabel(field),
        enabled: allowedFields.includes(field),
        example: effectiveExampleValues[field]?.trim() || "",
      }));

      return {
        key: section.key,
        title: section.title.trim() || formatFieldLabel(section.key),
        custom: section.custom === true,
        enabled: sectionEnabled,
        fields,
      };
    })
    .filter((section) => !section.custom || section.fields.length > 0);
  const enabledContentFieldCount = contentReviewSections.reduce(
    (count, section) =>
      section.enabled
        ? count + section.fields.filter((field) => field.enabled).length
        : count,
    0
  );
  const allowedActionCount = actionPermissions.filter((action) => action.enabled).length;
  const defaultActionCount = actionPermissions.filter(
    (action) => action.enabled && action.default_visible
  ).length;
  const effectivePreviewSelectedColour =
    primaryColor || defaultTemplateBackgroundColour;
  const effectivePreviewSelectedTextColour =
    textColor || defaultTemplateTextColour;
  const availablePreviewFonts =
    accessLevel === "paid"
      ? sanitizeTemplateFonts(allowedFonts)
      : [defaultFont || "Inter"];
  const effectivePreviewSelectedFont = availablePreviewFonts.includes(
    previewSelectedFont
  )
    ? previewSelectedFont
    : defaultFont || availablePreviewFonts[0] || "Inter";
  const draftPayload = currentDraftPayload();
  const previewTemplate = normalizeTemplate({
    ...(editBaseline?.stored || {}),
    ...(editBaseline ? existingEditPatch(draftPayload, editBaseline) : draftPayload),
    id: editingTemplateId || "admin-preview-template",
  } as unknown as SharedTemplate);
  const previewClientTemplate = previewTemplate;
  const previewDefaultActionConfig = useMemo(
    () => buildPreviewDefaultActionConfig(actionPermissions),
    [actionPermissions]
  );
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
    company_logo_url: null,
    company_banner_url: null,
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
    selected_colour:
      accessLevel === "paid" ? effectivePreviewSelectedColour : undefined,
    selected_text_colour:
      accessLevel === "paid" ? effectivePreviewSelectedTextColour : undefined,
    selected_background_mode:
      accessLevel === "paid" && gradientEnabled ? "gradient" : "solid",
    selected_gradient_start: primaryColor,
    selected_gradient_end: secondaryColor,
    action_config: previewDefaultActionConfig,
    hidden_fields: [],
    field_visibility: {},
    custom_fields: previewCustomFieldValues(
      customFields,
      effectiveExampleValues,
      contentSections
    ),
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
    example_fields: clientExampleFields,
    action_config:
      previewActionConfig ||
      previewDefaultActionConfig,
    custom_fields: {
      ...previewCustomFieldValues(previewFieldOrder, effectiveExampleValues, contentSections),
      [cardFontKey]: effectivePreviewSelectedFont,
      ...previewCardOverrides.custom_fields,
    },
    field_order: clientFieldOrder(previewFieldOrder),
    lead_capture_settings: previewLeadSettings,
  };

  function updatePreviewCard(field: keyof SharedClientCard, value: string) {
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
      const fields = [...(current[section] || [])];
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

    if (step.key !== "setup" && !templateSelectionConfirmed) {
      setTemplateError("Choose a template before continuing.");
      setActiveBuilderStep("setup");
      return;
    }

    setTemplateError("");
    setActiveBuilderStep(step.key);
  }

  function renderBuilderStep() {
    if (activeBuilderStep === "setup") {
      return (
        <StepPanel
          title="Setup"
          description="Choose who can use this template and which layout it is based on."
        >
          <div className={builderPanelClass}>
            <div>
              <h3 className={builderPanelHeadingClass}>Template Selection</h3>
              <p className={builderPanelDescriptionClass}>
                Choose the access level and template to build.
              </p>
            </div>

            <Field label="Template name">
              <input aria-label="Template name" className={builderSelectClass} value={templateName} onChange={(event) => setTemplateName(event.target.value)} />
            </Field>
            {editingTemplateId && <p className="mt-3 text-sm text-[var(--dmi-muted)]">Editing this saved template. Layout, access and slug are preserved.</p>}
            <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="Access Level">
                <select
                  disabled={Boolean(editingTemplateId) || editTargetMissing}
                  value={accessLevel}
                  onChange={(e) => selectAccessLevel(e.target.value)}
                  className={builderSelectClass}
                >
                  <option value="free">Free</option>
                  <option value="paid">Paid</option>
                </select>
              </Field>

              <Field label="Template">
                <select
                  disabled={Boolean(editingTemplateId) || editTargetMissing}
                  value={templateSelectionConfirmed ? layoutType : ""}
                  onChange={(e) => selectLayout(e.target.value)}
                  className={builderSelectClass}
                >
                  <option value="" disabled>
                    Select a template
                  </option>
                  {editingTemplateId && !getTemplateLayout(layoutType) && <option value={layoutType}>{layoutType || "Unknown layout"} (preserved)</option>}
                  {layoutOptions.map((layout) => (
                    <option key={layout.value} value={layout.value}>
                      {layout.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </div>

          <div className={`mt-6 ${builderPanelClass}`}>
            <div>
              <h3 className={builderPanelHeadingClass}>Images &amp; Branding</h3>
              <p className={builderPanelDescriptionClass}>
                Choose which media elements are available for clients to use.
              </p>
            </div>

            <div className="mt-5 space-y-3">
              <MediaCapabilityRow
                title="Profile Picture"
                description="Allow clients to upload a profile photo. Clients can choose to show or hide it."
                support={currentMediaDefinition.profile}
                enabled={profileImageAllowed}
                onEnabledChange={(value) => {
                  updateMediaCapability("profile", value);
                }}
              />
              <MediaCapabilityRow
                title="Company Logo"
                description="Allow clients to upload a company logo. Modern Minimal displays it as a watermark."
                support={currentMediaDefinition.logo}
                enabled={accessLevel === "paid" && logoAllowed}
                onEnabledChange={(value) => {
                  updateMediaCapability("logo", value);
                }}
              />
              <MediaCapabilityRow
                title="Banner Image"
                description="Allow clients to upload a banner image. Clients can choose to show or hide it."
                support={currentMediaDefinition.banner}
                enabled={accessLevel === "paid" && bannerAllowed}
                onEnabledChange={(value) => {
                  updateMediaCapability("banner", value);
                }}
              />
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
              ? "Set the paid template background, text colour and typography defaults."
              : "Set the fixed default colours and typography for this free template."
          }
        >
          <DesignPanel
            title="Colours"
            description={
              accessLevel === "paid"
                ? "Choose the paid template background mode and unrestricted default text colour."
                : "Choose the fixed card and text colours for this free template."
            }
          >
            {accessLevel === "paid" && (
              <div className="mb-5 grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setGradientEnabled(false)}
                  className={`rounded-2xl border px-4 py-3 text-left text-sm font-semibold transition ${
                    !gradientEnabled
                      ? "border-[var(--border-brand)] bg-[color-mix(in_srgb,var(--brand-secondary)_14%,var(--dmi-surface))] text-[var(--text-primary)] shadow-[0_12px_28px_color-mix(in_srgb,var(--brand-secondary)_12%,transparent)]"
                      : "border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] text-[var(--dmi-muted)] hover:border-[var(--border-brand)] hover:bg-[var(--button-hover-bg)] hover:text-[var(--foreground)]"
                  }`}
                >
                  Solid
                  <span className="mt-1 block text-xs font-normal text-[var(--dmi-muted)]">
                    One clean card colour.
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setGradientEnabled(true)}
                  className={`rounded-2xl border px-4 py-3 text-left text-sm font-semibold transition ${
                    gradientEnabled
                      ? "border-[var(--border-brand)] bg-[color-mix(in_srgb,var(--brand-secondary)_14%,var(--dmi-surface))] text-[var(--text-primary)] shadow-[0_12px_28px_color-mix(in_srgb,var(--brand-secondary)_12%,transparent)]"
                      : "border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] text-[var(--dmi-muted)] hover:border-[var(--border-brand)] hover:bg-[var(--button-hover-bg)] hover:text-[var(--foreground)]"
                  }`}
                >
                  Gradient
                  <span className="mt-1 block text-xs font-normal text-[var(--dmi-muted)]">
                    Two-colour premium background.
                  </span>
                </button>
              </div>
            )}

            <div className="grid gap-4 lg:grid-cols-2">
              <ColourPicker
                label={
                  accessLevel === "paid" && gradientEnabled
                    ? "Card Colour 1"
                    : "Card Colour"
                }
                value={primaryColor}
                onChange={updateDefaultSolidColour}
                showHexInput={false}
              />
              <ColourPicker
                label="Text Colour"
                value={textColor}
                onChange={updateDefaultTextColour}
                showHexInput={false}
              />
              {accessLevel === "paid" && gradientEnabled && (
                <>
                  <ColourPicker
                    label="Card Colour 2"
                    value={secondaryColor}
                    onChange={setSecondaryColor}
                    showHexInput={false}
                  />
                  <GradientDirectionCard
                    value={gradientDirection}
                    onChange={setGradientDirection}
                  />
                </>
              )}
            </div>
          </DesignPanel>

          <div className="mt-5">
            <TypographyPicker
              accessLevel={accessLevel}
              selectedFont={defaultFont || "Inter"}
              fonts={editingTemplateId ? [...new Set([...allowedFonts, defaultFont])] : fontChoices}
              onSelectFont={selectDefaultFont}
            />
          </div>
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

            {contentSections.map((section) => {
              const { enabled, onChange } = sectionState(section.key);
              const sectionDragging = draggedSection === section.key;

              return (
                <SectionControl
                  key={section.key}
                  section={section.key}
                  title={section.title}
                  description={section.description}
                  fields={orderedSectionFields(
                    section.key,
                    customFields,
                    contentSections
                  )}
                  builtInFields={section.fields}
                  customSection={section.custom === true}
                  enabled={enabled}
                  allowedFields={allowedFields}
                  exampleValues={effectiveExampleValues}
                  onToggleSection={() => onChange(!enabled)}
                  onUpdateSectionTitle={(title) =>
                    updateContentSectionTitle(section.key, title)
                  }
                  onToggleField={toggleAllowedField}
                  onUpdateExampleValue={updateExampleValue}
                  onAddField={() => addCustomField(section.key)}
                  onDeleteSection={() => deleteContentSection(section.key)}
                  onDeleteField={(field) => deleteCustomField(section.key, field)}
                  draggedField={draggedField}
                  sectionDragging={sectionDragging}
                  onSectionDragStart={() => setDraggedSection(section.key)}
                  onSectionDragEnd={() => setDraggedSection(null)}
                  onSectionDrop={() => dropContentSection(section.key)}
                  onDragStart={(field) =>
                    setDraggedField({ section: section.key, field })
                  }
                  onDragEnd={() => setDraggedField(null)}
                  onDropField={(field) => dropField(section.key, field)}
                />
              );
            })}
            <button
              type="button"
              onClick={addContentSection}
              className="w-full rounded-2xl border border-dashed border-[var(--border-brand)] bg-[color-mix(in_srgb,var(--brand-secondary)_10%,var(--dmi-surface))] px-4 py-3 text-sm font-semibold text-[var(--text-accent)] transition hover:bg-[color-mix(in_srgb,var(--brand-secondary)_14%,var(--dmi-surface))] focus:outline-none focus:ring-2 focus:ring-[var(--brand-secondary)] focus:ring-offset-2 focus:ring-offset-[var(--background)]"
            >
              + Add Section
            </button>
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
            collapsedGroups={collapsedActionGroups}
            onToggleAction={toggleActionPermission}
            onToggleDefault={toggleActionDefault}
            onUpdateDefaultLabel={updateActionDefaultLabel}
            onToggleGroup={toggleActionGroup}
            onAddCustomAction={addCustomAction}
            onDeleteCustomAction={deleteCustomAction}
          />
        </StepPanel>
      );
    }

    return (
      <StepPanel
        title="Review"
        description="Final check before saving or updating this template."
      >
        <div className="grid gap-4 xl:grid-cols-2">
          <ReviewCard
            icon={ClipboardList}
            title="Setup"
            items={[
              ["Template", selectedTemplateName],
              [
                "Access",
                <ReviewBadge
                  key="access"
                  tone={accessLevel === "free" ? "neutral" : "accent"}
                >
                  {accessLevel === "free" ? "Free" : "Paid"}
                </ReviewBadge>,
              ],
              ["Layout", selectedTemplateName],
              [
                "Status",
                <ReviewBadge
                  key="status"
                  tone={currentPublicationStatus === "Published" ? "accent" : "neutral"}
                >
                  {currentPublicationStatus}
                </ReviewBadge>,
              ],
            ]}
          />
          <ReviewCard
            icon={ImageIcon}
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
            icon={Palette}
            title="Design"
            items={[
              accessLevel === "paid"
                ? ["Default background", gradientEnabled ? "Gradient" : "Solid"]
                : ["Card colour", <ReviewColourValue key="card-colour" colour={primaryColor} />],
              accessLevel === "paid"
                ? [
                    gradientEnabled ? "Gradient colours" : "Solid colour",
                    gradientEnabled ? (
                      <ReviewGradientValue
                        key="gradient-colours"
                        start={primaryColor}
                        end={secondaryColor}
                      />
                    ) : (
                      <ReviewColourValue key="solid-colour" colour={primaryColor} />
                    ),
                  ]
                : ["Text colour", <ReviewColourValue key="text-colour" colour={textColor} />],
              accessLevel === "paid"
                ? [
                    "Gradient direction",
                    gradientEnabled ? gradientDirectionLabel(gradientDirection) : "Not used",
                  ]
                : ["Typography", defaultFont || "Inter"],
              accessLevel === "paid"
                ? ["Text colour", <ReviewColourValue key="paid-text-colour" colour={textColor} />]
                : ["Client colour controls", "Not exposed"],
              accessLevel === "paid"
                ? ["Typography", `${defaultFont || "Inter"} default · client-selectable later`]
                : ["Client typography controls", "Not exposed"],
            ]}
          />
          <ReviewCard
            icon={Layers}
            title="Content"
            items={[
              [
                "Summary",
                `${contentReviewSections.length} sections · ${enabledContentFieldCount} enabled fields`,
              ],
              [
                "Configuration",
                <ContentReviewSummary
                  key="content-review-summary"
                  sections={contentReviewSections}
                />,
              ],
            ]}
          />
          <ReviewCard
            icon={Share2}
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
    <AdminShell>
      {interaction.dialog}

      <section className={adminStyles.page}>
        <div className="mb-8"><AdminPageHeader title="Template Builder" subtitle="Create and edit reusable card layouts. Clients will customise colours and content later." /></div>

        {templateMessage && (
          <div className="mb-6 rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-success-bg)] px-5 py-4 text-sm text-[var(--admin-success-text)]">
            {templateMessage}
          </div>
        )}

        {templateError && (
          <div className="mb-6 rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-attention-bg)] px-5 py-4 text-sm font-medium text-[var(--admin-attention-text)]">
            {templateError}
          </div>
        )}

        <div className={`${adminStyles.builderGrid} mb-10`}>
          <div className={builderWorkspaceClass}>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-2xl font-semibold text-[var(--text-primary)]">
                  {editingTemplateId ? "Edit Template" : "Template Builder"}
                </h2>

                <p className="mt-1 text-sm text-[var(--dmi-muted)]">
                  {editingTemplateId
                    ? "Update this template and save your changes."
                    : "Choose sensible defaults by access level, then manually tune the template rules."}
                </p>
              </div>

              {editingTemplateId && (
                <button
                  onClick={goToCurrentTemplates}
                  className={builderSecondaryButtonClass}
                >
                  Cancel Edit
                </button>
              )}
            </div>

            <TemplateStepNavigation
              steps={templateBuilderSteps}
              activeStep={activeBuilderStep}
              onStepChange={handleBuilderStepChange}
            />

            {renderBuilderStep()}

            <div className="mt-8 flex flex-col gap-3 border-t border-[var(--dmi-border)] pt-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-h-11">
                {activeStepIndex > 0 && (
                  <button
                    type="button"
                    onClick={() => goToBuilderStep(activeStepIndex - 1)}
                    className={`${builderSecondaryButtonClass} w-full justify-center sm:w-auto`}
                  >
                    Back
                  </button>
                )}
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                {activeBuilderStep !== "review" && (
                  <button
                    type="button"
                    onClick={() => goToBuilderStep(activeStepIndex + 1)}
                    className={`${builderPrimaryButtonClass} w-full justify-center sm:w-auto`}
                  >
                    Next
                  </button>
                )}

                {activeBuilderStep === "review" && (
                  <button
                    type="button"
                    onClick={() => void saveTemplate()}
                    disabled={savingTemplate}
                    className={`${builderPrimaryButtonClass} w-full justify-center px-6 py-3.5 sm:w-auto sm:min-w-44`}
                  >
                    {savingTemplate
                      ? "Saving..."
                      : editingTemplateId
                      ? "Update Template"
                      : "Save New Template"}
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className={`${builderWorkspaceClass} ${adminStyles.livePreview} mx-auto w-full max-w-[560px]`}>
            <div className="mb-6">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div>
                  <h2 className="text-2xl font-semibold text-[var(--text-primary)]">
                    Live Preview
                  </h2>
                  <p className="mt-1 text-sm text-[var(--dmi-muted)]">
                    Current Admin draft rendered by the existing CardRenderer.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setPreviewFieldOrder(
                      normalizeCustomFields(customFields, contentSections)
                    );
                    setPreviewActionConfig(null);
                    setClientPreviewOpen(true);
                  }}
                  className={builderSecondaryButtonClass}
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
                onSelectFont={(font) => updatePreviewCustomField(cardFontKey, font)}
              />
            )}
          </div>
        </div>

        {showLiveTemplateConfirm && (
          <LiveTemplateUpdateModal
            saving={savingTemplate}
            onCancel={() => setShowLiveTemplateConfirm(false)}
            onConfirm={() => void saveTemplate(true)}
          />
        )}
        {templateSaveResult && (
          <TemplateSaveResultModal
            result={templateSaveResult}
            publishing={publishingTemplate}
            error={publishError}
            onNotNow={goToCurrentTemplates}
            onPublishNow={() => void publishSavedTemplate()}
            onGoToCurrentTemplates={goToCurrentTemplates}
          />
        )}
      </section>
    </AdminShell>
  );
}

function LiveTemplateUpdateModal({
  saving,
  onCancel,
  onConfirm,
}: {
  saving: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialog = useAdminDialog(onCancel, !saving);
  return (
    <div
      {...dialog}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 px-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="live-template-update-title"
    >
      <div className={builderModalPanelClass}>
        <h2
          id="live-template-update-title"
          className="text-xl font-semibold text-[var(--text-primary)]"
        >
          Update live template?
        </h2>
        <p className="mt-3 text-sm leading-6 text-[var(--dmi-muted)]">
          This template is currently published and available to clients.
          Confirm that these are the final changes you want to apply.
        </p>
        <div className="mt-6 flex flex-col justify-end gap-3 sm:flex-row">
          <button
            type="button"
            data-dialog-initial-focus onClick={onCancel}
            disabled={saving}
            className={builderSecondaryButtonClass}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={saving}
            className={builderPrimaryButtonClass}
          >
            {saving ? "Updating..." : "Update Template"}
          </button>
        </div>
      </div>
    </div>
  );
}

function TemplateSaveResultModal({
  result,
  publishing,
  error,
  onNotNow,
  onPublishNow,
  onGoToCurrentTemplates,
}: {
  result: TemplateSaveResult;
  publishing: boolean;
  error: string;
  onNotNow: () => void;
  onPublishNow: () => void;
  onGoToCurrentTemplates: () => void;
}) {
  const dialog = useAdminDialog(result.published ? undefined : onNotNow, !result.published && !publishing);
  if (result.published) {
    return (
      <div
        {...dialog}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 px-4 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="template-updated-title"
      >
        <div className={builderModalPanelClass}>
          <h2
            id="template-updated-title"
            className="text-xl font-semibold text-[var(--text-primary)]"
          >
            Template updated
          </h2>
          <p className="mt-3 text-sm leading-6 text-[var(--dmi-muted)]">
            Your changes have been saved to this live template.
          </p>
          <div className="mt-6 flex justify-end">
            <button
              type="button"
              data-dialog-initial-focus onClick={onGoToCurrentTemplates}
              className={builderPrimaryButtonClass}
            >
              Go to Current Templates
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      {...dialog}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 px-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="publish-template-title"
    >
      <div className={builderModalPanelClass}>
        <h2
          id="publish-template-title"
          className="text-xl font-semibold text-[var(--text-primary)]"
        >
          Publish template?
        </h2>
        <p className="mt-3 text-sm leading-6 text-[var(--dmi-muted)]">
          The template has been saved successfully. Would you like to publish it
          now and make it available to clients?
        </p>
        {error && (
          <div className="mt-4 rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-500">
            {error}
          </div>
        )}
        <div className="mt-6 flex flex-col justify-end gap-3 sm:flex-row">
          <button
            type="button"
            data-dialog-initial-focus onClick={onNotNow}
            disabled={publishing}
            className={builderSecondaryButtonClass}
          >
            Not Now
          </button>
          <button
            type="button"
            onClick={onPublishNow}
            disabled={publishing}
            className={builderPrimaryButtonClass}
          >
            {publishing ? "Publishing..." : "Publish Now"}
          </button>
        </div>
      </div>
    </div>
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
      <span className="mb-2 block text-sm font-medium text-[var(--dmi-muted)]">
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
  fieldOrder: CustomFields;
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
  const { ref: previewDialogRef } = useAdminDialog(onClose, true, true);
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
  const plan = template.access_level === "paid" ? "pro" : "free";
  const previewCard = reconcileClientCard({ ...cardData, field_order: resolveClientFieldOrder(template, plan, clientFieldOrder(fieldOrder)) }, template, plan).card;
  const previewTemplate = {
    ...template,
    custom_fields: previewCard.field_order,
    field_config: { ...template.field_config, sections: previewCard.field_order },
  };

  return (
    <div ref={previewDialogRef} className={adminStyles.clientPreview}>
    <CardEditorModalShell
      title="Client Experience Preview"
      description={`Previewing ${template.name || "current Admin draft"} with local sample data. Changes here do not save. Publishing requirements are not checked.`}
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
          draftCard={previewCard}
          fieldOrder={previewCard.field_order || clientFieldOrder({})}
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
          enforceClientContract
          saveStatus="idle"
          saveMessage=""
          saveError=""
        />

        <aside className="min-w-0">
          <div className="client-portal-panel sticky top-0 p-5">
            <PreviewPanelContent
              title="Live Edit Preview"
              previewCard={previewCard}
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
    </div>
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
    <div className="flex min-h-[520px] items-center justify-center overflow-hidden rounded-[24px] border border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] p-3 sm:min-h-[620px] sm:p-5">
      <div className="relative w-full max-w-[360px] rounded-[2.7rem] bg-gradient-to-br from-black via-[#101016] to-[#1B1230] p-2.5 shadow-[0_22px_60px_color-mix(in_srgb,var(--brand-navy)_28%,transparent)]">
        <div className="pointer-events-none absolute left-1/2 top-[18px] z-20 h-7 w-24 -translate-x-1/2 rounded-full bg-black shadow-inner shadow-white/10" />
        <div
          className="h-[460px] overflow-y-auto overflow-x-hidden rounded-[2rem] bg-[#070B1A] [-ms-overflow-style:none] [scrollbar-width:none] sm:h-[560px] [&::-webkit-scrollbar]:hidden"
          style={{
            // Island top + height - shell padding, measured from the screen's top.
            "--card-viewport-safe-top": "calc(18px + 1.75rem - 0.625rem)",
          } as React.CSSProperties}
        >
          <CardRenderer
            mode="preview"
            template={template}
            cardData={cardData}
            showMediaPlaceholders
            previewActionDestinations
          />
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
    <div className="mt-6 overflow-x-auto rounded-[24px] border border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] p-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <ol className="flex min-w-max gap-2 md:grid md:min-w-0 md:grid-cols-5">
        {steps.map((step, index) => {
          const selected = step.key === activeStep;

          return (
            <li key={step.key} className="w-36 shrink-0 md:w-auto">
              <button
                type="button"
                onClick={() => onStepChange(step.key)}
                className={`flex h-12 w-full items-center gap-2 rounded-[18px] px-3 text-left text-sm transition ${
                  selected
                    ? "bg-[linear-gradient(135deg,var(--brand-primary),var(--brand-secondary))] !text-white shadow-[0_10px_28px_color-mix(in_srgb,var(--brand-secondary)_24%,transparent)] [&_*]:!text-white [&_svg]:!text-white"
                    : "bg-[var(--dmi-surface)] text-[var(--dmi-muted)] hover:bg-[var(--button-hover-bg)] hover:text-[var(--foreground)]"
                }`}
              >
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                    selected
                      ? "bg-white/20 !text-white ring-1 ring-white/35"
                      : "bg-[var(--dmi-surface-soft)] text-[var(--dmi-muted)]"
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
  children: ReactNode;
}) {
  return (
    <div className="mt-6">
      <div className="mb-6">
        <h3 className="text-2xl font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
          {title}
        </h3>
        <p className="mt-2 text-sm leading-6 text-[var(--dmi-muted)]">
          {description}
        </p>
      </div>
      {children}
    </div>
  );
}

function MediaCapabilityRow({
  title,
  description,
  support,
  enabled,
  onEnabledChange,
}: {
  title: string;
  description: string;
  support: TemplateMediaSupport;
  enabled: boolean;
  onEnabledChange: (value: boolean) => void;
}) {
  const unsupported = support === "unsupported";
  const required = support === "required";
  const disabled = unsupported || required;
  const stateLabel = unsupported
    ? "Unsupported"
    : required
    ? "Required"
    : enabled
    ? "Enabled"
    : "Disabled";
  const stateEnabled = required || (!unsupported && enabled);
  const iconLabel = title
    .split(" ")
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div
      className={`grid min-h-[96px] gap-4 rounded-2xl border border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] p-4 transition lg:grid-cols-[minmax(0,1fr)_180px] lg:items-center ${
        disabled ? "opacity-70" : ""
      }`}
    >
      <div className="flex gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-[var(--dmi-border)] bg-[var(--dmi-surface)] text-[var(--text-accent)]">
          <span className="text-[10px] font-bold uppercase tracking-[0.14em]">
            {iconLabel}
          </span>
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-[var(--text-primary)]">{title}</p>
          <p className="mt-1 text-xs leading-relaxed text-[var(--dmi-muted)]">
            {description}
          </p>
        </div>
      </div>
      <div className="flex min-w-0 items-center justify-start gap-3 lg:justify-end">
        <span className="w-[96px] text-right text-sm font-semibold text-[var(--dmi-muted)]">
          {stateLabel}
        </span>
        <ToggleSwitch
          checked={stateEnabled}
          disabled={disabled}
          ariaLabel={`${title} media capability`}
          focusRingOffsetClass="focus:ring-offset-[var(--dmi-surface)]"
          onToggle={() => onEnabledChange(!enabled)}
        />
      </div>
    </div>
  );
}

function DesignPanel({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className={builderPanelClass}>
      <div>
        <h3 className={builderPanelHeadingClass}>{title}</h3>
        <p className={builderPanelDescriptionClass}>{description}</p>
      </div>
      <div className="mt-5">{children}</div>
    </div>
  );
}

function GradientDirectionCard({
  value,
  onChange,
}: {
  value: GradientDirection;
  onChange: (value: GradientDirection) => void;
}) {
  return (
    <label
      className="block rounded-2xl border border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] p-3"
    >
      <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">
        Gradient Direction
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as GradientDirection)}
        className="h-12 w-full rounded-2xl border border-[var(--input-border)] bg-[var(--input-bg)] px-4 text-sm font-semibold text-[var(--input-text)] outline-none transition focus:border-[var(--input-focus)] focus:ring-4 focus:ring-[var(--input-focus-ring)]"
      >
        {gradientDirectionOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function TypographyPicker({
  fonts,
  accessLevel,
  selectedFont,
  onSelectFont,
}: {
  fonts: readonly string[];
  accessLevel: string;
  selectedFont: string;
  onSelectFont: (font: string) => void;
}) {
  return (
    <DesignPanel
      title="Typography"
      description={
        accessLevel === "paid"
          ? "Choose the default font. Client choices follow the saved font permissions."
          : "Choose the saved font for this free template. Free clients do not receive typography controls."
      }
    >
      <div className="grid grid-cols-[repeat(auto-fit,minmax(135px,1fr))] gap-3">
        {fonts.map((font) => {
          const selected = selectedFont === font;

          return (
            <button
              key={font}
              type="button"
              onClick={() => onSelectFont(font)}
              className={`relative rounded-2xl border p-4 text-left transition ${
                selected
                  ? "border-[var(--border-brand)] bg-[color-mix(in_srgb,var(--brand-secondary)_14%,var(--dmi-surface))] text-[var(--text-primary)] shadow-[0_12px_28px_color-mix(in_srgb,var(--brand-secondary)_12%,transparent)]"
                  : "border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] text-[var(--dmi-muted)] hover:border-[var(--border-brand)] hover:bg-[var(--button-hover-bg)] hover:text-[var(--foreground)]"
              }`}
            >
              {selected && (
                <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-md bg-[linear-gradient(135deg,var(--brand-primary),var(--brand-secondary))] text-xs !text-white">
                  ✓
                </span>
              )}
              <p className="pr-7 text-sm font-semibold">{font}</p>
              <p
                className="mt-5 text-3xl font-semibold leading-none"
                style={{ fontFamily: font }}
              >
                Aa
              </p>
            </button>
          );
        })}
      </div>
    </DesignPanel>
  );
}

function ReviewCard({
  icon: Icon,
  title,
  items,
}: {
  icon: LucideIcon;
  title: string;
  items: [string, ReactNode][];
}) {
  return (
    <div className={builderPanelClass}>
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] text-[var(--text-accent)]">
          <Icon className="h-4 w-4" />
        </span>
        <h3 className={builderPanelHeadingClass}>{title}</h3>
      </div>
      <dl className="mt-5 space-y-3">
        {items.map(([label, value]) => (
          <div
            key={`${title}-${label}`}
            className="grid gap-1 rounded-2xl border border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] px-4 py-3 text-sm sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] sm:gap-4"
          >
            <dt className="min-w-0 break-words text-[var(--dmi-muted)]">
              {label}
            </dt>
            <dd className="min-w-0 break-words font-semibold text-[var(--text-primary)]">
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function ContentReviewSummary({
  sections,
}: {
  sections: Array<{
    key: string;
    title: string;
    custom: boolean;
    enabled: boolean;
    fields: Array<{
      key: string;
      label: string;
      enabled: boolean;
      example: string;
    }>;
  }>;
}) {
  if (sections.length === 0) {
    return <span className="text-[var(--dmi-muted)]">No content sections configured.</span>;
  }

  return (
    <div className="space-y-2 font-normal">
      {sections.map((section) => (
        <div
          key={section.key}
          className="rounded-xl border border-[var(--dmi-border)] bg-[var(--dmi-surface)] p-3"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-[var(--text-primary)]">
              {section.title}
            </span>
            <ReviewBadge tone={section.enabled ? "accent" : "neutral"}>
              {section.enabled ? "Enabled" : "Disabled"}
            </ReviewBadge>
            <ReviewBadge>{section.custom ? "Custom" : "Built-in"}</ReviewBadge>
          </div>

          {section.fields.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {section.fields.map((field) => (
                <li
                  key={`${section.key}-${field.key}`}
                  className="rounded-lg border border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] px-3 py-2"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-[var(--text-primary)]">
                      {field.label}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        field.enabled
                          ? "bg-[color-mix(in_srgb,var(--brand-secondary)_10%,var(--dmi-surface))] text-[var(--text-accent)]"
                          : "bg-[var(--dmi-surface)] text-[var(--dmi-muted)]"
                      }`}
                    >
                      {field.enabled ? "Enabled" : "Disabled"}
                    </span>
                  </div>
                  {field.example && (
                    <p className="mt-1 break-words text-xs font-normal text-[var(--dmi-muted)]">
                      Example: {field.example}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-xs font-normal text-[var(--dmi-muted)]">
              No fields configured.
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function ReviewBadge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "accent";
}) {
  return (
    <span
      className={`inline-flex w-fit items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${
        tone === "accent"
          ? "border-[var(--border-brand)] bg-[color-mix(in_srgb,var(--brand-secondary)_10%,var(--dmi-surface))] text-[var(--text-accent)]"
          : "border-[var(--dmi-border)] bg-[var(--dmi-surface)] text-[var(--text-primary)]"
      }`}
    >
      {children}
    </span>
  );
}

function ReviewColourValue({ colour }: { colour: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-2">
      <span
        className="h-4 w-4 shrink-0 rounded-full border border-[var(--dmi-border)]"
        style={{ backgroundColor: colour }}
      />
      <span className="min-w-0 break-all">{colour}</span>
    </span>
  );
}

function ReviewGradientValue({
  start,
  end,
}: {
  start: string;
  end: string;
}) {
  return (
    <span className="flex min-w-0 flex-col gap-1">
      <ReviewColourValue colour={start} />
      <ReviewColourValue colour={end} />
    </span>
  );
}

function ActionButtonsControl({
  actions,
  collapsedGroups,
  onToggleAction,
  onToggleDefault,
  onUpdateDefaultLabel,
  onToggleGroup,
  onAddCustomAction,
  onDeleteCustomAction,
}: {
  actions: ActionPermissionDraft[];
  collapsedGroups: Record<string, boolean>;
  onToggleAction: (actionId: string) => void;
  onToggleDefault: (actionId: string) => void;
  onUpdateDefaultLabel: (actionId: string, label: string) => void;
  onToggleGroup: (group: string) => void;
  onAddCustomAction: () => void;
  onDeleteCustomAction: (actionId: string) => void;
}) {
  const enabledCount = actions.filter((action) => action.enabled).length;
  const defaultCount = actions.filter(
    (action) => action.enabled && action.default_visible
  ).length;
  const actionById = new Map(actions.map((action) => [action.id, action]));
  const builtInGroups = actionGroupOrder.map((group) => ({
    group,
    actions: cardActionDefinitions
      .filter((definition) => definition.group === group)
      .map((definition) => actionById.get(definition.type))
      .filter((action): action is ActionPermissionDraft => Boolean(action)),
  }));
  const customActions = actions.filter((action) => action.custom_action);

  return (
    <div className={builderPanelClass}>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h3 className={builderPanelHeadingClass}>Action Buttons</h3>
          <p className={`${builderPanelDescriptionClass} max-w-2xl`}>
            Choose which visitor actions clients can add to cards using this
            template. Defaults apply only when a new card is created.
          </p>
        </div>
        <span className="w-fit rounded-full border border-[var(--border-brand)] bg-[color-mix(in_srgb,var(--brand-secondary)_10%,var(--dmi-surface))] px-3 py-1 text-xs font-semibold text-[var(--text-accent)]">
          {enabledCount} allowed · {defaultCount} default
        </span>
      </div>

      <div className="mt-5 space-y-3">
        {builtInGroups.map(({ group, actions: groupActions }) => (
          <ActionGroupPanel
            key={group}
            title={group}
            actions={groupActions}
            collapsed={collapsedGroups[group] === true}
            onToggleGroup={() => onToggleGroup(group)}
            onToggleAction={onToggleAction}
            onToggleDefault={onToggleDefault}
            onUpdateDefaultLabel={onUpdateDefaultLabel}
          />
        ))}

        <div className={actionCategoryCardClass}>
          <ActionCategoryHeader
            icon={Plus}
            title="Custom Actions"
            description="Add reusable template actions with stable generated IDs."
          >
            <button
              type="button"
              onClick={onAddCustomAction}
              className={builderSecondaryButtonClass}
            >
              + Add Custom Action
            </button>
          </ActionCategoryHeader>

          {customActions.length > 0 && (
            <div className={actionCategoryBodyClass}>
              {customActions.map((action) => (
                <ActionControlRow
                  key={action.id}
                  action={action}
                  onToggleAction={onToggleAction}
                  onToggleDefault={onToggleDefault}
                  onUpdateDefaultLabel={onUpdateDefaultLabel}
                  onDeleteCustomAction={onDeleteCustomAction}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ActionGroupPanel({
  title,
  actions,
  collapsed,
  onToggleGroup,
  onToggleAction,
  onToggleDefault,
  onUpdateDefaultLabel,
}: {
  title: string;
  actions: ActionPermissionDraft[];
  collapsed: boolean;
  onToggleGroup: () => void;
  onToggleAction: (actionId: string) => void;
  onToggleDefault: (actionId: string) => void;
  onUpdateDefaultLabel: (actionId: string, label: string) => void;
}) {
  const enabledCount = actions.filter((action) => action.enabled).length;
  const Icon = actionGroupIcon(title);

  return (
    <div className={actionCategoryCardClass}>
      <ActionCategoryHeader
        icon={Icon}
        title={title}
        description={`${enabledCount} of ${actions.length} available`}
      >
        <button
          type="button"
          onClick={onToggleGroup}
          className="shrink-0 rounded-full border border-[var(--dmi-border)] bg-[var(--button-secondary-bg)] px-3 py-1 text-xs font-semibold text-[var(--button-secondary-text)] transition hover:border-[var(--border-brand)] hover:bg-[var(--button-hover-bg)] hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-secondary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]"
        >
          {collapsed ? "Expand" : "Collapse"}
        </button>
      </ActionCategoryHeader>

      {!collapsed && (
        <div className={actionCategoryBodyClass}>
          {actions.map((action) => (
            <ActionControlRow
              key={action.id}
              action={action}
              onToggleAction={onToggleAction}
              onToggleDefault={onToggleDefault}
              onUpdateDefaultLabel={onUpdateDefaultLabel}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ActionCategoryHeader({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className={actionCategoryHeaderClass}>
      <span className="flex min-w-0 items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] text-[var(--text-accent)]">
          <Icon className="h-4 w-4" />
        </span>
        <span className="min-w-0">
          <span className="block font-semibold text-[var(--text-primary)]">
            {title}
          </span>
          <span className="mt-1 block text-xs leading-relaxed text-[var(--dmi-muted)]">
            {description}
          </span>
        </span>
      </span>
      <span className="shrink-0">{children}</span>
    </div>
  );
}

function ActionControlRow({
  action,
  onToggleAction,
  onToggleDefault,
  onUpdateDefaultLabel,
  onDeleteCustomAction,
}: {
  action: ActionPermissionDraft;
  onToggleAction: (actionId: string) => void;
  onToggleDefault: (actionId: string) => void;
  onUpdateDefaultLabel: (actionId: string, label: string) => void;
  onDeleteCustomAction?: (actionId: string) => void;
}) {
  const definition = cardActionDefinitions.find(
    (item) => item.type === action.type
  );
  const configurable = actionLabelIsConfigurable(action.type) || action.custom_action;
  const actionName =
    action.action_name ||
    definition?.label ||
    defaultLabelForActionType(action.type);
  const description =
    action.custom_action
      ? customActionDescription(action)
      : definition?.description || "Template-controlled action.";

  return (
    <div className={actionRowClass}>
      <div className="min-w-0 md:col-span-2 2xl:col-span-1">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-[var(--dmi-border)] bg-[var(--dmi-surface)] text-[var(--text-accent)]">
            <ActionTypeIcon type={action.type} />
          </span>
          <span className="min-w-0">
            <p className="font-semibold text-[var(--text-primary)]">
              {actionName}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-[var(--dmi-muted)]">
              {description}
            </p>
          </span>
        </div>
        {configurable && (
          <label className="mt-3 block max-w-sm">
            <span className="mb-1 block text-xs font-medium text-[var(--dmi-muted)]">
              Button label
            </span>
            <input
              value={action.default_label}
              onChange={(event) =>
                onUpdateDefaultLabel(action.id, event.target.value)
              }
              className="inputStyle h-10"
            />
          </label>
        )}
      </div>

      <ActionToggle
        label="Available to client"
        checked={action.enabled}
        onToggle={() => onToggleAction(action.id)}
      />
      <ActionToggle
        label="Enabled by default"
        checked={action.enabled && action.default_visible}
        disabled={!action.enabled}
        onToggle={() => onToggleDefault(action.id)}
      />
      {action.custom_action && onDeleteCustomAction ? (
        <button
          type="button"
          onClick={() => onDeleteCustomAction(action.id)}
          className="w-fit rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-500 transition hover:bg-red-500/15 disabled:opacity-50 md:col-span-2 2xl:col-span-1"
        >
          Delete
        </button>
      ) : (
        <span className="hidden 2xl:block" aria-hidden="true" />
      )}
    </div>
  );
}

function ActionToggle({
  label,
  checked,
  disabled = false,
  onToggle,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-3 rounded-2xl border border-[var(--dmi-border)] bg-[var(--dmi-surface)] px-3 py-2">
      <span className="text-xs font-semibold text-[var(--text-primary)]">
        {label}
      </span>
      <ToggleSwitch
        checked={checked}
        disabled={disabled}
        ariaLabel={label}
        focusRingOffsetClass="focus:ring-offset-[var(--dmi-surface)]"
        onToggle={onToggle}
      />
    </div>
  );
}

function actionGroupIcon(group: string): LucideIcon {
  if (group === "Contact") return Phone;
  if (group === "Web & Meetings") return Globe;
  if (group === "Social") return Share2;
  if (group === "Video & Music") return Music;
  if (group === "Gaming & Community") return Gamepad2;
  if (group === "Work & Developer") return Briefcase;
  return Plus;
}

function ActionTypeIcon({ type }: { type: CardActionType }) {
  if (type === "call" || type === "sms" || type === "whatsapp") {
    return <Phone className="h-4 w-4" />;
  }

  if (type === "email") return <Share2 className="h-4 w-4" />;

  if (
    type === "website" ||
    type === "book_meeting" ||
    type === "maps_directions" ||
    type === "custom_link"
  ) {
    return <Globe className="h-4 w-4" />;
  }

  if (
    type === "youtube" ||
    type === "vimeo" ||
    type === "twitch" ||
    type === "spotify" ||
    type === "apple_music" ||
    type === "soundcloud"
  ) {
    return <Music className="h-4 w-4" />;
  }

  if (
    type === "discord" ||
    type === "steam" ||
    type === "xbox" ||
    type === "playstation" ||
    type === "epic_games" ||
    type === "battle_net"
  ) {
    return <Gamepad2 className="h-4 w-4" />;
  }

  if (
    type === "slack" ||
    type === "microsoft_teams" ||
    type === "github" ||
    type === "gitlab"
  ) {
    return <Briefcase className="h-4 w-4" />;
  }

  return <Share2 className="h-4 w-4" />;
}

function customActionDescription(action: ActionPermissionDraft) {
  const destination = action.destination_type
    ? action.destination_type.replace("_", " ")
    : "url";

  return `Custom ${destination} action${
    action.destination_field ? ` using ${action.destination_field}` : ""
  }.`;
}

function SectionControl({
  section,
  title,
  description,
  fields,
  builtInFields,
  customSection,
  enabled,
  allowedFields,
  exampleValues,
  onToggleSection,
  onUpdateSectionTitle,
  onToggleField,
  onUpdateExampleValue,
  onAddField,
  onDeleteSection,
  onDeleteField,
  draggedField,
  sectionDragging,
  onSectionDragStart,
  onSectionDragEnd,
  onSectionDrop,
  onDragStart,
  onDragEnd,
  onDropField,
}: {
  section: SectionKey;
  title: string;
  description: string;
  fields: string[];
  builtInFields: string[];
  customSection: boolean;
  enabled: boolean;
  allowedFields: string[];
  exampleValues: TemplateExampleValues;
  onToggleSection: () => void;
  onUpdateSectionTitle: (title: string) => void;
  onToggleField: (field: string) => void;
  onUpdateExampleValue: (field: string, value: string) => void;
  onAddField: () => void;
  onDeleteSection: () => void;
  onDeleteField: (field: string) => void;
  draggedField: DraggedField;
  sectionDragging: boolean;
  onSectionDragStart: () => void;
  onSectionDragEnd: () => void;
  onSectionDrop: () => void;
  onDragStart: (field: string) => void;
  onDragEnd: () => void;
  onDropField: (field: string) => void;
}) {
  return (
    <div
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        onSectionDragStart();
      }}
      onDragEnd={onSectionDragEnd}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }}
      onDrop={(event) => {
        event.preventDefault();
        onSectionDrop();
      }}
      className={`rounded-3xl border p-5 transition ${
        sectionDragging
          ? "border-[var(--border-brand)] bg-[color-mix(in_srgb,var(--brand-secondary)_16%,var(--dmi-surface))] shadow-[0_12px_28px_color-mix(in_srgb,var(--brand-secondary)_12%,transparent)]"
          : enabled
          ? builderPanelClass
          : "border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] opacity-75"
      }`}
    >
      <div className="flex w-full flex-col gap-4 text-left sm:flex-row sm:items-center sm:justify-between">
        <span className="flex min-w-0 flex-1 items-start gap-3">
          <span className="mt-1 shrink-0 cursor-grab select-none text-sm tracking-[-0.2em] text-[var(--dmi-muted)]">
            ::
          </span>
          <span className="min-w-0 flex-1">
          {customSection ? (
            <input
              value={title}
              onDragStart={(event) => event.preventDefault()}
              onChange={(event) => onUpdateSectionTitle(event.target.value)}
              className="w-full rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-sm font-semibold text-[var(--input-text)] outline-none transition placeholder:text-[var(--dmi-muted)] focus:border-[var(--input-focus)] focus:ring-2 focus:ring-[var(--input-focus-ring)]"
              aria-label="Section title"
            />
          ) : (
            <span className="block font-semibold text-[var(--text-primary)]">
              {title}
            </span>
          )}
          <span className="mt-1 block text-xs leading-relaxed text-[var(--dmi-muted)]">
            {description}
          </span>
        </span>
        </span>
        <span className="flex shrink-0 flex-wrap items-center gap-2">
          {customSection && (
            <button
              type="button"
              onDragStart={(event) => event.preventDefault()}
              onClick={onDeleteSection}
              className="rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-1 text-xs font-semibold text-red-500 transition hover:bg-red-500/15"
            >
              Delete Section
            </button>
          )}
          <button
            type="button"
            onDragStart={(event) => event.preventDefault()}
            onClick={onToggleSection}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              enabled
                ? "bg-[linear-gradient(135deg,var(--brand-primary),var(--brand-secondary))] !text-white"
                : "bg-[var(--dmi-surface-soft)] text-[var(--dmi-muted)]"
            }`}
          >
            {enabled ? "On" : "Off"}
          </button>
        </span>
      </div>

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
	                  className={`grid cursor-grab gap-3 rounded-2xl border px-4 py-3 transition active:cursor-grabbing lg:grid-cols-[auto_minmax(0,1fr)_minmax(180px,260px)_auto_auto] lg:items-center ${
                    dragging
                      ? "border-[var(--border-brand)] bg-[color-mix(in_srgb,var(--brand-secondary)_16%,var(--dmi-surface))] shadow-[0_12px_28px_color-mix(in_srgb,var(--brand-secondary)_12%,transparent)]"
                      : "border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] hover:border-[var(--border-brand)] hover:bg-[var(--button-hover-bg)]"
                  }`}
                >
                  <span className="shrink-0 select-none text-sm tracking-[-0.2em] text-[var(--dmi-muted)]">
                    ::
                  </span>
                  <span className="min-w-0 flex-1 text-sm font-medium capitalize text-[var(--text-primary)]">
                    {formatFieldLabel(field)}
                  </span>
                  <input
                    type="text"
                    value={exampleValues[field] || ""}
                    onDragStart={(event) => event.preventDefault()}
                    onChange={(event) =>
                      onUpdateExampleValue(field, event.target.value)
                    }
                    placeholder="Example value"
                    className="min-w-0 rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-xs text-[var(--input-text)] outline-none transition placeholder:text-[var(--dmi-muted)] focus:border-[var(--input-focus)] focus:ring-2 focus:ring-[var(--input-focus-ring)]"
                  />
                  <button
                    type="button"
                    onDragStart={(event) => event.preventDefault()}
                    onClick={() => onToggleField(field)}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                      active
                        ? "bg-[linear-gradient(135deg,var(--brand-primary),var(--brand-secondary))] !text-white"
                        : "bg-[var(--dmi-surface-soft)] text-[var(--dmi-muted)]"
                    }`}
                  >
                    {active ? "On" : "Off"}
                  </button>
                  <button
                    type="button"
                    onDragStart={(event) => event.preventDefault()}
                    onClick={() => onDeleteField(field)}
                    disabled={!custom || builtInFields.includes(field)}
                    className="rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-1 text-xs font-semibold text-red-500 transition hover:bg-red-500/15 disabled:cursor-not-allowed disabled:border-[var(--dmi-border)] disabled:bg-[var(--dmi-surface-soft)] disabled:text-[var(--dmi-muted)] disabled:opacity-50"
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
            className="mt-3 w-full rounded-2xl border border-dashed border-[var(--border-brand)] bg-[color-mix(in_srgb,var(--brand-secondary)_10%,var(--dmi-surface))] px-4 py-2 text-sm font-semibold text-[var(--text-accent)] transition hover:bg-[color-mix(in_srgb,var(--brand-secondary)_14%,var(--dmi-surface))] focus:outline-none focus:ring-2 focus:ring-[var(--brand-secondary)] focus:ring-offset-2 focus:ring-offset-[var(--background)]"
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
    <div className={builderPanelClass}>
      <div className="flex w-full flex-col gap-4 text-left sm:flex-row sm:items-start sm:justify-between">
        <span>
          <span className="block font-semibold text-[var(--text-primary)]">
            Card Header
          </span>
          <span className="mt-1 block text-xs leading-relaxed text-[var(--dmi-muted)]">
            Controls the name shown under the profile image.
          </span>
        </span>
        <span className="shrink-0 rounded-full bg-[linear-gradient(135deg,var(--brand-primary),var(--brand-secondary))] px-3 py-1 text-xs font-semibold !text-white">
          Fixed
        </span>
      </div>

      <div className="mt-5 space-y-2.5">
        {fields.map((field) => {
          const active = allowedFields.includes(field);

          return (
            <div
              key={`header-${field}`}
	              className="grid gap-3 rounded-2xl border border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] px-4 py-3 transition hover:border-[var(--border-brand)] hover:bg-[var(--button-hover-bg)] lg:grid-cols-[minmax(0,1fr)_minmax(180px,260px)_auto] lg:items-center"
            >
              <span className="min-w-0 flex-1 text-sm font-medium capitalize text-[var(--text-primary)]">
                {formatFieldLabel(field)}
              </span>
              <input
                type="text"
                value={exampleValues[field] || ""}
                onChange={(event) =>
                  onUpdateExampleValue(field, event.target.value)
                }
                placeholder="Example value"
                className="min-w-0 rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-xs text-[var(--input-text)] outline-none transition placeholder:text-[var(--dmi-muted)] focus:border-[var(--input-focus)] focus:ring-2 focus:ring-[var(--input-focus-ring)]"
              />
              <button
                type="button"
                onClick={() => onToggleField(field)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                  active
                    ? "bg-[linear-gradient(135deg,var(--brand-primary),var(--brand-secondary))] !text-white"
                    : "bg-[var(--dmi-surface-soft)] text-[var(--dmi-muted)]"
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

function orderedSectionFields(
  section: SectionKey,
  customFields: CustomFields,
  sections: ContentSection[] = defaultContentSections
) {
  return normalizeCustomFields(customFields, sections)[section] || [];
}

function normalizeCustomFields(
  customFields?: CustomFields | null,
  sections: ContentSection[] = defaultContentSections
) {
  return sections.reduce<Record<string, string[]>>(
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
        .map((field) => normalizeSectionField(section.key, field, sections))
        .filter((field) => {
          const key = field.toLowerCase();

          if (seen.has(key)) return false;

          seen.add(key);
          return true;
        });

      normalized[section.key] = fields;
      return normalized;
    },
    {}
  );
}

function normalizeSectionField(
  section: SectionKey,
  field: string,
  sections: ContentSection[] = defaultContentSections
) {
  const builtInFields =
    sections.find((group) => group.key === section)?.fields || [];
  const builtInField = builtInFields.find(
    (builtIn) =>
      builtIn === field ||
      builtIn.toLowerCase() === field.toLowerCase() ||
      formatFieldLabel(builtIn).toLowerCase() === field.toLowerCase()
  );

  if (builtInField) {
    return builtInField;
  }

  if (isCustomFieldKey(field)) {
    return field;
  }

  return customFieldKey(section, field);
}

function previewCustomFieldValues(
  customFields: CustomFields,
  exampleValues: TemplateExampleValues,
  sections: ContentSection[] = defaultContentSections
) {
  const normalized = normalizeCustomFields(customFields, sections);

  return Object.entries(normalized).reduce<
    Record<string, string | Record<string, string>>
  >((values, [section, fields]) => {
    const sectionValues: Record<string, string> = {};

    fields
      .filter((field) => isCustomFieldKey(field))
      .forEach((field) => {
        const label = formatFieldLabel(field);
        const rawLabel = field.split(":").at(-1) || label;
        const value = exampleValues[field] || `${label} details`;

        values[field] = value;
        values[label] = value;
        sectionValues[field] = value;
        sectionValues[label] = value;
        sectionValues[label.toLowerCase()] = value;
        sectionValues[rawLabel] = value;
      });

    if (Object.keys(sectionValues).length > 0) {
      values[section] = sectionValues;
    }

    return values;
  }, {});
}

function formatFieldLabel(field: string) {
  if (field.startsWith("custom:")) {
    return field.split(":").at(-1) || field;
  }

  return field.replaceAll("_", " ");
}

function slugifyKey(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "section";
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
    name,
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
    custom_fields: sanitizeCustomFields(
      custom_fields,
      readTemplateContentSections(field_config, custom_fields)
    ),
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
    configured?.actions
      .filter((action) => !action.custom_action)
      .map((action) => [action.type, action]) || []
  );
  const customActions =
    configured?.actions
      .filter((action) => action.custom_action)
      .map((action) => ({
        id: action.id || `custom_action_${action.type}`,
        type: action.type,
        enabled: action.enabled !== false,
        default_visible: action.default_visible === true,
        default_label:
          action.default_label || action.action_name || defaultLabelForActionType(action.type),
        custom_action: true,
        action_name: action.action_name,
        destination_type: action.destination_type,
        destination_field: action.destination_field,
      })) || [];

  const builtInActions = cardActionDefinitions.map((definition) => {
    const configuredAction = configuredByType.get(definition.type);
    const legacySaveContactDisabled =
      !configured && definition.type === "save_contact" &&
      template.supports_save_contact === false;

    return {
      id: definition.type,
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

  return [...builtInActions, ...customActions];
}

function buildTemplateAllowedActions(
  permissions: ActionPermissionDraft[]
): TemplateAllowedActions {
  return {
    version: 1,
    actions: permissions
      .filter((action) => action.enabled)
      .map((action) => ({
        id: action.id,
        type: action.type,
        enabled: true,
        default_visible: action.default_visible,
        default_label: actionLabelIsConfigurable(action.type)
          ? action.default_label
          : undefined,
        custom_action: action.custom_action || undefined,
        action_name: action.custom_action ? action.action_name : undefined,
        destination_type: action.custom_action ? action.destination_type : undefined,
        destination_field: action.custom_action
          ? action.destination_field
          : undefined,
      })),
  };
}

function buildPreviewDefaultActionConfig(
  permissions: ActionPermissionDraft[]
): CardActionConfig {
  return {
    version: 1,
    actions: permissions
      .filter((action) => action.enabled && action.default_visible)
      .map((action, index) => ({
        id: action.id || action.type,
        type: action.type,
        visible: true,
        order: index,
        label:
          actionLabelIsConfigurable(action.type) || action.custom_action
            ? action.default_label || defaultLabelForActionType(action.type)
            : undefined,
      })),
  };
}

function buildTemplateFieldConfig(
  allowedFields: string[],
  customFields: CustomFields,
  contentSections: ContentSection[] = defaultContentSections,
  disabledSections: string[] = []
): TemplateFieldConfig {
  const sections = normalizeCustomFields(customFields, contentSections);
  const sectionOrder = contentSections.map((section) => section.key);
  const sectionLabels = contentSections.reduce<Record<string, string>>(
    (labels, section) => {
      labels[section.key] = section.title.trim() || formatFieldLabel(section.key);
      return labels;
    },
    {}
  );
  const sectionVisibility = contentSections.reduce<Record<string, boolean>>(
    (visibility, section) => {
      visibility[`section:${section.key}`] = !disabledSections.includes(section.key);
      return visibility;
    },
    {}
  );

  return {
    version: 1,
    allowed_fields: sanitizeAllowedFields(allowedFields),
    sections,
    default_visibility: sectionVisibility,
    required_fields: [],
    section_order: sectionOrder,
    section_labels: sectionLabels,
  };
}

function buildTemplateRendererOptions(
  layoutType: string,
  exampleValues: TemplateExampleValues,
  gradientStart: string,
  gradientEnd: string,
  gradientDirection: GradientDirection,
  accessLevel: string,
  backgroundMode: "solid" | "gradient"
): Record<string, unknown> {
  return {
    version: 1,
    layout_type: layoutType,
    example_values: sanitizeTemplateExampleValues(exampleValues),
    gradient_defaults: {
      start: gradientStart,
      end: gradientEnd,
      direction: gradientDirection,
    },
    design_contract: {
      version: 1,
      access_level: accessLevel === "free" ? "free" : "paid",
      background_mode: backgroundMode,
    },
  };
}

function sanitizeTemplateExampleValues(
  values?: TemplateExampleValues | null
): TemplateExampleValues {
  const source = values || {};
  const keys = new Set([
    ...Object.keys(defaultTemplateExampleValues),
    ...Object.keys(source),
  ]);

  return Array.from(keys).reduce<TemplateExampleValues>((sanitized, field) => {
    const value = source[field];

    if (typeof value === "string") {
      sanitized[field] = value.trim().slice(0, field === "bio" ? 500 : 160);
    } else if (field in defaultTemplateExampleValues) {
      sanitized[field] = defaultTemplateExampleValues[field] || "";
    }

    return sanitized;
  }, {});
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

function isGradientDirection(value: unknown): value is GradientDirection {
  return gradientDirectionOptions.some((option) => option.value === value);
}

function readTemplateGradientDirection(
  rendererOptions: Record<string, unknown> | null | undefined
): GradientDirection {
  if (!rendererOptions || typeof rendererOptions !== "object") {
    return defaultGradientDirection;
  }

  const gradientDefaults = rendererOptions.gradient_defaults;

  if (
    !gradientDefaults ||
    typeof gradientDefaults !== "object" ||
    Array.isArray(gradientDefaults)
  ) {
    return defaultGradientDirection;
  }

  const direction = (gradientDefaults as Record<string, unknown>).direction;

  return isGradientDirection(direction) ? direction : defaultGradientDirection;
}

function gradientDirectionLabel(direction: GradientDirection) {
  return (
    gradientDirectionOptions.find((option) => option.value === direction)?.label ||
    "Top Left to Bottom Right"
  );
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


function sanitizeFreeColourPalette(colours?: unknown) {
  const palette = normalizeColourPalette(colours);

  return palette.length ? palette : [defaultTemplateBackgroundColour];
}

function sanitizeTextColourPalette(colours?: unknown, fallback?: string | null) {
  const palette = normalizeColourPalette(colours);
  const fallbackPalette = normalizeColourPalette(fallback);
  const nextPalette = palette.length ? palette : fallbackPalette;

  return nextPalette.length ? nextPalette : [defaultTemplateTextColour];
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

function readTemplateSectionFields(
  fieldConfig?: TemplateFieldConfig | null,
  customFields?: CustomFields | null
): CustomFields {
  if (
    fieldConfig?.sections &&
    typeof fieldConfig.sections === "object" &&
    !Array.isArray(fieldConfig.sections)
  ) {
    return fieldConfig.sections;
  }

  return customFields || {};
}

function readTemplateContentSections(
  fieldConfig?: TemplateFieldConfig | null,
  customFields?: CustomFields | null
): ContentSection[] {
  const configuredSections = readTemplateSectionFields(fieldConfig, customFields);
  const sectionKeys = new Set([
    ...defaultContentSections.map((section) => section.key),
    ...Object.keys(configuredSections),
  ]);
  const configuredOrder = Array.isArray(fieldConfig?.section_order)
    ? fieldConfig.section_order.filter(
        (key): key is string => typeof key === "string" && sectionKeys.has(key)
      )
    : [];
  const orderedKeys = [
    ...configuredOrder,
    ...Array.from(sectionKeys).filter((key) => !configuredOrder.includes(key)),
  ];
  const labels =
    fieldConfig?.section_labels &&
    typeof fieldConfig.section_labels === "object" &&
    !Array.isArray(fieldConfig.section_labels)
      ? fieldConfig.section_labels
      : {};

  return orderedKeys.map((key) => {
    const defaultSection = defaultContentSections.find(
      (section) => section.key === key
    );

    return {
      key,
      title:
        typeof labels[key] === "string" && labels[key].trim()
          ? labels[key].trim()
          : defaultSection?.title || formatFieldLabel(key),
      description: defaultSection?.description || "Custom content section.",
      fields: defaultSection?.fields || [],
      custom: !defaultSection,
    };
  });
}

function readTemplateDisabledSections(fieldConfig?: TemplateFieldConfig | null) {
  const visibility = fieldConfig?.default_visibility;

  if (!visibility || typeof visibility !== "object" || Array.isArray(visibility)) {
    return [];
  }

  return Object.entries(visibility)
    .filter(([key, enabled]) => key.startsWith("section:") && enabled === false)
    .map(([key]) => key.replace(/^section:/, ""));
}

function sanitizeCustomFields(
  customFields: CustomFields,
  contentSections: ContentSection[] = defaultContentSections
): CustomFields {
  const normalized = normalizeCustomFields(customFields, contentSections);

  return Object.entries(normalized).reduce<CustomFields>(
    (sanitized, [section, fields]) => {
      sanitized[section] = sanitizeAllowedFields(fields).filter(
        (field) => !(section === "contact" && field === "website")
      );
      return sanitized;
    },
    {}
  );
}

function clientFieldOrder(customFields: CustomFields): CardFieldOrder {
  return {
    ...customFields,
    personal: customFields.personal || [],
    company: customFields.company || [],
    contact: customFields.contact || [],
    social: customFields.social || [],
  };
}
