import {
  Briefcase,
  Building2,
  Globe,
  Link as LinkIcon,
  Mail,
  MapPin,
  Phone,
  type LucideIcon,
} from "lucide-react";

type CardRendererMode = "preview" | "public" | "compact";
type LogoSize = "compact" | "standard" | "large" | "banner";
type CustomFieldMap = Partial<Record<ClassicSectionKey, string[]>>;
type CustomFieldValues = Record<
  string,
  string | null | undefined | Record<string, string | null | undefined>
>;
type ClassicSectionKey = "personal" | "company" | "contact" | "social";
type DisplayRow = {
  label: string;
  value?: string | null;
  icon?: LucideIcon;
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
  gradient_enabled?: boolean | null;
  colour_palette?: string[] | null;
  free_colour_palette?: string[] | null;
  allowed_fonts?: string[] | null;
  default_font?: string | null;
  supports_bio?: boolean | null;
  supports_save_contact?: boolean | null;
  allowed_fields?: string[] | null;
  custom_fields?: CustomFieldMap | null;
  show_personal_section?: boolean | null;
  show_company_section?: boolean | null;
  show_contact_section?: boolean | null;
  show_social_section?: boolean | null;
};

export type CardRendererData = {
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
  profile_image_url?: string | null;
  company_logo_url?: string | null;
  company_banner_url?: string | null;
  custom_fields?: CustomFieldValues | null;
};

