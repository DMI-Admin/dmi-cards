import { categoryForHealth } from "./analysis-contract";
import { serviceTitle } from "./presentation";
import type { StoredMonitorCheck } from "./types";

export const ownerStates = ["working", "toComplete", "notMonitored", "attention", "critical", "unknown"] as const;
export type OwnerState = (typeof ownerStates)[number];
export const ownerLabels: Record<OwnerState, string> = {
  working: "Working", toComplete: "To complete", notMonitored: "Not monitored yet",
  attention: "Needs attention", critical: "Critical", unknown: "Status unknown",
};
export type OwnerCounts = Record<OwnerState, number>;

export function ownerState(check: StoredMonitorCheck): OwnerState {
  const category = categoryForHealth(check.storedStatus, check.reasonCode);
  // Never promote missing/invalid verification to a verified owner state.
  if (["healthy", "degraded", "verified_incident"].includes(category) &&
    (!check.verifiedAt || !Number.isFinite(Date.parse(check.verifiedAt)))) return "unknown";
  switch (category) {
    case "healthy": return "working";
    case "setup_required": case "staging_gap": return "toComplete";
    case "coverage_gap": return "notMonitored";
    case "degraded": case "monitoring_failure": return "attention";
    case "verified_incident": return "critical";
    default: return "unknown";
  }
}

export function ownerCounts(checks: readonly StoredMonitorCheck[]): OwnerCounts {
  const counts = Object.fromEntries(ownerStates.map((state) => [state, 0])) as OwnerCounts;
  for (const check of checks) counts[ownerState(check)]++;
  return counts;
}

export function ownerSectionState(checks: readonly StoredMonitorCheck[]): OwnerState {
  const counts = ownerCounts(checks);
  for (const state of ["critical", "attention", "toComplete", "notMonitored", "unknown"] as const) {
    if (counts[state]) return state;
  }
  return checks.length ? "working" : "unknown";
}

export function ownerOverview(checks: readonly StoredMonitorCheck[]) {
  const counts = ownerCounts(checks);
  if (counts.critical) return { headline: "A verified Staging service problem needs attention", explanation: "Review the critical checks below. Other setup and monitoring gaps are shown separately." };
  if (counts.attention) return { headline: "Some Staging checks need attention", explanation: "A check reported a degraded condition or could not complete. A monitoring failure does not prove a service outage." };
  if (!checks.length || counts.unknown) return { headline: "Some Staging health results are unknown", explanation: "There is not enough verified evidence to describe all checks as working." };
  if (counts.toComplete || counts.notMonitored) return { headline: "No verified service problems detected", explanation: "Some Staging setup and monitoring are still incomplete." };
  return { headline: "All monitored Staging checks are working", explanation: "Every check in this saved run passed. This describes the checks performed, not every possible service workflow." };
}

const titles: Record<string, string> = {
  web_application: "Website monitoring", database: "Database", admin_authentication: "Admin sign-in",
  customer_authentication: "Customer sign-in", stripe_webhook_processing: "Payment notifications",
  billing_reconciliation: "Billing checks", entitlement_processing: "Paid access",
  public_lead_capture: "Enquiry capture", media_storage: "Media uploads",
  upstash_rate_limiting: "Request protection", apple_wallet: "Apple Wallet configuration",
};
const scopes: Record<string, string> = {
  "stripe_webhook_processing/operational_evidence": "Recent Stripe webhook processing records show no failed or overdue processing in the bounded sample.",
  "web_application/runtime": "The Staging monitoring endpoint responded.",
  "database/bounded_read": "The saved template catalogue could be read.",
  "public_cards/read_model": "Saved card data could be read. This does not test the whole public-card experience.",
  "contacts/read_model": "Saved Contacts data could be read.",
  "upstash_rate_limiting/redis_ping": "The request-protection data service responded. This does not test every request limit.",
  "apple_wallet/certificate_configuration": "The configured signing certificate passed its checks. This does not test creating or downloading a Wallet pass.",
  "google_wallet/read_only_provider_check": "The read-only Google Wallet check passed. This does not test creating or saving a pass.",
};

export function ownerCheck(check: StoredMonitorCheck) {
  const state = ownerState(check);
  const title = titles[check.serviceKey] ?? serviceTitle(check.serviceKey);
  let explanation: string;
  let problem: string;
  let nextStep: string;
  switch (state) {
    case "working":
      explanation = scopes[`${check.serviceKey}/${check.checkKey}`] ?? "This saved check passed. Only the recorded check was verified.";
      problem = "No problem was detected by this check.";
      nextStep = "No action is indicated by this check.";
      break;
    case "toComplete":
      explanation = check.storedStatus === "not_migrated" ? "Its Staging setup isn't complete yet." : "Staging setup isn't finished yet.";
      problem = "This is incomplete setup, not a verified service incident.";
      nextStep = "Review whether this feature is needed in Staging and plan the remaining setup.";
      break;
    case "notMonitored":
      explanation = check.serviceKey === "admin_authentication" && check.reasonCode === "admin_auth_not_exercised"
        ? "Login configuration was found, but automatic checks do not test successful Admin sign-in."
        : "DMI Cards does not yet have an automatic check that verifies this workflow.";
      problem = "No problem has been demonstrated. Not monitored does not mean broken.";
      nextStep = check.serviceKey === "admin_authentication" ? "Plan a safe automatic sign-in check." : "Plan a safe monitoring check when this area is needed.";
      break;
    case "attention":
      explanation = check.storedStatus === "degraded" ? "This check verified a degraded condition. The evidence does not establish a complete outage." : "The monitoring check failed or took too long, so it could not verify the service.";
      problem = check.storedStatus === "degraded" ? "A degraded condition is confirmed; a complete outage is not established." : "A monitoring problem is confirmed; a service outage is not established.";
      nextStep = "Prepare a read-only investigation and review the evidence before making changes.";
      break;
    case "critical":
      explanation = "This saved check verified a service failure within the scope of its probe.";
      problem = "Yes. A failure was verified by this check.";
      nextStep = "Prioritise a read-only investigation and review proposed changes before acting.";
      break;
    default:
      explanation = check.serviceKey === "stripe_webhook_processing" && check.checkKey === "operational_evidence" &&
        check.reasonCode === "payment_notification_sample_incomplete"
        ? "The payment-notification sample reached its fixed limit. Monitoring evidence is incomplete; no service failure is established."
        : "This saved result does not contain enough verified evidence to establish the current state.";
      problem = "Unknown. This does not establish a service failure.";
      nextStep = "Review the technical evidence before deciding whether investigation is needed.";
  }
  return { state, title, explanation, problem, nextStep };
}
