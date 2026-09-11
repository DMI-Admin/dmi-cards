"use client";

import {
  useEffect,
  useMemo,
  useState,
} from "react";
import type { User } from "@supabase/supabase-js";
import type { LucideIcon } from "lucide-react";
import {
  BadgePlus,
  Check,
  Copy,
  CreditCard,
  ExternalLink,
  Lock,
  Save,
  Smartphone,
  Tablet,
  Trash2,
  X,
} from "lucide-react";
import CardRenderer, {
  combineNameParts,
  type CardRendererTemplate,
} from "@/components/CardRenderer";
import CardEditorModalShell from "@/components/card-builder/CardEditorModalShell";
import {
  EditorPanel,
  EditorStepNavigation,
  PreviewPanelContent,
  normalizeActionConfigForDraft,
} from "@/components/card-builder/ClientCardEditor";
import {
  ClientPortalHeader,
  ClientPortalPage,
  clientButtonClass,
} from "@/components/ClientPortalShell";
import UpgradeToProButton from "@/components/UpgradeToProButton";
import { supabase } from "@/lib/supabase";
import {
  getClientVisibleTemplates,
  type SharedTemplate,
} from "@/lib/templates";
import { ClientAuthRequiredError, getCurrentUser } from "@/lib/client-auth";
import { buildPublicCardUrl } from "@/lib/public-url";
import { normalizeInternationalPhoneNumber } from "@/lib/phone-number";
import { useClientPlan } from "@/lib/use-client-plan";
import {
  actionIsComplete,
  cardActionTypes,
  defaultCardActionConfigForTemplate,
  defaultLabelForActionType,
  effectiveCardActionConfig,
  fieldKeyForActionType,
  type CardActionConfig,
  type CardActionType,
} from "@/lib/card-actions";
import {
  deleteCardForUser,
  listCardsForUser,
  saveClientCard,
  type CardWriteMode,
} from "@/lib/services/card-service";
import {
  buildCardSlugBase,
  canSelectTemplate as canSelectTemplateForPlan,
  customFieldStorageKey,
  customFieldValue,
  defaultLeadCaptureSettings,
  defaultTemplateForPlan as defaultTemplateForPlanForPlan,
  describeCardsDatabaseError,
  fallbackColour,
  fieldKeyMatches,
  firstTemplateColour,
  firstTemplateTextColour,
  getInitialFieldOrder,
  hiddenFieldsForCard,
  isFieldHidden,
  isFieldVisible,
  isEditableCardField,
  isPaidTemplate,
  mapSupabaseCard as mapSupabaseCardForPlan,
  mergeAllowedFieldsWithFieldOrder,
  mergeFieldOrderWithTemplate,
  normalizeFieldVisibility,
  normalizeLeadCaptureSettings,
  selectedColourForTemplate,
  selectedTextColourForTemplate,
  templateForCard as templateForCardForPlan,
  visibleTemplatesForPlan as visibleTemplatesForPlanForPlan,
  type CardFieldOrder,
  type CardSectionKey,
  type ClientCardPlan,
  type ClientCardStatus,
  type LeadCaptureSettings,
  type SharedClientCard,
  type SupabaseCardRow,
} from "@/lib/services/card-payload";
import { useRouter } from "next/navigation";

type PanelMode = "create" | "edit";
type BuilderStep = 0 | 1 | 2 | 3;
type DevicePreviewKey =
  | "iphone_se"
  | "iphone_se_2_3"
  | "iphone_x"
  | "iphone_xr"
  | "iphone_11"
  | "iphone_11_pro"
  | "iphone_11_pro_max"
  | "iphone_12_mini"
  | "iphone_12"
  | "iphone_12_pro_max"
  | "iphone_13_mini"
  | "iphone_13"
  | "iphone_13_pro_max"
  | "iphone_14"
  | "iphone_14_plus"
  | "iphone_14_pro"
  | "iphone_14_pro_max"
  | "iphone_15"
  | "iphone_15_plus"
  | "iphone_15_pro"
  | "iphone_15_pro_max"
  | "iphone_16"
  | "iphone_16_plus"
  | "iphone_16_pro"
  | "iphone_16_pro_max"
  | "iphone_17"
  | "iphone_17_pro"
  | "iphone_17_pro_max"
  | "galaxy_s10"
  | "galaxy_s20"
  | "galaxy_s21"
  | "galaxy_s21_ultra"
  | "galaxy_s22"
  | "galaxy_s22_ultra"
  | "galaxy_s23"
  | "galaxy_s23_plus"
  | "galaxy_s23_ultra"
  | "galaxy_s24"
  | "galaxy_s24_plus"
  | "galaxy_s24_ultra"
  | "galaxy_s25"
  | "galaxy_s25_plus"
  | "galaxy_s25_ultra"
  | "galaxy_note_20"
  | "galaxy_note_20_ultra"
  | "galaxy_z_flip_5"
  | "galaxy_z_flip_6"
  | "galaxy_z_fold_4_closed"
  | "galaxy_z_fold_4_open"
  | "galaxy_z_fold_5_closed"
  | "galaxy_z_fold_5_open"
  | "galaxy_z_fold_6_closed"
  | "galaxy_z_fold_6_open"
  | "pixel_6"
  | "pixel_7"
  | "pixel_8"
  | "pixel_8_pro"
  | "pixel_9"
  | "pixel_9_pro_xl"
  | "oneplus_11"
  | "oneplus_open"
  | "xiaomi_13"
  | "xiaomi_14_ultra"
  | "huawei_p60_pro"
  | "oppo_find_x5_pro"
  | "small_android"
  | "standard_android"
  | "large_android"
  | "tablet_portrait"
  | "tablet_landscape"
  | "full_width";

type AdminTemplate = SharedTemplate;
type ResolvedCardTemplate = NonNullable<ReturnType<typeof defaultTemplateForPlanForPlan>>;

type ClientCard = SharedClientCard;
type CardStatus = ClientCardStatus;
type SectionKey = CardSectionKey;
type FieldOrder = CardFieldOrder;
type SectionConfig = {
  key: SectionKey;
  label: string;
  enabled: boolean;
  fields: string[];
};
type ValidationIssueKind = "fields" | "actions" | "lead_capture";
type ValidationIssue = {
  key: string;
  label: string;
  detail: string;
};
type PendingValidation = {
  kind: ValidationIssueKind;
  issues: ValidationIssue[];
  nextStep?: BuilderStep;
  publishStatus?: CardStatus;
};
type SaveStatus = "idle" | "saving" | "saved" | "published" | "failed";

type DevicePreviewDevice = {
  key: DevicePreviewKey;
  label: string;
  brand: string;
  width: number | "100%";
  height: number;
  frameType: "iphone" | "android" | "foldable" | "tablet";
  dynamicIsland?: boolean;
  notch?: boolean;
};

type DevicePreviewGroup = {
  manufacturer: string;
  icon: LucideIcon;
  devices: DevicePreviewDevice[];
};

