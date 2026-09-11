"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  Calendar,
  Check,
  ChevronDown,
  ExternalLink,
  FileText,
  GripVertical,
  Globe,
  ImagePlus,
  Link as LinkIcon,
  Lock,
  Mail,
  Plus,
  Search,
  Smartphone,
  Tablet,
  UserRound,
  X,
  Phone,
} from "lucide-react";
import CardRenderer, {
  displayName,
  type CardRendererTemplate,
} from "@/components/CardRenderer";
import ColourPicker from "@/components/ColourPicker";
import PhoneInput from "@/components/PhoneInput";
import PublicLeadCaptureForm from "@/components/PublicLeadCaptureForm";
import { clientButtonClass } from "@/components/ClientPortalShell";
import UpgradeToProButton from "@/components/UpgradeToProButton";
import {
  actionIsComplete,
  cardActionTypes,
  cardActionValue,
  defaultLabelForActionType,
  effectiveAllowedActions,
  effectiveCardActionConfig,
  fieldKeyForActionType,
  actionLabelIsConfigurable,
  type CardActionConfig,
  type CardActionConfigItem,
  type CardActionType,
} from "@/lib/card-actions";
import type { SharedTemplate } from "@/lib/templates";
import {
  canSelectTemplate as canSelectTemplateForPlan,
  customFieldValue,
  defaultLeadCaptureSettings,
  fallbackColour,
  firstTemplateColour,
  getInitialFieldOrder,
  hiddenFieldsForCard,
  isFieldHidden,
  isFieldVisible,
  isEditableCardField,
  isPaidTemplate,
  mergeAllowedFieldsWithFieldOrder,
  normalizeLeadCaptureSettings,
  readableTextForColour,
  selectedColourForTemplate,
  selectedTextColourForTemplate,
  templateColourPalette,
  templateTextColourPalette,
  type CardFieldOrder,
  type CardSectionKey,
  type ClientCardPlan,
  type LeadCaptureSettings,
  type LeadField,
  type SharedClientCard,
} from "@/lib/services/card-payload";
import {
  modernMinimalMediaSlots,
  type MediaCropFitMode,
} from "@/lib/media-slots";

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
type ClientCard = SharedClientCard;
type SectionKey = CardSectionKey;
type FieldOrder = CardFieldOrder;
type ExpandedBuilderSections = Record<SectionKey, boolean>;
type SectionConfig = {
  key: SectionKey;
  label: string;
  enabled: boolean;
  fields: string[];
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
    previewViewport.width > 0
      ? Math.min(previewViewport.width / shellWidth, 1)
      : 1;
  const scaledShellHeight = Math.ceil(shellHeight * previewScale);

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

      <div className="p-0">
        <div
          ref={previewViewportRef}
          className="relative flex max-h-[min(720px,calc(100vh-360px))] min-h-[360px] w-full justify-center overflow-y-auto overflow-x-hidden rounded-3xl bg-[var(--dmi-surface-soft)] px-5 py-8 [-ms-overflow-style:none] [scrollbar-width:none] md:px-6 md:py-10 [&::-webkit-scrollbar]:hidden"
          style={{ minHeight: Math.min(scaledShellHeight + 80, 720) }}
        >
          <div
            className="origin-top transform-gpu transition-transform duration-300 ease-out"
            style={{
              width: shellWidth,
              minWidth: shellWidth,
              height: shellHeight,
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
                <div className="h-full w-full min-w-full [&>*]:w-full">{children}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


export function PreviewPanelContent({
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
        <DevicePreviewFrame
          device={selectedDevice}
          dimensions={dimensions}
        >
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


export function EditorPanel({
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
  onSelectFont,
  showTemplateContractControls = false,
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
  onSelectFont?: (font: string) => void;
  showTemplateContractControls?: boolean;
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
            onSelectFont={onSelectFont}
            showTemplateContractControls={showTemplateContractControls}
          />
        )}
        {activeStep === 1 && (
          <BuildStep
            template={template}
            draftCard={draftCard}
            fieldOrder={fieldOrder}
            mainProfileExpanded={mainProfileExpanded}
            expandedSections={expandedSections}
            showTemplateContractControls={showTemplateContractControls}
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

export function EditorStepNavigation({
  activeStep,
  saveStatus,
  onBack,
  onNext,
  onPublish,
  publishLabel,
}: {
  activeStep: BuilderStep;
  saveStatus: SaveStatus;
  onBack: () => void;
  onNext: () => void;
  onPublish: () => void;
  publishLabel?: string;
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
            {saveStatus === "saving" ? "Publishing..." : publishLabel || "Publish"}
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
  onSelectFont,
  showTemplateContractControls,
}: {
  template: AdminTemplate;
  templates: AdminTemplate[];
  draftCard: ClientCard;
  fieldOrder: FieldOrder;
  currentPlan: ClientCardPlan;
  isPaid: boolean;
  onUpdate: (field: keyof ClientCard, value: string) => void;
  onSelectTemplate: (template: AdminTemplate) => void;
  onSelectFont?: (font: string) => void;
  showTemplateContractControls: boolean;
}) {
  const palette = templateColourPalette(template);
  const approvedPalette = palette.length ? palette : [fallbackColour];
  const customColourAllowed =
    showTemplateContractControls && template.custom_colour_allowed === true;
  const customTextColourAllowed =
    showTemplateContractControls && template.custom_text_colour_allowed === true;
  const activeColour = isPaid
    ? draftCard.selected_colour ||
      template.primary_color ||
      approvedPalette[0] ||
      fallbackColour
    : customColourAllowed && draftCard.selected_colour
    ? draftCard.selected_colour
    : selectedColourForTemplate(template, draftCard.selected_colour);
  const textPalette = templateTextColourPalette(template, activeColour);
  const activeTextColour = isPaid
    ? draftCard.selected_text_colour || template.text_color || "#101935"
    : customTextColourAllowed && draftCard.selected_text_colour
    ? draftCard.selected_text_colour
    : selectedTextColourForTemplate(
        template,
        draftCard.selected_text_colour,
        activeColour
      );
  const allowedFonts = template.allowed_fonts?.length
    ? template.allowed_fonts
    : template.default_font
    ? [template.default_font]
    : [];
  const activeFont = template.default_font || allowedFonts[0] || "Inter";
  const showTypographyControls = Boolean(onSelectFont && allowedFonts.length > 1);
  const gradientAllowed = isPaid;
  const backgroundMode =
    gradientAllowed &&
    (draftCard.selected_background_mode ||
      (template.gradient_enabled ? "gradient" : "solid")) === "gradient"
      ? "gradient"
      : "solid";
  const gradientStart = draftCard.selected_gradient_start || activeColour;
  const gradientEnd =
    draftCard.selected_gradient_end ||
    template.secondary_color ||
    template.primary_color ||
    activeColour;

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

      {isPaid ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="rounded-2xl border border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] p-4">
          <p className="text-sm font-semibold text-[var(--text-primary)]">
            Background
          </p>
            <div className="mt-3 grid grid-cols-2 gap-2 rounded-2xl bg-[var(--dmi-surface)] p-1">
              {(["solid", "gradient"] as const).map((mode) => (
              <button
                  key={mode}
                type="button"
                  onClick={() => onUpdate("selected_background_mode", mode)}
                  className={`rounded-xl px-3 py-2 text-sm font-semibold capitalize transition ${
                    backgroundMode === mode
                      ? "bg-[#AC00FF] text-white shadow-[0_10px_24px_rgba(172,0,255,0.2)]"
                      : "text-[var(--text-secondary)] hover:bg-[var(--button-hover-bg)] hover:text-[var(--text-primary)]"
                }`}
                  aria-pressed={backgroundMode === mode}
              >
                  {mode}
              </button>
              ))}
          </div>
            {backgroundMode === "solid" ? (
              <ColourPicker
                label="Solid colour"
                value={activeColour}
                onChange={(value) => onUpdate("selected_colour", value)}
                className="mt-4"
              />
            ) : (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <ColourPicker
                  label="Colour 1"
                      value={gradientStart}
                  onChange={(value) => onUpdate("selected_gradient_start", value)}
                />
                <ColourPicker
                  label="Colour 2"
                      value={gradientEnd}
                  onChange={(value) => onUpdate("selected_gradient_end", value)}
                />
                </div>
              )}
        </div>

        <div>
            <ColourPicker
              label="Text colour"
              value={activeTextColour}
              onChange={(value) => onUpdate("selected_text_colour", value)}
            />
          </div>
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          <div>
            <p className="text-sm font-semibold text-[var(--text-primary)]">
              Card colour
            </p>
            {approvedPalette.length > 0 && (
              <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
                Default: {approvedPalette[0]}
              </p>
            )}
            <div className="mt-4 flex flex-wrap gap-3">
              {approvedPalette.map((colour, index) => (
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
                  {index === 0 && activeColour !== colour && (
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: readableTextForColour(colour) }}
                    />
                  )}
                </button>
              ))}
            </div>
            {customColourAllowed && (
              <label className="mt-4 block max-w-xs">
                <span className="mb-2 block text-xs font-semibold text-[var(--text-secondary)]">
                  Custom card colour
                </span>
                <input
                  type="color"
                  value={activeColour}
                  onChange={(event) => onUpdate("selected_colour", event.target.value)}
                  className="h-11 w-20 cursor-pointer rounded-2xl border border-[var(--dmi-border)] bg-[var(--dmi-surface)] p-1"
                />
              </label>
            )}
            <p className="mt-3 text-xs leading-5 text-[var(--text-secondary)]">
              Free users can only choose admin-approved swatches.
            </p>
          </div>

          <div>
            <p className="text-sm font-semibold text-[var(--text-primary)]">Text colour</p>
          {textPalette.length > 0 && (
            <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
              Default: {textPalette[0]}
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-3">
            {textPalette.map((colour, index) => (
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
                {index === 0 && activeTextColour !== colour && (
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: readableTextForColour(colour) }}
                  />
                )}
              </button>
            ))}
          </div>
          {customTextColourAllowed && (
            <label className="mt-4 block max-w-xs">
              <span className="mb-2 block text-xs font-semibold text-[var(--text-secondary)]">
                Custom text colour
              </span>
              <input
                type="color"
                value={activeTextColour}
                onChange={(event) =>
                  onUpdate("selected_text_colour", event.target.value)
                }
                className="h-11 w-20 cursor-pointer rounded-2xl border border-[var(--dmi-border)] bg-[var(--dmi-surface)] p-1"
              />
            </label>
          )}
        </div>
        </div>
      )}

      {showTypographyControls && (
        <div className="rounded-2xl border border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] p-4">
          <div>
            <p className="text-sm font-semibold text-[var(--text-primary)]">
              Typography
            </p>
            <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
              Default: {activeFont}
            </p>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {allowedFonts.map((font) => {
              const selected = activeFont === font;

              return (
                <button
                  key={font}
                  type="button"
                  onClick={() => onSelectFont?.(font)}
                  className={`rounded-2xl border p-4 text-left transition ${
                    selected
                      ? "border-[#AC00FF]/55 bg-[#AC00FF]/15 shadow-[0_0_0_3px_rgba(172,0,255,0.12)]"
                      : "border-[var(--dmi-border)] bg-[var(--dmi-surface)] hover:border-[var(--border-brand)] hover:bg-[var(--button-hover-bg)]"
                  }`}
                >
                  <span className="block text-sm font-semibold text-[var(--text-primary)]">
                    {font}
                  </span>
                  <span
                    className="mt-3 block text-3xl font-semibold leading-none text-[var(--text-primary)]"
                    style={{ fontFamily: clientEditorFontStack(font) }}
                  >
                    Aa
                  </span>
                  {selected && (
                    <span className="mt-3 inline-flex rounded-full bg-[#AC00FF]/20 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-accent)]">
                      Selected
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

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
  showTemplateContractControls,
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
  showTemplateContractControls: boolean;
}) {
  const sections = buildStepSections(template, fieldOrder);

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-xl font-semibold">Build Your Card</h3>
      </div>

      <MainProfileSection
        template={template}
        draftCard={draftCard}
        expanded={mainProfileExpanded}
        showTemplateContractControls={showTemplateContractControls}
        onUpdate={onUpdate}
        onToggleFieldVisibility={onToggleFieldVisibility}
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
  template,
  draftCard,
  expanded,
  onUpdate,
  onToggleFieldVisibility,
  onToggleExpanded,
  showTemplateContractControls,
}: {
  template: AdminTemplate;
  draftCard: ClientCard;
  expanded: boolean;
  onUpdate: (field: keyof ClientCard, value: string) => void;
  onToggleFieldVisibility: (field: string) => void;
  onToggleExpanded: () => void;
  showTemplateContractControls: boolean;
}) {
  const profileImageAllowed =
    template.profile_image_allowed ?? template.requires_profile_image ?? true;
  const profileImageRequired =
    profileImageAllowed && (template.requires_profile_image ?? false);
  const profileImageDefaultEnabled =
    profileImageAllowed &&
    (template.profile_image_default_enabled ?? profileImageRequired);
  const logoAllowed =
    template.access_level === "paid" &&
    (template.logo_allowed ?? template.requires_logo ?? false);
  const logoRequired = logoAllowed && (template.requires_logo ?? false);
  const logoDefaultEnabled =
    logoAllowed && (template.logo_default_enabled ?? logoRequired);
  const bannerAllowed =
    template.access_level === "paid" &&
    (template.banner_allowed ?? template.requires_banner ?? false);
  const bannerRequired = bannerAllowed && (template.requires_banner ?? false);
  const bannerDefaultEnabled =
    bannerAllowed && (template.banner_default_enabled ?? bannerRequired);
  const showProfileControl = true;
  const showLogoControl =
    template.access_level === "paid" || showTemplateContractControls;
  const showBannerControl =
    template.access_level === "paid" || showTemplateContractControls;

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

            {showProfileControl && (
              <ProfilePictureUpload
                value={
                  profileImageDefaultEnabled
                    ? draftCard.profile_image_url || ""
                    : draftCard.profile_image_url || ""
                }
                fullName={displayName(draftCard, "")}
                required={profileImageRequired}
                defaultEnabled={profileImageDefaultEnabled}
                disabled={!profileImageAllowed}
                visible={isFieldVisible("profile_image_url", draftCard)}
                visibilityLabel="Profile photo visibility"
                onToggleVisibility={() =>
                  onToggleFieldVisibility("profile_image_url")
                }
                onChange={(value) => onUpdate("profile_image_url", value)}
              />
            )}

            {showLogoControl && (
              <MediaImageControl
                title="Company Logo"
                value={draftCard.company_logo_url || ""}
                required={logoRequired}
                defaultEnabled={logoDefaultEnabled}
                disabled={!logoAllowed}
                visible={isFieldVisible("company_logo_url", draftCard)}
                visibilityLabel="Company logo visibility"
                onToggleVisibility={() =>
                  onToggleFieldVisibility("company_logo_url")
                }
                aspect="square"
                previewShape="rounded"
                buttonLabel="Add logo"
                onChange={(value) => onUpdate("company_logo_url", value)}
              />
            )}

            {showBannerControl && (
              <MediaImageControl
                title="Banner Image"
                value={draftCard.company_banner_url || ""}
                required={bannerRequired}
                defaultEnabled={bannerDefaultEnabled}
                disabled={!bannerAllowed}
                visible={isFieldVisible("company_banner_url", draftCard)}
                visibilityLabel="Banner image visibility"
                onToggleVisibility={() =>
                  onToggleFieldVisibility("company_banner_url")
                }
                aspect="banner"
                previewShape="rounded"
                buttonLabel="Add banner"
                onChange={(value) => onUpdate("company_banner_url", value)}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function MediaImageControl({
  title,
  value,
  required,
  defaultEnabled,
  disabled,
  visible,
  visibilityLabel,
  onToggleVisibility,
  aspect,
  previewShape = "rounded",
  buttonLabel,
  onChange,
}: {
  title: string;
  value: string;
  required: boolean;
  defaultEnabled: boolean;
  disabled: boolean;
  visible: boolean;
  visibilityLabel: string;
  onToggleVisibility: () => void;
  aspect: "square" | "banner";
  previewShape?: "circle" | "rounded";
  buttonLabel: string;
  onChange: (value: string) => void;
}) {
  const inputDisabled = disabled;
  const [cropSource, setCropSource] = useState("");

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file || inputDisabled) return;

    const imageDataUrl = await readFileAsDataUrl(file);
    setCropSource(imageDataUrl);
  }

  const cropConfig =
    aspect === "banner"
      ? {
          title: `Position ${title.toLowerCase()}`,
          description:
            "Drag to reposition, then zoom until the banner matches the preview.",
          aspectRatio: modernMinimalMediaSlots.banner.aspectRatio,
          outputWidth: modernMinimalMediaSlots.banner.outputWidth,
          outputHeight: modernMinimalMediaSlots.banner.outputHeight,
          fitMode: modernMinimalMediaSlots.banner.fitMode,
          previewShape,
        }
      : {
          title: `Position ${title.toLowerCase()}`,
          description:
            "Drag to reposition, then zoom until the logo sits neatly in the frame.",
          aspectRatio: modernMinimalMediaSlots.logo.aspectRatio,
          outputWidth: modernMinimalMediaSlots.logo.outputWidth,
          outputHeight: modernMinimalMediaSlots.logo.outputHeight,
          fitMode: modernMinimalMediaSlots.logo.fitMode,
          previewShape,
        };

  return (
    <div
      className={`rounded-2xl border border-[var(--dmi-border)] bg-[var(--dmi-surface)] p-4 ${
        disabled ? "opacity-55" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-semibold text-[var(--text-primary)]">{title}</p>
        <CapabilityBadges
          required={required}
          defaultEnabled={defaultEnabled}
          disabled={disabled}
        />
      </div>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div
          className={`flex items-center justify-center overflow-hidden rounded-xl border border-dashed border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] text-[var(--text-secondary)] ${
            aspect === "banner"
              ? "aspect-[3/1] min-h-20 w-full sm:max-w-64"
              : "h-16 w-16 shrink-0"
          }`}
        >
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt={title} className="h-full w-full object-cover" />
          ) : (
            <ImagePlus className={aspect === "banner" ? "h-6 w-6" : "h-5 w-5"} />
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex min-w-[68px] flex-col items-center justify-end gap-1">
            <VisibilitySwitch
              visible={visible}
              disabled={disabled}
              label={visibilityLabel}
              onToggle={onToggleVisibility}
            />
          </div>
          <label
            className={`inline-flex min-h-9 items-center justify-center rounded-xl border border-[var(--button-secondary-border)] bg-[var(--button-secondary-bg)] px-3 py-2 text-xs font-semibold text-[var(--button-secondary-text)] shadow-sm transition ${
              inputDisabled
                ? "cursor-not-allowed opacity-70"
                : "cursor-pointer hover:border-[var(--border-brand)] hover:bg-[var(--button-hover-bg)]"
            }`}
          >
            <input
              type="file"
              accept="image/*"
              disabled={inputDisabled}
              onChange={handleFileChange}
              className="sr-only"
            />
            {value ? `Change ${buttonLabel.replace("Add ", "")}` : buttonLabel}
          </label>
          {value && !inputDisabled && (
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
        <MediaCropEditor
          source={cropSource}
          title={cropConfig.title}
          description={cropConfig.description}
          aspectRatio={cropConfig.aspectRatio}
          outputWidth={cropConfig.outputWidth}
          outputHeight={cropConfig.outputHeight}
          fitMode={cropConfig.fitMode}
          previewShape={cropConfig.previewShape}
          onCancel={() => setCropSource("")}
          onSave={(image) => {
            onChange(image);
            setCropSource("");
          }}
        />
      )}
    </div>
  );
}

function ProfilePictureUpload({
  value,
  fullName,
  required,
  defaultEnabled,
  disabled,
  visible,
  visibilityLabel,
  onToggleVisibility,
  onChange,
}: {
  value: string;
  fullName?: string | null;
  required: boolean;
  defaultEnabled: boolean;
  disabled: boolean;
  visible: boolean;
  visibilityLabel: string;
  onToggleVisibility: () => void;
  onChange: (value: string) => void;
}) {
  const [cropSource, setCropSource] = useState("");

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file || disabled) return;

    const imageDataUrl = await readFileAsDataUrl(file);
    setCropSource(imageDataUrl);
  }

  return (
    <div
      className={`rounded-2xl border border-[var(--dmi-border)] bg-[var(--dmi-surface)] p-4 ${
        disabled ? "opacity-55" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-semibold text-[var(--text-primary)]">
          Profile Photo
        </p>
        <CapabilityBadges
          required={required}
          defaultEnabled={defaultEnabled}
          disabled={disabled}
        />
      </div>
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
          <div className="flex min-w-[68px] flex-col items-center justify-end gap-1">
            <VisibilitySwitch
              visible={visible}
              disabled={disabled}
              label={visibilityLabel}
              onToggle={onToggleVisibility}
            />
          </div>
          <label
            className={`inline-flex min-h-9 items-center justify-center rounded-xl border border-[var(--button-secondary-border)] bg-[var(--button-secondary-bg)] px-3 py-2 text-xs font-semibold text-[var(--button-secondary-text)] shadow-sm transition ${
              disabled
                ? "cursor-not-allowed opacity-70"
                : "cursor-pointer hover:border-[var(--border-brand)] hover:bg-[var(--button-hover-bg)]"
            }`}
          >
            <input
              type="file"
              accept="image/*"
              disabled={disabled}
              onChange={handleFileChange}
              className="sr-only"
            />
            {value ? "Change photo" : "Add photo"}
          </label>
          {value && !disabled && (
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
        <MediaCropEditor
          source={cropSource}
          title="Position profile photo"
          description="Drag to reposition, then zoom until the face sits neatly in the circle."
          aspectRatio={modernMinimalMediaSlots.profile.aspectRatio}
          outputWidth={modernMinimalMediaSlots.profile.outputWidth}
          outputHeight={modernMinimalMediaSlots.profile.outputHeight}
          fitMode={modernMinimalMediaSlots.profile.fitMode}
          previewShape="circle"
          onCancel={() => setCropSource("")}
          onSave={(image) => {
            onChange(image);
            setCropSource("");
          }}
        />
      )}
    </div>
  );
}

function CapabilityBadges({
  required,
  defaultEnabled,
  disabled,
}: {
  required: boolean;
  defaultEnabled: boolean;
  disabled: boolean;
}) {
  return (
    <span className="flex shrink-0 flex-wrap justify-end gap-1">
      {disabled && (
        <span className="rounded-full bg-slate-500/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-secondary)]">
          Disabled
        </span>
      )}
      {required && (
        <span className="rounded-full bg-amber-500/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-amber-600 dark:text-amber-200">
          Required
        </span>
      )}
      {defaultEnabled && (
        <span className="rounded-full bg-[#AC00FF]/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-accent)]">
          Default
        </span>
      )}
    </span>
  );
}

function MediaCropEditor({
  source,
  title,
  description,
  aspectRatio,
  outputWidth,
  outputHeight,
  fitMode,
  previewShape,
  onCancel,
  onSave,
}: {
  source: string;
  title: string;
  description: string;
  aspectRatio: number;
  outputWidth: number;
  outputHeight: number;
  fitMode: MediaCropFitMode;
  previewShape: "circle" | "rounded";
  onCancel: () => void;
  onSave: (value: string) => void;
}) {
  const [cropPosition, setCropPosition] = useState({ x: 0, y: 0 });
  const [cropZoom, setCropZoom] = useState(1);
  const [imageSize, setImageSize] = useState({ width: 1, height: 1 });
  const dragStartRef = useRef<{
    pointerX: number;
    pointerY: number;
    imageX: number;
    imageY: number;
  } | null>(null);
  const previewWidth = 300;
  const previewHeight = Math.round(previewWidth / aspectRatio);
  const baseScale =
    fitMode === "contain"
      ? Math.min(previewWidth / imageSize.width, previewHeight / imageSize.height)
      : Math.max(previewWidth / imageSize.width, previewHeight / imageSize.height);
  const displayWidth = imageSize.width * baseScale;
  const displayHeight = imageSize.height * baseScale;

  function resetCrop() {
    setCropPosition({ x: 0, y: 0 });
    setCropZoom(1);
  }

  async function saveCrop() {
    const croppedImage = await exportCroppedImage({
      source,
      imageWidth: imageSize.width,
      imageHeight: imageSize.height,
      position: cropPosition,
      zoom: cropZoom,
      previewWidth,
      previewHeight,
      outputWidth,
      outputHeight,
      fitMode,
    });
    onSave(croppedImage);
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-[#101935] p-5 text-white shadow-2xl shadow-black/40">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-xl font-semibold">{title}</h3>
            <p className="mt-1 text-sm text-white/45">{description}</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-white/60 transition hover:bg-white/10 hover:text-white"
            aria-label="Cancel crop"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-6 flex justify-center">
          <div
            className={`relative touch-none overflow-hidden border-2 border-white/25 bg-black/40 shadow-inner shadow-black ${
              previewShape === "circle" ? "rounded-full" : "rounded-2xl"
            }`}
            style={{ width: previewWidth, height: previewHeight }}
            onPointerDown={startDrag}
            onPointerMove={dragImage}
            onPointerUp={stopDrag}
            onPointerCancel={stopDrag}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={source}
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
            <div
              className={`pointer-events-none absolute inset-0 ring-1 ring-inset ring-white/40 ${
                previewShape === "circle" ? "rounded-full" : "rounded-2xl"
              }`}
            />
          </div>
        </div>

        <label className="mt-6 block">
          <span className="mb-2 block text-sm font-medium text-white/55">Zoom</span>
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
            onClick={onCancel}
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
        {field === "phone" || field === "whatsapp" ? (
          <PhoneInput
            label={fieldLabels[field] || friendlyFieldLabel(field)}
            helperText={helperText}
            value={String(value || "")}
            onChange={onChange}
          />
        ) : field === "bio" ? (
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
  disabled = false,
  onToggle,
}: {
  visible: boolean;
  label: string;
  disabled?: boolean;
  onToggle: () => void;
}) {
  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (disabled) return;
    if (event.key !== "Enter" && event.key !== " ") return;

    event.preventDefault();
    onToggle();
  }

  return (
    <>
      <div
      role="switch"
      aria-checked={visible}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      onClick={() => {
        if (!disabled) onToggle();
      }}
      onKeyDown={handleKeyDown}
      className={`relative h-6 w-11 rounded-full border transition focus:outline-none focus:ring-2 focus:ring-[#AC00FF]/55 focus:ring-offset-2 focus:ring-offset-[var(--dmi-surface)] ${
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
      } ${
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
                  fieldKey === "phone" || fieldKey === "whatsapp" ? (
                    <PhoneInput
                      label={destinationLabel}
                      helperText={actionDestinationHelper(action.type)}
                      value={destinationValue}
                      onChange={(value) => onUpdate(fieldKey as keyof ClientCard, value)}
                    />
                  ) : (
                    <TextField
                      label={destinationLabel}
                      helperText={actionDestinationHelper(action.type)}
                      value={destinationValue}
                      onChange={(value) => onUpdate(fieldKey as keyof ClientCard, value)}
                    />
                  )
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

export function normalizeActionConfigForDraft(
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
    <IsolatedPublicCardPreview>
      <PublicLeadCaptureForm
        settings={normalizedSettings}
        privacyNotice={privacyNotice}
        privacyUrl={privacyUrl}
        readOnly
        emptyFieldsMessage="Select at least one field to preview the Collect First form."
      />
    </IsolatedPublicCardPreview>
  );
}

function IsolatedPublicCardPreview({ children }: { children: React.ReactNode }) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [mountNode, setMountNode] = useState<HTMLElement | null>(null);
  const srcDoc =
    '<!doctype html><html><head><title>Lead form preview</title></head><body><div id="public-card-preview-root"></div></body></html>';

  useLayoutEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    function syncFrameDocument() {
      const frameDocument = iframe?.contentDocument;
      if (!frameDocument) return;

      const head = frameDocument.head;
      head.replaceChildren();

      const baseStyle = frameDocument.createElement("style");
      baseStyle.textContent =
        "html,body{margin:0;min-height:100%;background:#070B1A;}body{overflow:auto;}*{box-sizing:border-box;}";
      head.appendChild(baseStyle);

      document
        .querySelectorAll('link[rel="stylesheet"], style')
        .forEach((node) => {
          head.appendChild(node.cloneNode(true));
        });

      setMountNode(frameDocument.getElementById("public-card-preview-root"));
    }

    syncFrameDocument();
    iframe.addEventListener("load", syncFrameDocument);

    return () => iframe.removeEventListener("load", syncFrameDocument);
  }, []);

  const publicPreviewContent = (
    <main className="public-card-page min-h-screen bg-[#070B1A] px-4 py-8 text-white sm:px-6">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-md items-center justify-center">
        <div className="w-full">{children}</div>
      </div>
    </main>
  );

  return (
    <div className="h-full w-full">
      <iframe
        ref={iframeRef}
        title="Lead form preview"
        srcDoc={srcDoc}
        className="block h-full w-full border-0 bg-[#070B1A]"
      />
      {mountNode ? createPortal(publicPreviewContent, mountNode) : null}
    </div>
  );
}


function leadRecipientName(card: Pick<ClientCard, "company_name" | "first_name" | "last_name" | "full_name">) {
  return card.company_name || displayName(card, "this card owner");
}

function privacyNoticeForRecipient(recipient: string) {
  return `Your details will be shared with ${recipient} so they can respond to your enquiry.`;
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
    primary_color: selectedColour || template.primary_color,
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

function clientEditorFontStack(font?: string | null) {
  const fontStacks: Record<string, string> = {
    Inter:
      'var(--font-inter), ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    Poppins:
      'var(--font-poppins), "Avenir Next", "Trebuchet MS", ui-sans-serif, system-ui, sans-serif',
    Montserrat:
      'var(--font-montserrat), "Avenir Next", "Trebuchet MS", ui-sans-serif, system-ui, sans-serif',
    Lato: 'var(--font-lato), Arial, Helvetica, ui-sans-serif, system-ui, sans-serif',
    Roboto: 'var(--font-roboto), Arial, Helvetica, ui-sans-serif, system-ui, sans-serif',
    "Playfair Display":
      'var(--font-playfair-display), Georgia, Cambria, "Times New Roman", serif',
    "DM Sans":
      'var(--font-dm-sans), "Avenir Next", ui-sans-serif, system-ui, -apple-system, sans-serif',
    Outfit:
      'var(--font-outfit), "Avenir Next", "Trebuchet MS", ui-sans-serif, system-ui, sans-serif',
    Nunito:
      'var(--font-nunito), "Trebuchet MS", Verdana, ui-sans-serif, system-ui, sans-serif',
    "Space Mono":
      'var(--font-space-mono), ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    Syne:
      'var(--font-syne), "Arial Black", Impact, ui-sans-serif, system-ui, sans-serif',
  };

  return fontStacks[font || "Inter"] || fontStacks.Inter;
}

function canSelectTemplate(
  template: AdminTemplate | CardRendererTemplate,
  plan: ClientCardPlan
) {
  return canSelectTemplateForPlan(template, plan);
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
  previewWidth,
  previewHeight,
  outputWidth,
  outputHeight,
  fitMode,
}: {
  source: string;
  imageWidth: number;
  imageHeight: number;
  position: { x: number; y: number };
  zoom: number;
  previewWidth: number;
  previewHeight: number;
  outputWidth: number;
  outputHeight: number;
  fitMode: MediaCropFitMode;
}) {
  return new Promise<string>((resolve, reject) => {
    const image = new Image();

    image.onerror = () => reject(new Error("Could not load image file."));
    image.onload = () => {
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");

      if (!context) {
        reject(new Error("Image cropping is not supported in this browser."));
        return;
      }

      canvas.width = outputWidth;
      canvas.height = outputHeight;

      const baseScale =
        fitMode === "contain"
          ? Math.min(previewWidth / imageWidth, previewHeight / imageHeight)
          : Math.max(previewWidth / imageWidth, previewHeight / imageHeight);
      const outputScaleX = outputWidth / previewWidth;
      const outputScaleY = outputHeight / previewHeight;
      const drawWidth = imageWidth * baseScale * zoom * outputScaleX;
      const drawHeight = imageHeight * baseScale * zoom * outputScaleY;
      const drawX = (outputWidth - drawWidth) / 2 + position.x * outputScaleX;
      const drawY = (outputHeight - drawHeight) / 2 + position.y * outputScaleY;

      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, outputWidth, outputHeight);
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

export function findDevice(key: DevicePreviewKey) {
  return (
    allDeviceOptions().find((device) => device.key === key) ||
    allDeviceOptions().find((device) => device.key === "iphone_15") ||
    devicePreviewGroups[0].devices[0]
  );
}

export function filterDeviceGroups(search: string): DevicePreviewGroup[] {
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

export function previewFrameDimensions(device: DevicePreviewDevice) {
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


function friendlyFieldLabel(field: string) {
  const label = field.startsWith("custom:")
    ? field.split(":").at(-1) || field
    : field;

  return label
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}
