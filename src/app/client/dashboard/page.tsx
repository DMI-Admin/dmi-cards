"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  ContactRound,
  CreditCard,
  ExternalLink,
  Eye,
  Heart,
  Link2,
  Lock,
  LogOut,
  Monitor,
  Plug,
  QrCode,
  Settings,
  Share2,
  Sun,
  SmartphoneNfc,
  Sparkles,
  UserRound,
  WalletCards,
  Moon,
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
import type { ClientProfile } from "@/lib/profiles";
import { requireClientUser } from "@/lib/client-auth";
import {
  isClientFeatureLocked,
  type ClientFeature,
} from "@/lib/client-feature-access";

type ThemeChoice = "system" | "light" | "dark";

const themeStorageKey = "dmi-theme";
const currentPlan = "free" as "free" | "individual_pro" | "business" | "enterprise";
const isPaid = currentPlan !== "free";

const fallbackTemplate: CardRendererTemplate = {
  access_level: "free",
  layout_type: "classic_free",
  allowed_fields: [
    "job_title",
    "department",
    "company_name",
    "website",
    "address",
    "email",
    "phone",
  ],
  custom_fields: {
    personal: ["job_title", "department"],
    company: ["company_name", "website", "address"],
    contact: ["email", "phone"],
    social: [],
  },
  show_personal_section: true,
  show_company_section: true,
  show_contact_section: true,
  show_social_section: false,
  free_colour_palette: ["#AC00FF", "#101935"],
};

const recentContacts = [
  {
    name: "Aisha Patel",
    company: "Northline Studio",
    date: "12 May 2026",
    source: "QR scan",
  },
  {
    name: "Daniel Brooks",
    company: "Vertex Group",
    date: "11 May 2026",
    source: "Public page",
  },
  {
    name: "Mia Chen",
    company: "Aster Labs",
    date: "10 May 2026",
    source: "Tap share",
  },
  {
    name: "Owen Clarke",
    company: "Bright Ledger",
    date: "9 May 2026",
    source: "Wallet",
  },
  {
    name: "Nora Wilson",
    company: "Nova Retail",
    date: "8 May 2026",
    source: "QR scan",
  },
];

const integrationStatuses = [
  { name: "Zapier", status: "connected" },
  { name: "HubSpot", status: "connected" },
  { name: "Salesforce", status: "disconnected" },
  { name: "Zoho CRM", status: "not_connected" },
  { name: "Pipedrive", status: "not_connected" },
  { name: "GoHighLevel", status: "disconnected" },
];

const analyticsStats = [
  { label: "Views", value: isPaid ? "1,284" : "Limited", icon: Eye },
  { label: "Saves", value: isPaid ? "146" : "Locked", icon: Heart },
  { label: "Shares", value: isPaid ? "78" : "Locked", icon: Share2 },
  { label: "QR scans", value: isPaid ? "392" : "Limited", icon: QrCode },
];

function applyDashboardTheme(theme: ThemeChoice) {
  document.documentElement.dataset.theme = theme;
}

function storedDashboardTheme(): ThemeChoice {
  if (typeof window === "undefined") return "system";

  const value = window.localStorage.getItem(themeStorageKey);

  return value === "light" || value === "dark" || value === "system"
    ? value
    : "system";
}

