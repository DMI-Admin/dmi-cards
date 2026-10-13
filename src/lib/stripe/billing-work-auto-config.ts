import "server-only";
import {billingWorkConfiguration,type BillingWorkConfiguration} from "./billing-work-config";

type Environment=Record<string,string|undefined>;
// Local project metadata does not establish a 300s platform ceiling. Preserve
// the existing 90s recovery ceiling until deployment capability is reviewed.
export const AUTOMATIC_FUNCTION_SECONDS=90;
export const AUTOMATIC_RESPONSE_RESERVE_MS=5_000;
export const AUTOMATIC_ADMISSION_DEADLINE_MS=240_000;
export function billingWorkAutomaticConfiguration(kind:"run"|"kick",env:Environment=process.env):BillingWorkConfiguration {
 if(env.BILLING_WORK_AUTOMATIC_RUN_ENABLED!=="true"||
   (kind==="kick"&&env.BILLING_WORK_POST_ADMISSION_KICK_ENABLED!=="true"))return {state:"disabled"};
 const recovery=billingWorkConfiguration("recovery",env);
 // Tighten credential/scope checks without broadening the reviewed recovery gate.
 if(recovery.state!=="enabled"||env.STRIPE_ACCOUNT_SCOPE!==recovery.scope||
   !/^(sk|rk)_test_[A-Za-z0-9]+$/.test(env.STRIPE_SECRET_KEY??""))return {state:"rejected"};
 return recovery;
}
