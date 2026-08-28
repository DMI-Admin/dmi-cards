"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  ContactRound,
  Copy,
  CreditCard,
  ExternalLink,
  LogOut,
  Monitor,
  Palette,
  Plug,
  QrCode,
  Settings,
  Sun,
  UserRound,
  Moon,
} from "lucide-react";
import CardRenderer, {
  type CardRendererData,
  type CardRendererTemplate,
} from "@/components/CardRenderer";
import {
  ClientPortalHeader,
  ClientPortalPage,
  ClientPortalWorkspace,
  clientButtonClass,
} from "@/components/ClientPortalShell";
import UpgradeToProButton from "@/components/UpgradeToProButton";
import { supabase } from "@/lib/supabase";
import {
  getClientVisibleTemplates,
  normalizeColourPalette,
  type SharedTemplate,
} from "@/lib/templates";
import type { ClientProfile } from "@/lib/profiles";
import { getCurrentProfile, getCurrentUser } from "@/lib/client-auth";
import { buildPublicCardUrl } from "@/lib/public-url";
import type { DmiPlan } from "@/lib/entitlements";
import { useClientPlan } from "@/lib/use-client-plan";

type ThemeChoice = "system" | "light" | "dark";

const themeStorageKey = "dmi-theme";
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

const analyticsMetrics = [
  { label: "Views", value: "0" },
  { label: "Saves", value: "0" },
  { label: "Shares", value: "0" },
  { label: "QR scans", value: "0" },
];

const integrationNames = ["Zapier", "HubSpot", "Salesforce", "Zoho CRM"];

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
  const { plan, isPaid, loading: planLoading } = useClientPlan();
  const planResolved = Boolean(plan) && !planLoading;
  const showPaidDashboard = planResolved && isPaid;
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
  const [actionMessage, setActionMessage] = useState("");

  useEffect(() => {
    let ignore = false;

    async function loadDashboardPreview() {
      setLoadingPreview(true);

      try {
        if (!plan) return;

        const loadedTemplates = await getClientVisibleTemplates(plan as DmiPlan);

        if (ignore) return;

        setTemplates(loadedTemplates);

        const user = await getCurrentUser();

        if (!user) return;

        const loadedProfile = await getCurrentProfile(user);

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
  }, [plan]);

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
  const publicCardUrl = latestCard?.slug
    ? buildPublicCardUrl(latestCard.slug)
    : publicUrl;
  const hasSavedCard = Boolean(latestCard);

  async function copyPublicCardLink() {
    if (!latestCard?.slug) return;

    await navigator.clipboard?.writeText(publicCardUrl);
    setActionMessage("Card link copied.");
  }

  return (
    <ClientPortalPage>
      <ClientPortalHeader
        title="Dashboard"
        description="Manage your digital card, public link, QR code, and sharing tools from one place."
        action={
          <div className="hidden lg:block">
            <AccountMenu
              profile={profile}
              isPaid={showPaidDashboard}
              planResolved={planResolved}
              onNavigate={(href) => router.push(href)}
            />
          </div>
        }
      />

      <ClientPortalWorkspace
        preview={
          <div className="client-portal-panel p-3.5">
            <div className="mb-4 flex items-center justify-between gap-3 px-1">
              <div>
                <h2 className="text-lg font-semibold text-[var(--text-primary)]">
                  Live Card Preview
                </h2>
                <p className="mt-1 text-sm text-[var(--text-secondary)]">
                  {loadingPreview ? "Loading latest card." : "Latest saved card."}
                </p>
              </div>
            </div>

            {latestCard ? (
              <div className="flex max-h-[680px] justify-center overflow-hidden rounded-xl border border-[var(--dmi-border)] bg-black/70">
                <CardRenderer
                  template={previewTemplate}
                  cardData={latestCard}
                  mode="preview"
                />
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] p-7 text-center">
                <h3 className="text-lg font-semibold text-[var(--text-primary)]">No card created yet</h3>
                <p className="mx-auto mt-3 max-w-xs text-sm leading-6 text-[var(--text-secondary)]">
                  Create your first digital business card to unlock your
                  preview, public URL, and QR tools.
                </p>
                <button
                  type="button"
                  onClick={() => router.push("/client/cards")}
                  className={`mt-6 ${clientButtonClass.primary}`}
                >
                  <CreditCard className="h-4 w-4" />
                  Create My First Card
                </button>
              </div>
            )}
            </div>
        }
      >
        <WelcomePanel profile={profile} />

        <QuickActionsCard
          hasSavedCard={hasSavedCard}
          publicUrl={publicUrl}
          onCopyLink={copyPublicCardLink}
          onCreate={() => router.push("/client/cards")}
          message={actionMessage}
        />

        <AnalyticsSummary isPaid={showPaidDashboard} planResolved={planResolved} />
        <RecentContacts isPaid={showPaidDashboard} planResolved={planResolved} />
        <IntegrationStatus isPaid={showPaidDashboard} planResolved={planResolved} />
      </ClientPortalWorkspace>
    </ClientPortalPage>
  );
}

