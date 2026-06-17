"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useClerk } from "@clerk/nextjs";

export default function Sidebar() {
  const pathname = usePathname();
  const { signOut } = useClerk();

  const sections = [
    {
      title: "Overview",
      items: [{ name: "Dashboard", href: "/dashboard" }],
    },
    {
      title: "Management",
      items: [
        { name: "Client Onboarding", href: "/clients" },
        { name: "Templates", href: "/templates" },
        { name: "Cards", href: "/cards" },
        { name: "Public Pages", href: "/public-pages" },
        { name: "QR Codes", href: "/qr-codes" },
      ],
    },
    {
      title: "Business",
      items: [
        { name: "Subscriptions", href: "/subscriptions" },
        { name: "Finance", href: "/finance" },
        { name: "Analytics", href: "/analytics" },
      ],
    },
    {
      title: "Operations",
      items: [
        { name: "Uploads", href: "/uploads" },
        { name: "Support", href: "/support" },
        { name: "Audit Logs", href: "/audit-logs" },
        { name: "Security", href: "/security" },
        { name: "Settings", href: "/settings" },
      ],
    },
  ];

  const handleSignOut = async () => {
    await signOut();
    window.location.href = "/sign-in";
  };

  return (
    <aside className="dmi-sidebar sticky top-0 flex h-screen w-72 shrink-0 flex-col border-r">
      <div className="flex h-40 flex-col items-center justify-center border-b px-6 py-6">
        <div className="relative h-20 w-20 shrink-0">
          <Image
            src="/dmi-cards-logo.svg"
            alt="DMI Cards Logo"
            fill
            sizes="80px"
            className="object-contain"
            priority
          />
        </div>

        <p className="mt-4 text-sm font-semibold text-white">
          DMI Cards
        </p>
        <p className="mt-1 text-[10px] font-semibold tracking-[0.26em] text-[var(--dmi-muted)]">
          ADMIN PANEL
        </p>
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-4 py-6">
        {sections.map((section) => (
          <div key={section.title}>
            <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.22em] text-[var(--dmi-muted)]">
              {section.title}
            </p>

            <div className="space-y-1">
              {section.items.map((item) => {
                const isActive =
                  pathname === item.href ||
                  pathname.startsWith(`${item.href}/`);

                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    className={`block w-full rounded-[var(--radius-md)] px-3 py-2.5 text-left text-sm font-medium leading-5 transition-all duration-200 ${
                      isActive
                        ? "bg-[image:var(--brand-gradient-subtle)] text-[var(--text-accent)] ring-1 ring-[var(--border-brand)]"
                        : "text-[var(--dmi-muted)] hover:bg-[var(--dmi-surface-soft)] hover:text-[var(--foreground)]"
                    }`}
                  >
                    {item.name}
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
          className="w-full rounded-[var(--radius-md)] border border-[var(--dmi-border)] bg-[var(--button-secondary-bg)] px-4 py-3 text-sm font-medium text-[var(--button-secondary-text)] transition hover:border-[var(--border-brand)] hover:bg-[var(--button-hover-bg)] hover:text-[var(--foreground)]"
        >
          Sign Out
        </button>
      </div>
    </aside>
  );
}
