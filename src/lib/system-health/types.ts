export const healthStatuses = [
  "operational",
  "degraded",
  "incident",
  "not_configured",
  "not_migrated",
  "unknown",
] as const;

export type HealthStatus = (typeof healthStatuses)[number];
export type HealthSeverity = "critical" | "warning" | "info" | "none";
export type HealthGroupId =
  | "core_platform"
  | "payments_access"
  | "card_services"
  | "infrastructure"
  | "communications_integrations";
export type OverallHealthStatus =
  | "operational"
  | "attention_required"
  | "limited_visibility";
export type SafeHealthDetail = string | number | boolean | null;

export type HealthCheck = {
  service: string;
  group: HealthGroupId;
  status: HealthStatus;
  severity: HealthSeverity;
  observedAt: string | null;
  verifiedAt: string | null;
  message: string;
  evidenceSummary: string;
  details: Record<string, SafeHealthDetail>;
};

export type HealthGroup = {
  id: HealthGroupId;
  label: string;
  checks: HealthCheck[];
};

export type HealthResponse = {
  service: "dmi-cards";
  requestId: string;
  checkedAt: string;
  overall: {
    status: OverallHealthStatus;
    title: string;
    explanation: string;
    attentionCount: number;
    incidentCount: number;
  };
  groups: HealthGroup[];
};

export const healthGroups: ReadonlyArray<{
  id: HealthGroupId;
  label: string;
}> = [
  { id: "core_platform", label: "Core Platform" },
  { id: "payments_access", label: "Payments & Access" },
  { id: "card_services", label: "Card Services" },
  { id: "infrastructure", label: "Infrastructure" },
  { id: "communications_integrations", label: "Communications & Integrations" },
];

export function isHealthStatus(value: unknown): value is HealthStatus {
  return typeof value === "string" && healthStatuses.includes(value as HealthStatus);
}

export function healthSeverity(status: HealthStatus): HealthSeverity {
  if (status === "incident") return "critical";
  if (status === "degraded") return "warning";
  if (status === "operational") return "none";
  return "info";
}

export function summarizeHealth(checks: HealthCheck[]): HealthResponse["overall"] {
  const verifiedActionable = checks.filter(
    (check) =>
      check.verifiedAt !== null &&
      (check.status === "incident" || check.status === "degraded")
  );
  const incidentCount = verifiedActionable.filter((check) => check.status === "incident").length;
  const attentionCount = verifiedActionable.length;

  if (attentionCount > 0) {
    return {
      status: "attention_required",
      title: "Attention required",
      explanation: incidentCount > 0
        ? `${incidentCount} important service${incidentCount === 1 ? "" : "s"} verified as broken.`
        : `${attentionCount} verified service issue${attentionCount === 1 ? "" : "s"} need attention.`,
      attentionCount,
      incidentCount,
    };
  }

  const hasUnverified = checks.some((check) =>
    check.status === "unknown" ||
    check.status === "not_configured" ||
    check.status === "not_migrated" ||
    ((check.status === "operational" || check.status === "degraded" || check.status === "incident") &&
      check.verifiedAt === null)
  );

  if (hasUnverified) {
    return {
      status: "limited_visibility",
      title: "No verified incidents — some services cannot yet be fully checked",
      explanation: "Some services are not configured, not migrated, or do not yet have enough evidence to assess.",
      attentionCount: 0,
      incidentCount: 0,
    };
  }

  return {
    status: "operational",
    title: "All monitored systems operational",
    explanation: "Every monitored check returned verified healthy evidence.",
    attentionCount: 0,
    incidentCount: 0,
  };
}
