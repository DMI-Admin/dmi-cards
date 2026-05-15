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
    executive_minimal: (
      <ExecutiveMinimalLayout
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
    corporate_pro: (
      <CorporateProLayout
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
    neon_tech: (
      <NeonTechLayout
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
      />
    ),
    creator_mode: (
      <CreatorModeLayout
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
      />
    ),
    obsidian_dark: (
      <ObsidianDarkLayout
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
    soft_pastel: (
      <SoftPastelLayout
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
    neon_noir: (
      <NeonNoirLayout
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
    luxury_vertical: (
      <LuxuryVerticalLayout
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
    gradient_mesh: (
      <GradientMeshLayout
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
    pack_obsidian: (
      <PackObsidianLayout
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
    editorial_serif: (
      <PackEditorialLayout
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
    colourblock_split: (
      <PackColourblockLayout
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
    pack_neon_noir: (
      <PackNeonNoirLayout
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
    pack_luxury_vertical: (
      <PackLuxuryLayout
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
    blueprint_technical: (
      <PackBlueprintLayout
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

function ExecutiveMinimalLayout(props: LayoutProps) {
  const rows = layoutRows(props);

  return (
    <div className="min-w-0 text-left">
      <div className="rounded-[1.6rem] border border-white/12 bg-black/20 p-5">
        {props.requiresLogo && (
          <CompanyLogoBlock cardData={props.cardData} className="mb-5" />
        )}
        <div className="flex items-center gap-4">
          {props.requiresProfileImage && (
            <ProfileImage cardData={props.cardData} size="medium" />
          )}
          <div className="min-w-0">
            <h3 className="break-words text-3xl font-semibold">
              {props.cardData.full_name || "Full Name"}
            </h3>
            <p className="mt-1 break-words text-sm text-white/62">
              {props.cardData.job_title || "Job Title"}
            </p>
          </div>
        </div>
      </div>

      <PlaceholderSections rows={rows} tone="minimal" />
    </div>
  );
}

function CorporateProLayout(props: LayoutProps) {
  const rows = layoutRows(props);

  return (
    <div className="min-w-0 text-center">
      <div className="rounded-[1.6rem] border border-white/12 bg-white/[0.08] p-5 shadow-xl shadow-black/10">
        {props.requiresLogo && (
          <CompanyLogoBlock cardData={props.cardData} className="mx-auto mb-4" />
        )}
        {props.requiresProfileImage && (
          <ProfileImage cardData={props.cardData} size="large" center />
        )}
        <h3 className="mt-4 break-words text-3xl font-bold">
          {props.cardData.full_name || "Full Name"}
        </h3>
        <p className="mt-1 break-words text-sm text-white/68">
          {props.cardData.job_title || "Job Title"}
        </p>
        <p className="mt-2 break-words text-xs uppercase tracking-[0.18em] text-white/42">
          {props.cardData.company_name || "Company Name"}
        </p>
      </div>

      <PlaceholderSections rows={rows} tone="corporate" />
    </div>
  );
}

function NeonTechLayout(props: LayoutProps) {
  const rows = layoutRows(props);

  return (
    <div className="min-w-0 text-left">
      <div className="relative overflow-hidden rounded-[1.6rem] border border-[#AC00FF]/40 bg-[#050816]/65 p-5 shadow-2xl shadow-[#AC00FF]/15">
        <div className="absolute inset-0 opacity-35 [background-image:linear-gradient(90deg,rgba(172,0,255,0.22)_1px,transparent_1px),linear-gradient(rgba(172,0,255,0.18)_1px,transparent_1px)] [background-size:18px_18px]" />
        <div className="relative z-10 flex items-center gap-4">
          {props.requiresProfileImage && (
            <ProfileImage cardData={props.cardData} size="medium" />
          )}
          <div className="min-w-0">
            {props.requiresLogo && (
              <CompanyLogoBlock cardData={props.cardData} className="mb-3" />
            )}
            <h3 className="break-words text-3xl font-bold text-white">
              {props.cardData.full_name || "Full Name"}
            </h3>
            <p className="mt-1 break-words text-sm text-[#E8C9FF]">
              {props.cardData.job_title || "Job Title"}
            </p>
          </div>
        </div>
      </div>

      <PlaceholderSections rows={rows} tone="neon" />
    </div>
  );
}

function CreatorModeLayout(props: LayoutProps) {
  const rows = layoutRows(props);

  return (
    <div className="min-w-0 text-center">
      <div className="rounded-[1.6rem] border border-white/12 bg-white/[0.09] p-5">
        {props.requiresBanner && (
          <div className="mb-4 rounded-3xl bg-white/12 px-4 py-5">
            {props.requiresLogo && (
              <CompanyLogoBlock cardData={props.cardData} className="mx-auto" />
            )}
          </div>
        )}
        {props.requiresProfileImage && (
          <ProfileImage cardData={props.cardData} size="large" center />
        )}
        <h3 className="mt-4 break-words text-3xl font-extrabold">
          {props.cardData.full_name || "Full Name"}
        </h3>
        <p className="mt-2 break-words text-sm text-white/70">
          {props.cardData.bio || props.cardData.job_title || "Creator bio"}
        </p>
      </div>

      <PlaceholderSections rows={rows} tone="creator" />
    </div>
  );
}

function ObsidianDarkLayout(props: LayoutProps) {
  const rows = importedTemplateRows(props);
  const { cardData, compact, requiresLogo } = props;
  const theme = getRendererTheme(props.theme);
  const cardBackground = cardBackgroundFromTheme(theme);
  const sectionBackground = colorAlpha(theme.secondary, 0.38);
  const subtleLine = colorAlpha(theme.text, 0.26);
  const mutedText = colorAlpha(theme.text, 0.68);
  const valueText = colorAlpha(theme.text, 0.86);
  const minHeightClass = compact ? "min-h-[420px]" : "min-h-[650px]";

  return (
    <div
      className={`flex w-full min-w-0 flex-col overflow-hidden rounded-[1.55rem] border shadow-2xl shadow-black/50 ${minHeightClass}`}
      style={{
        background: cardBackground,
        borderColor: subtleLine,
        color: theme.text,
        fontFamily: theme.fontFamily,
      }}
    >
      <div
        className="flex min-w-0 items-center gap-4 border-b px-5 py-5"
        style={{
          backgroundColor: sectionBackground,
          borderColor: subtleLine,
        }}
      >
        <ImportedAvatar
          cardData={cardData}
          className="bg-black/20"
          style={{ borderColor: theme.text, color: theme.text }}
          size={compact ? "medium" : "large"}
        />

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
        </div>

        {requiresLogo && <ImportedLogo cardData={cardData} dark textColor={theme.text} />}
      </div>

      <div className="px-5 py-4">
        {rows.length > 0 ? (
          <div
            className="divide-y"
            style={{ borderColor: subtleLine } as React.CSSProperties}
          >
            {rows.map((row) => (
              <ImportedSplitRow
                key={row.key}
                row={row}
                labelStyle={{ color: theme.text }}
                valueStyle={{ color: valueText }}
              />
            ))}
          </div>
        ) : (
          <p
            className="rounded-2xl border p-4 text-sm"
            style={{
              backgroundColor: sectionBackground,
              borderColor: subtleLine,
              color: mutedText,
            }}
          >
            Add visible fields to show card details.
          </p>
        )}
      </div>

      <TemplateSaveButton compact={compact} theme={theme} className="mx-5 mb-5 mt-auto" />
    </div>
  );
}

function GlassmorphismLayout(props: LayoutProps) {
  const rows = importedTemplateRows(props);
  const { cardData, compact, requiresLogo } = props;
  const theme = getRendererTheme(props.theme);
  const cardBackground = cardBackgroundFromTheme(theme);
  const glassTint = colorAlpha(theme.secondary, 0.46);
  const accentBorder = colorAlpha(theme.text, 0.26);
  const mutedText = colorAlpha(theme.text, 0.58);
  const labelText = colorAlpha(theme.text, 0.72);
  const valueText = colorAlpha(theme.text, 0.82);
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
          <ImportedAvatar
            cardData={cardData}
            className="bg-white/10"
            style={{ borderColor: theme.text, color: theme.text }}
            size={compact ? "medium" : "large"}
          />

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
            {!requiresLogo && cardData.company_name && (
              <p
                className="mt-2 max-w-full truncate text-[10px] font-semibold uppercase tracking-[0.16em]"
                style={{ color: labelText }}
              >
                {cardData.company_name}
              </p>
            )}
          </div>
        </div>

        <div className="px-5 py-4">
          {rows.length > 0 ? (
            <div className="divide-y" style={{ borderColor: accentBorder } as React.CSSProperties}>
              {rows.map((row) => (
              <ImportedSplitRow
                  key={row.key}
                  row={row}
                  labelStyle={{ color: labelText }}
                  valueStyle={{ color: valueText }}
                />
              ))}
            </div>
          ) : (
            <p
              className="rounded-2xl border p-4 text-sm"
              style={{
                backgroundColor: colorAlpha(theme.secondary, 0.2),
                borderColor: accentBorder,
                color: mutedText,
              }}
            >
              Add visible fields to show card details.
            </p>
          )}
        </div>

        {(requiresLogo || cardData.company_name) && (
          <div className="flex justify-end px-5 pb-5">
            <ImportedLogo cardData={cardData} dark muted textColor={theme.text} />
          </div>
        )}

        <TemplateSaveButton compact={compact} theme={theme} className="mx-5 mb-5 mt-auto" />
      </div>
    </div>
  );
}

function SoftPastelLayout(props: LayoutProps) {
  const rows = importedTemplateRows(props);
  const { cardData, compact, requiresLogo } = props;
  const theme = getRendererTheme(props.theme);
  const cardBackground = cardBackgroundFromTheme(theme);
  const chipBackground = colorAlpha(theme.secondary, 0.3);
  const softBorder = colorAlpha(theme.text, 0.22);
  const mutedText = colorAlpha(theme.text, 0.82);
  const minHeightClass = compact ? "min-h-[420px]" : "min-h-[650px]";

  return (
    <div
      className={`flex w-full min-w-0 flex-col rounded-[1.8rem] border p-5 shadow-[0_0_0_8px_rgba(245,240,252,0.75),0_30px_60px_rgba(150,100,200,0.16)] ${minHeightClass}`}
      style={{
        background: cardBackground,
        borderColor: softBorder,
        color: theme.text,
        fontFamily: theme.fontFamily,
      }}
    >
      <div className="flex min-w-0 items-center gap-4">
        <ImportedAvatar
          cardData={cardData}
          className="border-transparent text-white"
          style={{
            background: colorAlpha(theme.text, 0.16),
            color: theme.text,
          }}
          size={compact ? "medium" : "large"}
        />

        <div className="min-w-0 flex-1">
          <h3 className="max-w-full break-words text-xl font-extrabold leading-tight">
            {cardData.full_name || "Full Name"}
          </h3>
          {props.sectionSettings?.personal &&
            props.allowedFields.includes("job_title") && (
              <p
                className="mt-1 max-w-full break-words text-sm font-semibold"
                style={{ color: mutedText }}
              >
                {cardData.job_title || "Job Title"}
              </p>
            )}
        </div>
      </div>

      {(requiresLogo || cardData.company_name) && (
        <div className="mt-4 flex min-w-0 items-center gap-2">
          {requiresLogo && cardData.company_logo_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={cardData.company_logo_url}
              alt={cardData.company_name || "Company logo"}
              className="max-h-7 max-w-20 shrink-0 object-contain"
            />
          )}
          <p
            className="min-w-0 max-w-full truncate text-[11px] font-extrabold uppercase tracking-[0.16em]"
            style={{ color: theme.text }}
          >
            {cardData.company_name || "Company Name"}
          </p>
        </div>
      )}

      {rows.length > 0 ? (
        <div className="mt-5 flex flex-wrap gap-2">
          {rows.map((row) => {
            const Icon = row.icon || iconForLabel(row.label);

            return (
              <div
                key={row.key}
                className="inline-flex max-w-full items-center gap-2 rounded-full px-3 py-2 text-sm font-bold"
                style={{ backgroundColor: chipBackground, color: mutedText }}
              >
                <Icon
                  className="h-4 w-4 shrink-0"
                  style={{ color: theme.text }}
                />
                <span className="min-w-0 max-w-full break-words">
                  {row.value}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <p
          className="mt-5 rounded-2xl p-4 text-sm font-semibold"
          style={{ backgroundColor: chipBackground, color: theme.text }}
        >
          Add visible fields to show card details.
        </p>
      )}

      <TemplateSaveButton compact={compact} theme={theme} className="mt-auto" />
    </div>
  );
}

function NeonNoirLayout(props: LayoutProps) {
  const rows = importedTemplateRows(props);
  const { cardData, compact, requiresLogo } = props;
  const theme = getRendererTheme(props.theme);
  const cardBackground = cardBackgroundFromTheme(theme);
  const detailRows = rows.filter((row) => row.key !== "job_title");
  const lineColour = colorAlpha(theme.text, 0.36);
  const softLine = colorAlpha(theme.text, 0.16);
  const mutedText = colorAlpha(theme.text, 0.7);
  const panelTint = colorAlpha(theme.secondary, 0.38);
  const gridLine = colorAlpha(theme.text, 0.08);
  const glow = colorAlpha(theme.text, 0.26);
  const minHeightClass = compact ? "min-h-[420px]" : "min-h-[650px]";

  return (
    <div
      className={`relative flex w-full min-w-0 flex-col overflow-hidden rounded-2xl border ${minHeightClass}`}
      style={{
        background: cardBackground,
        borderColor: lineColour,
        color: theme.text,
        fontFamily: theme.fontFamily,
        boxShadow: `0 0 0 1px ${softLine}, 0 0 42px ${glow}, 0 34px 76px rgba(0,0,0,0.58)`,
      }}
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: `linear-gradient(${gridLine} 1px, transparent 1px), linear-gradient(90deg, ${gridLine} 1px, transparent 1px), radial-gradient(circle at 15% 10%, ${colorAlpha(theme.text, 0.16)}, transparent 32%), radial-gradient(circle at 88% 12%, ${colorAlpha(theme.text, 0.12)}, transparent 30%)`,
          backgroundSize: "24px 24px, 24px 24px, 100% 100%, 100% 100%",
        }}
      />
      <div
        className="relative h-[3px]"
        style={{
          background: `linear-gradient(90deg, ${theme.text}, ${colorAlpha(theme.text, 0.2)}, ${theme.text})`,
          boxShadow: `0 0 18px ${colorAlpha(theme.text, 0.54)}`,
        }}
      />

      <div className="relative z-10 flex flex-1 flex-col p-5 sm:p-6">
        <div className="mb-5 flex min-w-0 items-center gap-4">
          <div className="relative shrink-0">
            <ImportedAvatar
              cardData={cardData}
              className="rounded-[10px] bg-black/20"
              style={{
                borderColor: lineColour,
                color: theme.text,
                borderRadius: "10px",
                borderStyle: "dashed",
                boxShadow: `0 0 24px ${glow}`,
              }}
              size={compact ? "medium" : "large"}
            />
          </div>

          <div className="min-w-0 flex-1">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.24em]" style={{ color: mutedText }}>
              {`// identity`}
            </p>
            <h3 className="max-w-full break-words text-xl font-black leading-tight tracking-tight">
              {cardData.full_name || "Full Name"}
            </h3>
            {props.sectionSettings?.personal &&
              props.allowedFields.includes("job_title") && (
                <p className="mt-1 max-w-full break-words text-xs font-semibold uppercase tracking-[0.16em]" style={{ color: mutedText }}>
                  {cardData.job_title || "Job Title"}
                </p>
              )}
          </div>

          {requiresLogo && (
            <div
              className="flex h-9 w-[76px] shrink-0 items-center justify-center rounded-lg border px-2 text-[9px] font-bold uppercase tracking-[0.16em]"
              style={{
                backgroundColor: colorAlpha(theme.secondary, 0.32),
                borderColor: lineColour,
                borderStyle: cardData.company_logo_url ? "solid" : "dashed",
                color: theme.text,
              }}
            >
              {cardData.company_logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={cardData.company_logo_url}
                  alt={cardData.company_name || "Company logo"}
                  className="max-h-6 max-w-full object-contain"
                />
              ) : (
                "Logo"
              )}
            </div>
          )}
        </div>

        <div className="h-px" style={{ background: `linear-gradient(90deg, ${lineColour}, transparent)` }} />

        {detailRows.length > 0 ? (
          <div className="mt-4 space-y-2">
            {detailRows.map((row) => (
              <div
                key={row.key}
                className="grid min-w-0 grid-cols-[76px_minmax(0,1fr)] items-center gap-3 border-b py-2.5 text-sm last:border-b-0"
                style={{ borderColor: softLine }}
              >
                <span className="truncate text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: theme.text }}>
                  {row.label.toLowerCase()}_
                </span>
                <span className="min-w-0 break-words text-xs font-semibold leading-relaxed" style={{ color: mutedText }}>
                  {row.value}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-4 rounded-2xl border p-4 text-sm" style={{ backgroundColor: panelTint, borderColor: lineColour, color: mutedText }}>
            Add visible fields to show card details.
          </p>
        )}

        <div className="mt-5 h-px" style={{ background: `linear-gradient(90deg, transparent, ${lineColour}, transparent)` }} />
      </div>

      <TemplateSaveButton compact={compact} theme={theme} className="mx-5 mb-5 mt-auto" />
    </div>
  );
}

function LuxuryVerticalLayout(props: LayoutProps) {
  const rows = importedTemplateRows(props);
  const { cardData, compact, requiresLogo } = props;
  const theme = getRendererTheme(props.theme);
  const cardBackground = cardBackgroundFromTheme(theme);
  const detailRows = rows.filter((row) => row.key !== "job_title");
  const lineColour = colorAlpha(theme.text, 0.38);
  const softLine = colorAlpha(theme.text, 0.18);
  const mutedText = colorAlpha(theme.text, 0.7);
  const minHeightClass = compact ? "min-h-[420px]" : "min-h-[650px]";
  const imageHeight = compact ? "h-52" : "h-[310px]";

  return (
    <div
      className={`flex w-full min-w-0 flex-col overflow-hidden rounded-[1.7rem] border shadow-2xl shadow-black/60 ${minHeightClass}`}
      style={{
        background: cardBackground,
        borderColor: lineColour,
        color: theme.text,
        fontFamily: theme.fontFamily,
      }}
    >
      <div className={`relative overflow-hidden ${imageHeight}`}>
        {cardData.profile_image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cardData.profile_image_url}
            alt={cardData.full_name || "Profile"}
            className="h-full w-full object-cover object-top"
          />
        ) : (
          <div
            className="flex h-full w-full flex-col items-center justify-center gap-3 border-2 border-dashed"
            style={{
              borderColor: softLine,
              background: `radial-gradient(circle at center, ${colorAlpha(theme.text, 0.12)}, transparent 38%), ${colorAlpha(theme.secondary, 0.34)}`,
              color: mutedText,
            }}
          >
            <span className="text-5xl font-black tracking-tight">{initials(cardData.full_name)}</span>
            <span className="text-[10px] font-semibold uppercase tracking-[0.22em]">Portrait</span>
          </div>
        )}

        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(to bottom, transparent 42%, ${colorAlpha(theme.secondary, 0.72)} 70%, ${colorAlpha(theme.secondary, 0.96)})`,
          }}
        />

        {requiresLogo && (
          <div
            className="absolute right-4 top-4 flex min-h-11 min-w-11 items-center justify-center rounded-full border px-3 py-2 text-[9px] font-bold uppercase tracking-[0.18em] backdrop-blur"
            style={{
              backgroundColor: colorAlpha(theme.secondary, 0.66),
              borderColor: lineColour,
              color: theme.text,
            }}
          >
            {cardData.company_logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={cardData.company_logo_url}
                alt={cardData.company_name || "Company logo"}
                className="max-h-7 max-w-14 object-contain"
              />
            ) : (
              "DMI"
            )}
          </div>
        )}
      </div>

      <div className="mx-5 mt-5 h-px" style={{ background: `linear-gradient(90deg, transparent, ${theme.text}, transparent)` }} />

      <div className="px-5 pt-6 text-center">
        <h3 className="max-w-full break-words text-3xl font-black leading-tight tracking-tight">
          {cardData.full_name || "Full Name"}
        </h3>
        {props.sectionSettings?.personal &&
          props.allowedFields.includes("job_title") && (
            <p className="mt-3 max-w-full break-words text-xs font-semibold uppercase tracking-[0.22em]" style={{ color: mutedText }}>
              {cardData.job_title || "Job Title"}
            </p>
          )}
      </div>

      <div className="flex flex-1 flex-col px-5 py-5">
        {detailRows.length > 0 ? (
          <div className="divide-y" style={{ borderColor: softLine } as React.CSSProperties}>
            {detailRows.map((row) => (
              <ImportedSplitRow
                key={row.key}
                row={row}
                labelStyle={{ color: mutedText }}
                valueStyle={{ color: theme.text }}
              />
            ))}
          </div>
        ) : (
          <p className="rounded-2xl border p-4 text-sm" style={{ borderColor: lineColour, color: mutedText }}>
            Add visible fields to show card details.
          </p>
        )}
      </div>

      <TemplateSaveButton compact={compact} theme={theme} className="mx-5 mb-5 mt-auto" />
    </div>
  );
}

function GradientMeshLayout(props: LayoutProps) {
  const rows = importedTemplateRows(props);
  const { cardData, compact, requiresLogo } = props;
  const theme = getRendererTheme(props.theme);
  const cardBackground = cardBackgroundFromTheme(theme);
  const detailRows = rows.filter((row) => row.key !== "job_title");
  const lineColour = colorAlpha(theme.text, 0.24);
  const mutedText = colorAlpha(theme.text, 0.74);
  const panelTint = colorAlpha(theme.secondary, 0.68);
  const chipTint = colorAlpha(theme.text, 0.1);
  const minHeightClass = compact ? "min-h-[420px]" : "min-h-[650px]";

  return (
    <div
      className={`relative w-full min-w-0 overflow-hidden rounded-[1.9rem] p-2 shadow-2xl shadow-black/45 ${minHeightClass}`}
      style={{ background: cardBackground, fontFamily: theme.fontFamily }}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-80"
        style={{
          backgroundImage: `radial-gradient(circle at 18% 18%, ${colorAlpha(theme.text, 0.16)}, transparent 28%), radial-gradient(circle at 82% 8%, ${colorAlpha(theme.secondary, 0.46)}, transparent 34%), radial-gradient(circle at 80% 84%, ${colorAlpha(theme.primary, 0.32)}, transparent 38%)`,
        }}
      />
      <div
        className="relative z-10 flex min-h-full flex-col overflow-hidden rounded-[1.65rem] border backdrop-blur-2xl"
        style={{
          backgroundColor: panelTint,
          borderColor: lineColour,
          color: theme.text,
        }}
      >
        <div className="h-1.5" style={{ background: cardBackground }} />

        <div className="p-5 sm:p-6">
          <div className="mb-6 flex items-start justify-between gap-4">
            <ImportedAvatar
              cardData={cardData}
              className="rounded-[1.2rem] bg-white/10"
              style={{
                borderColor: lineColour,
                color: theme.text,
                borderRadius: "18px",
              }}
              size={compact ? "medium" : "large"}
            />

            {requiresLogo ? (
              <div
                className="flex min-h-10 min-w-[72px] items-center justify-center rounded-2xl border px-3 py-2 text-[9px] font-black uppercase tracking-[0.18em] shadow-lg"
                style={{
                  backgroundColor: colorAlpha(theme.secondary, 0.5),
                  borderColor: lineColour,
                  color: theme.text,
                }}
              >
                {cardData.company_logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={cardData.company_logo_url}
                    alt={cardData.company_name || "Company logo"}
                    className="max-h-7 max-w-20 object-contain"
                  />
                ) : (
                  "Logo"
                )}
              </div>
            ) : null}
          </div>

          <h3 className="max-w-full break-words text-3xl font-black leading-tight tracking-tight">
            {cardData.full_name || "Full Name"}
          </h3>
          {props.sectionSettings?.personal &&
            props.allowedFields.includes("job_title") && (
              <p className="mt-2 max-w-full break-words text-sm font-semibold" style={{ color: mutedText }}>
                {cardData.job_title || "Job Title"}
              </p>
            )}

          {detailRows.length > 0 ? (
            <div className="mt-6 grid gap-2">
              {detailRows.map((row) => (
                <div
                  key={row.key}
                  className="grid min-w-0 grid-cols-[88px_minmax(0,1fr)] items-center gap-3 rounded-2xl border px-3 py-3 text-xs font-semibold"
                  style={{ backgroundColor: chipTint, borderColor: lineColour, color: mutedText }}
                >
                  <span className="min-w-0 truncate uppercase tracking-[0.14em]" style={{ color: theme.text }}>
                    {row.label}
                  </span>
                  <span className="min-w-0 break-words text-right" style={{ color: mutedText }}>
                    {row.value}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-5 rounded-2xl border p-4 text-sm" style={{ borderColor: lineColour, color: mutedText }}>
              Add visible fields to show card details.
            </p>
          )}
        </div>

        <TemplateSaveButton compact={compact} theme={theme} className="mx-5 mb-5 mt-auto" />
      </div>
    </div>
  );
}

function PackProfile({
  cardData,
  size,
  radius,
  border,
  background,
  color,
  label = "Photo",
  className = "",
}: {
  cardData: CardRendererData;
  size: number;
  radius: string;
  border: string;
  background: string;
  color: string;
  label?: string;
  className?: string;
}) {
  if (cardData.profile_image_url) {
    return (
      <div
        className={`shrink-0 overflow-hidden ${className}`}
        style={{ width: size, height: size, borderRadius: radius, border }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={cardData.profile_image_url}
          alt={cardData.full_name || "Profile"}
          className="h-full w-full object-cover"
        />
      </div>
    );
  }

  return (
    <div
      className={`flex shrink-0 flex-col items-center justify-center gap-1 ${className}`}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        border,
        background,
        color,
      }}
    >
      <span className="text-xl font-black leading-none">{initials(cardData.full_name)}</span>
      {!cardData.full_name && (
        <span className="text-[8px] font-semibold uppercase tracking-[0.12em]">
          {label}
        </span>
      )}
    </div>
  );
}

function PackLogo({
  cardData,
  width,
  height,
  border,
  background,
  color,
  rounded = "6px",
  className = "",
}: {
  cardData: CardRendererData;
  width: number;
  height: number;
  border: string;
  background: string;
  color: string;
  rounded?: string;
  className?: string;
}) {
  if (cardData.company_logo_url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={cardData.company_logo_url}
        alt={cardData.company_name || "Company logo"}
        className={`block object-contain ${className}`}
        style={{ height, maxWidth: width }}
      />
    );
  }

  return (
    <div
      className={`flex shrink-0 flex-col items-center justify-center gap-0.5 ${className}`}
      style={{
        width,
        height,
        border,
        borderRadius: rounded,
        background,
        color,
      }}
    >
      <span className="text-sm leading-none">+</span>
      <span className="text-[7px] font-semibold uppercase tracking-[0.12em]">Logo</span>
    </div>
  );
}

function PackEmptyRows({
  theme,
  className = "",
}: {
  theme: RendererTheme;
  className?: string;
}) {
  return (
    <p
      className={`rounded-2xl border p-4 text-sm ${className}`}
      style={{
        borderColor: colorAlpha(theme.text, 0.22),
        color: colorAlpha(theme.text, 0.68),
      }}
    >
      Add visible fields to show card details.
    </p>
  );
}

function PackObsidianLayout(props: LayoutProps) {
  const rows = importedTemplateRows(props).filter((row) => row.key !== "job_title");
  const { cardData, compact, requiresLogo } = props;
  const theme = getRendererTheme(props.theme);
  const cardBackground = cardBackgroundFromTheme(theme);
  const line = colorAlpha(theme.text, 0.22);
  const muted = colorAlpha(theme.text, 0.68);
  const minHeightClass = compact ? "min-h-[420px]" : "min-h-[650px]";

  return (
    <div
      className={`flex w-full min-w-0 flex-col overflow-hidden rounded-[1.35rem] border shadow-2xl shadow-black/50 ${minHeightClass}`}
      style={{
        background: cardBackground,
        borderColor: line,
        color: theme.text,
        fontFamily: theme.fontFamily,
      }}
    >
      <div
        className="flex min-w-0 items-center gap-3 px-5 py-5 sm:px-6"
        style={{ backgroundColor: colorAlpha(theme.secondary, 0.42) }}
      >
        <PackProfile
          cardData={cardData}
          size={60}
          radius="999px"
          border={`2px dashed ${colorAlpha(theme.text, 0.48)}`}
          background={colorAlpha(theme.text, 0.1)}
          color={theme.text}
        />
        <div className="min-w-0 flex-1">
          <h3 className="max-w-full break-words text-lg font-black leading-tight tracking-tight">
            {cardData.full_name || "Your Name"}
          </h3>
          {props.sectionSettings?.personal && props.allowedFields.includes("job_title") && (
            <p className="mt-1 max-w-full break-words text-xs" style={{ color: muted }}>
              {cardData.job_title || "Job Title"}
            </p>
          )}
        </div>
        {requiresLogo && (
          <PackLogo
            cardData={cardData}
            width={72}
            height={28}
            border={`1.5px dashed ${colorAlpha(theme.text, 0.28)}`}
            background={colorAlpha(theme.text, 0.05)}
            color={colorAlpha(theme.text, 0.55)}
          />
        )}
      </div>

      <div className="flex flex-1 flex-col px-5 py-4 sm:px-6">
        {rows.length > 0 ? (
          <div className="divide-y" style={{ borderColor: line } as React.CSSProperties}>
            {rows.map((row) => (
              <div
                key={row.key}
                className="grid min-w-0 grid-cols-[82px_minmax(0,1fr)] items-center gap-3 py-2"
              >
                <span className="truncate text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: theme.text }}>
                  {row.label}
                </span>
                <span className="min-w-0 break-words text-right text-xs font-medium" style={{ color: muted }}>
                  {row.value}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <PackEmptyRows theme={theme} />
        )}
      </div>

      <TemplateSaveButton compact={compact} theme={theme} className="mx-5 mb-5 mt-auto" />
    </div>
  );
}

function PackEditorialLayout(props: LayoutProps) {
  const rows = importedTemplateRows(props).filter((row) => row.key !== "job_title");
  const { cardData, compact, requiresLogo } = props;
  const theme = getRendererTheme(props.theme);
  const cardBackground = cardBackgroundFromTheme(theme);
  const initialsText = initials(cardData.full_name);
  const line = colorAlpha(theme.text, 0.22);
  const muted = colorAlpha(theme.text, 0.72);
  const minHeightClass = compact ? "min-h-[420px]" : "min-h-[650px]";

  return (
    <div
      className={`relative flex w-full min-w-0 flex-col overflow-hidden rounded-lg border shadow-2xl shadow-black/25 ${minHeightClass}`}
      style={{
        background: cardBackground,
        borderColor: line,
        color: theme.text,
        fontFamily: theme.fontFamily,
      }}
    >
      <div
        className="pointer-events-none absolute bottom-3 right-5 select-none text-[5rem] font-black leading-none"
        style={{ color: colorAlpha(theme.text, 0.08) }}
      >
        {initialsText}
      </div>

      <div className="relative z-10 flex flex-1 flex-col p-6 sm:p-8">
        <p className="mb-4 text-[10px] font-semibold uppercase tracking-[0.26em]" style={{ color: muted }}>
          Digital Business Card
        </p>
        <div className="mb-5 flex min-w-0 items-center gap-4">
          <PackProfile
            cardData={cardData}
            size={56}
            radius="999px"
            border={`2px dashed ${colorAlpha(theme.text, 0.34)}`}
            background={colorAlpha(theme.text, 0.07)}
            color={theme.text}
          />
          <div className="min-w-0">
            <h3 className="max-w-full break-words text-2xl font-bold leading-tight">
              {cardData.full_name || "Your Name"}
            </h3>
            {props.sectionSettings?.personal && props.allowedFields.includes("job_title") && (
              <p className="mt-1 max-w-full break-words text-sm italic" style={{ color: muted }}>
                {cardData.job_title || "Job Title"}
              </p>
            )}
          </div>
        </div>

        <div className="mb-4 h-px" style={{ backgroundColor: line }} />

        {requiresLogo && (
          <div className="mb-4">
            <PackLogo
              cardData={cardData}
              width={100}
              height={28}
              border={`1.5px dashed ${colorAlpha(theme.text, 0.24)}`}
              background={colorAlpha(theme.text, 0.05)}
              color={colorAlpha(theme.text, 0.55)}
            />
          </div>
        )}

        {rows.length > 0 ? (
          <div className="space-y-2">
            {rows.map((row) => (
              <div key={row.key} className="grid min-w-0 grid-cols-[72px_minmax(0,1fr)] gap-4 text-sm">
                <span className="min-w-0 truncate font-light" style={{ color: muted }}>
                  {row.label}
                </span>
                <span className="min-w-0 break-words" style={{ color: theme.text }}>
                  {row.value}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <PackEmptyRows theme={theme} />
        )}
      </div>

      <TemplateSaveButton compact={compact} theme={theme} className="relative z-10 mx-6 mb-6 mt-auto" />
    </div>
  );
}

function PackColourblockLayout(props: LayoutProps) {
  const rows = importedTemplateRows(props).filter((row) => row.key !== "job_title");
  const { cardData, compact, requiresLogo } = props;
  const theme = getRendererTheme(props.theme);
  const cardBackground = cardBackgroundFromTheme(theme);
  const muted = colorAlpha(theme.text, 0.72);
  const minHeightClass = compact ? "min-h-[420px]" : "min-h-[650px]";

  return (
    <div
      className={`flex w-full min-w-0 flex-col overflow-hidden rounded-2xl shadow-2xl shadow-black/30 ${minHeightClass}`}
      style={{
        background: theme.secondary,
        color: theme.text,
        fontFamily: theme.fontFamily,
      }}
    >
      <div
        className="relative overflow-hidden px-6 pb-12 pt-6"
        style={{ background: cardBackground }}
      >
        {requiresLogo && (
          <div className="absolute right-5 top-5">
            <PackLogo
              cardData={cardData}
              width={70}
              height={26}
              border={`1.5px dashed ${colorAlpha(theme.text, 0.28)}`}
              background={colorAlpha(theme.text, 0.08)}
              color={colorAlpha(theme.text, 0.56)}
            />
          </div>
        )}
        <h3 className="relative max-w-[68%] break-words text-3xl font-black leading-tight tracking-tight">
          {cardData.full_name || "Your Name"}
        </h3>
        {props.sectionSettings?.personal && props.allowedFields.includes("job_title") && (
          <p className="relative mt-2 max-w-[70%] break-words text-sm font-semibold" style={{ color: muted }}>
            {cardData.job_title || "Job Title"}
          </p>
        )}
      </div>

      <div className="flex flex-1 flex-col px-6 pb-6">
        <div className="-mt-9 mb-5">
          <PackProfile
            cardData={cardData}
            size={68}
            radius="999px"
            border={`3px solid ${theme.secondary}`}
            background={colorAlpha(theme.text, 0.14)}
            color={theme.text}
            className="shadow-xl shadow-black/25"
          />
        </div>

        {rows.length > 0 ? (
          <div className="space-y-3">
            {rows.map((row) => (
              <div key={row.key} className="flex min-w-0 items-center gap-3">
                <div
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[9px] font-black uppercase"
                  style={{ backgroundColor: theme.buttonColor, color: theme.buttonTextColor }}
                >
                  {row.label.slice(0, 2)}
                </div>
                <span className="min-w-0 break-words text-sm" style={{ color: theme.text }}>
                  {row.value}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <PackEmptyRows theme={theme} />
        )}
      </div>

      <TemplateSaveButton compact={compact} theme={theme} className="mx-6 mb-6 mt-auto" />
    </div>
  );
}

function PackNeonNoirLayout(props: LayoutProps) {
  const rows = importedTemplateRows(props).filter((row) => row.key !== "job_title");
  const { cardData, compact, requiresLogo } = props;
  const theme = getRendererTheme(props.theme);
  const cardBackground = cardBackgroundFromTheme(theme);
  const line = colorAlpha(theme.text, 0.36);
  const muted = colorAlpha(theme.text, 0.72);
  const minHeightClass = compact ? "min-h-[420px]" : "min-h-[650px]";

  return (
    <div
      className={`relative flex w-full min-w-0 flex-col overflow-hidden rounded-2xl border shadow-2xl shadow-black/50 ${minHeightClass}`}
      style={{
        background: cardBackground,
        borderColor: line,
        color: theme.text,
        fontFamily: theme.fontFamily,
        boxShadow: `0 0 0 1px ${colorAlpha(theme.text, 0.1)}, 0 30px 80px rgba(0,0,0,0.5)`,
      }}
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: `linear-gradient(${colorAlpha(theme.text, 0.08)} 1px, transparent 1px), linear-gradient(90deg, ${colorAlpha(theme.text, 0.08)} 1px, transparent 1px)`,
          backgroundSize: "24px 24px",
        }}
      />
      <div
        className="relative h-[3px]"
        style={{ background: `linear-gradient(90deg, ${theme.text}, ${colorAlpha(theme.text, 0.18)}, ${theme.text})` }}
      />

      <div className="relative z-10 flex flex-1 flex-col p-5 sm:p-6">
        <div className="mb-5 flex min-w-0 items-center gap-3">
          <PackProfile
            cardData={cardData}
            size={62}
            radius="10px"
            border={`1.5px dashed ${colorAlpha(theme.text, 0.38)}`}
            background={colorAlpha(theme.text, 0.08)}
            color={theme.text}
          />
          <div className="min-w-0 flex-1">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.2em]" style={{ color: muted }}>
              {`// identity`}
            </p>
            <h3 className="max-w-full break-words text-lg font-black leading-tight">
              {cardData.full_name || "Your Name"}
            </h3>
            {props.sectionSettings?.personal && props.allowedFields.includes("job_title") && (
              <p className="mt-1 max-w-full break-words text-[11px]" style={{ color: muted }}>
                {cardData.job_title || "Job Title"}
              </p>
            )}
          </div>
          {requiresLogo && (
            <PackLogo
              cardData={cardData}
              width={68}
              height={28}
              border={`1.5px dashed ${colorAlpha(theme.text, 0.24)}`}
              background={colorAlpha(theme.text, 0.04)}
              color={colorAlpha(theme.text, 0.55)}
            />
          )}
        </div>

        <div className="mb-4 h-px" style={{ background: `linear-gradient(90deg, ${line}, ${colorAlpha(theme.text, 0.14)}, transparent)` }} />

        {rows.length > 0 ? (
          <div className="space-y-2">
            {rows.map((row) => (
              <div key={row.key} className="grid min-w-0 grid-cols-[64px_minmax(0,1fr)] gap-3 text-xs">
                <span className="truncate text-[9px] font-semibold uppercase tracking-[0.12em]" style={{ color: theme.text }}>
                  {row.label}_
                </span>
                <span className="min-w-0 break-words" style={{ color: muted }}>
                  {row.value}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <PackEmptyRows theme={theme} />
        )}

        <div className="mt-5 h-px" style={{ background: `linear-gradient(90deg, transparent, ${line}, ${colorAlpha(theme.text, 0.14)})` }} />
      </div>

      <TemplateSaveButton compact={compact} theme={theme} className="mx-5 mb-5 mt-auto" />
    </div>
  );
}

function PackLuxuryLayout(props: LayoutProps) {
  const rows = importedTemplateRows(props).filter((row) => row.key !== "job_title");
  const { cardData, compact, requiresLogo } = props;
  const theme = getRendererTheme(props.theme);
  const cardBackground = cardBackgroundFromTheme(theme);
  const muted = colorAlpha(theme.text, 0.72);
  const minHeightClass = compact ? "min-h-[420px]" : "min-h-[650px]";
  const imageHeight = compact ? "h-56" : "h-[300px]";

  return (
    <div
      className={`flex w-full min-w-0 flex-col overflow-hidden rounded-[1.6rem] shadow-2xl shadow-black/60 ${minHeightClass}`}
      style={{
        background: cardBackground,
        color: theme.text,
        fontFamily: theme.fontFamily,
      }}
    >
      <div className={`relative overflow-hidden ${imageHeight}`}>
        {cardData.profile_image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cardData.profile_image_url}
            alt={cardData.full_name || "Profile"}
            className="h-full w-full object-cover object-top"
          />
        ) : (
          <div
            className="flex h-full w-full flex-col items-center justify-center gap-2 border-2 border-dashed"
            style={{
              backgroundColor: colorAlpha(theme.text, 0.08),
              borderColor: colorAlpha(theme.text, 0.28),
              color: muted,
            }}
          >
            <span className="text-4xl font-black">{initials(cardData.full_name) || "+"}</span>
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em]">
              Upload Profile Photo
            </span>
          </div>
        )}
        <div className="absolute inset-0" style={{ background: `linear-gradient(to bottom, transparent 48%, ${theme.primary})` }} />
        {requiresLogo && (
          <div
            className="absolute right-4 top-4 rounded-lg border px-2.5 py-2 backdrop-blur"
            style={{
              backgroundColor: colorAlpha(theme.primary, 0.58),
              borderColor: colorAlpha(theme.text, 0.28),
            }}
          >
            <PackLogo
              cardData={cardData}
              width={52}
              height={18}
              border={`1px dashed ${colorAlpha(theme.text, 0.28)}`}
              background="transparent"
              color={colorAlpha(theme.text, 0.58)}
            />
          </div>
        )}
      </div>

      <div className="h-px" style={{ background: `linear-gradient(90deg, transparent, ${theme.text}, transparent)` }} />

      <div className="flex flex-1 flex-col px-6 py-5">
        <h3 className="max-w-full break-words text-xl font-black leading-tight tracking-tight">
          {cardData.full_name || "Your Name"}
        </h3>
        {props.sectionSettings?.personal && props.allowedFields.includes("job_title") && (
          <p className="mb-5 mt-2 max-w-full break-words text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: muted }}>
            {cardData.job_title || "Job Title"}
          </p>
        )}

        {rows.length > 0 ? (
          <div className="divide-y" style={{ borderColor: colorAlpha(theme.text, 0.2) } as React.CSSProperties}>
            {rows.map((row) => (
              <ImportedSplitRow
                key={row.key}
                row={row}
                labelStyle={{ color: muted }}
                valueStyle={{ color: colorAlpha(theme.text, 0.78) }}
              />
            ))}
          </div>
        ) : (
          <PackEmptyRows theme={theme} />
        )}
      </div>

      <TemplateSaveButton compact={compact} theme={theme} className="mx-6 mb-6 mt-auto" />
    </div>
  );
}

function PackBlueprintLayout(props: LayoutProps) {
  const rows = importedTemplateRows(props).filter((row) => row.key !== "job_title");
  const { cardData, compact, requiresLogo } = props;
  const theme = getRendererTheme(props.theme);
  const cardBackground = cardBackgroundFromTheme(theme);
  const line = colorAlpha(theme.text, 0.24);
  const muted = colorAlpha(theme.text, 0.72);
  const minHeightClass = compact ? "min-h-[420px]" : "min-h-[650px]";

  return (
    <div
      className={`relative flex w-full min-w-0 flex-col overflow-hidden rounded-md border shadow-2xl shadow-black/45 ${minHeightClass}`}
      style={{
        background: cardBackground,
        borderColor: line,
        color: theme.text,
        fontFamily: theme.fontFamily,
      }}
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: `linear-gradient(${colorAlpha(theme.text, 0.06)} 1px, transparent 1px), linear-gradient(90deg, ${colorAlpha(theme.text, 0.06)} 1px, transparent 1px)`,
          backgroundSize: "20px 20px",
        }}
      />
      <div className="relative z-10 flex flex-1 flex-col p-5 sm:p-6">
        <div className="mb-4 flex min-w-0 items-start justify-between gap-4 border-b pb-4" style={{ borderColor: line }}>
          <div className="min-w-0 flex-1">
            <p className="mb-1 text-[8px] font-semibold uppercase tracking-[0.2em]" style={{ color: muted }}>
              REV 01 · CONTACT CARD
            </p>
            <h3 className="max-w-full break-words text-lg font-black leading-tight">
              {cardData.full_name || "Your Name"}
            </h3>
            {props.sectionSettings?.personal && props.allowedFields.includes("job_title") && (
              <p className="mt-1 max-w-full break-words text-[11px]" style={{ color: muted }}>
                {cardData.job_title || "Job Title"}
              </p>
            )}
            {requiresLogo && (
              <div className="mt-2">
                <PackLogo
                  cardData={cardData}
                  width={70}
                  height={20}
                  border={`1px dashed ${colorAlpha(theme.text, 0.24)}`}
                  background={colorAlpha(theme.text, 0.05)}
                  color={colorAlpha(theme.text, 0.55)}
                />
              </div>
            )}
          </div>

          <div className="relative h-14 w-14 shrink-0">
            <PackProfile
              cardData={cardData}
              size={56}
              radius="999px"
              border={`1.5px dashed ${colorAlpha(theme.text, 0.48)}`}
              background={colorAlpha(theme.text, 0.06)}
              color={theme.text}
            />
            <div className="pointer-events-none absolute left-[-10px] right-[-10px] top-1/2 h-px" style={{ backgroundColor: colorAlpha(theme.text, 0.18) }} />
            <div className="pointer-events-none absolute bottom-[-10px] left-1/2 top-[-10px] w-px" style={{ backgroundColor: colorAlpha(theme.text, 0.18) }} />
          </div>
        </div>

        {rows.length > 0 ? (
          <div className="overflow-hidden rounded border" style={{ borderColor: line }}>
            {rows.map((row) => (
              <div
                key={row.key}
                className="grid min-w-0 grid-cols-[80px_minmax(0,1fr)] border-b last:border-b-0"
                style={{ borderColor: line }}
              >
                <div
                  className="border-r px-2 py-2 text-[8px] font-semibold uppercase tracking-[0.12em]"
                  style={{ borderColor: line, color: theme.text }}
                >
                  {row.label}
                </div>
                <div className="min-w-0 break-words px-2 py-2 text-[10px]" style={{ color: muted }}>
                  {row.value}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <PackEmptyRows theme={theme} />
        )}

        <div className="mt-4 flex justify-end">
          <p className="text-[7px] font-semibold uppercase tracking-[0.16em]" style={{ color: muted }}>
            Approved · Digital Issue
          </p>
        </div>
      </div>

      <TemplateSaveButton compact={compact} theme={theme} className="mx-5 mb-5 mt-auto" />
    </div>
  );
}

function PlaceholderSections({
  rows,
  tone,
}: {
  rows: { title: string; rows: DisplayRow[] }[];
  tone: "minimal" | "corporate" | "neon" | "creator";
}) {
  const toneClass =
    tone === "neon"
      ? "border-[#AC00FF]/30 bg-[#050816]/55"
      : tone === "minimal"
      ? "border-white/10 bg-black/18"
      : "border-white/12 bg-white/[0.07]";

  return (
    <div className="mt-5 space-y-4">
      {rows.map((section) => (
        <ClassicSection
          key={section.title}
          title={section.title}
          rows={section.rows}
          premium
          className={toneClass}
        />
      ))}
    </div>
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

function ImportedAvatar({
  cardData,
  className,
  style,
  size,
}: {
  cardData: CardRendererData;
  className: string;
  style?: React.CSSProperties;
  size: "medium" | "large";
}) {
  const sizeClass = size === "large" ? "h-16 w-16 text-xl" : "h-14 w-14 text-lg";

  return (
    <div
      className={`flex ${sizeClass} shrink-0 items-center justify-center overflow-hidden rounded-full border-2 font-black ${className}`}
      style={style}
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

function ImportedLogo({
  cardData,
  dark = false,
  muted = false,
  textColor,
}: {
  cardData: CardRendererData;
  dark?: boolean;
  muted?: boolean;
  textColor?: string;
}) {
  if (!cardData.company_logo_url && !cardData.company_name) return null;

  if (cardData.company_logo_url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={cardData.company_logo_url}
        alt={cardData.company_name || "Company logo"}
        className={`max-h-7 max-w-24 object-contain ${
          dark ? "brightness-0 invert" : ""
        } ${muted ? "opacity-60" : ""}`}
      />
    );
  }

  return (
    <span
      className={`max-w-28 truncate text-[10px] font-bold uppercase tracking-[0.16em] ${
        dark ? "text-white/45" : "text-black/45"
      }`}
      style={textColor ? { color: colorAlpha(textColor, muted ? 0.6 : 0.78) } : undefined}
    >
      {cardData.company_name}
    </span>
  );
}

function ImportedSplitRow({
  row,
  labelClassName = "",
  valueClassName = "",
  labelStyle,
  valueStyle,
}: {
  row: ImportedTemplateRow;
  labelClassName?: string;
  valueClassName?: string;
  labelStyle?: React.CSSProperties;
  valueStyle?: React.CSSProperties;
}) {
  return (
    <div className="grid min-w-0 grid-cols-[88px_minmax(0,1fr)] items-start gap-3 py-2 text-sm">
      <span
        className={`min-w-0 truncate text-[10px] uppercase tracking-[0.12em] ${labelClassName}`}
        style={labelStyle}
      >
        {row.label}
      </span>
      <span
        className={`min-w-0 max-w-full whitespace-pre-wrap break-words text-right text-xs font-semibold ${valueClassName}`}
        style={valueStyle}
      >
        {row.value}
      </span>
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
    layout === "obsidian_dark" ||
    layout === "glassmorphism" ||
    layout === "soft_pastel" ||
    layout === "neon_noir" ||
    layout === "luxury_vertical" ||
    layout === "gradient_mesh" ||
    layout === "pack_obsidian" ||
    layout === "editorial_serif" ||
    layout === "colourblock_split" ||
    layout === "pack_neon_noir" ||
    layout === "pack_luxury_vertical" ||
    layout === "blueprint_technical"
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
    "executive_minimal",
    "corporate_pro",
    "neon_tech",
    "creator_mode",
    "obsidian_dark",
    "glassmorphism",
    "soft_pastel",
    "neon_noir",
    "luxury_vertical",
    "gradient_mesh",
    "pack_obsidian",
    "editorial_serif",
    "colourblock_split",
    "pack_neon_noir",
    "pack_luxury_vertical",
    "blueprint_technical",
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
    obsidian_dark: "Outfit",
    glassmorphism: "Outfit",
    soft_pastel: "Nunito",
    neon_noir: "Space Mono",
    luxury_vertical: "Syne",
    gradient_mesh: "Outfit",
    pack_obsidian: "Inter",
    editorial_serif: "Playfair Display",
    colourblock_split: "Poppins",
    pack_neon_noir: "Space Mono",
    pack_luxury_vertical: "Syne",
    blueprint_technical: "Space Mono",
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
