import "server-only";
import {BILLING_WORK_PROJECT} from "./billing-work-config";

type Environment = Record<string, string | undefined>;
export type WebhookModeDecision = "accepted" | "mode_mismatch" | "untrusted_runtime";

/** Deployment identity only. No browser inputs, account-field dependency, I/O or feature flags.
 * Existing downstream account, price, database and billing guards still apply.
 */
export function stripeWebhookModeDecision(livemode: unknown, env: Environment = process.env): WebhookModeDecision {
  if (env.VERCEL_PROJECT_ID !== BILLING_WORK_PROJECT) return "untrusted_runtime";
  if (env.VERCEL_ENV === "production" && env.VERCEL_TARGET_ENV === "production") {
    return livemode === true ? "accepted" : "mode_mismatch";
  }
  if (env.VERCEL_ENV === "preview" && env.VERCEL_TARGET_ENV === "staging") {
    return livemode === false ? "accepted" : "mode_mismatch";
  }
  return "untrusted_runtime";
}
