import "server-only";

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import {
  requireAdminAccess,
} from "@/lib/admin-auth";
import { requestIdFromRequest } from "@/lib/observability/request";
import {
  healthGroups,
  healthSeverity,
  summarizeHealth,
  type HealthCheck,
  type HealthGroupId,
  type HealthStatus,
  type SafeHealthDetail,
} from "@/lib/system-health/types";
import { getAppleWalletConfig, validateAppleWalletConfig } from "@/lib/wallet/apple";
import { checkGoogleWalletReadOnlyHealth } from "@/lib/wallet/google";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

type CheckResult = {
  status: HealthStatus;
  message: string;
  evidenceSummary: string;
  verified: boolean;
  observed?: boolean;
  details?: Record<string, SafeHealthDetail>;
};

type CheckDefinition = {
  service: string;
  group: HealthGroupId;
  check: () => Promise<CheckResult>;
};

const definitions: CheckDefinition[] = [
  {
    service: "web_application",
    group: "core_platform",
    check: async () => ({
      status: "operational",
      message: "This System Health request reached the application.",
      evidenceSummary: "The protected health endpoint is responding.",
      verified: true,
      details: { probe: "current health request" },
    }),
  },
  {
    service: "database_read",
    group: "core_platform",
    check: checkDatabaseRead,
  },
  {
    service: "database_configuration",
    group: "core_platform",
    check: async () => configResult(
      "Supabase database access",
      ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]
    ),
  },
  {
    service: "admin_authentication",
    group: "core_platform",
    check: async () => ({
      status: "operational",
      message: "Your current admin request passed authentication and access checks.",
      evidenceSummary: "This request was authorized by Clerk and the admin access policy.",
      verified: true,
      details: { check: "current admin request only" },
    }),
  },
  {
    service: "customer_authentication",
    group: "core_platform",
    check: async () => unknownResult(
      "Customer sign-in has not been exercised by a safe health probe.",
      "No customer authentication test is run from this page."
    ),
  },
  {
    service: "supabase_auth_configuration",
    group: "core_platform",
    check: async () => configResult(
      "Supabase Auth configuration",
      ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]
    ),
  },
  {
    service: "public_card_read_model",
    group: "core_platform",
    check: checkPublicCardReadModel,
  },
  {
    service: "public_card_delivery",
    group: "core_platform",
    check: async () => unknownResult(
      "Public card delivery has not been checked end to end.",
      "No safe synthetic public-card fixture or non-writing probe is available."
    ),
  },
  {
    service: "stripe_configuration",
    group: "payments_access",
    check: async () => configResult(
      "Stripe billing configuration",
      ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"]
    ),
  },
  {
    service: "stripe_webhook_processing",
    group: "payments_access",
    check: async () => unknownResult(
      "Webhook processing health cannot currently be verified safely.",
      "Persisted webhook records have no suitable indexed, bounded health query."
    ),
  },
  {
    service: "subscription_synchronization",
    group: "payments_access",
    check: async () => unknownResult(
      "Subscription synchronization health cannot currently be verified.",
      "No bounded operational signal is available without scanning billing records."
    ),
  },
  {
    service: "entitlement_processing",
    group: "payments_access",
    check: async () => unknownResult(
      "Entitlement processing health has no independent operational signal.",
      "Subscription rows are intentionally not scanned for this health view."
    ),
  },
  {
    service: "card_publishing",
    group: "card_services",
    check: async () => unknownResult(
      "Card publishing has not been checked end to end.",
      "A published-card read does not prove that a customer can publish a card."
    ),
  },
  {
    service: "contacts_read_model",
    group: "card_services",
    check: checkContactsReadModel,
  },
  {
    service: "public_lead_capture",
    group: "card_services",
    check: async () => unknownResult(
      "Public lead capture has not been checked end to end.",
      "No non-writing probe can verify lead persistence."
    ),
  },
  {
    service: "media_storage",
    group: "card_services",
    check: async () => unknownResult(
      "Media upload and storage health has not been verified.",
      "A safe read-only probe for the complete upload workflow is not available."
    ),
  },
  {
    service: "apple_wallet",
    group: "card_services",
    check: checkAppleWallet,
  },
  {
    service: "google_wallet",
    group: "card_services",
    check: checkGoogleWallet,
  },
  {
    service: "upstash_rate_limiting",
    group: "infrastructure",
    check: checkUpstashReachability,
  },
  {
    service: "email_infrastructure",
    group: "communications_integrations",
    check: async () => unknownResult(
      "Email delivery infrastructure has not been verified.",
      "Configuration or stored connection metadata cannot prove delivery."
    ),
  },
  {
    service: "email_automations",
    group: "communications_integrations",
    check: async () => ({
      status: "not_migrated",
      message: "Email Automations exists in Production but its complete Staging foundation has not yet been migrated. This is a known staging-parity gap, not a service incident.",
      evidenceSummary: "Known Staging parity gap; no Production systems were checked.",
      verified: false,
      observed: false,
    }),
  },
  {
    service: "external_integrations",
    group: "communications_integrations",
    check: async () => unknownResult(
      "External integration health has not been verified.",
      "No safe general integration health signal is available."
    ),
  },
];

