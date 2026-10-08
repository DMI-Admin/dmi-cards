import "server-only";

import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  CHECK_TIMEOUT_MS,
  RETENTION_BATCH_SIZE,
  RETENTION_DAYS,
  RETENTION_MAX_BATCHES,
  executeChecks,
  summarizeCheckResults,
  type MonitorCheckDefinition,
  type MonitorObservation,
} from "./monitoring-core";

import { checkPaymentNotifications } from "./payment-notification-probe";

const environment = "staging";
const googleWalletConfigurationRequired = 3;
const appleWalletConfigurationRequired = 6;
const clerkConfigurationRequired = 2;
const systemHealthChecks: MonitorCheckDefinition[] = [
  {
    serviceKey: "web_application",
    checkKey: "runtime",
    run: async () => operational("The Staging monitoring endpoint is running.", { query_bounded: true }),
  },
  {
    serviceKey: "database",
    checkKey: "bounded_read",
    run: (signal) => readModelCheck("templates", "The template catalogue", signal),
  },
  {
    serviceKey: "admin_authentication",
    checkKey: "configuration_evidence",
    run: async () => configurationOnlyCheck(
      ["CLERK_SECRET_KEY", "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"],
      clerkConfigurationRequired,
      "Admin authentication configuration is present; authentication was not exercised."
    ),
  },
  {
    serviceKey: "public_cards",
    checkKey: "read_model",
    run: (signal) => readModelCheck("cards", "The card read model", signal),
  },
  {
    serviceKey: "contacts",
    checkKey: "read_model",
    run: (signal) => readModelCheck("contacts", "The Contacts table", signal, true),
  },
  {
    serviceKey: "upstash_rate_limiting",
    checkKey: "redis_ping",
    run: checkUpstashPing,
  },
  {
    serviceKey: "apple_wallet",
    checkKey: "certificate_configuration",
    run: checkAppleWalletConfiguration,
  },
  {
    serviceKey: "google_wallet",
    checkKey: "read_only_provider_check",
    run: checkGoogleWalletProvider,
  },
  {
    serviceKey: "stripe_webhook_processing",
    checkKey: "operational_evidence",
    run: (signal) => checkPaymentNotifications(
      createMonitoringDatabaseClient(signal), process.env.STRIPE_ACCOUNT_SCOPE, signal
    ),
  },
  {
    serviceKey: "billing_reconciliation",
    checkKey: "operational_evidence",
    run: async () => unknown("Billing reconciliation has no scheduled operational evidence."),
  },
  {
    serviceKey: "entitlement_processing",
    checkKey: "operational_evidence",
    run: async () => unknown("Entitlement processing has no independent operational evidence."),
  },
  {
    serviceKey: "public_lead_capture",
    checkKey: "end_to_end",
    run: async () => unknown("Lead capture is not tested because a safe non-writing probe is unavailable."),
  },
  {
    serviceKey: "media_storage",
    checkKey: "upload_workflow",
    run: async () => unknown("Media upload health is not tested; no synthetic upload is performed."),
  },
  {
    serviceKey: "customer_authentication",
    checkKey: "end_to_end",
    run: async () => unknown("Customer authentication is not exercised by a monitoring check."),
  },
  {
    serviceKey: "email_automations",
    checkKey: "staging_parity",
    run: async () => ({
      status: "not_migrated",
      severity: "info",
      verified: false,
      reasonCode: "staging_parity_gap",
      safeSummary: "Email Automations exists in Production but its complete Staging foundation has not yet been migrated. This is a known staging-parity gap, not a service incident.",
    }),
  },
  {
    serviceKey: "external_integrations",
    checkKey: "operational_evidence",
    run: async () => unknown("No safe general external-integration health probe is available."),
  },
];

export type MonitoringRunSummary = {
  runId: string;
  counts: ReturnType<typeof summarizeCheckResults>;
  retentionDeleted: number;
};

