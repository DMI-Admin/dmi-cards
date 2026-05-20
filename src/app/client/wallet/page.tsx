"use client";

import { useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  BadgeCheck,
  Check,
  CreditCard,
  Download,
  ImagePlus,
  Lock,
  Nfc,
  Palette,
  Share2,
  Smartphone,
  Sparkles,
  UserRound,
  WalletCards,
} from "lucide-react";
import ClientSidebar from "@/components/ClientSidebar";
import { supabase } from "@/lib/supabase";
import { ClientAuthRequiredError, requireClientUser } from "@/lib/client-auth";

const currentPlan = "free" as
  | "free"
  | "individual_pro"
  | "business"
  | "enterprise";
const isPaid = currentPlan !== "free";

const mockLinkedCard = {
  name: "Primary Digital Card",
  public_url: "/u/full-name",
  status: "published",
  full_name: "Full Name",
  role: "Creative Director",
  company_name: "DevMaster Inc",
};

type LinkedCard = typeof mockLinkedCard;
type WalletDevice = "iphone" | "android";

const freeWalletColours = [
  "#AC00FF",
  "#7C3AED",
  "#2563EB",
  "#059669",
  "#EF4444",
  "#0F172A",
];

const walletThemes = ["Minimal", "Professional", "Corporate", "Dark", "Light"];