export default function ClientDashboardPage() {
  const router = useRouter();
  const [templates, setTemplates] = useState<SharedTemplate[]>([]);
  const [profile, setProfile] = useState<ClientProfile | null>(null);
  const [latestCard, setLatestCard] = useState<(CardRendererData & {
    id?: string;
    template_id?: string | null;
    slug?: string | null;
    card_name?: string | null;
    selected_colour?: string | null;
    selected_text_colour?: string | null;
    status?: string | null;
    is_published?: boolean | null;
  }) | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(true);

  useEffect(() => {
    let ignore = false;

    async function loadDashboardPreview() {
      setLoadingPreview(true);

      try {
        const loadedTemplates = await getClientVisibleTemplates(currentPlan);

        if (ignore) return;

        setTemplates(loadedTemplates);

        const { user, profile: loadedProfile } = await requireClientUser();

        if (ignore) return;

        setProfile(loadedProfile);

        const { data, error } = await supabase
          .from("cards")
          .select("*")
          .eq("user_id", user.id)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (error) {
          console.error("Dashboard card fetch failed", error);
        }

        if (!ignore) {
          setLatestCard(data || null);
        }
        console.log("[DMI auth] loaded cards", data ? [data] : []);
      } catch (error) {
        console.error("Dashboard preview load failed", error);
      } finally {
        if (!ignore) {
          setLoadingPreview(false);
        }
      }
    }

    void loadDashboardPreview();

    return () => {
      ignore = true;
    };
  }, []);

  const previewTemplate = useMemo(() => {
    const selectedTemplate =
      templates.find((template) => template.id === latestCard?.template_id) ||
      templates.find((template) => template.access_level === "free") ||
      null;

    if (!selectedTemplate) return fallbackTemplate;

    if (selectedTemplate.access_level === "free") {
      return {
        ...selectedTemplate,
        free_colour_palette: [
          latestCard?.selected_colour ||
            normalizeColourPalette(selectedTemplate.free_colour_palette)[0] ||
            "#AC00FF",
        ],
        text_color: latestCard?.selected_text_colour || selectedTemplate.text_color,
      };
    }

    return selectedTemplate;
  }, [
    latestCard?.selected_colour,
    latestCard?.selected_text_colour,
    latestCard?.template_id,
    templates,
  ]);
  const publicUrl = latestCard?.slug ? `/u/${latestCard.slug}` : "/u/your-card-url";
  const hasSavedCard = Boolean(latestCard);

  return (
    <main className="flex min-h-screen flex-col bg-[var(--background)] text-[var(--text-primary)] lg:flex-row">
      <div className="hidden lg:block">
        <ClientSidebar />
      </div>

      <section className="min-w-0 flex-1 px-5 py-6 sm:px-7 lg:px-10 lg:py-9">
        <div className="mb-8 flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.28em] text-[var(--text-accent)]">
              Client Portal
            </p>
            <h1 className="mt-3 text-4xl font-bold tracking-normal text-[var(--text-primary)] sm:text-5xl">
              Dashboard
            </h1>
            <p className="mt-3 max-w-3xl text-base leading-7 text-[var(--text-secondary)]">
              Manage your digital card, public link, QR code, and sharing tools
              from one client portal.
            </p>
          </div>
          <div className="hidden lg:block">
            <AccountMenu profile={profile} onNavigate={(href) => router.push(href)} />
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
          <div className="space-y-6">
            <WelcomePlanCard profile={profile} />

            <div className="grid gap-5 lg:grid-cols-2">
              <FreePlanSummary />
              <UpgradeTeaser />
            </div>

            {hasSavedCard ? (
              <div className="grid gap-5 lg:grid-cols-2">
                <PublicUrlCard publicUrl={publicUrl} published={Boolean(latestCard?.is_published || latestCard?.status === "published")} />
                <QuickActionsCard publicUrl={publicUrl} />
              </div>
            ) : (
              <FirstCardActions onCreate={() => router.push("/client/cards")} />
            )}

            <div className="grid gap-5 lg:grid-cols-3">
              <ShortcutCard
                title="QR Code"
                description="Open your shareable QR code tools."
                icon={QrCode}
                href="/client/qr-code"
                feature="qr-code"
              />
              <ShortcutCard
                title="Wallet"
                description="Add your card to mobile wallets."
                icon={WalletCards}
                href="/client/wallet"
                feature="wallet"
              />
              <ShortcutCard
                title="Tap to Share"
                description="Manage NFC and tap sharing."
                icon={SmartphoneNfc}
                href="/client/tap-to-share"
                feature="tap-to-share"
              />
            </div>

            <AnalyticsSummary />
            <RecentContacts />
            <IntegrationStatus />
          </div>

          <aside className="xl:sticky xl:top-8 xl:self-start">
            <div className="rounded-[var(--radius-xl)] border border-[var(--dmi-border)] bg-[var(--dmi-surface)] p-5 shadow-[var(--shadow-md)]">
              <div className="mb-5 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold text-[var(--text-primary)]">
                    Live Card Preview
                  </h2>
                  <p className="mt-1 text-sm text-[var(--text-secondary)]">
                    {loadingPreview ? "Loading latest saved card." : "Latest saved card preview."}
                  </p>
                </div>
                <span className="rounded-full border border-[var(--border-brand)] bg-[var(--brand-gradient-subtle)] px-3 py-1 text-xs font-bold uppercase tracking-[0.12em] text-[var(--badge-brand-text)]">
                  Free
                </span>
              </div>

              {latestCard ? (
                <div className="flex justify-center overflow-hidden rounded-[1.5rem] bg-black">
                  <CardRenderer
                    template={previewTemplate}
                    cardData={latestCard}
                    mode="preview"
                  />
                </div>
              ) : (
                <div className="rounded-[1.5rem] border border-dashed border-[var(--border-brand)] bg-[var(--brand-gradient-subtle)] p-8 text-center">
                  <h3 className="text-lg font-semibold text-[var(--text-primary)]">No card created yet</h3>
                  <p className="mx-auto mt-3 max-w-xs text-sm leading-6 text-[var(--text-secondary)]">
                    Create your first digital business card to unlock your
                    preview, public URL, and QR tools.
                  </p>
                  <button
                    type="button"
                    onClick={() => router.push("/client/cards")}
                    className="mt-6 inline-flex items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[image:var(--brand-gradient)] px-5 py-3 text-sm font-semibold text-[#FFFFFF] shadow-[var(--brand-glow)] transition hover:-translate-y-0.5"
                  >
                    <CreditCard className="h-4 w-4" />
                    Create My First Card
                  </button>
                </div>
              )}
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}

function WelcomePlanCard({ profile }: { profile: ClientProfile | null }) {
  const firstName = firstNameFromProfile(profile);
  const displayEmail = profile?.email || "Signed in with Supabase";

  return (
    <div className="dmi-hero-panel rounded-[var(--radius-xl)] border p-6 shadow-[var(--brand-glow)] sm:p-8">
      <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl">
          <div
            className="inline-flex items-center gap-2 rounded-full border border-white/35 bg-white/20 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em]"
            style={{ color: "rgba(255,255,255,0.85)" }}
          >
            <Sparkles className="h-3.5 w-3.5" />
            Free plan
          </div>
          <h2
            className="mt-5 text-3xl font-bold tracking-normal sm:text-4xl"
            style={{ color: "#FFFFFF" }}
          >
            {firstName ? `Welcome ${firstName}` : "Welcome"}
          </h2>
          <p
            className="mt-2 text-sm font-medium"
            style={{ color: "rgba(255,255,255,0.85)" }}
          >
            {displayEmail}
          </p>
          <p
            className="mt-4 max-w-2xl text-base font-medium leading-7"
            style={{ color: "rgba(255,255,255,0.85)" }}
          >
            Manage your digital business card, public profile, QR code, and
            sharing tools from one place.
          </p>
        </div>
        <div
          className="grid min-w-[170px] gap-2 rounded-[var(--radius-lg)] border border-white/25 bg-white/15 p-4 backdrop-blur"
          style={{ color: "#FFFFFF" }}
        >
          <span
            className="text-xs font-bold uppercase tracking-[0.18em]"
            style={{ color: "rgba(255,255,255,0.7)" }}
          >
            Plan status
          </span>
          <span className="text-2xl font-bold" style={{ color: "#FFFFFF" }}>Free</span>
          <span
            className="text-sm font-medium"
            style={{ color: "rgba(255,255,255,0.85)" }}
          >
            1 card included
          </span>
        </div>
      </div>
    </div>
  );
}

function firstNameFromProfile(profile: ClientProfile | null) {
  const firstName = profile?.first_name?.trim();

  if (firstName) {
    return firstName;
  }

  const displayName =
    typeof (profile as { display_name?: unknown } | null)?.display_name === "string"
      ? (profile as { display_name?: string }).display_name?.trim()
      : "";

  if (displayName) {
    return displayName.split(/\s+/)[0] || "";
  }

  const emailLocalPart = profile?.email?.split("@")[0]?.trim();

  return emailLocalPart || "";
}

function AccountMenu({
  profile,
  onNavigate,
}: {
  profile: ClientProfile | null;
  onNavigate: (href: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeChoice>(() => storedDashboardTheme());
  const email = profile?.email || "Signed in with Supabase";
  const firstName = firstNameFromProfile(profile);
  const initial = (firstName || email || "A").trim().charAt(0).toUpperCase();

  useEffect(() => {
    applyDashboardTheme(theme);
  }, [theme]);

  function selectTheme(nextTheme: ThemeChoice) {
    setTheme(nextTheme);
    window.localStorage.setItem(themeStorageKey, nextTheme);
    applyDashboardTheme(nextTheme);
  }

  async function handleLogout() {
    const { error } = await supabase.auth.signOut();
    console.log("[DMI auth] logout result", {
      error: error ? { name: error.name, message: error.message, status: error.status } : null,
    });
    onNavigate("/");
  }

  return (
    <div className="relative self-start">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="inline-flex items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--dmi-border)] bg-[var(--dmi-surface)] px-3 py-2 text-sm font-semibold text-[var(--text-primary)] shadow-[var(--shadow-sm)] transition hover:-translate-y-0.5 hover:border-[var(--border-brand)] hover:shadow-[var(--shadow-md)]"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[image:var(--brand-gradient)] text-sm font-bold text-white shadow-[var(--brand-glow)]">
          {initial || <UserRound className="h-4 w-4" />}
        </span>
        <ChevronDown className="h-4 w-4 text-[var(--text-secondary)]" />
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-3 w-[min(20rem,calc(100vw-2rem))] rounded-[var(--radius-xl)] border border-[var(--dmi-border)] bg-[var(--dmi-surface)] p-3 shadow-[var(--shadow-xl)]">
          <button
            type="button"
            onClick={() => onNavigate("/client/settings")}
            className="w-full rounded-xl px-3 py-3 text-left text-sm text-[var(--text-secondary)] transition hover:bg-[var(--dmi-surface-soft)] hover:text-[var(--text-primary)]"
          >
            <span className="block text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Signed in as</span>
            <span className="mt-1 block truncate font-medium">{email}</span>
          </button>

          <div className="my-2 h-px bg-[var(--dmi-border)]" />

          <button
            type="button"
            onClick={() => onNavigate("/client/settings")}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-[var(--text-secondary)] transition hover:bg-[var(--dmi-surface-soft)] hover:text-[var(--text-primary)]"
          >
            <Settings className="h-4 w-4 text-[var(--text-accent)]" />
            Account settings
          </button>

          <div className="mt-3 rounded-xl border border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] p-3">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--text-muted)]">
              Theme
            </p>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <ThemeOption
                label="System"
                value="system"
                active={theme === "system"}
                icon={Monitor}
                onSelect={selectTheme}
              />
              <ThemeOption
                label="Light"
                value="light"
                active={theme === "light"}
                icon={Sun}
                onSelect={selectTheme}
              />
              <ThemeOption
                label="Dark"
                value="dark"
                active={theme === "dark"}
                icon={Moon}
                onSelect={selectTheme}
              />
            </div>
          </div>

          <div className="my-2 h-px bg-[var(--dmi-border)]" />

          <button
            type="button"
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-[var(--error)] transition hover:bg-[var(--error-bg)]"
          >
            <LogOut className="h-4 w-4" />
            Log out
          </button>
        </div>
      )}
    </div>
  );
}

