import {
  ContactRound,
  CreditCard,
  ExternalLink,
  Eye,
  Heart,
  Link2,
  Lock,
  Plug,
  QrCode,
  Share2,
  SmartphoneNfc,
  Sparkles,
  WalletCards,
} from "lucide-react";
import CardRenderer, {
  type CardRendererData,
  type CardRendererTemplate,
} from "@/components/CardRenderer";
import ClientSidebar from "@/components/ClientSidebar";

const currentPlan = "free" as "free" | "individual_pro" | "business" | "enterprise";
const isPaid = currentPlan !== "free";

const mockTemplate: CardRendererTemplate = {
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
    contact: ["email", "phone", "website"],
    social: [],
  },
  show_personal_section: true,
  show_company_section: true,
  show_contact_section: true,
  show_social_section: false,
  free_colour_palette: ["#AC00FF", "#101935"],
};

const mockCardData: CardRendererData = {
  full_name: "Full Name",
  job_title: "Creative Director",
  department: "Brand Experience",
  company_name: "DevMaster Inc",
  email: "hello@devmasterinc.com",
  phone: "+44 7700 900123",
  website: "https://www.devmasterinc.com",
  address: "London, United Kingdom",
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

export default function ClientDashboardPage() {
  return (
    <main className="flex min-h-screen bg-[#070B1A] text-white">
      <ClientSidebar />

      <section className="flex-1 p-10">
        <div className="mb-10">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#AC00FF]">
            Client Portal
          </p>
          <h1 className="mt-3 text-4xl font-bold">Dashboard</h1>
          <p className="mt-3 max-w-3xl text-white/50">
            Manage your digital card, public link, QR code, and sharing tools
            from one client portal.
          </p>
        </div>

        <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_390px]">
          <div className="space-y-6">
            <WelcomePlanCard />

            <div className="grid gap-5 lg:grid-cols-2">
              <PublicUrlCard />
              <QuickActionsCard />
            </div>

            <div className="grid gap-5 lg:grid-cols-3">
              <ShortcutCard
                title="QR Code"
                description="Open your shareable QR code tools."
                icon={QrCode}
                locked={false}
              />
              <ShortcutCard
                title="Wallet"
                description="Add your card to mobile wallets."
                icon={WalletCards}
                locked={!isPaid}
              />
              <ShortcutCard
                title="Tap to Share"
                description="Manage NFC and tap sharing."
                icon={SmartphoneNfc}
                locked={!isPaid}
              />
            </div>

            <AnalyticsSummary />
            <RecentContacts />
            <IntegrationStatus />
          </div>

          <aside className="xl:sticky xl:top-8 xl:self-start">
            <div className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-2xl shadow-black/20">
              <div className="mb-5 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold">Live Card Preview</h2>
                  <p className="mt-1 text-sm text-white/45">
                    Mock preview until live data is connected.
                  </p>
                </div>
                <span className="rounded-full border border-[#AC00FF]/30 bg-[#AC00FF]/15 px-3 py-1 text-xs font-semibold text-purple-100">
                  Free
                </span>
              </div>

              <div className="flex justify-center overflow-hidden rounded-[2rem]">
                <CardRenderer
                  template={mockTemplate}
                  cardData={mockCardData}
                  mode="preview"
                />
              </div>
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}

function WelcomePlanCard() {
  return (
    <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-[#101935] to-[#AC00FF]/15 p-6 shadow-2xl shadow-purple-950/10">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-white/60">
            <Sparkles className="h-3.5 w-3.5 text-purple-200" />
            Free plan
          </div>
          <h2 className="mt-5 text-3xl font-semibold">Welcome back</h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-white/55">
            Your free digital card shell is ready. Upgrade to Individual Pro to
            unlock contacts, wallet, tap sharing, analytics, and integrations.
          </p>
        </div>

        <div className="rounded-2xl border border-[#AC00FF]/25 bg-[#AC00FF]/10 px-5 py-4">
          <p className="text-sm text-white/45">Current access</p>
          <p className="mt-2 text-2xl font-semibold">Free</p>
        </div>
      </div>
    </div>
  );
}

function PublicUrlCard() {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#AC00FF]/15 text-purple-200">
        <Link2 className="h-5 w-5" />
      </div>
      <h2 className="mt-5 text-xl font-semibold">Public page URL</h2>
      <p className="mt-3 rounded-2xl border border-white/10 bg-[#070B1A]/60 px-4 py-3 text-sm text-white/70">
        /u/your-card-url
      </p>
      <p className="mt-3 text-sm text-white/45">
        Your public link will become active when your card is published.
      </p>
    </div>
  );
}

function QuickActionsCard() {
  const actions = [
    { label: "Edit card", icon: CreditCard },
    { label: "Open public page", icon: ExternalLink },
    { label: "Download QR", icon: QrCode },
  ];

  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
      <h2 className="text-xl font-semibold">Quick actions</h2>
      <div className="mt-5 space-y-3">
        {actions.map((action) => {
          const Icon = action.icon;

          return (
            <button
              key={action.label}
              type="button"
              className="flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left text-sm font-medium text-white/75 transition hover:border-[#AC00FF]/40 hover:bg-[#AC00FF]/10 hover:text-white"
            >
              <Icon className="h-4 w-4 text-purple-200" />
              {action.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ShortcutCard({
  title,
  description,
  icon: Icon,
  locked,
}: {
  title: string;
  description: string;
  icon: typeof QrCode;
  locked: boolean;
}) {
  return (
    <div
      className={`rounded-3xl border p-5 ${
        locked
          ? "border-white/10 bg-white/[0.03] text-white/45"
          : "border-white/10 bg-white/5"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#AC00FF]/15 text-purple-200">
          <Icon className="h-5 w-5" />
        </div>
        {locked && (
          <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/50">
            <Lock className="h-3 w-3" />
            Pro
          </span>
        )}
      </div>
      <h3 className="mt-5 text-lg font-semibold text-white">{title}</h3>
      <p className="mt-2 text-sm leading-5">{description}</p>
      {locked && (
        <p className="mt-4 text-xs text-purple-200">
          Upgrade to Individual Pro to unlock this feature.
        </p>
      )}
    </div>
  );
}

function AnalyticsSummary() {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold">Analytics summary</h2>
          <p className="mt-1 text-sm text-white/45">
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
              className={`rounded-2xl border border-white/10 p-4 ${
                isPaid ? "bg-[#101935]/60" : "bg-white/[0.03]"
              }`}
            >
              <Icon className="h-4 w-4 text-purple-200" />
              <p className="mt-4 text-xs uppercase tracking-[0.16em] text-white/35">
                {stat.label}
              </p>
              <p className="mt-2 text-xl font-semibold">{stat.value}</p>
            </div>
          );
        })}
      </div>

      {!isPaid && (
        <p className="mt-5 text-sm text-purple-200">
          Upgrade to Individual Pro to unlock full analytics.
        </p>
      )}
    </div>
  );
}

function RecentContacts() {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold">Recent Contacts</h2>
          <p className="mt-1 text-sm text-white/45">
            Last 5 contacts captured from your public card.
          </p>
        </div>
        {!isPaid && <LockedBadge />}
      </div>

      {isPaid ? (
        <div className="mt-5 overflow-hidden rounded-2xl border border-white/10">
          <table className="w-full text-sm">
            <thead className="bg-[#101935] text-left text-white/45">
              <tr>
                <th className="p-4">Name</th>
                <th className="p-4">Company</th>
                <th className="p-4">Date captured</th>
                <th className="p-4">Source</th>
              </tr>
            </thead>
            <tbody>
              {recentContacts.map((contact) => (
                <tr key={contact.name} className="border-t border-white/5">
                  <td className="p-4 font-medium">{contact.name}</td>
                  <td className="p-4 text-white/60">{contact.company}</td>
                  <td className="p-4 text-white/60">{contact.date}</td>
                  <td className="p-4 text-white/60">{contact.source}</td>
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
    <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold">Integration Status</h2>
          <p className="mt-1 text-sm text-white/45">
            Sync card activity into your business tools.
          </p>
        </div>
        {!isPaid && <LockedBadge />}
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2">
        {integrationStatuses.map((integration) => (
          <div
            key={integration.name}
            className={`flex items-center justify-between rounded-2xl border border-white/10 px-4 py-3 ${
              isPaid ? "bg-[#101935]/60" : "bg-white/[0.03] text-white/45"
            }`}
          >
            <div className="flex items-center gap-3">
              <Plug className="h-4 w-4 text-purple-200" />
              <span className="text-sm font-medium">{integration.name}</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-white/45">
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  !isPaid
                    ? "bg-white/25"
                    : integration.status === "connected"
                    ? "bg-green-400"
                    : integration.status === "disconnected"
                    ? "bg-red-400"
                    : "bg-white/25"
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
        <p className="mt-5 text-sm text-purple-200">
          Upgrade to Individual Pro to unlock CRM and workflow integrations.
        </p>
      )}
    </div>
  );
}

function LockedBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-white/55">
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
    <div className="mt-5 rounded-2xl border border-dashed border-[#AC00FF]/35 bg-[#AC00FF]/10 p-5">
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#AC00FF]/20 text-purple-100">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="font-semibold">Paid feature</p>
          <p className="mt-1 text-sm leading-6 text-white/55">{message}</p>
        </div>
      </div>
    </div>
  );
}
