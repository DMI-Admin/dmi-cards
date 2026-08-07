"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CreditCard,
  Loader2,
  ExternalLink,
  QrCode,
  Smartphone,
  UserRound,
  WalletCards,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import ClientSidebar from "@/components/ClientSidebar";
import { supabase } from "@/lib/supabase";
import { ClientAuthRequiredError, requireClientUser } from "@/lib/client-auth";
import { getPublishedCardForUser } from "@/lib/services/card-service";

type PublishedWalletCard = {
  id: string;
  name: string;
  publicUrl: string;
  publicPath: string;
  fullName: string;
  company: string;
  jobTitle: string;
  profileImageUrl: string;
};

type SupabaseWalletCard = {
  id: string;
  card_name?: string | null;
  slug?: string | null;
  full_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  company_name?: string | null;
  job_title?: string | null;
  profile_image_url?: string | null;
};

export default function ClientWalletPage() {
  const [card, setCard] = useState<PublishedWalletCard | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let ignore = false;

    async function loadPublishedCard() {
      setLoading(true);
      setLoadError("");

      try {
        const { user } = await requireClientUser();

        const { data, error } = await getPublishedCardForUser(user.id);

        if (ignore) return;

        if (error) {
          console.error("Wallet published card fetch failed", error);
          setLoadError("Could not load your published card.");
          setCard(null);
          return;
        }

        setCard(data ? normalizeWalletCard(data as SupabaseWalletCard) : null);
      } catch (error) {
        if (ignore) return;

        if (error instanceof ClientAuthRequiredError) {
          setLoadError("Please sign in to manage Wallet.");
          return;
        }

        console.error("Wallet card load failed", error);
        setLoadError("Could not load Wallet details.");
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    void loadPublishedCard();

    return () => {
      ignore = true;
    };
  }, []);

  return (
    <main className="flex min-h-screen bg-[#070B1A] text-white">
      <ClientSidebar />

      <section className="flex-1 p-10">
        <div className="mb-8 flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#AC00FF]">
              Client Portal
            </p>
            <h1 className="mt-3 text-4xl font-bold">Wallet</h1>
            <p className="mt-3 max-w-3xl text-white/50">
              Add your published DMI card to Apple Wallet or Google Wallet when
              wallet credentials are configured.
            </p>
          </div>

          <span className="w-fit rounded-full border border-[#AC00FF]/30 bg-[#AC00FF]/15 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-purple-100">
            Free Plan
          </span>
        </div>

        {loading ? (
          <MessageCard
            icon={WalletCards}
            title="Loading Wallet details..."
            message="Checking for your latest published card."
          />
        ) : loadError ? (
          <MessageCard icon={AlertCircle} title="Wallet unavailable" message={loadError} />
        ) : !card ? (
          <PublishFirstState />
        ) : (
          <WalletReadyState card={card} />
        )}
      </section>
    </main>
  );
}