function FreePlanSummary() {
  const features = [
    "1 published digital card",
    "Free template access",
    "Public profile URL",
    "Basic QR code",
    "Save contact button",
  ];

  return (
    <div className="rounded-[var(--radius-xl)] border border-[var(--dmi-border)] bg-[var(--dmi-surface)] p-6 shadow-[var(--shadow-md)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--text-accent)]">
            Included
          </p>
          <h2 className="mt-2 text-xl font-semibold text-[var(--text-primary)]">Your Free Plan</h2>
        </div>
        <span className="rounded-full bg-[var(--success-bg)] px-3 py-1 text-xs font-bold text-[var(--success)]">
          Active
        </span>
      </div>
      <ul className="mt-5 space-y-3">
        {features.map((feature) => (
          <li key={feature} className="flex items-center gap-3 text-sm font-medium text-[var(--text-secondary)]">
            <span className="h-2.5 w-2.5 rounded-full bg-[image:var(--brand-gradient)]" />
            {feature}
          </li>
        ))}
      </ul>
    </div>
  );
}

function UpgradeTeaser() {
  const features = [
    "Premium templates",
    "Contacts",
    "Tap to Share",
    "Analytics",
    "Integrations",
  ];

  return (
    <div className="rounded-[var(--radius-xl)] border border-[var(--dmi-border)] bg-[var(--dmi-surface)] p-6 shadow-[var(--shadow-md)]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--text-accent)]">
            Upgrade
          </p>
          <h2 className="mt-2 text-xl font-semibold text-[var(--text-primary)]">Individual Pro</h2>
        </div>
        <LockedBadge />
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {features.map((feature) => (
          <div key={feature} className="flex items-center gap-3 text-sm font-medium text-[var(--text-secondary)]">
            <Lock className="h-4 w-4 text-[var(--text-accent)]" />
            {feature}
          </div>
        ))}
      </div>
      <a
        href="/client/billing"
        className="mt-6 inline-flex w-full items-center justify-center gap-3 rounded-2xl bg-[image:var(--brand-gradient)] px-4 py-3 text-sm font-semibold text-[#FFFFFF] shadow-[var(--brand-glow)] transition hover:-translate-y-0.5 hover:text-[#FFFFFF] focus:text-[#FFFFFF] focus-visible:text-[#FFFFFF] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#AC00FF] sm:w-auto [&>svg]:stroke-[#FFFFFF] [&>svg]:text-[#FFFFFF]"
        style={{ color: "#FFFFFF", WebkitTextFillColor: "#FFFFFF" }}
      >
        Upgrade to Pro
      </a>
    </div>
  );
}

