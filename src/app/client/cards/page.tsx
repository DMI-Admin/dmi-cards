"use client";

import NextImage from "next/image";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type { User } from "@supabase/supabase-js";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  BadgePlus,
  Calendar,
  Check,
  ChevronDown,
  Copy,
  CreditCard,
  ExternalLink,
  FileText,
  GripVertical,
  Globe,
  ImagePlus,
  Link as LinkIcon,
  Lock,
  Mail,
  Plus,
  Save,
  Search,
  Smartphone,
  Tablet,
  Trash2,
  UserRound,
  X,
  Phone,
} from "lucide-react";
import CardRenderer, {
  combineNameParts,
  displayName,
  type CardRendererTemplate,
} from "@/components/CardRenderer";
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
import { useClientPlan } from "@/lib/use-client-plan";
import {
  actionIsComplete,
  cardActionTypes,
  cardActionValue,
  defaultCardActionConfigForTemplate,
  defaultLabelForActionType,
  effectiveAllowedActions,
  effectiveCardActionConfig,
  fieldKeyForActionType,
  actionLabelIsConfigurable,
  type CardActionConfig,
  type CardActionConfigItem,
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
  readableTextForColour,
  selectedColourForTemplate,
  selectedTextColourForTemplate,
  templateColourPalette,
  templateForCard as templateForCardForPlan,
  templateTextColourPalette,
  visibleTemplatesForPlan as visibleTemplatesForPlanForPlan,
  type CardFieldOrder,
  type CardSectionKey,
  type ClientCardPlan,
  type ClientCardStatus,
  type LeadCaptureSettings,
  type LeadField,
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
type ExpandedBuilderSections = Record<SectionKey, boolean>;
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
type DragTargetPosition<T extends string> = {
  item: T;
  position: "before" | "after";
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

const builderSteps: {
  title: string;
  shortTitle: string;
  subtitle: string;
}[] = [
  {
    title: "Choose your look",
    shortTitle: "Customise",
    subtitle: "Template & colours",
  },
  {
    title: "Build Your Card",
    shortTitle: "Build",
    subtitle: "Your information",
  },
  {
    title: "Your Actions",
    shortTitle: "Actions",
    subtitle: "Visitor actions",
  },
  {
    title: "Setup & Publish",
    shortTitle: "Publish",
    subtitle: "Sharing & lead capture",
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

const fieldHelperText: Record<string, string> = {
  booking_link:
    "Add a Calendly, Microsoft Bookings, Google Calendar booking page or another scheduling link.",
  custom_url:
    "Use for a portfolio, brochure, menu, payment page or another business link.",
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

const editorActionIcons: Record<CardActionType, LucideIcon> = {
  save_contact: UserRound,
  call: Phone,
  email: Mail,
  whatsapp: Smartphone,
  book_meeting: Calendar,
  custom_link: LinkIcon,
  download_pdf: FileText,
  linkedin: Globe,
  instagram: Globe,
  facebook: Globe,
  youtube: Globe,
};

const leadFields: { key: LeadField; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "company", label: "Company" },
  { key: "job_title", label: "Job title" },
  { key: "website", label: "Website" },
  { key: "message", label: "Message" },
];

const titleOptions = ["Mr", "Mrs", "Miss", "Ms", "Mx", "Dr", "Prof", "Sir", "Dame", "Lord", "Lady", "Other"];

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

      const nextDefaultTemplate = defaultTemplateForPlan(nextTemplates, currentPlan);
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
        mapSupabaseCard(row, nextTemplates, nextDefaultTemplate, currentPlan)
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
    const cardTemplate = templateForCard(card, adminTemplates, currentPlan) || currentDefaultTemplate;
    const savedFieldOrder = mergeFieldOrderWithTemplate(card.field_order, cardTemplate);
    setFieldOrder(savedFieldOrder);
    setDraftCard({
      ...card,
      selected_colour: selectedColourForTemplate(cardTemplate, card.selected_colour),
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
          : current.selected_colour || fallbackColour,
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

    const cardToSave = options.cardOverride || draftCard;
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
      const selectedTemplate =
        templateForCard(cardToSave, adminTemplates, currentPlan) || currentDefaultTemplate;

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

    return mapSupabaseCard(data, adminTemplates, currentDefaultTemplate, currentPlan);
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

    const selectedTemplate =
      templateForCard(card, adminTemplates, currentPlan) || currentDefaultTemplate;

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
              defaultTemplate={currentDefaultTemplate}
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
                  publishedSuccessCard ? null : (
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
                  )
                }
              >
                {publishedSuccessCard ? (
                  <PublishSuccessState
                    card={publishedSuccessCard}
                    onViewPublicPage={viewPublicPage}
                    onCopyLink={copyLink}
                    onEditAgain={() => setPublishedSuccessCard(null)}
                  />
                ) : (
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
                )}
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

function PreviewPanelContent({
  title,
  previewCard,
  previewTemplate,
  selectedDevice,
  selectedKey,
  search,
  open,
  filteredGroups,
  dimensions,
  actions,
  leadSettings,
  previewMode = "card",
  onSearchChange,
  onOpenChange,
  onSelect,
  onPreviewModeChange,
}: {
  title: string;
  previewCard: ClientCard | null;
  previewTemplate: CardRendererTemplate;
  selectedDevice: DevicePreviewDevice;
  selectedKey: DevicePreviewKey;
  search: string;
  open: boolean;
  filteredGroups: DevicePreviewGroup[];
  dimensions: ReturnType<typeof previewFrameDimensions>;
  actions?: React.ReactNode;
  leadSettings?: LeadCaptureSettings;
  previewMode?: "card" | "lead_form";
  onSearchChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
  onSelect: (key: DevicePreviewKey) => void;
  onPreviewModeChange?: (mode: "card" | "lead_form") => void;
}) {
  const previewModeChangeHandler = leadSettings ? onPreviewModeChange : undefined;
  const showLeadPreviewControls = Boolean(previewModeChangeHandler);

  return (
    <>
      <div className="mb-5 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">{title}</h2>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              Preview how your public card appears on different devices.
            </p>
          </div>
          {actions}
        </div>

        <DevicePreviewPicker
          selectedDevice={selectedDevice}
          selectedKey={selectedKey}
          search={search}
          open={open}
          filteredGroups={filteredGroups}
          onSearchChange={onSearchChange}
          onOpenChange={onOpenChange}
          onSelect={onSelect}
        />

        {showLeadPreviewControls && (
          <div className="grid grid-cols-2 gap-2 rounded-2xl border border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] p-1">
            {[
              { value: "card", label: "Card" },
              { value: "lead_form", label: "Lead form" },
            ].map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() =>
                  previewModeChangeHandler?.(option.value as "card" | "lead_form")
                }
                className={`rounded-xl px-3 py-2 text-xs font-semibold transition ${
                  previewMode === option.value
                    ? "border border-[#AC00FF]/40 bg-[var(--dmi-surface)] text-[var(--text-primary)] shadow-sm"
                    : "border border-transparent text-[var(--text-secondary)] hover:bg-[var(--button-hover-bg)] hover:text-[var(--text-primary)]"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {previewCard ? (
        <DevicePreviewFrame device={selectedDevice} dimensions={dimensions}>
          {previewMode === "lead_form" && leadSettings ? (
            <LeadCapturePreviewCard
              card={previewCard}
              settings={leadSettings}
            />
          ) : (
            <CardRenderer
              template={previewTemplate}
              cardData={previewCard}
              mode="preview"
            />
          )}
        </DevicePreviewFrame>
      ) : (
        <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-8 text-center text-white/45">
          No card selected.
        </div>
      )}
    </>
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#070B1A]/55 p-3 backdrop-blur-sm sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Card editor"
    >
      <div className="relative flex max-h-[calc(100vh-24px)] w-[min(1480px,calc(100vw-24px))] flex-col overflow-hidden rounded-3xl border border-[var(--dmi-border)] bg-[var(--background)] shadow-2xl shadow-black/40">
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-[var(--dmi-border)] bg-[var(--dmi-surface)] px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-[var(--dmi-border)] bg-[var(--dmi-surface-raised)] shadow-sm">
              <NextImage
                src="/dmi-cards-logo.svg"
                alt=""
                width={24}
                height={24}
                className="h-6 w-6 object-contain"
              />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-xl font-semibold text-[var(--text-primary)]">
                Edit Card
              </h2>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close editor"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-[var(--button-secondary-border)] bg-[var(--button-secondary-bg)] text-[var(--button-secondary-text)] shadow-sm transition hover:border-[var(--border-brand)] hover:bg-[var(--button-hover-bg)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-5">
          {children}
        </div>

        {actionBar}
      </div>
    </div>
  );
}

function CardList({
  cards,
  isPaid,
  templates,
  defaultTemplate,
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
  defaultTemplate: ResolvedCardTemplate | null;
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
              defaultTemplate={defaultTemplate}
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
  defaultTemplate,
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
  defaultTemplate: ResolvedCardTemplate | null;
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
  const cardTemplate = templateForCard(card, templates, currentPlan) || defaultTemplate;
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

function DevicePreviewPicker({
  selectedDevice,
  selectedKey,
  search,
  open,
  filteredGroups,
  onSearchChange,
  onOpenChange,
  onSelect,
}: {
  selectedDevice: DevicePreviewDevice;
  selectedKey: DevicePreviewKey;
  search: string;
  open: boolean;
  filteredGroups: DevicePreviewGroup[];
  onSearchChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
  onSelect: (key: DevicePreviewKey) => void;
}) {
  const selectedSize = deviceSizeLabel(selectedDevice);

  return (
    <div>
      <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">
        Device Preview
      </span>
      <div
        className={`overflow-hidden rounded-2xl border bg-[var(--button-secondary-bg)] text-[var(--button-secondary-text)] transition ${
          open
            ? "border-[#AC00FF]/35 shadow-2xl shadow-purple-950/25"
            : "border-[var(--button-secondary-border)] hover:border-[#AC00FF]/45 hover:bg-[var(--button-hover-bg)] hover:shadow-lg hover:shadow-purple-500/10"
        }`}
      >
        <button
          type="button"
          onClick={() => onOpenChange(!open)}
          className="group flex w-full items-center justify-between gap-4 px-4 py-3 text-left text-sm transition"
          aria-expanded={open}
        >
          <span>
            <span className="block font-semibold">{selectedDevice.label}</span>
            <span className="mt-1 block text-xs text-[var(--text-secondary)]">
              {selectedSize}
            </span>
          </span>
          <span className="rounded-full border border-[var(--border-accent)] bg-[var(--badge-brand-bg)] px-3 py-1 text-xs font-semibold text-[var(--badge-brand-text)] transition group-hover:border-[#AC00FF]/45">
            Change
          </span>
        </button>

        {open && (
          <div className="border-t border-[var(--dmi-border)] bg-[var(--dmi-surface)] p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-secondary)]" />
              <input
                value={search}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder="Search iPhone, Samsung, Pixel..."
                className="w-full rounded-2xl border border-[var(--input-border)] bg-[var(--input-bg)] py-3 pl-10 pr-4 text-sm text-[var(--input-text)] outline-none transition placeholder:text-[var(--dmi-text-tertiary)] focus:border-[var(--input-focus)] focus:ring-4 focus:ring-[var(--input-focus-ring)]"
              />
            </div>

            <div className="mt-3 max-h-80 space-y-4 overflow-y-auto pr-1">
              {filteredGroups.length === 0 ? (
                <div className="rounded-2xl border border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] p-4 text-sm text-[var(--text-secondary)]">
                  No devices found.
                </div>
              ) : (
                filteredGroups.map((group) => {
                  const Icon = group.icon;

                  return (
                    <div key={group.manufacturer}>
                      <div className="mb-2 flex items-center gap-2 px-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">
                        <Icon className="h-4 w-4 text-[var(--text-accent)]" />
                        {group.manufacturer}
                      </div>
                      <div className="space-y-1.5">
                        {group.devices.map((device) => {
                          const selected = device.key === selectedKey;
                          const width =
                            device.width === "100%"
                              ? "Full width"
                              : `${device.width} x ${device.height}px`;

                          return (
                            <button
                              key={device.key}
                              type="button"
                              onClick={() => {
                                onSelect(device.key);
                                onOpenChange(false);
                              }}
                              className={`flex w-full items-center justify-between rounded-2xl border px-3 py-2.5 text-left text-sm transition ${
                                selected
                                  ? "border-[#AC00FF]/70 bg-[image:var(--brand-gradient-subtle)] text-[var(--text-primary)] shadow-lg shadow-purple-500/15"
                                  : "border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] text-[var(--text-secondary)] hover:border-[#AC00FF]/35 hover:bg-[var(--button-hover-bg)] hover:text-[var(--text-primary)]"
                              }`}
                            >
                              <span>
                                <span className="block font-medium">
                                  {device.label}
                                </span>
                                <span className="mt-0.5 block text-xs text-[var(--text-secondary)]">
                                  {width}
                                </span>
                              </span>
                              {selected && (
                                <Check className="h-4 w-4 text-[var(--text-accent)]" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DevicePreviewFrame({
  device,
  dimensions,
  children,
}: {
  device: DevicePreviewDevice;
  dimensions: { width: string; minWidth: string; height: number };
  children: React.ReactNode;
}) {
  const isIphone = device.frameType === "iphone";
  const isTablet = device.frameType === "tablet";
  const isFoldable = device.frameType === "foldable";
  const deviceWidth = device.width === "100%" ? 390 : device.width;
  const shellPadding = isTablet || isFoldable ? 14 : 10;
  const shellRadius = isTablet ? "2rem" : isFoldable ? "2.2rem" : "2.6rem";
  const screenRadius = isTablet ? "1.35rem" : isFoldable ? "1.6rem" : "2rem";
  const previewViewportRef = useRef<HTMLDivElement | null>(null);
  const [previewViewport, setPreviewViewport] = useState({ width: 0, height: 0 });
  const shellWidth = deviceWidth + shellPadding * 2;
  const shellHeight = dimensions.height + shellPadding * 2;
  const previewScale =
    previewViewport.width > 0 && previewViewport.height > 0
      ? Math.min(
          previewViewport.width / shellWidth,
          previewViewport.height / shellHeight,
          1
        )
      : 1;

  useEffect(() => {
    const viewportElement = previewViewportRef.current;

    if (!viewportElement) return;

    function updatePreviewViewport(element: HTMLDivElement) {
      setPreviewViewport({
        width: element.clientWidth,
        height: element.clientHeight,
      });
    }

    updatePreviewViewport(viewportElement);

    const resizeObserver = new ResizeObserver(() => {
      updatePreviewViewport(viewportElement);
    });
    resizeObserver.observe(viewportElement);

    return () => resizeObserver.disconnect();
  }, [device.key]);

  return (
    <div>
      <div className="mb-4 text-center">
        <p className="text-sm font-semibold text-[var(--text-primary)]">{device.label}</p>
        <p className="mt-1 text-xs text-[var(--text-secondary)]">
          {deviceSizeLabel(device)}
        </p>
      </div>

      <div className="p-5 md:p-6">
        <div
          ref={previewViewportRef}
          className="relative flex h-[clamp(420px,calc(100vh-260px),620px)] min-h-[360px] w-full items-start justify-center overflow-hidden"
        >
          <div
            className="origin-top transform-gpu transition-transform duration-300 ease-out"
            style={{
              width: shellWidth,
              minWidth: shellWidth,
              transform: `scale(${previewScale})`,
            }}
          >
            <div
              className="relative mx-auto bg-gradient-to-br from-black via-[#101016] to-[#1B1230] shadow-2xl shadow-[#AC00FF]/20"
              style={{
                borderRadius: shellRadius,
                padding: shellPadding,
              }}
            >
              {isIphone && (
                <div className="pointer-events-none absolute left-1/2 top-[18px] z-20 -translate-x-1/2">
                  {device.dynamicIsland ? (
                    <div className="h-7 w-24 rounded-full bg-black shadow-inner shadow-white/10" />
                  ) : device.notch ? (
                    <div className="h-7 w-32 rounded-b-3xl bg-black shadow-inner shadow-white/10" />
                  ) : (
                    <div className="h-1.5 w-16 rounded-full bg-white/20" />
                  )}
                </div>
              )}

              {!isIphone && !isTablet && (
                <div className="pointer-events-none absolute left-1/2 top-[18px] z-20 h-2 w-2 -translate-x-1/2 rounded-full bg-black shadow-inner shadow-white/20" />
              )}

              <div
                onWheel={(event) => event.stopPropagation()}
                className="relative overflow-y-auto overflow-x-hidden bg-[#070B1A] [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                style={{
                  height: dimensions.height,
                  width: deviceWidth,
                  borderRadius: screenRadius,
                }}
              >
                <div className="w-full min-w-full [&>*]:w-full">{children}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function EditorPanel({
  activeStep,
  draftCard,
  fieldOrder,
  template,
  templates,
  currentPlan,
  isPaid,
  onStepChange,
  onUpdate,
  onSelectTemplate,
  onUpdateCustomField,
  onUpdateLeadSettings,
  onActionConfigChange,
  onToggleFieldVisibility,
  onMoveField,
  saveStatus,
  saveMessage,
  saveError,
}: {
  activeStep: BuilderStep;
  draftCard: ClientCard;
  fieldOrder: FieldOrder;
  template: AdminTemplate;
  templates: AdminTemplate[];
  currentPlan: ClientCardPlan;
  isPaid: boolean;
  onStepChange: (step: BuilderStep) => void;
  onUpdate: (field: keyof ClientCard, value: string) => void;
  onSelectTemplate: (template: AdminTemplate) => void;
  onUpdateCustomField: (field: string, value: string) => void;
  onUpdateLeadSettings: (settings: LeadCaptureSettings) => void;
  onActionConfigChange: (actionConfig: CardActionConfig) => void;
  onToggleFieldVisibility: (field: string) => void;
  onMoveField: (
    section: SectionKey,
    draggedField: string,
    targetField: string,
    position?: "before" | "after"
  ) => void;
  saveStatus: SaveStatus;
  saveMessage: string;
  saveError: string;
}) {
  const [mainProfileExpanded, setMainProfileExpanded] = useState(false);
  const [expandedSections, setExpandedSections] = useState<ExpandedBuilderSections>({
    personal: false,
    company: false,
    contact: false,
    social: false,
  });

  function toggleBuildSection(section: SectionKey) {
    setExpandedSections((current) => ({
      ...current,
      [section]: !current[section],
    }));
  }

  return (
    <section className="overflow-hidden rounded-3xl border border-[var(--dmi-border)] bg-[var(--dmi-surface)] shadow-[var(--shadow-sm)]">
      <div className="shrink-0 border-b border-[var(--dmi-border)] px-5 py-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {builderSteps.map((step, index) => (
            <button
              key={step.title}
              type="button"
              onClick={() => onStepChange(index as BuilderStep)}
              className={`rounded-2xl border px-4 py-3 text-left transition ${
                activeStep === index
                  ? "border-[#AC00FF]/45 bg-[image:var(--brand-gradient-subtle)] text-[var(--text-primary)] shadow-sm ring-2 ring-[#AC00FF]/15"
                  : "border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] text-[var(--text-primary)] hover:border-[var(--border-brand)] hover:bg-[var(--button-hover-bg)]"
              }`}
            >
              <span
                className={`block text-[11px] font-semibold uppercase tracking-[0.16em] ${
                  activeStep === index
                    ? "text-[var(--text-accent)]"
                    : "text-[var(--text-secondary)]"
                }`}
              >
                {index + 1} {step.shortTitle}
              </span>
              <span className="mt-1 block text-xs font-medium leading-5 text-[var(--text-secondary)]">
                {step.subtitle}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="p-5">
        {activeStep === 0 && (
          <CustomiseStep
            template={template}
            templates={templates}
            draftCard={draftCard}
            fieldOrder={fieldOrder}
            currentPlan={currentPlan}
            isPaid={isPaid}
            onUpdate={onUpdate}
            onSelectTemplate={onSelectTemplate}
          />
        )}
        {activeStep === 1 && (
          <BuildStep
            template={template}
            draftCard={draftCard}
            fieldOrder={fieldOrder}
            mainProfileExpanded={mainProfileExpanded}
            expandedSections={expandedSections}
            onUpdate={onUpdate}
            onUpdateCustomField={onUpdateCustomField}
            onToggleFieldVisibility={onToggleFieldVisibility}
            onMoveField={onMoveField}
            onToggleMainProfile={() => setMainProfileExpanded((current) => !current)}
            onToggleSection={toggleBuildSection}
          />
        )}
        {activeStep === 2 && (
          <ActionsStep
            template={template}
            draftCard={draftCard}
            onUpdate={onUpdate}
            onActionConfigChange={onActionConfigChange}
          />
        )}
        {activeStep === 3 && (
          <SetUpStep
            card={draftCard}
            template={template}
            settings={draftCard.lead_capture_settings || defaultLeadCaptureSettings}
            isPaid={isPaid}
            onSettingsChange={onUpdateLeadSettings}
            saveStatus={saveStatus}
            saveMessage={saveMessage}
            saveError={saveError}
          />
        )}
      </div>
    </section>
  );
}

function EditorStepNavigation({
  activeStep,
  saveStatus,
  onBack,
  onNext,
  onPublish,
}: {
  activeStep: BuilderStep;
  saveStatus: SaveStatus;
  onBack: () => void;
  onNext: () => void;
  onPublish: () => void;
}) {
  const nextLabel =
    activeStep === 0
      ? "Continue to Build"
      : activeStep === 1
      ? "Continue to Actions"
      : "Continue to Publish";

  return (
    <div className="sticky bottom-0 z-30 flex min-h-[60px] items-center justify-between gap-3 border-t border-[var(--dmi-border)] bg-[var(--dmi-surface)] px-5 py-2.5 shadow-[0_-16px_32px_rgba(0,0,0,0.08)] backdrop-blur-xl">
      <div className="flex min-h-11 items-center text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">
        Step {activeStep + 1} of 4
      </div>
      <div className="flex items-center justify-end gap-3">
        {activeStep > 0 && (
          <button
            type="button"
            onClick={onBack}
            disabled={saveStatus === "saving"}
            className="inline-flex min-h-11 translate-y-0 items-center justify-center rounded-2xl border border-[var(--button-secondary-border)] bg-[var(--button-secondary-bg)] px-5 py-3 text-sm font-semibold text-[var(--button-secondary-text)] shadow-sm transition hover:translate-y-0 hover:border-[var(--border-brand)] hover:bg-[var(--button-hover-bg)] focus:outline-none focus:ring-2 focus:ring-[#AC00FF]/60 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Back
          </button>
        )}

        {activeStep < 3 ? (
          <button
          type="button"
          onClick={onNext}
          className={`${clientButtonClass.primary} translate-y-0 hover:translate-y-0`}
        >
          {nextLabel}
          {activeStep < 3 && <ArrowRight className="h-4 w-4" />}
          </button>
        ) : (
          <button
          type="button"
          onClick={onPublish}
          disabled={saveStatus === "saving"}
          className={`${clientButtonClass.primary} translate-y-0 hover:translate-y-0`}
        >
            <ExternalLink className="h-4 w-4" />
            {saveStatus === "saving" ? "Publishing..." : "Publish"}
          </button>
        )}
      </div>
    </div>
  );
}

function CustomiseStep({
  template,
  templates,
  draftCard,
  fieldOrder,
  currentPlan,
  isPaid,
  onUpdate,
  onSelectTemplate,
}: {
  template: AdminTemplate;
  templates: AdminTemplate[];
  draftCard: ClientCard;
  fieldOrder: FieldOrder;
  currentPlan: ClientCardPlan;
  isPaid: boolean;
  onUpdate: (field: keyof ClientCard, value: string) => void;
  onSelectTemplate: (template: AdminTemplate) => void;
}) {
  const palette = templateColourPalette(template);
  const approvedPalette = palette.length ? palette : [fallbackColour];
  const activeColour = selectedColourForTemplate(template, draftCard.selected_colour);
  const textPalette = templateTextColourPalette(template, activeColour);
  const activeTextColour = selectedTextColourForTemplate(
    template,
    draftCard.selected_text_colour,
    activeColour
  );

  return (
    <div className="space-y-6 text-[var(--text-primary)]">
      <div>
        <h3 className="text-2xl font-semibold">Choose your look</h3>
        <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
          Pick a template and colour palette — you can always change this later.
        </p>
      </div>

      <div className="max-w-xl">
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">
            Card name
          </span>
          <input
            value={draftCard.card_name}
            onChange={(event) => onUpdate("card_name", event.target.value)}
            placeholder="e.g. Primary Digital Card"
            className="w-full rounded-2xl border border-[var(--input-border)] bg-[var(--input-bg)] px-4 py-3 text-sm text-[var(--input-text)] outline-none transition placeholder:text-[var(--dmi-text-tertiary)] focus:border-[var(--input-focus)] focus:ring-4 focus:ring-[var(--input-focus-ring)]"
          />
        </label>
        <p className="mt-2 text-xs leading-5 text-[var(--text-secondary)]">
          Only visible to you — not shown on your public card.
        </p>
      </div>

      <div>
        <div className="mb-4">
          <p className="text-sm font-semibold text-[var(--text-primary)]">
            Template
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 min-[1280px]:grid-cols-3">
          {templates.map((templateOption) => {
            const selected = templateOption.id === template.id;
            const locked = !canSelectTemplate(templateOption, currentPlan);
            const previewFieldOrder = selected
              ? fieldOrder
              : getInitialFieldOrder(templateOption);
            const previewSelectedColour = selected
              ? activeColour
              : firstTemplateColour(templateOption);
            const previewSelectedTextColour = selected
              ? activeTextColour
              : selectedTextColourForTemplate(
                  templateOption,
                  null,
                  previewSelectedColour
                );
            const previewCardData = selected
              ? draftCard
              : { ...draftCard, selected_text_colour: null };

            return (
              <div
                key={templateOption.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelectTemplate(templateOption)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;

                  event.preventDefault();
                  onSelectTemplate(templateOption);
                }}
                className={`relative min-w-0 rounded-2xl border bg-[var(--dmi-surface-soft)] p-3 text-left transition hover:-translate-y-0.5 hover:border-[var(--border-brand)] hover:bg-[var(--dmi-surface-hover)] hover:shadow-[0_16px_34px_rgba(16,25,53,0.1)] ${
                  selected
                    ? "border-[#AC00FF]/55 shadow-[0_0_0_3px_rgba(172,0,255,0.12),0_16px_34px_rgba(16,25,53,0.12)]"
                    : "border-[var(--dmi-border)]"
                } ${locked ? "opacity-75" : ""} cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#AC00FF]/55 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]`}
                aria-pressed={selected}
              >
                {locked && (
                  <div className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-[#AC00FF]/30 bg-[var(--dmi-surface)] text-[var(--text-accent)] shadow-lg shadow-black/10">
                    <Lock className="h-4 w-4" />
                  </div>
                )}
                {selected && (
                  <span className="dmi-gradient-primary absolute left-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-[image:var(--brand-gradient)] text-white shadow-[var(--shadow-brand)]">
                    <Check className="h-4 w-4" />
                  </span>
                )}
                <div className="flex h-40 items-start justify-center overflow-hidden rounded-xl border border-[var(--dmi-border)] bg-[var(--background)] pt-3">
                  <div className="origin-top scale-[0.45]">
                    <CardRenderer
                      template={buildTemplatePreview(
                        templateOption,
                        previewSelectedColour,
                        previewSelectedTextColour,
                        previewFieldOrder,
                        selected ? hiddenFieldsForCard(draftCard) : []
                      )}
                      cardData={previewCardData}
                      mode="compact"
                    />
                  </div>
                </div>
                <p className="mt-3 truncate text-sm font-semibold text-[var(--text-primary)]">
                  {templateOption.name}
                </p>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <AccessPill template={templateOption} plan={currentPlan} />
                  <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-secondary)]">
                    {selected ? "Selected" : ""}
                  </span>
                </div>
              </div>
            );
          })}

          {templates.length === 0 && (
            <div className="rounded-2xl border border-dashed border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] p-4 text-sm text-[var(--text-secondary)]">
              No published templates are available yet.
            </div>
          )}
        </div>

        {!canSelectTemplate(template, currentPlan) && (
          <div className="mt-5 rounded-2xl border border-[#AC00FF]/30 bg-[image:var(--brand-gradient-subtle)] p-5">
            <div className="flex gap-4">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--dmi-surface)] text-[var(--text-accent)]">
                <Lock className="h-5 w-5" />
              </div>
              <div>
                <p className="font-semibold text-[var(--text-primary)]">{template.name}</p>
                <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
                  Upgrade to Individual Pro to select this paid template.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div>
          <p className="text-sm font-semibold text-[var(--text-primary)]">
            Card colour
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            {approvedPalette.map((colour) => (
              <button
                key={colour}
                type="button"
                onClick={() => onUpdate("selected_colour", colour)}
                className={`flex h-11 w-11 items-center justify-center rounded-full border transition ${
                  activeColour === colour
                    ? "border-white shadow-[0_0_0_3px_rgba(172,0,255,0.28)]"
                    : "border-[var(--dmi-border)]"
                }`}
                style={{ backgroundColor: colour }}
                aria-label={`Select ${colour}`}
              >
                {activeColour === colour && (
                  <Check
                    className="h-5 w-5"
                    style={{ color: readableTextForColour(colour) }}
                  />
                )}
              </button>
            ))}
          </div>
          {!isPaid && (
            <p className="mt-3 text-xs leading-5 text-[var(--text-secondary)]">
              Free users can only choose admin-approved swatches.
            </p>
          )}
        </div>

        <div>
          <p className="text-sm font-semibold text-[var(--text-primary)]">Text colour</p>
          <div className="mt-4 flex flex-wrap gap-3">
            {textPalette.map((colour) => (
              <button
                key={colour}
                type="button"
                onClick={() => onUpdate("selected_text_colour", colour)}
                className={`flex h-11 w-11 items-center justify-center rounded-full border transition ${
                  activeTextColour === colour
                    ? "border-white shadow-[0_0_0_3px_rgba(172,0,255,0.28)]"
                    : "border-[var(--dmi-border)]"
                }`}
                style={{ backgroundColor: colour }}
                aria-label={`Select text colour ${colour}`}
              >
                {activeTextColour === colour && (
                  <Check
                    className="h-5 w-5"
                    style={{ color: readableTextForColour(colour) }}
                  />
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {!isPaid && (
        <UpgradeNotice message="Upgrade to Pro for paid templates, colour pickers, gradients, fonts, logos, banners, socials, and integrations." />
      )}
    </div>
  );
}

function BuildStep({
  template,
  draftCard,
  fieldOrder,
  mainProfileExpanded,
  expandedSections,
  onUpdate,
  onUpdateCustomField,
  onToggleFieldVisibility,
  onMoveField,
  onToggleMainProfile,
  onToggleSection,
}: {
  template: AdminTemplate;
  draftCard: ClientCard;
  fieldOrder: FieldOrder;
  mainProfileExpanded: boolean;
  expandedSections: ExpandedBuilderSections;
  onUpdate: (field: keyof ClientCard, value: string) => void;
  onUpdateCustomField: (field: string, value: string) => void;
  onToggleFieldVisibility: (field: string) => void;
  onMoveField: (
    section: SectionKey,
    draggedField: string,
    targetField: string,
    position?: "before" | "after"
  ) => void;
  onToggleMainProfile: () => void;
  onToggleSection: (section: SectionKey) => void;
}) {
  const sections = buildStepSections(template, fieldOrder);

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-xl font-semibold">Build Your Card</h3>
      </div>

      <MainProfileSection
        draftCard={draftCard}
        expanded={mainProfileExpanded}
        onUpdate={onUpdate}
        onToggleExpanded={onToggleMainProfile}
      />

      {sections.map((section) => (
        <BuilderSection
          key={section.key}
          section={section}
          draftCard={draftCard}
          expanded={expandedSections[section.key]}
          onUpdate={onUpdate}
          onUpdateCustomField={onUpdateCustomField}
          onToggleFieldVisibility={onToggleFieldVisibility}
          onMoveField={onMoveField}
          onToggleExpanded={() => onToggleSection(section.key)}
        />
      ))}
    </div>
  );
}

function MainProfileSection({
  draftCard,
  expanded,
  onUpdate,
  onToggleExpanded,
}: {
  draftCard: ClientCard;
  expanded: boolean;
  onUpdate: (field: keyof ClientCard, value: string) => void;
  onToggleExpanded: () => void;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--dmi-border)] bg-[var(--dmi-surface)] transition">
      <button
        type="button"
        onClick={onToggleExpanded}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-4 bg-[var(--dmi-surface-soft)] px-4 py-3 text-left transition hover:bg-[var(--button-hover-bg)] focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#AC00FF]/45"
      >
        <span className="min-w-0">
          <span className="block text-base font-semibold text-[var(--text-primary)]">
            Main Profile
          </span>
          <span className="mt-1 block text-xs text-[var(--text-secondary)]">
            Your main identity and branding
          </span>
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-[var(--text-secondary)] transition-transform duration-200 ${
            expanded ? "rotate-180" : ""
          }`}
        />
      </button>

      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-out ${
          expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="space-y-3 border-t border-[var(--dmi-border)] p-4">
            <div className="rounded-2xl border border-[var(--dmi-border)] bg-[var(--dmi-surface)] p-4">
              <p className="text-sm font-semibold text-[var(--text-primary)]">
                Identity
              </p>
              <div className="mt-3 grid gap-4 sm:grid-cols-[140px_1fr_1fr]">
                <SelectField
                  label="Title"
                  value={draftCard.title || ""}
                  options={["", ...titleOptions]}
                  onChange={(value) => onUpdate("title", value)}
                />
                <TextField
                  label="First name"
                  value={draftCard.first_name || ""}
                  onChange={(value) => onUpdate("first_name", value)}
                />
                <TextField
                  label="Last name"
                  value={draftCard.last_name || ""}
                  onChange={(value) => onUpdate("last_name", value)}
                />
              </div>
            </div>

            <ProfilePictureUpload
              value={draftCard.profile_image_url || ""}
              fullName={displayName(draftCard, "")}
              onChange={(value) => onUpdate("profile_image_url", value)}
            />

            <BannerImagePlaceholder />
          </div>
        </div>
      </div>
    </div>
  );
}

function BannerImagePlaceholder() {
  return (
    <div className="rounded-2xl border border-[var(--dmi-border)] bg-[var(--dmi-surface)] p-4">
      <div>
        <p className="text-sm font-semibold text-[var(--text-primary)]">Banner Image</p>
      </div>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex aspect-[16/6] min-h-20 w-full items-center justify-center rounded-xl border border-dashed border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] text-[var(--text-secondary)] sm:max-w-64">
          <ImagePlus className="h-6 w-6" />
        </div>
        <button
          type="button"
          disabled
          className="inline-flex min-h-9 w-fit cursor-default items-center justify-center rounded-xl border border-[var(--button-secondary-border)] bg-[var(--button-secondary-bg)] px-3 py-2 text-xs font-semibold text-[var(--button-secondary-text)] opacity-70"
        >
          Add banner
        </button>
      </div>
    </div>
  );
}

function ProfilePictureUpload({
  value,
  fullName,
  onChange,
}: {
  value: string;
  fullName?: string | null;
  onChange: (value: string) => void;
}) {
  const [cropSource, setCropSource] = useState("");
  const [cropPosition, setCropPosition] = useState({ x: 0, y: 0 });
  const [cropZoom, setCropZoom] = useState(1);
  const [imageSize, setImageSize] = useState({ width: 1, height: 1 });
  const dragStartRef = useRef<{
    pointerX: number;
    pointerY: number;
    imageX: number;
    imageY: number;
  } | null>(null);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) return;

    const imageDataUrl = await readFileAsDataUrl(file);
    setCropSource(imageDataUrl);
    setCropPosition({ x: 0, y: 0 });
    setCropZoom(1);
  }

  function resetCrop() {
    setCropPosition({ x: 0, y: 0 });
    setCropZoom(1);
  }

  function cancelCrop() {
    setCropSource("");
    resetCrop();
  }

  async function saveCrop() {
    if (!cropSource) return;

    const croppedImage = await exportCroppedImage({
      source: cropSource,
      imageWidth: imageSize.width,
      imageHeight: imageSize.height,
      position: cropPosition,
      zoom: cropZoom,
    });
    onChange(croppedImage);
    cancelCrop();
  }

  function startDrag(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStartRef.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      imageX: cropPosition.x,
      imageY: cropPosition.y,
    };
  }

  function dragImage(event: PointerEvent<HTMLDivElement>) {
    if (!dragStartRef.current) return;

    setCropPosition({
      x: dragStartRef.current.imageX + event.clientX - dragStartRef.current.pointerX,
      y: dragStartRef.current.imageY + event.clientY - dragStartRef.current.pointerY,
    });
  }

  function stopDrag(event: PointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    dragStartRef.current = null;
  }

  const previewSize = 260;
  const baseScale = Math.max(
    previewSize / imageSize.width,
    previewSize / imageSize.height
  );
  const displayWidth = imageSize.width * baseScale;
  const displayHeight = imageSize.height * baseScale;

  return (
    <div className="rounded-2xl border border-[var(--dmi-border)] bg-[var(--dmi-surface)] p-4">
      <p className="text-sm font-semibold text-[var(--text-primary)]">Profile Photo</p>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center">
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={value}
              alt={fullName ? `${fullName} profile` : "Profile"}
              className="h-16 w-16 rounded-full border-2 border-[var(--dmi-border)] object-cover shadow-lg shadow-purple-950/20"
            />
          ) : (
            <span className="flex h-16 w-16 items-center justify-center rounded-full border border-dashed border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] text-[var(--text-secondary)]">
              <ImagePlus className="h-5 w-5" />
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label className="inline-flex min-h-9 cursor-pointer items-center justify-center rounded-xl border border-[var(--button-secondary-border)] bg-[var(--button-secondary-bg)] px-3 py-2 text-xs font-semibold text-[var(--button-secondary-text)] shadow-sm transition hover:border-[var(--border-brand)] hover:bg-[var(--button-hover-bg)]">
            <input
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="sr-only"
            />
            {value ? "Change photo" : "Add photo"}
          </label>
          {value && (
            <button
              type="button"
              onClick={() => onChange("")}
              className="inline-flex min-h-9 items-center justify-center rounded-xl border border-[var(--button-secondary-border)] bg-[var(--button-secondary-bg)] px-3 py-2 text-xs font-semibold text-[var(--button-secondary-text)] shadow-sm transition hover:border-[var(--border-brand)] hover:bg-[var(--button-hover-bg)]"
            >
              Remove
            </button>
          )}
        </div>
      </div>
      {cropSource && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-[#101935] p-5 text-white shadow-2xl shadow-black/40">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-xl font-semibold">Position profile photo</h3>
                <p className="mt-1 text-sm text-white/45">
                  Drag to reposition, then zoom until the face sits neatly in the circle.
                </p>
              </div>
              <button
                type="button"
                onClick={cancelCrop}
                className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-white/60 transition hover:bg-white/10 hover:text-white"
                aria-label="Cancel crop"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-6 flex justify-center">
              <div
                className="relative h-[260px] w-[260px] touch-none overflow-hidden rounded-full border-2 border-white/25 bg-black/40 shadow-inner shadow-black"
                onPointerDown={startDrag}
                onPointerMove={dragImage}
                onPointerUp={stopDrag}
                onPointerCancel={stopDrag}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={cropSource}
                  alt="Crop preview"
                  draggable={false}
                  onLoad={(event) =>
                    setImageSize({
                      width: event.currentTarget.naturalWidth || 1,
                      height: event.currentTarget.naturalHeight || 1,
                    })
                  }
                  className="absolute left-1/2 top-1/2 max-w-none select-none"
                  style={{
                    width: `${displayWidth}px`,
                    height: `${displayHeight}px`,
                    maxWidth: "none",
                    transform: `translate(-50%, -50%) translate(${cropPosition.x}px, ${cropPosition.y}px) scale(${cropZoom})`,
                    transformOrigin: "center",
                  }}
                />
                <div className="pointer-events-none absolute inset-0 rounded-full ring-1 ring-inset ring-white/40" />
              </div>
            </div>

            <label className="mt-6 block">
              <span className="mb-2 block text-sm font-medium text-white/55">
                Zoom
              </span>
              <input
                type="range"
                min="1"
                max="3"
                step="0.01"
                value={cropZoom}
                onChange={(event) => setCropZoom(Number(event.target.value))}
                className="w-full accent-[#AC00FF]"
              />
            </label>

            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={resetCrop}
                className="rounded-2xl border border-[var(--button-secondary-border)] bg-[var(--button-secondary-bg)] px-4 py-2 text-sm font-medium text-[var(--button-secondary-text)] transition hover:border-[var(--border-brand)] hover:bg-[var(--button-hover-bg)]"
              >
                Reset
              </button>
              <button
                type="button"
                onClick={cancelCrop}
                className="rounded-2xl border border-[var(--button-secondary-border)] bg-[var(--button-secondary-bg)] px-4 py-2 text-sm font-medium text-[var(--button-secondary-text)] transition hover:border-[var(--border-brand)] hover:bg-[var(--button-hover-bg)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void saveCrop()}
                className="dmi-solid-primary rounded-2xl px-5 py-2 text-sm font-semibold transition hover:opacity-90"
              >
                Save crop
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function BuilderSection({
  section,
  draftCard,
  expanded,
  onUpdate,
  onUpdateCustomField,
  onToggleFieldVisibility,
  onMoveField,
  onToggleExpanded,
}: {
  section: SectionConfig;
  draftCard: ClientCard;
  expanded: boolean;
  onUpdate: (field: keyof ClientCard, value: string) => void;
  onUpdateCustomField: (field: string, value: string) => void;
  onToggleFieldVisibility: (field: string) => void;
  onMoveField: (
    section: SectionKey,
    draggedField: string,
    targetField: string,
    position?: "before" | "after"
  ) => void;
  onToggleExpanded: () => void;
}) {
  const [dragState, setDragState] = useState<{
    field: string;
    pointerId: number;
    currentY: number;
    grabOffsetY: number;
    left: number;
    width: number;
    height: number;
  } | null>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const previousRowPositions = useRef<Map<string, DOMRect> | null>(null);

  useLayoutEffect(() => {
    const previousPositions = previousRowPositions.current;

    if (!previousPositions) return;

    rowRefs.current.forEach((element, field) => {
      if (field === dragState?.field) return;

      const previousRect = previousPositions.get(field);

      if (!previousRect) return;

      const nextRect = element.getBoundingClientRect();
      const deltaY = previousRect.top - nextRect.top;

      if (Math.abs(deltaY) < 1) return;

      element.animate(
        [
          { transform: `translateY(${deltaY}px)` },
          { transform: "translateY(0)" },
        ],
        {
          duration: 170,
          easing: "cubic-bezier(0.2, 0, 0, 1)",
        }
      );
    });

    previousRowPositions.current = null;
  }, [dragState?.field, section.fields]);

  const captureRowPositions = useCallback(() => {
    previousRowPositions.current = new Map(
      Array.from(rowRefs.current.entries(), ([field, element]) => [
        field,
        element.getBoundingClientRect(),
      ])
    );
  }, []);

  function registerFieldRow(field: string, element: HTMLDivElement | null) {
    if (element) {
      rowRefs.current.set(field, element);
      return;
    }

    rowRefs.current.delete(field);
  }

  function handleDragStart(
    field: string,
    pointerState: {
      pointerId: number;
      currentY: number;
      grabOffsetY: number;
      left: number;
      width: number;
      height: number;
    }
  ) {
    setDragState({ field, ...pointerState });
  }

  function handleDragMove(field: string, event: PointerEvent<HTMLButtonElement>) {
    if (!dragState || dragState.field !== field || dragState.pointerId !== event.pointerId) {
      return;
    }

    setDragState((current) =>
      current && current.field === field
        ? { ...current, currentY: event.clientY }
        : current
    );

    snapFieldToPointer(field, event.clientY);
  }

  const snapFieldToPointer = useCallback((field: string, pointerY: number) => {
    const orderedRows = section.fields
      .filter((rowField) => rowField !== field)
      .map((rowField) => ({
        field: rowField,
        element: rowRefs.current.get(rowField),
      }))
      .filter(
        (row): row is { field: string; element: HTMLDivElement } =>
          Boolean(row.element)
      );

    const target = resolveDragTargetPosition(
      orderedRows,
      pointerY,
      (row) => row.field
    );

    if (!target) return;

    captureRowPositions();
    onMoveField(section.key, field, target.item, target.position);
  }, [captureRowPositions, onMoveField, section.fields, section.key]);

  const handleDragEnd = useCallback((pointerY = dragState?.currentY) => {
    if (dragState && pointerY !== undefined) {
      snapFieldToPointer(dragState.field, pointerY);
    }

    setDragState(null);
  }, [dragState, snapFieldToPointer]);

  useEffect(() => {
    if (!dragState) return;

    function handleWindowPointerUp(event: globalThis.PointerEvent) {
      if (event.pointerId !== dragState?.pointerId) return;

      handleDragEnd(event.clientY);
    }

    function handleWindowPointerCancel(event: globalThis.PointerEvent) {
      if (event.pointerId !== dragState?.pointerId) return;

      handleDragEnd();
    }

    function handleWindowBlur() {
      handleDragEnd();
    }

    function handleWindowKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;

      setDragState(null);
    }

    window.addEventListener("pointerup", handleWindowPointerUp);
    window.addEventListener("pointercancel", handleWindowPointerCancel);
    window.addEventListener("blur", handleWindowBlur);
    window.addEventListener("keydown", handleWindowKeyDown);

    return () => {
      window.removeEventListener("pointerup", handleWindowPointerUp);
      window.removeEventListener("pointercancel", handleWindowPointerCancel);
      window.removeEventListener("blur", handleWindowBlur);
      window.removeEventListener("keydown", handleWindowKeyDown);
    };
  }, [dragState, handleDragEnd]);

  const visibilitySummary = sectionVisibilitySummary(section, draftCard);

  if (!section.enabled) {
    return (
      <LockedSection
        title={section.label}
        message="Upgrade to Pro to unlock this section."
      />
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--dmi-border)] bg-[var(--dmi-surface)] transition">
      <button
        type="button"
        onClick={() => {
          if (dragState) return;
          onToggleExpanded();
        }}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-4 bg-[var(--dmi-surface-soft)] px-4 py-3 text-left transition hover:bg-[var(--button-hover-bg)] focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#AC00FF]/45"
      >
        <span className="min-w-0">
          <span className="block text-base font-semibold text-[var(--text-primary)]">
            {section.label}
          </span>
          <span className="mt-1 block text-xs text-[var(--text-secondary)]">
            {visibilitySummary}
          </span>
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-[var(--text-secondary)] transition-transform duration-200 ${
            expanded ? "rotate-180" : ""
          }`}
        />
      </button>

      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-out ${
          expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          {section.fields.length === 0 ? (
            <p className="border-t border-[var(--dmi-border)] px-4 py-4 text-sm text-[var(--text-secondary)]">
              No editable fields are enabled for this section.
            </p>
          ) : (
            <div className="space-y-3 border-t border-[var(--dmi-border)] p-4">
              {section.fields.map((field) => (
                <FieldRow
                  key={field}
                  field={field}
                  value={
                    isEditableCardField(field)
                      ? draftCard[field]
                      : customFieldValue(draftCard, field)
                  }
                  helperText={section.key === "social" ? fieldHelperText[field] : undefined}
                  hidden={!isFieldVisible(field, draftCard)}
                  onChange={(value) => {
                    if (isEditableCardField(field)) {
                      onUpdate(field, value);
                      return;
                    }

                    onUpdateCustomField(field, value);
                  }}
                  onToggleVisibility={() => onToggleFieldVisibility(field)}
                  dragState={dragState?.field === field ? dragState : null}
                  onDragStartField={handleDragStart}
                  onDragMoveField={handleDragMove}
                  onDragEndField={handleDragEnd}
                  registerRow={registerFieldRow}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function sectionVisibilitySummary(section: SectionConfig, draftCard: ClientCard) {
  const availableCount = section.fields.length;
  const shownCount = section.fields.filter((field) =>
    isFieldVisible(field, draftCard)
  ).length;
  const hiddenCount = availableCount - shownCount;
  const parts = [`${shownCount} visible`];

  if (availableCount > 0 && shownCount === 0) {
    parts.push(`${availableCount} available`);
  } else if (hiddenCount > 0) {
    parts.push(`${hiddenCount} hidden`);
  }

  return parts.join(" · ");
}

function FieldRow({
  field,
  value,
  helperText,
  hidden,
  onChange,
  onToggleVisibility,
  dragState,
  onDragStartField,
  onDragMoveField,
  onDragEndField,
  registerRow,
}: {
  field: string;
  value: string | null | undefined | ClientCard[keyof ClientCard];
  helperText?: string;
  hidden: boolean;
  onChange: (value: string) => void;
  onToggleVisibility: () => void;
  dragState: {
    field: string;
    pointerId: number;
    currentY: number;
    grabOffsetY: number;
    left: number;
    width: number;
    height: number;
  } | null;
  onDragStartField: (
    field: string,
    pointerState: {
      pointerId: number;
      currentY: number;
      grabOffsetY: number;
      left: number;
      width: number;
      height: number;
    }
  ) => void;
  onDragMoveField: (field: string, event: PointerEvent<HTMLButtonElement>) => void;
  onDragEndField: (pointerY?: number) => void;
  registerRow: (field: string, element: HTMLDivElement | null) => void;
}) {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const setRowElement = useCallback(
    (element: HTMLDivElement | null) => {
      rowRef.current = element;
      registerRow(String(field), element);
    },
    [field, registerRow]
  );
  const dragging = Boolean(dragState);
  const visible = !hidden;

  return (
    <div
      ref={setRowElement}
      style={
        dragState
          ? {
              height: dragState.height,
            }
          : undefined
      }
    >
      <div
        className={`grid gap-2.5 rounded-2xl border p-2.5 transition-[box-shadow,border-color,background-color] duration-150 ease-out md:grid-cols-[28px_1fr_auto] ${
          hidden
            ? "border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)]"
            : "border-[var(--dmi-border)] bg-[var(--dmi-surface)]"
        } ${
          dragging ? "shadow-[0_16px_34px_rgba(0,0,0,0.18)]" : ""
        }`}
        style={
          dragState
            ? {
                position: "fixed",
                zIndex: 60,
                top: dragState.currentY - dragState.grabOffsetY,
                left: dragState.left,
                width: dragState.width,
              }
            : undefined
        }
      >
        <button
          type="button"
          aria-label={`Drag ${fieldLabels[field] || friendlyFieldLabel(field)} to reorder`}
          onPointerDown={(event) => {
            if (event.button !== 0) return;

            const row = rowRef.current;

            if (!row) return;

            const rect = row.getBoundingClientRect();

            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            onDragStartField(String(field), {
              pointerId: event.pointerId,
              currentY: event.clientY,
              grabOffsetY: event.clientY - rect.top,
              left: rect.left,
              width: rect.width,
              height: rect.height,
            });
          }}
          onPointerMove={(event) => onDragMoveField(String(field), event)}
          onPointerUp={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }

            onDragEndField(event.clientY);
          }}
          onPointerCancel={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }

            onDragEndField();
          }}
          className="flex cursor-grab touch-none items-center justify-center rounded-xl text-[var(--text-secondary)] transition hover:bg-[var(--button-hover-bg)] hover:text-[var(--text-primary)] active:cursor-grabbing focus:outline-none focus:ring-2 focus:ring-[#AC00FF]/60"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        {field === "bio" ? (
          <TextArea
            label={fieldLabels[field] || friendlyFieldLabel(field)}
            helperText={helperText}
            value={String(value || "")}
            onChange={onChange}
            autoGrow
            minRows={3}
          />
        ) : (
          <TextField
            label={fieldLabels[field] || friendlyFieldLabel(field)}
            helperText={helperText}
            value={String(value || "")}
            onChange={onChange}
          />
        )}
        <div className="flex min-w-[68px] flex-col items-center justify-end gap-1 self-end">
          <VisibilitySwitch
            visible={visible}
            label={`${fieldLabels[field] || friendlyFieldLabel(field)} visibility`}
            onToggle={onToggleVisibility}
          />
        </div>
      </div>
    </div>
  );
}

function VisibilitySwitch({
  visible,
  label,
  onToggle,
}: {
  visible: boolean;
  label: string;
  onToggle: () => void;
}) {
  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Enter" && event.key !== " ") return;

    event.preventDefault();
    onToggle();
  }

  return (
    <>
      <div
        role="switch"
        aria-checked={visible}
        tabIndex={0}
        aria-label={label}
        onClick={onToggle}
        onKeyDown={handleKeyDown}
        className={`relative h-6 w-11 cursor-pointer rounded-full border transition focus:outline-none focus:ring-2 focus:ring-[#AC00FF]/55 focus:ring-offset-2 focus:ring-offset-[var(--dmi-surface)] ${
          visible
            ? "border-[var(--brand-secondary)] bg-[var(--brand-secondary)] shadow-sm shadow-purple-500/15"
            : "border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] hover:border-[var(--border-brand)]"
        }`}
      >
        <span
          aria-hidden="true"
          className={`absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-white shadow-sm transition-transform ${
            visible ? "translate-x-[22px]" : "translate-x-1"
          }`}
        />
      </div>
      <span className="block h-4 min-w-[48px] text-center text-[11px] font-semibold leading-4 text-[var(--text-secondary)]">
        {visible ? "Visible" : "Hidden"}
      </span>
    </>
  );
}

function ActionsStep({
  template,
  draftCard,
  onUpdate,
  onActionConfigChange,
}: {
  template: AdminTemplate;
  draftCard: ClientCard;
  onUpdate: (field: keyof ClientCard, value: string) => void;
  onActionConfigChange: (actionConfig: CardActionConfig) => void;
}) {
  const [dragState, setDragState] = useState<{
    type: CardActionType;
    pointerId: number;
    currentY: number;
    grabOffsetY: number;
    left: number;
    width: number;
    height: number;
  } | null>(null);
  const [isAddingAction, setIsAddingAction] = useState(false);
  const [expandedActionTypes, setExpandedActionTypes] = useState<
    Set<CardActionType>
  >(() => new Set());
  const rowRefs = useRef(new Map<CardActionType, HTMLDivElement>());
  const previousRowPositions = useRef<Map<CardActionType, DOMRect> | null>(null);
  const allowedActions = effectiveAllowedActions(template);
  const allowedTypes = allowedActions.actions.map((action) => action.type);
  const actionConfig = effectiveCardActionConfig(draftCard, template);
  const actions = actionConfig.actions;
  const configuredTypes = new Set(actions.map((action) => action.type));
  const addableActions = allowedTypes.filter((type) => !configuredTypes.has(type));

  useLayoutEffect(() => {
    const previousPositions = previousRowPositions.current;

    if (!previousPositions) return;

    rowRefs.current.forEach((element, type) => {
      if (type === dragState?.type) return;

      const previousRect = previousPositions.get(type);
      if (!previousRect) return;

      const nextRect = element.getBoundingClientRect();
      const deltaY = previousRect.top - nextRect.top;

      if (Math.abs(deltaY) < 1) return;

      element.animate(
        [
          { transform: `translateY(${deltaY}px)` },
          { transform: "translateY(0)" },
        ],
        {
          duration: 170,
          easing: "cubic-bezier(0.2, 0, 0, 1)",
        }
      );
    });

    previousRowPositions.current = null;
  }, [actions, dragState?.type]);

  const captureActionRowPositions = useCallback(() => {
    previousRowPositions.current = new Map(
      Array.from(rowRefs.current.entries(), ([type, element]) => [
        type,
        element.getBoundingClientRect(),
      ])
    );
  }, []);

  function registerActionRow(type: CardActionType, element: HTMLDivElement | null) {
    if (element) {
      rowRefs.current.set(type, element);
      return;
    }

    rowRefs.current.delete(type);
  }

  function commitActions(nextActions: CardActionConfigItem[]) {
    onActionConfigChange({
      version: 1,
      actions: nextActions.map((action, index) => ({
        ...action,
        id: action.id || action.type,
        label: actionLabelIsConfigurable(action.type)
          ? action.label || defaultLabelForActionType(action.type)
          : undefined,
        order: index,
      })),
    });
  }

  function updateAction(
    type: CardActionType,
    updates: Partial<Pick<CardActionConfigItem, "label" | "visible">>
  ) {
    commitActions(
      actions.map((action) =>
        action.type === type
          ? {
              ...action,
              ...updates,
              label:
                actionLabelIsConfigurable(type) && updates.label !== undefined
                  ? updates.label
                  : action.label,
            }
          : action
      )
    );
  }

  function addAction(type: CardActionType) {
    const allowedAction = allowedActions.actions.find(
      (action) => action.type === type
    );

    commitActions([
      ...actions,
      {
        id: type,
        type,
        visible: allowedAction?.default_visible ?? true,
        order: actions.length,
        label: actionLabelIsConfigurable(type)
          ? allowedAction?.default_label || defaultLabelForActionType(type)
          : undefined,
      },
    ]);
    setIsAddingAction(false);
  }

  function removeAction(type: CardActionType) {
    commitActions(actions.filter((action) => action.type !== type));
  }

  function moveAction(
    draggedType: CardActionType,
    targetType: CardActionType,
    position: "before" | "after" = "before"
  ) {
    if (draggedType === targetType) return;

    const nextActions = [...actions];
    const fromIndex = nextActions.findIndex((action) => action.type === draggedType);
    if (fromIndex < 0) return;

    const [movedAction] = nextActions.splice(fromIndex, 1);
    const toIndex = nextActions.findIndex((action) => action.type === targetType);
    if (toIndex < 0) return;

    nextActions.splice(position === "after" ? toIndex + 1 : toIndex, 0, movedAction);
    commitActions(nextActions);
  }

  function handleActionDragStart(
    type: CardActionType,
    pointerState: {
      pointerId: number;
      currentY: number;
      grabOffsetY: number;
      left: number;
      width: number;
      height: number;
    }
  ) {
    setDragState({ type, ...pointerState });
  }

  function handleActionDragMove(
    type: CardActionType,
    event: PointerEvent<HTMLButtonElement>
  ) {
    if (!dragState || dragState.type !== type || dragState.pointerId !== event.pointerId) {
      return;
    }

    const pointerY = event.clientY;

    setDragState((current) =>
      current && current.type === type ? { ...current, currentY: pointerY } : current
    );

    snapActionToPointer(type, pointerY);
  }

  function snapActionToPointer(type: CardActionType, pointerY: number) {
    const orderedRows = actions
      .map((action) => action.type)
      .filter((rowType) => rowType !== type)
      .map((rowType) => ({
        type: rowType,
        element: rowRefs.current.get(rowType),
      }))
      .filter(
        (row): row is { type: CardActionType; element: HTMLDivElement } =>
          Boolean(row.element)
      );

    const target = resolveDragTargetPosition(
      orderedRows,
      pointerY,
      (row) => row.type
    );

    if (!target) return;

    captureActionRowPositions();
    moveAction(type, target.item, target.position);
  }

  const snapActionToPointerRef = useRef(snapActionToPointer);

  useEffect(() => {
    snapActionToPointerRef.current = snapActionToPointer;
  });

  function handleActionDragEnd(pointerY = dragState?.currentY) {
    if (dragState && pointerY !== undefined) {
      snapActionToPointer(dragState.type, pointerY);
    }

    setDragState(null);
  }

  useEffect(() => {
    if (!dragState) return;

    const activeDrag = dragState;

    function finishDrag(pointerY = activeDrag.currentY) {
      if (pointerY !== undefined) {
        snapActionToPointerRef.current(activeDrag.type, pointerY);
      }

      setDragState(null);
    }

    function handleWindowPointerUp(event: globalThis.PointerEvent) {
      if (event.pointerId !== activeDrag.pointerId) return;

      finishDrag(event.clientY);
    }

    function handleWindowPointerCancel(event: globalThis.PointerEvent) {
      if (event.pointerId !== activeDrag.pointerId) return;

      finishDrag();
    }

    function handleWindowBlur() {
      finishDrag();
    }

    function handleWindowKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;

      setDragState(null);
    }

    window.addEventListener("pointerup", handleWindowPointerUp);
    window.addEventListener("pointercancel", handleWindowPointerCancel);
    window.addEventListener("blur", handleWindowBlur);
    window.addEventListener("keydown", handleWindowKeyDown);

    return () => {
      window.removeEventListener("pointerup", handleWindowPointerUp);
      window.removeEventListener("pointercancel", handleWindowPointerCancel);
      window.removeEventListener("blur", handleWindowBlur);
      window.removeEventListener("keydown", handleWindowKeyDown);
    };
  }, [dragState]);

  function toggleExpandedAction(type: CardActionType) {
    setExpandedActionTypes((current) => {
      const next = new Set(current);

      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }

      return next;
    });
  }

  return (
    <div className="space-y-5 text-[var(--text-primary)]">
      <div>
        <h3 className="text-xl font-semibold">Your Actions</h3>
        <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
          Choose what visitors can do from your digital card.
        </p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-[var(--dmi-border)] bg-[var(--dmi-surface)] transition">
        <div className="flex w-full items-center justify-between gap-4 bg-[var(--dmi-surface-soft)] px-4 py-3 text-left">
          <span className="min-w-0">
            <span className="block text-base font-semibold uppercase tracking-[0.08em] text-[var(--text-primary)]">
              ACTION BUTTONS
            </span>
            <span className="mt-1 block text-xs text-[var(--text-secondary)]">
              {actions.length} configured · {addableActions.length} available
            </span>
          </span>
        </div>

        <div className="space-y-3 border-t border-[var(--dmi-border)] p-4">
          {allowedTypes.length === 0 ? (
            <p className="rounded-2xl border border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] px-4 py-4 text-sm text-[var(--text-secondary)]">
              This template does not have visitor actions enabled yet.
            </p>
          ) : (
            <>
              {actions.length > 0 ? (
                <div className="space-y-3">
                  {actions.map((action) => (
                    <ActionConfigRow
                      key={action.type}
                      action={action}
                      draftCard={draftCard}
                      dragState={dragState?.type === action.type ? dragState : null}
                      expanded={expandedActionTypes.has(action.type)}
                      onUpdate={onUpdate}
                      onUpdateAction={updateAction}
                      onRemove={removeAction}
                      onToggleExpanded={toggleExpandedAction}
                      onDragStart={handleActionDragStart}
                      onDragMove={handleActionDragMove}
                      onDragEnd={handleActionDragEnd}
                      registerRow={registerActionRow}
                    />
                  ))}
                </div>
              ) : (
                <p className="rounded-2xl border border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] px-4 py-4 text-sm text-[var(--text-secondary)]">
                  No actions are configured yet. Add the first visitor action
                  below.
                </p>
              )}

              <div className="rounded-2xl border border-dashed border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] p-3">
                {isAddingAction ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-[var(--text-primary)]">
                        Add action
                      </p>
                      <button
                        type="button"
                        onClick={() => setIsAddingAction(false)}
                        className="rounded-full p-1 text-[var(--text-secondary)] transition hover:bg-[var(--button-hover-bg)] hover:text-[var(--text-primary)]"
                        aria-label="Close add action menu"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    {addableActions.length > 0 ? (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {addableActions.map((type) => {
                          const Icon = editorActionIcons[type];

                          return (
                            <button
                              key={type}
                              type="button"
                              onClick={() => addAction(type)}
                              className="flex items-center gap-3 rounded-xl border border-[var(--dmi-border)] bg-[var(--dmi-surface)] px-3 py-2 text-left text-sm font-semibold text-[var(--text-primary)] transition hover:border-[var(--border-brand)] hover:bg-[var(--button-hover-bg)]"
                            >
                              <Icon className="h-4 w-4 text-[var(--text-accent)]" />
                              <span>{defaultLabelForActionType(type)}</span>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-sm text-[var(--text-secondary)]">
                        Every action available for this template has already been
                        added.
                      </p>
                    )}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setIsAddingAction(true)}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--dmi-border)] bg-[var(--dmi-surface)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:border-[var(--border-brand)] hover:bg-[var(--button-hover-bg)] disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={addableActions.length === 0}
                  >
                    <Plus className="h-4 w-4" />
                    <span>
                      {addableActions.length > 0 ? "Add action" : "All actions added"}
                    </span>
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ActionConfigRow({
  action,
  draftCard,
  dragState,
  expanded,
  onUpdate,
  onUpdateAction,
  onRemove,
  onToggleExpanded,
  onDragStart,
  onDragMove,
  onDragEnd,
  registerRow,
}: {
  action: CardActionConfigItem;
  draftCard: ClientCard;
  dragState: {
    type: CardActionType;
    pointerId: number;
    currentY: number;
    grabOffsetY: number;
    left: number;
    width: number;
    height: number;
  } | null;
  expanded: boolean;
  onUpdate: (field: keyof ClientCard, value: string) => void;
  onUpdateAction: (
    type: CardActionType,
    updates: Partial<Pick<CardActionConfigItem, "label" | "visible">>
  ) => void;
  onRemove: (type: CardActionType) => void;
  onToggleExpanded: (type: CardActionType) => void;
  onDragStart: (
    type: CardActionType,
    pointerState: {
      pointerId: number;
      currentY: number;
      grabOffsetY: number;
      left: number;
      width: number;
      height: number;
    }
  ) => void;
  onDragMove: (type: CardActionType, event: PointerEvent<HTMLButtonElement>) => void;
  onDragEnd: (pointerY?: number) => void;
  registerRow: (type: CardActionType, element: HTMLDivElement | null) => void;
}) {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const setRowElement = useCallback(
    (element: HTMLDivElement | null) => {
      rowRef.current = element;
      registerRow(action.type, element);
    },
    [action.type, registerRow]
  );
  const Icon = editorActionIcons[action.type];
  const fieldKey = fieldKeyForActionType(action.type);
  const destinationValue = cardActionValue(draftCard, action.type);
  const destinationLabel = actionDestinationLabel(action.type);
  const hasDestination = actionIsComplete(action, draftCard);
  const label = action.label || defaultLabelForActionType(action.type);
  const summary = actionDestinationSummary(action.type, destinationValue);
  const labelConfigurable = actionLabelIsConfigurable(action.type);
  const dragging = Boolean(dragState);

  return (
    <div
      ref={setRowElement}
      style={dragState ? { height: dragState.height } : undefined}
    >
      <div
        className={`rounded-2xl border border-[var(--dmi-border)] bg-[var(--dmi-surface)] p-3 transition ${
          dragging ? "shadow-[0_16px_34px_rgba(0,0,0,0.18)]" : "shadow-sm shadow-black/0"
        }`}
        style={
          dragState
            ? {
                position: "fixed",
                zIndex: 60,
                top: dragState.currentY - dragState.grabOffsetY,
                left: dragState.left,
                width: dragState.width,
              }
            : undefined
        }
      >
        <div className="grid items-center gap-3 md:grid-cols-[auto_auto_minmax(0,1fr)_auto_auto]">
          <button
            type="button"
            onPointerDown={(event) => {
              if (event.button !== 0) return;

              const row = rowRef.current;
              if (!row) return;

              const rect = row.getBoundingClientRect();

              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              onDragStart(action.type, {
                pointerId: event.pointerId,
                currentY: event.clientY,
                grabOffsetY: event.clientY - rect.top,
                left: rect.left,
                width: rect.width,
                height: rect.height,
              });
            }}
            onPointerMove={(event) => onDragMove(action.type, event)}
            onPointerUp={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }

              onDragEnd(event.clientY);
            }}
            onPointerCancel={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }

              onDragEnd();
            }}
            className="flex h-10 w-9 cursor-grab touch-none items-center justify-center rounded-xl border border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] text-[var(--text-secondary)] transition hover:border-[var(--border-brand)] hover:text-[var(--text-primary)] active:cursor-grabbing"
            aria-label={`Reorder ${label}`}
          >
            <GripVertical className="h-4 w-4" />
          </button>

          <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] text-[var(--text-accent)]">
            <Icon className="h-4 w-4" />
          </span>

          <button
            type="button"
            onClick={() => onToggleExpanded(action.type)}
            className="min-w-0 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[#AC00FF]/55"
            aria-expanded={expanded}
          >
            <span className="block truncate text-sm font-semibold text-[var(--text-primary)]">
              {label}
            </span>
            <span
              className={`mt-0.5 block truncate text-xs ${
                hasDestination
                  ? "text-[var(--text-secondary)]"
                  : "text-yellow-700 dark:text-yellow-200"
              }`}
            >
              {hasDestination ? summary : "Destination required"}
            </span>
          </button>

          <div className="flex min-w-[68px] flex-col items-center gap-1 justify-self-start md:justify-self-center">
            <VisibilitySwitch
              visible={action.visible}
              label={`${label} action visibility`}
              onToggle={() =>
                onUpdateAction(action.type, { visible: !action.visible })
              }
            />
          </div>

          <button
            type="button"
            onClick={() => onToggleExpanded(action.type)}
            className="flex h-9 w-9 items-center justify-center justify-self-end rounded-xl border border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] text-[var(--text-secondary)] transition hover:border-[var(--border-brand)] hover:bg-[var(--button-hover-bg)] hover:text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#AC00FF]/50"
            aria-label={`${expanded ? "Collapse" : "Edit"} ${label}`}
            aria-expanded={expanded}
          >
            <ChevronDown
              className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`}
            />
          </button>
        </div>

        <div
          className={`grid transition-[grid-template-rows] duration-200 ease-out ${
            expanded ? "mt-3 grid-rows-[1fr]" : "grid-rows-[0fr]"
          }`}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="rounded-2xl border border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] p-3">
              <div className="grid gap-3 lg:grid-cols-2">
                {labelConfigurable ? (
                  <TextField
                    label="Button label"
                    value={label}
                    onChange={(value) =>
                      onUpdateAction(action.type, { label: value })
                    }
                  />
                ) : (
                  <div className="rounded-2xl border border-[var(--dmi-border)] bg-[var(--dmi-surface)] px-4 py-3">
                    <span className="block text-sm font-medium text-[var(--text-secondary)]">
                      Button label
                    </span>
                    <span className="mt-2 block text-sm font-semibold text-[var(--text-primary)]">
                      {defaultLabelForActionType(action.type)}
                    </span>
                  </div>
                )}
                {fieldKey ? (
                  <TextField
                    label={destinationLabel}
                    helperText={actionDestinationHelper(action.type)}
                    value={destinationValue}
                    onChange={(value) => onUpdate(fieldKey as keyof ClientCard, value)}
                  />
                ) : action.type === "download_pdf" ? (
                  <div className="rounded-2xl border border-[var(--dmi-border)] bg-[var(--dmi-surface)] px-4 py-3">
                    <span className="block text-sm font-medium text-[var(--text-secondary)]">
                      PDF file
                    </span>
                    <span className="mt-2 block text-sm text-[var(--text-primary)]">
                      Uses stored file metadata when file uploads are enabled.
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-[var(--text-secondary)]">
                      No file data is embedded in the action configuration.
                    </span>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-[var(--dmi-border)] bg-[var(--dmi-surface)] px-4 py-3">
                    <span className="block text-sm font-medium text-[var(--text-secondary)]">
                      Save Contact
                    </span>
                    <span className="mt-2 block text-sm text-[var(--text-primary)]">
                      Downloads the contact details on this card as a vCard.
                    </span>
                  </div>
                )}
              </div>

              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  onClick={() => onRemove(action.type)}
                  className="inline-flex min-h-9 items-center justify-center rounded-xl border border-red-300/40 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-600 transition hover:border-red-400/70 hover:bg-red-500/15 dark:text-red-200"
                >
                  Remove action
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function actionDestinationLabel(type: CardActionType) {
  const fieldKey = fieldKeyForActionType(type);
  if (!fieldKey) return "Destination";

  return fieldLabels[fieldKey] || defaultLabelForActionType(type);
}

function actionDestinationSummary(type: CardActionType, value: string) {
  if (type === "save_contact") return "vCard download";
  if (type === "download_pdf") return "Stored PDF file";

  const trimmed = value.trim();
  if (!trimmed) return "Destination required";

  return trimmed.length > 46 ? `${trimmed.slice(0, 43)}...` : trimmed;
}

function actionDestinationHelper(type: CardActionType) {
  if (type === "download_pdf") {
    return "This will reference stored PDF metadata when file uploads are enabled.";
  }

  const fieldKey = fieldKeyForActionType(type);
  if (!fieldKey) return undefined;

  return (
    fieldHelperText[fieldKey] ||
    `This uses the same ${actionDestinationLabel(type).toLowerCase()} value from Build Your Card.`
  );
}

function normalizeActionConfigForDraft(
  actionConfig: CardActionConfig
): CardActionConfig {
  return {
    version: 1,
    actions: actionConfig.actions
      .filter((action) => cardActionTypes.includes(action.type))
      .map((action, index) => ({
        id: action.id || action.type,
        type: action.type,
        visible: action.visible !== false,
        order: index,
        label: actionLabelIsConfigurable(action.type)
          ? action.label || defaultLabelForActionType(action.type)
          : undefined,
      })),
  };
}

function SetUpStep({
  card,
  template,
  settings,
  isPaid,
  onSettingsChange,
  saveStatus,
  saveMessage,
  saveError,
}: {
  card: ClientCard;
  template: AdminTemplate;
  settings: LeadCaptureSettings;
  isPaid: boolean;
  onSettingsChange: (settings: LeadCaptureSettings) => void;
  saveStatus: SaveStatus;
  saveMessage: string;
  saveError: string;
}) {
  const normalizedSettings = normalizeLeadCaptureSettings(settings);
  const recipient = leadRecipientName(card);
  const fieldCount = normalizedSettings.fields.length;
  const activeActions = effectiveCardActionConfig(card, template).actions.filter(
    (action) => action.visible && actionIsComplete(action, card)
  ).length;
  const privacyUrl = normalizedSettings.privacy_policy_url || normalizedSettings.terms_url;

  function toggleField(field: LeadField) {
    onSettingsChange({
      ...normalizedSettings,
      fields: normalizedSettings.fields.includes(field)
        ? normalizedSettings.fields.filter((item) => item !== field)
        : [...normalizedSettings.fields, field],
    });
  }

  return (
    <div className="space-y-5 text-[var(--text-primary)]">
      <div>
        <h3 className="text-2xl font-semibold">Review &amp; Publish</h3>
        <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
          Choose how visitors enter your card experience, then publish when the
          setup looks ready.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {[
          {
            value: "share_first",
            label: "Share First",
            description: "Visitors see your card immediately.",
          },
          {
            value: "collect_first",
            label: "Collect First",
            description: "Visitors submit selected details before the card is revealed.",
          },
        ].map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() =>
              onSettingsChange({
                ...normalizedSettings,
                flow: option.value as "collect_first" | "share_first",
              })
            }
            className={`rounded-2xl border bg-[var(--dmi-surface-soft)] px-4 py-4 text-left transition hover:border-[var(--border-brand)] hover:bg-[var(--button-hover-bg)] ${
              normalizedSettings.flow === option.value
                ? "border-[#AC00FF]/55 ring-2 ring-[#AC00FF]/15"
                : "border-[var(--dmi-border)]"
            }`}
          >
            <span className="block text-sm font-semibold text-[var(--text-primary)]">
              {option.label}
            </span>
            <span className="mt-1 block text-xs leading-5 text-[var(--text-secondary)]">
              {option.description}
            </span>
          </button>
        ))}
      </div>

      <div className="rounded-3xl border border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-semibold text-[var(--text-primary)]">Lead fields</p>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              Select the details to ask for when Collect First is enabled.
            </p>
          </div>
          <span className="shrink-0 rounded-full border border-[var(--dmi-border)] bg-[var(--dmi-surface)] px-3 py-1 text-xs font-semibold text-[var(--text-secondary)]">
            {fieldCount} selected
          </span>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {leadFields.map((field) => (
            <button
              key={field.key}
              type="button"
              onClick={() => toggleField(field.key)}
              className={`flex items-center justify-between rounded-2xl border px-4 py-3 text-sm transition ${
                normalizedSettings.fields.includes(field.key)
                  ? "border-[#AC00FF]/50 bg-[#AC00FF]/10 text-[var(--text-primary)]"
                  : "border-[var(--dmi-border)] bg-[var(--dmi-surface)] text-[var(--text-secondary)] hover:bg-[var(--button-hover-bg)]"
              }`}
            >
              {field.label}
              {normalizedSettings.fields.includes(field.key) && (
                <Check className="h-4 w-4 text-[var(--text-accent)]" />
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-3xl border border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] p-5">
        <p className="font-semibold text-[var(--text-primary)]">Privacy &amp; data use</p>
        <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
          {privacyNoticeForRecipient(recipient)}
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <TextArea
            label="Data-use notice"
            value={normalizedSettings.consent_notice}
            onChange={(value) =>
              onSettingsChange({
                ...normalizedSettings,
                consent_notice: value,
              })
            }
          />
          <TextField
            label="Privacy Policy URL"
            value={privacyUrl}
            onChange={(value) =>
              onSettingsChange({
                ...normalizedSettings,
                terms_url: value,
                privacy_policy_url: value,
                privacy_policy_mode: "external",
              })
            }
          />
        </div>
        <p className="mt-3 text-xs leading-5 text-[var(--text-secondary)]">
          A policy URL is optional for personal cards. Hosted DMI policy pages
          can be added later without changing this setup.
        </p>
      </div>

      <div className="rounded-3xl border border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="font-semibold text-[var(--text-primary)]">Marketing opt-in</p>
            <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
              Optional and separate from submitting contact details. Visitors can
              send their enquiry without opting into marketing.
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              onSettingsChange({
                ...normalizedSettings,
                marketing_opt_in_enabled:
                  !normalizedSettings.marketing_opt_in_enabled,
              })
            }
            role="switch"
            aria-checked={normalizedSettings.marketing_opt_in_enabled}
            className={`flex h-7 w-12 shrink-0 items-center rounded-full border p-1 transition focus:outline-none focus:ring-2 focus:ring-[#AC00FF]/45 ${
              normalizedSettings.marketing_opt_in_enabled
                ? "border-[#AC00FF]/50 bg-[#AC00FF]"
                : "border-[var(--dmi-border)] bg-[var(--dmi-surface)]"
            }`}
          >
            <span
              className={`h-4 w-4 rounded-full bg-white shadow-sm transition ${
                normalizedSettings.marketing_opt_in_enabled
                  ? "translate-x-5"
                  : "translate-x-0"
              }`}
            />
          </button>
        </div>
        {normalizedSettings.marketing_opt_in_enabled && (
          <label className="mt-4 block">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">
              Marketing checkbox wording
            </span>
            <input
              value={normalizedSettings.marketing_opt_in_label || ""}
              onChange={(event) =>
                onSettingsChange({
                  ...normalizedSettings,
                  marketing_opt_in_label: event.target.value,
                })
              }
              className="w-full rounded-2xl border border-[var(--input-border)] bg-[var(--input-bg)] px-4 py-3 text-sm text-[var(--input-text)] outline-none transition placeholder:text-[var(--dmi-text-tertiary)] focus:border-[var(--input-focus)] focus:ring-4 focus:ring-[var(--input-focus-ring)]"
            />
          </label>
        )}
      </div>

      <div className="rounded-3xl border border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] p-5">
        <p className="font-semibold text-[var(--text-primary)]">Publish readiness</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <ReadinessItem label="Card ready" value="Ready to publish" ready />
          <ReadinessItem
            label="Active actions"
            value={`${activeActions} configured`}
            ready
          />
          <ReadinessItem
            label="Visitor flow"
            value={
              normalizedSettings.flow === "collect_first"
                ? "Collect First"
                : "Share First"
            }
            ready
          />
          <ReadinessItem
            label="Fields collected"
            value={
              normalizedSettings.flow === "collect_first"
                ? `${fieldCount} selected`
                : "Not required before viewing"
            }
            ready={normalizedSettings.flow !== "collect_first" || fieldCount > 0}
          />
          <ReadinessItem
            label="Privacy"
            value={privacyUrl ? "Policy link added" : "Notice only"}
            ready
          />
          <ReadinessItem
            label="Follow-up email"
            value={
              normalizedSettings.follow_up_enabled
                ? "Saved setting, delivery comes later"
                : "Not enabled"
            }
            ready
          />
        </div>
        {!isPaid && (
          <p className="mt-4 text-xs leading-5 text-[var(--text-secondary)]">
            Privacy and marketing controls are available here for all cards;
            automated follow-up delivery will be handled in a later phase.
          </p>
        )}
      </div>

      {(saveStatus === "saving" || saveMessage || saveError) && (
        <div
          className={`rounded-2xl border px-4 py-3 text-sm ${
            saveError
              ? "border-red-400/20 bg-red-500/10 text-red-100"
              : "border-green-400/20 bg-green-500/10 text-green-100"
          }`}
        >
          {saveStatus === "saving" && "Saving..."}
          {saveStatus !== "saving" && saveError && `Save failed: ${saveError}`}
          {saveStatus !== "saving" && !saveError && saveMessage}
        </div>
      )}
    </div>
  );
}

function ReadinessItem({
  label,
  value,
  ready,
}: {
  label: string;
  value: string;
  ready: boolean;
}) {
  return (
    <div className="rounded-2xl border border-[var(--dmi-border)] bg-[var(--dmi-surface)] px-4 py-3">
      <div className="flex items-center gap-2">
        <span
          className={`flex h-5 w-5 items-center justify-center rounded-full ${
            ready
              ? "bg-[#AC00FF]/15 text-[var(--text-accent)]"
              : "bg-amber-500/15 text-amber-500"
          }`}
        >
          <Check className="h-3.5 w-3.5" />
        </span>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">
          {label}
        </p>
      </div>
      <p className="mt-2 text-sm font-semibold text-[var(--text-primary)]">
        {value}
      </p>
    </div>
  );
}

function LeadCapturePreviewCard({
  card,
  settings,
}: {
  card: ClientCard;
  settings: LeadCaptureSettings;
}) {
  const normalizedSettings = normalizeLeadCaptureSettings(settings);
  const recipient = leadRecipientName(card);
  const privacyNotice =
    normalizedSettings.consent_notice || privacyNoticeForRecipient(recipient);
  const privacyUrl = normalizedSettings.privacy_policy_url || normalizedSettings.terms_url;

  return (
    <div className="flex min-h-[650px] flex-col rounded-[2rem] bg-[#070B1A] p-6 text-white shadow-2xl">
      <div className="mb-5">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/45">
          Lead form preview
        </p>
        <h3 className="mt-2 text-2xl font-semibold">Share your details</h3>
        <p className="mt-3 text-sm leading-6 text-white/65">
          {privacyNotice}
        </p>
        {privacyUrl && (
          <p className="mt-2 text-xs text-white/50">
            Privacy Policy link shown to visitors.
          </p>
        )}
      </div>

      <div className="space-y-3">
        {normalizedSettings.fields.length === 0 ? (
          <div className="rounded-2xl border border-amber-300/25 bg-amber-400/10 p-4 text-sm text-amber-50">
            Select at least one field to preview the Collect First form.
          </div>
        ) : (
          normalizedSettings.fields.map((field) => (
            <label key={field} className="block">
              <span className="mb-1.5 block text-xs font-semibold text-white/70">
                {leadFieldLabel(field)}
              </span>
              {field === "message" ? (
                <div className="min-h-[84px] rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm text-white/35">
                  Visitor message
                </div>
              ) : (
                <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm text-white/35">
                  {leadFieldPlaceholder(field)}
                </div>
              )}
            </label>
          ))
        )}
      </div>

      {normalizedSettings.marketing_opt_in_enabled && (
        <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm leading-6 text-white/65">
          <span className="mr-2 inline-flex h-4 w-4 rounded border border-white/35 align-[-2px]" />
          {normalizedSettings.marketing_opt_in_label ||
            defaultLeadCaptureSettings.marketing_opt_in_label}
        </div>
      )}

      <button
        type="button"
        className="mt-auto inline-flex min-h-12 items-center justify-center rounded-2xl bg-white px-5 text-sm font-bold text-[#070B1A]"
      >
        Continue to card
      </button>
    </div>
  );
}

function PublishSuccessState({
  card,
  onViewPublicPage,
  onCopyLink,
  onEditAgain,
}: {
  card: ClientCard;
  onViewPublicPage: (card: ClientCard) => void;
  onCopyLink: (card: ClientCard) => void;
  onEditAgain: () => void;
}) {
  return (
    <section className="mx-auto flex min-h-[520px] w-full max-w-2xl flex-col items-center justify-center rounded-3xl border border-[var(--dmi-border)] bg-[var(--dmi-surface)] p-6 text-center text-[var(--text-primary)] shadow-[var(--shadow-sm)]">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#AC00FF]/12 text-[var(--text-accent)]">
        <Check className="h-7 w-7" />
      </div>
      <h3 className="mt-5 text-2xl font-semibold">Card published</h3>
      <p className="mt-3 max-w-md text-sm leading-6 text-[var(--text-secondary)]">
        Your public digital card is live. You can view it, copy the link, or
        return to the editor.
      </p>
      <div className="mt-5 w-full rounded-2xl border border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] px-4 py-3 text-sm text-[var(--text-secondary)]">
        <span className="block truncate">{card.public_url}</span>
      </div>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={() => onViewPublicPage(card)}
          className={clientButtonClass.primary}
        >
          <ExternalLink className="h-4 w-4" />
          View Card
        </button>
        <button
          type="button"
          onClick={() => void onCopyLink(card)}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-[var(--button-secondary-border)] bg-[var(--button-secondary-bg)] px-5 py-3 text-sm font-semibold text-[var(--button-secondary-text)] shadow-sm transition hover:border-[var(--border-brand)] hover:bg-[var(--button-hover-bg)]"
        >
          <Copy className="h-4 w-4" />
          Copy Link
        </button>
        <button
          type="button"
          onClick={onEditAgain}
          className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[var(--button-secondary-border)] bg-[var(--button-secondary-bg)] px-5 py-3 text-sm font-semibold text-[var(--button-secondary-text)] shadow-sm transition hover:border-[var(--border-brand)] hover:bg-[var(--button-hover-bg)]"
        >
          Edit Again
        </button>
      </div>
    </section>
  );
}

function leadRecipientName(card: Pick<ClientCard, "company_name" | "first_name" | "last_name" | "full_name">) {
  return card.company_name || displayName(card, "this card owner");
}

function privacyNoticeForRecipient(recipient: string) {
  return `Your details will be shared with ${recipient} so they can respond to your enquiry.`;
}

function leadFieldLabel(field: LeadField) {
  return leadFields.find((item) => item.key === field)?.label || friendlyFieldLabel(field);
}

function leadFieldPlaceholder(field: LeadField) {
  const placeholders: Record<LeadField, string> = {
    name: "Your name",
    email: "you@example.com",
    phone: "Phone number",
    company: "Company",
    job_title: "Job title",
    website: "https://example.com",
    message: "Visitor message",
  };

  return placeholders[field];
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

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => reject(new Error("Could not read image file."));
    reader.onload = () => resolve(String(reader.result || ""));

    reader.readAsDataURL(file);
  });
}

function exportCroppedImage({
  source,
  imageWidth,
  imageHeight,
  position,
  zoom,
}: {
  source: string;
  imageWidth: number;
  imageHeight: number;
  position: { x: number; y: number };
  zoom: number;
}) {
  return new Promise<string>((resolve, reject) => {
    const image = new Image();

    image.onerror = () => reject(new Error("Could not load image file."));
    image.onload = () => {
      const previewSize = 260;
      const outputSize = 512;
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");

      if (!context) {
        reject(new Error("Image cropping is not supported in this browser."));
        return;
      }

      canvas.width = outputSize;
      canvas.height = outputSize;

      const baseScale = Math.max(previewSize / imageWidth, previewSize / imageHeight);
      const outputScale = outputSize / previewSize;
      const drawWidth = imageWidth * baseScale * zoom * outputScale;
      const drawHeight = imageHeight * baseScale * zoom * outputScale;
      const drawX = (outputSize - drawWidth) / 2 + position.x * outputScale;
      const drawY = (outputSize - drawHeight) / 2 + position.y * outputScale;

      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, outputSize, outputSize);
      context.drawImage(image, drawX, drawY, drawWidth, drawHeight);

      resolve(canvas.toDataURL("image/jpeg", 0.9));
    };

    image.src = source;
  });
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

function deviceSizeLabel(device: DevicePreviewDevice) {
  if (device.width === "100%") return "Full width";

  return `${device.width} x ${device.height}px`;
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

function resolveDragTargetPosition<T extends string, TRow extends { element: HTMLElement }>(
  orderedRows: TRow[],
  pointerY: number,
  itemForRow: (row: TRow) => T
): DragTargetPosition<T> | null {
  if (orderedRows.length === 0) return null;

  const targetRow = orderedRows.find(({ element }) => {
    const rect = element.getBoundingClientRect();
    return pointerY < rect.top + rect.height / 2;
  });

  if (targetRow) {
    return {
      item: itemForRow(targetRow),
      position: "before",
    };
  }

  return {
    item: itemForRow(orderedRows[orderedRows.length - 1]),
    position: "after",
  };
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

function LockedSection({ title, message }: { title: string; message: string }) {
  return (
    <div className="rounded-3xl border border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] p-5 opacity-90">
      <div className="flex gap-4">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[var(--dmi-border)] bg-[var(--dmi-surface-raised)] text-[var(--text-secondary)]">
          <Lock className="h-5 w-5" />
        </div>
        <div>
          <p className="font-semibold text-[var(--text-primary)]">{title}</p>
          <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">{message}</p>
        </div>
      </div>
    </div>
  );
}

function TextField({
  label,
  helperText,
  value,
  onChange,
}: {
  label: string;
  helperText?: string;
  value?: string | null;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-[var(--text-secondary)]">
        {label}
      </span>
      <input
        value={value || ""}
        onChange={(event) => onChange(event.target.value)}
        className="h-12 w-full rounded-2xl border border-[var(--input-border)] bg-[var(--input-bg)] px-4 text-sm text-[var(--input-text)] outline-none transition placeholder:text-[var(--dmi-text-tertiary)] focus:border-[var(--input-focus)] focus:ring-4 focus:ring-[var(--input-focus-ring)]"
      />
      {helperText && (
        <span className="mt-2 block text-xs leading-5 text-[var(--text-secondary)]">
          {helperText}
        </span>
      )}
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value?: string | null;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-[var(--text-secondary)]">
        {label}
      </span>
      <select
        value={value || ""}
        onChange={(event) => onChange(event.target.value)}
        className="h-12 w-full rounded-2xl border border-[var(--input-border)] bg-[var(--input-bg)] px-4 text-sm text-[var(--input-text)] outline-none transition focus:border-[var(--input-focus)] focus:ring-4 focus:ring-[var(--input-focus-ring)]"
      >
        {options.map((option) => (
          <option key={option || "none"} value={option}>
            {option || "None"}
          </option>
        ))}
      </select>
    </label>
  );
}

function TextArea({
  label,
  helperText,
  value,
  onChange,
  autoGrow = false,
  minRows = 4,
}: {
  label: string;
  helperText?: string;
  value?: string | null;
  onChange: (value: string) => void;
  autoGrow?: boolean;
  minRows?: number;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const resizeTextarea = useCallback((element: HTMLTextAreaElement) => {
    if (!autoGrow) return;

    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [autoGrow]);

  useEffect(() => {
    if (!textareaRef.current) return;

    resizeTextarea(textareaRef.current);
  }, [resizeTextarea, value]);

  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-[var(--text-secondary)]">
        {label}
      </span>
      <textarea
        ref={textareaRef}
        value={value || ""}
        onChange={(event) => {
          onChange(event.target.value);
          resizeTextarea(event.target);
        }}
        rows={autoGrow ? minRows : 4}
        className={`w-full rounded-2xl border border-[var(--input-border)] bg-[var(--input-bg)] px-4 py-3 text-sm text-[var(--input-text)] outline-none transition placeholder:text-[var(--dmi-text-tertiary)] focus:border-[var(--input-focus)] focus:ring-4 focus:ring-[var(--input-focus-ring)] ${
          autoGrow ? "min-h-[6rem] resize-none overflow-hidden" : ""
        }`}
      />
      {helperText && (
        <span className="mt-2 block text-xs leading-5 text-[var(--text-secondary)]">
          {helperText}
        </span>
      )}
    </label>
  );
}

function UpgradeNotice({ message }: { message: string }) {
  return (
    <div
      className="mt-5 rounded-2xl border p-4 text-sm"
      style={{
        borderColor: "var(--border-accent)",
        background: "var(--brand-gradient-subtle)",
        color: "var(--text-primary)",
      }}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-3">
        <Lock
          className="mt-0.5 h-4 w-4 shrink-0"
          style={{ color: "var(--text-accent)" }}
        />
        <p>{message}</p>
        </div>
        <UpgradeToProButton className="dmi-gradient-primary inline-flex w-full shrink-0 items-center justify-center rounded-2xl bg-[image:var(--brand-gradient)] px-4 py-2.5 text-xs font-semibold text-white shadow-lg shadow-purple-500/20 transition sm:w-auto">
          Upgrade
        </UpgradeToProButton>
      </div>
    </div>
  );
}

function AccessPill({
  template,
  plan,
}: {
  template: AdminTemplate;
  plan: ClientCardPlan;
}) {
  const locked = !canSelectTemplate(template, plan);
  const label = isPaidTemplate(template) ? "Paid" : "Free";

  return (
    <span
      className={`inline-flex w-fit items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${
        locked
          ? "border-[#AC00FF]/30 bg-[image:var(--brand-gradient-subtle)] text-[var(--text-accent)]"
          : "border-[var(--dmi-border)] bg-[var(--dmi-surface)] text-[var(--text-secondary)]"
      }`}
    >
      {locked && <Lock className="h-3 w-3" />}
      {locked ? `${label} locked` : label}
    </span>
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
