import "server-only";
import {billingWorkConfiguration,BILLING_WORK_SCOPE} from "./billing-work-config";

export const recoveryEntitlementStages=["receipt_claim","subscription_identity_read","subscription_identity_validate","account_claim","subscription_fenced_read","customer_read","customer_validate","user_mirror_read","approved_price_read","snapshot_prepare","customer_bind","subscription_commit","receipt_fail"] as const;
export const recoveryFailureCategories=["provider_transport","provider_unavailable","database_transport","database_timeout","response_shape","type_error","range_error","billing_failure","unclassified"] as const;
export type RecoveryEntitlementStage=typeof recoveryEntitlementStages[number];
export type RecoveryFailureCategory=typeof recoveryFailureCategories[number];
export type RecoveryDiagnostic={stage:RecoveryEntitlementStage;outcome:"started"|"succeeded"|"failed";failure_category?:RecoveryFailureCategory};
export type RecoveryEntitlementDiagnostics={
 run<T>(stage:RecoveryEntitlementStage,work:()=>Promise<T>,shape?:(value:T)=>boolean,isBillingFailure?:(error:unknown)=>boolean):Promise<T>;
 sync<T>(stage:RecoveryEntitlementStage,work:()=>T,isBillingFailure?:(error:unknown)=>boolean):T;
};
const providerStages=new Set<RecoveryEntitlementStage>(["subscription_identity_read","subscription_fenced_read","customer_read"]);
/** Classification reads only approved structured fields. No message, stack, name,
 * constructor, payload or arbitrary value is emitted. Hostile getters fail safely. */
export function classifyRecoveryEntitlementFailure(error:unknown,stage:RecoveryEntitlementStage,isBillingFailure?:(error:unknown)=>boolean):RecoveryFailureCategory{
 try{
  if(error instanceof TypeError)return "type_error";
  if(error instanceof RangeError)return "range_error";
  if(error&&typeof error==="object"){
   const e=error as {code?:unknown;type?:unknown;category?:unknown;claimFailureCategory?:unknown};
   if(e.code==="57014"||e.claimFailureCategory==="DATABASE_TIMEOUT_OR_CANCELLED")return "database_timeout";
   if(["08000","08001","08003","08004","08006","08007","08P01","57P01","57P02","57P03","PGRST000","PGRST001","PGRST002"].includes(e.code as string)||e.claimFailureCategory==="DATABASE_UNAVAILABLE")return "database_transport";
   if(e.type==="StripeConnectionError")return "provider_transport";
   if(["StripeAPIError","StripeAuthenticationError","StripePermissionError","StripeRateLimitError","StripeInvalidRequestError"].includes(e.type as string)||e.category==="provider_unavailable")return "provider_unavailable";
   if(["ECONNRESET","ECONNREFUSED","ETIMEDOUT","ENOTFOUND","EAI_AGAIN"].includes(e.code as string))return providerStages.has(stage)?"provider_transport":"database_transport";
  }
  if(isBillingFailure?.(error))return "billing_failure";
 }catch{/* Diagnostic classification cannot interfere with billing. */}
 return "unclassified";
}
/** Explicit flag, custom Staging, project/database/test credentials/scope only.
 * Handoff, proof and recovery flags are never changed or implicitly enabled. */
export function createRecoveryEntitlementDiagnostics(env:Record<string,string|undefined>,sink:(entry:RecoveryDiagnostic)=>void=entry=>console.info(JSON.stringify(entry))):RecoveryEntitlementDiagnostics|undefined{
 if(env.BILLING_WORK_ENTITLEMENT_DIAGNOSTICS_ENABLED!=="true"||billingWorkConfiguration("recovery",env).state!=="enabled"
  ||env.STRIPE_ACCOUNT_SCOPE!==BILLING_WORK_SCOPE||!/^(sk|rk)_test_[A-Za-z0-9]+$/.test(env.STRIPE_SECRET_KEY??""))return undefined;
 function emit(stage:RecoveryEntitlementStage,outcome:RecoveryDiagnostic["outcome"],failure_category?:RecoveryFailureCategory){
  try{if(!recoveryEntitlementStages.includes(stage))return;
   sink({stage,outcome,...(outcome==="failed"?{failure_category:failure_category??"unclassified"}:{})});
  }catch{/* Logging is best-effort; no effect on execution, fences or responses. */}
 }
 return {
  async run(stage,work,shape,isBillingFailure){
   emit(stage,"started");
   try{const value=await work();let valid=true;try{if(shape)valid=shape(value);}catch{valid=false;}
    emit(stage,valid?"succeeded":"failed",valid?undefined:"response_shape");return value;
   }catch(error){emit(stage,"failed",classifyRecoveryEntitlementFailure(error,stage,isBillingFailure));throw error;}
  },
  sync(stage,work,isBillingFailure){emit(stage,"started");try{const value=work();emit(stage,"succeeded");return value;}catch(error){emit(stage,"failed",classifyRecoveryEntitlementFailure(error,stage,isBillingFailure));throw error;}}
 };
}