function ThemeOption({
  label,
  value,
  icon: Icon,
  active,
  onSelect,
}: {
  label: string;
  value: ThemeChoice;
  icon: typeof Monitor;
  active: boolean;
  onSelect: (theme: ThemeChoice) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(value);
      }}
      className={`flex flex-col items-center gap-1 rounded-xl border px-2 py-2 text-xs font-semibold transition ${
        active
          ? "border-[var(--border-brand)] bg-[var(--brand-gradient-subtle)] text-[var(--text-accent)]"
          : "border-[var(--dmi-border)] bg-[var(--dmi-surface)] text-[var(--text-secondary)] hover:border-[var(--border-brand)] hover:text-[var(--text-primary)]"
      }`}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

function PublicUrlCard({
  publicUrl,
  published,
}: {
  publicUrl: string;
  published: boolean;
}) {
  return (
    <div className="rounded-[var(--radius-xl)] border border-[var(--dmi-border)] bg-[var(--dmi-surface)] p-6 shadow-[var(--shadow-md)]">
      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--brand-gradient-subtle)] text-[var(--text-accent)]">
        <Link2 className="h-5 w-5" />
      </div>
      <h2 className="mt-5 text-xl font-semibold text-[var(--text-primary)]">Public page URL</h2>
      <p className="mt-3 rounded-2xl border border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] px-4 py-3 text-sm font-medium text-[var(--text-primary)]">
        {publicUrl}
      </p>
      <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">
        {published
          ? "Your public link is active."
          : "Your public link will become active when your card is published."}
      </p>
    </div>
  );
}