function WelcomePanel({ profile }: { profile: ClientProfile | null }) {
  const firstName = firstNameFromProfile(profile);

  return (
    <div
      className="overflow-hidden rounded-2xl border px-5 py-5 sm:px-7 sm:py-6"
      style={{
        background: "var(--dashboard-welcome-bg)",
        borderColor: "var(--dashboard-welcome-border)",
        boxShadow: "var(--dashboard-welcome-shadow)",
      }}
    >
      <div className="max-w-3xl">
        <h2
          className="text-3xl font-semibold tracking-normal sm:text-4xl"
          style={{ color: "#FFFFFF" }}
        >
          {firstName ? `Welcome ${firstName}` : "Welcome"}
        </h2>
        <p
          className="mt-3 max-w-2xl text-base font-medium leading-7"
          style={{ color: "rgba(255,255,255,0.78)" }}
        >
          Your digital business card is live and ready to share.
        </p>
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
  isPaid,
  planResolved,
  onNavigate,
}: {
  profile: ClientProfile | null;
  isPaid: boolean;
  planResolved: boolean;
  onNavigate: (href: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);
  const [portalError, setPortalError] = useState("");
  const [theme, setTheme] = useState<ThemeChoice>(() => storedDashboardTheme());
  const email = profile?.email || "Signed in with Supabase";
  const firstName = firstNameFromProfile(profile);
  const displayName =
    profile?.full_name?.trim() ||
    [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim() ||
    firstName ||
    "Your account";
  const initial = (firstName || email || "A").trim().charAt(0).toUpperCase();
  const planLabel = !planResolved ? "Checking plan" : isPaid ? "Individual Pro" : "Free";

  useEffect(() => {
    applyDashboardTheme(theme);
  }, [theme]);

  function selectTheme(nextTheme: ThemeChoice) {
    setTheme(nextTheme);
    window.localStorage.setItem(themeStorageKey, nextTheme);
    applyDashboardTheme(nextTheme);
  }

  async function openBillingPortal() {
    if (portalLoading) return;

    setPortalLoading(true);
    setPortalError("");

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Please sign in again before managing your subscription.");
      }

      const response = await fetch("/api/stripe/portal", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });
      const payload = await response.json().catch(() => null);
      const portalUrl =
        typeof payload?.url === "string"
          ? payload.url
          : typeof payload?.data?.url === "string"
            ? payload.data.url
            : "";

      if (!response.ok || !portalUrl) {
        const message =
          typeof payload?.error?.message === "string"
            ? payload.error.message
            : "Could not open subscription management.";
        throw new Error(message);
      }

      window.location.assign(portalUrl);
    } catch (error) {
      setPortalError(
        error instanceof Error
          ? error.message
          : "Could not open subscription management."
      );
      setPortalLoading(false);
    }
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
        <div className="absolute right-0 z-30 mt-3 w-[min(18rem,calc(100vw-2rem))] rounded-2xl border border-[var(--dmi-border)] bg-[var(--dmi-surface)] p-2 shadow-[var(--shadow-xl)]">
          <div className="px-3 py-2.5">
            <p className="truncate text-sm font-semibold text-[var(--text-primary)]">
              {displayName}
            </p>
            <p className="mt-0.5 truncate text-xs text-[var(--text-secondary)]">{email}</p>
            <p className="mt-1 text-[11px] font-semibold text-[var(--text-accent)]">
              {planLabel}
            </p>
          </div>

          <div className="my-1 h-px bg-[var(--dmi-border)]" />

          <button
            type="button"
            onClick={() => onNavigate("/client/settings")}
            className="flex min-h-10 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-medium text-[var(--text-secondary)] transition hover:bg-[var(--dmi-surface-soft)] hover:text-[var(--text-primary)]"
          >
            <Settings className="h-4 w-4 text-[var(--text-accent)]" />
            Manage account
          </button>

          {isPaid ? (
            <button
              type="button"
              onClick={openBillingPortal}
              disabled={portalLoading || !planResolved}
              className="flex min-h-10 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-medium text-[var(--text-secondary)] transition hover:bg-[var(--dmi-surface-soft)] hover:text-[var(--text-primary)] disabled:cursor-wait disabled:opacity-60"
            >
              <CreditCard className="h-4 w-4 text-[var(--text-accent)]" />
              {portalLoading ? "Opening Stripe..." : "Manage subscription"}
            </button>
          ) : (
            <UpgradeToProButton className="flex min-h-10 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-medium text-[var(--text-secondary)] transition hover:bg-[var(--dmi-surface-soft)] hover:text-[var(--text-primary)]">
              <CreditCard className="h-4 w-4 text-[var(--text-accent)]" />
              Upgrade to Pro
            </UpgradeToProButton>
          )}

          <button
            type="button"
            onClick={() => setAppearanceOpen((current) => !current)}
            className="flex min-h-10 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-medium text-[var(--text-secondary)] transition hover:bg-[var(--dmi-surface-soft)] hover:text-[var(--text-primary)]"
            aria-expanded={appearanceOpen}
          >
            <Palette className="h-4 w-4 text-[var(--text-accent)]" />
            <span className="flex-1">Appearance</span>
            <ChevronDown
              className={`h-4 w-4 transition ${appearanceOpen ? "rotate-180" : ""}`}
            />
          </button>

          {appearanceOpen && (
            <div className="mx-1 mb-1 rounded-xl border border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] p-1">
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
          )}

          {portalError && (
            <p className="px-3 py-1 text-xs leading-5 text-[var(--error)]">{portalError}</p>
          )}

          <div className="my-2 h-px bg-[var(--dmi-border)]" />

          <button
            type="button"
            onClick={handleLogout}
            className="flex min-h-10 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-semibold text-[var(--error)] transition hover:bg-[var(--error-bg)]"
          >
            <LogOut className="h-4 w-4" />
            Log out
          </button>
        </div>
      )}
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
      className={`flex min-h-9 w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
        active
          ? "bg-[var(--brand-gradient-subtle)] text-[var(--text-accent)]"
          : "text-[var(--text-secondary)] hover:bg-[var(--dmi-surface)] hover:text-[var(--text-primary)]"
      }`}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

