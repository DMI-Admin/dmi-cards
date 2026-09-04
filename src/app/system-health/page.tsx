"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  RefreshCw,
  XCircle,
} from "lucide-react";
import Sidebar from "@/components/Sidebar";

type HealthStatus = "operational" | "degraded" | "outage";

type HealthCheck = {
  service: string;
  status: HealthStatus;
  latencyMs: number;
  message: string;
};

type HealthResponse = {
  status: HealthStatus;
  service: string;
  checkedAt: string;
  checks: HealthCheck[];
};

const serviceLabels: Record<string, { title: string; description: string }> = {
  application: {
    title: "Application",
    description: "Next.js runtime and basic API responsiveness.",
  },
  supabase_config: {
    title: "Supabase configuration",
    description: "Required Supabase URL, anon key and service-role configuration.",
  },
  database: {
    title: "Supabase database",
    description: "Read access to core application tables.",
  },
  auth_config: {
    title: "Supabase Auth/config",
    description: "Client-side authentication configuration.",
  },
  admin_auth: {
    title: "Clerk/admin access",
    description: "Admin allowlist and Clerk authorization readiness.",
  },
  public_cards: {
    title: "Public card system",
    description: "Published card lookup path used by /u/[slug].",
  },
  rate_limiting: {
    title: "Upstash Redis/rate limiter",
    description: "Distributed protection for public lead submissions.",
  },
  contacts: {
    title: "Contacts",
    description: "Contacts read model and owner-scoped storage availability.",
  },
  stripe: {
    title: "Stripe",
    description: "Billing and webhook configuration readiness.",
  },
  apple_wallet: {
    title: "Apple Wallet",
    description: "Certificate/configuration health for pass generation.",
  },
  google_wallet: {
    title: "Google Wallet",
    description: "Issuer and service-account configuration readiness.",
  },
  google_email_oauth: {
    title: "Google Email OAuth",
    description: "Google Gmail connection configuration readiness.",
  },
  microsoft_email_oauth: {
    title: "Microsoft Email OAuth",
    description: "Microsoft Outlook connection configuration readiness.",
  },
};

const displayOrder = [
  "application",
  "database",
  "supabase_config",
  "auth_config",
  "admin_auth",
  "public_cards",
  "rate_limiting",
  "contacts",
  "stripe",
  "apple_wallet",
  "google_wallet",
  "google_email_oauth",
  "microsoft_email_oauth",
];

