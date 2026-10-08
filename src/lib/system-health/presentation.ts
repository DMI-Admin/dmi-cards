import type {
  HealthGroupId,
  HealthSeverity,
  HealthStatus,
  StoredMonitorCheck,
  StoredMonitorRun,
} from "./types";
import { healthGroups } from "./types";

export const displayStatuses = [
  "Operational",
  "Degraded",
  "Incident",
  "Needs investigation",
  "Setup required",
  "Staging gap",
  "Not yet monitored",
  "Unknown",
] as const;

export type DisplayStatus = (typeof displayStatuses)[number];

export type FixGuidance = {
  whereToFix: string;
  recommendedNextStep: string;
};

const serviceTitles: Record<string, string> = {
  web_application: "Web application",
  database: "Database",
  admin_authentication: "Admin authentication",
  public_cards: "Public Cards",
  contacts: "Contacts",
  upstash_rate_limiting: "Upstash rate limiting",
  apple_wallet: "Apple Wallet",
  google_wallet: "Google Wallet",
  stripe_webhook_processing: "Stripe webhook processing",
  billing_reconciliation: "Billing reconciliation",
  entitlement_processing: "Entitlement processing",
  public_lead_capture: "Public lead capture",
  media_storage: "Media storage",
  customer_authentication: "Customer authentication",
  email_automations: "Email Automations",
  external_integrations: "External integrations",
};

const specificGuidance: Record<string, FixGuidance> = {
  "google_wallet/read_only_provider_check/google_wallet_configuration_missing": {
    whereToFix: "Vercel → Staging environment variables / Google Wallet configuration",
    recommendedNextStep: "Configure the required Google Wallet Staging credentials, redeploy Staging, then rerun System Health.",
  },
  "email_automations/staging_parity/staging_parity_gap": {
    whereToFix: "Staging Supabase / Email Automations foundation",
    recommendedNextStep: "Complete the approved Email Automations Staging parity work before relying on Staging for this feature.",
  },
  "stripe_webhook_processing/operational_evidence/payment_notification_processing_problem": {
    whereToFix: "Monitoring coverage / Stripe webhook processing evidence",
    recommendedNextStep: "Investigate the failed or overdue ledger processing read-only. Do not replay events or run reconciliation automatically.",
  },
  "stripe_webhook_processing/operational_evidence/payment_notification_sample_incomplete": {
    whereToFix: "Monitoring coverage / Stripe webhook sample bounds",
    recommendedNextStep: "The bounded sample is incomplete. Review monitoring coverage read-only; this does not establish a service failure.",
  },
  "stripe_webhook_processing/operational_evidence/no_safe_operational_probe": {
    whereToFix: "Monitoring coverage / Stripe webhook evidence",
    recommendedNextStep: "No incident is proven. Add a bounded read-only operational signal before marking this check verifiable.",
  },
  "billing_reconciliation/operational_evidence/no_safe_operational_probe": {
    whereToFix: "Monitoring coverage / billing reconciliation",
    recommendedNextStep: "No incident is proven. Add a bounded read-only operational signal before marking this check verifiable.",
  },
  "customer_authentication/end_to_end/no_safe_operational_probe": {
    whereToFix: "Monitoring coverage / customer authentication",
    recommendedNextStep: "No incident is proven. Add a bounded read-only operational signal before marking this check verifiable.",
  },
  "media_storage/upload_workflow/no_safe_operational_probe": {
    whereToFix: "Monitoring coverage / media workflow",
    recommendedNextStep: "No incident is proven. Add a bounded read-only operational signal before marking this check verifiable.",
  },
  "public_lead_capture/end_to_end/no_safe_operational_probe": {
    whereToFix: "Monitoring coverage / lead capture",
    recommendedNextStep: "No incident is proven. Add a bounded read-only operational signal before marking this check verifiable.",
  },
  "external_integrations/operational_evidence/no_safe_operational_probe": {
    whereToFix: "Monitoring coverage / integrations",
    recommendedNextStep: "No incident is proven. Add a bounded read-only operational signal before marking this check verifiable.",
  },
  "entitlement_processing/operational_evidence/no_safe_operational_probe": {
    whereToFix: "Monitoring coverage / entitlements",
    recommendedNextStep: "No incident is proven. Add a bounded read-only operational signal before marking this check verifiable.",
  },
  "admin_authentication/configuration_evidence/admin_auth_not_exercised": {
    whereToFix: "Monitoring coverage / Clerk Admin authentication",
    recommendedNextStep: "Admin configuration is present, but sign-in was not exercised. Add a safe bounded authentication signal before treating this flow as verified.",
  },
};

const serviceGroups: Record<string, HealthGroupId> = {
  web_application: "core_platform",
  database: "core_platform",
  admin_authentication: "core_platform",
  customer_authentication: "core_platform",
  public_cards: "card_services",
  contacts: "card_services",
  public_lead_capture: "card_services",
  media_storage: "card_services",
  apple_wallet: "card_services",
  google_wallet: "card_services",
  stripe_webhook_processing: "payments_access",
  billing_reconciliation: "payments_access",
  entitlement_processing: "payments_access",
  upstash_rate_limiting: "infrastructure",
  email_automations: "communications_integrations",
  external_integrations: "communications_integrations",
};

const statusPriority: Record<DisplayStatus, number> = {
  Incident: 0,
  Degraded: 1,
  "Needs investigation": 2,
  "Setup required": 3,
  "Staging gap": 4,
  Operational: 5,
  "Not yet monitored": 6,
  Unknown: 7,
};

export function serviceTitle(serviceKey: string): string {
  return serviceTitles[serviceKey] ?? serviceKey.replaceAll("_", " ");
}