const devicePreviewGroups: DevicePreviewGroup[] = [
  {
    manufacturer: "Apple",
    icon: Smartphone,
    devices: [
      device("iphone_se", "iPhone SE 1st Gen", "Apple", 320, 568, "iphone"),
      device("iphone_se_2_3", "iPhone SE 2nd/3rd Gen", "Apple", 375, 667, "iphone"),
      device("iphone_x", "iPhone X", "Apple", 375, 812, "iphone", { notch: true }),
      device("iphone_xr", "iPhone XR", "Apple", 414, 896, "iphone", { notch: true }),
      device("iphone_11", "iPhone 11", "Apple", 414, 896, "iphone", { notch: true }),
      device("iphone_11_pro", "iPhone 11 Pro", "Apple", 375, 812, "iphone", { notch: true }),
      device("iphone_11_pro_max", "iPhone 11 Pro Max", "Apple", 414, 896, "iphone", { notch: true }),
      device("iphone_12_mini", "iPhone 12 Mini", "Apple", 360, 780, "iphone", { notch: true }),
      device("iphone_12", "iPhone 12 / 12 Pro", "Apple", 390, 844, "iphone", { notch: true }),
      device("iphone_12_pro_max", "iPhone 12 Pro Max", "Apple", 428, 926, "iphone", { notch: true }),
      device("iphone_13_mini", "iPhone 13 Mini", "Apple", 375, 812, "iphone", { notch: true }),
      device("iphone_13", "iPhone 13 / 13 Pro", "Apple", 390, 844, "iphone", { notch: true }),
      device("iphone_13_pro_max", "iPhone 13 Pro Max", "Apple", 428, 926, "iphone", { notch: true }),
      device("iphone_14", "iPhone 14", "Apple", 390, 844, "iphone", { notch: true }),
      device("iphone_14_plus", "iPhone 14 Plus", "Apple", 428, 926, "iphone", { notch: true }),
      device("iphone_14_pro", "iPhone 14 Pro", "Apple", 393, 852, "iphone", { dynamicIsland: true }),
      device("iphone_14_pro_max", "iPhone 14 Pro Max", "Apple", 430, 932, "iphone", { dynamicIsland: true }),
      device("iphone_15", "iPhone 15", "Apple", 393, 852, "iphone", { dynamicIsland: true }),
      device("iphone_15_plus", "iPhone 15 Plus", "Apple", 430, 932, "iphone", { dynamicIsland: true }),
      device("iphone_15_pro", "iPhone 15 Pro", "Apple", 393, 852, "iphone", { dynamicIsland: true }),
      device("iphone_15_pro_max", "iPhone 15 Pro Max", "Apple", 430, 932, "iphone", { dynamicIsland: true }),
      device("iphone_16", "iPhone 16", "Apple", 393, 852, "iphone", { dynamicIsland: true }),
      device("iphone_16_plus", "iPhone 16 Plus", "Apple", 430, 932, "iphone", { dynamicIsland: true }),
      device("iphone_16_pro", "iPhone 16 Pro", "Apple", 402, 874, "iphone", { dynamicIsland: true }),
      device("iphone_16_pro_max", "iPhone 16 Pro Max", "Apple", 440, 956, "iphone", { dynamicIsland: true }),
      device("iphone_17", "iPhone 17", "Apple", 393, 852, "iphone", { dynamicIsland: true }),
      device("iphone_17_pro", "iPhone 17 Pro", "Apple", 402, 874, "iphone", { dynamicIsland: true }),
      device("iphone_17_pro_max", "iPhone 17 Pro Max", "Apple", 440, 956, "iphone", { dynamicIsland: true }),
    ],
  },
  {
    manufacturer: "Samsung",
    icon: Smartphone,
    devices: [
      device("galaxy_s10", "Galaxy S10", "Samsung", 360, 760, "android"),
      device("galaxy_s20", "Galaxy S20", "Samsung", 360, 800, "android"),
      device("galaxy_s21", "Galaxy S21", "Samsung", 360, 800, "android"),
      device("galaxy_s21_ultra", "Galaxy S21 Ultra", "Samsung", 384, 854, "android"),
      device("galaxy_s22", "Galaxy S22", "Samsung", 360, 780, "android"),
      device("galaxy_s22_ultra", "Galaxy S22 Ultra", "Samsung", 412, 915, "android"),
      device("galaxy_s23", "Galaxy S23", "Samsung", 393, 873, "android"),
      device("galaxy_s23_plus", "Galaxy S23 Plus", "Samsung", 384, 854, "android"),
      device("galaxy_s23_ultra", "Galaxy S23 Ultra", "Samsung", 412, 915, "android"),
      device("galaxy_s24", "Galaxy S24", "Samsung", 412, 915, "android"),
      device("galaxy_s24_plus", "Galaxy S24 Plus", "Samsung", 412, 915, "android"),
      device("galaxy_s24_ultra", "Galaxy S24 Ultra", "Samsung", 430, 932, "android"),
      device("galaxy_s25", "Galaxy S25", "Samsung", 412, 915, "android"),
      device("galaxy_s25_plus", "Galaxy S25 Plus", "Samsung", 430, 932, "android"),
      device("galaxy_s25_ultra", "Galaxy S25 Ultra", "Samsung", 440, 956, "android"),
      device("galaxy_note_20", "Galaxy Note 20", "Samsung", 412, 915, "android"),
      device("galaxy_note_20_ultra", "Galaxy Note 20 Ultra", "Samsung", 412, 915, "android"),
      device("galaxy_z_flip_5", "Galaxy Z Flip 5", "Samsung", 393, 873, "foldable"),
      device("galaxy_z_flip_6", "Galaxy Z Flip 6", "Samsung", 393, 873, "foldable"),
      device("galaxy_z_fold_4_closed", "Galaxy Z Fold 4 Closed", "Samsung", 344, 882, "foldable"),
      device("galaxy_z_fold_4_open", "Galaxy Z Fold 4 Open", "Samsung", 673, 841, "foldable"),
      device("galaxy_z_fold_5_closed", "Galaxy Z Fold 5 Closed", "Samsung", 344, 882, "foldable"),
      device("galaxy_z_fold_5_open", "Galaxy Z Fold 5 Open", "Samsung", 673, 841, "foldable"),
      device("galaxy_z_fold_6_closed", "Galaxy Z Fold 6 Closed", "Samsung", 344, 882, "foldable"),
      device("galaxy_z_fold_6_open", "Galaxy Z Fold 6 Open", "Samsung", 690, 864, "foldable"),
    ],
  },
  {
    manufacturer: "Google",
    icon: Smartphone,
    devices: [
      device("pixel_6", "Pixel 6", "Google", 393, 851, "android"),
      device("pixel_7", "Pixel 7", "Google", 412, 915, "android"),
      device("pixel_8", "Pixel 8", "Google", 412, 915, "android"),
      device("pixel_8_pro", "Pixel 8 Pro", "Google", 448, 998, "android"),
      device("pixel_9", "Pixel 9", "Google", 412, 915, "android"),
      device("pixel_9_pro_xl", "Pixel 9 Pro XL", "Google", 448, 998, "android"),
    ],
  },
  {
    manufacturer: "OnePlus",
    icon: Smartphone,
    devices: [
      device("oneplus_11", "OnePlus 11", "OnePlus", 412, 915, "android"),
      device("oneplus_open", "OnePlus Open", "OnePlus", 673, 841, "foldable"),
    ],
  },
  {
    manufacturer: "Xiaomi",
    icon: Smartphone,
    devices: [
      device("xiaomi_13", "Xiaomi 13", "Xiaomi", 393, 873, "android"),
      device("xiaomi_14_ultra", "Xiaomi 14 Ultra", "Xiaomi", 430, 932, "android"),
    ],
  },
  {
    manufacturer: "Huawei",
    icon: Smartphone,
    devices: [device("huawei_p60_pro", "Huawei P60 Pro", "Huawei", 412, 915, "android")],
  },
  {
    manufacturer: "Oppo",
    icon: Smartphone,
    devices: [
      device("oppo_find_x5_pro", "Oppo Find X5 Pro", "Oppo", 412, 915, "android"),
    ],
  },
  {
    manufacturer: "Generic",
    icon: Tablet,
    devices: [
      device("small_android", "Small Android", "Generic", 360, 800, "android"),
      device("standard_android", "Standard Android", "Generic", 393, 873, "android"),
      device("large_android", "Large Android", "Generic", 430, 932, "android"),
      device("tablet_portrait", "Tablet Portrait", "Generic", 768, 1024, "tablet"),
      device("tablet_landscape", "Tablet Landscape", "Generic", 1024, 768, "tablet"),
      device("full_width", "Full Width", "Generic", "100%", 844, "tablet"),
    ],
  },
];

const sectionLabels: Record<SectionKey, string> = {
  personal: "Personal Details",
  company: "Company Details",
  contact: "Contact Details",
  social: "Social & Links",
};

const fieldLabels: Record<string, string> = {
  title: "Title",
  first_name: "First Name",
  last_name: "Last Name",
  full_name: "Full Name",
  job_title: "Job Title",
  bio: "Bio",
  company_name: "Company Name",
  department: "Department",
  website: "Website",
  address: "Address",
  email: "Email",
  phone: "Phone",
  whatsapp: "WhatsApp",
  linkedin: "LinkedIn",
  instagram: "Instagram",
  facebook: "Facebook",
  youtube: "YouTube",
  booking_link: "Booking / Calendar Link",
  custom_url: "Custom URL",
  employee_id: "Employee ID",
};

const stepThreeDestinationFields = new Set<string>([
  "whatsapp",
  "linkedin",
  "instagram",
  "facebook",
  "youtube",
  "booking_link",
  "custom_url",
]);

const blankCard: ClientCard = {
  id: "",
  card_name: "Primary Digital Card",
  template_id: "",
  template_name: "",
  status: "unpublished",
  public_url: "/u/my-digital-card",
  last_updated: "Draft",
  title: "",
  first_name: "",
  last_name: "",
  full_name: "",
  job_title: "",
  department: "",
  bio: "",
  company_name: "",
  email: "",
  phone: "",
  website: "",
  address: "",
  whatsapp: "",
  linkedin: "",
  instagram: "",
  facebook: "",
  youtube: "",
  booking_link: "",
  custom_url: "",
  custom_fields: {},
  selected_colour: fallbackColour,
  selected_background_mode: "solid",
  selected_gradient_start: fallbackColour,
  selected_gradient_end: fallbackColour,
  selected_text_colour: "",
  hidden_fields: [],
  field_visibility: {},
  field_order: getInitialFieldOrder(null),
  lead_capture_settings: defaultLeadCaptureSettings,
  action_config: null,
};

const initialCards: ClientCard[] = [];
const slotShellClass =
  "group mx-auto flex h-[30rem] w-full max-w-[22rem] min-w-0 flex-col rounded-3xl border border-[var(--dmi-border)] bg-[var(--dmi-surface)] p-4 text-[var(--text-primary)] shadow-[0_18px_48px_rgba(0,0,0,0.18)] transition-[background-color,border-color,box-shadow,transform] duration-200 ease-out min-[1180px]:max-w-none md:hover:border-[#AC00FF]/25 md:hover:bg-[var(--dmi-surface-hover)] md:hover:shadow-[0_18px_46px_rgba(172,0,255,0.12)] motion-safe:md:hover:-translate-y-0.5";