type CardRendererProps = {
  template: CardRendererTemplate;
  cardData: CardRendererData;
  mode: CardRendererMode;
  showActions?: boolean;
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
const defaultPrimary = "#AC00FF";
const defaultSecondary = "#101935";
const defaultText = "#FFFFFF";
const defaultButton = "#FFFFFF";
const defaultButtonText = "#0F0E38";

type SectionSettings = {
  personal: boolean;
  company: boolean;
  contact: boolean;
  social: boolean;
};

type RendererTheme = {
  primary: string;
  secondary: string;
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

export default function CardRenderer({
  template,
  cardData,
  mode,
}: CardRendererProps) {
  const layout = normalizeLayoutType(template.layout_type, template.access_level);
  const logoSize = normalizeLogoSize(template.logo_size);
  const allowedFields = template.allowed_fields?.length
    ? template.allowed_fields
    : defaultFields;
  const compact = mode === "compact";
  const isPaid = template.access_level === "paid";
  const requiresProfileImage = template.requires_profile_image ?? true;
  const requiresLogo =
    template.access_level === "paid" && (template.requires_logo ?? false);
  const requiresBanner =
    template.access_level === "paid" && (template.requires_banner ?? false);
  const supportsBio = template.supports_bio ?? true;
  const sectionSettings = {
    personal: template.show_personal_section ?? true,
    company: template.show_company_section ?? true,
    contact: template.show_contact_section ?? true,
    social: template.show_social_section ?? false,
  };
  const primary = template.primary_color || defaultPrimary;
  const secondary = template.secondary_color || defaultSecondary;
  const freeColour = sanitizeColourPalette(template.free_colour_palette)[0];
  const text = template.text_color || defaultText;
  const buttonColor = template.button_color || defaultButton;
  const buttonTextColor = template.button_text_color || defaultButtonText;
  const fontFamily = isPaid
    ? getTemplateFont(layout, template.default_font)
    : getFontFamily(template.default_font);
  const theme = {
    primary,
    secondary,
    text,
    buttonColor,
    buttonTextColor,
    fontFamily,
  };
  const shellClass = compact
    ? "min-h-[420px] rounded-3xl p-4"
    : "min-h-[650px] rounded-[2rem] p-6";
  const background =
    template.access_level === "free"
      ? freeColour
      : template.gradient_enabled === false
      ? primary
      : `linear-gradient(135deg, ${primary}, ${secondary})`;

  const content = {
    classic_free: (
      <ClassicLayout
        cardData={cardData}
        allowedFields={allowedFields}
        requiresProfileImage={requiresProfileImage}
        requiresLogo={requiresLogo}
        requiresBanner={requiresBanner}
        logoSize={logoSize}
        supportsBio={supportsBio}
        templateCustomFields={template.custom_fields || {}}
        mode={mode}
        sectionSettings={sectionSettings}
        compact={compact}
        isPaid={isPaid}
      />
    ),
    premium_classic: (
      <ClassicLayout
        cardData={cardData}
        allowedFields={allowedFields}
        requiresProfileImage={requiresProfileImage}
        requiresLogo={requiresLogo}
        requiresBanner={requiresBanner}
        logoSize={logoSize}
        supportsBio={supportsBio}
        templateCustomFields={template.custom_fields || {}}
        mode={mode}
        sectionSettings={sectionSettings}
        compact={compact}
        isPaid
        theme={theme}
      />
    ),
    glassmorphism: (
      <GlassmorphismLayout
        cardData={cardData}
        allowedFields={allowedFields}
        requiresProfileImage={requiresProfileImage}
        requiresLogo={requiresLogo}
        requiresBanner={requiresBanner}
        logoSize={logoSize}
        supportsBio={supportsBio}
        templateCustomFields={template.custom_fields || {}}
        mode={mode}
        sectionSettings={sectionSettings}
        compact={compact}
        isPaid
        theme={theme}
      />
    ),
    banner_card: (
      <BannerCardLayout
        cardData={cardData}
        allowedFields={allowedFields}
        requiresProfileImage={requiresProfileImage}
        requiresLogo={requiresLogo}
        requiresBanner={requiresBanner}
        logoSize={logoSize}
        supportsBio={supportsBio}
        templateCustomFields={template.custom_fields || {}}
        mode={mode}
        sectionSettings={sectionSettings}
        compact={compact}
        isPaid
        theme={theme}
      />
    ),
    split_card: (
      <SplitCardLayout
        cardData={cardData}
        allowedFields={allowedFields}
        requiresProfileImage={requiresProfileImage}
        requiresLogo={requiresLogo}
        requiresBanner={requiresBanner}
        logoSize={logoSize}
        supportsBio={supportsBio}
        templateCustomFields={template.custom_fields || {}}
        mode={mode}
        sectionSettings={sectionSettings}
        compact={compact}
        isPaid
        theme={theme}
      />
    ),
    monogram_card: (
      <MonogramCardLayout
        cardData={cardData}
        allowedFields={allowedFields}
        requiresProfileImage={requiresProfileImage}
        requiresLogo={requiresLogo}
        requiresBanner={requiresBanner}
        logoSize={logoSize}
        supportsBio={supportsBio}
        templateCustomFields={template.custom_fields || {}}
        mode={mode}
        sectionSettings={sectionSettings}
        compact={compact}
        isPaid
        theme={theme}
      />
    ),
    modern: (
      <ModernLayout
        cardData={cardData}
        allowedFields={allowedFields}
        requiresProfileImage={requiresProfileImage}
        requiresLogo={requiresLogo}
        logoSize={logoSize}
        supportsBio={supportsBio}
        compact={compact}
      />
    ),
    centered: (
      <CenteredLayout
        cardData={cardData}
        allowedFields={allowedFields}
        requiresProfileImage={requiresProfileImage}
        requiresLogo={requiresLogo}
        logoSize={logoSize}
        supportsBio={supportsBio}
        compact={compact}
      />
    ),
    split: (
      <SplitLayout
        cardData={cardData}
        allowedFields={allowedFields}
        requiresProfileImage={requiresProfileImage}
        requiresLogo={requiresLogo}
        logoSize={logoSize}
        supportsBio={supportsBio}
        compact={compact}
      />
    ),
    banner: (
      <BannerLayout
        cardData={cardData}
        allowedFields={allowedFields}
        requiresProfileImage={requiresProfileImage}
        requiresLogo={requiresLogo}
        logoSize={logoSize}
        supportsBio={supportsBio}
        compact={compact}
      />
    ),
    compact: (
      <CompactLayout
        cardData={cardData}
        allowedFields={allowedFields}
        requiresProfileImage={requiresProfileImage}
        requiresLogo={requiresLogo}
        logoSize={logoSize}
        supportsBio={supportsBio}
      />
    ),
    minimal: (
      <MinimalLayout
        cardData={cardData}
        allowedFields={allowedFields}
        requiresProfileImage={requiresProfileImage}
        requiresLogo={requiresLogo}
        logoSize={logoSize}
        supportsBio={supportsBio}
        compact={compact}
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
      }}
    >
      {content}

      {compact ? (
        <div
          className="mt-8 w-full rounded-2xl py-4 text-center font-bold transition hover:opacity-90"
          style={{ backgroundColor: buttonColor, color: buttonTextColor }}
        >
          Save Contact
        </div>
      ) : (
        <button
          type="button"
          className="mt-8 w-full rounded-2xl py-4 font-bold transition hover:opacity-90"
          style={{ backgroundColor: buttonColor, color: buttonTextColor }}
        >
          Save Contact
        </button>
      )}

      {template.access_level === "free" && <DmiFooter />}
    </div>
  );
}

function ClassicLayout({
  cardData,
  allowedFields,
  templateCustomFields = {},
  mode = "preview",
  sectionSettings = {
    personal: true,
    company: true,
    contact: true,
    social: false,
  },
  compact,
  requiresLogo,
  requiresBanner,
  isPaid,
}: LayoutProps) {
  const allowed = new Set(allowedFields);
  const previewMode = mode === "preview" || mode === "compact";
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
  const paidPersonalRows = isPaid
    ? buildPaidPersonalRows({
        personalRows,
        contactRows,
        cardData,
        allowed,
        previewMode,
      })
    : personalRows;
  const paidContactRows = isPaid
    ? contactRows.filter(
        (row) => !["Email", "Phone", "Website"].includes(row.label)
      )
    : contactRows;

  const hasPersonalDetails =
    sectionSettings.personal && paidPersonalRows.length > 0;
  const hasCompanyDetails = sectionSettings.company && companyRows.length > 0;
  const hasContactDetails =
    sectionSettings.contact && paidContactRows.length > 0;
  const hasSocialDetails = sectionSettings.social && socialRows.length > 0;
  const profileCircle = (
    <div
      className={`flex ${
        compact ? "h-24 w-24 text-2xl" : "h-32 w-32 text-4xl"
      } shrink-0 items-center justify-center overflow-hidden rounded-full border-4 ${
        isPaid
          ? "border-[#E7D7FF] bg-[#8E38D6] text-white shadow-2xl shadow-[#AC00FF]/30 ring-2 ring-[#AC00FF]/35"
          : "border-white/55 bg-white/20 shadow-2xl shadow-black/25"
      } font-bold`}
    >
      {cardData.profile_image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={cardData.profile_image_url}
          alt={cardData.full_name || "Profile"}
          className="h-full w-full object-cover"
        />
      ) : (
        initials(cardData.full_name)
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
          {profileCircle}
        </div>

        <div className="mt-4 min-w-0 px-2 text-center">
          <h3
            className={`max-w-full break-words text-center font-bold leading-tight ${
              compact ? "text-2xl" : "text-4xl"
            }`}
          >
            {cardData.full_name || "Full Name"}
          </h3>

          {headerJobTitle && (
            <p className="mt-2 max-w-full break-words text-center text-sm font-medium text-white/75">
              {headerJobTitle}
            </p>
          )}
        </div>

        {hasPersonalDetails && (
          <ClassicSection title="Personal Details" rows={paidPersonalRows} premium />
        )}

        {hasCompanyDetails && (
          <ClassicSection title="Company Details" rows={companyRows} premium />
        )}

        {hasContactDetails && (
          <ClassicSection title="Contact" rows={paidContactRows} premium />
        )}

        {hasSocialDetails && (
          <ClassicSection title="Social Links" rows={socialRows} premium />
        )}
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
        {profileCircle}

        <h3
          className={`mt-3 max-w-full break-words text-center font-bold leading-tight ${
            compact ? "text-2xl" : "text-4xl"
          }`}
        >
          {cardData.full_name || "Full Name"}
        </h3>

        {headerJobTitle && (
          <p className="mt-2 max-w-full break-words text-center text-sm font-medium text-white/75">
            {headerJobTitle}
          </p>
        )}
      </div>

      {hasPersonalDetails && (
        <ClassicSection title="Personal Details" rows={paidPersonalRows} premium={isPaid} />
      )}

      {hasCompanyDetails && (
        <ClassicSection title="Company Details" rows={companyRows} premium={isPaid} />
      )}

      {hasContactDetails && (
        <div
          className={`mt-6 max-w-full overflow-hidden rounded-3xl border p-4 text-left shadow-xl shadow-black/10 ${
            isPaid
              ? "border-white/15 bg-[#050816]/55"
              : "border-white/10 bg-[#070B1A]/35"
          }`}
        >
          <h4 className="text-xs font-semibold uppercase tracking-[0.18em] text-white/45">
            Contact
          </h4>
          <div className="mt-4 space-y-3">
            {paidContactRows.map((item) => {
              const Icon = item.icon;

              return (
                <div
                  key={item.label}
                  className={`grid min-w-0 grid-cols-[86px_minmax(0,1fr)] items-center gap-3 rounded-2xl px-3 py-3 text-sm ${
                    isPaid ? "bg-white/[0.07]" : "bg-white/10"
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-2 text-white/45">
                    {Icon && (
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-[#101935] shadow-lg shadow-black/15">
                        <Icon size={14} />
                      </span>
                    )}
                    <span className="truncate text-xs">{item.label}</span>
                  </span>
                  <span className="min-w-0 max-w-full break-words font-medium text-white">
                    {item.value}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {hasSocialDetails && (
        <ClassicSection title="Social Links" rows={socialRows} premium={isPaid} />
      )}
    </div>
  );
}

function ClassicSection({
  title,
  rows,
  premium = false,
  className = "",
}: {
  title: string;
  rows: DisplayRow[];
  premium?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`mt-6 max-w-full overflow-hidden rounded-3xl border p-4 text-left shadow-xl shadow-black/10 ${
        premium
          ? "border-white/15 bg-[#050816]/55"
          : "border-white/10 bg-[#070B1A]/35"
      } ${className}`}
    >
      <h4 className="text-xs font-semibold uppercase tracking-[0.18em] text-white/45">
        {title}
      </h4>
      <ClassicSectionContent rows={rows} className="mt-4" premium={premium} />
    </div>
  );
}

function ClassicSectionContent({
  rows,
  className = "",
  premium = false,
}: {
  rows: DisplayRow[];
  className?: string;
  premium?: boolean;
}) {
  return (
    <div className={`${className} space-y-3`}>
      {rows.map(({ label, value, icon }) => {
        const Icon = icon || iconForLabel(label);

        if (premium) {
          return (
            <div
              key={label}
              className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-3 border-b border-white/10 bg-white/[0.06] px-3 py-3 text-sm last:border-b-0 first:rounded-t-2xl last:rounded-b-2xl"
            >
              <span className="flex min-w-0 items-center gap-3 text-white/52">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#AC00FF]/18 text-[#D78BFF]">
                  <Icon size={15} />
                </span>
                <span className="truncate text-xs">{label}</span>
              </span>
              <span className="min-w-0 max-w-full whitespace-pre-wrap break-words text-right text-sm font-semibold text-white">
                {value}
              </span>
            </div>
          );
        }

        return (
          <div
            key={label}
            className="grid min-w-0 grid-cols-[86px_minmax(0,1fr)] items-center gap-3 rounded-2xl bg-white/10 px-3 py-3 text-sm"
          >
            <span className="min-w-0 max-w-full break-words text-xs text-white/45">
              {label}
            </span>
            <span className="min-w-0 max-w-full whitespace-pre-wrap break-words font-medium text-white">
              {value}
            </span>
          </div>
        );
      })}
    </div>
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

type ImportedTemplateRow = DisplayRow & {
  key: string;
  section: string;
};

function importedTemplateRows(props: LayoutProps): ImportedTemplateRow[] {
  return layoutRows(props).flatMap((section) =>
    section.rows.map((row) => ({
      ...row,
      key: `${section.title}:${row.label}`,
      section: section.title,
    }))
  );
}

function layoutRows({
  cardData,
  allowedFields,
  templateCustomFields = {},
  sectionSettings = {
    personal: true,
    company: true,
    contact: true,
    social: false,
  },
  mode = "preview",
}: LayoutProps) {
  const allowed = new Set(allowedFields);
  const previewMode = mode === "preview" || mode === "compact";
  const sections = [
    ["Personal Details", "personal", sectionSettings.personal],
    ["Company Details", "company", sectionSettings.company],
    ["Contact", "contact", sectionSettings.contact],
    ["Social Links", "social", sectionSettings.social],
  ] as const;

  return sections
    .map(([title, key, enabled]) => ({
      title,
      rows: enabled
        ? classicRows(key, templateCustomFields, cardData, allowed, previewMode)
        : [],
    }))
    .filter((section) => section.rows.length > 0);
}

function GlassmorphismLayout(props: LayoutProps) {
  const rows = importedTemplateRows(props);
  const { cardData, compact, requiresLogo } = props;
  const showCompanyName =
    props.sectionSettings?.company && props.allowedFields.includes("company_name");
  const theme = getRendererTheme(props.theme);
  const cardBackground = cardBackgroundFromTheme(theme);
  const glassTint = colorAlpha(theme.secondary, 0.46);
  const accentBorder = colorAlpha(theme.text, 0.26);
  const mutedText = colorAlpha(theme.text, 0.58);
  const labelText = colorAlpha(theme.text, 0.72);
  const minHeightClass = compact ? "min-h-[420px]" : "min-h-[650px]";

  return (
    <div
      className={`w-full min-w-0 overflow-hidden rounded-[1.7rem] p-0.5 shadow-2xl shadow-black/50 ${minHeightClass}`}
      style={{
        background: cardBackground,
        fontFamily: theme.fontFamily,
      }}
    >
      <div
        className="flex min-h-full flex-col overflow-hidden rounded-[1.55rem] border shadow-inner shadow-white/5 backdrop-blur-xl"
        style={{
          backgroundColor: glassTint,
          borderColor: accentBorder,
          color: theme.text,
        }}
      >
        <div
          className="flex min-w-0 items-center gap-4 border-b px-5 py-5"
          style={{ borderColor: accentBorder }}
        >
          <PaidAvatar cardData={cardData} theme={theme} size={compact ? 56 : 64} />

          <div className="min-w-0 flex-1">
            <h3 className="max-w-full break-words text-xl font-black leading-tight tracking-tight">
              {cardData.full_name || "Full Name"}
            </h3>
            {props.sectionSettings?.personal &&
              props.allowedFields.includes("job_title") && (
                <p
                  className="mt-1 max-w-full break-words text-sm"
                  style={{ color: mutedText }}
                >
                  {cardData.job_title || "Job Title"}
                </p>
              )}
            {!requiresLogo && showCompanyName && (
              <p
                className="mt-2 max-w-full truncate text-[10px] font-semibold uppercase tracking-[0.16em]"
                style={{ color: labelText }}
              >
                {cardData.company_name || "Company Name"}
              </p>
            )}
          </div>
        </div>

        <PaidRowList
          rows={rows}
          theme={theme}
          className="px-5 py-4"
          emptyPanelColor={colorAlpha(theme.secondary, 0.2)}
        />

        {(requiresLogo || showCompanyName) && (
          <div className="flex justify-end px-5 pb-5">
            {requiresLogo ? (
              <PaidLogoMark cardData={cardData} theme={theme} size="large" />
            ) : (
              <span className="max-w-32 truncate text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: labelText }}>
                {cardData.company_name || "Company Name"}
              </span>
            )}
          </div>
        )}

        <TemplateSaveButton compact={compact} theme={theme} className="mx-5 mb-5 mt-auto" />
      </div>
    </div>
  );
}

function BannerCardLayout(props: LayoutProps) {
  const theme = getRendererTheme(props.theme);
  const rows = importedTemplateRows(props);
  const detailRows = rows.filter((row) => row.key !== "Personal Details:Job Title");
  const { cardData, compact, requiresLogo } = props;
  const showCompanyName =
    props.sectionSettings?.company && props.allowedFields.includes("company_name");
  const minHeightClass = compact ? "min-h-[420px]" : "min-h-[650px]";
  const borderColor = colorAlpha(theme.text, 0.22);
  const mutedText = colorAlpha(theme.text, 0.74);
  const softPanel = colorAlpha(theme.text, 0.08);
  const bannerBackground = cardData.company_banner_url
    ? `linear-gradient(180deg, ${colorAlpha(theme.secondary, 0.06)}, ${colorAlpha(theme.secondary, 0.62)}), url(${cardData.company_banner_url}) center/cover no-repeat`
    : cardBackgroundFromTheme(theme);

  return (
    <div
      className={`flex w-full min-w-0 flex-col overflow-hidden rounded-[1.6rem] border shadow-2xl shadow-black/35 ${minHeightClass}`}
      style={{
        background: cardBackgroundFromTheme(theme),
        borderColor,
        color: theme.text,
        fontFamily: theme.fontFamily,
      }}
    >
      <div className={compact ? "relative h-36" : "relative h-48"} style={{ background: bannerBackground }}>
        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(180deg, transparent 30%, ${colorAlpha(theme.secondary, 0.58)})`,
          }}
        />

        {requiresLogo && (
          <div
            className="absolute right-4 top-4 flex max-w-[180px] items-center gap-2 rounded-full border px-3 py-2 backdrop-blur-md"
            style={{
              backgroundColor: colorAlpha(theme.secondary, 0.54),
              borderColor,
              color: theme.text,
            }}
          >
            <PaidLogoMark cardData={cardData} theme={theme} size="small" />
            {showCompanyName && (
              <span className="min-w-0 truncate text-xs font-bold">
                {cardData.company_name || "Company Name"}
              </span>
            )}
          </div>
        )}

        {props.requiresProfileImage && (
          <div className="absolute bottom-0 left-5 translate-y-1/2">
            <PaidAvatar cardData={cardData} theme={theme} size={compact ? 74 : 88} />
          </div>
        )}
      </div>

      <div className={`px-5 ${props.requiresProfileImage ? (compact ? "pt-12" : "pt-14") : "pt-5"}`}>
        <h3 className="max-w-full break-words text-2xl font-black leading-tight">
          {cardData.full_name || "Full Name"}
        </h3>
        {props.sectionSettings?.personal && props.allowedFields.includes("job_title") && (
          <p className="mt-1 max-w-full break-words text-sm font-semibold" style={{ color: mutedText }}>
            {cardData.job_title || "Job Title"}
          </p>
        )}
      </div>

      <PaidRowList rows={detailRows} theme={theme} className="px-5 py-5" emptyPanelColor={softPanel} />

      <TemplateSaveButton compact={compact} theme={theme} className="mx-5 mb-5 mt-auto" />
    </div>
  );
}

function SplitCardLayout(props: LayoutProps) {
  const theme = getRendererTheme(props.theme);
  const rows = importedTemplateRows(props);
  const detailRows = rows.filter(
    (row) =>
      row.key !== "Personal Details:Job Title" &&
      row.key !== "Company Details:Company Name"
  );
  const { cardData, compact, requiresLogo } = props;
  const showCompanyName =
    props.sectionSettings?.company && props.allowedFields.includes("company_name");
  const borderColor = colorAlpha(theme.text, 0.2);
  const mutedText = colorAlpha(theme.text, 0.74);
  const panelColor = colorAlpha(theme.secondary, 0.5);

  return (
    <div
      className={`grid w-full min-w-0 overflow-hidden rounded-[1.6rem] border shadow-2xl shadow-black/35 ${
        compact ? "min-h-[420px] grid-cols-1" : "min-h-[650px] grid-cols-[42%_58%]"
      }`}
      style={{
        background: cardBackgroundFromTheme(theme),
        borderColor,
        color: theme.text,
        fontFamily: theme.fontFamily,
      }}
    >
      <div
        className={`flex min-w-0 flex-col items-center justify-center p-5 text-center ${
          compact ? "min-h-48" : ""
        }`}
        style={{
          backgroundColor: panelColor,
          borderColor,
          borderRightWidth: compact ? 0 : 1,
          borderBottomWidth: compact ? 1 : 0,
        }}
      >
        {props.requiresProfileImage && (
          <PaidAvatar cardData={cardData} theme={theme} size={compact ? 82 : 104} />
        )}
        <h3 className="mt-4 max-w-full break-words text-2xl font-black leading-tight">
          {cardData.full_name || "Full Name"}
        </h3>
        {props.sectionSettings?.personal && props.allowedFields.includes("job_title") && (
          <p className="mt-2 max-w-full break-words text-sm font-semibold" style={{ color: mutedText }}>
            {cardData.job_title || "Job Title"}
          </p>
        )}
      </div>

      <div className="flex min-w-0 flex-col p-5">
        {(requiresLogo || showCompanyName) && (
          <div className="mb-5 flex min-w-0 items-center gap-3">
            {requiresLogo && <PaidLogoMark cardData={cardData} theme={theme} size="large" />}
            {showCompanyName && (
              <span className="min-w-0 max-w-full break-words text-sm font-bold">
                {cardData.company_name || "Company Name"}
              </span>
            )}
          </div>
        )}

        <PaidRowList rows={detailRows} theme={theme} className="flex-1" />

        <TemplateSaveButton compact={compact} theme={theme} className="mt-auto" />
      </div>
    </div>
  );
}

function MonogramCardLayout(props: LayoutProps) {
  const theme = getRendererTheme(props.theme);
  const rows = importedTemplateRows(props);
  const detailRows = rows.filter(
    (row) =>
      row.key !== "Personal Details:Job Title" &&
      row.key !== "Company Details:Company Name"
  );
  const { cardData, compact, requiresLogo } = props;
  const showCompanyName =
    props.sectionSettings?.company && props.allowedFields.includes("company_name");
  const minHeightClass = compact ? "min-h-[420px]" : "min-h-[650px]";
  const borderColor = colorAlpha(theme.text, 0.18);
  const mutedText = colorAlpha(theme.text, 0.76);
  const panelColor = colorAlpha(theme.secondary, 0.44);

  return (
    <div
      className={`flex w-full min-w-0 flex-col overflow-hidden rounded-[1.35rem] border shadow-2xl shadow-black/30 ${minHeightClass}`}
      style={{
        background: cardBackgroundFromTheme(theme),
        borderColor,
        color: theme.text,
        fontFamily: theme.fontFamily,
      }}
    >
      <div className="flex min-w-0 items-center gap-4 border-b p-5" style={{ borderColor, backgroundColor: panelColor }}>
        <div
          className="flex h-[76px] w-[76px] shrink-0 items-center justify-center rounded-2xl border text-3xl font-black tracking-normal"
          style={{
            backgroundColor: colorAlpha(theme.text, 0.12),
            borderColor,
            color: theme.text,
          }}
        >
          {initials(cardData.full_name)}
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="max-w-full break-words text-2xl font-black leading-tight">
            {cardData.full_name || "Full Name"}
          </h3>
          {props.sectionSettings?.personal && props.allowedFields.includes("job_title") && (
            <p className="mt-1 max-w-full break-words text-sm font-semibold" style={{ color: mutedText }}>
              {cardData.job_title || "Job Title"}
            </p>
          )}
          {showCompanyName && (
            <p className="mt-1 max-w-full break-words text-xs font-semibold" style={{ color: mutedText }}>
              {cardData.company_name || "Company Name"}
            </p>
          )}
        </div>

        {requiresLogo && <PaidLogoMark cardData={cardData} theme={theme} size="large" />}
      </div>

      <PaidRowList rows={detailRows} theme={theme} className="px-5 py-5" />

      <TemplateSaveButton compact={compact} theme={theme} className="mx-5 mb-5 mt-auto" />
    </div>
  );
}

function PaidRowList({
  rows,
  theme,
  className = "",
  emptyPanelColor,
}: {
  rows: ImportedTemplateRow[];
  theme: RendererTheme;
  className?: string;
  emptyPanelColor?: string;
}) {
  const line = colorAlpha(theme.text, 0.16);
  const mutedText = colorAlpha(theme.text, 0.74);

  if (rows.length === 0) {
    return (
      <p
        className={`rounded-2xl border p-4 text-sm ${className}`}
        style={{
          backgroundColor: emptyPanelColor || colorAlpha(theme.text, 0.07),
          borderColor: line,
          color: mutedText,
        }}
      >
        Add visible fields to show card details.
      </p>
    );
  }

  return (
    <div className={`min-w-0 ${className}`}>
      <div className="divide-y" style={{ borderColor: line } as React.CSSProperties}>
        {rows.map((row) => {
          const Icon = row.icon || iconForLabel(row.label);

          return (
            <div
              key={row.key}
              className="grid min-w-0 grid-cols-[92px_minmax(0,1fr)] items-start gap-3 py-3 text-sm"
              style={{ borderColor: line }}
            >
              <span className="flex min-w-0 items-center gap-2" style={{ color: theme.text }}>
                <Icon className="h-4 w-4 shrink-0" />
                <span className="min-w-0 truncate text-[10px] font-semibold uppercase tracking-normal">
                  {row.label}
                </span>
              </span>
              <span className="min-w-0 max-w-full whitespace-pre-wrap break-words text-right text-sm font-semibold" style={{ color: theme.text }}>
                {row.value}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PaidAvatar({
  cardData,
  theme,
  size,
}: {
  cardData: CardRendererData;
  theme: RendererTheme;
  size: number;
}) {
  return (
    <div
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-full border-4 text-2xl font-black shadow-xl"
      style={{
        width: size,
        height: size,
        backgroundColor: colorAlpha(theme.text, 0.12),
        borderColor: theme.text,
        color: theme.text,
      }}
    >
      {cardData.profile_image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={cardData.profile_image_url}
          alt={cardData.full_name || "Profile"}
          className="h-full w-full object-cover"
        />
      ) : (
        initials(cardData.full_name)
      )}
    </div>
  );
}

function PaidLogoMark({
  cardData,
  theme,
  size,
}: {
  cardData: CardRendererData;
  theme: RendererTheme;
  size: "small" | "large";
}) {
  const dimension = size === "large" ? 44 : 24;

  return (
    <div
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-lg border text-[10px] font-black"
      style={{
        width: dimension,
        height: dimension,
        backgroundColor: colorAlpha(theme.text, 0.1),
        borderColor: colorAlpha(theme.text, 0.22),
        color: theme.text,
      }}
    >
      {cardData.company_logo_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={cardData.company_logo_url}
          alt={cardData.company_name || "Company logo"}
          className="h-full w-full object-contain p-1"
        />
      ) : (
        initials(cardData.company_name)
      )}
    </div>
  );
}

function ModernLayout({
  cardData,
  allowedFields,
  requiresProfileImage,
  requiresLogo,
  logoSize,
  supportsBio,
  compact,
}: LayoutProps) {
  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <IdentityBlock cardData={cardData} compact={compact} />
        {requiresProfileImage && <ProfileImage cardData={cardData} size="small" />}
      </div>
      {requiresLogo && <LogoBlock cardData={cardData} size={logoSize} />}
      {supportsBio && <BioBlock cardData={cardData} />}
      <FieldGrid cardData={cardData} fields={allowedFields} />
    </>
  );
}

function CenteredLayout({
  cardData,
  allowedFields,
  requiresProfileImage,
  requiresLogo,
  logoSize,
  supportsBio,
  compact,
}: LayoutProps) {
  return (
    <div className="text-center">
      {requiresLogo && <LogoBlock cardData={cardData} size={logoSize} center />}
      {requiresProfileImage && (
        <ProfileImage cardData={cardData} size="large" center />
      )}
      <IdentityBlock cardData={cardData} className="mt-5" compact={compact} />
      {supportsBio && <BioBlock cardData={cardData} />}
      <FieldStack cardData={cardData} fields={allowedFields} center />
    </div>
  );
}

function SplitLayout({
  cardData,
  allowedFields,
  requiresProfileImage,
  requiresLogo,
  logoSize,
  supportsBio,
  compact,
}: LayoutProps) {
  return (
    <>
      {requiresLogo && logoSize === "banner" && (
        <LogoBlock cardData={cardData} size={logoSize} />
      )}
      <div className="grid grid-cols-[110px_1fr] gap-5">
        <div>
          {requiresProfileImage && <ProfileImage cardData={cardData} size="medium" />}
          {requiresLogo && logoSize !== "banner" && (
            <LogoBlock cardData={cardData} size={logoSize} compactColumn />
          )}
        </div>
        <div>
          <IdentityBlock cardData={cardData} compact={compact} />
          {supportsBio && <BioText cardData={cardData} />}
        </div>
      </div>
      <FieldStack cardData={cardData} fields={allowedFields} />
    </>
  );
}

function BannerLayout({
  cardData,
  allowedFields,
  requiresProfileImage,
  requiresLogo,
  logoSize,
  supportsBio,
  compact,
}: LayoutProps) {
  return (
    <>
      <div className="mb-6 flex h-40 items-center justify-center overflow-hidden rounded-3xl bg-white/20">
        {requiresProfileImage && cardData.profile_image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cardData.profile_image_url}
            alt={cardData.full_name || "Profile"}
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="text-xl font-bold">
            {cardData.company_name || "Profile Banner"}
          </span>
        )}
      </div>
      {requiresLogo && <LogoBlock cardData={cardData} size={logoSize} />}
      <IdentityBlock cardData={cardData} compact={compact} />
      {supportsBio && <BioBlock cardData={cardData} />}
      <FieldStack cardData={cardData} fields={allowedFields} />
    </>
  );
}

function CompactLayout({
  cardData,
  allowedFields,
  requiresProfileImage,
  requiresLogo,
  logoSize,
  supportsBio,
}: Omit<LayoutProps, "compact">) {
  return (
    <>
      <div className="flex items-center gap-4">
        {requiresProfileImage && <ProfileImage cardData={cardData} size="small" />}
        <IdentityBlock cardData={cardData} compact />
      </div>
      {requiresLogo && <LogoBlock cardData={cardData} size={logoSize} />}
      {supportsBio && (
        <p className="mt-4 rounded-2xl bg-white/10 p-3 text-xs opacity-90">
          {bioText(cardData)}
        </p>
      )}
      <FieldStack cardData={cardData} fields={allowedFields} compact />
    </>
  );
}

function MinimalLayout({
  cardData,
  allowedFields,
  requiresProfileImage,
  requiresLogo,
  logoSize,
  supportsBio,
  compact,
}: LayoutProps) {
  return (
    <>
      {requiresProfileImage && (
        <div className="mb-6 h-1 w-20 rounded-full bg-white/50" />
      )}
      <IdentityBlock cardData={cardData} compact={compact} minimal />
      {requiresLogo && <LogoBlock cardData={cardData} size={logoSize} />}
      {supportsBio && (
        <p className="mt-6 border-l border-white/30 pl-4 text-sm opacity-85">
          {bioText(cardData)}
        </p>
      )}
      <div className="mt-6 space-y-3">
        {fieldItems(cardData, allowedFields).map((item) => (
          <div key={item.label} className="border-b border-white/20 pb-3 text-sm">
            <span className="block text-xs capitalize opacity-55">{item.label}</span>
            <span className="mt-1 block break-words">{item.value}</span>
          </div>
        ))}
      </div>
    </>
  );
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
  mode?: CardRendererMode;
  isPaid?: boolean;
  theme?: RendererTheme;
};

function IdentityBlock({
  cardData,
  className = "",
  compact = false,
  minimal = false,
}: {
  cardData: CardRendererData;
  className?: string;
  compact?: boolean;
  minimal?: boolean;
}) {
  return (
    <div className={`${className} min-w-0 max-w-full`}>
      <h3
        className={`max-w-full break-words font-bold ${
          compact ? "text-2xl" : "text-3xl"
        } ${
          minimal ? "font-semibold" : ""
        }`}
      >
        {cardData.full_name || "Full Name"}
      </h3>
      <p className="mt-2 max-w-full break-words text-sm opacity-70">
        {[cardData.job_title, cardData.company_name].filter(Boolean).join(" · ") ||
          "Job title · Company"}
      </p>
    </div>
  );
}

function ProfileImage({
  cardData,
  size,
  center = false,
}: {
  cardData: CardRendererData;
  size: "small" | "medium" | "large";
  center?: boolean;
}) {
  const sizeClass =
    size === "large"
      ? "h-32 w-32 text-4xl"
      : size === "medium"
      ? "h-24 w-24 text-3xl"
      : "h-16 w-16 text-xl";

  return (
    <div
      className={`flex ${sizeClass} ${
        center ? "mx-auto" : ""
      } items-center justify-center overflow-hidden rounded-full bg-white/20 font-bold`}
    >
      {cardData.profile_image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={cardData.profile_image_url}
          alt={cardData.full_name || "Profile"}
          className="h-full w-full object-cover"
        />
      ) : (
        initials(cardData.full_name)
      )}
    </div>
  );
}

function LogoBlock({
  cardData,
  size,
  center = false,
  compactColumn = false,
}: {
  cardData: CardRendererData;
  size: LogoSize;
  center?: boolean;
  compactColumn?: boolean;
}) {
  const sizeClass =
    size === "compact"
      ? "inline-flex w-auto min-w-24 items-center justify-center px-4 py-2 text-xs"
      : size === "large"
      ? "flex h-20 w-full max-w-sm items-center justify-center px-5 text-base"
      : size === "banner"
      ? "flex h-16 w-full items-center justify-center rounded-3xl px-5 text-base uppercase tracking-wide"
      : "flex h-14 w-44 items-center justify-center px-4 text-sm";

  return (
    <div
      className={`mt-5 overflow-hidden rounded-2xl bg-white/15 text-center font-semibold text-white/85 ${sizeClass} ${
        center ? "mx-auto" : ""
      } ${compactColumn ? "max-w-full" : ""}`}
    >
      {cardData.company_logo_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={cardData.company_logo_url}
          alt={cardData.company_name || "Company logo"}
          className="max-h-full max-w-full object-contain"
        />
      ) : (
        cardData.company_name || "Company Logo"
      )}
    </div>
  );
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
      className={`${className} flex h-9 min-w-24 max-w-[180px] items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-white/20 px-3 text-center text-[11px] font-semibold text-white/90 shadow-lg shadow-black/10`}
    >
      {cardData.company_logo_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
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
    <div className="relative z-0 h-[135px] overflow-hidden rounded-t-[1.75rem] border border-white/10 border-b-white/5 bg-[#080D22] shadow-lg shadow-black/10">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_14%,rgba(172,0,255,0.48),transparent_28%),radial-gradient(circle_at_82%_12%,rgba(99,102,241,0.34),transparent_25%),linear-gradient(135deg,rgba(7,11,26,0.98),rgba(41,11,78,0.96)_48%,rgba(7,11,26,0.98))]" />
      <div className="absolute inset-0 opacity-45 [background-image:radial-gradient(circle,rgba(255,255,255,0.42)_1px,transparent_1.8px)] [background-size:13px_13px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_78%)]" />
      <div className="absolute -left-10 right-[-10%] bottom-[-38px] h-24 rotate-[-6deg] rounded-[50%] border-t-2 border-white/55 bg-[#A000E8]" />
      <div className="absolute left-[-12%] right-[-6%] bottom-[-54px] h-24 rotate-[4deg] rounded-[50%] bg-[#8C00D8]/80" />

      {cardData.company_banner_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
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
    <div className="flex min-h-9 min-w-20 max-w-[180px] items-center justify-center overflow-hidden px-2 text-center text-xs font-bold text-white drop-shadow">
      {cardData.company_logo_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
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

function BioBlock({ cardData }: { cardData: CardRendererData }) {
  return (
    <p className="mt-5 rounded-2xl bg-white/10 p-4 text-sm opacity-90">
      {bioText(cardData)}
    </p>
  );
}

function BioText({ cardData }: { cardData: CardRendererData }) {
  return <p className="mt-4 text-sm opacity-85">{bioText(cardData)}</p>;
}

function FieldStack({
  cardData,
  fields,
  center = false,
  compact = false,
}: {
  cardData: CardRendererData;
  fields: string[];
  center?: boolean;
  compact?: boolean;
}) {
  return (
    <div className={`mt-6 min-w-0 space-y-3 ${center ? "text-center" : ""}`}>
      {fieldItems(cardData, fields).map((item) => (
        <FieldBlock key={item.label} label={item.label} value={item.value} compact={compact} />
      ))}
    </div>
  );
}

function FieldGrid({
  cardData,
  fields,
}: {
  cardData: CardRendererData;
  fields: string[];
}) {
  return (
    <div className="mt-6 grid min-w-0 grid-cols-2 gap-3">
      {fieldItems(cardData, fields).map((item) => (
        <FieldBlock key={item.label} label={item.label} value={item.value} center />
      ))}
    </div>
  );
}

function FieldBlock({
  label,
  value,
  center = false,
  compact = false,
}: {
  label: string;
  value: string;
  center?: boolean;
  compact?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl bg-white/10 ${
        compact ? "p-3 text-xs" : "p-4 text-sm"
      } ${center ? "text-center" : ""}`}
    >
      <span className="block text-xs capitalize opacity-55">{label}</span>
      <span className="mt-1 block min-w-0 max-w-full break-words">
        {value}
      </span>
    </div>
  );
}

function DmiFooter() {
  return (
    <a
      href="https://www.devmasterinc.com"
      target="_blank"
      rel="noopener noreferrer"
      className="mt-6 block text-center text-[11px] text-white/45 transition hover:text-white/75"
    >
      Powered by DMI Cards
      <br />
      by DevMaster Inc
    </a>
  );
}

function TemplateSaveButton({
  compact,
  theme,
  className = "",
}: {
  compact: boolean;
  theme: RendererTheme;
  className?: string;
}) {
  const buttonClass = `${className} w-auto rounded-2xl py-4 text-center font-bold transition hover:opacity-90`;
  const buttonStyle = {
    backgroundColor: theme.buttonColor,
    color: theme.buttonTextColor,
    fontFamily: theme.fontFamily,
  };

  if (compact) {
    return (
      <div className={buttonClass} style={buttonStyle}>
        Save Contact
      </div>
    );
  }

  return (
    <button type="button" className={buttonClass} style={buttonStyle}>
      Save Contact
    </button>
  );
}

function isTemplateShelllessPaidLayout(layout: string) {
  return (
    layout === "glassmorphism" ||
    layout === "banner_card" ||
    layout === "split_card" ||
    layout === "monogram_card"
  );
}

function getRendererTheme(theme?: RendererTheme): RendererTheme {
  return {
    primary: theme?.primary || defaultPrimary,
    secondary: theme?.secondary || defaultSecondary,
    text: theme?.text || defaultText,
    buttonColor: theme?.buttonColor || defaultButton,
    buttonTextColor: theme?.buttonTextColor || defaultButtonText,
    fontFamily: theme?.fontFamily || fontStack("Inter"),
  };
}

function cardBackgroundFromTheme(theme: RendererTheme) {
  return theme.primary.toLowerCase() === theme.secondary.toLowerCase()
    ? theme.primary
    : `linear-gradient(135deg, ${theme.primary}, ${theme.secondary})`;
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

function fieldItems(cardData: CardRendererData, fields: string[]) {
  const values: Record<string, string | null | undefined> = {
    company_name: cardData.company_name,
    department: cardData.department,
    bio: cardData.bio,
    phone: cardData.phone,
    email: cardData.email,
    website: displayUrl(cardData.website),
    address: cardData.address,
    whatsapp: cardData.whatsapp,
    linkedin: displayUrl(cardData.linkedin),
    instagram: cardData.instagram,
    facebook: displayUrl(cardData.facebook),
    youtube: displayUrl(cardData.youtube),
    booking_link: displayUrl(cardData.booking_link),
    custom_url: displayUrl(cardData.custom_url),
  };

  return fields
    .map((field) => ({
      label: field.replace("_", " "),
      value: values[field] || "",
    }))
    .filter((item) => item.value);
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
          customFieldValue(section, label, cardData.custom_fields)
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
    : classicSectionDefaults[section];
  const fallbackFields = classicSectionDefaults[section];
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
  if (classicSectionDefaults[section].includes(field) || isCustomFieldKey(field)) {
    return field;
  }

  return customFieldKey(section, field);
}

function isAllowedSectionField(section: ClassicSectionKey, field: string) {
  return !(section === "contact" && field === "website");
}

function builtInRow(field: string, cardData: CardRendererData): DisplayRow {
  const rows: Record<string, DisplayRow> = {
    job_title: { label: "Job Title", value: toDisplayValue(cardData.job_title) },
    department: {
      label: "Department",
      value: toDisplayValue(cardData.department),
      icon: Building2,
    },
    bio: { label: "Bio", value: toDisplayValue(cardData.bio) },
    company_name: {
      label: "Company Name",
      value: toDisplayValue(cardData.company_name),
      icon: Building2,
    },
    website: {
      label: "Website",
      value: toDisplayValue(displayUrl(cardData.website)),
      icon: Globe,
    },
    address: { label: "Address", value: toDisplayValue(cardData.address), icon: MapPin },
    email: { label: "Email", value: toDisplayValue(cardData.email), icon: Mail },
    phone: { label: "Phone", value: toDisplayValue(cardData.phone), icon: Phone },
    whatsapp: { label: "WhatsApp", value: toDisplayValue(cardData.whatsapp) },
    linkedin: {
      label: "LinkedIn",
      value: toDisplayValue(displayUrl(cardData.linkedin)),
    },
    instagram: { label: "Instagram", value: toDisplayValue(cardData.instagram) },
    facebook: {
      label: "Facebook",
      value: toDisplayValue(displayUrl(cardData.facebook)),
    },
    youtube: {
      label: "YouTube",
      value: toDisplayValue(displayUrl(cardData.youtube)),
    },
    booking_link: {
      label: "Booking",
      value: toDisplayValue(displayUrl(cardData.booking_link)),
      icon: LinkIcon,
    },
    custom_url: {
      label: "Custom Link",
      value: toDisplayValue(displayUrl(cardData.custom_url)),
      icon: LinkIcon,
    },
  };

  return rows[field] || { label: field.replaceAll("_", " "), value: null };
}

function customFieldKey(section: ClassicSectionKey, label: string) {
  return `custom:${section}:${label}`;
}

function isCustomFieldKey(field: string) {
  return field.startsWith("custom:");
}

function customFieldLabel(field: string) {
  return field.split(":").at(-1) || field;
}

function customFieldValue(
  section: ClassicSectionKey,
  label: string,
  values?: CustomFieldValues | null
): unknown {
  if (!values) return "";

  const nestedValues = values[section];

  if (nestedValues && typeof nestedValues === "object") {
    const sectionValues = nestedValues as CustomFieldValues;
    return sectionValues[label] || sectionValues[label.toLowerCase()] || "";
  }

  return (
    values[label] ||
    values[label.toLowerCase()] ||
    values[customFieldKey(section, label)] ||
    ""
  );
}

function hasDisplayValue(row: DisplayRow) {
  return Boolean(row.value);
}

function customPlaceholder(label: string) {
  return `${label} details`;
}

function displayUrl(value?: string | null) {
  if (!value) return "";

  return value.replace(/^https?:\/\//i, "").replace(/\/$/, "");
}

function bioText(cardData: CardRendererData) {
  if (cardData.job_title && cardData.company_name) {
    return `${cardData.job_title} at ${cardData.company_name}.`;
  }

  if (cardData.company_name) {
    return `Connect with ${cardData.full_name || "this contact"} at ${
      cardData.company_name
    }.`;
  }

  return "Digital business card with contact details and social links.";
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
  if (accessLevel === "free") return "classic_free";

  const paidLayouts = [
    "premium_classic",
    "glassmorphism",
    "banner_card",
    "split_card",
    "monogram_card",
  ];

  if (layout && paidLayouts.includes(layout)) {
    return layout;
  }

  return "premium_classic";
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
    glassmorphism: "Outfit",
    banner_card: "Inter",
    split_card: "Poppins",
    monogram_card: "Playfair Display",
  };

  return getFontFamily(defaults[layoutType] || "Inter");
}

function getFontFamily(font?: string | null) {
  const normalized = font || "Inter";
  const fontStacks: Record<string, string> = {
    Inter:
      '"Inter", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    Poppins:
      '"Poppins", "Avenir Next", "Trebuchet MS", ui-sans-serif, system-ui, sans-serif',
    Montserrat:
      '"Montserrat", "Avenir Next", "Trebuchet MS", ui-sans-serif, system-ui, sans-serif',
    Lato: '"Lato", Arial, Helvetica, ui-sans-serif, system-ui, sans-serif',
    Roboto: '"Roboto", Arial, Helvetica, ui-sans-serif, system-ui, sans-serif',
    "Playfair Display": '"Playfair Display", Georgia, Cambria, "Times New Roman", serif',
    "DM Sans":
      '"DM Sans", "Avenir Next", ui-sans-serif, system-ui, -apple-system, sans-serif',
    Outfit:
      '"Outfit", "Avenir Next", "Trebuchet MS", ui-sans-serif, system-ui, sans-serif',
    Nunito: '"Nunito", "Trebuchet MS", Verdana, ui-sans-serif, system-ui, sans-serif',
    "Space Mono":
      '"Space Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    Syne: '"Syne", "Arial Black", Impact, ui-sans-serif, system-ui, sans-serif',
  };

  return fontStacks[normalized] || fontStacks.Inter;
}

function fontStack(font?: string | null) {
  return getFontFamily(font);
}

export type { CardRendererMode };
