"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  CircleDollarSign,
  ContactRound,
  CreditCard,
  Headphones,
  Landmark,
  LayoutDashboard,
  Lock,
  Plug,
  QrCode,
  Settings,
  SmartphoneNfc,
  WalletCards,
} from "lucide-react";

const navItems: {
  label: string;
  href: string;
  icon: LucideIcon;
  locked?: boolean;
}[] = [
  { label: "Dashboard", href: "/client/dashboard", icon: LayoutDashboard },
  { label: "My Cards", href: "/client/cards", icon: CreditCard },
  { label: "Contacts", href: "/client/contacts", icon: ContactRound, locked: true },
  { label: "QR Code", href: "/client/qr-code", icon: QrCode },
  { label: "Wallet", href: "/client/wallet", icon: WalletCards, locked: true },
  {
    label: "Tap to Share",
    href: "/client/tap-to-share",
    icon: SmartphoneNfc,
    locked: true,
  },
  { label: "Analytics", href: "/client/analytics", icon: BarChart3, locked: true },
  { label: "Integrations", href: "/client/integrations", icon: Plug, locked: true },
  { label: "Billing", href: "/client/billing", icon: CircleDollarSign },
  { label: "Settings", href: "/client/settings", icon: Settings },
  { label: "Support", href: "/client/support", icon: Headphones },
];

export default function ClientSidebar() {
  const pathname = usePathname();

  return (
    <aside className="dmi-sidebar sticky top-0 flex h-screen w-72 shrink-0 flex-col border-r">
      <div className="border-b px-6 py-8">
        <div className="rounded-[var(--radius-lg)] border border-[var(--border-brand)] bg-[image:var(--brand-gradient-subtle)] p-4">
          <div className="flex items-center gap-3">
            <div className="relative flex h-12 w-12 items-center justify-center overflow-hidden rounded-[var(--radius-md)] bg-white shadow-[var(--shadow-sm)]">
              <Image
                src="/dmi-cards-logo.svg"
                alt="DMI Cards Logo"
                fill
                sizes="48px"
                className="object-contain p-1.5"
                priority
              />
            </div>
            <div>
              <p className="text-sm font-semibold">DMI Cards</p>
              <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--dmi-muted)]">
                Powered by DevMaster
              </p>
            </div>
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-4 py-6">
        <p className="mb-3 px-3 text-[10px] font-bold uppercase tracking-[0.22em] text-[var(--dmi-muted)]">
          Client Portal
        </p>

        <div className="space-y-1.5">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              pathname === item.href || pathname.startsWith(`${item.href}/`);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-[var(--radius-md)] px-3 py-3 text-sm font-medium transition-all duration-200 ${
                  isActive
                    ? "bg-[image:var(--brand-gradient-subtle)] text-[var(--text-accent)] ring-1 ring-[var(--border-brand)]"
                    : "text-[var(--dmi-muted)] hover:bg-[var(--dmi-surface-soft)] hover:text-[var(--foreground)]"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1">{item.label}</span>
                {item.locked && (
                  <span className="flex items-center gap-1 rounded-full border border-[var(--border-brand)] bg-[var(--badge-pro-bg)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--badge-pro-text)]">
                    <Lock className="h-3 w-3" />
                    Pro
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      </nav>

      <div className="border-t p-4">
        <div className="rounded-[var(--radius-lg)] border border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] p-4">
          <div className="flex items-center gap-2">
            <Landmark className="h-4 w-4 text-[var(--text-accent)]" />
            <p className="text-sm font-semibold">Free plan</p>
          </div>
          <p className="mt-1 text-xs leading-5 text-[var(--dmi-muted)]">
            Upgrade to Individual Pro for contacts, wallet, tap sharing,
            analytics, and integrations.
          </p>
        </div>

      </div>
    </aside>
  );
}
