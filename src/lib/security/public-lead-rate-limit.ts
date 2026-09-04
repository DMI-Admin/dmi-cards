import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import type { NextRequest } from "next/server";
import { ApiRouteError } from "@/lib/api/responses";
import { logError, logWarn, safeErrorMetadata } from "@/lib/observability/logger";

type PublicLeadRateLimitPhase = "standard" | "suspicious";

type PublicLeadRateLimitOptions = {
  request: NextRequest;
  slug: string;
  phase?: PublicLeadRateLimitPhase;
  requestId?: string;
};

type RateLimitRule = {
  name: string;
  limit: number;
  windowSeconds: number;
  key: string;
};

type RateLimitCounterResult = {
  rule: RateLimitRule;
  count: number;
};

type RedisPipelineResult = Array<{
  result?: unknown;
  error?: string;
}>;

const keyPrefix = "dmi:public-leads:v1";
const localBuckets = new Map<string, { count: number; expiresAt: number }>();

export async function enforcePublicLeadRateLimit({
  request,
  slug,
  phase = "standard",
  requestId,
}: PublicLeadRateLimitOptions) {
  let results: RateLimitCounterResult[];
  try {
    const identity = publicLeadRateLimitIdentity(request);
    const rules = buildRateLimitRules({
      ipKey: identity.ipKey,
      slug,
      phase,
    });

    if (rules.length === 0) return;

    results = await incrementRateLimitCounters(rules);
  } catch (error) {
    logError({
      code: "PUBLIC_LEAD_RATE_LIMITER_UNAVAILABLE",
      requestId,
      route: "/api/public/cards/[slug]/leads",
      metadata: {
        ...safeErrorMetadata(error),
        phase,
      },
    });

    if (rateLimitFailOpen()) {
      return;
    }

    throw new ApiRouteError(
      503,
      "INTERNAL_ERROR",
      "Lead capture is temporarily busy. Please try again shortly."
    );
  }

  const exceeded = results.find(({ rule, count }) => count > rule.limit);
  if (exceeded) {
    logWarn({
      code: "PUBLIC_LEAD_RATE_LIMITED",
      requestId,
      route: "/api/public/cards/[slug]/leads",
      metadata: {
        rule: exceeded.rule.name,
        phase,
      },
    });
    throw new ApiRouteError(429, "INVALID_REQUEST", "Please wait before trying again.");
  }
}

export function publicLeadRateLimitIdentity(request: NextRequest) {
  const ip = normalizedRequestIp(request);
  return {
    ipKey: hashRateLimitValue(`ip:${ip}`),
    source: ip === "unknown" ? "unknown" : "request-ip",
  };
}

function buildRateLimitRules({
  ipKey,
  slug,
  phase,
}: {
  ipKey: string;
  slug: string;
  phase: PublicLeadRateLimitPhase;
}) {
  const slugKey = hashRateLimitValue(`slug:${slug}`);
  const platformKey = hashRateLimitValue("platform");
  const rules: RateLimitRule[] = [
    minuteRule(
      "ip-card-minute",
      envInt("PUBLIC_LEAD_RATE_LIMIT_IP_CARD_PER_MINUTE", 5),
      `${ipKey}:${slugKey}:m`
    ),
    hourRule(
      "ip-card-hour",
      envInt("PUBLIC_LEAD_RATE_LIMIT_IP_CARD_PER_HOUR", 25),
      `${ipKey}:${slugKey}:h`
    ),
    minuteRule(
      "ip-global-minute",
      envInt("PUBLIC_LEAD_RATE_LIMIT_IP_GLOBAL_PER_MINUTE", 30),
      `${ipKey}:global:m`
    ),
    minuteRule(
      "card-global-minute",
      envInt("PUBLIC_LEAD_RATE_LIMIT_CARD_GLOBAL_PER_MINUTE", 120),
      `${slugKey}:global:m`
    ),
    minuteRule(
      "platform-global-minute",
      envInt("PUBLIC_LEAD_RATE_LIMIT_PLATFORM_GLOBAL_PER_MINUTE", 1500),
      `${platformKey}:global:m`
    ),
  ];

  if (phase === "suspicious") {
    rules.push(
      minuteRule(
        "suspicious-ip-card-minute",
        envInt("PUBLIC_LEAD_RATE_LIMIT_SUSPICIOUS_IP_CARD_PER_MINUTE", 2),
        `${ipKey}:${slugKey}:suspicious:m`
      ),
      minuteRule(
        "suspicious-card-minute",
        envInt("PUBLIC_LEAD_RATE_LIMIT_SUSPICIOUS_CARD_PER_MINUTE", 30),
        `${slugKey}:suspicious:m`
      )
    );
  }

  return rules.filter((rule) => rule.limit > 0);
}

function minuteRule(name: string, limit: number, key: string): RateLimitRule {
  return {
    name,
    limit,
    windowSeconds: 60,
    key: `${keyPrefix}:${name}:${key}`,
  };
}