function QuickActionsCard({ publicUrl }: { publicUrl: string }) {
  const actions = [
    { label: "Edit card", icon: CreditCard, href: "/client/cards" },
    { label: "Open public page", icon: ExternalLink, href: publicUrl },
    { label: "Download QR", icon: QrCode, href: "/client/qr-code" },
  ];

  return (
    <div className="rounded-[var(--radius-xl)] border border-[var(--dmi-border)] bg-[var(--dmi-surface)] p-6 shadow-[var(--shadow-md)]">
      <h2 className="text-xl font-semibold text-[var(--text-primary)]">Quick actions</h2>
      <div className="mt-5 space-y-3">
        {actions.map((action) => {
          const Icon = action.icon;

          return (
            <a
              key={action.label}
              href={action.href}
              target={action.href?.startsWith("/u/") ? "_blank" : undefined}
              rel={action.href?.startsWith("/u/") ? "noreferrer" : undefined}
              className="flex w-full items-center gap-3 rounded-2xl border border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] px-4 py-3 text-left text-sm font-semibold text-[var(--text-primary)] transition hover:-translate-y-0.5 hover:border-[var(--border-brand)] hover:bg-[var(--brand-gradient-subtle)]"
            >
              <Icon className="h-4 w-4 text-[var(--text-accent)]" />
              {action.label}
            </a>
          );
        })}
      </div>
    </div>
  );
}