function QuickActionsCard({
  hasSavedCard,
  publicUrl,
  onCopyLink,
  onCreate,
  message,
}: {
  hasSavedCard: boolean;
  publicUrl: string;
  onCopyLink: () => void;
  onCreate: () => void;
  message: string;
}) {
  const actionClass =
    "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] px-3.5 py-2 text-sm font-semibold text-[var(--text-primary)] transition hover:-translate-y-0.5 hover:border-[var(--border-brand)] hover:bg-[var(--brand-gradient-subtle)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0";

  return (
    <div className="rounded-2xl border border-[var(--dmi-border)] bg-[var(--dmi-surface)] p-4 shadow-[var(--shadow-sm)]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">Quick actions</h2>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Share, edit, and add your card to a wallet.
          </p>
        </div>
        {!hasSavedCard && (
          <button
            type="button"
            onClick={onCreate}
            className={clientButtonClass.primary}
          >
            <CreditCard className="h-4 w-4" />
            Create card
          </button>
        )}
      </div>

      <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
        <a href="/client/cards" className={actionClass}>
          <CreditCard className="h-4 w-4 text-[var(--text-accent)]" />
          Edit card
        </a>
        <a
          href={hasSavedCard ? publicUrl : "#"}
          target={hasSavedCard ? "_blank" : undefined}
          rel={hasSavedCard ? "noreferrer" : undefined}
          aria-disabled={!hasSavedCard}
          className={`${actionClass} ${!hasSavedCard ? "pointer-events-none opacity-50" : ""}`}
        >
          <ExternalLink className="h-4 w-4 text-[var(--text-accent)]" />
          Open public page
        </a>
        <button
          type="button"
          onClick={onCopyLink}
          disabled={!hasSavedCard}
          className={actionClass}
        >
          <Copy className="h-4 w-4 text-[var(--text-accent)]" />
          Copy card link
        </button>
        <a href="/client/qr-code" className={actionClass}>
          <QrCode className="h-4 w-4 text-[var(--text-accent)]" />
          QR Code
        </a>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-center gap-5 pb-1">
        <PlatformWalletBadge platform="apple" />
        <PlatformWalletBadge platform="google" />
      </div>
      {message && (
        <p className="mt-3 text-sm font-medium text-[var(--text-accent)]" role="status">
          {message}
        </p>
      )}
    </div>
  );
}

