import { resolveCardMedia } from "@/lib/card-media";

import CardMediaImage from "@/components/CardMediaImage";
import { cardFontOverride } from "@/lib/card-typography";
import { cardSectionLabel } from "@/lib/card-section-label";
import {
  Briefcase,
  Building2,
  Calendar,
  FileText,
  Globe,
  Link as LinkIcon,
  Mail,
  MapPin,
  Phone,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import {
  FaFacebookF,
  FaInstagram,
  FaLinkedinIn,
  FaWhatsapp,
  FaYoutube,
} from "react-icons/fa";
import type { IconType } from "react-icons";
import type {
  CardActionConfig,
  CardActionConfigItem,
  CardActionType,
  TemplateAllowedActions,
} from "@/lib/card-actions";
import {
  actionIsComplete,
  defaultLabelForActionType,
  effectiveCardActionConfig,
  normalizeCardActionConfig,
} from "@/lib/card-actions";
import {
  resolveCardActionHref,
  resolveCardFieldHref,
  vCardDataHref,
  vCardFilename,
} from "@/lib/card-action-routing";
import { modernMinimalMediaSlots } from "@/lib/media-slots";

type CardRendererMode = "preview" | "public" | "compact";
type LogoSize = "compact" | "standard" | "large" | "banner";
type CustomFieldMap = Partial<Record<ClassicSectionKey, string[]>>;
type CustomFieldValues = Record<
  string,
  string | null | undefined | Record<string, string | null | undefined>
>;
type ClassicSectionKey = string;
type DisplayRow = {
  field?: string;
  label: string;
  value?: string | null;
  icon?: LucideIcon;
  href?: string | null;
  example?: boolean;
};

type TemplateActionIcon = LucideIcon | IconType;

const templateActionIcons: Record<CardActionType, TemplateActionIcon> = {
  save_contact: UserRound,
  call: Phone,
  email: Mail,
  sms: Phone,
  whatsapp: FaWhatsapp,
  website: Globe,
  book_meeting: Calendar,
  maps_directions: MapPin,
  custom_link: LinkIcon,
  download_pdf: FileText,
  linkedin: FaLinkedinIn,
  instagram: FaInstagram,
  facebook: FaFacebookF,
  x_twitter: LinkIcon,
  tiktok: LinkIcon,
  threads: LinkIcon,
  snapchat: LinkIcon,
  pinterest: LinkIcon,
  telegram: LinkIcon,
  signal: LinkIcon,
  youtube: FaYoutube,
  vimeo: LinkIcon,
  twitch: LinkIcon,
  spotify: LinkIcon,
  apple_music: LinkIcon,
  soundcloud: LinkIcon,
  discord: LinkIcon,
  steam: LinkIcon,
  xbox: LinkIcon,
  playstation: LinkIcon,
  epic_games: LinkIcon,
  battle_net: LinkIcon,
  slack: LinkIcon,
  microsoft_teams: LinkIcon,
  github: LinkIcon,
  gitlab: LinkIcon,
};

function toDisplayValue(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }

  if (typeof value === "object") {
    for (const nestedValue of Object.values(value)) {
      const displayValue = toDisplayValue(nestedValue);

      if (displayValue) return displayValue;
    }

    return null;
  }

  return String(value);
}

export type CardRendererTemplate = {
  layout_type?: string | null;
  logo_size?: LogoSize | string | null;
  access_level?: string | null;
  primary_color?: string | null;
  secondary_color?: string | null;
  text_color?: string | null;
  button_color?: string | null;
  button_text_color?: string | null;
  requires_profile_image?: boolean | null;
  requires_logo?: boolean | null;
  requires_banner?: boolean | null;
  profile_image_allowed?: boolean | null;
  profile_image_default_enabled?: boolean | null;
  logo_allowed?: boolean | null;
  logo_default_enabled?: boolean | null;
  banner_allowed?: boolean | null;
  banner_default_enabled?: boolean | null;
  custom_colour_allowed?: boolean | null;
  custom_text_colour_allowed?: boolean | null;
  gradient_enabled?: boolean | null;
  colour_palette?: string[] | null;
  free_colour_palette?: string[] | null;
  text_colours?: string[] | null;
  allowed_fonts?: string[] | null;
  default_font?: string | null;
  supports_bio?: boolean | null;
  supports_save_contact?: boolean | null;
  allowed_actions?: TemplateAllowedActions | null;
  allowed_fields?: string[] | null;
  custom_fields?: CustomFieldMap | null;
  show_personal_section?: boolean | null;
  show_company_section?: boolean | null;
  show_contact_section?: boolean | null;
  show_social_section?: boolean | null;
  field_config?: Record<string, unknown> | null;
  renderer_options?: Record<string, unknown> | null;
  template_contract_version?: number | null;
};

export type CardRendererData = {
  title?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  job_title?: string | null;
  department?: string | null;
  bio?: string | null;
  company_name?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  address?: string | null;
  whatsapp?: string | null;
  linkedin?: string | null;
  instagram?: string | null;
  facebook?: string | null;
  youtube?: string | null;
  booking_link?: string | null;
  custom_url?: string | null;
  action_config?: CardActionConfig | null;
  selected_colour?: string | null;
  selected_text_colour?: string | null;
  selected_background_mode?: "solid" | "gradient" | string | null;
  selected_gradient_start?: string | null;
  selected_gradient_end?: string | null;
  profile_image_url?: string | null;
  company_logo_url?: string | null;
  company_banner_url?: string | null;
  custom_fields?: CustomFieldValues | null;
  hidden_fields?: string[] | null;
  field_visibility?: Record<string, boolean> | null;
  example_fields?: string[] | null;
};

type CardRendererProps = {
  template: CardRendererTemplate;
  cardData: CardRendererData;
  mode: CardRendererMode;
  showActions?: boolean;
  showMediaPlaceholders?: boolean;
  previewActionDestinations?: boolean;
};

const defaultFields = [
  "job_title",
  "department",
  "bio",
  "company_name",
  "website",
  "address",
  "email",
  "phone",
];
const defaultPrimary = "#000000";
const defaultSecondary = "#FFFFFF";
const defaultText = "#FFFFFF";
const defaultButton = "#0F0E38";
const defaultButtonText = "#FFFFFF";
const rendererGradientDirections: Record<string, string> = {
  to_bottom: "to bottom",
  to_top: "to top",
  to_right: "to right",
  to_left: "to left",
  to_bottom_right: "to bottom right",
  to_bottom_left: "to bottom left",
};

function rendererGradientDirection(template: CardRendererTemplate) {
  const gradientDefaults = template.renderer_options?.gradient_defaults;

  if (
    !gradientDefaults ||
    typeof gradientDefaults !== "object" ||
    Array.isArray(gradientDefaults)
  ) {
    return "to bottom right";
  }

  const direction = (gradientDefaults as Record<string, unknown>).direction;

  return typeof direction === "string" && rendererGradientDirections[direction]
    ? rendererGradientDirections[direction]
    : "to bottom right";
}

function isRendererMediaVisible(cardData: CardRendererData, keys: string[]) {
  const visibility = cardData.field_visibility || {};
  const hidden = new Set(cardData.hidden_fields || []);

  for (const key of keys) {
    if (visibility[key] === false) return false;
    if (visibility[key] === true) return true;
  }

  return !keys.some((key) => hidden.has(key));
}

function isRendererExampleField(cardData: CardRendererData, field?: string) {
  if (!field) return false;

  return new Set(cardData.example_fields || []).has(field);
}

function markExampleRows(rows: DisplayRow[], cardData: CardRendererData) {
  return rows.map((row) => ({
    ...row,
    example: row.example || isRendererExampleField(cardData, row.field),
  }));
}

type SectionSettings = {
  personal: boolean;
  company: boolean;
  contact: boolean;
  social: boolean;
};

type RendererTheme = {
  primary: string;
  secondary: string;
  background: string;
  text: string;
  buttonColor: string;
  buttonTextColor: string;
  fontFamily: string;
  // TODO: Add fieldAccent when templates table/UI supports Field Accent Colour.
  // For now, paid field labels, icons, and divider accents intentionally use text.
};