function FirstCardActions({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="rounded-[var(--radius-xl)] border border-[var(--dmi-border)] bg-[var(--dmi-surface)] p-6 shadow-[var(--shadow-md)]">
      <h2 className="text-xl font-semibold text-[var(--text-primary)]">Quick actions</h2>
      <div className="mt-5">
        <button
          type="button"
          onClick={onCreate}
          className="flex w-full items-center gap-3 rounded-2xl bg-[image:var(--brand-gradient)] px-4 py-3 text-left text-sm font-semibold text-[#FFFFFF] shadow-[var(--brand-glow)] transition hover:-translate-y-0.5"
        >
          <CreditCard className="h-4 w-4" />
          Create My First Card
        </button>
      </div>
    </div>
  );
}

function ShortcutCard({
  title,
  description,
  icon: Icon,
  href,
  feature,
}: {
  title: string;
  description: string;
  icon: typeof QrCode;
  href: string;
  feature: ClientFeature;
}) {
  const locked = isClientFeatureLocked(feature, currentPlan);
  const content = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--brand-gradient-subtle)] text-[var(--text-accent)]">
          <Icon className="h-5 w-5" />
        </div>
        {locked && (
          <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border-brand)] bg-[var(--badge-pro-bg)] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--badge-pro-text)]">
            <Lock className="h-3 w-3" />
            Pro
          </span>
        )}
      </div>
      <h3 className="mt-5 text-lg font-semibold text-[var(--text-primary)]">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">{description}</p>
      {locked && (
        <p className="mt-4 text-xs font-semibold text-[var(--text-accent)]">
          Upgrade to Individual Pro to unlock this feature.
        </p>
      )}
    </>
  );

  if (!locked) {
    return (
      <a
        href={href}
        className="block rounded-[var(--radius-xl)] border border-[var(--dmi-border)] bg-[var(--dmi-surface)] p-5 shadow-[var(--shadow-md)] transition hover:-translate-y-0.5 hover:border-[var(--border-brand)]"
      >
        {content}
      </a>
    );
  }

  return (
    <div
      className="rounded-[var(--radius-xl)] border border-[var(--dmi-border)] bg-[var(--dmi-surface)] p-5 text-[var(--text-secondary)] shadow-[var(--shadow-md)] transition"
    >
      {content}
    </div>
  );
}

function AnalyticsSummary() {
  return (
    <div className="rounded-[var(--radius-xl)] border border-[var(--dmi-border)] bg-[var(--dmi-surface)] p-6 shadow-[var(--shadow-md)]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">Analytics summary</h2>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            {isPaid
              ? "Mock performance data for your digital card."
              : "Free users get limited analytics visibility."}
          </p>
        </div>
        {!isPaid && <LockedBadge />}
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-4">
        {analyticsStats.map((stat) => {
          const Icon = stat.icon;

          return (
            <div
              key={stat.label}
              className={`rounded-2xl border border-[var(--dmi-border)] p-4 ${
                isPaid ? "bg-[var(--dmi-surface-soft)]" : "bg-[var(--dmi-surface-soft)]"
              }`}
            >
              <Icon className="h-4 w-4 text-[var(--text-accent)]" />
              <p className="mt-4 text-xs font-bold uppercase tracking-[0.16em] text-[var(--text-muted)]">
                {stat.label}
              </p>
              <p className="mt-2 text-xl font-semibold text-[var(--text-primary)]">{stat.value}</p>
            </div>
          );
        })}
      </div>

      {!isPaid && (
        <p className="mt-5 text-sm font-semibold text-[var(--text-accent)]">
          Upgrade to Individual Pro to unlock full analytics.
        </p>
      )}
    </div>
  );
}