function PlatformWalletBadge({ platform }: { platform: "apple" | "google" }) {
  const isApple = platform === "apple";

  return (
    <a
      href="/client/wallet"
      className="inline-flex shrink-0 rounded-lg transition hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#AC00FF]"
      aria-label={isApple ? "Add to Apple Wallet" : "Add to Google Wallet"}
    >
      <Image
        src={isApple ? "/wallet/add-to-apple-wallet.svg" : "/wallet/add-to-google-wallet.svg"}
        alt={isApple ? "Add to Apple Wallet" : "Add to Google Wallet"}
        width={isApple ? 111 : 199}
        height={isApple ? 35 : 55}
        className="h-[35px] w-auto"
        priority={false}
      />
    </a>
  );
}

function AnalyticsSummary({
  isPaid,
  planResolved,
}: {
  isPaid: boolean;
  planResolved: boolean;
}) {
  const locked = planResolved && !isPaid;

  return (
    <section className="relative overflow-hidden rounded-2xl border border-[var(--dmi-border)] bg-[var(--dmi-surface)] p-4 shadow-[var(--shadow-sm)] sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">Live analytics</h2>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            {!planResolved
              ? "Loading analytics access."
              : isPaid
              ? "Real-time card activity will appear here as people engage with your card."
              : "Views, saves, shares, and QR scans are available with Pro."}
          </p>
        </div>
      </div>

      <div
        className={`mt-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4 ${
          locked ? "opacity-35 blur-[1px]" : ""
        } ${!planResolved ? "animate-pulse" : ""}`}
      >
        {analyticsMetrics.map((stat) => (
          <div
            key={stat.label}
            className="rounded-xl border border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] p-3.5"
          >
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--text-muted)]">
              {stat.label}
            </p>
            <p className="mt-3 text-2xl font-semibold text-[var(--text-primary)]">
              {isPaid ? stat.value : "-"}
            </p>
          </div>
        ))}
      </div>

      {isPaid ? (
        <EmptyDashboardState message="No activity yet — share your card to start seeing insights." />
      ) : locked ? (
        <LockedPreviewOverlay
          icon={QrCode}
          title="Unlock with Pro"
          description="See views, saves, shares and QR scans."
        />
      ) : (
        <EmptyDashboardState message="Loading your analytics access." />
      )}
    </section>
  );
}