const classicSectionDefaults: Record<ClassicSectionKey, string[]> = {
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

const classicSectionLabels: Record<string, string> = {
  personal: "Personal Details",
  company: "Company Details",
  contact: "Contact",
  social: "Social Links",
};

const actionOwnedDetailFields = new Set([
  "whatsapp",
  "linkedin",
  "instagram",
  "facebook",
  "youtube",
  "booking_link",
  "custom_url",
]);

export function displayName(
  cardData: Pick<CardRendererData, "title" | "first_name" | "last_name" | "full_name">,
  fallback = "Full Name"
) {
  const splitName = [cardData.title, cardData.first_name, cardData.last_name]
    .map(toDisplayValue)
    .filter(Boolean)
    .join(" ");

  return splitName || toDisplayValue(cardData.full_name) || fallback;
}

export function combineNameParts({
  title,
  first_name,
  last_name,
}: Pick<CardRendererData, "title" | "first_name" | "last_name">) {
  return [title, first_name, last_name].map(toDisplayValue).filter(Boolean).join(" ");
}

export default function CardRenderer({
  template,
  cardData,
  mode,
  showMediaPlaceholders = false,
  previewActionDestinations = false,
}: CardRendererProps) {
  const layout = normalizeLayoutType(template.layout_type, template.access_level);
  const logoSize = normalizeLogoSize(template.logo_size);
  const allowedFields = template.allowed_fields?.length
    ? template.allowed_fields
    : defaultFields;
  const compact = mode === "compact";
  const isPaid = template.access_level === "paid";
  const profileImageAllowed =
    template.profile_image_allowed ?? template.requires_profile_image ?? true;
  const logoAllowed =
    isPaid && (template.logo_allowed ?? template.requires_logo ?? false);
  const bannerAllowed =
    isPaid && (template.banner_allowed ?? template.requires_banner ?? false);
  const requiresProfileImage = profileImageAllowed && (
    layout === "modern_minimal" || layout === "profile_free"
      ? true
      : template.requires_profile_image ?? true);
  const profileImageVisible = (showMediaPlaceholders || Boolean(resolveCardMedia(cardData.profile_image_url))) && isRendererMediaVisible(cardData, [
    "profile_image_url",
    "profile_image",
  ]);
  const logoVisible = (showMediaPlaceholders || Boolean(resolveCardMedia(cardData.company_logo_url))) && isRendererMediaVisible(cardData, [
    "company_logo_url",
    "company_logo",
    "logo",
  ]);
  const bannerVisible = (showMediaPlaceholders || Boolean(resolveCardMedia(cardData.company_banner_url))) && isRendererMediaVisible(cardData, [
    "company_banner_url",
    "company_banner",
    "banner",
  ]);
  const requiresLogo =
    isPaid &&
    logoVisible &&
    (template.requires_logo === true ||
      (layout === "modern_minimal" && logoAllowed));
  const requiresBanner =
    isPaid &&
    bannerVisible &&
    (template.requires_banner === true ||
      (layout === "modern_minimal" && bannerAllowed));
  const supportsBio = template.supports_bio ?? true;
  const sectionSettings = {
    personal: template.show_personal_section ?? true,
    company: template.show_company_section ?? true,
    contact: template.show_contact_section ?? true,
    social: template.show_social_section ?? false,
  };
  const selectedColour = cardData.selected_colour
    ? sanitizeColourPalette([cardData.selected_colour])[0]
    : null;
  const selectedGradientStart = cardData.selected_gradient_start
    ? sanitizeColourPalette([cardData.selected_gradient_start])[0]
    : null;
  const selectedGradientEnd = cardData.selected_gradient_end
    ? sanitizeColourPalette([cardData.selected_gradient_end])[0]
    : null;
  const selectedBackgroundMode =
    template.access_level === "paid"
      ? cardData.selected_background_mode ||
        (template.gradient_enabled ? "gradient" : "solid")
      : "solid";
  const templateFreeColour =
    template.primary_color ||
    sanitizeColourPalette(template.free_colour_palette)[0] ||
    defaultPrimary;
  const templateTextColour =
    template.text_color || sanitizeColourPalette(template.text_colours)[0] || null;
  const primary = selectedColour || template.primary_color || defaultPrimary;
  const secondary = selectedGradientEnd || template.secondary_color || defaultSecondary;
  const freeColour = selectedColour || templateFreeColour;
  const selectedTextColour = cardData.selected_text_colour
    ? sanitizeColourPalette([cardData.selected_text_colour])[0]
    : null;
  const text =
    selectedTextColour ||
    templateTextColour ||
    (freeColour ? readableTextForBackground(freeColour) : defaultText);
  const { buttonColor, buttonTextColor } = resolveButtonColours(
    template.button_color,
    template.button_text_color
  );
  const selectedFont = cardFontOverride(template, cardData.custom_fields);
  const fontFamily = selectedFont ? getFontFamily(selectedFont) : isPaid
    ? getTemplateFont(layout, template.default_font)
    : getFontFamily(template.default_font);
  const saveContactHref = mode === "public" ? vCardDataHref(cardData) : null;
  const saveContactFilename = mode === "public" ? vCardFilename(cardData) : undefined;
  const previewSaveContactContrastClass =
    mode === "public"
      ? ""
      : "![background-color:var(--card-save-contact-bg)] ![color:var(--card-save-contact-text)]";
  const saveContactStyle = {
    "--card-save-contact-bg": buttonColor,
    "--card-save-contact-text": buttonTextColor,
    backgroundColor: buttonColor,
    color: buttonTextColor,
  } as React.CSSProperties;
  const configuredActionConfig = normalizeCardActionConfig(cardData.action_config);
  const actionConfig = configuredActionConfig
    ? effectiveCardActionConfig(cardData, template)
    : null;
  const shellClass = compact
    ? "min-h-[420px] rounded-3xl p-4"
    : "min-h-[650px] rounded-[2rem] p-6";
  const isClassicFree = layout === "classic_free" && template.access_level === "free";
  const background =
    template.access_level === "free"
      ? freeColour
      : selectedBackgroundMode === "gradient"
      ? `linear-gradient(${rendererGradientDirection(template)}, ${
          selectedGradientStart || primary
        }, ${secondary})`
      : primary;
  const theme = {
    primary,
    secondary,
    background,
    text,
    buttonColor,
    buttonTextColor,
    fontFamily,
  };
  const classicFreeSaveContactStyle = {
    "--card-save-contact-bg": colorAlpha(text, 0.08),
    "--card-save-contact-text": text,
    backgroundColor: colorAlpha(text, 0.08),
    border: `1px solid ${colorAlpha(text, 0.28)}`,
    color: text,
  } as React.CSSProperties;
  const resolvedSaveContactStyle = isClassicFree
    ? classicFreeSaveContactStyle
    : saveContactStyle;

  const content = {
    classic_free: (
      <ClassicLayout
        cardData={cardData}
        allowedFields={allowedFields}
        requiresProfileImage={requiresProfileImage && profileImageVisible}
        requiresLogo={requiresLogo}
        requiresBanner={requiresBanner}
        logoSize={logoSize}
        supportsBio={supportsBio}
        templateCustomFields={template.custom_fields || {}}
        fieldConfig={template.field_config}
        mode={mode}
        sectionSettings={sectionSettings}
        compact={compact}
        isPaid={isPaid}
        theme={theme}
        actionConfig={actionConfig}
        showMediaPlaceholders={showMediaPlaceholders}
        previewActionDestinations={previewActionDestinations}
      />
    ),
    profile_free: (
      <ProfileFreeLayout
        cardData={cardData}
        allowedFields={allowedFields}
        requiresProfileImage={requiresProfileImage && profileImageVisible}
        requiresLogo={requiresLogo}
        requiresBanner={requiresBanner}
        logoSize={logoSize}
        supportsBio={supportsBio}
        templateCustomFields={template.custom_fields || {}}
        fieldConfig={template.field_config}
        mode={mode}
        sectionSettings={sectionSettings}
        compact={compact}
        isPaid={isPaid}
        theme={theme}
        actionConfig={actionConfig}
        showMediaPlaceholders={showMediaPlaceholders}
        previewActionDestinations={previewActionDestinations}
      />
    ),
    modern_minimal: (
      <ModernMinimalLayout
        cardData={cardData}
        allowedFields={allowedFields}
        requiresProfileImage={requiresProfileImage && profileImageVisible}
        requiresLogo={requiresLogo}
        requiresBanner={requiresBanner}
        logoSize={logoSize}
        supportsBio={supportsBio}
        templateCustomFields={template.custom_fields || {}}
        fieldConfig={template.field_config}
        mode={mode}
        sectionSettings={sectionSettings}
        compact={compact}
        isPaid
        theme={theme}
        actionConfig={actionConfig}
        showMediaPlaceholders={showMediaPlaceholders}
      />
    ),
    executive_paid: (
      <ExecutiveLayout
        cardData={cardData}
        allowedFields={template.allowed_fields ?? defaultFields}
        requiresProfileImage={profileImageAllowed && profileImageVisible}
        requiresLogo={logoAllowed && logoVisible}
        logoSize={logoSize}
        supportsBio={supportsBio}
        templateCustomFields={template.custom_fields || {}}
        fieldConfig={template.field_config}
        mode={mode}
        sectionSettings={sectionSettings}
        compact={compact}
        isPaid
        theme={theme}
        actionConfig={actionConfig || effectiveCardActionConfig(cardData, template)}
        showMediaPlaceholders={showMediaPlaceholders}
        previewActionDestinations={previewActionDestinations}
      />
    ),
    brand_paid: (
      <BrandLayout
        cardData={cardData}
        allowedFields={template.allowed_fields ?? defaultFields}
        requiresProfileImage={profileImageAllowed && profileImageVisible}
        requiresLogo={logoAllowed && logoVisible}
        requiresBanner={bannerAllowed && bannerVisible}
        logoSize={logoSize}
        supportsBio={supportsBio}
        templateCustomFields={template.custom_fields || {}}
        fieldConfig={template.field_config}
        mode={mode}
        sectionSettings={sectionSettings}
        compact={compact}
        isPaid
        theme={theme}
        actionConfig={actionConfig || effectiveCardActionConfig(cardData, template)}
        showMediaPlaceholders={showMediaPlaceholders}
        previewActionDestinations={previewActionDestinations}
      />
    ),
  }[layout] || null;

  if (isTemplateShelllessPaidLayout(layout)) {
    return content;
  }

  return (
    <div
      className={`${shellClass} text-white shadow-2xl`}
      style={{
        background,
        color: text,
        fontFamily,
        // Phone previews provide their chrome inset; public cards use the native safe area.
        paddingTop: layout === "profile_free"
          ? `calc(max(var(--card-viewport-safe-top, 0px), env(safe-area-inset-top, 0px)) + ${compact ? "1rem" : "1.5rem"})`
          : undefined,
      }}
    >
      {content}

      {actionConfig ? (
        <TemplateActionList
          compact={compact}
          theme={theme}
          cardData={cardData}
          mode={mode}
          actionConfig={actionConfig}
          className="mt-8"
          itemClassName="w-full"
          classicFreeSaveContactOutline={isClassicFree}
          previewActionDestinations={previewActionDestinations}
        />
      ) : compact ? (
        <div
          className={`mt-8 w-full rounded-2xl py-4 text-center font-bold transition hover:opacity-90 ${previewSaveContactContrastClass}`}
          style={resolvedSaveContactStyle}
        >
          Save Contact
        </div>
      ) : saveContactHref ? (
        <a
          href={saveContactHref}
          download={saveContactFilename}
          className="mt-8 block w-full rounded-2xl py-4 text-center font-bold transition hover:opacity-90"
          style={resolvedSaveContactStyle}
        >
          Save Contact
        </a>
      ) : (
        <button
          type="button"
          className={`mt-8 w-full rounded-2xl py-4 font-bold transition hover:opacity-90 ${previewSaveContactContrastClass}`}
          style={resolvedSaveContactStyle}
        >
          Save Contact
        </button>
      )}

      {template.access_level === "free" && <DmiFooter textColour={text} />}
    </div>
  );
}

function ClassicLayout({
  cardData,
  allowedFields,
  templateCustomFields = {},
  fieldConfig,
  mode = "preview",
  sectionSettings = {
    personal: true,
    company: true,
    contact: true,
    social: false,
  },
  compact,
  requiresProfileImage,
  requiresLogo,
  requiresBanner,
  isPaid,
  theme,
  actionConfig,
  showMediaPlaceholders = false,
}: LayoutProps) {
  const rendererTheme = getRendererTheme(theme);
  const mutedText = colorAlpha(rendererTheme.text, 0.62);
  const panelBackground = isPaid
    ? "#0508168C"
    : colorAlpha(rendererTheme.text, 0.1);
  const panelBorder = isPaid
    ? "rgba(255,255,255,0.15)"
    : colorAlpha(rendererTheme.text, 0.18);
  const rowBackground = isPaid
    ? "rgba(255,255,255,0.07)"
    : colorAlpha(rendererTheme.text, 0.1);
  const allowed = new Set(allowedFields);
  const previewMode = mode === "preview" || mode === "compact";
  const publicMode = mode === "public";
  const headerJobTitle =
    isPaid && sectionSettings.personal && allowed.has("job_title")
      ? toDisplayValue(cardData.job_title) || (previewMode ? "Job Title" : null)
      : null;

  const personalRows = classicRows(
    "personal",
    templateCustomFields,
    cardData,
    allowed,
    previewMode
  ).filter((row) => !(isPaid && row.label === "Job Title"));
  const companyRows = classicRows(
    "company",
    templateCustomFields,
    cardData,
    allowed,
    previewMode
  );
  const contactRows = classicRows(
    "contact",
    templateCustomFields,
    cardData,
    allowed,
    previewMode
  );
  const socialRows = classicRows(
    "social",
    templateCustomFields,
    cardData,
    allowed,
    previewMode
  );
  const displayedSocialRows = actionConfig
    ? socialRows.filter((row) => !row.field || !actionOwnedDetailFields.has(row.field))
    : socialRows;
  const paidPersonalRows = addPublicRowActions(
    isPaid
    ? buildPaidPersonalRows({
        personalRows,
        contactRows,
        cardData,
        allowed,
        previewMode,
      })
    : personalRows,
    publicMode
  );
  const companyActionRows = addPublicRowActions(companyRows, publicMode);
  const paidContactRows = addPublicRowActions(
    isPaid
    ? contactRows.filter(
        (row) => !["Email", "Phone", "Website"].includes(row.label)
      )
    : contactRows,
    publicMode
  );
  const socialActionRows = addPublicRowActions(displayedSocialRows, publicMode);
  const contentSections = rendererContentSections(
    fieldConfig,
    templateCustomFields,
    sectionSettings
  );
  const sectionRows = (sectionKey: string) => {
    if (sectionKey === "personal") return paidPersonalRows;
    if (sectionKey === "company") return companyActionRows;
    if (sectionKey === "contact") return paidContactRows;
    if (sectionKey === "social") return socialActionRows;

    return addPublicRowActions(
      classicRows(sectionKey, templateCustomFields, cardData, allowed, previewMode),
      publicMode
    );
  };
  const renderedSections = contentSections
    .map((section) => ({
      ...section,
      rows: sectionRows(section.key),
    }))
    .filter((section) => section.enabled && section.rows.length > 0);

  const showProfilePlaceholder = showMediaPlaceholders && !cardData.profile_image_url;
  const profileCircle = (
    <div
      className={`has-[>img[data-media-unavailable]]:hidden flex ${
        compact ? "h-24 w-24 text-2xl" : "h-32 w-32 text-4xl"
      } shrink-0 items-center justify-center overflow-hidden rounded-full border-4 ${
        showProfilePlaceholder
          ? "border-dashed bg-transparent"
          : isPaid
          ? "border-[#E7D7FF] bg-[#8E38D6] text-white shadow-2xl shadow-[#AC00FF]/30 ring-2 ring-[#AC00FF]/35"
          : "border-white/55 bg-white/20 shadow-2xl shadow-black/25"
      } font-bold`}
      style={
        showProfilePlaceholder
          ? adminMediaPlaceholderStyle(rendererTheme.text)
          : undefined
      }
    >
      {cardData.profile_image_url ? (
        <CardMediaImage
          src={cardData.profile_image_url}
          alt={displayName(cardData, "Profile")}
          className="h-full w-full object-cover"
        />
      ) : showProfilePlaceholder ? (
        <UserRound size={compact ? 28 : 38} strokeWidth={1.5} />
      ) : (
        initials(displayName(cardData))
      )}
    </div>
  );

  if (isPaid) {
    return (
      <div className="flex min-h-full min-w-0 max-w-full flex-col overflow-hidden text-center">
        {requiresBanner && (
          <PremiumCompanyBanner cardData={cardData} showLogo={requiresLogo} />
        )}

        {requiresLogo && !requiresBanner && (
          <CompanyLogoBlock cardData={cardData} className="mx-auto mb-5" />
        )}

        <div
          className={`relative z-10 flex justify-center ${
            requiresBanner ? "-mt-10" : "mt-2"
          }`}
        >
          {requiresProfileImage && profileCircle}
        </div>

        <div className="mt-4 min-w-0 px-2 text-center">
          <h3
            className={`max-w-full break-words text-center font-bold leading-tight ${
              compact ? "text-2xl" : "text-4xl"
            }`}
            style={{ color: rendererTheme.text }}
          >
            {displayName(cardData)}
          </h3>

          {headerJobTitle && (
            <p
              className="mt-2 max-w-full break-words text-center text-sm font-medium"
              style={{ color: mutedText }}
            >
              {headerJobTitle}
            </p>
          )}
        </div>

        {renderedSections.map((section) => (
          <ClassicSection
            key={section.key}
            title={section.title}
            rows={section.rows}
            premium
            theme={rendererTheme}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="flex min-h-full min-w-0 max-w-full flex-col overflow-hidden text-center">
      {requiresBanner && isPaid && (
        <PremiumCompanyBanner cardData={cardData} showLogo={requiresLogo} />
      )}

      {requiresLogo && !requiresBanner && (
        <CompanyLogoBlock cardData={cardData} className="mx-auto mb-5" />
      )}

      <div
        className={`mx-auto flex w-full max-w-[320px] min-w-0 flex-col items-center ${
          requiresBanner && isPaid ? "-mt-14" : "mt-2"
        }`}
      >
        {requiresProfileImage && profileCircle}

        <h3
          className={`mt-3 max-w-full break-words text-center font-bold leading-tight ${
            compact ? "text-2xl" : "text-4xl"
          }`}
          style={{ color: rendererTheme.text }}
        >
          {displayName(cardData)}
        </h3>

        {headerJobTitle && (
          <p
            className="mt-2 max-w-full break-words text-center text-sm font-medium"
            style={{ color: mutedText }}
          >
            {headerJobTitle}
          </p>
        )}
      </div>

      {renderedSections.map((section) =>
        section.key === "contact" ? (
          <div
            key={section.key}
            className="mt-6 max-w-full overflow-hidden rounded-3xl border p-4 text-left"
            style={{ backgroundColor: panelBackground, borderColor: panelBorder }}
          >
            <h4
              className="text-xs font-semibold uppercase tracking-[0.18em]"
              style={{ color: mutedText }}
            >
              {section.title}
            </h4>
            <div className="mt-4 space-y-3">
              {section.rows.map((item) => {
                const RowTag = item.href ? "a" : "div";

                return (
                  <RowTag
                    key={item.label}
                    href={item.href || undefined}
                    target={item.href?.startsWith("http") ? "_blank" : undefined}
                    rel={item.href?.startsWith("http") ? "noopener noreferrer" : undefined}
                    className="grid min-w-0 grid-cols-[86px_minmax(0,1fr)] items-center gap-3 rounded-2xl px-3 py-3 text-sm"
                    style={{ backgroundColor: rowBackground }}
                  >
                    <span
                      className="flex min-w-0 items-center gap-2"
                      style={{ color: mutedText }}
                    >
                      <span className="truncate text-xs">{item.label}</span>
                    </span>
                    <span
                      className="min-w-0 max-w-full break-words font-medium"
                      style={{ color: rendererTheme.text }}
                    >
                      {item.value}
                    </span>
                  </RowTag>
                );
              })}
            </div>
          </div>
        ) : (
          <ClassicSection
            key={section.key}
            title={section.title}
            rows={section.rows}
            premium={isPaid}
            theme={rendererTheme}
          />
        )
      )}
    </div>
  );
}

function ProfileFreeLayout({
  cardData,
  allowedFields,
  templateCustomFields = {},
  fieldConfig,
  mode = "preview",
  sectionSettings = {
    personal: true,
    company: true,
    contact: true,
    social: false,
  },
  compact,
  requiresProfileImage,
  theme,
  showMediaPlaceholders = false,
}: LayoutProps) {
  const rendererTheme = getRendererTheme(theme);
  const allowed = new Set(allowedFields);
  const previewMode = mode === "preview" || mode === "compact";
  const publicMode = mode === "public";
  const mutedText = colorAlpha(rendererTheme.text, 0.62);
  const dividerColour = colorAlpha(rendererTheme.text, 0.18);
  const headline = displayName(cardData);
  const headlineIsExample = ["title", "first_name", "last_name", "full_name"].some(
    (field) => isRendererExampleField(cardData, field)
  );
  const showProfileImage = requiresProfileImage && Boolean(cardData.profile_image_url);
  const showProfilePlaceholder =
    requiresProfileImage && showMediaPlaceholders && !cardData.profile_image_url;
  const showProfileSlot = showProfileImage || showProfilePlaceholder;
  const headerJobTitle =
    sectionSettings.personal && allowed.has("job_title")
      ? toDisplayValue(cardData.job_title) || (previewMode ? "Job Title" : null)
      : null;
  const headerJobTitleIsExample = isRendererExampleField(cardData, "job_title");
  const contentSections = rendererContentSections(
    fieldConfig,
    templateCustomFields,
    sectionSettings
  );
  const renderedSections = contentSections
    .map((section) => {
      const sectionRows = markExampleRows(
        addPublicRowActions(
          classicRows(
            section.key,
            templateCustomFields,
            cardData,
            allowed,
            previewMode
          ).filter((row) => !(section.key === "personal" && row.field === "job_title")),
          publicMode
        ),
        cardData
      );

      return {
        ...section,
        rows: sectionRows,
      };
    })
    .filter((section) => section.enabled && section.rows.length > 0);

  return (
    <div
      className={`flex min-h-full min-w-0 max-w-full flex-col ${
        compact ? "gap-5" : "gap-7"
      } text-center`}
    >
      <div className="flex min-w-0 flex-col items-center">
        {showProfileSlot && (
          <div
            className={`has-[>img[data-media-unavailable]]:hidden flex ${
              compact ? "h-28 w-28 text-2xl" : "h-36 w-36 text-4xl"
            } shrink-0 items-center justify-center overflow-hidden rounded-full border font-bold`}
            style={
              showProfilePlaceholder
                ? adminMediaPlaceholderStyle(rendererTheme.text)
                : {
                    borderColor: colorAlpha(rendererTheme.text, 0.24),
                    color: rendererTheme.text,
                    backgroundColor: colorAlpha(rendererTheme.text, 0.08),
                  }
            }
          >
            {cardData.profile_image_url ? (
              <CardMediaImage
                src={cardData.profile_image_url}
                alt={displayName(cardData, "Profile")}
                className="h-full w-full object-cover"
              />
            ) : (
              <UserRound size={compact ? 30 : 40} strokeWidth={1.5} />
            )}
          </div>
        )}

        <h3
          className={`${
            showProfileSlot ? "mt-4" : "mt-1"
          } max-w-full break-words text-center font-bold leading-tight ${
            compact ? "text-2xl" : "text-3xl"
          }`}
          style={{ color: headlineIsExample ? mutedText : rendererTheme.text }}
        >
          {headline}
        </h3>

        {headerJobTitle && (
          <p
            className="mt-2 max-w-full break-words text-center text-sm font-medium"
            style={{ color: headerJobTitleIsExample ? mutedText : rendererTheme.text }}
          >
            {headerJobTitle}
          </p>
        )}
      </div>

      <div className="space-y-5 text-left">
        {renderedSections.map((section) => (
          <ProfileFreeSection
            key={section.key}
            title={section.title}
            rows={section.rows}
            dividerColour={dividerColour}
            theme={rendererTheme}
          />
        ))}
      </div>
    </div>
  );
}

function ProfileFreeSection({
  title,
  rows,
  dividerColour,
  theme,
}: {
  title: string;
  rows: DisplayRow[];
  dividerColour: string;
  theme: RendererTheme;
}) {
  const mutedText = colorAlpha(theme.text, 0.62);

  return (
    <section className="border-t pt-4" style={{ borderColor: dividerColour }}>
      <h4
        className="text-xs font-semibold uppercase tracking-[0.18em]"
        style={{ color: mutedText }}
      >
        {title}
      </h4>
      <div className="mt-3 divide-y" style={{ borderColor: dividerColour }}>
        {rows.map(({ label, value, href, example }) => {
          const RowTag = href ? "a" : "div";

          return (
            <RowTag
              key={label}
              href={href || undefined}
              target={href?.startsWith("http") ? "_blank" : undefined}
              rel={href?.startsWith("http") ? "noopener noreferrer" : undefined}
              className="grid min-w-0 grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-4 py-3 text-sm"
            >
              <span
                className="min-w-0 max-w-full break-words text-xs font-medium"
                style={{ color: mutedText }}
              >
                {label}
              </span>
              <span
                className="min-w-0 max-w-full whitespace-pre-wrap break-words text-right font-semibold"
                style={{ color: example ? mutedText : theme.text }}
              >
                {value}
              </span>
            </RowTag>
          );
        })}
      </div>
    </section>
  );
}

function ClassicSection({
  title,
  rows,
  premium = false,
  className = "",
  theme,
}: {
  title: string;
  rows: DisplayRow[];
  premium?: boolean;
  className?: string;
  theme?: RendererTheme;
}) {
  const rendererTheme = getRendererTheme(theme);
  const mutedText = colorAlpha(rendererTheme.text, 0.62);
  const panelBackground = premium
    ? "#0508168C"
    : colorAlpha(rendererTheme.text, 0.1);
  const panelBorder = premium
    ? "rgba(255,255,255,0.15)"
    : colorAlpha(rendererTheme.text, 0.18);

  return (
    <div
      className={`mt-6 max-w-full overflow-hidden rounded-3xl border p-4 text-left ${
        premium ? "shadow-xl shadow-black/10" : ""
      } ${className}`}
      style={{ backgroundColor: panelBackground, borderColor: panelBorder }}
    >
      <h4
        className="text-xs font-semibold uppercase tracking-[0.18em]"
        style={{ color: mutedText }}
      >
        {title}
      </h4>
      <ClassicSectionContent
        rows={rows}
        className="mt-4"
        premium={premium}
        theme={rendererTheme}
      />
    </div>
  );
}

function ClassicSectionContent({
  rows,
  className = "",
  premium = false,
  theme,
}: {
  rows: DisplayRow[];
  className?: string;
  premium?: boolean;
  theme?: RendererTheme;
}) {
  const rendererTheme = getRendererTheme(theme);
  const mutedText = colorAlpha(rendererTheme.text, 0.62);
  const rowBackground = premium
    ? "rgba(255,255,255,0.06)"
    : colorAlpha(rendererTheme.text, 0.1);

  return (
    <div className={`${className} space-y-3`}>
      {rows.map(({ label, value, icon, href }) => {
        const Icon = icon || iconForLabel(label);

        if (premium) {
          const RowTag = href ? "a" : "div";

          return (
            <RowTag
              key={label}
              href={href || undefined}
              target={href?.startsWith("http") ? "_blank" : undefined}
              rel={href?.startsWith("http") ? "noopener noreferrer" : undefined}
              className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-3 border-b border-white/10 bg-white/[0.06] px-3 py-3 text-sm last:border-b-0 first:rounded-t-2xl last:rounded-b-2xl"
            >
              <span
                className="flex min-w-0 items-center gap-3"
                style={{ color: mutedText }}
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#AC00FF]/18 text-[#D78BFF]">
                  <Icon size={15} />
                </span>
                <span className="truncate text-xs">{label}</span>
              </span>
              <span
                className="min-w-0 max-w-full whitespace-pre-wrap break-words text-right text-sm font-semibold"
                style={{ color: rendererTheme.text }}
              >
                {value}
              </span>
            </RowTag>
          );
        }

        const RowTag = href ? "a" : "div";

        return (
          <RowTag
            key={label}
            href={href || undefined}
            target={href?.startsWith("http") ? "_blank" : undefined}
            rel={href?.startsWith("http") ? "noopener noreferrer" : undefined}
            className="grid min-w-0 grid-cols-[86px_minmax(0,1fr)] items-center gap-3 rounded-2xl px-3 py-3 text-sm"
            style={{ backgroundColor: rowBackground }}
          >
            <span
              className="min-w-0 max-w-full break-words text-xs"
              style={{ color: mutedText }}
            >
              {label}
            </span>
            <span
              className="min-w-0 max-w-full whitespace-pre-wrap break-words font-medium"
              style={{ color: rendererTheme.text }}
            >
              {value}
            </span>
          </RowTag>
        );
      })}
    </div>
  );
}

function ExecutiveLayout({
  cardData,
  allowedFields,
  templateCustomFields = {},
  fieldConfig,
  mode = "preview",
  sectionSettings = { personal: true, company: true, contact: true, social: false },
  compact,
  requiresProfileImage,
  requiresLogo,
  theme,
  actionConfig,
  showMediaPlaceholders = false,
  previewActionDestinations = false,
}: LayoutProps) {
  const rendererTheme = getRendererTheme(theme);
  const muted = colorAlpha(rendererTheme.text, 0.62);
  const divider = colorAlpha(rendererTheme.text, 0.18);
  const placeholderStyle = adminMediaPlaceholderStyle(rendererTheme.text);
  const showPlaceholders = showMediaPlaceholders && mode === "preview";
  const showProfile =
    requiresProfileImage && (cardData.profile_image_url || showPlaceholders);
  const showLogo = requiresLogo && (cardData.company_logo_url || showPlaceholders);
  const configuredSections = readRendererSections(fieldConfig, templateCustomFields);
  const visibility = (fieldConfig?.default_visibility || {}) as Record<string, boolean>;
  const allowed = new Set(allowedFields);
  const sections = rendererContentSections(
    fieldConfig,
    templateCustomFields,
    sectionSettings
  )
    .filter(
      (section) =>
        section.enabled &&
        visibility[`section:${section.key}`] !== false &&
        isRendererMediaVisible(cardData, [`section:${section.key}`]) &&
        (!fieldConfig?.sections || Object.hasOwn(configuredSections, section.key))
    )
    .map((section) => {
      const fields =
        configuredSections[section.key] ?? classicSectionDefaults[section.key] ?? [];
      const visibleFields = fields.filter((field) => {
        const storageKey = isCustomFieldKey(field)
          ? field.split(":").at(-1)?.trim().toLowerCase() || field
          : field;
        return (
          allowed.has(field) &&
          visibility[field] !== false &&
          visibility[storageKey] !== false &&
          isRendererMediaVisible(cardData, [field, storageKey])
        );
      });

      return {
        ...section,
        rows: markExampleRows(
          addPublicRowActions(
            classicRows(
              section.key,
              configuredSections,
              cardData,
              new Set(visibleFields),
              mode !== "public"
            ),
            mode === "public"
          ),
          cardData
        ),
      };
    })
    .filter((section) => section.rows.length > 0);
  const jobTitle = sections
    .flatMap((section) => section.rows)
    .find((row) => row.field === "job_title");
  const headlineIsExample = ["title", "first_name", "last_name", "full_name"].some(
    (field) => isRendererExampleField(cardData, field)
  );

  return (
    <div
      className={`min-h-full min-w-0 ${compact ? "p-5 pt-9" : "p-7 pt-12"}`}
      style={{
        background: rendererTheme.background,
        color: rendererTheme.text,
        fontFamily: rendererTheme.fontFamily,
      }}
    >
      <header className={`flex flex-col ${compact ? "gap-5" : "gap-7"}`}>
        {showLogo && (
          <div className="has-[>img[data-media-unavailable]]:hidden flex h-14 w-36 items-center justify-start">
            {cardData.company_logo_url ? (
              <CardMediaImage
                src={cardData.company_logo_url}
                alt={cardData.company_name || "Company logo"}
                className="max-h-full max-w-full object-contain object-left"
              />
            ) : (
              <div
                aria-hidden="true"
                className="flex h-full w-full items-center justify-center rounded-lg border border-dashed text-xs font-semibold tracking-widest"
                style={placeholderStyle}
              >
                Logo
              </div>
            )}
          </div>
        )}
        <div className="flex min-w-0 items-center gap-4">
          {showProfile && (
            <div
              className={`has-[>img[data-media-unavailable]]:hidden flex shrink-0 items-center justify-center overflow-hidden rounded-full border ${
                compact ? "h-16 w-16" : "h-20 w-20"
              } ${cardData.profile_image_url ? "" : "border-dashed"}`}
              style={
                cardData.profile_image_url ? { borderColor: divider } : placeholderStyle
              }
            >
              {cardData.profile_image_url ? (
                <CardMediaImage
                  src={cardData.profile_image_url}
                  alt={displayName(cardData, "Profile")}
                  className="h-full w-full object-cover"
                />
              ) : (
                <UserRound size={compact ? 24 : 30} strokeWidth={1.5} />
              )}
            </div>
          )}
          <div className="min-w-0">
            <h3
              className={`break-words font-semibold leading-tight ${compact ? "text-xl" : "text-2xl"}`}
              style={{ color: headlineIsExample ? muted : rendererTheme.text }}
            >
              {displayName(cardData)}
            </h3>
            {jobTitle && (
              <p className="mt-2 break-words text-sm" style={{ color: muted }}>
                {jobTitle.value}
              </p>
            )}
          </div>
        </div>
      </header>

      {sections.map((section) => (
        <section
          key={section.key}
          className="mt-7 border-t pt-5"
          style={{ borderColor: divider }}
        >
          <h4
            className="text-[10px] font-bold uppercase tracking-[0.2em]"
            style={{ color: muted }}
          >
            {section.title}
          </h4>
          <div className="mt-3 space-y-3">
            {section.rows.map((row) => {
              const RowTag = row.href ? "a" : "div";
              return (
                <RowTag
                  key={row.field || row.label}
                  href={row.href || undefined}
                  target={row.href?.startsWith("http") ? "_blank" : undefined}
                  rel={row.href?.startsWith("http") ? "noopener noreferrer" : undefined}
                  className="grid min-w-0 grid-cols-[minmax(0,0.8fr)_minmax(0,1.4fr)] gap-4 text-sm"
                >
                  <span className="break-words text-xs" style={{ color: muted }}>
                    {row.label}
                  </span>
                  <span
                    className="min-w-0 whitespace-pre-wrap break-words font-medium"
                    style={{ color: row.example ? muted : rendererTheme.text }}
                  >
                    {row.value}
                  </span>
                </RowTag>
              );
            })}
          </div>
        </section>
      ))}

      {actionConfig && (
        <TemplateActionList
          compact={compact}
          theme={rendererTheme}
          cardData={cardData}
          mode={mode}
          actionConfig={actionConfig}
          className="mt-7"
          itemClassName="w-full"
          previewActionDestinations={previewActionDestinations}
        />
      )}
    </div>
  );
}

function BrandLayout({
  cardData,
  allowedFields,
  templateCustomFields = {},
  fieldConfig,
  mode = "preview",
  sectionSettings = { personal: true, company: true, contact: true, social: false },
  compact,
  requiresProfileImage,
  requiresLogo,
  requiresBanner,
  theme,
  actionConfig,
  showMediaPlaceholders = false,
  previewActionDestinations = false,
}: LayoutProps) {
  const rendererTheme = getRendererTheme(theme);
  const muted = colorAlpha(rendererTheme.text, 0.62);
  const divider = colorAlpha(rendererTheme.text, 0.18);
  const placeholderStyle = adminMediaPlaceholderStyle(rendererTheme.text);
  const showPlaceholders = showMediaPlaceholders && mode === "preview";
  const showBanner = requiresBanner && (cardData.company_banner_url || showPlaceholders);
  const showLogo = requiresLogo && (cardData.company_logo_url || showPlaceholders);
  const showProfile =
    requiresProfileImage && (cardData.profile_image_url || showPlaceholders);
  const configuredSections = readRendererSections(fieldConfig, templateCustomFields);
  const visibility = (fieldConfig?.default_visibility || {}) as Record<string, boolean>;
  const allowed = new Set(allowedFields);
  const sections = rendererContentSections(
    fieldConfig,
    templateCustomFields,
    sectionSettings
  )
    .filter(
      (section) =>
        section.enabled &&
        visibility[`section:${section.key}`] !== false &&
        isRendererMediaVisible(cardData, [`section:${section.key}`]) &&
        (!fieldConfig?.sections || Object.hasOwn(configuredSections, section.key))
    )
    .map((section) => {
      const fields =
        configuredSections[section.key] ?? classicSectionDefaults[section.key] ?? [];
      const visibleFields = fields.filter((field) => {
        const storageKey = isCustomFieldKey(field)
          ? field.split(":").at(-1)?.trim().toLowerCase() || field
          : field;
        return (
          allowed.has(field) &&
          visibility[field] !== false &&
          visibility[storageKey] !== false &&
          isRendererMediaVisible(cardData, [field, storageKey])
        );
      });

      return {
        ...section,
        rows: markExampleRows(
          addPublicRowActions(
            classicRows(
              section.key,
              configuredSections,
              cardData,
              new Set(visibleFields),
              mode !== "public"
            ),
            mode === "public"
          ),
          cardData
        ),
      };
    });
  const identityRows = sections.flatMap((section) => section.rows);
  const jobTitle = identityRows.find((row) => row.field === "job_title");
  const company = identityRows.find((row) => row.field === "company_name");
  // These configured fields appear once, in the identity area rather than again below it.
  const contentSections = sections
    .map((section) => ({
      ...section,
      rows: section.rows.filter((row) => !["job_title", "company_name"].includes(row.field || "")),
    }))
    .filter((section) => section.rows.length > 0);
  const headlineIsExample = ["title", "first_name", "last_name", "full_name"].some(
    (field) => isRendererExampleField(cardData, field)
  );

  return (
    <div
      className="min-h-full min-w-0 overflow-hidden"
      style={{
        background: rendererTheme.background,
        color: rendererTheme.text,
        fontFamily: rendererTheme.fontFamily,
      }}
    >
      {showBanner && (
        <div
          className="has-[>img[data-media-unavailable]]:hidden relative w-full overflow-hidden"
          style={{ aspectRatio: "3 / 1" }}
        >
          {cardData.company_banner_url ? (
            <CardMediaImage
              src={cardData.company_banner_url}
              alt="Company banner"
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : (
            <div
              aria-hidden="true"
              className="flex h-full w-full items-center justify-center border border-dashed text-xs font-semibold uppercase tracking-[0.28em]"
              style={placeholderStyle}
            >
              Banner
            </div>
          )}
        </div>
      )}

      <div
        className={`${compact ? "px-5 pb-5" : "px-7 pb-7"} ${
          showBanner ? "" : compact ? "pt-9" : "pt-12"
        }`}
      >
        {showLogo && (
          <div
            className={`has-[>img[data-media-unavailable]]:hidden relative mx-auto flex h-16 w-32 items-center justify-center overflow-hidden rounded-xl border ${
              showBanner ? "-mt-5" : ""
            } ${cardData.company_logo_url ? "" : "border-dashed"}`}
            style={
              cardData.company_logo_url
                ? { borderColor: divider, background: rendererTheme.background }
                : { ...placeholderStyle, background: rendererTheme.background }
            }
          >
            {cardData.company_logo_url ? (
              <CardMediaImage
                src={cardData.company_logo_url}
                alt={company?.value ? `${company.value} logo` : "Company logo"}
                className="h-full w-full object-contain p-2"
              />
            ) : (
              <span aria-hidden="true" className="text-xs font-semibold tracking-widest">
                Logo
              </span>
            )}
          </div>
        )}

        <header
          className={`flex min-w-0 flex-col items-center text-center ${
            showBanner || showLogo ? "mt-6" : ""
          }`}
        >
          {showProfile && (
            <div
              className={`has-[>img[data-media-unavailable]]:hidden mb-4 flex shrink-0 items-center justify-center overflow-hidden rounded-full border ${
                compact ? "h-20 w-20" : "h-24 w-24"
              } ${cardData.profile_image_url ? "" : "border-dashed"}`}
              style={cardData.profile_image_url ? { borderColor: divider } : placeholderStyle}
            >
              {cardData.profile_image_url ? (
                <CardMediaImage
                  src={cardData.profile_image_url}
                  alt={displayName(cardData, "Profile")}
                  className="h-full w-full object-cover"
                />
              ) : (
                <UserRound size={compact ? 28 : 34} strokeWidth={1.5} />
              )}
            </div>
          )}
          <h3
            className={`w-full min-w-0 break-words font-semibold leading-tight ${
              compact ? "text-xl" : "text-2xl"
            }`}
            style={{ color: headlineIsExample ? muted : rendererTheme.text }}
          >
            {displayName(cardData)}
          </h3>
          {jobTitle && (
            <p className="mt-2 w-full min-w-0 break-words text-sm" style={{ color: muted }}>
              {jobTitle.value}
            </p>
          )}
          {company && (
            <p
              className="mt-2 w-full min-w-0 break-words text-xs font-medium"
              style={{ color: company.example ? muted : rendererTheme.text }}
            >
              {company.value}
            </p>
          )}
        </header>

        {contentSections.map((section) => (
          <ModernMinimalSection
            key={section.key}
            title={section.title}
            rows={section.rows}
            theme={rendererTheme}
          />
        ))}

        {actionConfig && (
          <TemplateActionList
            compact={compact}
            theme={rendererTheme}
            cardData={cardData}
            mode={mode}
            actionConfig={actionConfig}
            className="mt-7"
            itemClassName="w-full"
            previewActionDestinations={previewActionDestinations}
          />
        )}
      </div>
    </div>
  );
}

function ModernMinimalLayout(props: LayoutProps) {
  const {
    cardData,
    allowedFields,
    templateCustomFields = {},
    fieldConfig,
    mode = "preview",
    sectionSettings = {
      personal: true,
      company: true,
      contact: true,
      social: false,
    },
    compact,
    requiresProfileImage,
    requiresLogo,
    requiresBanner,
    theme,
    actionConfig,
    showMediaPlaceholders = false,
    previewActionDestinations = false,
  } = props;
  const rendererTheme = getRendererTheme(theme);
  const publicMode = mode === "public";
  const previewMode = mode === "preview" || mode === "compact";
  const allowed = new Set(allowedFields);
  const muted = colorAlpha(rendererTheme.text, 0.58);
  const fineBorder = colorAlpha(rendererTheme.text, 0.12);
  const rows = {
    personal: markExampleRows(
      addPublicRowActions(
        classicRows("personal", templateCustomFields, cardData, allowed, previewMode),
        publicMode
      ),
      cardData
    ),
    company: markExampleRows(
      addPublicRowActions(
        classicRows("company", templateCustomFields, cardData, allowed, previewMode),
        publicMode
      ),
      cardData
    ),
    contact: markExampleRows(
      addPublicRowActions(
        classicRows("contact", templateCustomFields, cardData, allowed, previewMode),
        publicMode
      ),
      cardData
    ),
    social: markExampleRows(
      addPublicRowActions(
        classicRows("social", templateCustomFields, cardData, allowed, previewMode)
          .filter((row) => !actionConfig || !row.field || !actionOwnedDetailFields.has(row.field)),
        publicMode
      ),
      cardData
    ),
  };
  const contentSections = rendererContentSections(
    fieldConfig,
    templateCustomFields,
    sectionSettings
  );
  const renderedSections = contentSections
    .map((section) => {
      const sectionRows =
        section.key === "personal"
          ? rows.personal
          : section.key === "company"
          ? rows.company
          : section.key === "contact"
          ? rows.contact
          : section.key === "social"
          ? rows.social
          : markExampleRows(
              addPublicRowActions(
                classicRows(
                  section.key,
                  templateCustomFields,
                  cardData,
                  allowed,
                  previewMode
                ),
                publicMode
              ),
              cardData
            );

      return {
        ...section,
        rows: sectionRows,
      };
    })
    .filter((section) => section.enabled && section.rows.length > 0);
  const headline = displayName(cardData);
  const headlineIsExample = ["title", "first_name", "last_name", "full_name"].some(
    (field) => isRendererExampleField(cardData, field)
  );
  const initialsText = initials(headline);
  const showBanner = requiresBanner && Boolean(cardData.company_banner_url);
  const showBannerPlaceholder =
    requiresBanner && showMediaPlaceholders && !cardData.company_banner_url;
  const showBannerSlot = showBanner || showBannerPlaceholder;
  const showLogoWatermark =
    requiresLogo && (Boolean(cardData.company_logo_url) || showMediaPlaceholders);
  const showProfilePlaceholder =
    requiresProfileImage && showMediaPlaceholders && !cardData.profile_image_url;
  const mediaPlaceholderStyle = adminMediaPlaceholderStyle(rendererTheme.text);

  return (
    <div
      className={`relative min-h-full overflow-visible text-[#101935] ${
        showBannerSlot ? "" : compact ? "p-5 pt-9" : "p-7 pt-12"
      }`}
      style={{
        background: rendererTheme.background,
        color: rendererTheme.text,
        fontFamily: rendererTheme.fontFamily,
      }}
    >
      {showLogoWatermark && (
        <div className="has-[>img[data-media-unavailable]]:hidden pointer-events-none sticky top-1/2 z-0 flex h-0 justify-center overflow-visible">
          {cardData.company_logo_url ? (
            <CardMediaImage
              src={cardData.company_logo_url}
              alt=""
              aria-hidden="true"
              className={`-translate-y-1/2 object-contain opacity-[0.065] ${
                compact ? "h-40 w-40" : "h-64 w-64"
              }`}
            />
          ) : (
            <div
              aria-hidden="true"
              className={`flex -translate-y-1/2 items-center justify-center rounded-[2rem] border border-dashed text-sm font-semibold tracking-[0.28em] ${
                compact ? "h-36 w-36" : "h-56 w-56"
              }`}
              style={mediaPlaceholderStyle}
            >
              Logo
            </div>
          )}
        </div>
      )}

      <div className="relative z-10">
        {showBanner && (
          <CardMediaImage
            src={cardData.company_banner_url || ""}
            alt="Company banner"
            className="w-full object-cover"
            style={{ aspectRatio: `${modernMinimalMediaSlots.banner.aspectRatio} / 1` }}
          />
        )}
        {showBannerPlaceholder && (
          <div
            aria-hidden="true"
            className="flex w-full items-center justify-center border border-dashed text-xs font-semibold uppercase tracking-[0.28em]"
            style={{
              ...mediaPlaceholderStyle,
              aspectRatio: `${modernMinimalMediaSlots.banner.aspectRatio} / 1`,
            }}
          >
            Banner
          </div>
        )}

      <div className={showBannerSlot ? (compact ? "p-5 pt-5" : "p-7 pt-6") : ""}>
      <div className="text-center">
        {requiresProfileImage && (
          <div
            className={`has-[>img[data-media-unavailable]]:hidden mx-auto mb-5 flex shrink-0 items-center justify-center overflow-hidden rounded-full border font-semibold ${
              compact ? "h-20 w-20 text-xl" : "h-28 w-28 text-3xl"
            }`}
            style={
              showProfilePlaceholder
                ? mediaPlaceholderStyle
                : {
                    borderColor: fineBorder,
                    background: colorAlpha(rendererTheme.primary, 0.08),
                    color: rendererTheme.primary,
                  }
            }
          >
            {cardData.profile_image_url ? (
              <CardMediaImage
                src={cardData.profile_image_url}
                alt={headline}
                className="h-full w-full object-cover"
              />
            ) : showProfilePlaceholder ? (
              <UserRound size={compact ? 24 : 32} strokeWidth={1.5} />
            ) : (
              initialsText
            )}
          </div>
        )}

        <div className="min-w-0">
          <h3
            className={`max-w-full break-words font-semibold leading-[1.04] ${
              compact ? "text-xl" : "text-[22px]"
            }`}
            style={{
              color: headlineIsExample ? muted : rendererTheme.text,
              lineHeight: 1.2,
              fontWeight: 700,
            }}
          >
            {headline}
          </h3>
        </div>
      </div>

      {renderedSections.map((section) => (
        <ModernMinimalSection
          key={section.key}
          title={section.key === "personal" ? "Profile" : section.title}
          rows={section.rows}
          theme={rendererTheme}
        />
      ))}

      {actionConfig && (
        <TemplateActionList
          compact={compact}
          theme={{
            ...rendererTheme,
            buttonColor: colorAlpha(rendererTheme.primary, 0.1),
            buttonTextColor: rendererTheme.text,
          }}
          cardData={cardData}
          mode={mode}
          actionConfig={actionConfig}
          className="mt-7"
          itemClassName="!rounded-full !border !border-current/15 !px-4 !py-3 !text-xs !shadow-sm"
          uniformStyle
          previewActionDestinations={previewActionDestinations}
        />
      )}

      <div
        className="mt-8 h-1 w-16 rounded-full"
        style={{ backgroundColor: rendererTheme.primary }}
      />
      </div>
      </div>
    </div>
  );
}

function ModernMinimalSection({
  title,
  rows,
  theme,
}: {
  title: string;
  rows: DisplayRow[];
  theme: RendererTheme;
}) {
  if (rows.length === 0) return null;

  const muted = colorAlpha(theme.text, 0.58);
  const border = colorAlpha(theme.text, 0.12);

  return (
    <section className="mt-7">
      <h4
        className="text-[10px] font-bold uppercase tracking-[0.22em]"
        style={{ color: muted }}
      >
        {title}
      </h4>
      <div className="mt-3 divide-y" style={{ borderColor: border }}>
        {rows.map((row) => {
          const RowTag = row.href ? "a" : "div";

          return (
            <RowTag
              key={`${title}-${row.label}`}
              href={row.href || undefined}
              target={row.href?.startsWith("http") ? "_blank" : undefined}
              rel={row.href?.startsWith("http") ? "noopener noreferrer" : undefined}
              className="grid min-w-0 grid-cols-[92px_minmax(0,1fr)] gap-4 py-3 text-sm"
            >
              <span className="min-w-0 break-words text-xs" style={{ color: muted }}>
                {row.label}
              </span>
              <span
                className="min-w-0 whitespace-pre-wrap break-words font-medium"
                style={{ color: row.example ? muted : theme.text }}
              >
                {row.value}
              </span>
            </RowTag>
          );
        })}
      </div>
    </section>
  );
}

function buildPaidPersonalRows({
  personalRows,
  contactRows,
  cardData,
  allowed,
  previewMode,
}: {
  personalRows: DisplayRow[];
  contactRows: DisplayRow[];
  cardData: CardRendererData;
  allowed: Set<string>;
  previewMode: boolean;
}) {
  const rows = [...personalRows];
  const existingLabels = new Set(rows.map((row) => row.label));
  const paidContactRows = [
    {
      field: "email",
      label: "Email",
      value: toDisplayValue(cardData.email) || (previewMode ? "hello@example.com" : null),
      icon: Mail,
    },
    {
      field: "phone",
      label: "Phone",
      value: toDisplayValue(cardData.phone) || (previewMode ? "+44 7000 000000" : null),
      icon: Phone,
    },
    {
      field: "website",
      label: "Website",
      value:
        displayUrl(toDisplayValue(cardData.website)) ||
        (previewMode ? "www.example.com" : null),
      icon: Globe,
    },
  ];

  paidContactRows.forEach((row) => {
    if (allowed.has(row.field) && row.value && !existingLabels.has(row.label)) {
      rows.push({
        field: row.field,
        label: row.label,
        value: row.value,
        icon:
          row.icon ||
          contactRows.find((contactRow) => contactRow.label === row.label)?.icon,
      });
    }
  });

  return rows;
}

type LayoutProps = {
  cardData: CardRendererData;
  allowedFields: string[];
  requiresProfileImage: boolean;
  requiresLogo: boolean;
  requiresBanner?: boolean;
  logoSize: LogoSize;
  supportsBio: boolean;
  compact: boolean;
  sectionSettings?: SectionSettings;
  templateCustomFields?: CustomFieldMap;
  fieldConfig?: Record<string, unknown> | null;
  mode?: CardRendererMode;
  isPaid?: boolean;
  theme?: RendererTheme;
  actionConfig?: CardActionConfig | null;
  showMediaPlaceholders?: boolean;
  previewActionDestinations?: boolean;
};

function adminMediaPlaceholderStyle(textColour: string): React.CSSProperties {
  return {
    borderColor: colorAlpha(textColour, 0.24),
    color: colorAlpha(textColour, 0.26),
    background: colorAlpha(textColour, 0.035),
  };
}

function CompanyLogoBlock({
  cardData,
  className = "",
}: {
  cardData: CardRendererData;
  className?: string;
}) {
  return (
    <div
      className={`has-[>img[data-media-unavailable]]:hidden ${className} flex h-9 min-w-24 max-w-[180px] items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-white/20 px-3 text-center text-[11px] font-semibold text-white/90 shadow-lg shadow-black/10`}
    >
      {cardData.company_logo_url ? (
        <CardMediaImage
          src={cardData.company_logo_url}
          alt={cardData.company_name || "Company logo"}
          className="max-h-7 max-w-full object-contain"
        />
      ) : (
        <span className="max-w-full truncate">
          {cardData.company_name || "Company Logo"}
        </span>
      )}
    </div>
  );
}

function PremiumCompanyBanner({
  cardData,
  showLogo,
}: {
  cardData: CardRendererData;
  showLogo: boolean;
}) {
  return (
    <div className="has-[>img[data-media-unavailable]]:hidden relative z-0 h-[135px] overflow-hidden rounded-t-[1.75rem] border border-white/10 border-b-white/5 bg-[#080D22] shadow-lg shadow-black/10">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_14%,rgba(172,0,255,0.48),transparent_28%),radial-gradient(circle_at_82%_12%,rgba(99,102,241,0.34),transparent_25%),linear-gradient(135deg,rgba(7,11,26,0.98),rgba(41,11,78,0.96)_48%,rgba(7,11,26,0.98))]" />
      <div className="absolute inset-0 opacity-45 [background-image:radial-gradient(circle,rgba(255,255,255,0.42)_1px,transparent_1.8px)] [background-size:13px_13px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_78%)]" />
      <div className="absolute -left-10 right-[-10%] bottom-[-38px] h-24 rotate-[-6deg] rounded-[50%] border-t-2 border-white/55 bg-[#A000E8]" />
      <div className="absolute left-[-12%] right-[-6%] bottom-[-54px] h-24 rotate-[4deg] rounded-[50%] bg-[#8C00D8]/80" />

      {cardData.company_banner_url && (
        <CardMediaImage
          src={cardData.company_banner_url}
          alt={cardData.company_name || "Company banner"}
          className="absolute inset-0 h-full w-full object-cover opacity-75"
        />
      )}

      <div className="relative z-10 flex h-full flex-col items-center justify-start px-5 pt-7 text-center">
        {showLogo && <PremiumCompanyLogo cardData={cardData} />}
        <p className="mt-3 max-w-full truncate text-base font-bold text-white drop-shadow">
          {cardData.company_name || "Company Name"}
        </p>
      </div>
    </div>
  );
}

function PremiumCompanyLogo({ cardData }: { cardData: CardRendererData }) {
  return (
    <div className="has-[>img[data-media-unavailable]]:hidden flex min-h-9 min-w-20 max-w-[180px] items-center justify-center overflow-hidden px-2 text-center text-xs font-bold text-white drop-shadow">
      {cardData.company_logo_url ? (
        <CardMediaImage
          src={cardData.company_logo_url}
          alt={cardData.company_name || "Company logo"}
          className="max-h-10 max-w-full object-contain"
        />
      ) : (
        <span className="max-w-full truncate text-[#E8C9FF]">
          {cardData.company_name || "Logo"}
        </span>
      )}
    </div>
  );
}

function DmiFooter({ textColour }: { textColour: string }) {
  return (
    <div className="mt-6 text-center" style={{ color: textColour }}>
      <span className="block text-sm font-semibold">DMI Cards</span>
      <span className="mt-1 block text-[11px] font-normal">
        Powered by DevMaster Inc
      </span>
    </div>
  );
}

function TemplateActionList({
  compact,
  theme,
  cardData,
  mode,
  actionConfig,
  className = "",
  itemClassName = "",
  uniformStyle = false,
  classicFreeSaveContactOutline = false,
  previewActionDestinations = false,
}: {
  compact: boolean;
  theme: RendererTheme;
  cardData: CardRendererData;
  mode: CardRendererMode;
  actionConfig: CardActionConfig;
  className?: string;
  itemClassName?: string;
  uniformStyle?: boolean;
  classicFreeSaveContactOutline?: boolean;
  previewActionDestinations?: boolean;
}) {
  const visibleActions = actionConfig.actions.filter((action) => action.visible);

  if (visibleActions.length === 0) return null;

  return (
    <div className={`${className} space-y-2`}>
      {visibleActions.map((action) => (
        <TemplateActionButton
          key={`${action.type}-${action.id}`}
          action={action}
          compact={compact}
          theme={theme}
          cardData={cardData}
          mode={mode}
          className={itemClassName}
          uniformStyle={uniformStyle}
          classicFreeSaveContactOutline={classicFreeSaveContactOutline}
          previewActionDestinations={previewActionDestinations}
        />
      ))}
    </div>
  );
}

function TemplateActionButton({
  action,
  compact,
  theme,
  cardData,
  mode,
  className = "",
  uniformStyle = false,
  classicFreeSaveContactOutline = false,
  previewActionDestinations = false,
}: {
  action: CardActionConfigItem;
  compact: boolean;
  theme: RendererTheme;
  cardData: CardRendererData;
  mode: CardRendererMode;
  className?: string;
  uniformStyle?: boolean;
  classicFreeSaveContactOutline?: boolean;
  previewActionDestinations?: boolean;
}) {
  const label = action.label || defaultLabelForActionType(action.type);
  const href =
    mode === "public" ? resolveCardActionHref(action, cardData) : null;
  const filename =
    action.type === "save_contact" && mode === "public"
      ? vCardFilename(cardData)
      : undefined;
  const incomplete =
    !previewActionDestinations && !actionIsComplete(action, cardData);
  const actionStyle = uniformStyle
    ? uniformActionButtonStyle(theme)
    : actionButtonStyleForType(action.type, theme);
  const outlinedClassicSaveContact =
    classicFreeSaveContactOutline && action.type === "save_contact";
  const resolvedActionStyle = outlinedClassicSaveContact
    ? {
        background: colorAlpha(theme.text, 0.08),
        color: theme.text,
        border: `1px solid ${colorAlpha(theme.text, 0.28)}`,
      }
    : actionStyle;
  const contrastClass =
    "![color:var(--card-action-text)] [&_*]:![color:inherit] [&_svg]:![color:inherit]";
  const buttonClass = `${className} flex min-w-0 items-center justify-between gap-3 rounded-2xl px-4 text-left font-bold transition hover:opacity-90 ${compact ? "py-3 text-xs" : "py-4 text-sm"} ${contrastClass} ${
    incomplete ? "opacity-60" : ""
  }`;
  const buttonStyle = {
    "--card-action-text": resolvedActionStyle.color,
    background: resolvedActionStyle.background,
    border: "border" in resolvedActionStyle ? resolvedActionStyle.border : undefined,
    color: resolvedActionStyle.color,
    fontFamily: theme.fontFamily,
  } as React.CSSProperties;
  const Icon = templateActionIcons[action.type];

  const content = (
    <>
      <span className="flex min-w-0 items-center gap-2">
        <Icon className="h-4 w-4 shrink-0" />
        <span className="truncate">{label}</span>
      </span>
      {incomplete && (
        <span className="shrink-0 text-[10px] font-semibold uppercase opacity-70">
          Set up
        </span>
      )}
    </>
  );

  if (mode === "public" && !href) {
    return null;
  }

  if (compact || mode !== "public") {
    return (
      <button type="button" className={buttonClass} style={buttonStyle}>
        {content}
      </button>
    );
  }

  const resolvedHref = href || "";

  return (
    <a
      href={resolvedHref}
      download={filename}
      target={resolvedHref.startsWith("http") ? "_blank" : undefined}
      rel={resolvedHref.startsWith("http") ? "noopener noreferrer" : undefined}
      className={`block ${buttonClass}`}
      style={buttonStyle}
    >
      {content}
    </a>
  );
}

function actionButtonStyleForType(type: CardActionType, theme: RendererTheme) {
  switch (type) {
    case "whatsapp":
      return { background: "#25D366", color: "#061B0F" };
    case "linkedin":
      return { background: "#0A66C2", color: "#FFFFFF" };
    case "instagram":
      return {
        background:
          "linear-gradient(135deg, #F58529 0%, #DD2A7B 45%, #8134AF 100%)",
        color: "#FFFFFF",
      };
    case "facebook":
      return { background: "#1877F2", color: "#FFFFFF" };
    case "youtube":
      return { background: "#FF0000", color: "#FFFFFF" };
    case "x_twitter":
      return { background: "#111111", color: "#FFFFFF" };
    default:
      return {
        background: theme.buttonColor,
        color: theme.buttonTextColor,
        border: `1px solid ${colorAlpha(theme.text, 0.28)}`,
      };
  }
}

function uniformActionButtonStyle(theme: RendererTheme) {
  return { background: theme.buttonColor, color: theme.buttonTextColor };
}

function isTemplateShelllessPaidLayout(layout: string) {
  return layout === "modern_minimal" || layout === "executive_paid" || layout === "brand_paid";
}

function getRendererTheme(theme?: RendererTheme): RendererTheme {
  const { buttonColor, buttonTextColor } = resolveButtonColours(
    theme?.buttonColor,
    theme?.buttonTextColor
  );

  return {
    primary: theme?.primary || defaultPrimary,
    secondary: theme?.secondary || defaultSecondary,
    background: theme?.background || theme?.primary || defaultPrimary,
    text: theme?.text || defaultText,
    buttonColor,
    buttonTextColor,
    fontFamily: theme?.fontFamily || fontStack("Inter"),
  };
}

function readableTextForBackground(colour: string) {
  const hex = colour.replace("#", "");

  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return defaultText;

  const red = parseInt(hex.slice(0, 2), 16);
  const green = parseInt(hex.slice(2, 4), 16);
  const blue = parseInt(hex.slice(4, 6), 16);
  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;

  return luminance > 0.62 ? "#0F172A" : "#FFFFFF";
}

function resolveButtonColours(
  backgroundColour: string | null | undefined,
  textColour: string | null | undefined
) {
  const buttonColor = sanitizeHexColour(backgroundColour) || defaultButton;
  const buttonTextColor = sanitizeHexColour(textColour) || defaultButtonText;

  if (contrastRatio(buttonColor, buttonTextColor) >= 4.5) {
    return { buttonColor, buttonTextColor };
  }

  return {
    buttonColor,
    buttonTextColor: readableTextForBackground(buttonColor),
  };
}

function sanitizeHexColour(colour: string | null | undefined) {
  const value = colour?.trim() || "";

  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : null;
}

function contrastRatio(firstColour: string, secondColour: string) {
  const firstLuminance = relativeLuminance(firstColour);
  const secondLuminance = relativeLuminance(secondColour);
  const lighter = Math.max(firstLuminance, secondLuminance);
  const darker = Math.min(firstLuminance, secondLuminance);

  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(colour: string) {
  const hex = colour.replace("#", "");
  const channels = [hex.slice(0, 2), hex.slice(2, 4), hex.slice(4, 6)].map(
    (channel) => {
      const value = parseInt(channel, 16) / 255;

      return value <= 0.03928
        ? value / 12.92
        : Math.pow((value + 0.055) / 1.055, 2.4);
    }
  );

  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function colorAlpha(colour: string, alpha: number) {
  const fallback = colour || defaultPrimary;
  const hex = fallback.replace("#", "");

  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    const red = parseInt(hex.slice(0, 2), 16);
    const green = parseInt(hex.slice(2, 4), 16);
    const blue = parseInt(hex.slice(4, 6), 16);

    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
  }

  return fallback;
}

function addPublicRowActions(rows: DisplayRow[], publicMode: boolean): DisplayRow[] {
  if (!publicMode) return rows;

  return rows.map((row) => ({
    ...row,
    href: row.field ? resolveCardFieldHref(row.field, row.value || "") : null,
  }));
}

function rendererContentSections(
  fieldConfig: Record<string, unknown> | null | undefined,
  customFields: CustomFieldMap,
  sectionSettings: SectionSettings
) {
  const configuredSections = readRendererSections(fieldConfig, customFields);
  const configuredKeys = new Set([
    ...Object.keys(classicSectionDefaults),
    ...Object.keys(configuredSections),
  ]);
  const order = readRendererSectionOrder(fieldConfig).filter((key) =>
    configuredKeys.has(key)
  );
  const labels = readRendererSectionLabels(fieldConfig);
  const orderedKeys = [
    ...order,
    ...Object.keys(classicSectionDefaults).filter((key) => !order.includes(key)),
    ...Object.keys(configuredSections).filter((key) => !order.includes(key)),
  ];

  return orderedKeys
    .filter((key, index, all) => all.indexOf(key) === index)
    .map((key) => ({
      key,
      title: cardSectionLabel(key, labels[key] || classicSectionLabels[key]),
      enabled: rendererSectionEnabled(key, fieldConfig, sectionSettings),
    }));
}

function readRendererSections(
  fieldConfig: Record<string, unknown> | null | undefined,
  customFields: CustomFieldMap
): CustomFieldMap {
  const sections = fieldConfig?.sections;

  if (!sections || typeof sections !== "object" || Array.isArray(sections)) {
    return customFields || {};
  }

  return Object.entries(sections).reduce<CustomFieldMap>((mapped, [key, value]) => {
    if (Array.isArray(value)) {
      mapped[key] = value.filter((field): field is string => typeof field === "string");
    }

    return mapped;
  }, {});
}

function readRendererSectionOrder(
  fieldConfig: Record<string, unknown> | null | undefined
) {
  return Array.isArray(fieldConfig?.section_order)
    ? fieldConfig.section_order.filter(
        (key): key is string => typeof key === "string"
      )
    : [];
}

function readRendererSectionLabels(
  fieldConfig: Record<string, unknown> | null | undefined
) {
  const labels = fieldConfig?.section_labels;

  if (!labels || typeof labels !== "object" || Array.isArray(labels)) {
    return {};
  }

  return Object.entries(labels).reduce<Record<string, string>>(
    (mapped, [key, value]) => {
      if (typeof value === "string" && value.trim()) {
        mapped[key] = value.trim();
      }

      return mapped;
    },
    {}
  );
}

function rendererSectionEnabled(
  section: string,
  fieldConfig: Record<string, unknown> | null | undefined,
  sectionSettings: SectionSettings
) {
  if (section in sectionSettings) {
    return sectionSettings[section as keyof SectionSettings];
  }

  const visibility = fieldConfig?.default_visibility;

  if (!visibility || typeof visibility !== "object" || Array.isArray(visibility)) {
    return true;
  }

  return (visibility as Record<string, unknown>)[`section:${section}`] !== false;
}

function classicRows(
  section: ClassicSectionKey,
  customFields: CustomFieldMap,
  cardData: CardRendererData,
  allowed: Set<string>,
  previewMode: boolean
) {
  return orderedClassicFields(section, customFields)
    .filter((field) => allowed.has(field))
    .map((field) => {
      if (isCustomFieldKey(field)) {
        const label = customFieldLabel(field);
        const value = toDisplayValue(
          customFieldValue(section, field, cardData.custom_fields)
        );

        return {
          label,
          value: value || (previewMode ? customPlaceholder(label) : null),
        };
      }

      return builtInRow(field, cardData);
    })
    .filter(hasDisplayValue);
}

function orderedClassicFields(
  section: ClassicSectionKey,
  customFields: CustomFieldMap
) {
  const fields = customFields[section]?.length
    ? customFields[section]
    : classicSectionDefaults[section] || [];
  const fallbackFields = classicSectionDefaults[section] || [];
  const seen = new Set<string>();

  return [...fields, ...fallbackFields]
    .map((field) => normalizeClassicField(section, field))
    .filter((field) => isAllowedSectionField(section, field))
    .filter((field) => {
      const key = field.toLowerCase();

      if (seen.has(key)) return false;

      seen.add(key);
      return true;
    });
}

function normalizeClassicField(section: ClassicSectionKey, field: string) {
  if (
    (classicSectionDefaults[section] || []).includes(field) ||
    isCustomFieldKey(field)
  ) {
    return field;
  }

  return customFieldKey(section, field);
}

function isAllowedSectionField(section: ClassicSectionKey, field: string) {
  if (section === "contact" && field === "website") return false;

  return Boolean(classicSectionDefaults[section]?.includes(field) || isCustomFieldKey(field));
}

function builtInRow(field: string, cardData: CardRendererData): DisplayRow {
  const rows: Record<string, DisplayRow> = {
    title: { field: "title", label: "Title", value: cardFieldValue(cardData, "title", cardData.title) },
    first_name: {
      field: "first_name",
      label: "First Name",
      value: cardFieldValue(cardData, "first_name", cardData.first_name),
    },
    last_name: {
      field: "last_name",
      label: "Last Name",
      value: cardFieldValue(cardData, "last_name", cardData.last_name),
    },
    job_title: {
      field: "job_title",
      label: "Job Title",
      value: cardFieldValue(cardData, "job_title", cardData.job_title),
    },
    department: {
      field: "department",
      label: "Department",
      value: cardFieldValue(cardData, "department", cardData.department),
      icon: Building2,
    },
    bio: { field: "bio", label: "Bio", value: cardFieldValue(cardData, "bio", cardData.bio) },
    company_name: {
      field: "company_name",
      label: "Company Name",
      value: cardFieldValue(cardData, "company_name", cardData.company_name),
      icon: Building2,
    },
    website: {
      field: "website",
      label: "Website",
      value: toDisplayValue(displayUrl(cardFieldValue(cardData, "website", cardData.website))),
      icon: Globe,
    },
    address: {
      field: "address",
      label: "Address",
      value: cardFieldValue(cardData, "address", cardData.address),
      icon: MapPin,
    },
    email: { field: "email", label: "Email", value: cardFieldValue(cardData, "email", cardData.email), icon: Mail },
    phone: { field: "phone", label: "Phone", value: cardFieldValue(cardData, "phone", cardData.phone), icon: Phone },
    whatsapp: {
      field: "whatsapp",
      label: "WhatsApp",
      value: cardFieldValue(cardData, "whatsapp", cardData.whatsapp),
    },
    linkedin: {
      field: "linkedin",
      label: "LinkedIn",
      value: toDisplayValue(displayUrl(cardFieldValue(cardData, "linkedin", cardData.linkedin))),
    },
    instagram: {
      field: "instagram",
      label: "Instagram",
      value: cardFieldValue(cardData, "instagram", cardData.instagram),
    },
    facebook: {
      field: "facebook",
      label: "Facebook",
      value: toDisplayValue(displayUrl(cardFieldValue(cardData, "facebook", cardData.facebook))),
    },
    youtube: {
      field: "youtube",
      label: "YouTube",
      value: toDisplayValue(displayUrl(cardFieldValue(cardData, "youtube", cardData.youtube))),
    },
    booking_link: {
      field: "booking_link",
      label: "Booking",
      value: toDisplayValue(displayUrl(cardFieldValue(cardData, "booking_link", cardData.booking_link))),
      icon: LinkIcon,
    },
    custom_url: {
      field: "custom_url",
      label: "Custom Link",
      value: toDisplayValue(displayUrl(cardFieldValue(cardData, "custom_url", cardData.custom_url))),
      icon: LinkIcon,
    },
  };

  return rows[field] || { label: field.replaceAll("_", " "), value: null };
}

function cardFieldValue(
  cardData: CardRendererData,
  field: string,
  directValue?: string | null
) {
  return (
    toDisplayValue(directValue) ||
    toDisplayValue(customFieldValue("personal", field, cardData.custom_fields))
  );
}

function customFieldKey(section: ClassicSectionKey, label: string) {
  return `custom:${section}:${label}`;
}

function isCustomFieldKey(field: string) {
  return field.startsWith("custom:");
}

function customFieldLabel(field: string) {
  return friendlyLabel(field.split(":").at(-1) || field);
}

function customFieldValue(
  section: ClassicSectionKey,
  field: string,
  values?: CustomFieldValues | null
): unknown {
  if (!values) return "";
  const label = isCustomFieldKey(field) ? customFieldLabel(field) : field;
  const rawLabel = isCustomFieldKey(field) ? field.split(":").at(-1) || field : field;

  const nestedValues = values[section];

  if (nestedValues && typeof nestedValues === "object") {
    const sectionValues = nestedValues as CustomFieldValues;
    const selectedSectionValue =
      values[field] ||
      sectionValues[label] ||
      sectionValues[label.toLowerCase()] ||
      sectionValues[rawLabel] ||
      sectionValues[rawLabel.toLowerCase()] ||
      "";

    if (selectedSectionValue) return selectedSectionValue;
  }

  for (const nestedValue of Object.values(values)) {
    if (!nestedValue || typeof nestedValue !== "object") continue;

    const sectionValues = nestedValue as CustomFieldValues;
    const sectionValue =
      sectionValues[label] ||
      sectionValues[label.toLowerCase()] ||
      sectionValues[rawLabel] ||
      sectionValues[rawLabel.toLowerCase()] ||
      "";

    if (sectionValue) return sectionValue;
  }

  return (
    values[field] ||
    values[label] ||
    values[label.toLowerCase()] ||
    values[rawLabel] ||
    values[rawLabel.toLowerCase()] ||
    values[customFieldKey(section, rawLabel)] ||
    ""
  );
}

function hasDisplayValue(row: DisplayRow) {
  return Boolean(row.value);
}

function customPlaceholder(label: string) {
  return `${label} details`;
}

function friendlyLabel(label: string) {
  return label
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function displayUrl(value?: string | null) {
  if (!value) return "";

  return value.replace(/^https?:\/\//i, "").replace(/\/$/, "");
}

function initials(name?: string | null) {
  if (!name) return "D";

  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function normalizeLogoSize(size?: string | null): LogoSize {
  if (
    size === "compact" ||
    size === "standard" ||
    size === "large" ||
    size === "banner"
  ) {
    return size;
  }

  return "standard";
}

function normalizeLayoutType(
  layout?: string | null,
  accessLevel?: string | null
) {
  if (accessLevel === "free") {
    const freeLayouts = ["classic_free", "profile_free"];

    return layout && freeLayouts.includes(layout) ? layout : "classic_free";
  }

  const paidLayouts = ["modern_minimal", "executive_paid", "brand_paid"];

  if (layout && paidLayouts.includes(layout)) {
    return layout;
  }

  return "modern_minimal";
}

function sanitizeColourPalette(colours?: string[] | null) {
  const palette = (colours || [defaultPrimary])
    .filter((colour): colour is string => typeof colour === "string")
    .map((colour) => colour.trim())
    .filter((colour) => /^#[0-9a-fA-F]{6}$/.test(colour))
    .slice(0, 6);

  return palette.length ? palette : [defaultPrimary];
}

function iconForLabel(label: string): LucideIcon {
  const normalized = label.toLowerCase();

  if (normalized.includes("job") || normalized.includes("role")) return Briefcase;
  if (normalized.includes("department") || normalized.includes("company")) return Building2;
  if (normalized.includes("email")) return Mail;
  if (normalized.includes("phone") || normalized.includes("whatsapp")) return Phone;
  if (normalized.includes("website") || normalized.includes("link")) return Globe;
  if (normalized.includes("address")) return MapPin;

  return LinkIcon;
}

function getTemplateFont(layoutType: string, selectedFont?: string | null) {
  if (selectedFont) return getFontFamily(selectedFont);

  const defaults: Record<string, string> = {
    modern_minimal: "DM Sans",
    executive_paid: "DM Sans",
    brand_paid: "DM Sans",
  };

  return getFontFamily(defaults[layoutType] || "Inter");
}

function getFontFamily(font?: string | null) {
  const normalized = font || "Inter";
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

  return fontStacks[normalized] || fontStacks.Inter;
}

function fontStack(font?: string | null) {
  return getFontFamily(font);
}

export type { CardRendererMode };