export default function ClientCardsPage() {
  const router = useRouter();
  const { plan, isPaid, loading: planLoading } = useClientPlan();
  const currentPlan = (plan || "free") as ClientCardPlan;
  const [adminTemplates, setAdminTemplates] = useState<AdminTemplate[]>([]);
  const [cards, setCards] = useState<ClientCard[]>(initialCards);
  const [, setSelectedCardId] = useState(initialCards[0]?.id || "");
  const [showBuilder, setShowBuilder] = useState(false);
  const [panelMode, setPanelMode] = useState<PanelMode>("create");
  const [activeStep, setActiveStep] = useState<BuilderStep>(0);
  const [hasVisitedActionsStep, setHasVisitedActionsStep] = useState(false);
  const [draftCard, setDraftCard] = useState<ClientCard>(blankCard);
  const [fieldOrder, setFieldOrder] = useState<FieldOrder>(
    getInitialFieldOrder(null)
  );
  const [devicePreview, setDevicePreview] =
    useState<DevicePreviewKey>("iphone_15");
  const [stepFourPreviewMode, setStepFourPreviewMode] =
    useState<"card" | "lead_form">("card");
  const [publishedSuccessCard, setPublishedSuccessCard] =
    useState<ClientCard | null>(null);
  const [deviceSearch, setDeviceSearch] = useState("");
  const [devicePickerOpen, setDevicePickerOpen] = useState(false);
  const [limitMessage, setLimitMessage] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [saveError, setSaveError] = useState("");
  const [pendingValidation, setPendingValidation] =
    useState<PendingValidation | null>(null);
  const [databaseNotice, setDatabaseNotice] = useState("");
  const [templateError, setTemplateError] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [loadingCards, setLoadingCards] = useState(true);
  const [databaseReady, setDatabaseReady] = useState(false);

  const defaultTemplate = useMemo(
    () => defaultTemplateForPlan(adminTemplates, currentPlan),
    [adminTemplates, currentPlan]
  );
  const visibleTemplates = useMemo(
    () => visibleTemplatesForPlan(adminTemplates, currentPlan),
    [adminTemplates, currentPlan]
  );
  const currentDefaultTemplate = defaultTemplate;
  const draftTemplateRecord = useMemo(() => {
    return templateForCard(draftCard, adminTemplates, currentPlan) || currentDefaultTemplate;
  }, [adminTemplates, draftCard, currentDefaultTemplate, currentPlan]);
  const draftFallbackColour = firstTemplateColour(draftTemplateRecord);

  const draftTemplate = useMemo(() => {
    return buildTemplatePreview(
      draftTemplateRecord,
      selectedColourForTemplate(
        draftTemplateRecord,
        draftCard.selected_colour || draftFallbackColour
      ),
      selectedTextColourForTemplate(draftTemplateRecord, draftCard.selected_text_colour),
      fieldOrder,
      hiddenFieldsForCard(draftCard)
    );
  }, [
    draftTemplateRecord,
    draftCard,
    draftFallbackColour,
    fieldOrder,
  ]);

  const previewCard = useMemo(() => {
    if (activeStep !== 2 || draftCard.action_config) return draftCard;

    return {
      ...draftCard,
      action_config: effectiveCardActionConfig(draftCard, draftTemplateRecord),
    };
  }, [activeStep, draftCard, draftTemplateRecord]);
  const previewTemplate = draftTemplate;
  const previewTitle = "Live Edit Preview";
  const selectedDevice = findDevice(devicePreview);
  const filteredDeviceGroups = filterDeviceGroups(deviceSearch);
  const previewDimensions = previewFrameDimensions(selectedDevice);

  useEffect(() => {
    if (!showBuilder) return;

    const previousOverflow = document.body.style.overflow;

    document.body.style.overflow = "hidden";

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setShowBuilder(false);
      }
    }

    window.addEventListener("keydown", closeOnEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [showBuilder]);

  useEffect(() => {
    let ignore = false;

    async function loadSavedCards() {
      if (planLoading) return;

      setLoadingCards(true);
      setSaveError("");
      setTemplateError("");

      let nextTemplates: AdminTemplate[] = [];

      try {
        nextTemplates = await loadPublishedTemplates(currentPlan);
      } catch (error) {
        if (ignore) return;

        console.error("Client template load failed", error);
        setTemplateError(
          error instanceof Error
            ? error.message
            : "Could not load templates from Supabase."
        );
        setAdminTemplates([]);
        setCards([]);
        setSelectedCardId("");
        setLoadingCards(false);
        return;
      }

      if (ignore) return;

      setAdminTemplates(nextTemplates);

      let userId = "";

      try {
        const user = await getCurrentUser();

        if (!user) {
          throw new ClientAuthRequiredError();
        }
        userId = user.id;
      } catch (error) {
        if (ignore) return;

        if (error instanceof ClientAuthRequiredError) {
          router.replace("/");
        } else {
          console.error("Client auth load failed", error);
          setSaveError("Could not confirm your login session.");
        }

        setLoadingCards(false);
        return;
      }

      if (ignore) return;

      const { data, error } = await listCardsForUser(userId);

      if (ignore) return;

      if (error) {
        console.error("Client cards fetch failed", error);
        const databaseError = describeCardsDatabaseError(error);
        setDatabaseReady(false);
        setDatabaseNotice(databaseError);
        setSaveError(databaseError);
        setCards([]);
        setSelectedCardId("");
        setLoadingCards(false);
        return;
      }

      setDatabaseReady(true);
      setDatabaseNotice("");
      const savedCards = (data || []).map((row) =>
        mapSupabaseCard(row, nextTemplates, null, currentPlan)
      );
      console.log("[DMI auth] loaded cards", savedCards);
      const orderedCards = sortCardsBySlotOrder(savedCards);
      setCards(orderedCards);
      setSelectedCardId(orderedCards[0]?.id || "");
      setLoadingCards(false);
    }

    void loadSavedCards();

    return () => {
      ignore = true;
    };
  }, [currentPlan, planLoading, router]);

  function openCreatePanel(cardSlot?: 1 | 2 | 3) {
    if (!currentDefaultTemplate) return;

    if (!isPaid && cards.length >= 1) {
      setLimitMessage(
        "Free users can only have one card. Upgrade to Individual Pro to create more cards."
      );
      return;
    }

    setLimitMessage("");
    setSaveMessage("");
    setSaveError("");
    setSaveStatus("idle");
    setPublishedSuccessCard(null);
    setStepFourPreviewMode("card");
    setPanelMode("create");
    setActiveStep(0);
    setHasVisitedActionsStep(false);
    const initialFieldOrder = getInitialFieldOrder(currentDefaultTemplate);
    setFieldOrder(initialFieldOrder);
    const nextDraftCard = {
      ...blankCard,
      id: `card-${Date.now()}`,
      template_id: currentDefaultTemplate.id,
      template_name: currentDefaultTemplate.name,
      selected_colour: firstTemplateColour(currentDefaultTemplate),
      selected_background_mode:
        currentDefaultTemplate.access_level === "paid" &&
        currentDefaultTemplate.gradient_enabled
          ? "gradient"
          : "solid",
      selected_gradient_start:
        currentDefaultTemplate.primary_color ||
        firstTemplateColour(currentDefaultTemplate),
      selected_gradient_end:
        currentDefaultTemplate.secondary_color ||
        currentDefaultTemplate.primary_color ||
        firstTemplateColour(currentDefaultTemplate),
      selected_text_colour: firstTemplateTextColour(currentDefaultTemplate),
      card_slot: cardSlot || null,
      field_order: initialFieldOrder,
      lead_capture_settings: defaultLeadCaptureSettings,
      action_config: defaultCardActionConfigForTemplate(currentDefaultTemplate),
    };

    setDraftCard(nextDraftCard);
    setShowBuilder(true);
  }

  function openEditPanel(card: ClientCard) {
    setLimitMessage("");
    setSaveMessage("");
    setSaveError("");
    setSaveStatus("idle");
    setPublishedSuccessCard(null);
    setStepFourPreviewMode("card");
    setPanelMode("edit");
    setActiveStep(0);
    setHasVisitedActionsStep(false);
    const cardTemplate = templateForCard(card, adminTemplates, currentPlan);

    if (!cardTemplate) {
      setSaveError(
        "This card references a template that is not currently published. Ask an admin to republish the template before editing."
      );
      return;
    }

    const savedFieldOrder = mergeFieldOrderWithTemplate(card.field_order, cardTemplate);
    setFieldOrder(savedFieldOrder);
    setDraftCard({
      ...card,
      selected_colour: selectedColourForTemplate(cardTemplate, card.selected_colour),
      selected_background_mode:
        card.selected_background_mode ||
        (cardTemplate.access_level === "paid" && cardTemplate.gradient_enabled
          ? "gradient"
          : "solid"),
      selected_gradient_start:
        card.selected_gradient_start ||
        cardTemplate.primary_color ||
        selectedColourForTemplate(cardTemplate, card.selected_colour),
      selected_gradient_end:
        card.selected_gradient_end ||
        cardTemplate.secondary_color ||
        cardTemplate.primary_color ||
        selectedColourForTemplate(cardTemplate, card.selected_colour),
      selected_text_colour: selectedTextColourForTemplate(
        cardTemplate,
        card.selected_text_colour
      ),
      custom_fields: { ...(card.custom_fields || {}) },
    });
    setSelectedCardId(card.id);
    setShowBuilder(true);
  }

  function updateDraft(field: keyof ClientCard, value: string) {
    setDraftCard((current) => {
      const next = { ...current, [field]: value };

      if (field === "title" || field === "first_name" || field === "last_name") {
        next.full_name = combineNameParts(next);
      }

      return next;
    });

    if (field === "card_name" && panelMode === "edit") {
      setCards((currentCards) =>
        currentCards.map((card) =>
          card.id === draftCard.id ? { ...card, card_name: value } : card
        )
      );
    }

    if (
      (field === "title" || field === "first_name" || field === "last_name") &&
      panelMode === "edit"
    ) {
      setCards((currentCards) =>
        currentCards.map((card) => {
          if (card.id !== draftCard.id) return card;

          const next = { ...card, [field]: value };
          next.full_name = combineNameParts(next);
          return next;
        })
      );
    }
  }

  function selectDraftTemplate(template: AdminTemplate) {
    if (!canSelectTemplate(template, currentPlan)) {
      setLimitMessage("Upgrade to Individual Pro to use paid templates.");
      return;
    }

    console.log("[DMI cards] selectedTemplate.id", template.id || null);

    const nextFieldOrder = getInitialFieldOrder(template);
    setLimitMessage("");
    setFieldOrder(nextFieldOrder);
    setDraftCard((current) => ({
      ...current,
      template_id: template.id,
      template_name: template.name,
      selected_colour:
        template.access_level === "free"
          ? firstTemplateColour(template)
          : current.selected_colour || template.primary_color || fallbackColour,
      selected_background_mode:
        template.access_level === "paid" && template.gradient_enabled
          ? current.selected_background_mode || "gradient"
          : "solid",
      selected_gradient_start:
        current.selected_gradient_start ||
        template.primary_color ||
        current.selected_colour ||
        fallbackColour,
      selected_gradient_end:
        current.selected_gradient_end ||
        template.secondary_color ||
        template.primary_color ||
        current.selected_colour ||
        fallbackColour,
      selected_text_colour: selectedTextColourForTemplate(
        template,
        current.selected_text_colour
      ),
      hidden_fields: [],
      field_visibility: {},
      field_order: nextFieldOrder,
    }));
  }

  function updateCustomField(field: string, value: string) {
    setDraftCard((current) => ({
      ...current,
      custom_fields: {
        ...(current.custom_fields || {}),
        [field]: value,
      },
    }));
  }

  function updateLeadCaptureSettings(settings: LeadCaptureSettings) {
    setDraftCard((current) => ({
      ...current,
      lead_capture_settings: normalizeLeadCaptureSettings(settings),
    }));
  }

  function updateActionConfig(actionConfig: CardActionConfig) {
    setDraftCard((current) => ({
      ...current,
      action_config: normalizeActionConfigForDraft(actionConfig),
    }));
  }

  function changeEditorStep(
    step: BuilderStep,
    options: { skipValidation?: boolean } = {}
  ) {
    if (
      !options.skipValidation &&
      step > activeStep &&
      !validateEditorStepTransition(step)
    ) {
      return;
    }

    if (step === 2) {
      setHasVisitedActionsStep(true);
    }

    setActiveStep(step);
  }

  function toggleFieldVisibility(field: string) {
    setDraftCard((current) => {
      const currentlyVisible = isFieldVisible(field, current);
      const nextVisible = !currentlyVisible;
      const fieldVisibility = normalizeFieldVisibility(current.field_visibility);
      const visibilityKey = customFieldStorageKey(field);
      const hiddenFields = current.hidden_fields || [];
      const hiddenFieldSet = new Set(hiddenFields);
      const nextHiddenFields = nextVisible
        ? hiddenFields.filter(
            (hiddenField) => !fieldKeyMatches(hiddenField, visibilityKey)
          )
        : isFieldHidden(field, hiddenFieldSet)
        ? hiddenFields
        : [...hiddenFields, field];

      return {
        ...current,
        field_visibility: {
          ...fieldVisibility,
          [visibilityKey]: nextVisible,
        },
        hidden_fields: nextHiddenFields,
      };
    });
  }

  function incompleteBuildFields(): ValidationIssue[] {
    if (!draftTemplateRecord) return [];

    const sections = buildStepSections(draftTemplateRecord, fieldOrder);

    return sections.flatMap((section) =>
      section.fields
        .filter((field) => isFieldVisible(field, draftCard))
        .filter((field) => !fieldHasDraftValue(draftCard, field))
        .map((field) => ({
          key: field,
          label: fieldLabels[field] || friendlyFieldLabel(field),
          detail: section.label,
        }))
    );
  }

  function incompleteActionsForCard(card: ClientCard): ValidationIssue[] {
    if (!draftTemplateRecord) return [];

    const actionConfig = effectiveCardActionConfig(card, draftTemplateRecord);

    return actionConfig.actions
      .filter((action) => action.visible)
      .filter((action) => !actionIsComplete(action, card))
      .map((action) => ({
        key: action.type,
        label: action.label || defaultLabelForActionType(action.type),
        detail: actionIncompleteDetail(action.type),
      }));
  }

  function incompleteActions(): ValidationIssue[] {
    return incompleteActionsForCard(draftCard);
  }

  function incompleteLeadCaptureSettings(): ValidationIssue[] {
    const settings = normalizeLeadCaptureSettings(draftCard.lead_capture_settings);

    if (settings.flow !== "collect_first" || settings.fields.length > 0) {
      return [];
    }

    return [
      {
        key: "lead_capture_fields",
        label: "Collect First fields",
        detail: "Choose at least one field to collect before publishing.",
      },
    ];
  }

  function validateEditorStepTransition(nextStep?: BuilderStep, publishStatus?: CardStatus) {
    const shouldValidateBuild =
      activeStep === 1 ||
      Boolean(publishStatus) ||
      (nextStep !== undefined && activeStep < 1 && nextStep > 1);
    const shouldValidateActions =
      activeStep === 2 ||
      Boolean(publishStatus) ||
      (nextStep !== undefined && activeStep < 2 && nextStep > 2);

    if (shouldValidateBuild) {
      const issues = incompleteBuildFields();

      if (issues.length > 0) {
        setPendingValidation({
          kind: "fields",
          issues,
          nextStep,
          publishStatus,
        });
        return false;
      }
    }

    if (shouldValidateActions) {
      const issues = incompleteActions();

      if (issues.length > 0) {
        setPendingValidation({
          kind: "actions",
          issues,
          nextStep,
          publishStatus,
        });
        return false;
      }
    }

    if (publishStatus) {
      const issues = incompleteLeadCaptureSettings();

      if (issues.length > 0) {
        setPendingValidation({
          kind: "lead_capture",
          issues,
          nextStep,
          publishStatus,
        });
        return false;
      }
    }

    return true;
  }

  function continueAfterValidation(validation: PendingValidation) {
    if (validation.kind === "lead_capture") {
      setPendingValidation(null);
      return;
    }

    let overrideCard = draftCard;

    if (validation.kind === "fields") {
      const fields = validation.issues.map((issue) => issue.key);
      overrideCard = forceHideFieldsOnCard(draftCard, fields);
      setDraftCard(overrideCard);

      if (
        validation.publishStatus ||
        (validation.nextStep !== undefined && validation.nextStep > 2)
      ) {
        const actionIssues = incompleteActionsForCard(overrideCard);

        if (actionIssues.length > 0) {
          setPendingValidation({
            kind: "actions",
            issues: actionIssues,
            nextStep: validation.nextStep,
            publishStatus: validation.publishStatus,
          });
          return;
        }
      }
    } else {
      const types = validation.issues
        .map((issue) => issue.key)
        .filter((key): key is CardActionType =>
          cardActionTypes.includes(key as CardActionType)
        );
      const actionConfig = effectiveCardActionConfig(draftCard, draftTemplateRecord);
      const nextActionConfig = normalizeActionConfigForDraft({
        version: 1,
        actions: actionConfig.actions.map((action, index) => ({
          ...action,
          visible: types.includes(action.type) ? false : action.visible,
          order: index,
        })),
      });

      overrideCard = {
        ...draftCard,
        action_config: nextActionConfig,
      };
      setDraftCard(overrideCard);
    }

    setPendingValidation(null);

    if (validation.publishStatus) {
      void handleSaveCard(validation.publishStatus, {
        skipValidation: true,
        cardOverride: overrideCard,
      });
      return;
    }

    if (validation.nextStep !== undefined) {
      changeEditorStep(validation.nextStep, { skipValidation: true });
    }
  }

  function moveField(
    section: SectionKey,
    draggedField: string,
    targetField: string,
    position: "before" | "after" = "before"
  ) {
    setFieldOrder((current) => {
      const nextSectionFields = [...current[section]];
      const fromIndex = nextSectionFields.indexOf(draggedField);

      if (fromIndex === -1 || draggedField === targetField) {
        return current;
      }

      const [movedField] = nextSectionFields.splice(fromIndex, 1);
      const toIndex = nextSectionFields.indexOf(targetField);

      if (toIndex === -1) {
        return current;
      }

      nextSectionFields.splice(position === "after" ? toIndex + 1 : toIndex, 0, movedField);

      if (nextSectionFields.every((field, index) => field === current[section][index])) {
        return current;
      }

      const nextFieldOrder = { ...current, [section]: nextSectionFields };
      setDraftCard((currentCard) => ({
        ...currentCard,
        field_order: nextFieldOrder,
      }));

      return nextFieldOrder;
    });
  }

  async function handleSaveCard(
    status: CardStatus,
    options: { skipValidation?: boolean; cardOverride?: ClientCard } = {}
  ) {
    if (!options.skipValidation && !validateEditorStepTransition(undefined, status)) {
      return;
    }

    const cardToSave = normalizeCardPhoneFields(options.cardOverride || draftCard);
    setSaveError("");
    setSaveMessage("");
    setSaveStatus("saving");

    const isPublishing = status === "published";
    const authUser = await getActiveUserForCardSave();

    if (!authUser) {
      setSaveStatus("failed");
      router.replace("/");
      setSaveError("Please log in to save your card.");
      return;
    }

    try {
      const selectedTemplate = templateForCard(
        cardToSave,
        adminTemplates,
        currentPlan
      );

      if (!selectedTemplate?.id) {
        setSaveStatus("failed");
        setSaveError("Please select a template");
        return;
      }

      const slug = buildCardSlugBase(cardToSave);
      const actionConfig =
        cardToSave.action_config ||
        (hasVisitedActionsStep
          ? effectiveCardActionConfig(cardToSave, selectedTemplate)
          : null);

      const nextCard: ClientCard = {
        ...cardToSave,
        card_name: cardToSave.card_name || "Primary Digital Card",
        template_id: selectedTemplate.id,
        template_name: selectedTemplate.name,
        slug,
        public_url: buildPublicCardUrl(slug),
        status,
        last_updated: "Just now",
        field_order: fieldOrder,
        lead_capture_settings:
          normalizeLeadCaptureSettings(cardToSave.lead_capture_settings),
        ...(actionConfig ? { action_config: actionConfig } : {}),
      };

      const savedCard = await saveCardToSupabase({
        card: nextCard,
        userId: authUser.id,
        databaseReady,
        mode: panelMode,
        isPublishing,
      });

      if (!savedCard) {
        setSaveStatus("failed");
        return;
      }

      setCards((currentCards) => {
        const existing = currentCards.some((card) => card.id === draftCard.id);
        const nextCards = existing
          ? currentCards.map((card) => (card.id === draftCard.id ? savedCard : card))
          : [...currentCards, savedCard];

        return sortCardsBySlotOrder(nextCards);
      });

      setSelectedCardId(savedCard.id);
      setSaveStatus(status === "published" ? "published" : "saved");
      setSaveMessage(
        status === "published"
          ? "Card published successfully."
          : "Draft saved successfully."
      );
      if (status === "published") {
        setPublishedSuccessCard(savedCard);
      } else {
        setShowBuilder(false);
      }
    } catch (error) {
      console.error("Client card save failed", error);
      setSaveStatus("failed");
      setSaveError(
        error instanceof Error
          ? error.message
          : "Failed to save card. Please try again."
      );
    }
  }

  function handlePublishCard() {
    void handleSaveCard("published");
  }

  async function saveCardToSupabase({
    card,
    userId,
    databaseReady,
    mode,
    isPublishing = false,
  }: {
    card: ClientCard;
    userId: string;
    databaseReady: boolean;
    mode: PanelMode;
    isPublishing?: boolean;
  }) {
    if (!databaseReady) {
      const message =
        databaseNotice ||
        "Database schema issue: could not confirm public.cards is ready.";
      setSaveError(message);
      setDatabaseNotice(message);
      return null;
    }

    const shouldUpdate = mode === "edit" && !card.id.startsWith("card-");

    const { data, error } = await saveClientCard({
      card,
      userId,
      mode: mode as CardWriteMode,
      isPublishing,
    });

    if (error || !data) {
      console.error("Client card save failed", error);
      console.error("Save error", error);
      const message =
        error
          ? describeCardsDatabaseError(error)
          : shouldUpdate
          ? "Could not update this card. Please refresh My Cards and try again."
          : "Failed to save card. Please try again.";
      setSaveError(message);
      setDatabaseNotice(message);
      return null;
    }

    return mapSupabaseCard(data, adminTemplates, null, currentPlan);
  }

  async function togglePublish(card: ClientCard) {
    const nextStatus: CardStatus =
      card.status === "published" ? "unpublished" : "published";
    const isPublishing = nextStatus === "published";
    const authUser = await getActiveUserForCardSave();

    if (!authUser) {
      router.replace("/");
      setSaveError("Please log in to save your card.");
      return false;
    }

    const selectedTemplate = templateForCard(card, adminTemplates, currentPlan);

    console.log("[DMI cards] selectedTemplate.id", selectedTemplate?.id || null);

    if (!selectedTemplate?.id) {
      setSaveError("Please select a template");
      return false;
    }

    const savedCard = await saveCardToSupabase({
      card: {
        ...card,
        template_id: selectedTemplate.id,
        template_name: selectedTemplate.name,
        status: nextStatus,
        last_updated: "Just now",
      },
      userId: authUser.id,
      databaseReady,
      mode: card.id.startsWith("card-") ? "create" : "edit",
      isPublishing,
    });

    if (!savedCard) return false;

    setCards((currentCards) => {
      const nextCards = currentCards.map((currentCard) =>
        currentCard.id === card.id ? savedCard : currentCard
      );
      return sortCardsBySlotOrder(nextCards);
    });

    return true;
  }

  async function deleteCard(card: ClientCard) {
    setSaveError("");
    setSaveMessage("");
    setSaveStatus("idle");

    if (!card.id.startsWith("card-")) {
      const authUser = await getActiveUserForCardSave();

      if (!authUser) {
        router.replace("/");
        setSaveError("Please log in to delete your card.");
        return false;
      }

      console.log("[DMI cards] delete request", {
        cardId: card.id,
        authenticatedUserId: authUser.id,
      });

      const { data, error } = await deleteCardForUser(card.id, authUser.id);

      console.log("[DMI cards] delete result", {
        cardId: card.id,
        authenticatedUserId: authUser.id,
        deletedRow: data,
        error,
      });

      if (error) {
        console.error("Client card delete failed", error);
        setSaveError(`Could not delete card: ${error.message}`);
        return false;
      }
    }

    setCards((currentCards) => {
      const nextCards = currentCards.filter((currentCard) => currentCard.id !== card.id);
      setSelectedCardId(nextCards[0]?.id || "");
      return nextCards;
    });

    if (draftCard.id === card.id) {
      setShowBuilder(false);
    }

    return true;
  }

  async function copyLink(card: ClientCard) {
    await navigator.clipboard?.writeText(card.public_url);
  }

  function viewPublicPage(card: ClientCard) {
    window.open(card.public_url, "_blank", "noopener,noreferrer");
  }

  return (
    <ClientPortalPage>
        <ClientPortalHeader
          title="My Cards"
          description="Manage your live digital card, public URL, template fields, and lead capture setup."
        />

        {loadingCards ? (
          <div className="rounded-3xl border border-white/10 bg-white/5 p-8 text-white/50">
            Loading your templates and cards...
          </div>
        ) : !currentDefaultTemplate ? (
          <NoTemplateState templates={visibleTemplates} />
        ) : (
          <>
            {limitMessage && (
              <div className="mb-6 rounded-2xl border border-[#AC00FF]/25 bg-[#AC00FF]/10 px-5 py-4 text-sm text-purple-100">
                {limitMessage}
              </div>
            )}

            {saveMessage && (
              <div className="mb-6 rounded-2xl border border-green-400/20 bg-green-500/10 px-5 py-4 text-sm text-green-100">
                {saveMessage}
              </div>
            )}

            {saveError && (
              <div className="mb-6 rounded-2xl border border-red-400/20 bg-red-500/10 px-5 py-4 text-sm text-red-100">
                Save failed: {saveError}
              </div>
            )}

            {databaseNotice && (
              <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-yellow-400/20 bg-yellow-500/10 px-5 py-4 text-sm text-yellow-100 md:flex-row md:items-center md:justify-between">
                <span>{databaseNotice}</span>
                <span className="w-fit rounded-full border border-yellow-200/20 bg-yellow-200/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em]">
                  Preview mode — not saved to database
                </span>
              </div>
            )}

            {templateError && (
              <div className="mb-6 rounded-2xl border border-red-400/20 bg-red-500/10 px-5 py-4 text-sm text-red-100">
                Template load failed: {templateError}
              </div>
            )}

            <CardList
              cards={cards}
              isPaid={isPaid}
              templates={adminTemplates}
              currentPlan={currentPlan}
              onCreate={openCreatePanel}
              onSelect={setSelectedCardId}
              onEdit={openEditPanel}
              onTogglePublish={togglePublish}
              onCopyLink={copyLink}
              onViewPublicPage={viewPublicPage}
              onDelete={deleteCard}
            />

            {showBuilder && (
              <EditorModal
                onClose={() => setShowBuilder(false)}
                actionBar={
                  <EditorStepNavigation
                    activeStep={activeStep}
                    saveStatus={saveStatus}
                    onBack={() =>
                      changeEditorStep(Math.max(0, activeStep - 1) as BuilderStep)
                    }
                    onNext={() =>
                      changeEditorStep(Math.min(3, activeStep + 1) as BuilderStep)
                    }
                    onPublish={handlePublishCard}
                  />
                }
              >
                <div className="grid gap-5 min-[1180px]:grid-cols-[minmax(0,1fr)_minmax(340px,420px)] min-[1500px]:grid-cols-[minmax(0,1fr)_minmax(380px,460px)]">
                  <EditorPanel
                    key={activeStep}
                    activeStep={activeStep}
                    draftCard={draftCard}
                    fieldOrder={fieldOrder}
                    template={draftTemplateRecord || currentDefaultTemplate}
                    templates={visibleTemplates}
                    currentPlan={currentPlan}
                    isPaid={isPaid}
                    onStepChange={changeEditorStep}
                    onUpdate={updateDraft}
                    onSelectTemplate={selectDraftTemplate}
                    onUpdateCustomField={updateCustomField}
                    onUpdateLeadSettings={updateLeadCaptureSettings}
                    onActionConfigChange={updateActionConfig}
                    onToggleFieldVisibility={toggleFieldVisibility}
                    onMoveField={moveField}
                    saveStatus={saveStatus}
                    saveMessage={saveMessage}
                    saveError={saveError}
                  />

                  <aside className="min-w-0">
                    <div className="client-portal-panel p-5">
                      <PreviewPanelContent
                        title={previewTitle}
                        previewCard={previewCard}
                        previewTemplate={previewTemplate}
                        selectedDevice={selectedDevice}
                        selectedKey={devicePreview}
                        search={deviceSearch}
                        open={devicePickerOpen}
                        filteredGroups={filteredDeviceGroups}
                        dimensions={previewDimensions}
                        leadSettings={
                          activeStep === 3
                            ? normalizeLeadCaptureSettings(draftCard.lead_capture_settings)
                            : undefined
                        }
                        previewMode={
                          activeStep === 3 ? stepFourPreviewMode : "card"
                        }
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
                {publishedSuccessCard ? (
                  <PublishSuccessState
                    card={publishedSuccessCard}
                    onAddToWallet={() => router.push("/client/wallet")}
                    onViewPublicPage={viewPublicPage}
                    onCopyLink={copyLink}
                    onEditAgain={() => setPublishedSuccessCard(null)}
                  />
                ) : null}
                {pendingValidation && (
                  <CompletionValidationModal
                    validation={pendingValidation}
                    onGoBack={() => setPendingValidation(null)}
                    onHideAndContinue={() =>
                      continueAfterValidation(pendingValidation)
                    }
                  />
                )}
              </EditorModal>
            )}
          </>
        )}
    </ClientPortalPage>
  );
}

