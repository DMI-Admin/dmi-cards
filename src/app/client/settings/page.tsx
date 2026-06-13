"use client";

import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  ArrowUpRight,
  BadgeCheck,
  Building2,
  CheckCircle2,
  CreditCard,
  Download,
  KeyRound,
  Lock,
  LogOut,
  Mail,
  Plug,
  Save,
  Settings,
  ShieldCheck,
  Smartphone,
  Trash2,
  UserRound,
  WalletCards,
} from "lucide-react";
import ClientSidebar from "@/components/ClientSidebar";
import ThemeSelector from "@/components/ThemeSelector";

const currentPlan = "free";

const notificationDefaults = [
  { label: "New contact captured", enabled: true },
  { label: "Weekly analytics summary", enabled: true },
  { label: "QR scan alerts", enabled: false },
  { label: "Wallet activity alerts", enabled: false },
  { label: "CRM sync alerts", enabled: false },
  { label: "Product updates", enabled: true },
];

const connectedServices = [
  {
    label: "CRM connected status",
    value: "No CRM connected",
    status: "Not connected",
    icon: Plug,
  },
  {
    label: "Wallet status",
    value: "Wallet preview only",
    status: "Preview",
    icon: WalletCards,
  },
  {
    label: "Stripe billing status",
    value: "Stripe not connected yet",
    status: "Pending",
    icon: CreditCard,
  },
];