export async function GET(request: Request) {
  const requestId = requestIdFromRequest(request);
  const adminAccess = await requireAdminAccess(await auth());

  if (!adminAccess.authorized) {
    return NextResponse.json(
      { error: adminAccess.error },
      { status: adminAccess.status, headers: { "x-request-id": requestId } }
    );
  }

  const checks = await Promise.all(definitions.map((definition) => runCheck(definition)));
  const checkByGroup = new Map<HealthGroupId, HealthCheck[]>();
  for (const check of checks) {
    const grouped = checkByGroup.get(check.group) || [];
    grouped.push(check);
    checkByGroup.set(check.group, grouped);
  }
  const checkedAt = new Date().toISOString();

  return NextResponse.json(
    {
      service: "dmi-cards",
      requestId,
      checkedAt,
      overall: summarizeHealth(checks),
      groups: healthGroups.map((group) => ({
        ...group,
        checks: checkByGroup.get(group.id) || [],
      })),
    },
    {
      headers: {
        "Cache-Control": "private, no-store",
        "x-request-id": requestId,
      },
    }
  );
}

async function runCheck(definition: CheckDefinition): Promise<HealthCheck> {
  const observedAt = new Date().toISOString();
  try {
    const result = await withTimeout(definition.check(), 5000);
    const verifiedAt = result.verified ? new Date().toISOString() : null;
    return {
      service: definition.service,
      group: definition.group,
      status: result.status,
      severity: healthSeverity(result.status),
      observedAt: result.observed === false ? null : observedAt,
      verifiedAt,
      message: result.message,
      evidenceSummary: result.evidenceSummary,
      details: result.details || {},
    };
  } catch (error) {
    return {
      service: definition.service,
      group: definition.group,
      status: "unknown",
      severity: "info",
      observedAt,
      verifiedAt: null,
      message: "This check could not complete, so its health is unknown.",
      evidenceSummary: "No verified result was returned.",
      details: { errorCategory: safeErrorCategory(error) },
    };
  }
}

async function checkDatabaseRead(): Promise<CheckResult> {
  const { data, error } = await createSupabaseAdminClient()
    .from("templates")
    .select("id")
    .limit(1);

  if (error) {
    return {
      status: "incident",
      message: "The database did not complete a read of the template catalogue.",
      evidenceSummary: "A bounded database read failed.",
      verified: true,
      details: { query: "templates: select id, limit 1", errorCategory: safeErrorCode(error.code) },
    };
  }

  return {
    status: "operational",
    message: "The template catalogue can be read. This does not test every database operation.",
    evidenceSummary: "A bounded service-role read of the template catalogue succeeded.",
    verified: true,
    details: { query: "templates: select id, limit 1", returnedRows: data?.length || 0 },
  };
}

async function checkPublicCardReadModel(): Promise<CheckResult> {
  const { data, error } = await createSupabaseAdminClient()
    .from("cards")
    .select("id")
    .or("status.eq.published,is_published.eq.true")
    .limit(1);

  if (error) {
    return {
      status: "degraded",
      message: "The published-card read model could not be queried.",
      evidenceSummary: "A bounded published-card database read failed; public delivery was not tested.",
      verified: true,
      details: { query: "published cards: select id, limit 1", errorCategory: safeErrorCode(error.code) },
    };
  }

  return {
    status: "operational",
    message: "The published-card read query succeeded. Public page delivery and publishing are not tested.",
    evidenceSummary: "A bounded read of the published-card data path succeeded.",
    verified: true,
    details: { query: "published cards: select id, limit 1", returnedRows: data?.length || 0 },
  };
}

async function checkContactsReadModel(): Promise<CheckResult> {
  const { data, error } = await createSupabaseAdminClient()
    .from("contacts")
    .select("id")
    .limit(1);

  if (error) {
    const missing = error.code === "42P01" || error.code === "PGRST205";
    return {
      status: missing ? "not_migrated" : "degraded",
      message: missing
        ? "The Contacts table is not present in this Staging database."
        : "The Contacts table read could not be completed.",
      evidenceSummary: missing
        ? "The database reported that the Contacts relation is missing."
        : "A bounded Contacts database read failed.",
      verified: true,
      details: { query: "contacts: select id, limit 1", errorCategory: safeErrorCode(error.code) },
    };
  }

  return {
    status: "operational",
    message: "The Contacts table can be read. Public lead capture is not tested.",
    evidenceSummary: "A bounded service-role read of the Contacts table succeeded.",
    verified: true,
    details: { query: "contacts: select id, limit 1", returnedRows: data?.length || 0 },
  };
}

