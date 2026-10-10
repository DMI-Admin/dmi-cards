import "server-only";
import type {WorkerOptIn} from "./billing-work-worker";

// Reviewed deployment identities. These are public routing targets, not credentials.
export const BILLING_WORK_SCOPE = "acct_1OoTzlG71GpCYtA4:test";
export const BILLING_WORK_PROJECT = "prj_FPTsXDokhm5uSDMaxieuo5Cmp0Rn";
export const BILLING_WORK_DATABASE = "https://uohdkewufeivdpaljnng.supabase.co";
type Environment = Record<string, string | undefined>;
export type BillingWorkConfiguration = {state:"disabled"}|{state:"rejected"}|{state:"enabled";scope:string;worker:WorkerOptIn};
/** Two independent server-only switches. Merely deploying code enables neither.
 * Invalid opt-in fails closed; it must never select the inline billing fallback.
 */
export function billingWorkConfiguration(kind:"handoff"|"recovery", env:Environment=process.env):BillingWorkConfiguration {
 const flag=kind==="handoff"?env.BILLING_WORK_HANDOFF_ENABLED:env.BILLING_WORK_RECOVERY_ENABLED;
 if(flag!=="true")return {state:"disabled"};
 if(env.VERCEL_ENV!=="preview"||env.VERCEL_TARGET_ENV!=="staging"||env.VERCEL_PROJECT_ID!==BILLING_WORK_PROJECT||env.NEXT_PUBLIC_SUPABASE_URL!==BILLING_WORK_DATABASE||env.BILLING_WORK_STRIPE_SCOPE!==BILLING_WORK_SCOPE||!/^(sk|rk)_test_/.test(env.STRIPE_SECRET_KEY??""))return {state:"rejected"};
 return {state:"enabled",scope:BILLING_WORK_SCOPE,worker:{target:"staging",project:"uohdkewufeivdpaljnng",approvedScope:BILLING_WORK_SCOPE,approval:"reviewed_staging_billing_worker_v1"}};
}
