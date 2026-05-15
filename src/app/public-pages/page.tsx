"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Sidebar from "@/components/Sidebar";
import { supabase } from "@/lib/supabase";

type Client = {
  id: string;
  full_name: string | null;
  company_name: string | null;
  email: string | null;
  account_type: string | null;
};

type Template = {
  id: string;
  name: string;
};

type Card = {
  id: string;
  client_id: string | null;
  template_id: string | null;
  slug: string | null;
  card_name: string | null;
  name?: string | null;
  full_name: string | null;
  company_name?: string | null;
  email?: string | null;
  status: string | null;
  is_published: boolean | null;
  job_title?: string | null;
};

type PublicPageRow = Card & {
  template?: Template | null;
  client?: Client | null;
};

type CompanyGroup = {
  client: Client;
  companyName: string;
  cards: PublicPageRow[];
};

export default function PublicPagesPage() {
  const [cards, setCards] = useState<Card[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [expandedCompany, setExpandedCompany] = useState<string | null>(null);
  const [statsTarget, setStatsTarget] = useState<{
    title: string;
    cards: PublicPageRow[];
  } | null>(null);

  async function fetchPublicPages() {
    setLoading(true);

    const [cardsResult, templatesResult, clientsResult] = await Promise.all([
      supabase
        .from("cards")
        .select("*")
        .order("created_at", { ascending: false }),
      supabase.from("templates").select("id, name"),
      supabase.from("clients").select("id, full_name, company_name, email, account_type"),
    ]);

    if (cardsResult.error) alert(cardsResult.error.message);
    if (templatesResult.error) console.error(templatesResult.error.message);
    if (clientsResult.error) console.error(clientsResult.error.message);

    if (cardsResult.data) setCards(cardsResult.data);
    if (templatesResult.data) setTemplates(templatesResult.data);
    if (clientsResult.data) setClients(clientsResult.data);

    setLoading(false);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchPublicPages();
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  const rows = useMemo<PublicPageRow[]>(() => {
    return cards.map((card) => ({
      ...card,
      template: templates.find((template) => template.id === card.template_id),
      client: clients.find((client) => client.id === card.client_id),
    }));
  }, [cards, templates, clients]);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) return rows;

    return rows.filter((card) => {
      const values = [
        card.card_name,
        card.full_name,
        card.company_name,
        card.client?.company_name,
        card.email,
        card.template?.name,
        card.slug,
      ];

      return values.some((value) => (value || "").toLowerCase().includes(query));
    });
  }, [rows, search]);

  const individualRows = filteredRows.filter(
    (card) => card.client?.account_type === "individual"
  );
  const companyGroups = useMemo<CompanyGroup[]>(() => {
    const businessRows = filteredRows.filter(
      (card) =>
        card.client?.account_type === "business" ||
        card.client?.account_type === "enterprise"
    );
    const grouped = new Map<string, CompanyGroup>();

    businessRows.forEach((card) => {
      if (!card.client) return;

      const existing = grouped.get(card.client.id);
      const companyName =
        card.client.company_name ||
        card.company_name ||
        card.client.full_name ||
        "Unnamed company";

      if (existing) {
        existing.cards.push(card);
        return;
      }

      grouped.set(card.client.id, {
        client: card.client,
        companyName,
        cards: [card],
      });
    });

    return Array.from(grouped.values());
  }, [filteredRows]);

  const publishedCount = rows.filter((card) => card.is_published).length;
  const businessPageCount = rows.filter(
    (card) =>
      card.client?.account_type === "business" ||
      card.client?.account_type === "enterprise"
  ).length;

  async function copyLink(slug: string | null) {
    if (!slug) return;

    await navigator.clipboard.writeText(publicUrl(slug));
  }

  function openPublicPage(slug: string | null) {
    if (!slug) return;

    window.open(`/u/${slug}`, "_blank", "noopener,noreferrer");
  }

  async function unpublishCard(card: Card) {
    const confirmed = window.confirm(
      `Unpublish ${card.card_name || card.full_name || "this card"}?`
    );

    if (!confirmed) return;

    const { error } = await supabase
      .from("cards")
      .update({ is_published: false, status: "draft" })
      .eq("id", card.id);

    if (error) {
      alert(error.message);
      return;
    }

    await fetchPublicPages();
  }

  function downloadCompanyReport(group: CompanyGroup) {
    const headers = [
      "company name",
      "staff name",
      "email",
      "public URL",
      "views",
      "saves",
      "shares",
      "status",
    ];
    const rows = group.cards.map((card) => [
      group.companyName,
      card.full_name || card.card_name || "",
      card.email || "",
      card.slug ? publicUrl(card.slug) : "",
      "0",
      "0",
      "0",
      card.is_published ? "published" : "unpublished",
    ]);
    const csv = [headers, ...rows]
      .map((row) => row.map(csvCell).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const link = document.createElement("a");

    link.href = url;
    link.download = `${slugify(group.companyName)}-public-pages-report.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="flex min-h-screen bg-[#070B1A] text-white">
      <Sidebar />

      <section className="flex-1 p-10">
        <div className="mb-8">
          <h1 className="text-4xl font-bold">Public Pages</h1>

          <p className="mt-2 text-white/50">
            Manage published digital business card pages.
          </p>
        </div>

        <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-6">
          <StatCard label="Total Public Pages" value={rows.length} />
          <StatCard label="Individual Pages" value={individualRows.length} />
          <StatCard label="Business/Enterprise Pages" value={businessPageCount} />
          <StatCard label="Published" value={publishedCount} />
          <StatCard label="Total Views" value={0} muted />
          <StatCard label="Total Saves" value={0} muted />
        </div>

        <div className="mb-8 rounded-3xl border border-white/10 bg-white/5">
          <div className="flex flex-col gap-4 border-b border-white/10 p-6 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-2xl font-semibold">Individual Public Pages</h2>
              <p className="mt-1 text-sm text-white/45">
                Individual client public card pages.
              </p>
            </div>

            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search public pages..."
              className="inputStyle w-full md:max-w-sm"
            />
          </div>

          <div className="max-h-[520px] overflow-y-auto p-6">
            <IndividualPublicPagesTable
              loading={loading}
              rows={individualRows}
              onOpen={openPublicPage}
              onCopy={copyLink}
              onUnpublish={unpublishCard}
            />
          </div>
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/5">
          <div className="flex items-start justify-between gap-4 border-b border-white/10 p-6">
            <div>
              <h2 className="text-2xl font-semibold">
                Business & Enterprise Public Pages
              </h2>
              <p className="mt-1 text-sm text-white/45">
                Company-level public card management and reporting.
              </p>
            </div>
            <span className="rounded-full border border-[#AC00FF]/30 bg-[#AC00FF]/15 px-3 py-1 text-xs font-medium text-purple-100">
              {companyGroups.length} companies
            </span>
          </div>

          <div className="max-h-[720px] overflow-y-auto p-6">
            <BusinessPublicPagesTable
              loading={loading}
              groups={companyGroups}
              expandedCompany={expandedCompany}
              onToggleCompany={(id) =>
                setExpandedCompany((current) => (current === id ? null : id))
              }
              onOpen={openPublicPage}
              onCopy={copyLink}
              onUnpublish={unpublishCard}
              onStats={(group) =>
                setStatsTarget({ title: group.companyName, cards: group.cards })
              }
              onDownloadReport={downloadCompanyReport}
            />
          </div>
        </div>
      </section>

      {statsTarget && (
        <StatsModal
          title={statsTarget.title}
          onClose={() => setStatsTarget(null)}
        />
      )}
    </main>
  );
}

function IndividualPublicPagesTable({
  loading,
  rows,
  onOpen,
  onCopy,
  onUnpublish,
}: {
  loading: boolean;
  rows: PublicPageRow[];
  onOpen: (slug: string | null) => void;
  onCopy: (slug: string | null) => void;
  onUnpublish: (card: Card) => void;
}) {
  if (loading) return <p className="text-sm text-white/45">Loading public pages...</p>;

  if (rows.length === 0) {
    return (
      <EmptyState message="Published public pages will appear here after cards are published." />
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-white/10">
      <table className="w-full text-left text-sm">
        <thead className="sticky top-0 z-10 bg-[#101935] text-xs uppercase tracking-[0.14em] text-white/40">
          <tr>
            <th className="px-4 py-3 font-medium">Name</th>
            <th className="px-4 py-3 font-medium">Email</th>
            <th className="px-4 py-3 font-medium">Template</th>
            <th className="px-4 py-3 font-medium">Public URL</th>
            <th className="px-4 py-3 font-medium">Views</th>
            <th className="px-4 py-3 font-medium">Saves</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/10">
          {rows.map((card) => (
            <tr key={card.id} className="hover:bg-white/5">
              <td className="px-4 py-3 font-medium">
                {card.full_name || card.card_name || "Untitled card"}
              </td>
              <td className="px-4 py-3 text-white/60">{card.email || "-"}</td>
              <td className="px-4 py-3 text-white/60">
                {card.template?.name || "Unknown template"}
              </td>
              <td className="px-4 py-3">
                <PublicUrl slug={card.slug} onCopy={onCopy} onOpen={onOpen} />
              </td>
              <td className="px-4 py-3 text-white/60">0</td>
              <td className="px-4 py-3 text-white/60">0</td>
              <td className="px-4 py-3">
                <StatusBadge status={card.is_published ? "published" : "draft"} />
              </td>
              <td className="px-4 py-3">
                <StaffActions
                  card={card}
                  onOpen={onOpen}
                  onCopy={onCopy}
                  onUnpublish={onUnpublish}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BusinessPublicPagesTable({
  loading,
  groups,
  expandedCompany,
  onToggleCompany,
  onOpen,
  onCopy,
  onUnpublish,
  onStats,
  onDownloadReport,
}: {
  loading: boolean;
  groups: CompanyGroup[];
  expandedCompany: string | null;
  onToggleCompany: (id: string) => void;
  onOpen: (slug: string | null) => void;
  onCopy: (slug: string | null) => void;
  onUnpublish: (card: Card) => void;
  onStats: (group: CompanyGroup) => void;
  onDownloadReport: (group: CompanyGroup) => void;
}) {
  if (loading) return <p className="text-sm text-white/45">Loading company pages...</p>;

  if (groups.length === 0) {
    return (
      <EmptyState message="Business and enterprise public pages will appear here after cards are published." />
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-white/10">
      <table className="w-full text-left text-sm">
        <thead className="sticky top-0 z-10 bg-[#101935] text-xs uppercase tracking-[0.14em] text-white/40">
          <tr>
            <th className="px-4 py-3 font-medium">Company</th>
            <th className="px-4 py-3 font-medium">Account Type</th>
            <th className="px-4 py-3 font-medium">Published Cards</th>
            <th className="px-4 py-3 font-medium">Total Users</th>
            <th className="px-4 py-3 font-medium">Total Views</th>
            <th className="px-4 py-3 font-medium">Total Saves</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/10">
          {groups.map((group) => {
            const expanded = expandedCompany === group.client.id;
            const publishedCards = group.cards.filter((card) => card.is_published);

            return (
              <Fragment key={group.client.id}>
                <tr className="hover:bg-white/5">
                  <td className="px-4 py-3 font-medium">{group.companyName}</td>
                  <td className="px-4 py-3 capitalize text-white/60">
                    {group.client.account_type}
                  </td>
                  <td className="px-4 py-3 text-white/60">
                    {publishedCards.length}
                  </td>
                  <td className="px-4 py-3 text-white/60">
                    {group.cards.length}
                  </td>
                  <td className="px-4 py-3 text-white/60">0</td>
                  <td className="px-4 py-3 text-white/60">0</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={publishedCards.length ? "published" : "draft"} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={() => onToggleCompany(group.client.id)}
                        className="text-sm text-blue-300 hover:text-blue-200"
                      >
                        View Company Pages
                      </button>
                      <button
                        type="button"
                        onClick={() => onStats(group)}
                        className="text-sm text-purple-300 hover:text-purple-200"
                      >
                        Stats
                      </button>
                      <button
                        type="button"
                        onClick={() => onDownloadReport(group)}
                        className="text-sm text-green-300 hover:text-green-200"
                      >
                        Download Report
                      </button>
                    </div>
                  </td>
                </tr>

                {expanded && (
                  <tr className="bg-[#101935]/50">
                    <td colSpan={8} className="p-5">
                      <CompanyPagesPanel
                        cards={group.cards}
                        onOpen={onOpen}
                        onCopy={onCopy}
                        onUnpublish={onUnpublish}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CompanyPagesPanel({
  cards,
  onOpen,
  onCopy,
  onUnpublish,
}: {
  cards: PublicPageRow[];
  onOpen: (slug: string | null) => void;
  onCopy: (slug: string | null) => void;
  onUnpublish: (card: Card) => void;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
      <h3 className="font-semibold">Staff Public Pages</h3>
      <div className="mt-4 overflow-hidden rounded-2xl border border-white/10">
        <table className="w-full text-left text-sm">
          <thead className="bg-[#101935] text-xs uppercase tracking-[0.14em] text-white/40">
            <tr>
              <th className="px-4 py-3 font-medium">Full Name</th>
              <th className="px-4 py-3 font-medium">Job Title</th>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Public URL</th>
              <th className="px-4 py-3 font-medium">Views</th>
              <th className="px-4 py-3 font-medium">Saves</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {cards.map((card) => (
              <tr key={card.id}>
                <td className="px-4 py-3 font-medium">
                  {card.full_name || card.card_name || "Untitled card"}
                </td>
                <td className="px-4 py-3 text-white/60">
                  {card.job_title || "-"}
                </td>
                <td className="px-4 py-3 text-white/60">{card.email || "-"}</td>
                <td className="px-4 py-3">
                  <PublicUrl slug={card.slug} onCopy={onCopy} onOpen={onOpen} />
                </td>
                <td className="px-4 py-3 text-white/60">0</td>
                <td className="px-4 py-3 text-white/60">0</td>
                <td className="px-4 py-3">
                  <StatusBadge status={card.is_published ? "published" : "draft"} />
                </td>
                <td className="px-4 py-3">
                  <StaffActions
                    card={card}
                    onOpen={onOpen}
                    onCopy={onCopy}
                    onUnpublish={onUnpublish}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: number;
  muted?: boolean;
}) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-2xl shadow-[#AC00FF]/5">
      <p className="text-xs font-medium uppercase tracking-[0.16em] text-white/35">
        {label}
      </p>
      <p className={`mt-4 text-4xl font-semibold ${muted ? "text-white/55" : ""}`}>
        {value}
      </p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const published = status === "active" || status === "published";

  return (
    <span
      className={`rounded-full px-2.5 py-1 text-xs capitalize ${
        published ? "bg-green-500/20 text-green-300" : "bg-white/10 text-white/50"
      }`}
    >
      {published ? "Published" : status}
    </span>
  );
}

function PublicUrl({
  slug,
  onCopy,
  onOpen,
}: {
  slug: string | null;
  onCopy: (slug: string | null) => void;
  onOpen: (slug: string | null) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-white/65">
        {slug ? `/u/${slug}` : "No URL"}
      </span>
      <button
        type="button"
        onClick={() => onCopy(slug)}
        className="text-xs text-purple-300 hover:text-purple-200"
      >
        Copy
      </button>
      <button
        type="button"
        onClick={() => onOpen(slug)}
        className="text-xs text-blue-300 hover:text-blue-200"
      >
        Open
      </button>
    </div>
  );
}

function StaffActions({
  card,
  onOpen,
  onCopy,
  onUnpublish,
}: {
  card: Card;
  onOpen: (slug: string | null) => void;
  onCopy: (slug: string | null) => void;
  onUnpublish: (card: Card) => void;
}) {
  return (
    <div className="flex flex-wrap gap-3">
      <button
        type="button"
        onClick={() => onOpen(card.slug)}
        className="text-sm text-blue-300 hover:text-blue-200"
      >
        View Public Page
      </button>
      <button
        type="button"
        onClick={() => onCopy(card.slug)}
        className="text-sm text-purple-300 hover:text-purple-200"
      >
        Copy Link
      </button>
      <button
        type="button"
        onClick={() => onUnpublish(card)}
        className="text-sm text-yellow-300 hover:text-yellow-200"
      >
        Unpublish
      </button>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/15 bg-[#101935]/50 p-8 text-center">
      <h3 className="text-lg font-semibold">{message}</h3>
    </div>
  );
}

function StatsModal({
  title,
  onClose,
}: {
  title: string;
  onClose: () => void;
}) {
  const stats = [
    "Views",
    "Saves",
    "Shares",
    "QR scans",
    "NFC taps",
    "Wallet opens",
    "Last viewed date",
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
      <div className="w-full max-w-3xl rounded-3xl border border-white/10 bg-[#0F0E38] p-6 text-white shadow-2xl shadow-[#AC00FF]/20">
        <div className="flex items-start justify-between gap-6">
          <div>
            <h2 className="text-2xl font-semibold">Stats</h2>
            <p className="mt-1 text-sm text-white/45">{title}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl bg-white/10 px-5 py-2.5 text-sm font-medium transition hover:bg-white/15"
          >
            Close
          </button>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4">
          {stats.map((stat) => (
            <div
              key={stat}
              className="rounded-2xl border border-white/10 bg-white/5 p-5"
            >
              <p className="text-xs uppercase tracking-[0.16em] text-white/35">
                {stat}
              </p>
              <p className="mt-3 text-2xl font-semibold text-white/70">
                {stat === "Last viewed date" ? "-" : "0"}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function publicUrl(slug: string) {
  return `${window.location.origin}/u/${slug}`;
}

function csvCell(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