function CompletionValidationModal({
  validation,
  onGoBack,
  onHideAndContinue,
}: {
  validation: PendingValidation;
  onGoBack: () => void;
  onHideAndContinue: () => void;
}) {
  const isActionValidation = validation.kind === "actions";
  const isLeadValidation = validation.kind === "lead_capture";
  const title = isActionValidation
    ? "Some visible actions need setup"
    : isLeadValidation
    ? "Lead capture needs a field"
    : "Some visible fields are incomplete";
  const message = isActionValidation
    ? "These actions are visible, but do not have the details needed to work yet."
    : isLeadValidation
    ? "Collect First needs at least one selected field before this card can be published."
    : "These fields are visible, but do not have content yet.";
  const continueLabel = isActionValidation
    ? "Hide incomplete actions and continue"
    : "Hide incomplete fields and continue";

  return (
    <div className="absolute inset-0 z-50 isolate">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 backdrop-blur-sm"
        style={{ backgroundColor: "rgba(0, 0, 0, 0.55)" }}
      />
      <div className="relative flex h-full items-center justify-center px-4 py-6">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="completion-validation-title"
          className="w-full max-w-lg rounded-3xl border border-[var(--dmi-border)] bg-[var(--dmi-surface)] p-5 text-[var(--text-primary)] shadow-2xl shadow-black/30"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 id="completion-validation-title" className="text-xl font-semibold">
                {title}
              </h3>
              <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
                {message}
              </p>
            </div>
            <button
              type="button"
              onClick={onGoBack}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] text-[var(--text-secondary)] transition hover:bg-[var(--button-hover-bg)] hover:text-[var(--text-primary)]"
              aria-label="Go back"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <ul className="mt-4 space-y-2">
            {validation.issues.map((issue) => (
              <li
                key={issue.key}
                className="rounded-2xl border border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] px-4 py-3"
              >
                <span className="block text-sm font-semibold text-[var(--text-primary)]">
                  {issue.label}
                </span>
                <span className="mt-1 block text-xs text-[var(--text-secondary)]">
                  {issue.detail}
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onGoBack}
              className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[var(--button-secondary-border)] bg-[var(--button-secondary-bg)] px-4 py-2 text-sm font-semibold text-[var(--button-secondary-text)] transition hover:border-[var(--border-brand)] hover:bg-[var(--button-hover-bg)]"
            >
              Go back
            </button>
            <button
              type="button"
              onClick={onHideAndContinue}
              disabled={isLeadValidation}
              className={`${clientButtonClass.primary} min-h-11`}
            >
              {isLeadValidation ? "Select fields to continue" : continueLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function EditorModal({
  children,
  actionBar,
  onClose,
}: {
  children: React.ReactNode;
  actionBar?: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <CardEditorModalShell
      title="Edit Card"
      ariaLabel="Card editor"
      actionBar={actionBar}
      onClose={onClose}
    >
      {children}
    </CardEditorModalShell>
  );
}

function CardList({
  cards,
  isPaid,
  templates,
  currentPlan,
  onCreate,
  onSelect,
  onEdit,
  onTogglePublish,
  onCopyLink,
  onViewPublicPage,
  onDelete,
}: {
  cards: ClientCard[];
  isPaid: boolean;
  templates: AdminTemplate[];
  currentPlan: ClientCardPlan;
  onCreate: (cardSlot: 1 | 2 | 3) => void;
  onSelect: (id: string) => void;
  onEdit: (card: ClientCard) => void;
  onTogglePublish: (card: ClientCard) => Promise<boolean>;
  onCopyLink: (card: ClientCard) => void;
  onViewPublicPage: (card: ClientCard) => void;
  onDelete: (card: ClientCard) => Promise<boolean>;
}) {
  const cardsBySlot = new Map<number, ClientCard>();
  const unassignedCards = cards.filter((card) => {
    if (card.card_slot === 1 || card.card_slot === 2 || card.card_slot === 3) {
      cardsBySlot.set(card.card_slot, card);
      return false;
    }

    return true;
  });
  const slots = Array.from({ length: 3 }, (_, index) => {
    const slotNumber = (index + 1) as 1 | 2 | 3;
    const card = cardsBySlot.get(slotNumber) || unassignedCards[index] || null;
    const locked = !isPaid && index > 0;

    return { index, slotNumber, card, locked };
  });

  return (
    <section className="space-y-4">
      {!isPaid && (
        <div className="flex justify-start">
          <span
            className="rounded-full border bg-[var(--dmi-surface)] px-3 py-1 text-xs font-semibold"
            style={{
              borderColor: "var(--border-accent)",
              color: "var(--text-accent)",
            }}
          >
            Free plan: 1 card limit
          </span>
        </div>
      )}

      <div className="mx-auto grid w-full max-w-[64rem] grid-cols-1 gap-4 min-[1180px]:grid-cols-3">
        {slots.map(({ slotNumber, card, locked }) => {
          if (locked) {
            return <LockedCardSlot key={slotNumber} />;
          }

          if (!card) {
            return <EmptyCardSlot key={slotNumber} slotNumber={slotNumber} onCreate={onCreate} />;
          }

          return (
            <GalleryCardSlot
              key={card.id}
              card={card}
              templates={templates}
              currentPlan={currentPlan}
              onSelect={onSelect}
              onEdit={onEdit}
              onTogglePublish={onTogglePublish}
              onCopyLink={onCopyLink}
              onViewPublicPage={onViewPublicPage}
              onDelete={onDelete}
            />
          );
        })}
      </div>
    </section>
  );
}

function GalleryCardSlot({
  card,
  templates,
  currentPlan,
  onSelect,
  onEdit,
  onTogglePublish,
  onCopyLink,
  onViewPublicPage,
  onDelete,
}: {
  card: ClientCard;
  templates: AdminTemplate[];
  currentPlan: ClientCardPlan;
  onSelect: (id: string) => void;
  onEdit: (card: ClientCard) => void;
  onTogglePublish: (card: ClientCard) => Promise<boolean>;
  onCopyLink: (card: ClientCard) => void;
  onViewPublicPage: (card: ClientCard) => void;
  onDelete: (card: ClientCard) => Promise<boolean>;
}) {
  const [flipped, setFlipped] = useState(false);
  const [deleteConfirming, setDeleteConfirming] = useState(false);
  const [actionPending, setActionPending] = useState<"publish" | "delete" | null>(null);
  const [inlineError, setInlineError] = useState("");
  const cardTemplate = templateForCard(card, templates, currentPlan);
  const previewTemplate = cardTemplate
    ? buildTemplatePreview(
        cardTemplate,
        selectedColourForTemplate(
          cardTemplate,
          card.selected_colour || firstTemplateColour(cardTemplate)
        ),
        selectedTextColourForTemplate(cardTemplate, card.selected_text_colour),
        card.field_order || getInitialFieldOrder(cardTemplate),
        hiddenFieldsForCard(card)
      )
    : null;
  const stateChanging = actionPending !== null;
  const publishLabel = card.status === "published" ? "Unpublish" : "Publish";
  const toggleLabel = flipped ? "View card" : "Manage card";

  async function handleTogglePublish() {
    if (stateChanging) return;

    setInlineError("");
    setActionPending("publish");
    try {
      const success = await onTogglePublish(card);

      if (!success) {
        setInlineError("Could not update publishing status. Please try again.");
      }
    } catch (error) {
      console.error("Gallery publish action failed", error);
      setInlineError("Could not update publishing status. Please try again.");
    } finally {
      setActionPending(null);
    }
  }

  async function handleDeleteConfirmed() {
    if (stateChanging) return;

    setInlineError("");
    setActionPending("delete");
    try {
      const success = await onDelete(card);

      if (success) return;

      setInlineError("Could not delete this card. Please try again.");
      setDeleteConfirming(false);
    } catch (error) {
      console.error("Gallery delete action failed", error);
      setInlineError("Could not delete this card. Please try again.");
      setDeleteConfirming(false);
    } finally {
      setActionPending(null);
    }
  }

  return (
    <article className={slotShellClass}>
      <div className="mx-auto flex w-full max-w-[19rem] flex-1 flex-col">
        <div
          className="relative min-h-0 flex-1"
          style={{ perspective: "1200px" }}
        >
          <div
            className="absolute inset-0 transform-gpu transition-transform duration-500 ease-out motion-reduce:transition-none"
            style={{
              transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
              transformStyle: "preserve-3d",
            }}
          >
            <div
              className="absolute inset-0 overflow-hidden rounded-2xl border border-[var(--dmi-border)] bg-[#070B1A]"
              style={{
                backfaceVisibility: "hidden",
                WebkitBackfaceVisibility: "hidden",
                transform: "rotateY(0deg)",
              }}
              aria-hidden={flipped}
            >
              <div
                role="button"
                onClick={() => onSelect(card.id)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;

                  event.preventDefault();
                  onSelect(card.id);
                }}
                className="flex h-full w-full items-start justify-center overflow-hidden bg-[#070B1A] p-0"
                aria-label={`Select ${card.card_name}`}
                tabIndex={flipped ? -1 : 0}
              >
                {previewTemplate ? (
                  <div className="flex h-full w-full justify-center overflow-hidden">
                    <div className="w-full origin-top">
                      <CardRenderer
                        template={previewTemplate}
                        cardData={card}
                        mode="compact"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="flex h-full items-center text-center text-sm text-white/55">
                    Preview unavailable
                  </div>
                )}
              </div>
            </div>

            <div
              className="absolute inset-0 overflow-hidden rounded-2xl border border-[var(--dmi-border)] bg-[var(--dmi-surface)] p-4 text-[var(--text-primary)]"
              style={{
                backfaceVisibility: "hidden",
                WebkitBackfaceVisibility: "hidden",
                transform: "rotateY(180deg)",
              }}
              aria-hidden={!flipped}
            >
              <div className="flex h-full flex-col">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="truncate text-base font-semibold">{card.card_name}</p>
                    <p className="mt-1 text-sm text-[var(--text-secondary)]">Card management</p>
                  </div>
                  <StatusBadge status={card.status} />
                </div>

                {deleteConfirming ? (
                  <div className="mt-5 rounded-2xl border border-red-200/20 bg-red-500/10 p-4">
                    <p className="font-semibold text-red-50">Delete this card?</p>
                    <p className="mt-2 text-sm leading-6 text-red-50/70">
                      Are you sure you want to permanently delete this card?
                    </p>
                    <div className="mt-4 grid gap-2">
                      <button
                        type="button"
                        onClick={() => void handleDeleteConfirmed()}
                        disabled={stateChanging}
                        className="inline-flex min-h-10 items-center justify-center rounded-full border border-red-300 bg-[var(--button-secondary-bg)] px-4 py-2 text-sm font-semibold text-[var(--button-secondary-text)] transition hover:border-red-500 hover:bg-[var(--error-bg)] hover:text-[var(--error)] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {actionPending === "delete" ? <LoadingDots /> : "Yes, delete"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDeleteConfirming(false);
                          setInlineError("");
                        }}
                        disabled={stateChanging}
                        className="inline-flex min-h-10 items-center justify-center rounded-full border border-[var(--button-secondary-border)] bg-[var(--button-secondary-bg)] px-4 py-2 text-sm font-semibold text-[var(--button-secondary-text)] transition hover:border-[var(--border-brand)] hover:bg-[var(--button-hover-bg)] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        No, keep card
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-5 grid gap-2">
                    <GalleryActionButton
                      label="Edit card"
                      icon={CreditCard}
                      onClick={() => onEdit(card)}
                      disabled={stateChanging}
                    />
                    <GalleryActionButton
                      label="View public page"
                      icon={ExternalLink}
                      onClick={() => onViewPublicPage(card)}
                      disabled={stateChanging}
                    />
                    <GalleryActionButton
                      label="Copy link"
                      icon={Copy}
                      onClick={() => onCopyLink(card)}
                      disabled={stateChanging}
                    />
                    <GalleryActionButton
                      label={actionPending === "publish" ? <LoadingDots /> : publishLabel}
                      icon={actionPending === "publish" ? undefined : Save}
                      onClick={() => void handleTogglePublish()}
                      disabled={stateChanging}
                    />
                    <button
                      type="button"
                      onClick={() => setDeleteConfirming(true)}
                      disabled={stateChanging}
                      className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-red-300/40 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-100 transition hover:border-red-400 hover:bg-red-500/15 hover:text-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Trash2 className="h-4 w-4" />
                      Delete
                    </button>
                  </div>
                )}

                {inlineError && (
                  <p className="mt-3 rounded-xl border border-red-300/20 bg-red-500/10 px-3 py-2 text-sm text-red-100">
                    {inlineError}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            setFlipped((current) => !current);
            setDeleteConfirming(false);
            setInlineError("");
          }}
          className={`${clientButtonClass.primary} mt-4 w-full hover:translate-y-0`}
        >
          <CreditCard className="h-4 w-4" />
          {toggleLabel}
        </button>
      </div>
    </article>
  );
}

function GalleryActionButton({
  label,
  icon: Icon,
  onClick,
  disabled = false,
}: {
  label: React.ReactNode;
  icon?: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-[var(--button-secondary-border)] bg-[var(--button-secondary-bg)] px-4 py-2 text-sm font-medium text-[var(--button-secondary-text)] transition hover:border-[var(--border-brand)] hover:bg-[var(--button-hover-bg)] disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:border-[var(--button-secondary-border)] disabled:hover:bg-[var(--button-secondary-bg)] disabled:hover:text-[var(--button-secondary-text)]"
    >
      {Icon ? <Icon className="h-4 w-4" /> : null}
      {label}
    </button>
  );
}

function LoadingDots() {
  return (
    <span className="inline-flex items-center gap-1" aria-label="Loading">
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.2s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.1s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current" />
    </span>
  );
}

function EmptyCardSlot({
  slotNumber,
  onCreate,
}: {
  slotNumber: 1 | 2 | 3;
  onCreate: (cardSlot: 1 | 2 | 3) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onCreate(slotNumber)}
      className={`${slotShellClass} items-center justify-center text-center`}
    >
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] text-[var(--text-primary)]">
        <BadgePlus className="h-7 w-7" />
      </span>
      <span className="mt-5 text-lg font-semibold text-[var(--text-primary)]">Create a card</span>
      <span className="mt-2 max-w-56 text-sm leading-6 text-[var(--text-secondary)]">
        Design and publish your digital business card
      </span>
    </button>
  );
}

