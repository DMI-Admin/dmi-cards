"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
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
  LogOut,
  Plug,
  QrCode,
  Settings,
  SmartphoneNfc,
  WalletCards,
} from "lucide-react";
import { supabase } from "@/lib/supabase";

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
  const router = useRouter();

  async function handleLogout() {
    const { error } = await supabase.auth.signOut();
    console.log("[DMI auth] logout result", {
      error: error ? { name: error.name, message: error.message, status: error.status } : null,
    });
    router.push("/login");
  }

  return (
    <aside className="sticky top-0 flex h-screen w-72 shrink-0 flex-col border-r border-white/5 bg-[#0F0E38] text-white">
      <div className="border-b border-white/10 px-6 py-8">
        <div className="rounded-3xl border border-[#AC00FF]/25 bg-[#AC00FF]/10 p-4 shadow-2xl shadow-purple-950/20">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#AC00FF] to-[#5B2CFF] text-lg font-bold shadow-lg shadow-purple-500/25">
              D
            </div>
            <div>
              <p className="text-sm font-semibold">DMI Cards</p>
              <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-white/45">
                Client Portal
              </p>
            </div>
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-4 py-6">
        <p className="mb-3 px-3 text-[10px] font-bold uppercase tracking-[0.22em] text-white/35">
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
                className={`flex items-center gap-3 rounded-2xl px-3 py-3 text-sm font-medium transition-all duration-200 ${
                  isActive
                    ? "bg-[#AC00FF] text-white shadow-lg shadow-purple-500/25"
                    : "text-white/65 hover:bg-white/10 hover:text-white"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1">{item.label}</span>
                {item.locked && (
                  <span className="flex items-center gap-1 rounded-full border border-white/10 bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/60">
                    <Lock className="h-3 w-3" />
                    Pro
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      </nav>

      <div className="border-t border-white/10 p-4">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="flex items-center gap-2">
            <Landmark className="h-4 w-4 text-purple-200" />
            <p className="text-sm font-semibold">Free plan</p>
          </div>
          <p className="mt-1 text-xs leading-5 text-white/45">
            Upgrade to Individual Pro for contacts, wallet, tap sharing,
            analytics, and integrations.
          </p>
        </div>

        <button
          type="button"
          onClick={handleLogout}
          className="mt-3 flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white/65 transition hover:border-[#AC00FF]/45 hover:bg-[#AC00FF]/15 hover:text-white"
        >
          <LogOut className="h-4 w-4" />
          Log Out
        </button>
      </div>
    </aside>
  );
}