function RecentContacts() {
  return (
    <div className="rounded-[var(--radius-xl)] border border-[var(--dmi-border)] bg-[var(--dmi-surface)] p-6 shadow-[var(--shadow-md)]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">Recent Contacts</h2>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Last 5 contacts captured from your public card.
          </p>
        </div>
        {!isPaid && <LockedBadge />}
      </div>

      {isPaid ? (
        <div className="mt-5 max-w-full overflow-x-auto rounded-2xl border border-[var(--dmi-border)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--dmi-surface-soft)] text-left text-[var(--text-secondary)]">
              <tr>
                <th className="p-4">Name</th>
                <th className="p-4">Company</th>
                <th className="p-4">Date captured</th>
                <th className="p-4">Source</th>
              </tr>
            </thead>
            <tbody>
              {recentContacts.map((contact) => (
                <tr key={contact.name} className="border-t border-[var(--dmi-border)]">
                  <td className="p-4 font-medium text-[var(--text-primary)]">{contact.name}</td>
                  <td className="p-4 text-[var(--text-secondary)]">{contact.company}</td>
                  <td className="p-4 text-[var(--text-secondary)]">{contact.date}</td>
                  <td className="p-4 text-[var(--text-secondary)]">{contact.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <LockedPanel
          icon={ContactRound}
          message="Upgrade to Individual Pro to unlock contact capture and contact history."
        />
      )}
    </div>
  );
}

function IntegrationStatus() {
  return (
    <div className="rounded-[var(--radius-xl)] border border-[var(--dmi-border)] bg-[var(--dmi-surface)] p-6 shadow-[var(--shadow-md)]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">Integration Status</h2>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Sync card activity into your business tools.
          </p>
        </div>
        {!isPaid && <LockedBadge />}
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2">
        {integrationStatuses.map((integration) => (
          <div
            key={integration.name}
            className={`flex items-center justify-between rounded-2xl border border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] px-4 py-3 ${
              isPaid ? "" : "text-[var(--text-secondary)]"
            }`}
          >
            <div className="flex items-center gap-3">
              <Plug className="h-4 w-4 text-[var(--text-accent)]" />
              <span className="text-sm font-medium text-[var(--text-primary)]">{integration.name}</span>
            </div>
            <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-secondary)]">
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  !isPaid
                    ? "bg-[var(--text-muted)]"
                    : integration.status === "connected"
                    ? "bg-green-400"
                    : integration.status === "disconnected"
                    ? "bg-red-400"
                    : "bg-[var(--text-muted)]"
                }`}
              />
              {!isPaid
                ? "Locked"
                : integration.status === "connected"
                ? "Connected"
                : integration.status === "disconnected"
                ? "Disconnected"
                : "Not connected"}
            </div>
          </div>
        ))}
      </div>

      {!isPaid && (
        <p className="mt-5 text-sm font-semibold text-[var(--text-accent)]">
          Upgrade to Individual Pro to unlock CRM and workflow integrations.
        </p>
      )}
    </div>
  );
}

function LockedBadge({ variant = "default" }: { variant?: "default" | "onGradient" }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] shadow-[var(--shadow-sm)] ${
        variant === "onGradient"
          ? "border border-white/35 bg-white/20 text-[#FFFFFF]"
          : "border border-[var(--border-brand)] bg-[var(--badge-pro-bg)] text-[var(--badge-pro-text)]"
      }`}
    >
      <Lock className="h-3 w-3" />
      Pro locked
    </span>
  );
}

function LockedPanel({
  icon: Icon,
  message,
}: {
  icon: typeof ContactRound;
  message: string;
}) {
  return (
    <div className="mt-5 rounded-2xl border border-dashed border-[var(--border-brand)] bg-[var(--brand-gradient-subtle)] p-5">
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[var(--dmi-surface)] text-[var(--text-accent)] shadow-[var(--shadow-sm)]">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="font-semibold text-[var(--text-primary)]">Paid feature</p>
          <p className="mt-1 text-sm leading-6 text-[var(--text-secondary)]">{message}</p>
        </div>
      </div>
    </div>
  );
}
