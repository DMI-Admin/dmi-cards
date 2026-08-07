"use client";

import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Airplay,
  ArrowDown,
  BadgeCheck,
  CreditCard,
  Link2,
  Lock,
  Nfc,
  QrCode,
  Radio,
  Send,
  Share2,
  ShieldCheck,
  SmartphoneNfc,
  Sparkles,
  WalletCards,
  Wifi,
} from "lucide-react";
import ClientSidebar from "@/components/ClientSidebar";
import { clientFeaturePreviewPlans, isPaidPlan } from "@/lib/entitlements";

const currentPlan = clientFeaturePreviewPlans.tapToShare;
const isPaid = isPaidPlan(currentPlan);

const mockLinkedCard = {
  name: "Primary Digital Card",
  public_url: "/u/full-name",
  status: "Ready",
};

type DevicePreview = "iphone" | "android";

export default function ClientTapToSharePage() {
  const [devicePreview, setDevicePreview] = useState<DevicePreview>("iphone");

  return (
    <main className="flex min-h-screen bg-[#070B1A] text-white">
      <ClientSidebar />

      <section className="flex-1 p-10">
        <div className="mb-8 flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#AC00FF]">
              Client Portal
            </p>
            <h1 className="mt-3 text-4xl font-bold">Tap to Share</h1>
            <p className="mt-3 max-w-4xl text-white/50">
              Quickly share your digital business card across iPhone, Android,
              QR, Wallet, and direct links.
            </p>
          </div>

          <span className="w-fit rounded-full border border-[#AC00FF]/30 bg-[#AC00FF]/15 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-purple-100">
            {currentPlan === "free" ? "Free Plan" : "Pro Plan"}
          </span>
        </div>

        <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <SummaryCard label="Linked Card" value={mockLinkedCard.name} icon={CreditCard} />
          <SummaryCard label="Share Status" value={mockLinkedCard.status} icon={BadgeCheck} />
          <SummaryCard label="Public URL" value={mockLinkedCard.public_url} icon={Link2} />
          <SummaryCard label="NFC Ready" value="Coming soon" icon={Nfc} />
        </div>

        <div className="mb-6 rounded-3xl border border-[#AC00FF]/25 bg-[#AC00FF]/10 p-5 shadow-lg shadow-purple-950/15">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="font-semibold text-purple-100">
                Upgrade to Individual Pro
              </p>
              <p className="mt-1 text-sm text-white/55">
                Upgrade to Individual Pro for NFC sharing, smart device
                detection, advanced sharing analytics, and premium wallet
                experiences.
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

        <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_450px]">
          <div className="space-y-6">
            <section className="rounded-3xl border border-white/10 bg-[#101935]/70 p-6 shadow-2xl shadow-black/20">
              <SectionTitle
                title="Main Share Method"
                description="Choose how you want to share right now. Smart sharing will later pick the best method automatically."
              />

              <div className="mt-6 grid gap-4 lg:grid-cols-2">
                <ShareMethodCard
                  icon={QrCode}
                  title="QR Share"
                  description="Best for instant camera scanning"
                  actions={["Show QR preview"]}
                />
                <ShareMethodCard
                  icon={WalletCards}
                  title="Wallet Share"
                  description="Best for saved quick access"
                  actions={["Apple Wallet", "Google Wallet"]}
                />
                <ShareMethodCard
                  icon={Link2}
                  title="Direct Link Share"
                  description="Best for messaging and email"
                  actions={["Copy link", "Share sheet"]}
                />
                <TapShareCard />
              </div>
            </section>

            <section className="rounded-3xl border border-white/10 bg-[#101935]/70 p-6 shadow-2xl shadow-black/20">
              <SectionTitle
                title="Smart Share Flow"
                description="One unified sharing button will route people to the best sharing method for their device."
              />

              <div className="mt-6 rounded-3xl border border-[#AC00FF]/25 bg-[#AC00FF]/10 p-5">
                <div className="mx-auto flex max-w-xl flex-col items-center text-center">
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-[#AC00FF] to-[#6C2CFF] px-6 py-4 text-sm font-bold shadow-lg shadow-purple-500/25"
                  >
                    <SmartphoneNfc className="h-5 w-5" />
                    One Tap to Share
                  </button>
                  <ArrowDown className="my-4 h-5 w-5 text-purple-200" />

                  <div className="grid w-full gap-4 md:grid-cols-2">
                    <FlowColumn
                      title="iPhone"
                      items={["QR", "Wallet", "AirDrop", "Share Sheet"]}
                    />
                    <FlowColumn
                      title="Android"
                      items={["QR", "Wallet", "Nearby Share", "NFC"]}
                    />
                  </div>

                  <ArrowDown className="my-4 h-5 w-5 text-purple-200" />
                  <div className="rounded-2xl border border-white/10 bg-white/5 px-5 py-4">
                    <p className="text-sm font-semibold">
                      Receiver opens the same public card URL
                    </p>
                    <p className="mt-1 text-sm text-white/45">
                      {mockLinkedCard.public_url}
                    </p>
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-3xl border border-white/10 bg-[#101935]/70 p-6 shadow-2xl shadow-black/20">
              <SectionTitle
                title="Sharing Features"
                description="Built for quick sharing across real-world client interactions."
              />

              <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <FeatureCard icon={Share2} title="Universal Sharing" />
                <FeatureCard icon={Nfc} title="NFC Ready" />
                <FeatureCard icon={Radio} title="Dynamic Public Card" />
                <FeatureCard icon={ShieldCheck} title="Works Without App" />
              </div>
            </section>
          </div>

          <aside className="xl:sticky xl:top-8 xl:self-start">
            <section className="rounded-3xl border border-white/10 bg-[#101935]/70 p-6 shadow-2xl shadow-black/20">
              <SectionTitle
                title="Live Device Preview"
                description="Preview the smart share experience before native APIs are connected."
              />

              <div className="mt-5 grid grid-cols-2 gap-3">
                {[
                  { key: "iphone", label: "iPhone Preview" },
                  { key: "android", label: "Android Preview" },
                ].map((device) => (
                  <button
                    key={device.key}
                    type="button"
                    onClick={() => setDevicePreview(device.key as DevicePreview)}
                    className={`rounded-2xl border px-4 py-3 text-sm font-semibold transition ${
                      devicePreview === device.key
                        ? "border-[#AC00FF]/60 bg-[#AC00FF]/15 text-white"
                        : "border-white/10 bg-white/5 text-white/55 hover:bg-white/10"
                    }`}
                  >
                    {device.label}
                  </button>
                ))}
              </div>

              <div className="mt-6 rounded-[2rem] border border-[#AC00FF]/25 bg-gradient-to-br from-[#1B1241] via-[#101935] to-[#070B1A] p-5 shadow-inner shadow-white/5">
                <DeviceSharePreview device={devicePreview} />
              </div>
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

function ShareMethodCard({
  icon: Icon,
  title,
  description,
  actions,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  actions: string[];
}) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#AC00FF]/20 text-purple-100">
        <Icon className="h-6 w-6" />
      </div>
      <h3 className="mt-5 text-xl font-semibold">{title}</h3>
      <p className="mt-2 text-sm text-white/45">{description}</p>
      <div className="mt-5 flex flex-wrap gap-2">
        {actions.map((action) => (
          <button
            key={action}
            type="button"
            className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/65 transition hover:border-[#AC00FF]/45 hover:text-white"
          >
            {action}
          </button>
        ))}
      </div>
    </div>
  );
}

function TapShareCard() {
  if (!isPaid) {
    return (
      <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 text-white/45">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10">
          <Lock className="h-6 w-6" />
        </div>
        <h3 className="mt-5 text-xl font-semibold text-white">Tap to Share</h3>
        <p className="mt-2 text-sm leading-6">
          Upgrade to Individual Pro to unlock advanced tap sharing features.
        </p>
      </div>
    );
  }

  return (
    <ShareMethodCard
      icon={SmartphoneNfc}
      title="Tap to Share"
      description="Smart device-based sharing"
      actions={[
        "iPhone Smart Share",
        "Android Smart Share",
        "NFC Ready",
        "Nearby Share",
        "AirDrop",
      ]}
    />
  );
}

function FlowColumn({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <p className="text-sm font-semibold">{title}</p>
      <div className="mt-3 grid gap-2">
        {items.map((item) => (
          <span
            key={item}
            className="rounded-xl bg-[#070B1A]/60 px-3 py-2 text-xs font-semibold text-white/65"
          >
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

function FeatureCard({ icon: Icon, title }: { icon: LucideIcon; title: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <Icon className="h-5 w-5 text-purple-200" />
      <p className="mt-4 text-sm font-semibold">{title}</p>
    </div>
  );
}

function DeviceSharePreview({ device }: { device: DevicePreview }) {
  return (
    <div className="mx-auto max-w-sm">
      <div className="relative flex min-h-[360px] items-center justify-center">
        <div className="absolute left-4 top-8 h-48 w-28 rotate-[-8deg] rounded-[2rem] border border-white/15 bg-[#070B1A] p-2 shadow-2xl shadow-black/30">
          <div className="h-full rounded-[1.55rem] bg-gradient-to-br from-[#11183A] to-[#240048] p-3">
            <div className="mx-auto h-1.5 w-10 rounded-full bg-white/25" />
            <div className="mt-8 rounded-2xl border border-[#AC00FF]/40 bg-[#AC00FF]/20 p-3 text-center">
              <QrCode className="mx-auto h-7 w-7 text-purple-100" />
              <p className="mt-2 text-[10px] font-semibold">DMI Card</p>
            </div>
          </div>
        </div>

        <div className="absolute right-4 top-16 h-48 w-28 rotate-[8deg] rounded-[2rem] border border-white/15 bg-[#070B1A] p-2 shadow-2xl shadow-black/30">
          <div className="h-full rounded-[1.55rem] bg-gradient-to-br from-[#101935] to-[#07111F] p-3">
            <div className="mx-auto h-1.5 w-10 rounded-full bg-white/25" />
            <div className="mt-12 rounded-2xl bg-white/10 p-3 text-center">
              <Wifi className="mx-auto h-7 w-7 text-green-200" />
              <p className="mt-2 text-[10px] font-semibold">Receiving</p>
            </div>
          </div>
        </div>

        <div className="absolute h-32 w-32 animate-ping rounded-full border border-[#AC00FF]/30" />
        <div className="absolute h-20 w-20 rounded-full bg-[#AC00FF]/15 blur-2xl" />

        <div className="relative mt-52 w-full rounded-3xl border border-white/10 bg-[#070B1A]/80 p-5 shadow-2xl shadow-black/20">
          {device === "iphone" ? <IphoneSharePreview /> : <AndroidSharePreview />}
        </div>
      </div>
    </div>
  );
}

function IphoneSharePreview() {
  return (
    <div className="space-y-3">
      <PreviewRow icon={QrCode} label="QR popup" value="Camera scan ready" />
      <PreviewRow icon={WalletCards} label="Apple Wallet card" value="Pass preview" />
      <PreviewRow icon={Share2} label="Share sheet" value="Messages, Mail, Copy" />
      <PreviewRow icon={Airplay} label="AirDrop" value="Nearby iPhone mockup" />
    </div>
  );
}

function AndroidSharePreview() {
  return (
    <div className="space-y-3">
      <PreviewRow icon={QrCode} label="QR popup" value="Camera scan ready" />
      <PreviewRow icon={WalletCards} label="Google Wallet pass" value="Pass preview" />
      <PreviewRow icon={Send} label="Nearby Share" value="Nearby Android mockup" />
      <PreviewRow icon={SmartphoneNfc} label="NFC tap glow" value="Tap-ready visual" />
    </div>
  );
}

function PreviewRow({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#AC00FF]/20">
        <Icon className="h-4 w-4 text-purple-100" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold">{label}</p>
        <p className="mt-0.5 truncate text-xs text-white/45">{value}</p>
      </div>
    </div>
  );
}
