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
    <aside className="dmi-sidebar sticky top-0 flex h-screen w-72 shrink-0 flex-col border-r border-white/5 bg-[#0F0E38] text-white">
      <div className="flex h-40 flex-col items-center justify-center border-b border-white/10 px-6 py-6">
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
        <p className="mt-1 text-[10px] font-semibold tracking-[0.26em] text-white/55">
          ADMIN PANEL
        </p>
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-4 py-6">
        {sections.map((section) => (
          <div key={section.title}>
            <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.22em] text-white/35">
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
                    className={`block w-full rounded-2xl px-3 py-2.5 text-left text-sm font-medium leading-5 transition-all duration-200 ${
                      isActive
                        ? "bg-[#AC00FF] text-white shadow-lg shadow-purple-500/25"
                        : "text-white/65 hover:bg-white/10 hover:text-white"
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

      <div className="border-t border-white/10 p-4">
        <button
          type="button"
          onClick={handleSignOut}
          className="w-full rounded-2xl bg-white/5 px-4 py-3 text-sm font-medium text-white transition hover:bg-red-500/20 hover:text-red-200"
        >
          Sign Out
        </button>
      </div>
    </aside>
  );
}
