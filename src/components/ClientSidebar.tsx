"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Menu,
  X,
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
import { useEffect, useMemo, useState } from "react";
import { isClientFeatureLocked, type ClientFeature } from "@/lib/client-feature-access";

export const clientNavItems: {
  label: string;
  href: string;
  icon: LucideIcon;
  feature?: ClientFeature;
}[] = [
  { label: "Dashboard", href: "/client/dashboard", icon: LayoutDashboard },
  { label: "My Cards", href: "/client/cards", icon: CreditCard },
  { label: "Contacts", href: "/client/contacts", icon: ContactRound, feature: "contacts" },
  { label: "QR Code", href: "/client/qr-code", icon: QrCode },
  { label: "Wallet", href: "/client/wallet", icon: WalletCards, feature: "wallet" },
  {
    label: "Tap to Share",
    href: "/client/tap-to-share",
    icon: SmartphoneNfc,
    feature: "tap-to-share",
  },
  { label: "Analytics", href: "/client/analytics", icon: BarChart3, feature: "analytics" },
  { label: "Integrations", href: "/client/integrations", icon: Plug, feature: "integrations" },
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
          <ClientNavLinks pathname={pathname} />
        </div>
      </nav>

      <div className="border-t p-4">
        <div className="rounded-[var(--radius-lg)] border border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] p-4">
          <div className="flex items-center gap-2">
            <Landmark className="h-4 w-4 text-[var(--text-accent)]" />
            <p className="text-sm font-semibold">Free plan</p>
          </div>
          <p className="mt-1 text-xs leading-5 text-[var(--dmi-muted)]">
            Upgrade to Individual Pro for contacts, tap sharing, analytics,
            and integrations.
          </p>
        </div>

      </div>
    </aside>
  );
}

export function ClientMobileHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const pageTitle = useMemo(() => {
    const activeItem = clientNavItems
      .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
      .sort((a, b) => b.href.length - a.href.length)[0];

    return activeItem?.label || "Client Portal";
  }, [pathname]);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <>
      <header className="client-mobile-header sticky top-0 z-40 border-b border-[var(--dmi-border)] bg-[var(--dmi-surface)]/95 px-4 py-3 text-[var(--text-primary)] shadow-[var(--shadow-sm)] backdrop-blur md:hidden">
        <div className="mx-auto flex min-h-12 w-full max-w-screen-sm items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-md)] bg-white shadow-[var(--shadow-sm)]">
              <Image
                src="/dmi-cards-logo.svg"
                alt=""
                fill
                sizes="40px"
                className="object-contain p-1.5"
                priority
              />
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs font-bold uppercase tracking-[0.18em] text-[var(--text-accent)]">
                DMI Cards
              </p>
              <h1 className="truncate text-base font-semibold text-[var(--text-primary)]">
                {pageTitle}
              </h1>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] text-[var(--text-primary)] transition hover:border-[var(--border-brand)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#AC00FF]"
            aria-label="Open client navigation"
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-controls="client-mobile-drawer"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>
      </header>

      {open && (
        <div className="fixed inset-0 z-50 md:hidden" role="presentation">
          <button
            type="button"
            className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
            onClick={() => setOpen(false)}
            aria-label="Close client navigation"
          />
          <aside
            id="client-mobile-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Client navigation"
            className="absolute inset-y-0 left-0 flex w-[min(86vw,22rem)] max-w-full flex-col border-r border-[var(--dmi-border)] bg-[var(--dmi-surface)] text-[var(--text-primary)] shadow-2xl shadow-black/40"
          >
            <div className="border-b border-[var(--dmi-border)] px-4 py-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-md)] bg-white shadow-[var(--shadow-sm)]">
                    <Image
                      src="/dmi-cards-logo.svg"
                      alt=""
                      fill
                      sizes="44px"
                      className="object-contain p-1.5"
                      priority
                    />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">DMI Cards</p>
                    <p className="truncate text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--dmi-muted)]">
                      Client Portal
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#AC00FF]"
                  aria-label="Close client navigation"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
              <ClientNavLinks pathname={pathname} onNavigate={() => setOpen(false)} />
            </nav>

            <div className="border-t border-[var(--dmi-border)] p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <div className="rounded-[var(--radius-lg)] border border-[var(--dmi-border)] bg-[var(--dmi-surface-soft)] p-4">
                <div className="flex items-center gap-2">
                  <Landmark className="h-4 w-4 text-[var(--text-accent)]" />
                  <p className="text-sm font-semibold">Free plan</p>
                </div>
                <p className="mt-1 text-xs leading-5 text-[var(--dmi-muted)]">
                  Upgrade to Individual Pro for contacts, tap sharing, analytics,
                  and integrations.
                </p>
              </div>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}

function ClientNavLinks({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <div className="space-y-1.5">
      {clientNavItems.map((item) => {
        const Icon = item.icon;
        const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const locked = item.feature ? isClientFeatureLocked(item.feature, "free") : false;

        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={`flex min-h-11 items-center gap-3 rounded-[var(--radius-md)] px-3 py-3 text-sm font-medium transition-all duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#AC00FF] ${
              isActive
                ? "dmi-nav-active text-white"
                : "text-[var(--dmi-muted)] hover:bg-[var(--dmi-surface-soft)] hover:text-[var(--foreground)]"
            }`}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {locked && (
              <span className="flex shrink-0 items-center gap-1 rounded-full border border-[var(--border-brand)] bg-[var(--badge-pro-bg)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--badge-pro-text)]">
                <Lock className="h-3 w-3" />
                Pro
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