function hourRule(name: string, limit: number, key: string): RateLimitRule {
  return {
    name,
    limit,
    windowSeconds: 60 * 60,
    key: `${keyPrefix}:${name}:${key}`,
  };
}

async function incrementRateLimitCounters(rules: RateLimitRule[]) {
  const redisConfig = redisRestConfig();
  if (!redisConfig) {
    if (isProductionRuntime()) {
      throw new Error("PUBLIC_LEAD_RATE_LIMIT_REDIS_NOT_CONFIGURED");
    }

    return incrementLocalCounters(rules);
  }

  return incrementRedisCounters(redisConfig, rules);
}

async function incrementRedisCounters(
  config: { url: string; token: string },
  rules: RateLimitRule[]
): Promise<RateLimitCounterResult[]> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    envInt("PUBLIC_LEAD_RATE_LIMIT_TIMEOUT_MS", 400)
  );

  try {
    const commands = rules.flatMap((rule) => [
      ["SET", rule.key, "0", "EX", String(rule.windowSeconds), "NX"],
      ["INCR", rule.key],
    ]);

    const response = await fetch(`${config.url}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(commands),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`REDIS_RATE_LIMIT_HTTP_${response.status}`);
    }

    const body = (await response.json()) as RedisPipelineResult;
    if (!Array.isArray(body) || body.length !== commands.length) {
      throw new Error("REDIS_RATE_LIMIT_RESPONSE_INVALID");
    }

    return rules.map((rule, index) => {
      const setResult = body[index * 2];
      const incrementResult = body[index * 2 + 1];
      if (setResult?.error || incrementResult?.error) {
        throw new Error("REDIS_RATE_LIMIT_COMMAND_FAILED");
      }

      return {
        rule,
        count: numberFromRedisResult(incrementResult?.result),
      };
    });
  } finally {
    clearTimeout(timeout);
  }
}

function incrementLocalCounters(rules: RateLimitRule[]) {
  const now = Date.now();
  return rules.map((rule) => {
    const current = localBuckets.get(rule.key);
    const next =
      current && current.expiresAt > now
        ? { count: current.count + 1, expiresAt: current.expiresAt }
        : { count: 1, expiresAt: now + rule.windowSeconds * 1000 };

    localBuckets.set(rule.key, next);
    return { rule, count: next.count };
  });
}

function numberFromRedisResult(value: unknown) {
  const numberValue =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;

  if (!Number.isFinite(numberValue)) {
    throw new Error("REDIS_RATE_LIMIT_COUNT_INVALID");
  }

  return numberValue;
}

function normalizedRequestIp(request: NextRequest) {
  const headerNames = process.env.VERCEL === "1"
    ? ["x-forwarded-for", "x-real-ip"]
    : ["x-real-ip", "cf-connecting-ip", "x-forwarded-for"];
  const ip =
    headerNames
      .map((name) => request.headers.get(name)?.split(",")[0]?.trim())
      .find((value): value is string => Boolean(value)) ||
    "unknown";

  if (ip === "unknown") return ip;
  if (isIP(ip) === 4) return ip;
  if (isIP(ip) === 6) return normalizedIpv6Prefix(ip);
  return "unknown";
}

function normalizedIpv6Prefix(value: string) {
  const expanded = expandIpv6(value);
  if (!expanded) return value.toLowerCase();
  return `${expanded.slice(0, 4).join(":")}::/64`;
}

function expandIpv6(value: string) {
  const lowerValue = value.toLowerCase();
  const [head = "", tail = ""] = lowerValue.split("::");
  const headParts = head ? head.split(":") : [];
  const tailParts = tail ? tail.split(":") : [];
  const missing = 8 - headParts.length - tailParts.length;

  if (!lowerValue.includes("::") && headParts.length === 8) {
    return headParts.map(normalizeIpv6Part);
  }

  if (missing < 0) return null;
  return [
    ...headParts.map(normalizeIpv6Part),
    ...Array.from({ length: missing }, () => "0"),
    ...tailParts.map(normalizeIpv6Part),
  ];
}

function normalizeIpv6Part(value: string) {
  const parsed = Number.parseInt(value || "0", 16);
  if (!Number.isFinite(parsed)) return "0";
  return parsed.toString(16);
}

function hashRateLimitValue(value: string) {
  const secret = process.env.PUBLIC_LEAD_RATE_LIMIT_SECRET?.trim();
  if (!secret && isProductionRuntime()) {
    throw new Error("PUBLIC_LEAD_RATE_LIMIT_SECRET_NOT_CONFIGURED");
  }

  return createHmac(
    "sha256",
    secret || "local-public-lead-rate-limit-development-secret"
  )
    .update(value)
    .digest("base64url")
    .slice(0, 32);
}

function redisRestConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim().replace(/\/+$/, "");
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  return { url, token };
}

function isProductionRuntime() {
  return process.env.NODE_ENV === "production" || process.env.VERCEL === "1";
}

function rateLimitFailOpen() {
  return process.env.PUBLIC_LEAD_RATE_LIMIT_FAIL_OPEN === "true";
}

function envInt(name: string, fallback: number) {
  const value = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}
