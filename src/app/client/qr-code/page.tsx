"use client";

import { useEffect, useState } from "react";
import {
  BarChart3,
  Check,
  Copy,
  Download,
  ExternalLink,
  ImagePlus,
  Lock,
  Palette,
  Printer,
  QrCode,
  Sparkles,
} from "lucide-react";
import ClientSidebar from "@/components/ClientSidebar";
import { supabase } from "@/lib/supabase";

const currentPlan = "free" as
  | "free"
  | "individual_pro"
  | "business"
  | "enterprise";
const isPaid = currentPlan !== "free";
const clientCardsStorageKey = "dmi-client-cards-v1";

const mockSelectedCard = {
  name: "Primary Digital Card",
  public_url: "/u/full-name",
  status: "published",
};

type SavedQrCard = {
  name: string;
  public_url: string;
  status: string;
};

const freeQrColours = [
  "#AC00FF",
  "#7C3AED",
  "#2563EB",
  "#059669",
  "#EF4444",
  "#0F172A",
];

const qrStyles = isPaid
  ? ["Classic", "Rounded", "Dots", "Modern", "Minimal"]
  : ["Classic"];

export default function ClientQrCodePage() {
  const [selectedCard, setSelectedCard] =
    useState<SavedQrCard>(mockSelectedCard);

  useEffect(() => {
    let ignore = false;

    async function loadSavedCard() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        const localCard = readLocalQrCard();
        if (!ignore && localCard) setSelectedCard(localCard);
        return;
      }

      const { data, error } = await supabase
        .from("cards")
        .select("card_name, slug, is_published, status")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (ignore) return;

      if (error || !data) {
        const localCard = readLocalQrCard();
        if (localCard) setSelectedCard(localCard);
        return;
      }

      setSelectedCard({
        name: data.card_name || "Primary Digital Card",
        public_url: `/u/${data.slug || "full-name"}`,
        status: data.is_published ? "published" : data.status || "draft",
      });
    }

    void loadSavedCard();

    return () => {
      ignore = true;
    };
  }, []);

  async function copyPublicLink() {
    await navigator.clipboard?.writeText(selectedCard.public_url);
  }

  function printQr() {
    window.print();
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
            <h1 className="mt-3 text-4xl font-bold">QR Code</h1>
            <p className="mt-3 max-w-3xl text-white/50">
              Create and download a QR code for your public digital business
              card.
            </p>
          </div>

          <span className="w-fit rounded-full border border-[#AC00FF]/30 bg-[#AC00FF]/15 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-purple-100">
            {currentPlan === "free" ? "Free Plan" : "Pro Plan"}
          </span>
        </div>

        <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <SummaryCard
            label="Linked Card"
            value={selectedCard.name}
            icon={QrCode}
          />
          <SummaryCard
            label="Public URL"
            value={selectedCard.public_url}
            icon={ExternalLink}
          />
          <SummaryCard label="QR Status" value="Ready" icon={Check} />
          <SummaryCard label="Total Scans" value="Coming soon" icon={BarChart3} />
        </div>

        <div className="mb-6 rounded-3xl border border-[#AC00FF]/25 bg-[#AC00FF]/10 p-5 shadow-lg shadow-purple-950/15">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="font-semibold text-purple-100">
                Upgrade to Individual Pro
              </p>
              <p className="mt-1 text-sm text-white/55">
                Upgrade to Individual Pro for custom QR styles, logo QR codes,
                SVG downloads, and scan analytics.
              </p>
            </div>
            <button
              type="button"
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#AC00FF] to-[#6C2CFF] px-5 py-3 text-sm font-semibold shadow-lg shadow-purple-500/20 transition hover:shadow-purple-500/35"
            >
              <Sparkles className="h-4 w-4" />
              View Upgrade
            </button>
          </div>
        </div>

        <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_430px]">
          <div className="space-y-6">
            <section className="rounded-3xl border border-white/10 bg-[#101935]/70 p-6 shadow-2xl shadow-black/20">
              <SectionTitle
                title="QR Settings"
                description="Choose the card, style, colour, and download format."
              />

              <div className="mt-6 space-y-6">
                <SettingsBlock title="Select Card">
                  <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
                    <select className="inputStyle">
                      <option>{selectedCard.name}</option>
                    </select>
                    <span className="inline-flex w-fit items-center gap-2 rounded-full border border-green-400/20 bg-green-500/15 px-3 py-2 text-xs font-semibold text-green-200">
                      <span className="h-2 w-2 rounded-full bg-green-300" />
                      Published
                    </span>
                  </div>
                </SettingsBlock>

                <SettingsBlock title="QR Style">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                    {qrStyles.map((style) => (
                      <button
                        key={style}
                        type="button"
                        className="rounded-2xl border border-[#AC00FF]/45 bg-[#AC00FF]/15 px-4 py-3 text-left text-sm font-semibold text-white shadow-lg shadow-purple-500/10"
                      >
                        {style}
                      </button>
                    ))}
                  </div>

                  {!isPaid && (
                    <LockedMessage>
                      Rounded, dots, modern, and minimal styles unlock with
                      Individual Pro.
                    </LockedMessage>
                  )}
                </SettingsBlock>

                <SettingsBlock title="QR Colour">
                  {isPaid ? (
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                      <div className="flex items-center gap-3">
                        <Palette className="h-5 w-5 text-purple-200" />
                        <div>
                          <p className="font-semibold">Custom colour picker</p>
                          <p className="mt-1 text-sm text-white/45">
                            Colour picker and gradient controls will appear here.
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <p className="text-sm text-white/45">
                        Free users can choose from admin-approved QR colours.
                      </p>
                      <div className="mt-4 flex flex-wrap gap-3">
                        {freeQrColours.map((colour, index) => (
                          <button
                            key={colour}
                            type="button"
                            className={`flex h-12 w-12 items-center justify-center rounded-2xl border transition ${
                              index === 0
                                ? "border-white shadow-lg shadow-purple-500/30"
                                : "border-white/10 hover:border-white/30"
                            }`}
                            style={{ backgroundColor: colour }}
                            aria-label={`Select ${colour}`}
                          >
                            {index === 0 && <Check className="h-5 w-5" />}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </SettingsBlock>

                <SettingsBlock title="Logo in QR">
                  {isPaid ? (
                    <button
                      type="button"
                      className="flex w-full items-center gap-4 rounded-2xl border border-dashed border-[#AC00FF]/35 bg-[#AC00FF]/10 p-5 text-left transition hover:border-[#AC00FF]/60 hover:bg-[#AC00FF]/15"
                    >
                      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#AC00FF]/20">
                        <ImagePlus className="h-5 w-5 text-purple-100" />
                      </span>
                      <span>
                        <span className="block font-semibold">Upload logo</span>
                        <span className="mt-1 block text-sm text-white/45">
                          Placeholder upload for branded QR codes.
                        </span>
                      </span>
                    </button>
                  ) : (
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                      <div className="flex gap-4">
                        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10">
                          <Lock className="h-5 w-5 text-white/50" />
                        </div>
                        <div>
                          <p className="font-semibold">
                            Upgrade to Individual Pro to add your logo to QR
                            codes.
                          </p>
                          <p className="mt-1 text-sm text-white/45">
                            Logo QR codes help clients recognise your brand at
                            a glance.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </SettingsBlock>

                <SettingsBlock title="Download">
                  <div className="flex flex-wrap gap-3">
                    <ActionButton icon={Download}>Download PNG</ActionButton>
                    <ActionButton icon={Printer} onClick={printQr}>
                      Print QR
                    </ActionButton>
                    <button
                      type="button"
                      disabled={!isPaid}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white/45 transition enabled:text-white enabled:hover:border-[#AC00FF]/50 enabled:hover:bg-[#AC00FF]/15 disabled:cursor-not-allowed"
                    >
                      <Lock className="h-4 w-4" />
                      Download SVG
                    </button>
                  </div>
                </SettingsBlock>
              </div>
            </section>
          </div>

          <aside className="xl:sticky xl:top-8 xl:self-start">
            <section className="rounded-3xl border border-white/10 bg-[#101935]/70 p-6 shadow-2xl shadow-black/20">
              <SectionTitle
                title="Live QR Preview"
                description="Preview the QR code clients will scan."
              />

              <div className="mt-6 rounded-[2rem] border border-[#AC00FF]/25 bg-gradient-to-br from-[#1B1241] via-[#101935] to-[#070B1A] p-6 shadow-inner shadow-white/5">
                <div className="rounded-3xl bg-white p-5 text-[#0F172A] shadow-2xl shadow-purple-950/30">
                  <CssQrPreview />
                  <div className="mt-5 text-center">
                    <p className="text-sm font-semibold">Scan to open</p>
                    <p className="mt-1 text-sm text-slate-500">
                      {selectedCard.public_url}
                    </p>
                  </div>
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <ActionButton icon={Copy} onClick={copyPublicLink}>
                    Copy Public Link
                  </ActionButton>
                  <ActionButton icon={ExternalLink}>View Public Page</ActionButton>
                  <ActionButton icon={Download}>Download PNG</ActionButton>
                  <ActionButton icon={Printer} onClick={printQr}>
                    Print
                  </ActionButton>
                </div>
              </div>
            </section>
          </aside>
        </div>
      </section>
    </main>
  );
}

function readLocalQrCard() {
  if (typeof window === "undefined") return null;

  try {
    const stored = window.localStorage.getItem(clientCardsStorageKey);
    if (!stored) return null;

    const cards = JSON.parse(stored);
    if (!Array.isArray(cards) || cards.length === 0) return null;

    const card = cards[0] as {
      card_name?: string;
      public_url?: string;
      slug?: string;
      status?: string;
    };

    return {
      name: card.card_name || "Primary Digital Card",
      public_url: card.public_url || `/u/${card.slug || "full-name"}`,
      status: card.status || "draft",
    };
  } catch (error) {
    console.error("Failed to load local QR card", error);
    return null;
  }
}

function SummaryCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: typeof QrCode;
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

function SettingsBlock({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
      <p className="mb-4 text-sm font-semibold uppercase tracking-[0.18em] text-white/45">
        {title}
      </p>
      {children}
    </div>
  );
}

function LockedMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 flex items-start gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/50">
      <Lock className="mt-0.5 h-4 w-4 shrink-0 text-white/40" />
      <p>{children}</p>
    </div>
  );
}

function ActionButton({
  icon: Icon,
  children,
  onClick,
}: {
  icon: typeof QrCode;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:border-[#AC00FF]/50 hover:bg-[#AC00FF]/15 hover:shadow-lg hover:shadow-purple-500/10"
    >
      <Icon className="h-4 w-4" />
      {children}
    </button>
  );
}

function CssQrPreview() {
  const cells = Array.from({ length: 121 }, (_, index) => {
    const row = Math.floor(index / 11);
    const col = index % 11;
    const inTopLeft = row < 3 && col < 3;
    const inTopRight = row < 3 && col > 7;
    const inBottomLeft = row > 7 && col < 3;
    const patterned =
      inTopLeft ||
      inTopRight ||
      inBottomLeft ||
      (row * 7 + col * 5) % 4 === 0 ||
      (row + col) % 7 === 0;

    return (
      <span
        key={`${row}-${col}`}
        className={`rounded-[4px] ${patterned ? "bg-[#0F172A]" : "bg-transparent"}`}
      />
    );
  });

  return (
    <div className="mx-auto grid aspect-square w-full max-w-[280px] grid-cols-11 gap-1 rounded-3xl bg-white p-3">
      {cells}
    </div>
  );
}
