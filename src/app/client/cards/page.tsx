"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent,
} from "react";
import type { LucideIcon } from "lucide-react";
import {
  BadgePlus,
  Check,
  Copy,
  CreditCard,
  ExternalLink,
  GripVertical,
  ImagePlus,
  Lock,
  Save,
  Search,
  Smartphone,
  Tablet,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import CardRenderer, {
  type CardRendererData,
  type CardRendererTemplate,
} from "@/components/CardRenderer";
import ClientSidebar from "@/components/ClientSidebar";
import { supabase } from "@/lib/supabase";
import {
  getClientVisibleTemplates,
  normalizeColourPalette,
  type SharedTemplate,
} from "@/lib/templates";
import { ClientAuthRequiredError, requireClientUser } from "@/lib/client-auth";
import { useRouter } from "next/navigation";

const currentPlan = "free" as
  | "free"
  | "individual_pro"
  | "business"
  | "enterprise";
const isPaid = currentPlan !== "free";

type CardStatus = "published" | "unpublished";
type PanelMode = "create" | "edit";
type SectionKey = "personal" | "company" | "contact" | "social";
type BuilderStep = 0 | 1 | 2;
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

type ClientCard = CardRendererData & {
  id: string;
  card_name: string;
  template_id: string;
  template_name: string;
  status: CardStatus;
  public_url: string;
  last_updated: string;
  selected_colour?: string;
  hidden_fields?: string[];
  slug?: string;
  field_order?: FieldOrder;
  lead_capture_settings?: LeadCaptureSettings;
};

type FieldOrder = Record<SectionKey, string[]>;
type LeadField = "name" | "email" | "phone" | "company" | "job_title" | "website" | "message";
type LeadCaptureSettings = {
  flow: "collect_first" | "share_first";
  fields: LeadField[];
  consent_notice: string;
  terms_url: string;
  follow_up_enabled: boolean;
};
type SectionConfig = {
  key: SectionKey;
  label: string;
  enabled: boolean;
  fields: string[];
};

type SupabaseCardRow = CardRendererData & {
  id: string;
  card_name?: string | null;
  template_id?: string | null;
  profile_id?: string | null;
  status?: string | null;
  is_published?: boolean | null;
  slug?: string | null;
  profile_image_url?: string | null;
  company_logo_url?: string | null;
  company_banner_url?: string | null;
  selected_colour?: string | null;
  hidden_fields?: string[] | null;
  field_order?: FieldOrder | null;
  lead_capture_settings?: LeadCaptureSettings | null;
  updated_at?: string | null;
  created_at?: string | null;
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
    title: "Customise Your Card",
    shortTitle: "Customise",
    subtitle: "Choose your template and colour style.",
  },
  {
    title: "Build Your Card",
    shortTitle: "Build",
    subtitle: "Edit the fields enabled by your DMI template.",
  },
  {
    title: "Set Up Your Card",
    shortTitle: "Set Up",
    subtitle: "Configure sharing and lead capture settings.",
  },
];

const sectionLabels: Record<SectionKey, string> = {
  personal: "Personal Details",
  company: "Company Details",
  contact: "Contact Details",
  social: "Social & Links",
};

const sectionDefaults: FieldOrder = {
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
};

const fieldLabels: Record<string, string> = {
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
  booking_link: "Booking Link",
  custom_url: "Custom URL",
  employee_id: "Employee ID",
};

const editableCardFields = new Set<string>([
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
  "facebook",
  "youtube",
  "booking_link",
  "custom_url",
]);

const leadFields: { key: LeadField; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "company", label: "Company" },
  { key: "job_title", label: "Job title" },
  { key: "website", label: "Website" },
  { key: "message", label: "Message" },
];

const defaultLeadCaptureSettings: LeadCaptureSettings = {
  flow: "share_first",
  fields: ["name", "email"],
  consent_notice:
    "I consent to sharing my details so this card owner can follow up.",
  terms_url: "https://www.devmasterinc.com/terms",
  follow_up_enabled: false,
};

const fallbackColour = "#AC00FF";

const blankCard: ClientCard = {
  id: "",
  card_name: "Primary Digital Card",
  template_id: "",
  template_name: "",
  status: "unpublished",
  public_url: "/u/my-digital-card",
  last_updated: "Draft",
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
  hidden_fields: [],
  field_order: getInitialFieldOrder(null),
  lead_capture_settings: defaultLeadCaptureSettings,
};

const initialCards: ClientCard[] = [];