export default function ClientWalletPage() {
  const [linkedCard, setLinkedCard] = useState<LinkedCard>(mockLinkedCard);
  const [walletDevice, setWalletDevice] = useState<WalletDevice>("iphone");
  const [selectedColour, setSelectedColour] = useState(freeWalletColours[0]);

  useEffect(() => {
    let ignore = false;

    async function loadLinkedCard() {
      try {
        const { user } = await requireClientUser();

        const { data, error } = await supabase
          .from("cards")
          .select("card_name, slug, is_published, status, full_name, job_title, company_name")
          .eq("user_id", user.id)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (ignore) return;

        if (error || !data) {
          if (error) console.error("Wallet card fetch failed", error);
          return;
        }

        setLinkedCard({
          name: data.card_name || "Primary Digital Card",
          public_url: `/u/${data.slug || "full-name"}`,
          status: data.is_published ? "published" : data.status || "draft",
          full_name: data.full_name || "Full Name",
          role: data.job_title || "Creative Director",
          company_name: data.company_name || "DevMaster Inc",
        });
      } catch (error) {
        if (!(error instanceof ClientAuthRequiredError)) {
          console.error("Wallet card load failed", error);
        }
      }
    }

    void loadLinkedCard();

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
              Preview and customise your Apple Wallet and Google Wallet digital
              business card.
            </p>
          </div>

          <span className="w-fit rounded-full border border-[#AC00FF]/30 bg-[#AC00FF]/15 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-purple-100">
            {currentPlan === "free" ? "Free Plan" : "Pro Plan"}
          </span>
        </div>

        <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <SummaryCard label="Linked Card" value={linkedCard.name} icon={CreditCard} />
          <SummaryCard label="Wallet Status" value="Not added yet" icon={WalletCards} />
          <SummaryCard label="Wallet Type" value="Apple + Google" icon={Smartphone} />
          <SummaryCard label="NFC Ready" value="Coming soon" icon={Nfc} />
        </div>

        <div className="mb-6 rounded-3xl border border-[#AC00FF]/25 bg-[#AC00FF]/10 p-5 shadow-lg shadow-purple-950/15">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="font-semibold text-purple-100">
                Upgrade to Individual Pro
              </p>
              <p className="mt-1 text-sm text-white/55">
                Upgrade to Individual Pro for custom wallet themes, logo passes,
                logo passes, NFC features, and advanced sharing.
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
                title="Wallet Settings"
                description="Choose the card, style, colour, and wallet pass features."
              />

              <div className="mt-6 space-y-6">
                <SettingsBlock title="Linked Card">
                  <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
                    <select className="inputStyle">
                      <option>{linkedCard.name}</option>
                    </select>
                    <StatusBadge status={linkedCard.status} />
                  </div>
                </SettingsBlock>

                <SettingsBlock title="Wallet Theme">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                    {walletThemes.map((style, index) => (
                      <button
                        key={style}
                        type="button"
                        className={`rounded-2xl border px-4 py-3 text-left text-sm font-semibold transition ${
                          index === 0
                            ? "border-[#AC00FF]/45 bg-[#AC00FF]/15 text-white shadow-lg shadow-purple-500/10"
                            : "border-white/10 bg-white/5 text-white/60 hover:border-[#AC00FF]/35 hover:text-white"
                        }`}
                      >
                        {style}
                      </button>
                    ))}
                  </div>
                  {!isPaid && (
                    <LockedMessage>
                      Professional, corporate, dark, and light wallet themes
                      unlock with Individual Pro.
                    </LockedMessage>
                  )}
                </SettingsBlock>

                <SettingsBlock title="Wallet Colour">
                  {isPaid ? (
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                      <div className="flex items-center gap-3">
                        <Palette className="h-5 w-5 text-purple-200" />
                        <div>
                          <p className="font-semibold">Full colour controls</p>
                          <p className="mt-1 text-sm text-white/45">
                            Colour picker placeholder for paid wallet themes.
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <p className="text-sm text-white/45">
                        Free users can choose from admin-approved wallet colours.
                      </p>
                      <div className="mt-4 flex flex-wrap gap-3">
                        {freeWalletColours.map((colour) => (
                          <button
                            key={colour}
                            type="button"
                            onClick={() => setSelectedColour(colour)}
                            className={`flex h-12 w-12 items-center justify-center rounded-2xl border transition ${
                              selectedColour === colour
                                ? "border-white shadow-lg shadow-purple-500/30"
                                : "border-white/10 hover:border-white/30"
                            }`}
                            style={{ backgroundColor: colour }}
                            aria-label={`Select ${colour}`}
                          >
                            {selectedColour === colour && <Check className="h-5 w-5" />}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </SettingsBlock>

                <SettingsBlock title="Wallet Logo">
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
                          Placeholder upload for branded wallet passes.
                        </span>
                      </span>
                    </button>
                  ) : (
                    <LockedCard message="Upgrade to Individual Pro to add your logo to wallet passes." />
                  )}
                </SettingsBlock>

                <SettingsBlock title="Wallet Features">
                  <div className="grid gap-3 md:grid-cols-2">
                    <FeatureToggle label="Show QR code" enabled />
                    <FeatureToggle label="Show profile photo" enabled />
                    <FeatureToggle label="Show company logo" locked={!isPaid} />
                    <FeatureToggle label="Show save contact shortcut" locked={!isPaid} />
                  </div>
                </SettingsBlock>

                <SettingsBlock title="Wallet Actions">
                  <div className="flex flex-wrap gap-3">
                    <ActionButton icon={WalletCards}>Add to Apple Wallet</ActionButton>
                    <ActionButton icon={Smartphone}>Add to Google Wallet</ActionButton>
                    <ActionButton icon={Download}>Download Pass</ActionButton>
                    <ActionButton icon={Share2}>Share Wallet Pass</ActionButton>
                  </div>
                </SettingsBlock>
              </div>
            </section>
          </div>

          <aside className="xl:sticky xl:top-8 xl:self-start">
            <section className="rounded-3xl border border-white/10 bg-[#101935]/70 p-6 shadow-2xl shadow-black/20">
              <SectionTitle
                title="Live Wallet Preview"
                description="Preview how your wallet pass will appear."
              />

              <div className="mt-5 grid grid-cols-2 gap-3">
                {[
                  { key: "iphone", label: "iPhone Wallet" },
                  { key: "android", label: "Android Wallet" },
                ].map((device) => (
                  <button
                    key={device.key}
                    type="button"
                    onClick={() => setWalletDevice(device.key as WalletDevice)}
                    className={`rounded-2xl border px-4 py-3 text-sm font-semibold transition ${
                      walletDevice === device.key
                        ? "border-[#AC00FF]/60 bg-[#AC00FF]/15 text-white"
                        : "border-white/10 bg-white/5 text-white/55 hover:bg-white/10"
                    }`}
                  >
                    {device.label}
                  </button>
                ))}
              </div>

              <div className="mt-6 rounded-[2rem] border border-[#AC00FF]/25 bg-gradient-to-br from-[#1B1241] via-[#101935] to-[#070B1A] p-5 shadow-inner shadow-white/5">
                <WalletPreview
                  card={linkedCard}
                  colour={selectedColour}
                  device={walletDevice}
                />
              </div>

              <p className="mt-5 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm leading-6 text-white/50">
                Wallet passes will connect to your published public card URL.
              </p>
            </section>
          </aside>
        </div>
      </section>
    </main>
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

function StatusBadge({ status }: { status: string }) {
  const published = status === "published";

  return (
    <span
      className={`inline-flex w-fit items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold ${
        published
          ? "border-green-400/20 bg-green-500/15 text-green-200"
          : "border-yellow-400/20 bg-yellow-500/15 text-yellow-100"
      }`}
    >
      <span
        className={`h-2 w-2 rounded-full ${
          published ? "bg-green-300" : "bg-yellow-300"
        }`}
      />
      {published ? "Published" : "Draft"}
    </span>
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

function LockedCard({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
      <div className="flex gap-4">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10">
          <Lock className="h-5 w-5 text-white/50" />
        </div>
        <div>
          <p className="font-semibold">{message}</p>
          <p className="mt-1 text-sm text-white/45">
            Branded wallet passes are available on paid plans.
          </p>
        </div>
      </div>
    </div>
  );
}

function FeatureToggle({
  label,
  enabled = false,
  locked = false,
}: {
  label: string;
  enabled?: boolean;
  locked?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between rounded-2xl border px-4 py-3 ${
        locked
          ? "border-white/10 bg-white/[0.03] text-white/40"
          : "border-[#AC00FF]/30 bg-[#AC00FF]/10 text-white"
      }`}
    >
      <span className="text-sm font-medium">{label}</span>
      {locked ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em]">
          <Lock className="h-3 w-3" />
          Pro
        </span>
      ) : (
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ${
            enabled ? "bg-[#AC00FF]/25 text-purple-100" : "bg-white/10 text-white/50"
          }`}
        >
          {enabled ? "On" : "Off"}
        </span>
      )}
    </div>
  );
}

function ActionButton({
  icon: Icon,
  children,
}: {
  icon: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:border-[#AC00FF]/50 hover:bg-[#AC00FF]/15 hover:shadow-lg hover:shadow-purple-500/10"
    >
      <Icon className="h-4 w-4" />
      {children}
    </button>
  );
}

function WalletPreview({
  card,
  colour,
  device,
}: {
  card: LinkedCard;
  colour: string;
  device: WalletDevice;
}) {
  if (device === "android") {
    return <GoogleWalletPreview card={card} colour={colour} />;
  }

  return <AppleWalletPreview card={card} colour={colour} />;
}

function AppleWalletPreview({
  card,
  colour,
}: {
  card: LinkedCard;
  colour: string;
}) {
  return (
    <div className="mx-auto max-w-sm">
      <div className="mb-4 flex items-center justify-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-white/40">
        <WalletCards className="h-4 w-4 text-purple-200" />
        Apple Wallet Pass Preview
      </div>

      <div
        className="overflow-hidden rounded-[2rem] border border-white/20 shadow-2xl shadow-black/30"
        style={{ backgroundColor: colour }}
      >
        <div className="p-5">
          <div className="flex items-center justify-between gap-4 border-b border-white/20 pb-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/18">
                <WalletCards className="h-5 w-5 text-white" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/60">
                  DMI Cards
                </p>
                <p className="text-sm font-semibold">{card.name}</p>
              </div>
            </div>
            <span className="rounded-full bg-white/15 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/75">
              Pass
            </span>
          </div>

          <div className="py-6">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/55">
              Digital Business Card
            </p>
            <h3 className="mt-2 text-3xl font-bold tracking-tight">
              {card.full_name}
            </h3>
            <div className="mt-5 grid grid-cols-2 gap-4">
              <div>
                <p className="text-[10px] uppercase tracking-[0.16em] text-white/50">
                  Role
                </p>
                <p className="mt-1 text-sm font-semibold">{card.role}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-[0.16em] text-white/50">
                  Company
                </p>
                <p className="mt-1 text-sm font-semibold">{card.company_name}</p>
              </div>
            </div>
          </div>

          <div className="rounded-[1.65rem] bg-white p-4 text-[#0F172A]">
            <CssQrPreview />
            <p className="mt-3 text-center text-xs font-semibold text-slate-500">
              {card.public_url}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function GoogleWalletPreview({
  card,
  colour,
}: {
  card: LinkedCard;
  colour: string;
}) {
  return (
    <div className="mx-auto max-w-sm">
      <div className="mb-4 flex items-center justify-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-white/40">
        <Smartphone className="h-4 w-4 text-purple-200" />
        Google Wallet Pass Preview
      </div>

      <div className="overflow-hidden rounded-[1.6rem] border border-white/20 bg-[#F8FAFC] text-[#111827] shadow-2xl shadow-black/30">
        <div
          className="flex h-28 items-end justify-between px-5 pb-4 text-white"
          style={{ backgroundColor: colour }}
        >
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/65">
              DMI Cards
            </p>
            <p className="mt-1 text-lg font-bold">{card.company_name}</p>
          </div>
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/20">
            <UserRound className="h-7 w-7 text-white" />
          </div>
        </div>

        <div className="space-y-4 p-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              Digital Business Card
            </p>
            <h3 className="mt-1 text-2xl font-bold text-slate-950">
              {card.full_name}
            </h3>
          </div>

          <div className="divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white">
            <GoogleWalletRow label="Role" value={card.role} />
            <GoogleWalletRow label="Company" value={card.company_name} />
            <GoogleWalletRow label="Public card" value={card.public_url} />
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-4">
            <CssQrPreview />
            <p className="mt-3 text-center text-xs font-semibold text-slate-500">
              Opens public digital card
            </p>
          </div>

          <button
            type="button"
            className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-bold text-white"
          >
            <BadgeCheck className="h-4 w-4" />
            Save Contact
          </button>
        </div>
      </div>
    </div>
  );
}

function GoogleWalletRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
        {label}
      </span>
      <span className="truncate text-right text-sm font-semibold text-slate-950">
        {value}
      </span>
    </div>
  );
}

function CssQrPreview() {
  const cells = Array.from({ length: 81 }, (_, index) => {
    const row = Math.floor(index / 9);
    const col = index % 9;
    const marker =
      (row < 3 && col < 3) ||
      (row < 3 && col > 5) ||
      (row > 5 && col < 3);
    const patterned = marker || (row * 5 + col * 3) % 4 === 0;

    return (
      <span
        key={`${row}-${col}`}
        className={`rounded-[3px] ${
          patterned ? "bg-[#0F172A]" : "bg-transparent"
        }`}
      />
    );
  });

  return (
    <div className="mx-auto grid aspect-square w-full max-w-[190px] grid-cols-9 gap-1 rounded-2xl bg-white p-2">
      {cells}
    </div>
  );
}
