import "server-only";
import { BILLING_WORK_DATABASE, BILLING_WORK_PROJECT, BILLING_WORK_SCOPE } from "./billing-work-config";

type Environment = Record<string, string | undefined>;
// Deployment identity and credential mode, never the request hostname, establish
// trust. Production cannot satisfy these initial custom-Staging-only guards.
export function embeddedCheckoutEnvironment(env: Environment = process.env) {
  if (env.VERCEL_ENV !== "preview" || env.VERCEL_TARGET_ENV !== "staging" ||
      env.VERCEL_PROJECT_ID !== BILLING_WORK_PROJECT || env.NEXT_PUBLIC_SUPABASE_URL !== BILLING_WORK_DATABASE ||
      env.STRIPE_ACCOUNT_SCOPE !== BILLING_WORK_SCOPE || !/^(sk|rk)_test_[A-Za-z0-9]+$/.test(env.STRIPE_SECRET_KEY || "") ||
      !/^pk_test_[A-Za-z0-9]+$/.test(env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || "")) return null;
  return { origin: "https://staging.dmicards.com", publishableKey: env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY! };
}

export function embeddedCheckoutEnabled(env: Environment = process.env) {
  return env.BILLING_EMBEDDED_CHECKOUT_ENABLED === "true" && embeddedCheckoutEnvironment(env) !== null;
}

export function embeddedCheckoutRuntimeMatches(scope: string, live: boolean) {
  return scope === BILLING_WORK_SCOPE && live === false;
}