export default function ClientCardsPage() {
  const router = useRouter();
  const [adminTemplates, setAdminTemplates] = useState<AdminTemplate[]>([]);
  const [cards, setCards] = useState<ClientCard[]>(initialCards);
  const [selectedCardId, setSelectedCardId] = useState(initialCards[0]?.id || "");
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelMode, setPanelMode] = useState<PanelMode>("create");
  const [activeStep, setActiveStep] = useState<BuilderStep>(0);
  const [draftCard, setDraftCard] = useState<ClientCard>(blankCard);
  const [fieldOrder, setFieldOrder] = useState<FieldOrder>(
    getInitialFieldOrder(null)
  );
  const [devicePreview, setDevicePreview] =
    useState<DevicePreviewKey>("iphone_15");
  const [deviceSearch, setDeviceSearch] = useState("");
  const [devicePickerOpen, setDevicePickerOpen] = useState(false);
  const [previewDrawerOpen, setPreviewDrawerOpen] = useState(false);
  const [limitMessage, setLimitMessage] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [saveError, setSaveError] = useState("");
  const [databaseNotice, setDatabaseNotice] = useState("");
  const [templateError, setTemplateError] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [loadingCards, setLoadingCards] = useState(true);
  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const [databaseReady, setDatabaseReady] = useState(false);

  const selectedCard = useMemo(() => {
    return cards.find((card) => card.id === selectedCardId) || cards[0] || null;
  }, [cards, selectedCardId]);

  const defaultTemplate = useMemo(
    () => defaultTemplateForPlan(adminTemplates),
    [adminTemplates]
  );
  const visibleTemplates = useMemo(
    () => visibleTemplatesForPlan(adminTemplates),
    [adminTemplates]
  );
  const currentDefaultTemplate = defaultTemplate;
  const selectedCardTemplateRecord = useMemo(() => {
    return templateForCard(selectedCard, adminTemplates) || currentDefaultTemplate;
  }, [adminTemplates, selectedCard, currentDefaultTemplate]);
  const draftTemplateRecord = useMemo(() => {
    return templateForCard(draftCard, adminTemplates) || currentDefaultTemplate;
  }, [adminTemplates, draftCard, currentDefaultTemplate]);
  const selectedCardFallbackColour = firstTemplateColour(selectedCardTemplateRecord);
  const draftFallbackColour = firstTemplateColour(draftTemplateRecord);

  const selectedCardTemplate = useMemo(() => {
    return buildTemplatePreview(
      selectedCardTemplateRecord,
      selectedColourForTemplate(
        selectedCardTemplateRecord,
        selectedCard?.selected_colour || selectedCardFallbackColour
      ),
      selectedCard?.field_order || getInitialFieldOrder(selectedCardTemplateRecord),
      selectedCard?.hidden_fields || []
    );
  }, [
    selectedCardTemplateRecord,
    selectedCardFallbackColour,
    selectedCard?.selected_colour,
    selectedCard?.hidden_fields,
    selectedCard?.field_order,
  ]);

  const draftTemplate = useMemo(() => {
    return buildTemplatePreview(
      draftTemplateRecord,
      selectedColourForTemplate(
        draftTemplateRecord,
        draftCard.selected_colour || draftFallbackColour
      ),
      fieldOrder,
      draftCard.hidden_fields || []
    );
  }, [
    draftTemplateRecord,
    draftCard.selected_colour,
    draftCard.hidden_fields,
    draftFallbackColour,
    fieldOrder,
  ]);

  const publishedCards = cards.filter((card) => card.status === "published").length;
  const previewCard = panelOpen ? draftCard : selectedCard;
  const previewTemplate = panelOpen ? draftTemplate : selectedCardTemplate;
  const previewTitle = panelOpen ? "Live Edit Preview" : "Selected Card Preview";
  const selectedDevice = findDevice(devicePreview);
  const filteredDeviceGroups = filterDeviceGroups(deviceSearch);
  const previewDimensions = previewFrameDimensions(selectedDevice);

  useEffect(() => {
    let ignore = false;

    async function loadSavedCards() {
      setLoadingCards(true);
      setSaveError("");
      setTemplateError("");

      let nextTemplates: AdminTemplate[] = [];

      try {
        nextTemplates = await loadPublishedTemplates();
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

      const nextDefaultTemplate = defaultTemplateForPlan(nextTemplates);
      setAdminTemplates(nextTemplates);

      let userId = "";

      try {
        const { user } = await requireClientUser();
        userId = user.id;
      } catch (error) {
        if (ignore) return;

        if (error instanceof ClientAuthRequiredError) {
          router.replace("/login?next=/client/cards");
        } else {
          console.error("Client auth load failed", error);
          setSaveError("Could not confirm your login session.");
        }

        setLoadingCards(false);
        return;
      }

      if (ignore) return;

      setAuthUserId(userId);

      const { data, error } = await supabase
        .from("cards")
        .select("*")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false });

      if (ignore) return;

      if (error) {
        console.error("Client cards fetch failed", error);
        setDatabaseReady(false);
        setDatabaseNotice("Could not load your saved cards from Supabase.");
        setCards([]);
        setSelectedCardId("");
        setLoadingCards(false);
        return;
      }

      setDatabaseReady(true);
      setDatabaseNotice("");
      const savedCards = (data || []).map((row) =>
        mapSupabaseCard(row, nextTemplates, nextDefaultTemplate)
      );
      console.log("[DMI auth] loaded cards", savedCards);
      setCards(savedCards);
      setSelectedCardId(savedCards[0]?.id || "");
      setLoadingCards(false);
    }

    void loadSavedCards();

    return () => {
      ignore = true;
    };
  }, [router]);

  function openCreatePanel() {
    if (!currentDefaultTemplate) return;

    if (!isPaid && cards.length >= 1) {
      setLimitMessage(
        "Free users can only have one card. Upgrade to Individual Pro to create more cards."
      );
      return;
    }

    setLimitMessage("");
    setPanelMode("create");
    setActiveStep(0);
    const initialFieldOrder = getInitialFieldOrder(currentDefaultTemplate);
    setFieldOrder(initialFieldOrder);
    setDraftCard({
      ...blankCard,
      id: `card-${Date.now()}`,
      template_id: currentDefaultTemplate.id,
      template_name: currentDefaultTemplate.name,
      selected_colour: firstTemplateColour(currentDefaultTemplate),
      field_order: initialFieldOrder,
      lead_capture_settings: defaultLeadCaptureSettings,
    });
    setPanelOpen(true);
  }

  function openEditPanel(card: ClientCard) {
    setLimitMessage("");
    setPanelMode("edit");
    setActiveStep(0);
    const cardTemplate = templateForCard(card, adminTemplates) || currentDefaultTemplate;
    const savedFieldOrder = card.field_order || getInitialFieldOrder(cardTemplate);
    setFieldOrder(savedFieldOrder);
    setDraftCard({
      ...card,
      selected_colour: selectedColourForTemplate(cardTemplate, card.selected_colour),
      custom_fields: { ...(card.custom_fields || {}) },
    });
    setSelectedCardId(card.id);
    setPanelOpen(true);
  }

  function updateDraft(field: keyof ClientCard, value: string) {
    setDraftCard((current) => ({ ...current, [field]: value }));

    if (field === "card_name" && panelMode === "edit") {
      setCards((currentCards) =>
        currentCards.map((card) =>
          card.id === draftCard.id ? { ...card, card_name: value } : card
        )
      );
    }
  }

  function selectDraftTemplate(template: AdminTemplate) {
    if (!canSelectTemplate(template)) {
      setLimitMessage("Upgrade to Individual Pro to use paid templates.");
      return;
    }

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
      hidden_fields: [],
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
      lead_capture_settings: settings,
    }));
  }

  function toggleFieldVisibility(field: string) {
    setDraftCard((current) => {
      const hiddenFields = current.hidden_fields || [];

      return {
        ...current,
        hidden_fields: hiddenFields.includes(field)
          ? hiddenFields.filter((hiddenField) => hiddenField !== field)
          : [...hiddenFields, field],
      };
    });
  }

  function moveField(section: SectionKey, draggedField: string, targetField: string) {
    setFieldOrder((current) => {
      const nextSectionFields = [...current[section]];
      const fromIndex = nextSectionFields.indexOf(draggedField);
      const toIndex = nextSectionFields.indexOf(targetField);

      if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) {
        return current;
      }

      const [movedField] = nextSectionFields.splice(fromIndex, 1);
      nextSectionFields.splice(toIndex, 0, movedField);

      const nextFieldOrder = { ...current, [section]: nextSectionFields };
      setDraftCard((currentCard) => ({
        ...currentCard,
        field_order: nextFieldOrder,
      }));

      return nextFieldOrder;
    });
  }

  async function handleSaveCard(status: CardStatus) {
    setSaveError("");
    setSaveMessage("");
    setSaveStatus("saving");

    const baseSlug = slugify(
      draftCard.slug ||
        draftCard.full_name ||
        draftCard.card_name ||
        "digital-card"
    );
    const slug =
      authUserId && databaseReady
        ? await ensureUniqueCardSlug(
            baseSlug,
            draftCard.id.startsWith("card-") ? null : draftCard.id
          )
        : baseSlug;

    const nextCard: ClientCard = {
      ...draftCard,
      card_name: draftCard.card_name || "Primary Digital Card",
      slug,
      public_url: `/u/${slug}`,
      status,
      last_updated: "Just now",
      field_order: fieldOrder,
      lead_capture_settings:
        draftCard.lead_capture_settings || defaultLeadCaptureSettings,
    };

    const savedCard = await saveCardToSupabase({
      card: nextCard,
      userId: authUserId,
      databaseReady,
      mode: panelMode,
    });

    if (!savedCard) {
      setSaveStatus("failed");
      return;
    }

    setCards((currentCards) => {
      const existing = currentCards.some((card) => card.id === draftCard.id);
      const nextCards = existing
        ? currentCards.map((card) => (card.id === draftCard.id ? savedCard : card))
        : [savedCard, ...currentCards];

      return nextCards;
    });

    setSelectedCardId(savedCard.id);
    setSaveStatus(status === "published" ? "published" : "saved");
    setSaveMessage(
      status === "published"
        ? "Card published successfully."
        : "Draft saved successfully."
    );
    setPanelOpen(false);
  }

  function handleSaveDraft() {
    void handleSaveCard("unpublished");
  }

  function handlePublishCard() {
    void handleSaveCard("published");
  }

  async function saveCardToSupabase({
    card,
    userId,
    databaseReady,
    mode,
  }: {
    card: ClientCard;
    userId: string | null;
    databaseReady: boolean;
    mode: PanelMode;
  }) {
    if (!userId || !databaseReady) {
      router.replace("/login?next=/client/cards");
      setSaveError("Please log in to save your card.");
      return null;
    }

    const payload = buildSupabaseCardPayload(card, userId);
    const shouldUpdate = mode === "edit" && !card.id.startsWith("card-");

    const { data, error } = await writeCardPayload({
      cardId: card.id,
      payload,
      shouldUpdate,
    });

    if (error || !data) {
      console.error("Client card save failed", error);
      console.error("Save error", error);
      const message =
        error?.message || "Failed to save card. Please try again.";
      setSaveError(message);
      setDatabaseNotice(
        "Database save failed. Your card was not saved."
      );
      return null;
    }

    return mapSupabaseCard(data, adminTemplates, currentDefaultTemplate);
  }

  async function togglePublish(card: ClientCard) {
    const nextStatus: CardStatus =
      card.status === "published" ? "unpublished" : "published";
    const savedCard = await saveCardToSupabase({
      card: {
        ...card,
        status: nextStatus,
        last_updated: "Just now",
      },
      userId: authUserId,
      databaseReady,
      mode: card.id.startsWith("card-") ? "create" : "edit",
    });

    if (!savedCard) return;

    setCards((currentCards) => {
      const nextCards = currentCards.map((currentCard) =>
        currentCard.id === card.id ? savedCard : currentCard
      );
      return nextCards;
    });
  }

  function deleteCard(card: ClientCard) {
    const confirmed = window.confirm("Delete this card permanently?");

    if (!confirmed) return;

    setCards((currentCards) => {
      const nextCards = currentCards.filter((currentCard) => currentCard.id !== card.id);
      setSelectedCardId(nextCards[0]?.id || "");
      return nextCards;
    });
  }

  async function copyLink(card: ClientCard) {
    await navigator.clipboard?.writeText(card.public_url);
  }

  function viewPublicPage(card: ClientCard) {
    window.open(card.public_url, "_blank", "noopener,noreferrer");
  }

  return (
    <main className="flex min-h-screen bg-[#070B1A] text-white">
      <ClientSidebar />

      <section className="flex-1 p-10">
        <div className="mb-8 flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#AC00FF]">
              Client Portal
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <h1 className="text-4xl font-bold">My Cards</h1>
              <PlanBadge />
            </div>
            <p className="mt-3 max-w-3xl text-white/50">
              Manage your live digital card, public URL, template fields, and
              lead capture setup.
            </p>
          </div>

          <button
            type="button"
            onClick={openCreatePanel}
            disabled={!currentDefaultTemplate || (!isPaid && cards.length >= 1)}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#AC00FF] to-[#6C2CFF] px-5 py-3 text-sm font-semibold shadow-lg shadow-purple-500/20 transition hover:shadow-purple-500/35 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <BadgePlus className="h-4 w-4" />
            Create New Card
          </button>
        </div>

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

            <div className="grid gap-8 2xl:grid-cols-[minmax(0,1fr)_minmax(560px,600px)]">
              <div className="space-y-6">
                <div className="grid gap-4 md:grid-cols-3">
                  <StatCard label="Current Plan" value={planLabel(currentPlan)} />
                  <StatCard label="Total Cards" value={String(cards.length)} />
                  <StatCard
                    label="Published Cards"
                    value={String(publishedCards)}
                  />
                </div>

                {cards.length === 0 && !panelOpen ? (
                  <EmptyState onCreate={openCreatePanel} />
                ) : cards.length > 0 ? (
                  <CardList
                    cards={cards}
                    selectedCardId={selectedCardId}
                    onSelect={setSelectedCardId}
                    onEdit={openEditPanel}
                    onTogglePublish={togglePublish}
                    onCopyLink={copyLink}
                    onViewPublicPage={viewPublicPage}
                    onDelete={deleteCard}
                  />
                ) : null}

                {panelOpen && (
                  <EditorPanel
                    activeStep={activeStep}
                    draftCard={draftCard}
                    fieldOrder={fieldOrder}
                    mode={panelMode}
                    template={draftTemplateRecord || currentDefaultTemplate}
                    templates={visibleTemplates}
                    onClose={() => setPanelOpen(false)}
                    onStepChange={setActiveStep}
                    onUpdate={updateDraft}
                    onSelectTemplate={selectDraftTemplate}
                    onUpdateCustomField={updateCustomField}
                    onUpdateLeadSettings={updateLeadCaptureSettings}
                    onToggleFieldVisibility={toggleFieldVisibility}
                    onMoveField={moveField}
                    onSaveDraft={handleSaveDraft}
                    onPublish={handlePublishCard}
                    saveStatus={saveStatus}
                    saveMessage={saveMessage}
                    saveError={saveError}
                  />
                )}
              </div>

              <aside className="hidden 2xl:sticky 2xl:top-8 2xl:block 2xl:self-start">
                <div className="rounded-3xl border border-white/10 bg-[#101935]/65 p-5 shadow-2xl shadow-black/20">
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
                    onSearchChange={setDeviceSearch}
                    onOpenChange={setDevicePickerOpen}
                    onSelect={(key) => {
                      setDevicePreview(key);
                      setDevicePickerOpen(false);
                    }}
                  />
                </div>
              </aside>
            </div>

            <button
              type="button"
              onClick={() => setPreviewDrawerOpen(true)}
              className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 rounded-2xl border border-[#AC00FF]/40 bg-[#AC00FF] px-4 py-3 text-sm font-semibold text-white shadow-2xl shadow-purple-500/35 transition hover:shadow-purple-500/50 md:bottom-auto md:right-0 md:top-1/2 md:-translate-y-1/2 md:flex-col md:rounded-l-2xl md:rounded-r-none md:px-3 md:py-5 2xl:hidden"
            >
              <CreditCard className="h-4 w-4" />
              <span className="md:[writing-mode:vertical-rl] md:rotate-180">
                Preview
              </span>
            </button>

            {previewDrawerOpen && (
              <div className="fixed inset-0 z-50 2xl:hidden">
                <button
                  type="button"
                  aria-label="Close preview drawer"
                  onClick={() => setPreviewDrawerOpen(false)}
                  className="absolute inset-0 bg-black/55 backdrop-blur-sm"
                />

                <div className="absolute inset-0 overflow-y-auto border-white/10 bg-[#070B1A]/95 p-4 shadow-2xl shadow-black/40 transition-transform duration-300 md:inset-y-0 md:left-auto md:right-0 md:w-[620px] md:border-l md:p-5 lg:w-[680px] xl:w-[720px]">
                  <div className="min-h-full rounded-3xl border border-white/10 bg-[#101935]/80 p-4 shadow-2xl shadow-purple-950/25 md:min-h-0 md:p-6">
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
                      actions={
                        <button
                          type="button"
                          onClick={() => setPreviewDrawerOpen(false)}
                          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-white/60 transition hover:border-[#AC00FF]/50 hover:bg-[#AC00FF]/15 hover:text-white"
                          aria-label="Close preview"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      }
                      onSearchChange={setDeviceSearch}
                      onOpenChange={setDevicePickerOpen}
                      onSelect={(key) => {
                        setDevicePreview(key);
                        setDevicePickerOpen(false);
                      }}
                    />
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </section>
    </main>
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
  onSearchChange,
  onOpenChange,
  onSelect,
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
  onSearchChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
  onSelect: (key: DevicePreviewKey) => void;
}) {
  return (
    <>
      <div className="mb-5 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">{title}</h2>
            <p className="mt-1 text-sm text-white/45">
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
      </div>

      {previewCard ? (
        <DevicePreviewFrame device={selectedDevice} dimensions={dimensions}>
          <CardRenderer
            template={previewTemplate}
            cardData={previewCard}
            mode="preview"
          />
        </DevicePreviewFrame>
      ) : (
        <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-8 text-center text-white/45">
          No card selected.
        </div>
      )}
    </>
  );
}

function CardList({
  cards,
  selectedCardId,
  onSelect,
  onEdit,
  onTogglePublish,
  onCopyLink,
  onViewPublicPage,
  onDelete,
}: {
  cards: ClientCard[];
  selectedCardId: string;
  onSelect: (id: string) => void;
  onEdit: (card: ClientCard) => void;
  onTogglePublish: (card: ClientCard) => void;
  onCopyLink: (card: ClientCard) => void;
  onViewPublicPage: (card: ClientCard) => void;
  onDelete: (card: ClientCard) => void;
}) {
  return (
    <section className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-2xl shadow-black/10">
      <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Card List</h2>
          <p className="mt-1 text-sm text-white/45">
            Manage your published and draft public card pages.
          </p>
        </div>
        {!isPaid && (
          <span className="rounded-full border border-[#AC00FF]/25 bg-[#AC00FF]/10 px-3 py-1 text-xs font-semibold text-purple-100">
            Free plan: 1 card limit
          </span>
        )}
      </div>

      <div className="space-y-3">
        {cards.map((card) => {
          const selected = selectedCardId === card.id;

          return (
            <article
              key={card.id}
              className={`rounded-2xl border p-4 transition ${
                selected
                  ? "border-[#AC00FF]/70 bg-[#AC00FF]/10 shadow-lg shadow-purple-500/15"
                  : "border-white/10 bg-[#101935]/55 hover:border-white/20"
              }`}
            >
              <div className="flex flex-col gap-4">
                <button
                  type="button"
                  onClick={() => onSelect(card.id)}
                  className="w-full min-w-0 text-left"
                >
                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_auto_minmax(170px,1fr)_minmax(130px,0.8fr)] lg:items-center">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{card.card_name}</p>
                      <p className="mt-1 text-sm text-white/45">
                        Template: {card.template_name}
                      </p>
                    </div>
                    <StatusBadge status={card.status} />
                    <div className="min-w-0 text-sm">
                      <p className="text-white/35">Public URL</p>
                      <p className="mt-1 truncate text-white/70">{card.public_url}</p>
                    </div>
                    <div className="min-w-0 text-sm">
                      <p className="text-white/35">Last updated</p>
                      <p className="mt-1 text-white/70">{card.last_updated}</p>
                    </div>
                  </div>
                </button>

                <div className="flex flex-wrap items-center gap-3 border-t border-white/5 pt-4">
                  <ActionButton
                    label="Edit Card"
                    icon={CreditCard}
                    onClick={() => onEdit(card)}
                  />
                  <ActionButton
                    label={card.status === "published" ? "Unpublish" : "Publish"}
                    icon={Save}
                    onClick={() => onTogglePublish(card)}
                  />
                  <ActionButton
                    label="View Public Page"
                    icon={ExternalLink}
                    onClick={() => onViewPublicPage(card)}
                  />
                  <ActionButton
                    label="Copy Link"
                    icon={Copy}
                    onClick={() => onCopyLink(card)}
                  />
                  <button
                    type="button"
                    onClick={() => onDelete(card)}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-2.5 text-sm font-medium text-red-200 transition hover:bg-red-500/20"
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
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
    <div className="space-y-3">
      <div>
        <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-white/40">
          Device Preview
        </span>
        <button
          type="button"
          onClick={() => onOpenChange(!open)}
          className="group flex w-full items-center justify-between rounded-2xl border border-white/10 bg-[#070B1A]/80 px-4 py-3 text-left text-sm text-white transition hover:border-[#AC00FF]/45 hover:bg-[#AC00FF]/10 hover:shadow-lg hover:shadow-purple-500/10"
        >
          <span>
            <span className="block font-semibold">{selectedDevice.label}</span>
            <span className="mt-1 block text-xs text-white/40">
              {selectedSize}
            </span>
          </span>
          <span className="rounded-full bg-[#AC00FF]/20 px-3 py-1 text-xs font-semibold text-purple-100 transition group-hover:bg-[#AC00FF]/35">
            Change
          </span>
        </button>
      </div>

      {open && (
        <div className="rounded-3xl border border-[#AC00FF]/25 bg-[#070B1A]/95 p-3 shadow-2xl shadow-purple-950/30">
          <div className="sticky top-0 z-10 rounded-2xl border border-[#AC00FF]/25 bg-[#101935] p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-purple-200">
              Selected
            </p>
            <p className="mt-1 text-sm font-semibold">{selectedDevice.label}</p>
          </div>

          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
            <input
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Search iPhone, Samsung, Pixel..."
              className="w-full rounded-2xl border border-white/10 bg-white/5 py-3 pl-10 pr-4 text-sm text-white outline-none transition placeholder:text-white/25 focus:border-[#AC00FF]/60"
            />
          </div>

          <div className="mt-3 max-h-80 space-y-4 overflow-y-auto pr-1">
            {filteredGroups.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/45">
                No devices found.
              </div>
            ) : (
              filteredGroups.map((group) => {
                const Icon = group.icon;

                return (
                  <div key={group.manufacturer}>
                    <div className="mb-2 flex items-center gap-2 px-2 text-xs font-semibold uppercase tracking-[0.18em] text-white/35">
                      <Icon className="h-4 w-4 text-purple-200" />
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
                            onClick={() => onSelect(device.key)}
                            className={`flex w-full items-center justify-between rounded-2xl border px-3 py-2.5 text-left text-sm transition ${
                              selected
                                ? "border-[#AC00FF]/70 bg-[#AC00FF]/15 text-white shadow-lg shadow-purple-500/15"
                                : "border-white/5 bg-white/[0.03] text-white/65 hover:border-[#AC00FF]/35 hover:bg-white/10 hover:text-white"
                            }`}
                          >
                            <span>
                              <span className="block font-medium">
                                {device.label}
                              </span>
                              <span className="mt-0.5 block text-xs text-white/35">
                                {width}
                              </span>
                            </span>
                            {selected && <Check className="h-4 w-4 text-purple-100" />}
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
  const needsWideScroll = isTablet || (isFoldable && deviceWidth > 560);
  const shellPadding = isTablet || isFoldable ? 14 : 10;
  const shellRadius = isTablet ? "2rem" : isFoldable ? "2.2rem" : "2.6rem";
  const screenRadius = isTablet ? "1.35rem" : isFoldable ? "1.6rem" : "2rem";

  return (
    <div>
      <div className="mb-4 text-center">
        <p className="text-sm font-semibold text-white">{device.label}</p>
        <p className="mt-1 text-xs text-white/40">
          {deviceSizeLabel(device)}
        </p>
      </div>

      <div className="rounded-[2rem] bg-white/[0.07] p-4 shadow-inner shadow-white/5 md:p-8">
        <div
          className={`pb-3 ${
            needsWideScroll ? "overflow-x-auto" : "overflow-x-hidden"
          }`}
        >
          <div
            className="mx-auto origin-top transform-gpu transition-[width,min-width,transform] duration-300 ease-out max-md:scale-[0.72] md:scale-100"
            style={{ width: dimensions.width, minWidth: dimensions.minWidth }}
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
  mode,
  template,
  templates,
  onClose,
  onStepChange,
  onUpdate,
  onSelectTemplate,
  onUpdateCustomField,
  onUpdateLeadSettings,
  onToggleFieldVisibility,
  onMoveField,
  onSaveDraft,
  onPublish,
  saveStatus,
  saveMessage,
  saveError,
}: {
  activeStep: BuilderStep;
  draftCard: ClientCard;
  fieldOrder: FieldOrder;
  mode: PanelMode;
  template: AdminTemplate;
  templates: AdminTemplate[];
  onClose: () => void;
  onStepChange: (step: BuilderStep) => void;
  onUpdate: (field: keyof ClientCard, value: string) => void;
  onSelectTemplate: (template: AdminTemplate) => void;
  onUpdateCustomField: (field: string, value: string) => void;
  onUpdateLeadSettings: (settings: LeadCaptureSettings) => void;
  onToggleFieldVisibility: (field: string) => void;
  onMoveField: (section: SectionKey, draggedField: string, targetField: string) => void;
  onSaveDraft: () => void;
  onPublish: () => void;
  saveStatus: SaveStatus;
  saveMessage: string;
  saveError: string;
}) {
  return (
    <section className="rounded-3xl border border-[#AC00FF]/25 bg-[#101935]/75 shadow-2xl shadow-purple-950/20">
      <div className="flex flex-col gap-4 border-b border-white/10 p-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#AC00FF]">
            {mode === "create" ? "Create Card" : "Edit Card"}
          </p>
          <h2 className="mt-1 text-2xl font-semibold">
            {builderSteps[activeStep].title}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/70 transition hover:bg-white/10 hover:text-white"
        >
          Close
        </button>
      </div>

      <div className="p-5">
        <div className="mb-6 grid gap-3 md:grid-cols-3">
          {builderSteps.map((step, index) => (
              <button
                key={step.title}
                type="button"
                onClick={() => onStepChange(index as BuilderStep)}
                className={`rounded-2xl border px-4 py-3 text-left transition ${
                  activeStep === index
                    ? "border-[#AC00FF]/70 bg-[#AC00FF]/15 text-white shadow-lg shadow-purple-500/15"
                    : "border-white/10 bg-white/5 text-white/55 hover:bg-white/10 hover:text-white"
                }`}
              >
                <span className="block text-[11px] font-semibold uppercase tracking-[0.18em] text-purple-200">
                  Step {index + 1}
                </span>
                <span className="mt-1 block text-sm font-semibold">
                  {step.shortTitle}
                </span>
                <span className="mt-1 block text-xs font-normal leading-5 text-white/45">
                  {step.subtitle}
                </span>
              </button>
          ))}
        </div>

        {activeStep === 0 && (
          <CustomiseStep
            template={template}
            templates={templates}
            draftCard={draftCard}
            fieldOrder={fieldOrder}
            onUpdate={onUpdate}
            onSelectTemplate={onSelectTemplate}
          />
        )}
        {activeStep === 1 && (
          <BuildStep
            template={template}
            draftCard={draftCard}
            fieldOrder={fieldOrder}
            onUpdate={onUpdate}
            onUpdateCustomField={onUpdateCustomField}
            onToggleFieldVisibility={onToggleFieldVisibility}
            onMoveField={onMoveField}
          />
        )}
        {activeStep === 2 && (
          <SetUpStep
            settings={draftCard.lead_capture_settings || defaultLeadCaptureSettings}
            onSettingsChange={onUpdateLeadSettings}
            onSaveDraft={onSaveDraft}
            onPublish={onPublish}
            saveStatus={saveStatus}
            saveMessage={saveMessage}
            saveError={saveError}
          />
        )}
      </div>
    </section>
  );
}

function CustomiseStep({
  template,
  templates,
  draftCard,
  fieldOrder,
  onUpdate,
  onSelectTemplate,
}: {
  template: AdminTemplate;
  templates: AdminTemplate[];
  draftCard: ClientCard;
  fieldOrder: FieldOrder;
  onUpdate: (field: keyof ClientCard, value: string) => void;
  onSelectTemplate: (template: AdminTemplate) => void;
}) {
  const palette = templateColourPalette(template);
  const approvedPalette = palette.length ? palette : [fallbackColour];
  const activeColour = selectedColourForTemplate(template, draftCard.selected_colour);

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-xl font-semibold">Customise Your Card</h3>
        <p className="mt-2 text-sm text-white/45">
          Choose your template and colour style.
        </p>
      </div>

      <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-white/65">
            Card Name
          </span>
          <input
            value={draftCard.card_name}
            onChange={(event) => onUpdate("card_name", event.target.value)}
            placeholder="e.g. Primary Digital Card"
            className="w-full rounded-2xl border border-white/10 bg-[#070B1A]/70 px-4 py-3 text-sm text-white outline-none transition placeholder:text-white/25 focus:border-[#AC00FF]/60"
          />
        </label>
        <p className="mt-2 text-xs leading-5 text-white/40">
          This is your internal card label. Your full name is managed separately
          in Build Your Card.
        </p>
      </div>

      <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
        <p className="mb-4 text-sm font-semibold text-white/60">
          Template selection
        </p>
        <div className="flex gap-4 overflow-x-auto pb-2">
          {templates.map((templateOption) => {
            const selected = templateOption.id === template.id;
            const locked = !canSelectTemplate(templateOption);
            const previewFieldOrder = selected
              ? fieldOrder
              : getInitialFieldOrder(templateOption);

            return (
              <button
                key={templateOption.id}
                type="button"
                onClick={() => onSelectTemplate(templateOption)}
                className={`relative w-52 shrink-0 rounded-3xl border p-4 text-left transition ${
                  selected
                    ? "border-[#AC00FF]/60 bg-[#AC00FF]/10 shadow-lg shadow-purple-500/10"
                    : "border-white/10 bg-[#070B1A]/55 hover:border-white/20"
                } ${locked ? "opacity-75" : ""}`}
              >
                {locked && (
                  <div className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-[#AC00FF]/30 bg-[#070B1A]/90 text-purple-100 shadow-lg shadow-black/25">
                    <Lock className="h-4 w-4" />
                  </div>
                )}
                <div className="flex h-40 items-start justify-center overflow-hidden rounded-2xl border border-white/10 bg-black/30 pt-3">
                  <div className="origin-top scale-[0.45]">
                    <CardRenderer
                      template={buildTemplatePreview(
                        templateOption,
                        firstTemplateColour(templateOption),
                        previewFieldOrder,
                        selected ? draftCard.hidden_fields || [] : []
                      )}
                      cardData={draftCard}
                      mode="compact"
                    />
                  </div>
                </div>
                <p className="mt-4 text-sm font-semibold">{templateOption.name}</p>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <AccessPill template={templateOption} />
                  {selected && (
                    <span className="rounded-full bg-[#AC00FF]/20 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-purple-100">
                      Selected
                    </span>
                  )}
                </div>
              </button>
            );
          })}

          {templates.length === 0 && (
            <div className="w-52 shrink-0 rounded-3xl border border-dashed border-white/10 bg-[#070B1A]/55 p-4 text-sm text-white/45">
              No published templates are available yet.
            </div>
          )}
        </div>

        {!canSelectTemplate(template) && (
          <div className="mt-5 rounded-2xl border border-[#AC00FF]/30 bg-[#AC00FF]/10 p-5">
            <div className="flex gap-4">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#AC00FF]/20 text-purple-100">
                <Lock className="h-5 w-5" />
              </div>
              <div>
                <p className="font-semibold">{template.name}</p>
                <p className="mt-2 text-sm leading-6 text-white/55">
                  Upgrade to Individual Pro to select this paid template.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {template.access_level === "free" && (
        <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
          <p className="text-sm font-semibold text-white/65">
            Free colour palette
          </p>
          <p className="mt-1 text-sm text-white/40">
            Free users can only choose admin-approved swatches.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            {approvedPalette.map((colour) => (
              <button
                key={colour}
                type="button"
                onClick={() => onUpdate("selected_colour", colour)}
                className={`flex h-12 w-12 items-center justify-center rounded-2xl border transition ${
                  activeColour === colour
                    ? "border-white shadow-lg shadow-purple-500/30"
                    : "border-white/10"
                }`}
                style={{ backgroundColor: colour }}
                aria-label={`Select ${colour}`}
              >
                {activeColour === colour && (
                  <Check className="h-5 w-5" />
                )}
              </button>
            ))}
          </div>

        {!isPaid && (
          <UpgradeNotice message="Upgrade to Pro for paid templates, colour pickers, gradients, fonts, logos, banners, socials, and integrations." />
        )}
        </div>
      )}
    </div>
  );
}

function BuildStep({
  template,
  draftCard,
  fieldOrder,
  onUpdate,
  onUpdateCustomField,
  onToggleFieldVisibility,
  onMoveField,
}: {
  template: AdminTemplate;
  draftCard: ClientCard;
  fieldOrder: FieldOrder;
  onUpdate: (field: keyof ClientCard, value: string) => void;
  onUpdateCustomField: (field: string, value: string) => void;
  onToggleFieldVisibility: (field: string) => void;
  onMoveField: (section: SectionKey, draggedField: string, targetField: string) => void;
}) {
  const sections = sectionConfig(template, fieldOrder);

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-xl font-semibold">Build Your Card</h3>
        <p className="mt-2 text-sm text-white/45">
          Only fields enabled by the DMI Admin template are editable here.
        </p>
      </div>

      <MainProfileSection draftCard={draftCard} onUpdate={onUpdate} />

      {sections.map((section) => (
        <BuilderSection
          key={section.key}
          section={section}
          draftCard={draftCard}
          onUpdate={onUpdate}
          onUpdateCustomField={onUpdateCustomField}
          onToggleFieldVisibility={onToggleFieldVisibility}
          onMoveField={onMoveField}
        />
      ))}
    </div>
  );
}

function MainProfileSection({
  draftCard,
  onUpdate,
}: {
  draftCard: ClientCard;
  onUpdate: (field: keyof ClientCard, value: string) => void;
}) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
      <h3 className="text-lg font-semibold">Main Profile</h3>
      <p className="mt-1 text-sm text-white/40">
        Full name and profile picture are fixed at the top of your card.
      </p>

      <div className="mt-5 grid gap-5 lg:grid-cols-[220px_1fr]">
        <ProfilePictureUpload
          value={draftCard.profile_image_url || ""}
          fullName={draftCard.full_name}
          onChange={(value) => onUpdate("profile_image_url", value)}
        />
        <TextField
          label="Full name"
          value={draftCard.full_name}
          onChange={(value) => onUpdate("full_name", value)}
        />
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
  const displayWidth = imageSize.width * baseScale * cropZoom;
  const displayHeight = imageSize.height * baseScale * cropZoom;

  return (
    <div>
      <p className="mb-3 text-sm font-medium text-white/55">Profile Picture</p>
      <label className="group flex w-full cursor-pointer flex-col items-center rounded-3xl border border-white/10 bg-[#070B1A]/55 p-5 text-center transition hover:border-[#AC00FF]/45 hover:bg-[#AC00FF]/10">
        <input
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          className="sr-only"
        />
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={value}
            alt={fullName ? `${fullName} profile` : "Profile"}
            className="h-24 w-24 rounded-full border-2 border-white/20 object-cover shadow-lg shadow-purple-950/30 transition group-hover:border-white/40"
          />
        ) : (
          <span className="flex h-24 w-24 items-center justify-center rounded-full border-2 border-white/20 bg-gradient-to-br from-[#AC00FF]/70 to-[#101935] text-purple-100 shadow-lg shadow-purple-950/30 transition group-hover:border-white/40">
            <ImagePlus className="h-8 w-8" />
          </span>
        )}
        <span className="mt-4 text-sm font-semibold text-white">
          {value ? "Change profile photo" : "Upload profile photo"}
        </span>
        <span className="mt-2 inline-flex items-center gap-1 text-xs text-white/40">
          <Upload className="h-3.5 w-3.5" />
          Cropped square for preview
        </span>
      </label>
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          className="mt-3 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-xs font-medium text-white/60 transition hover:bg-white/10 hover:text-white"
        >
          Remove photo
        </button>
      )}
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
                    transform: `translate(calc(-50% + ${cropPosition.x}px), calc(-50% + ${cropPosition.y}px))`,
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
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white/65 transition hover:bg-white/10 hover:text-white"
              >
                Reset
              </button>
              <button
                type="button"
                onClick={cancelCrop}
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white/65 transition hover:bg-white/10 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void saveCrop()}
                className="rounded-2xl bg-[#AC00FF] px-5 py-2 text-sm font-semibold text-white transition hover:opacity-90"
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
  onUpdate,
  onUpdateCustomField,
  onToggleFieldVisibility,
  onMoveField,
}: {
  section: SectionConfig;
  draftCard: ClientCard;
  onUpdate: (field: keyof ClientCard, value: string) => void;
  onUpdateCustomField: (field: string, value: string) => void;
  onToggleFieldVisibility: (field: string) => void;
  onMoveField: (section: SectionKey, draggedField: string, targetField: string) => void;
}) {
  if (!section.enabled) {
    return (
      <LockedSection
        title={section.label}
        message="Upgrade to Pro to unlock this section."
      />
    );
  }

  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
      <h3 className="text-lg font-semibold">{section.label}</h3>
      {section.fields.length === 0 ? (
        <p className="mt-3 text-sm text-white/40">
          No editable fields are enabled for this section.
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          {section.fields.map((field) => (
            <FieldRow
              key={field}
              section={section.key}
              field={field}
              value={
                isEditableCardField(field)
                  ? draftCard[field]
                  : customFieldValue(draftCard, field)
              }
              hidden={draftCard.hidden_fields?.includes(field) || false}
              onChange={(value) => {
                if (isEditableCardField(field)) {
                  onUpdate(field, value);
                  return;
                }

                onUpdateCustomField(field, value);
              }}
              onToggleVisibility={() => onToggleFieldVisibility(field)}
              onMoveField={onMoveField}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FieldRow({
  section,
  field,
  value,
  hidden,
  onChange,
  onToggleVisibility,
  onMoveField,
}: {
  section: SectionKey;
  field: string;
  value: string | null | undefined | ClientCard[keyof ClientCard];
  hidden: boolean;
  onChange: (value: string) => void;
  onToggleVisibility: () => void;
  onMoveField: (section: SectionKey, draggedField: string, targetField: string) => void;
}) {
  return (
    <div
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData("field-name", String(field));
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        const draggedField = event.dataTransfer.getData("field-name");
        if (draggedField) onMoveField(section, draggedField, String(field));
      }}
      className={`grid gap-3 rounded-2xl border p-3 transition md:grid-cols-[28px_1fr_auto] ${
        hidden
          ? "border-white/5 bg-[#070B1A]/35 opacity-60"
          : "border-white/10 bg-[#070B1A]/55"
      }`}
    >
      <div className="flex items-center justify-center text-white/35">
        <GripVertical className="h-4 w-4" />
      </div>
      {field === "bio" ? (
        <TextArea
          label={fieldLabels[field] || labelize(field)}
          value={String(value || "")}
          onChange={onChange}
        />
      ) : (
        <TextField
          label={fieldLabels[field] || labelize(field)}
          value={String(value || "")}
          onChange={onChange}
        />
      )}
      <div className="flex items-end">
        <button
          type="button"
          onClick={onToggleVisibility}
          className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
            hidden
              ? "bg-white/10 text-white/50 hover:bg-white/15 hover:text-white"
              : "bg-[#AC00FF]/20 text-purple-100 shadow-lg shadow-purple-500/10 hover:bg-[#AC00FF]/30"
          }`}
        >
          {hidden ? "Hidden" : "Shown"}
        </button>
      </div>
    </div>
  );
}

function SetUpStep({
  settings,
  onSettingsChange,
  onSaveDraft,
  onPublish,
  saveStatus,
  saveMessage,
  saveError,
}: {
  settings: LeadCaptureSettings;
  onSettingsChange: (settings: LeadCaptureSettings) => void;
  onSaveDraft: () => void;
  onPublish: () => void;
  saveStatus: SaveStatus;
  saveMessage: string;
  saveError: string;
}) {
  function toggleField(field: LeadField) {
    onSettingsChange({
      ...settings,
      fields: settings.fields.includes(field)
        ? settings.fields.filter((item) => item !== field)
        : [...settings.fields, field],
    });
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-xl font-semibold">Set Up Your Card</h3>
        <p className="mt-2 text-sm text-white/45">
          Configure how recipients interact before or after viewing your card.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {[
          { value: "share_first", label: "Share first" },
          { value: "collect_first", label: "Collect first" },
        ].map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() =>
              onSettingsChange({
                ...settings,
                flow: option.value as "collect_first" | "share_first",
              })
            }
            className={`rounded-2xl border px-4 py-4 text-left text-sm font-semibold transition ${
              settings.flow === option.value
                ? "border-[#AC00FF] bg-[#AC00FF]/15 text-white"
                : "border-white/10 bg-white/5 text-white/55 hover:bg-white/10"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
        <p className="font-semibold">Recipient data to collect</p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {leadFields.map((field) => (
            <button
              key={field.key}
              type="button"
              onClick={() => toggleField(field.key)}
              className={`flex items-center justify-between rounded-2xl border px-4 py-3 text-sm transition ${
                settings.fields.includes(field.key)
                  ? "border-[#AC00FF]/60 bg-[#AC00FF]/15 text-white"
                  : "border-white/10 bg-white/5 text-white/55"
              }`}
            >
              {field.label}
              {settings.fields.includes(field.key) && <Check className="h-4 w-4" />}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <TextArea
          label="Consent notice"
          value={settings.consent_notice}
          onChange={(value) =>
            onSettingsChange({ ...settings, consent_notice: value })
          }
        />
        <TextField
          label="Terms URL"
          value={settings.terms_url}
          onChange={(value) => onSettingsChange({ ...settings, terms_url: value })}
        />
      </div>

      <button
        type="button"
        onClick={() =>
          onSettingsChange({
            ...settings,
            follow_up_enabled: !settings.follow_up_enabled,
          })
        }
        className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-left transition hover:bg-white/10"
      >
        <div>
          <p className="font-semibold">Follow-up email</p>
          <p className="mt-1 text-sm text-white/40">Placeholder toggle for V1.</p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ${
            settings.follow_up_enabled
              ? "bg-[#AC00FF]/20 text-purple-100"
              : "bg-white/10 text-white/50"
          }`}
        >
          {settings.follow_up_enabled ? "On" : "Off"}
        </span>
      </button>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onSaveDraft}
          disabled={saveStatus === "saving"}
          className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold text-white/75 transition hover:bg-white/10 hover:text-white"
        >
          <Save className="h-4 w-4" />
          {saveStatus === "saving" ? "Saving..." : "Save Draft"}
        </button>
        <button
          type="button"
          onClick={onPublish}
          disabled={saveStatus === "saving"}
          className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-[#AC00FF] to-[#6C2CFF] px-5 py-3 text-sm font-semibold shadow-lg shadow-purple-500/20 transition hover:shadow-purple-500/35"
        >
          <ExternalLink className="h-4 w-4" />
          {saveStatus === "saving" ? "Saving..." : "Publish Card"}
        </button>
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

function buildTemplatePreview(
  template: AdminTemplate | null,
  selectedColour: string,
  fieldOrder: FieldOrder,
  hiddenFields: string[] = []
): CardRendererTemplate {
  if (!template) return {};

  const rendererFieldOrder = fieldOrderForRenderer(fieldOrder, hiddenFields);
  const hiddenFieldSet = new Set(hiddenFields);
  const allowedFields = (template.allowed_fields || []).filter(
    (field) => !hiddenFieldSet.has(field)
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

function templateColourPalette(template: AdminTemplate | CardRendererTemplate | null) {
  if (!template) return [];

  const freePalette = normalizeColourPalette(template.free_colour_palette);
  if (freePalette.length) return freePalette;

  const colourPalette = normalizeColourPalette(template.colour_palette);
  if (colourPalette.length) return colourPalette;

  return normalizeColourPalette(template.primary_color);
}

function firstTemplateColour(template: AdminTemplate | CardRendererTemplate | null) {
  return templateColourPalette(template)[0] || fallbackColour;
}

function selectedColourForTemplate(
  template: AdminTemplate | CardRendererTemplate | null,
  selectedColour: string | null | undefined
) {
  const palette = templateColourPalette(template);

  if (!palette.length) {
    return selectedColour || fallbackColour;
  }

  if (template?.access_level === "free") {
    return selectedColour && palette.includes(selectedColour)
      ? selectedColour
      : palette[0];
  }

  return selectedColour || palette[0];
}

async function loadPublishedTemplates(): Promise<AdminTemplate[]> {
  return (await getClientVisibleTemplates(currentPlan)) as AdminTemplate[];
}

function normalizeAdminTemplates(templates: AdminTemplate[]) {
  return templates
    .filter((template) => template.status === "published")
    .map((template) => {
      const colourPalette = normalizeColourPalette(template.colour_palette);
      const freeColourPalette = normalizeColourPalette(template.free_colour_palette);
      const primaryPalette = normalizeColourPalette(template.primary_color);
      const templatePalette =
        freeColourPalette.length
          ? freeColourPalette
          : colourPalette.length
            ? colourPalette
            : primaryPalette;

      return {
        ...template,
        access_level: template.access_level === "free" ? "free" : "paid",
        layout_type:
          template.access_level === "free"
            ? "classic_free"
            : template.layout_type || "premium_classic",
        colour_palette: colourPalette.length ? colourPalette : templatePalette,
        free_colour_palette: templatePalette,
      };
    });
}

function visibleTemplatesForPlan(templates: AdminTemplate[]) {
  const published = normalizeAdminTemplates(templates);

  if (currentPlan === "free") return published;

  return published.filter(
    (template) => template.access_level === "free" || isPaidTemplate(template)
  );
}

function defaultTemplateForPlan(templates: AdminTemplate[]) {
  const published = normalizeAdminTemplates(templates);
  const freeTemplate =
    published.find((template) => template.access_level === "free") || null;

  if (currentPlan === "free") return freeTemplate;

  return (
    published.find((template) => canSelectTemplate(template)) ||
    freeTemplate ||
    null
  );
}

function templateForCard(
  card: Pick<ClientCard, "template_id"> | null,
  templates: AdminTemplate[]
) {
  if (!card?.template_id) return null;

  const template =
    normalizeAdminTemplates(templates).find((item) => item.id === card.template_id) ||
    null;

  if (template && canSelectTemplate(template)) return template;

  return null;
}

function isPaidTemplate(template: AdminTemplate | CardRendererTemplate) {
  return template.access_level !== "free";
}

function canSelectTemplate(template: AdminTemplate | CardRendererTemplate) {
  if (!isPaidTemplate(template)) {
    return template.layout_type === "classic_free" || template.layout_type === "classic";
  }

  return currentPlan !== "free";
}

function planLabel(plan: typeof currentPlan) {
  if (plan === "individual_pro") return "Individual Pro";
  if (plan === "business") return "Business";
  if (plan === "enterprise") return "Enterprise";

  return "Free";
}

function mapSupabaseCard(
  row: SupabaseCardRow,
  templates: AdminTemplate[] = [],
  defaultTemplate = defaultTemplateForPlan(templates)
): ClientCard {
  const slug = row.slug || slugify(row.full_name || row.card_name || "digital-card");
  const rowTemplate =
    templateForCard({ template_id: row.template_id || "" }, templates) ||
    defaultTemplate;
  const templateName =
    rowTemplate?.name ||
    "Free Classic";

  return {
    id: row.id,
    card_name: row.card_name || "Primary Digital Card",
    template_id: rowTemplate?.id || row.template_id || "",
    template_name: templateName,
    status: row.is_published || row.status === "published" ? "published" : "unpublished",
    public_url: `/u/${slug}`,
    last_updated: row.updated_at || row.created_at || "Saved",
    slug,
    full_name: row.full_name || "",
    job_title: row.job_title || "",
    department: row.department || "",
    bio: row.bio || "",
    company_name: row.company_name || "",
    email: row.email || "",
    phone: row.phone || "",
    website: row.website || "",
    address: row.address || "",
    whatsapp: row.whatsapp || "",
    linkedin: row.linkedin || "",
    instagram: row.instagram || "",
    facebook: row.facebook || "",
    youtube: row.youtube || "",
    booking_link: row.booking_link || "",
    custom_url: row.custom_url || "",
    profile_image_url: row.profile_image_url || "",
    company_logo_url: row.company_logo_url || "",
    company_banner_url: row.company_banner_url || "",
    custom_fields: row.custom_fields || {},
    selected_colour: selectedColourForTemplate(rowTemplate, row.selected_colour),
    hidden_fields: row.hidden_fields || [],
    field_order: row.field_order || getInitialFieldOrder(rowTemplate),
    lead_capture_settings: row.lead_capture_settings || defaultLeadCaptureSettings,
  };
}

function buildSupabaseCardPayload(
  card: ClientCard,
  userId: string | null
) {
  const isPublished = card.status === "published";

  return {
    user_id: userId,
    profile_id: userId,
    template_id: card.template_id || null,
    card_name: card.card_name || "Primary Digital Card",
    slug: card.slug || slugify(card.full_name || card.card_name || "digital-card"),
    full_name: card.full_name || "",
    job_title: card.job_title || "",
    department: card.department || "",
    bio: card.bio || "",
    company_name: card.company_name || "",
    email: card.email || "",
    phone: card.phone || "",
    website: card.website || "",
    address: card.address || "",
    whatsapp: card.whatsapp || "",
    linkedin: card.linkedin || "",
    instagram: card.instagram || "",
    facebook: card.facebook || "",
    youtube: card.youtube || "",
    booking_link: card.booking_link || "",
    custom_url: card.custom_url || "",
    profile_image_url: card.profile_image_url || "",
    company_logo_url: card.company_logo_url || "",
    company_banner_url: card.company_banner_url || "",
    selected_colour: card.selected_colour || fallbackColour,
    hidden_fields: card.hidden_fields || [],
    field_order: card.field_order || getInitialFieldOrder(null),
    lead_capture_settings: card.lead_capture_settings || defaultLeadCaptureSettings,
    custom_fields: card.custom_fields || {},
    status: isPublished ? "published" : "draft",
    is_published: isPublished,
  };
}

async function writeCardPayload({
  cardId,
  payload,
  shouldUpdate,
}: {
  cardId: string;
  payload: Record<string, unknown>;
  shouldUpdate: boolean;
}) {
  let nextPayload = { ...payload };
  let result = shouldUpdate
    ? await supabase
        .from("cards")
        .update(nextPayload)
        .eq("id", cardId)
        .select("*")
        .single()
    : await supabase.from("cards").insert([nextPayload]).select("*").single();

  while (result.error) {
    const missingColumn = missingCardColumnFromError(result.error);

    if (!missingColumn || !(missingColumn in nextPayload)) {
      break;
    }

    const { [missingColumn]: _removed, ...reducedPayload } = nextPayload;
    void _removed;
    nextPayload = reducedPayload;
    result = shouldUpdate
      ? await supabase
          .from("cards")
          .update(nextPayload)
          .eq("id", cardId)
          .select("*")
          .single()
      : await supabase.from("cards").insert([nextPayload]).select("*").single();
  }

  if (result.error) {
    return { data: null, error: result.error };
  }

  return { data: result.data as SupabaseCardRow, error: null };
}

async function ensureUniqueCardSlug(baseSlug: string, currentCardId: string | null) {
  const cleanBase = slugify(baseSlug) || "digital-card";
  let candidate = cleanBase;
  let suffix = 2;

  while (await cardSlugExists(candidate, currentCardId)) {
    candidate = `${cleanBase}-${suffix}`;
    suffix += 1;
  }

  return candidate;
}

async function cardSlugExists(slug: string, currentCardId: string | null) {
  let query = supabase.from("cards").select("id").eq("slug", slug).limit(1);

  if (currentCardId) {
    query = query.neq("id", currentCardId);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    console.error("Slug uniqueness check failed", error);
    return true;
  }

  return Boolean(data);
}

function missingCardColumnFromError(error: { message?: string } | null) {
  const message = error?.message || "";
  const match = message.match(/'([^']+)' column of 'cards'/);
  return match?.[1] || null;
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
      (field) => field !== "full_name" && !hiddenFieldSet.has(field)
    ),
    company: fieldOrder.company.filter((field) => !hiddenFieldSet.has(field)),
    contact: fieldOrder.contact.filter((field) => !hiddenFieldSet.has(field)),
    social: fieldOrder.social.filter((field) => !hiddenFieldSet.has(field)),
  };
}

function getInitialFieldOrder(template: AdminTemplate | null): FieldOrder {
  return {
    personal: template?.custom_fields?.personal?.length
      ? [...template.custom_fields.personal]
      : [...sectionDefaults.personal],
    company: template?.custom_fields?.company?.length
      ? [...template.custom_fields.company]
      : [...sectionDefaults.company],
    contact: template?.custom_fields?.contact?.length
      ? [...template.custom_fields.contact]
      : [...sectionDefaults.contact],
    social: template?.custom_fields?.social?.length
      ? [...template.custom_fields.social]
      : [...sectionDefaults.social],
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
  const allowed = new Set(template.allowed_fields || []);
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

function isEditableCardField(field: string): field is keyof ClientCard {
  return editableCardFields.has(field);
}

function customFieldValue(card: ClientCard, field: string) {
  const value = card.custom_fields?.[field];

  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";

  const firstValue = Object.values(value).find(
    (nestedValue) => typeof nestedValue === "string" && nestedValue
  );

  return firstValue || "";
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="rounded-3xl border border-dashed border-[#AC00FF]/35 bg-[#AC00FF]/10 p-10 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-3xl bg-[#AC00FF]/20 text-purple-100">
        <CreditCard className="h-7 w-7" />
      </div>
      <h2 className="mt-6 text-3xl font-semibold">
        Create your first digital business card
      </h2>
      <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-white/55">
        Start with the DMI Classic template, customise allowed fields, and
        publish your public card page.
      </p>
      <button
        type="button"
        onClick={onCreate}
        className="mt-6 inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-[#AC00FF] to-[#6C2CFF] px-6 py-3 text-sm font-semibold shadow-lg shadow-purple-500/20"
      >
        <BadgePlus className="h-4 w-4" />
        Create Card
      </button>
    </div>
  );
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
    <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 opacity-80">
      <div className="flex gap-4">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10 text-white/50">
          <Lock className="h-5 w-5" />
        </div>
        <div>
          <p className="font-semibold text-white/70">{title}</p>
          <p className="mt-2 text-sm leading-6 text-white/40">{message}</p>
        </div>
      </div>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value?: string | null;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-white/55">
        {label}
      </span>
      <input
        value={value || ""}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-2xl border border-white/10 bg-[#070B1A]/70 px-4 py-3 text-sm text-white outline-none transition placeholder:text-white/25 focus:border-[#AC00FF]/60"
      />
    </label>
  );
}

function TextArea({
  label,
  value,
  onChange,
}: {
  label: string;
  value?: string | null;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-white/55">
        {label}
      </span>
      <textarea
        value={value || ""}
        onChange={(event) => onChange(event.target.value)}
        rows={4}
        className="w-full rounded-2xl border border-white/10 bg-[#070B1A]/70 px-4 py-3 text-sm text-white outline-none transition placeholder:text-white/25 focus:border-[#AC00FF]/60"
      />
    </label>
  );
}

function UpgradeNotice({ message }: { message: string }) {
  return (
    <div className="mt-5 rounded-2xl border border-[#AC00FF]/25 bg-[#AC00FF]/10 p-4 text-sm text-purple-100">
      <div className="flex gap-3">
        <Lock className="mt-0.5 h-4 w-4 shrink-0" />
        <p>{message}</p>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-h-32 rounded-3xl border border-white/10 bg-white/5 p-5">
      <p className="text-sm text-white/45">{label}</p>
      <p className="mt-4 text-3xl font-semibold">{value}</p>
    </div>
  );
}

function PlanBadge() {
  return (
    <span className="rounded-full border border-[#AC00FF]/30 bg-[#AC00FF]/15 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-purple-100">
      {planLabel(currentPlan)} Plan
    </span>
  );
}

function AccessPill({ template }: { template: AdminTemplate }) {
  const locked = !canSelectTemplate(template);
  const label = isPaidTemplate(template) ? "Paid" : "Free";

  return (
    <span
      className={`inline-flex w-fit items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${
        locked
          ? "border border-[#AC00FF]/30 bg-[#AC00FF]/10 text-purple-100"
          : "bg-white/10 text-white/55"
      }`}
    >
      {locked && <Lock className="h-3 w-3" />}
      {locked ? `${label} locked` : label}
    </span>
  );
}

function StatusBadge({ status }: { status: CardStatus }) {
  return (
    <span
      className={`inline-flex w-fit rounded-full px-3 py-1 text-xs font-semibold capitalize ${
        status === "published"
          ? "bg-green-500/15 text-green-300"
          : "bg-white/10 text-white/55"
      }`}
    >
      {status}
    </span>
  );
}

function ActionButton({
  label,
  icon: Icon,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-white/70 transition hover:border-[#AC00FF]/40 hover:bg-[#AC00FF]/10 hover:text-white"
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

function labelize(field: string) {
  return field
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
