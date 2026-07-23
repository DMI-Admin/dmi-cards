"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useClerk } from "@clerk/nextjs";
import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  CreditCard,
  FileText,
  Headphones,
  LayoutDashboard,
  LogOut,
  QrCode,
  ScrollText,
  Settings,
  ShieldCheck,
  UploadCloud,
  UsersRound,
  WalletCards,
} from "lucide-react";

type NavItem = {
  name: string;
  href: string;
  icon: LucideIcon;
};

export default function Sidebar() {
  const pathname = usePathname();
  const { signOut } = useClerk();

  const sections: { title: string; items: NavItem[] }[] = [
    {
      title: "Overview",
      items: [{ name: "Dashboard", href: "/admin/dashboard", icon: LayoutDashboard }],
    },
    {
      title: "Management",
      items: [
        { name: "Client Onboarding", href: "/clients", icon: UsersRound },
        { name: "Templates", href: "/templates", icon: FileText },
        { name: "Cards", href: "/cards", icon: CreditCard },
        { name: "Public Pages", href: "/public-pages", icon: WalletCards },
        { name: "QR Codes", href: "/qr-codes", icon: QrCode },
      ],
    },
    {
      title: "Business",
      items: [
        { name: "Subscriptions", href: "/subscriptions", icon: ScrollText },
        { name: "Finance", href: "/finance", icon: WalletCards },
        { name: "Analytics", href: "/analytics", icon: BarChart3 },
      ],
    },
    {
      title: "Operations",
      items: [
        { name: "Uploads", href: "/uploads", icon: UploadCloud },
        { name: "Support", href: "/support", icon: Headphones },
        { name: "Audit Logs", href: "/audit-logs", icon: ScrollText },
        { name: "Security", href: "/security", icon: ShieldCheck },
        { name: "Settings", href: "/settings", icon: Settings },
      ],
    },
  ];

  const handleSignOut = async () => {
    await signOut();
    window.location.href = "/admin";
  };

  return (
    <aside className="dmi-sidebar sticky top-0 flex h-screen w-72 shrink-0 flex-col border-r">
      <div className="border-b px-6 py-8">
        <div className="rounded-[var(--radius-lg)] border border-[var(--border-brand)] bg-[image:var(--brand-gradient-subtle)] p-4">
          <div className="flex items-center gap-3">
            <div className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-md)] bg-white shadow-[var(--shadow-sm)]">
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
              <p className="text-sm font-semibold text-[var(--text-primary)]">
                DMI Cards
              </p>
              <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--dmi-muted)]">
                Admin Panel
              </p>
            </div>
          </div>
        </div>
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-4 py-6">
        {sections.map((section) => (
          <div key={section.title}>
            <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.22em] text-[var(--dmi-muted)]">
              {section.title}
            </p>

            <div className="space-y-1">
              {section.items.map((item) => {
                const Icon = item.icon;
                const isActive =
                  pathname === item.href ||
                  pathname.startsWith(`${item.href}/`);

                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    className={`flex w-full items-center gap-3 rounded-[var(--radius-md)] px-3 py-2.5 text-left text-sm font-medium leading-5 transition-all duration-200 ${
                      isActive
                        ? "dmi-nav-active text-white"
                        : "text-[var(--dmi-muted)] hover:bg-[var(--dmi-surface-soft)] hover:text-[var(--foreground)]"
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="min-w-0 flex-1">{item.name}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t p-4">
        <button
          type="button"
          onClick={handleSignOut}
          className="inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius-md)] border border-[var(--dmi-border)] bg-[var(--button-secondary-bg)] px-4 py-3 text-sm font-semibold text-[var(--button-secondary-text)] transition hover:border-[var(--border-brand)] hover:bg-[var(--button-hover-bg)] hover:text-[var(--foreground)]"
        >
          <LogOut className="h-4 w-4" />
          Sign Out
        </button>
      </div>
    </aside>
  );
}
