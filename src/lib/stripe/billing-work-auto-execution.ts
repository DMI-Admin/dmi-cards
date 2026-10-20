import "server-only";
import {createRecoveryEntitlementDiagnostics} from "./billing-recovery-entitlement-diagnostics";
import {invoiceProofProductionOptions} from "./finance-invoice-proof-config";
import {createDisabledBillingWorkerRuntime} from "./billing-work-runtime";
import {createSupabaseAdminClient} from "@/lib/supabase-admin";
import {getStripeServerClient} from "./config";
import type {BillingWorkConfiguration} from "./billing-work-config";
import type {AutomaticRuntime} from "./billing-work-auto-runner";
import {entitlementClaimDiagnosticStore} from "./billing-work-claim-diagnostics";
/** Shared by automatic POST and post-admission acceleration only. Manual
 * recovery/selector construction is deliberately unchanged. No authority added.
 */
export function createAutomaticBillingRuntime(config:BillingWorkConfiguration):AutomaticRuntime {
 if(config.state!=="enabled")throw Error("BILLING_WORK_DISABLED");
 const proofs=invoiceProofProductionOptions();
 const base=proofs?{...config.worker,proofs}:config.worker;
 const entitlementDiagnostics=createRecoveryEntitlementDiagnostics(process.env);
 const worker=entitlementDiagnostics?{...base,entitlementDiagnostics}:base;
 const db=createSupabaseAdminClient();
 const deps=createDisabledBillingWorkerRuntime(db,getStripeServerClient(),worker);
 if(!deps)throw Error("BILLING_WORK_DISABLED");
 return {deps:{...deps,store:entitlementClaimDiagnosticStore(deps.store,db)},worker};
}