export function sectionForService(serviceKey: string): HealthGroupId {
  return serviceGroups[serviceKey] ?? "communications_integrations";
}

export function displayStatus(
  status: HealthStatus,
  reasonCode: string | null
): DisplayStatus {
  if (status === "operational") return "Operational";
  if (status === "degraded") return "Degraded";
  if (status === "incident") return "Incident";
  if (status === "not_configured") return "Setup required";
  if (status === "not_migrated") return "Staging gap";
  if (reasonCode === "no_safe_operational_probe" || reasonCode === "admin_auth_not_exercised") {
    return "Not yet monitored";
  }
  if (reasonCode === "check_timed_out" || reasonCode === "check_failed") {
    return "Needs investigation";
  }
  return "Unknown";
}

export function getFixGuidance(
  check: Pick<StoredMonitorCheck, "serviceKey" | "checkKey" | "storedStatus" | "reasonCode">
): FixGuidance {
  const specific = specificGuidance[
    `${check.serviceKey}/${check.checkKey}/${check.reasonCode ?? ""}`
  ];
  if (specific) return specific;

  if (check.storedStatus === "unknown" &&
    (check.reasonCode === "check_failed" || check.reasonCode === "check_timed_out")) {
    return {
      whereToFix: `System Health monitoring / ${serviceTitle(check.serviceKey)}`,
      recommendedNextStep: "Inspect the safe runtime logs for this check and rerun it; its health could not be verified.",
    };
  }

  if (check.storedStatus === "unknown" && check.reasonCode === "no_safe_operational_probe") {
    return {
      whereToFix: `Monitoring coverage / ${serviceTitle(check.serviceKey)}`,
      recommendedNextStep: "No incident is proven. Add a bounded read-only operational signal before marking this check verifiable.",
    };
  }

  if (check.storedStatus === "not_configured") {
    return {
      whereToFix: `Staging configuration / ${serviceTitle(check.serviceKey)}`,
      recommendedNextStep: "Review the safe configuration-presence evidence, configure only if this service is intended in Staging, then rerun System Health.",
    };
  }

  if (check.storedStatus === "not_migrated") {
    return {
      whereToFix: `Staging parity / ${serviceTitle(check.serviceKey)}`,
      recommendedNextStep: "Confirm whether this feature is required in Staging and complete its approved parity work if needed.",
    };
  }

  if (check.storedStatus === "operational") {
    return {
      whereToFix: "No fix indicated by this verified check",
      recommendedNextStep: "No action indicated; this check returned verified healthy evidence.",
    };
  }

  return {
    whereToFix: `Service owner / ${serviceTitle(check.serviceKey)}`,
    recommendedNextStep: "Review the safe check summary and evidence, then investigate the reported service condition.",
  };
}

export function displayCounts(checks: readonly StoredMonitorCheck[]): Record<DisplayStatus, number> {
  const counts = Object.fromEntries(displayStatuses.map((status) => [status, 0])) as Record<DisplayStatus, number>;
  for (const check of checks) counts[displayStatus(check.storedStatus, check.reasonCode)]++;
  return counts;
}

export function needsAttention(status: DisplayStatus): boolean {
  return status === "Incident" || status === "Degraded" || status === "Needs investigation";
}

export function isActionable(status: DisplayStatus): boolean {
  return needsAttention(status) || status === "Setup required" || status === "Staging gap";
}

export function overallHeadline(checks: readonly StoredMonitorCheck[]): string {
  const actionable = checks.some((check) =>
    needsAttention(displayStatus(check.storedStatus, check.reasonCode))
  );
  return actionable ? "Attention required" : "No verified incidents";
}

export function orderedGroups(checks: readonly StoredMonitorCheck[]) {
  return healthGroups.map(({ id, label }) => ({
    label,
    checks: checks.filter((check) => sectionForService(check.serviceKey) === id),
  })).filter((group) => group.checks.length > 0);
}

export function priorityOrderedChecks(checks: readonly StoredMonitorCheck[]) {
  return [...checks].sort((a, b) =>
    statusPriority[displayStatus(a.storedStatus, a.reasonCode)] -
      statusPriority[displayStatus(b.storedStatus, b.reasonCode)] ||
    b.checkedAt.localeCompare(a.checkedAt)
  );
}

export type DiagnosticReport = {
  environment: "staging";
  generated_at: string;
  overall_headline: string;
  counts_by_display_status: Record<DisplayStatus, number>;
  run_id: string;
  checks: Array<{
    service_key: string;
    check_key: string;
    stored_status: HealthStatus;
    display_status: DisplayStatus;
    severity: HealthSeverity;
    reason_code: string | null;
    safe_summary: string;
    evidence: Record<string, number | boolean>;
    checked_at: string;
    verified_at: string | null;
    where_to_fix: string;
    recommended_next_step: string;
  }>;
};

export function buildDiagnosticReport(run: StoredMonitorRun): DiagnosticReport {
  const checks = priorityOrderedChecks(run.checks).map((check) => {
    const guidance = getFixGuidance(check);
    return {
      service_key: check.serviceKey,
      check_key: check.checkKey,
      stored_status: check.storedStatus,
      display_status: displayStatus(check.storedStatus, check.reasonCode),
      severity: check.severity,
      reason_code: check.reasonCode,
      safe_summary: check.safeSummary,
      evidence: { ...check.evidence },
      checked_at: check.checkedAt,
      verified_at: check.verifiedAt,
      where_to_fix: guidance.whereToFix,
      recommended_next_step: guidance.recommendedNextStep,
    };
  });

  return {
    environment: run.environment,
    generated_at: run.generatedAt,
    overall_headline: overallHeadline(run.checks),
    counts_by_display_status: displayCounts(run.checks),
    run_id: run.runId,
    checks,
  };
}