function LockedCardSlot() {
  return (
    <UpgradeToProButton className={`${slotShellClass} items-center justify-center text-center`}>
      <div className="flex flex-1 flex-col items-center justify-center rounded-xl p-5 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] text-[var(--text-secondary)]">
          <Lock className="h-7 w-7" />
        </span>
        <p className="mt-5 text-lg font-semibold text-[var(--text-primary)]">Additional card slot</p>
        <p className="mt-2 max-w-56 text-sm leading-6 text-[var(--text-secondary)]">
          Available with Individual Pro.
        </p>
        <span className="mt-6 inline-flex min-h-10 items-center justify-center rounded-full border border-[var(--button-secondary-border)] bg-[var(--button-secondary-bg)] px-4 py-2 text-sm font-semibold text-[var(--button-secondary-text)] transition group-hover:border-[#AC00FF]/35">
          View upgrade
        </span>
      </div>
    </UpgradeToProButton>
  );
}

function PublishSuccessState({
  card,
  onAddToWallet,
  onViewPublicPage,
  onCopyLink,
  onEditAgain,
}: {
  card: ClientCard;
  onAddToWallet: () => void;
  onViewPublicPage: (card: ClientCard) => void;
  onCopyLink: (card: ClientCard) => void;
  onEditAgain: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-[#050713]/72 px-4 py-6 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="publish-success-title"
    >
      <section className="w-full max-w-[31rem] rounded-3xl border border-white/10 bg-[#101935] p-5 text-center text-white shadow-2xl shadow-black/45 sm:p-6">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-[#AC00FF]/25 bg-[#AC00FF]/15 text-white shadow-lg shadow-purple-500/20">
          <Check className="h-7 w-7" />
        </div>
        <h3 id="publish-success-title" className="mt-5 text-2xl font-semibold text-white">
          Your card is live
        </h3>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-white/65">
          Your digital business card has been published successfully and is
          ready to share.
        </p>

        <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-left">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/40">
            Public card URL
          </p>
          <span className="mt-1 block truncate text-sm font-medium text-white/80">
            {card.public_url}
          </span>
        </div>

        <button
          type="button"
          onClick={onAddToWallet}
          className={`${clientButtonClass.primary} mt-6 w-full`}
        >
          <CreditCard className="h-4 w-4" />
          Add to Wallet
        </button>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => onViewPublicPage(card)}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 text-sm font-semibold text-white/80 shadow-sm transition hover:border-[#AC00FF]/35 hover:bg-white/[0.09] hover:text-white"
          >
            <ExternalLink className="h-4 w-4" />
            View Card
          </button>
          <button
            type="button"
            onClick={() => void onCopyLink(card)}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 text-sm font-semibold text-white/80 shadow-sm transition hover:border-[#AC00FF]/35 hover:bg-white/[0.09] hover:text-white"
          >
            <Copy className="h-4 w-4" />
            Copy Link
          </button>
        </div>

        <button
          type="button"
          onClick={onEditAgain}
          className="mt-3 inline-flex min-h-10 items-center justify-center rounded-2xl px-4 py-2 text-sm font-semibold text-white/50 transition hover:text-white"
        >
          Edit Again
        </button>
      </section>
    </div>
  );
}

function buildTemplatePreview(
  template: AdminTemplate | null,
  selectedColour: string,
  selectedTextColour: string,
  fieldOrder: FieldOrder,
  hiddenFields: string[] = []
): CardRendererTemplate {
  if (!template) return {};

  const rendererFieldOrder = fieldOrderForRenderer(fieldOrder, hiddenFields);
  const hiddenFieldSet = new Set(hiddenFields);
  const allowedFields = mergeAllowedFieldsWithFieldOrder(
    template.allowed_fields || [],
    rendererFieldOrder,
    hiddenFieldSet
  );

  if (template.access_level === "free") {
    return {
      ...template,
      allowed_fields: allowedFields,
      custom_fields: rendererFieldOrder,
      free_colour_palette: [selectedColour],
      colour_palette: [selectedColour],
      primary_color: selectedColour,
      secondary_color: selectedColour,
      text_color: selectedTextColour,
      show_personal_section:
        (template.show_personal_section ?? true) &&
        rendererFieldOrder.personal.length > 0,
      show_company_section:
        (template.show_company_section ?? true) &&
        rendererFieldOrder.company.length > 0,
      show_contact_section:
        (template.show_contact_section ?? true) &&
        rendererFieldOrder.contact.length > 0,
      show_social_section:
        (template.show_social_section ?? false) &&
        rendererFieldOrder.social.length > 0,
    };
  }

  return {
    ...template,
    allowed_fields: allowedFields,
    custom_fields: rendererFieldOrder,
    text_color: selectedTextColour || template.text_color,
    show_personal_section:
      (template.show_personal_section ?? true) &&
      rendererFieldOrder.personal.length > 0,
    show_company_section:
      (template.show_company_section ?? true) &&
      rendererFieldOrder.company.length > 0,
    show_contact_section:
      (template.show_contact_section ?? true) &&
      rendererFieldOrder.contact.length > 0,
    show_social_section:
      (template.show_social_section ?? false) &&
      rendererFieldOrder.social.length > 0,
  };
}

async function loadPublishedTemplates(plan: ClientCardPlan): Promise<AdminTemplate[]> {
  return (await getClientVisibleTemplates(plan)) as AdminTemplate[];
}

function visibleTemplatesForPlan(templates: AdminTemplate[], plan: ClientCardPlan) {
  return visibleTemplatesForPlanForPlan(templates, plan);
}

function defaultTemplateForPlan(templates: AdminTemplate[], plan: ClientCardPlan) {
  return defaultTemplateForPlanForPlan(templates, plan);
}

function templateForCard(
  card: Pick<ClientCard, "template_id"> | null,
  templates: AdminTemplate[],
  plan: ClientCardPlan
) {
  return templateForCardForPlan(card, templates, plan);
}

function canSelectTemplate(
  template: AdminTemplate | CardRendererTemplate,
  plan: ClientCardPlan
) {
  return canSelectTemplateForPlan(template, plan);
}

function mapSupabaseCard(
  row: SupabaseCardRow,
  templates: AdminTemplate[] = [],
  defaultTemplate: ResolvedCardTemplate | null,
  plan: ClientCardPlan
): ClientCard {
  return mapSupabaseCardForPlan(row, templates, plan, defaultTemplate);
}

function sortCardsBySlotOrder(cards: ClientCard[]) {
  return [...cards].sort((first, second) => {
    const firstSlot = first.card_slot || Number.POSITIVE_INFINITY;
    const secondSlot = second.card_slot || Number.POSITIVE_INFINITY;

    if (firstSlot !== secondSlot) {
      return firstSlot - secondSlot;
    }

    const firstCreated = Date.parse(first.created_at || "");
    const secondCreated = Date.parse(second.created_at || "");
    const firstTime = Number.isNaN(firstCreated) ? Number.POSITIVE_INFINITY : firstCreated;
    const secondTime = Number.isNaN(secondCreated) ? Number.POSITIVE_INFINITY : secondCreated;

    if (firstTime !== secondTime) {
      return firstTime - secondTime;
    }

    return first.id.localeCompare(second.id);
  });
}

async function getActiveUserForCardSave(): Promise<User | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (session?.user) {
    return session.user;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user;
}

function device(
  key: DevicePreviewKey,
  label: string,
  brand: string,
  width: number | "100%",
  height: number,
  frameType: DevicePreviewDevice["frameType"],
  options: Pick<DevicePreviewDevice, "dynamicIsland" | "notch"> = {}
): DevicePreviewDevice {
  return { key, label, brand, width, height, frameType, ...options };
}

function allDeviceOptions() {
  return devicePreviewGroups.flatMap((group) => group.devices);
}

function findDevice(key: DevicePreviewKey) {
  return (
    allDeviceOptions().find((device) => device.key === key) ||
    allDeviceOptions().find((device) => device.key === "iphone_15") ||
    devicePreviewGroups[0].devices[0]
  );
}

function filterDeviceGroups(search: string): DevicePreviewGroup[] {
  const searchValue = search.trim().toLowerCase();

  if (!searchValue) return devicePreviewGroups;

  return devicePreviewGroups
    .map((group) => {
      const manufacturerMatches = group.manufacturer
        .toLowerCase()
        .includes(searchValue);
      const devices = group.devices.filter((device) => {
        return (
          manufacturerMatches ||
          device.brand.toLowerCase().includes(searchValue) ||
          device.label.toLowerCase().includes(searchValue)
        );
      });

      return { ...group, devices };
    })
    .filter((group) => group.devices.length > 0);
}

function previewFrameDimensions(device: DevicePreviewDevice) {
  const width = device.width === "100%" ? "100%" : device.width;
  const height = device.height;

  return {
    width: typeof width === "number" ? `${width}px` : width,
    minWidth: typeof width === "number" ? `${width + 28}px` : "390px",
    height,
  };
}

function fieldOrderForRenderer(
  fieldOrder: FieldOrder,
  hiddenFields: string[] = []
): FieldOrder {
  const hiddenFieldSet = new Set(hiddenFields);

  return {
    personal: fieldOrder.personal.filter(
      (field) => field !== "full_name" && !isFieldHidden(field, hiddenFieldSet)
    ),
    company: fieldOrder.company.filter((field) => !isFieldHidden(field, hiddenFieldSet)),
    contact: fieldOrder.contact.filter(
      (field) => field !== "website" && !isFieldHidden(field, hiddenFieldSet)
    ),
    social: fieldOrder.social.filter((field) => !isFieldHidden(field, hiddenFieldSet)),
  };
}

function sectionEnabled(
  template: CardRendererTemplate,
  section: SectionKey
): boolean {
  const key = `show_${section}_section` as keyof CardRendererTemplate;
  const enabled = template[key];

  if (typeof enabled === "boolean") return enabled;

  return section !== "social";
}

function fieldsForSection(
  template: CardRendererTemplate,
  section: SectionKey,
  fieldOrder: FieldOrder
) {
  const allowed = new Set([
    ...(template.allowed_fields || []),
    ...fieldOrder[section],
  ]);
  return fieldOrder[section].filter(
    (field) => field !== "full_name" && allowed.has(field)
  );
}

function sectionConfig(
  template: CardRendererTemplate,
  fieldOrder: FieldOrder
): SectionConfig[] {
  return (Object.keys(sectionLabels) as SectionKey[]).map((section) => ({
    key: section,
    label: sectionLabels[section],
    enabled: sectionEnabled(template, section),
    fields: fieldsForSection(template, section, fieldOrder),
  }));
}

function buildStepSections(
  template: CardRendererTemplate,
  fieldOrder: FieldOrder
): SectionConfig[] {
  return sectionConfig(template, fieldOrder)
    .map((section) =>
      section.key === "social"
        ? {
            ...section,
            fields: section.fields.filter(
              (field) => !stepThreeDestinationFields.has(field)
            ),
          }
        : section
    )
    .filter((section) => section.key !== "social" || section.fields.length > 0);
}

function fieldHasDraftValue(card: ClientCard, field: string) {
  const value = isEditableCardField(field)
    ? card[field]
    : customFieldValue(card, field);

  return typeof value === "string" ? value.trim().length > 0 : Boolean(value);
}

function forceHideFieldsOnCard(card: ClientCard, fields: string[]) {
  const fieldVisibility = normalizeFieldVisibility(card.field_visibility);
  const hiddenFieldSet = new Set(card.hidden_fields || []);

  fields.forEach((field) => {
    const visibilityKey = customFieldStorageKey(field);
    fieldVisibility[visibilityKey] = false;
    hiddenFieldSet.add(visibilityKey);
  });

  return {
    ...card,
    field_visibility: fieldVisibility,
    hidden_fields: Array.from(hiddenFieldSet),
  };
}

function normalizeCardPhoneFields(card: ClientCard): ClientCard {
  return {
    ...card,
    phone: normalizeInternationalPhoneNumber(card.phone) || card.phone,
    whatsapp: normalizeInternationalPhoneNumber(card.whatsapp) || card.whatsapp,
  };
}

function actionIncompleteDetail(type: CardActionType) {
  if (type === "download_pdf") {
    return "Stored PDF metadata is required.";
  }

  const fieldKey = fieldKeyForActionType(type);
  const destination = fieldKey
    ? fieldLabels[fieldKey] || friendlyFieldLabel(fieldKey)
    : "Destination";

  return `${destination} is required.`;
}

function NoTemplateState({ templates }: { templates: AdminTemplate[] }) {
  const paidTemplates = templates.filter((template) => isPaidTemplate(template));

  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-10 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-3xl bg-white/10 text-white/55">
        <Lock className="h-7 w-7" />
      </div>
      <h2 className="mt-6 text-2xl font-semibold">
        No published free template exists. Publish a Free template in Admin.
      </h2>
      {paidTemplates.length > 0 && (
        <div className="mx-auto mt-6 flex max-w-2xl flex-wrap justify-center gap-3">
          {paidTemplates.map((template) => (
            <div
              key={template.id}
              className="inline-flex items-center gap-2 rounded-2xl border border-[#AC00FF]/25 bg-[#AC00FF]/10 px-4 py-2 text-sm text-purple-100"
            >
              <Lock className="h-4 w-4" />
              <span>{template.name}</span>
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/50">
                Paid
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: CardStatus }) {
  const published = status === "published";

  return (
    <span
      className="inline-flex w-fit rounded-full border px-3 py-1 text-xs font-semibold"
      style={
        published
          ? {
              borderColor: "color-mix(in srgb, var(--success) 28%, transparent)",
              background: "var(--success-bg)",
              color: "var(--success)",
            }
          : {
              borderColor: "rgba(248, 113, 113, 0.28)",
              background: "rgba(248, 113, 113, 0.1)",
              color: "#FCA5A5",
            }
      }
    >
      {published ? "Published" : "Unpublished"}
    </span>
  );
}

function friendlyFieldLabel(field: string) {
  const label = field.startsWith("custom:")
    ? field.split(":").at(-1) || field
    : field;

  return label
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}