async function checkAppleWallet(): Promise<CheckResult> {
  const result = getAppleWalletConfig();
  if (!result.configured) {
    return {
      status: "not_configured",
      message: "Apple Wallet configuration is incomplete.",
      evidenceSummary: "Required local certificate configuration is absent.",
      verified: false,
      details: { missingConfigurationCount: result.missingVariables.length },
    };
  }

  const valid = validateAppleWalletConfig(result.config);
  return {
    status: valid ? "operational" : "degraded",
    message: valid
      ? "Apple Wallet certificate material is readable. Pass delivery is not tested."
      : "Apple Wallet certificate material could not be validated.",
    evidenceSummary: valid
      ? "Local certificate validation succeeded; provider delivery was not tested."
      : "Local certificate validation failed.",
    verified: true,
    details: { check: "local certificate validation only" },
  };
}

async function checkGoogleWallet(): Promise<CheckResult> {
  const health = await checkGoogleWalletReadOnlyHealth();
  const missingConfiguration = health.category === "missing_configuration";
  const status: HealthStatus = health.status === "healthy"
    ? "operational"
    : missingConfiguration
      ? "not_configured"
      : "degraded";
  return {
    status,
    message: health.message,
    evidenceSummary: health.status === "healthy"
      ? "Google Wallet token generation and class lookup succeeded."
      : missingConfiguration
        ? "Required Google Wallet configuration is absent."
        : "The read-only Google Wallet provider check reported a problem.",
    verified: health.status !== "degraded" || !missingConfiguration,
    details: {
      checkCategory: safeCategory(health.category),
      httpStatus: health.httpStatus ?? null,
    },
  };
}

async function checkUpstashReachability(): Promise<CheckResult> {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim().replace(/\/+$/, "") || "";
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim() || "";
  const hasRateLimitSecret = Boolean(process.env.PUBLIC_LEAD_RATE_LIMIT_SECRET?.trim());
  if (!url || !token || !hasRateLimitSecret) {
    return {
      status: "not_configured",
      message: "Upstash rate-limit configuration is incomplete.",
      evidenceSummary: "Required Upstash or rate-limit configuration is absent.",
      verified: false,
      details: {
        redisConfigurationPresent: Boolean(url && token),
        rateLimitSecretPresent: hasRateLimitSecret,
      },
    };
  }

  try {
    const response = await fetch(`${url}/ping`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(1500),
      cache: "no-store",
    });
    return {
      status: response.ok ? "operational" : "degraded",
      message: response.ok
        ? "Upstash Redis responded to a ping. The application rate-limit flow is not tested."
        : "Upstash Redis did not return a successful ping response.",
      evidenceSummary: response.ok
        ? "The configured Redis endpoint answered a read-only ping."
        : "The configured Redis endpoint returned an unsuccessful ping response.",
      verified: true,
      details: { probe: "Redis PING", httpStatus: response.status },
    };
  } catch {
    return {
      status: "degraded",
      message: "Upstash Redis did not respond to the read-only ping.",
      evidenceSummary: "The configured Redis endpoint failed to respond within the probe limit.",
      verified: true,
      details: { probe: "Redis PING", errorCategory: "unreachable_or_timeout" },
    };
  }
}

function configResult(label: string, variables: string[]): CheckResult {
  const present = variables.filter((name) => Boolean(process.env[name]?.trim()));
  const configured = present.length === variables.length;
  return {
    status: configured ? "unknown" : "not_configured",
    message: configured
      ? `${label} values are present, but service operation has not been tested.`
      : `${label} is not fully configured.`,
    evidenceSummary: configured
      ? "Configuration presence was checked; it does not prove service health."
      : "One or more required configuration values are absent.",
    verified: false,
    details: {
      configurationPresentCount: present.length,
      requiredConfigurationCount: variables.length,
    },
  };
}

function unknownResult(message: string, evidenceSummary: string): CheckResult {
  return {
    status: "unknown",
    message,
    evidenceSummary,
    verified: false,
    observed: false,
  };
}

function safeErrorCategory(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return "check_failed";
  return safeErrorCode(String(error.code));
}

function safeErrorCode(value: string | undefined) {
  return value && /^[A-Z0-9_]{1,40}$/.test(value) ? value : "unclassified";
}

function safeCategory(value: string) {
  return /^[a-zA-Z0-9_.-]{1,80}$/.test(value) ? value : "unavailable";
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error("HEALTH_CHECK_TIMEOUT")), timeoutMs);
    }),
  ]);
}
