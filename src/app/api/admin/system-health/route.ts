import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import {
  emailFromClerkUser,
  isAdminAllowlistConfigured,
  requireAdminAccess,
} from "@/lib/admin-auth";
import { getAppleWalletConfig, validateAppleWalletConfig } from "@/lib/wallet/apple";
import { getGoogleWalletConfig } from "@/lib/wallet/google";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { isEmailOAuthStateConfigured } from "@/lib/email/oauth-state";
import { isEmailTokenEncryptionConfigured } from "@/lib/email/token-encryption";
import { getGoogleEmailOAuthConfig } from "@/lib/email/providers/google";
import { getMicrosoftEmailOAuthConfig } from "@/lib/email/providers/microsoft";

type HealthStatus = "operational" | "degraded" | "outage";

type HealthCheckResult = {
  service: string;
  status: HealthStatus;
  latencyMs: number;
  message: string;
};

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function GET() {
  const adminAccess = await requireAdminAccess(await auth(), async () =>
    emailFromClerkUser(await currentUser())
  );

  if (!adminAccess.authorized) {
    return NextResponse.json(
      { error: adminAccess.error },
      { status: adminAccess.status }
    );
  }

  const checks = await Promise.all([
    timedCheck("application", checkApplication),
    timedCheck("supabase_config", checkSupabaseConfig),
    timedCheck("database", checkDatabase),
    timedCheck("auth_config", checkAuthConfig),
    timedCheck("admin_auth", checkAdminAuthConfig),
    timedCheck("public_cards", checkPublicCardResolver),
    timedCheck("rate_limiting", checkRateLimitConfig),
    timedCheck("contacts", checkContactsReadModel),
    timedCheck("stripe", checkStripeConfig),
    timedCheck("apple_wallet", checkAppleWalletConfig),
    timedCheck("google_wallet", checkGoogleWalletConfig),
    timedCheck("google_email_oauth", checkGoogleEmailOAuthConfig),
    timedCheck("microsoft_email_oauth", checkMicrosoftEmailOAuthConfig),
  ]);
  const status = aggregateStatus(checks);

  return NextResponse.json({
    status,
    service: "dmi-cards",
    checkedAt: new Date().toISOString(),
    checks,
  });
}

async function timedCheck(
  service: string,
  check: () => Promise<Omit<HealthCheckResult, "service" | "latencyMs">>
): Promise<HealthCheckResult> {
  const startedAt = Date.now();

  try {
    const result = await withTimeout(check(), 5000);
    return {
      service,
      latencyMs: Date.now() - startedAt,
      ...result,
    };
  } catch {
    return {
      service,
      status: "outage",
      latencyMs: Date.now() - startedAt,
      message: "Health check failed.",
    };
  }
}

async function checkApplication() {
  return {
    status: "operational" as const,
    message: "Application runtime is responding.",
  };
}

async function checkSupabaseConfig() {
  const hasUrl = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL?.trim());
  const hasAnonKey = Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim());
  const hasServiceRole = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
  const configured = hasUrl && hasAnonKey && hasServiceRole;

  return {
    status: configured ? ("operational" as const) : ("outage" as const),
    message: configured
      ? "Supabase environment configuration is present."
      : "Supabase environment configuration is incomplete.",
  };
}

async function checkDatabase() {
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from("templates").select("id").limit(1);

  if (error) {
    return {
      status: "outage" as const,
      message: "Database read check failed.",
    };
  }

  return {
    status: "operational" as const,
    message: "Database read check succeeded.",
  };
}

async function checkAuthConfig() {
  const configured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
  );

  return {
    status: configured ? ("operational" as const) : ("outage" as const),
    message: configured
      ? "Client authentication configuration is present."
      : "Client authentication configuration is incomplete.",
  };
}

async function checkAdminAuthConfig() {
  const configured = isAdminAllowlistConfigured();

  return {
    status: configured ? ("operational" as const) : ("outage" as const),
    message: configured
      ? "Admin allowlist configuration is present."
      : "Admin allowlist configuration is missing.",
  };
}