export async function runSystemHealthMonitoring(): Promise<MonitoringRunSummary> {
  const runId = randomUUID();
  const results = await executeChecks(systemHealthChecks, CHECK_TIMEOUT_MS);
  const database = createMonitoringDatabaseClient();
  const deploymentRef = safeDeploymentReference();
  const rows = results.map((result) => ({
    run_id: runId,
    environment,
    service_key: result.serviceKey,
    check_key: result.checkKey,
    status: result.status,
    severity: result.severity,
    checked_at: result.checkedAt,
    verified_at: result.verifiedAt,
    duration_ms: result.durationMs,
    reason_code: result.reasonCode,
    safe_summary: result.safeSummary,
    evidence: result.evidence,
    deployment_ref: deploymentRef,
  }));

  const { error: insertError } = await database
    .from("system_health_check_runs")
    .insert(rows);

  if (insertError) {
    throw new Error("SYSTEM_HEALTH_HISTORY_WRITE_FAILED");
  }

  const retentionDeleted = await pruneExpiredHistory(database);
  return {
    runId,
    counts: summarizeCheckResults(results),
    retentionDeleted,
  };
}

function createMonitoringDatabaseClient(checkSignal?: AbortSignal): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceRoleKey) {
    throw new Error("SYSTEM_HEALTH_DATABASE_NOT_CONFIGURED");
  }

  const boundedFetch: typeof fetch = (input, init) => {
    const timeoutSignal = AbortSignal.timeout(2_500);
    const signals = [timeoutSignal, checkSignal, init?.signal]
      .filter((signal): signal is AbortSignal => signal !== undefined && signal !== null);
    return fetch(input, { ...init, signal: AbortSignal.any(signals) });
  };

  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: boundedFetch },
  });
}

async function readModelCheck(
  table: "templates" | "cards" | "contacts",
  description: string,
  signal: AbortSignal,
  contacts = false
): Promise<MonitorObservation> {
  try {
    const { data, error } = await createMonitoringDatabaseClient(signal)
      .from(table)
      .select("id")
      .limit(1);

    if (error) {
      const relationMissing = error.code === "42P01" || error.code === "PGRST205";
      if (contacts && relationMissing) {
        return {
          status: "not_migrated",
          severity: "info",
          verified: false,
          reasonCode: "contacts_table_not_migrated",
          safeSummary: "The Contacts table is not available in this Staging database.",
          evidence: { query_bounded: true },
        };
      }
      return {
        status: "degraded",
        severity: "warning",
        verified: true,
        reasonCode: "bounded_read_failed",
        safeSummary: `A bounded read of ${description} could not be completed.`,
        evidence: { query_bounded: true },
      };
    }

    return operational(
      `${description} can be read. This does not prove its end-to-end customer workflow.`,
      { returned_rows: data?.length ?? 0, query_bounded: true }
    );
  } catch {
    return unknown(`${description} read could not be verified.`);
  }
}

async function checkUpstashPing(signal: AbortSignal): Promise<MonitorObservation> {
  const urlValue = process.env.UPSTASH_REDIS_REST_URL?.trim() || "";
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim() || "";
  const rateLimitSecret = process.env.PUBLIC_LEAD_RATE_LIMIT_SECRET?.trim() || "";
  if (!urlValue || !token || !rateLimitSecret) {
    return {
      status: "not_configured",
      severity: "info",
      verified: false,
      reasonCode: "upstash_configuration_missing",
      safeSummary: "Upstash rate-limit configuration is incomplete.",
      evidence: {
        configuration_present_count: Number(Boolean(urlValue)) +
          Number(Boolean(token)) + Number(Boolean(rateLimitSecret)),
        configuration_required_count: 3,
      },
    };
  }

  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    return degraded("upstash_endpoint_invalid", "The configured Upstash endpoint is invalid.");
  }
  if (
    url.protocol !== "https:" ||
    !(url.hostname === "upstash.io" || url.hostname.endsWith(".upstash.io"))
  ) {
    return degraded("upstash_endpoint_invalid", "The configured Upstash endpoint is not a supported HTTPS endpoint.");
  }

  try {
    const response = await fetch(`${url.origin}/ping`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.any([signal, AbortSignal.timeout(1_500)]),
      cache: "no-store",
    });
    return response.ok
      ? operational("Upstash Redis answered a read-only ping; limiter behavior was not tested.", {
          http_status: response.status,
          provider_response_ok: true,
        })
      : degraded("upstash_ping_failed", "Upstash Redis did not return a successful read-only ping.", {
          http_status: response.status,
          provider_response_ok: false,
        });
  } catch {
    return degraded("upstash_ping_failed", "Upstash Redis did not respond to the read-only ping.", {
      provider_response_ok: false,
    });
  }
}