function RecentContacts({
  isPaid,
  planResolved,
}: {
  isPaid: boolean;
  planResolved: boolean;
}) {
  const locked = planResolved && !isPaid;

  return (
    <section className="relative overflow-hidden rounded-2xl border border-[var(--dmi-border)] bg-[var(--dmi-surface)] p-4 shadow-[var(--shadow-sm)] sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">Recent Contacts</h2>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Last 5 contacts captured from your public card.
          </p>
        </div>
      </div>

      {isPaid ? (
        <div className="mt-4 max-w-full overflow-x-auto rounded-xl border border-[var(--dmi-border)]">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="bg-[var(--dmi-surface-soft)] text-left text-[var(--text-secondary)]">
              <tr>
                <th className="p-4">Name</th>
                <th className="p-4">Company</th>
                <th className="p-4">Date captured</th>
                <th className="p-4">Source</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-[var(--dmi-border)]">
                <td colSpan={4} className="p-5 text-center text-sm text-[var(--text-secondary)]">
                  No contacts captured yet. Share your card to start building your lead list.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div
            className={`mt-4 rounded-xl border border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] p-5 ${
              locked ? "opacity-35 blur-[1px]" : "animate-pulse"
            }`}
          >
            <div className="h-3 w-36 rounded-full bg-[var(--dmi-border)]" />
            <div className="mt-4 h-3 w-52 rounded-full bg-[var(--dmi-border)]" />
          </div>
          {locked && (
            <LockedPreviewOverlay
              icon={ContactRound}
              title="Unlock with Pro"
              description="View contacts captured from your digital card."
            />
          )}
        </>
      )}
    </section>
  );
}

function IntegrationStatus({
  isPaid,
  planResolved,
}: {
  isPaid: boolean;
  planResolved: boolean;
}) {
  const locked = planResolved && !isPaid;

  return (
    <section className="relative overflow-hidden rounded-2xl border border-[var(--dmi-border)] bg-[var(--dmi-surface)] p-4 shadow-[var(--shadow-sm)] sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">Integration Status</h2>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Sync card activity into your business tools.
          </p>
        </div>
      </div>

      <div
        className={`mt-4 grid gap-2.5 md:grid-cols-2 ${
          locked ? "opacity-35 blur-[1px]" : ""
        } ${!planResolved ? "animate-pulse" : ""}`}
      >
        {integrationNames.map((integration) => (
          <div
            key={integration}
            className="flex items-center justify-between gap-3 rounded-xl border border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] px-3.5 py-2.5"
          >
            <div className="flex items-center gap-3">
              <Plug className="h-4 w-4 text-[var(--text-accent)]" />
              <span className="text-sm font-medium text-[var(--text-primary)]">{integration}</span>
            </div>
            <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-secondary)]">
              <span className="h-2.5 w-2.5 rounded-full bg-[var(--text-muted)]" />
              Not connected
            </div>
          </div>
        ))}
      </div>

      {isPaid ? (
        <EmptyDashboardState message="No integrations connected yet." />
      ) : locked ? (
        <LockedPreviewOverlay
          icon={Plug}
          title="Unlock with Pro"
          description="Connect your DMI Card to CRM and business tools."
        />
      ) : (
        <EmptyDashboardState message="Loading your integration access." />
      )}
    </section>
  );
}

function LockedPreviewOverlay({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof ContactRound;
  title: string;
  description: string;
}) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-[var(--dmi-surface)]/80 p-5 backdrop-blur-[2px]">
      <div className="max-w-sm rounded-2xl border border-[var(--dmi-border)] bg-[var(--dmi-surface)] p-5 text-center shadow-[var(--shadow-md)]">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--brand-gradient-subtle)] text-[var(--text-accent)]">
          <Icon className="h-5 w-5" />
        </div>
        <h3 className="mt-4 text-base font-semibold text-[var(--text-primary)]">{title}</h3>
        <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">{description}</p>
        <p className="mt-3 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-accent)]">
          Available on Pro
        </p>
      </div>
    </div>
  );
}

function EmptyDashboardState({
  message,
}: {
  message: string;
}) {
  return (
    <div className="mt-5 rounded-xl border border-dashed border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] p-4 text-sm text-[var(--text-secondary)]">
      {message}
    </div>
  );
}