async function checkPublicCardResolver() {
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase
    .from("cards")
    .select("id")
    .or("status.eq.published,is_published.eq.true")
    .limit(1);

  if (error) {
    return {
      status: "outage" as const,
      message: "Public card read model check failed.",
    };
  }

  return {
    status: "operational" as const,
    message: "Public card read model is reachable.",
  };
}

async function checkRateLimitConfig() {
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL?.trim().replace(/\/+$/, "") || "";
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN?.trim() || "";
  const hasRedis = Boolean(redisUrl && redisToken);
  const hasSecret = Boolean(process.env.PUBLIC_LEAD_RATE_LIMIT_SECRET?.trim());

  if (!hasRedis || !hasSecret) {
    return {
      status: "degraded" as const,
      message: "Public lead rate-limit configuration is incomplete.",
    };
  }

  const response = await fetch(`${redisUrl}/ping`, {
    headers: {
      Authorization: `Bearer ${redisToken}`,
    },
    signal: AbortSignal.timeout(1500),
  });

  return {
    status: response.ok ? ("operational" as const) : ("outage" as const),
    message: response.ok
      ? "Public lead rate limiter is reachable."
      : "Public lead rate limiter did not respond successfully.",
  };
}

async function checkContactsReadModel() {
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from("contacts").select("id").limit(1);

  if (error) {
    return {
      status: "outage" as const,
      message: "Contacts read model check failed.",
    };
  }

  return {
    status: "operational" as const,
    message: "Contacts read model is reachable.",
  };
}

async function checkStripeConfig() {
  const configured = Boolean(
    process.env.STRIPE_SECRET_KEY?.trim() &&
      process.env.STRIPE_WEBHOOK_SECRET?.trim() &&
      process.env.STRIPE_PRICE_PRO_MONTHLY?.trim() &&
      process.env.STRIPE_PRICE_PRO_ANNUAL?.trim()
  );

  return {
    status: configured ? ("operational" as const) : ("degraded" as const),
    message: configured
      ? "Stripe configuration is present."
      : "Stripe configuration is incomplete.",
  };
}

async function checkAppleWalletConfig() {
  const config = getAppleWalletConfig();

  if (!config.configured) {
    return {
      status: "degraded" as const,
      message: "Apple Wallet configuration is incomplete.",
    };
  }

  const valid = validateAppleWalletConfig(config.config);

  return {
    status: valid ? ("operational" as const) : ("degraded" as const),
    message: valid
      ? "Apple Wallet configuration is present and certificate material is readable."
      : "Apple Wallet certificate material could not be validated.",
  };
}

async function checkGoogleWalletConfig() {
  const config = getGoogleWalletConfig();

  return {
    status: config.configured ? ("operational" as const) : ("degraded" as const),
    message: config.configured
      ? "Google Wallet configuration is present."
      : "Google Wallet configuration is incomplete.",
  };
}

async function checkGoogleEmailOAuthConfig() {
  const oauthConfig = getGoogleEmailOAuthConfig();
  const configured =
    oauthConfig.configured &&
    isEmailTokenEncryptionConfigured() &&
    isEmailOAuthStateConfigured();

  return {
    status: configured ? ("operational" as const) : ("degraded" as const),
    message: configured
      ? "Google email OAuth configuration is present."
      : "Google email OAuth configuration is incomplete.",
  };
}

async function checkMicrosoftEmailOAuthConfig() {
  const oauthConfig = getMicrosoftEmailOAuthConfig();
  const configured =
    oauthConfig.configured &&
    isEmailTokenEncryptionConfigured() &&
    isEmailOAuthStateConfigured();

  return {
    status: configured ? ("operational" as const) : ("degraded" as const),
    message: configured
      ? "Microsoft email OAuth configuration is present."
      : "Microsoft email OAuth configuration is incomplete.",
  };
}

function aggregateStatus(checks: HealthCheckResult[]): HealthStatus {
  if (checks.some((check) => check.status === "outage")) return "outage";
  if (checks.some((check) => check.status === "degraded")) return "degraded";
  return "operational";
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error("HEALTH_CHECK_TIMEOUT")), timeoutMs);
    }),
  ]);
}