export default function ClientSettingsPage() {
  const [notifications, setNotifications] = useState(notificationDefaults);
  const [publicCardVisible, setPublicCardVisible] = useState(true);
  const [contactConsent, setContactConsent] = useState(true);

  function toggleNotification(label: string) {
    setNotifications((current) =>
      current.map((item) =>
        item.label === label ? { ...item, enabled: !item.enabled } : item
      )
    );
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
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <h1 className="text-4xl font-bold">Settings</h1>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-white/60">
                {currentPlan} plan
              </span>
            </div>
            <p className="mt-3 max-w-4xl text-white/50">
              Manage your account, preferences, notifications, and security.
            </p>
          </div>

          <button
            type="button"
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#AC00FF] to-[#6C2CFF] px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-purple-500/25 transition hover:shadow-purple-400/35"
          >
            <Save className="h-4 w-4" />
            Save Settings
          </button>
        </div>

        <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <SummaryCard
            label="Account"
            value="Personal"
            caption="Profile settings"
            icon={UserRound}
          />
          <SummaryCard
            label="Plan"
            value="Free"
            caption="Upgrade available"
            icon={BadgeCheck}
          />
          <SummaryCard
            label="Security"
            value="Standard"
            caption="2FA placeholder"
            icon={ShieldCheck}
          />
          <SummaryCard
            label="Services"
            value="Preview"
            caption="CRM and Stripe later"
            icon={Plug}
          />
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="space-y-6">
            <ThemeSelector />

            <section className="rounded-3xl border border-white/10 bg-[#101935]/70 p-6 shadow-2xl shadow-black/20">
              <SectionTitle
                title="Account Profile"
                description="Update your profile details for the client portal."
              />

              <div className="mt-6 grid gap-4 lg:grid-cols-2">
                <Field label="Full name" icon={UserRound}>
                  <input defaultValue="Full Name" className="inputStyle" />
                </Field>
                <Field label="Email" icon={Mail}>
                  <input defaultValue="hello@devmaster.com" className="inputStyle" />
                </Field>
                <Field label="Company name" icon={Building2}>
                  <input defaultValue="DevMaster Inc" className="inputStyle" />
                </Field>
                <Field label="Phone" icon={Smartphone}>
                  <input defaultValue="+44 7700 900123" className="inputStyle" />
                </Field>
              </div>

              <button
                type="button"
                className="mt-6 inline-flex items-center justify-center gap-2 rounded-2xl bg-[#AC00FF] px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-purple-500/20 transition hover:bg-[#BE35FF]"
              >
                <Save className="h-4 w-4" />
                Save Changes
              </button>
            </section>

            <section className="rounded-3xl border border-white/10 bg-[#101935]/70 p-6 shadow-2xl shadow-black/20">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                <SectionTitle
                  title="Plan & Access"
                  description="Your current client portal access level."
                />
                <button
                  type="button"
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-[#AC00FF]/45 bg-[#AC00FF]/15 px-4 py-3 text-sm font-semibold text-purple-100 transition hover:bg-[#AC00FF]/25"
                >
                  Upgrade
                  <ArrowUpRight className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {["Free", "Individual Pro", "Business", "Enterprise"].map(
                  (plan) => (
                    <PlanOption
                      key={plan}
                      label={plan}
                      active={plan.toLowerCase() === currentPlan}
                    />
                  )
                )}
              </div>
            </section>

            <section className="rounded-3xl border border-white/10 bg-[#101935]/70 p-6 shadow-2xl shadow-black/20">
              <SectionTitle
                title="Notifications"
                description="Choose which account and card activity alerts you want to receive."
              />

              <div className="mt-6 grid gap-3 lg:grid-cols-2">
                {notifications.map((item) => (
                  <ToggleRow
                    key={item.label}
                    label={item.label}
                    enabled={item.enabled}
                    onClick={() => toggleNotification(item.label)}
                  />
                ))}
              </div>
            </section>

            <section className="rounded-3xl border border-white/10 bg-[#101935]/70 p-6 shadow-2xl shadow-black/20">
              <SectionTitle
                title="Security"
                description="Security controls are placeholders until auth is connected."
              />

              <div className="mt-6 grid gap-3 lg:grid-cols-3">
                <ActionPanel
                  icon={KeyRound}
                  title="Change password"
                  description="Update your password from the client portal."
                />
                <ActionPanel
                  icon={ShieldCheck}
                  title="Two-factor authentication"
                  description="Add an extra layer of account protection."
                />
                <ActionPanel
                  icon={LogOut}
                  title="Active sessions"
                  description="Review signed-in devices and sessions."
                />
              </div>
            </section>
          </div>

          <aside className="space-y-6 xl:sticky xl:top-8 xl:self-start">
            <section className="rounded-3xl border border-white/10 bg-[#101935]/70 p-6 shadow-2xl shadow-black/20">
              <SectionTitle
                title="Privacy"
                description="Control visibility, consent, and data requests."
              />

              <div className="mt-6 space-y-3">
                <ToggleRow
                  label="Public card visibility"
                  enabled={publicCardVisible}
                  onClick={() => setPublicCardVisible(!publicCardVisible)}
                />
                <ToggleRow
                  label="Contact capture consent"
                  enabled={contactConsent}
                  onClick={() => setContactConsent(!contactConsent)}
                />
                <ActionStrip
                  icon={Download}
                  title="Data export request"
                  description="Request a copy of your account data."
                />
                <ActionStrip
                  icon={Trash2}
                  title="Delete account"
                  description="Placeholder for future account deletion flow."
                  danger
                />
              </div>
            </section>

            <section className="rounded-3xl border border-white/10 bg-[#101935]/70 p-6 shadow-2xl shadow-black/20">
              <SectionTitle
                title="Connected Services"
                description="External services linked to your DMI Cards account."
              />

              <div className="mt-6 space-y-3">
                {connectedServices.map((service) => (
                  <ServiceRow key={service.label} {...service} />
                ))}
              </div>
            </section>

            <section className="rounded-3xl border border-[#AC00FF]/25 bg-[#AC00FF]/10 p-6 shadow-lg shadow-purple-950/15">
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#AC00FF]/20">
                  <Settings className="h-6 w-6 text-purple-100" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold">Settings V1</h2>
                  <p className="mt-3 text-sm leading-6 text-white/60">
                    These controls are mock UI only. Backend account, auth,
                    and notification preferences will be wired in later.
                  </p>
                </div>
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
  caption,
  icon: Icon,
}: {
  label: string;
  value: string;
  caption: string;
  icon: LucideIcon;
}) {
  return (
    <div className="min-h-36 rounded-3xl border border-white/10 bg-white/5 p-5 shadow-lg shadow-black/10">
      <div className="flex items-center justify-between gap-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/35">
          {label}
        </p>
        <Icon className="h-5 w-5 text-purple-200" />
      </div>
      <p className="mt-5 text-3xl font-semibold tracking-tight">{value}</p>
      <p className="mt-3 text-sm text-white/45">{caption}</p>
    </div>
  );
}

function Field({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-white/45">
        <Icon className="h-3.5 w-3.5 text-purple-200" />
        {label}
      </span>
      {children}
    </label>
  );
}

function PlanOption({ label, active }: { label: string; active: boolean }) {
  return (
    <div
      className={`rounded-2xl border p-4 ${
        active
          ? "border-[#AC00FF]/55 bg-[#AC00FF]/15 shadow-lg shadow-purple-500/10"
          : "border-white/10 bg-white/5"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="font-semibold">{label}</p>
        {active ? (
          <CheckCircle2 className="h-5 w-5 text-green-200" />
        ) : (
          <Lock className="h-4 w-4 text-white/35" />
        )}
      </div>
      <p className="mt-2 text-xs text-white/45">
        {active ? "Current access" : "Upgrade placeholder"}
      </p>
    </div>
  );
}

function ToggleRow({
  label,
  enabled,
  onClick,
}: {
  label: string;
  enabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-left transition hover:border-[#AC00FF]/35 hover:bg-white/10"
    >
      <span className="text-sm font-semibold">{label}</span>
      <span
        className={`relative h-7 w-14 rounded-full p-1 transition ${
          enabled ? "bg-[#AC00FF]" : "bg-white/15"
        }`}
      >
        <span
          className={`block h-5 w-5 rounded-full bg-white shadow transition ${
            enabled ? "translate-x-7" : "translate-x-0"
          }`}
        />
      </span>
    </button>
  );
}

function ActionPanel({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <button
      type="button"
      className="rounded-2xl border border-white/10 bg-white/5 p-5 text-left transition hover:border-[#AC00FF]/35 hover:bg-[#AC00FF]/10"
    >
      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#AC00FF]/15 text-purple-200">
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="mt-4 font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-white/45">{description}</p>
    </button>
  );
}

function ActionStrip({
  icon: Icon,
  title,
  description,
  danger = false,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      className={`flex w-full items-start gap-4 rounded-2xl border p-4 text-left transition ${
        danger
          ? "border-red-400/20 bg-red-500/10 hover:bg-red-500/15"
          : "border-white/10 bg-white/5 hover:border-[#AC00FF]/35 hover:bg-white/10"
      }`}
    >
      <div
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
          danger ? "bg-red-500/15 text-red-200" : "bg-[#AC00FF]/15 text-purple-200"
        }`}
      >
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <h3 className="font-semibold">{title}</h3>
        <p className="mt-1 text-sm leading-6 text-white/45">{description}</p>
      </div>
    </button>
  );
}

function ServiceRow({
  label,
  value,
  status,
  icon: Icon,
}: {
  label: string;
  value: string;
  status: string;
  icon: LucideIcon;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#AC00FF]/15 text-purple-200">
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <p className="font-semibold">{label}</p>
            <p className="mt-1 text-sm text-white/45">{value}</p>
          </div>
        </div>
        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-white/55">
          {status}
        </span>
      </div>
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
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-white/45">{description}</p>
    </div>
  );
}