async function checkAppleWalletConfiguration(): Promise<MonitorObservation> {
  const { getAppleWalletConfig, validateAppleWalletConfig } = await import("@/lib/wallet/apple");
  const result = getAppleWalletConfig();
  if (!result.configured) {
    return {
      status: "not_configured",
      severity: "info",
      verified: false,
      reasonCode: "apple_wallet_configuration_missing",
      safeSummary: "Apple Wallet certificate configuration is incomplete.",
      evidence: {
        configuration_present_count: appleWalletConfigurationRequired - result.missingVariables.length,
        configuration_required_count: appleWalletConfigurationRequired,
      },
    };
  }

  const valid = validateAppleWalletConfig(result.config);
  return valid
    ? operational("Apple Wallet certificate material validated locally; provider delivery was not tested.", {
        configured: true,
        certificate_valid: true,
      })
    : degraded("apple_certificate_invalid", "Apple Wallet certificate material could not be validated.", {
        configured: true,
        certificate_valid: false,
      });
}

async function checkGoogleWalletProvider(signal: AbortSignal): Promise<MonitorObservation> {
  const { checkGoogleWalletReadOnlyHealth } = await import("@/lib/wallet/google");
  const result = await checkGoogleWalletReadOnlyHealth(signal);
  if (result.category === "missing_configuration") {
    const { getGoogleWalletConfig } = await import("@/lib/wallet/google");
    const config = getGoogleWalletConfig();
    return {
      status: "not_configured",
      severity: "info",
      verified: false,
      reasonCode: "google_wallet_configuration_missing",
      safeSummary: "Google Wallet configuration is incomplete.",
      evidence: {
        configuration_present_count: googleWalletConfigurationRequired - config.missingVariables.length,
        configuration_required_count: googleWalletConfigurationRequired,
      },
    };
  }
  if (result.status === "healthy") {
    return operational("Google Wallet token generation and read-only class lookup succeeded.", {
      provider_response_ok: true,
      ...(result.httpStatus ? { http_status: result.httpStatus } : {}),
    });
  }

  return degraded("google_wallet_provider_check_failed", "The read-only Google Wallet provider check did not succeed.", {
    provider_response_ok: false,
    ...(result.httpStatus ? { http_status: result.httpStatus } : {}),
  });
}

async function pruneExpiredHistory(database: SupabaseClient): Promise<number> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  let deleted = 0;

  for (let batch = 0; batch < RETENTION_MAX_BATCHES; batch++) {
    const { data, error } = await database.rpc("prune_system_health_check_runs", {
      p_environment: environment,
      p_cutoff: cutoff,
      p_batch_size: RETENTION_BATCH_SIZE,
    });
    if (error || typeof data !== "number" || data < 0 || data > RETENTION_BATCH_SIZE) {
      throw new Error("SYSTEM_HEALTH_RETENTION_FAILED");
    }
    deleted += data;
    if (data < RETENTION_BATCH_SIZE) break;
  }

  return deleted;
}

function configurationOnlyCheck(
  variables: string[],
  required: number,
  summary: string
): MonitorObservation {
  const present = variables.filter((name) => Boolean(process.env[name]?.trim())).length;
  if (present !== required) {
    return {
      status: "not_configured",
      severity: "info",
      verified: false,
      reasonCode: "admin_auth_configuration_missing",
      safeSummary: "Admin authentication configuration is incomplete.",
      evidence: {
        configuration_present_count: present,
        configuration_required_count: required,
      },
    };
  }
  return {
    status: "unknown",
    severity: "info",
    verified: false,
    reasonCode: "admin_auth_not_exercised",
    safeSummary: summary,
    evidence: {
      configuration_present_count: present,
      configuration_required_count: required,
    },
  };
}

function operational(safeSummary: string, evidence: Record<string, unknown> = {}): MonitorObservation {
  return {
    status: "operational",
    severity: "none",
    verified: true,
    reasonCode: null,
    safeSummary,
    evidence,
  };
}

function degraded(
  reasonCode: string,
  safeSummary: string,
  evidence: Record<string, unknown> = {}
): MonitorObservation {
  return {
    status: "degraded",
    severity: "warning",
    verified: true,
    reasonCode,
    safeSummary,
    evidence,
  };
}

function unknown(safeSummary: string): MonitorObservation {
  return {
    status: "unknown",
    severity: "info",
    verified: false,
    reasonCode: "no_safe_operational_probe",
    safeSummary,
  };
}

function safeDeploymentReference(): string | null {
  const value = (
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
    ""
  ).trim();
  return /^[a-f0-9]{7,40}$/i.test(value) ? value.slice(0, 12).toLowerCase() : null;
}