export default function SystemHealthPage() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const loadHealth = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/admin/system-health", {
        cache: "no-store",
      });

      if (!response.ok) {
        setError("System health is unavailable for this admin session.");
        setHealth(null);
        return;
      }

      const payload = (await response.json()) as HealthResponse;
      setHealth(payload);
    } catch {
      setError("System health could not be loaded. Please try again.");
      setHealth(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadInitialHealth() {
      try {
        const response = await fetch("/api/admin/system-health", {
          cache: "no-store",
        });

        if (cancelled) return;

        if (!response.ok) {
          setError("System health is unavailable for this admin session.");
          setHealth(null);
          return;
        }

        const payload = (await response.json()) as HealthResponse;
        setHealth(payload);
      } catch {
        if (!cancelled) {
          setError("System health could not be loaded. Please try again.");
          setHealth(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadInitialHealth();

    return () => {
      cancelled = true;
    };
  }, []);

  const checks = useMemo(() => {
    const byService = new Map(health?.checks.map((check) => [check.service, check]));

    return displayOrder
      .map((service) => byService.get(service))
      .filter((check): check is HealthCheck => Boolean(check));
  }, [health]);

  return (
    <main className="flex min-h-screen bg-[#070B1A] text-white">
      <Sidebar />

      <section className="flex-1 p-6 lg:p-10">
        <div className="mb-8 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-[#D946EF]">
              Operations
            </p>
            <h1 className="mt-3 text-3xl font-bold lg:text-4xl">System Health</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/55">
              Safe production readiness checks for the critical DMI Cards services.
            </p>
          </div>

          <button
            type="button"
            onClick={() => void loadHealth()}
            disabled={loading}
            className="inline-flex w-fit items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/10 px-4 py-3 text-sm font-semibold text-white transition hover:border-[#D946EF]/50 hover:bg-white/[0.14] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        <section className="mb-6 rounded-3xl border border-white/10 bg-white/[0.06] p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-4">
              <OverallStatusIcon status={health?.status || "degraded"} />
              <div>
                <h2 className="text-xl font-semibold">
                  {loading && !health ? "Checking systems..." : statusLabel(health?.status)}
                </h2>
                <p className="mt-1 text-sm leading-6 text-white/55">
                  {error ||
                    "This page intentionally reports only safe service state, timings and high-level failure reasons."}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-4 py-2 text-sm text-white/60">
              <Clock3 className="h-4 w-4" />
              <span>{lastCheckedText(health?.checkedAt)}</span>
            </div>
          </div>
        </section>

        {error && !health ? (
          <div className="rounded-3xl border border-amber-400/25 bg-amber-400/10 p-6 text-sm text-amber-100">
            {error}
          </div>
        ) : (
          <section className="grid gap-4 xl:grid-cols-2">
            {checks.map((check) => (
              <HealthServiceCard key={check.service} check={check} />
            ))}
          </section>
        )}
      </section>
    </main>
  );
}

function HealthServiceCard({ check }: { check: HealthCheck }) {
  const service = serviceLabels[check.service] || {
    title: titleFromService(check.service),
    description: "Service health check.",
  };

  return (
    <article className="rounded-2xl border border-white/10 bg-white/[0.045] p-5 shadow-[0_18px_60px_rgba(0,0,0,0.18)]">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold">{service.title}</h3>
          <p className="mt-1 text-sm leading-6 text-white/50">{service.description}</p>
        </div>
        <StatusBadge status={check.status} />
      </div>

      <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-4">
        <p className="text-sm leading-6 text-white/75">{safeHealthMessage(check.message)}</p>
        <p className="mt-3 text-xs font-semibold uppercase tracking-[0.2em] text-white/35">
          {check.latencyMs}ms
        </p>
      </div>
    </article>
  );
}

function StatusBadge({ status }: { status: HealthStatus }) {
  const styles = {
    operational: "border-emerald-400/25 bg-emerald-400/10 text-emerald-200",
    degraded: "border-amber-400/25 bg-amber-400/10 text-amber-200",
    outage: "border-rose-400/25 bg-rose-400/10 text-rose-200",
  }[status];
  const Icon =
    status === "operational" ? CheckCircle2 : status === "degraded" ? AlertTriangle : XCircle;

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${styles}`}
    >
      <Icon className="h-3.5 w-3.5" />
      {statusLabel(status)}
    </span>
  );
}

function OverallStatusIcon({ status }: { status: HealthStatus }) {
  const styles = {
    operational: "border-emerald-400/25 bg-emerald-400/10 text-emerald-200",
    degraded: "border-amber-400/25 bg-amber-400/10 text-amber-200",
    outage: "border-rose-400/25 bg-rose-400/10 text-rose-200",
  }[status];
  const Icon =
    status === "operational" ? CheckCircle2 : status === "degraded" ? AlertTriangle : Activity;

  return (
    <span className={`inline-flex h-12 w-12 items-center justify-center rounded-2xl border ${styles}`}>
      <Icon className="h-5 w-5" />
    </span>
  );
}

function statusLabel(status: HealthStatus | undefined) {
  if (status === "operational") return "Operational";
  if (status === "outage") return "Outage";
  return "Degraded";
}

function lastCheckedText(value: string | undefined) {
  if (!value) return "Not checked yet";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "Last checked time unavailable";

  return `Last checked ${date.toLocaleString()}`;
}

function titleFromService(service: string) {
  return service
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function safeHealthMessage(message: string) {
  return message.replace(/https?:\/\/\S+/g, "[redacted-url]");
}
