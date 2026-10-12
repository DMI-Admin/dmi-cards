import "server-only";
import type {DmiProofOptions} from "./finance-dmi-charge-integration";

type Environment = Record<string,string|undefined>;
/** Trusted server-only DMI proof flags. Invalid/missing guards leave all options OFF.
 * Production and historical consumption are independent. Wake requires consumption.
 * Uses the existing Finance account scope; recovery and handoff switches are independent.
 */
export function invoiceProofProductionOptions(env:Environment=process.env):DmiProofOptions|undefined {
 const production=env.DMI_FINANCE_INVOICE_PROOF_PRODUCTION_ENABLED==="true";
 const consumption=env.DMI_FINANCE_CHARGE_PROOF_CONSUMPTION_ENABLED==="true";
 const wake=consumption&&env.DMI_FINANCE_CHARGE_DEPENDENCY_WAKE_ENABLED==="true";
 if(!production&&!consumption)return undefined;
 if(env.VERCEL_ENV!=="preview"||env.VERCEL_TARGET_ENV!=="staging"
  ||env.VERCEL_PROJECT_ID!=="prj_FPTsXDokhm5uSDMaxieuo5Cmp0Rn"
  ||env.NEXT_PUBLIC_SUPABASE_URL!=="https://uohdkewufeivdpaljnng.supabase.co"
  ||env.STRIPE_ACCOUNT_SCOPE!=="acct_1OoTzlG71GpCYtA4:test"
  ||!/^(sk|rk)_test_[A-Za-z0-9]+$/.test(env.STRIPE_SECRET_KEY??""))return undefined;
 return {approvedScope:"acct_1OoTzlG71GpCYtA4:test",approval:"reviewed_staging_dmi_charge_v1",production,consumption,wake};
}