function WalletReadyState({ card }: { card: PublishedWalletCard }) {
  const [appleLoading, setAppleLoading] = useState(false);
  const [appleError, setAppleError] = useState("");

  async function handleAppleWalletDownload() {
    if (appleLoading) return;

    setAppleLoading(true);
    setAppleError("");

    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError || !session?.access_token) {
        setAppleError("Please sign in again before adding this pass.");
        return;
      }

      const response = await fetch(`/api/client/wallet/apple/${encodeURIComponent(card.id)}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        cache: "no-store",
      });

      if (!response.ok) {
        setAppleError(await appleWalletErrorMessage(response));
        return;
      }

      const passBlob = await response.blob();
      const downloadUrl = URL.createObjectURL(passBlob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = `dmi-card-${safeFileId(card.id)}.pkpass`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 30_000);
    } catch (error) {
      console.error("Apple Wallet download failed", error);
      setAppleError("Could not generate your Apple Wallet pass. Please try again.");
    } finally {
      setAppleLoading(false);
    }
  }

  return (
    <>
      <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Linked Card" value={card.name} icon={CreditCard} />
        <SummaryCard label="Wallet Status" value="Setup required" icon={WalletCards} />
        <SummaryCard label="Pass Source" value="Published card" icon={QrCode} />
        <SummaryCard label="Public URL" value={card.publicPath} icon={ExternalLink} />
      </div>

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_430px]">
        <section className="rounded-3xl border border-white/10 bg-[#101935]/70 p-5 shadow-2xl shadow-black/20 sm:p-6">
          <SectionTitle
            title="Free Wallet Pass"
            description="This pass will be generated from your existing published card data. No separate wallet profile is created."
          />

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <CardDetail label="Full name" value={card.fullName} />
            <CardDetail label="Company" value={card.company} />
            <CardDetail label="Job title" value={card.jobTitle} />
            <CardDetail label="Destination" value={card.publicUrl} />
          </div>

          <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.04] p-5">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-white/45">
              Wallet Actions
            </p>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <AppleWalletButton
                icon={WalletCards}
                label="Add to Apple Wallet"
                loading={appleLoading}
                error={appleError}
                onClick={handleAppleWalletDownload}
              />
              <DisabledWalletButton
                icon={Smartphone}
                label="Add to Google Wallet"
                message="Google Wallet setup requires issuer credentials."
              />
            </div>
          </div>
        </section>

        <aside className="xl:sticky xl:top-8 xl:self-start">
          <section className="rounded-3xl border border-white/10 bg-[#101935]/70 p-5 shadow-2xl shadow-black/20 sm:p-6">
            <SectionTitle
              title="Pass Preview"
              description="Preview of the data the wallet pass will contain."
            />

            <div className="mt-6 rounded-[2rem] border border-[#AC00FF]/25 bg-gradient-to-br from-[#1B1241] via-[#101935] to-[#070B1A] p-3 shadow-inner shadow-white/5 sm:p-5">
              <WalletPassPreview card={card} />
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}

function AppleWalletButton({
  icon: Icon,
  label,
  loading,
  error,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  loading: boolean;
  error: string;
  onClick: () => void;
}) {
  return (
    <div className="rounded-2xl border border-[#AC00FF]/25 bg-[#AC00FF]/10 p-4">
      <button
        type="button"
        onClick={onClick}
        disabled={loading}
        className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-[#171123] shadow-lg shadow-purple-950/20 transition hover:bg-purple-50 disabled:cursor-wait disabled:bg-white/70"
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Icon className="h-4 w-4" />
        )}
        {loading ? "Generating Pass..." : label}
      </button>
      <p className="mt-3 text-sm leading-6 text-white/55">
        {error || "Creates a signed pass from your published DMI card."}
      </p>
    </div>
  );
}

function PublishFirstState() {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-6 text-center shadow-2xl shadow-black/20 sm:p-8">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#AC00FF]/15 text-purple-100">
        <WalletCards className="h-7 w-7" />
      </div>
      <h2 className="mt-6 text-2xl font-semibold">Publish a card first</h2>
      <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-white/50">
        Wallet passes use your published public card URL as their destination.
        Publish a card before Apple Wallet or Google Wallet setup can be used.
      </p>
      <a
        href="/client/cards"
        className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#AC00FF] to-[#6C2CFF] px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-purple-500/25 transition hover:shadow-purple-400/35 sm:w-auto"
      >
        <ExternalLink className="h-4 w-4" />
        Create or Publish Card
      </a>
    </div>
  );
}

function WalletPassPreview({ card }: { card: PublishedWalletCard }) {
  return (
    <div className="mx-auto w-full max-w-sm overflow-hidden rounded-[2rem] border border-white/20 bg-[#AC00FF] shadow-2xl shadow-black/30">
      <div className="p-4 sm:p-5">
        <div className="flex items-center justify-between gap-4 border-b border-white/20 pb-4">
          <div className="flex min-w-0 items-center gap-3">
            <ProfilePhoto card={card} />
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/60">
                DMI Cards
              </p>
              <p className="truncate text-sm font-semibold">{card.name}</p>
            </div>
          </div>
          <span className="shrink-0 rounded-full bg-white/15 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/75">
            Free
          </span>
        </div>

        <div className="py-6">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/55">
            Digital Business Card
          </p>
          <h3 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
            {card.fullName}
          </h3>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <PreviewField label="Company" value={card.company} />
            <PreviewField label="Job title" value={card.jobTitle} />
          </div>
        </div>

        <div className="rounded-[1.65rem] bg-white p-4 text-[#0F172A]">
          <CssQrPreview />
          <p className="mt-3 truncate text-center text-xs font-semibold text-slate-500">
            {card.publicUrl}
          </p>
        </div>
      </div>
    </div>
  );
}

function ProfilePhoto({ card }: { card: PublishedWalletCard }) {
  if (!card.profileImageUrl) {
    return (
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/18">
        <UserRound className="h-7 w-7 text-white" />
      </div>
    );
  }

  return (
    <div className="h-12 w-12 overflow-hidden rounded-2xl bg-white/18">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={card.profileImageUrl}
        alt=""
        className="h-full w-full object-cover"
      />
    </div>
  );
}

function SummaryCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
}) {
  return (
    <div className="min-h-32 rounded-3xl border border-white/10 bg-white/5 p-5 shadow-lg shadow-black/10">
      <div className="flex items-center justify-between gap-4">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/35">
          {label}
        </p>
        <Icon className="h-5 w-5 text-purple-200" />
      </div>
      <p className="mt-5 break-words text-2xl font-semibold tracking-tight">
        {value}
      </p>
    </div>
  );
}

function SectionTitle({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div>
      <h2 className="text-2xl font-semibold">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-white/45">{description}</p>
    </div>
  );
}

function CardDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/35">
        {label}
      </p>
      <p className="mt-2 break-words text-sm font-semibold text-white/85">
        {value}
      </p>
    </div>
  );
}

function DisabledWalletButton({
  icon: Icon,
  label,
  message,
}: {
  icon: LucideIcon;
  label: string;
  message: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <button
        type="button"
        disabled
        className="inline-flex min-h-12 w-full cursor-not-allowed items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white/35"
      >
        <Icon className="h-4 w-4" />
        {label}
      </button>
      <p className="mt-3 text-sm leading-6 text-white/50">{message}</p>
    </div>
  );
}

function PreviewField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.16em] text-white/50">
        {label}
      </p>
      <p className="mt-1 text-sm font-semibold">{value}</p>
    </div>
  );
}

function MessageCard({
  icon: Icon,
  title,
  message,
}: {
  icon: LucideIcon;
  title: string;
  message: string;
}) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-8 text-center shadow-2xl shadow-black/20">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#AC00FF]/15 text-purple-100">
        <Icon className="h-7 w-7" />
      </div>
      <h2 className="mt-6 text-2xl font-semibold">{title}</h2>
      <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-white/50">
        {message}
      </p>
    </div>
  );
}

function CssQrPreview() {
  const cells = useMemo(
    () =>
      Array.from({ length: 81 }, (_, index) => {
        const row = Math.floor(index / 9);
        const col = index % 9;
        const marker =
          (row < 3 && col < 3) ||
          (row < 3 && col > 5) ||
          (row > 5 && col < 3);

        return marker || (row * 5 + col * 3) % 4 === 0;
      }),
    []
  );

  return (
    <div className="mx-auto grid aspect-square w-full max-w-[190px] grid-cols-9 gap-1 rounded-2xl bg-white p-2">
      {cells.map((filled, index) => (
        <span
          key={index}
          className={`rounded-[3px] ${
            filled ? "bg-[#0F172A]" : "bg-transparent"
          }`}
        />
      ))}
    </div>
  );
}

function normalizeWalletCard(row: SupabaseWalletCard): PublishedWalletCard {
  const slug = row.slug || "";
  const publicPath = slug ? `/u/${slug}` : "";
  const publicUrl =
    typeof window === "undefined" || !publicPath
      ? publicPath
      : `${window.location.origin}${publicPath}`;
  const fullName =
    row.full_name ||
    [row.first_name, row.last_name].filter(Boolean).join(" ") ||
    "Full Name";
  const company = row.company_name || "Company";
  const jobTitle = row.job_title || "Job title";

  return {
    id: row.id,
    name: row.card_name || fullName,
    publicUrl,
    publicPath,
    fullName,
    company,
    jobTitle,
    profileImageUrl: row.profile_image_url || "",
  };
}

async function appleWalletErrorMessage(response: Response) {
  try {
    const body = (await response.json()) as { message?: string; code?: string };

    if (body.message) {
      return body.message;
    }
  } catch {
    // The API should return JSON for errors, but keep a readable fallback.
  }

  if (response.status === 401) return "Please sign in again before adding this pass.";
  if (response.status === 404) return "Could not find a published card for this account.";
  if (response.status === 409) return "Publish this card before adding it to Apple Wallet.";
  if (response.status === 503) return "Apple Wallet is not configured yet.";

  return "Could not generate your Apple Wallet pass. Please try again.";
}

function safeFileId(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
