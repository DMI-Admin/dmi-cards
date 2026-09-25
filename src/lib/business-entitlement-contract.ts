import { OnboardingError, objectBody, uuidPattern } from "@/lib/business-onboarding-contract";
export const activationActions = ["activate_invoice", "activate_trial", "activate_complimentary"] as const;
export const amendmentActions = ["amend", "suspend", "reactivate", "revoke"] as const;
export const commercialLabels: Record<string,string> = {
 activate_invoice:"Invoice payment confirmed", activate_trial:"Trial activated", activate_complimentary:"Complimentary access activated",
 amend:"Commercial terms amended", suspend:"Entitlement suspended", reactivate:"Entitlement reactivated", revoke:"Entitlement revoked",
};
export type CommercialCommand = {
 operation_id:string; action:string; expected_onboarding_revision:number; expected_entitlement_revision:number;
 reason:string; confirmed:true; payment_received_date?:string; contract_reference?:string|null; seat_limit?:number; ends_at?:string;
};
export type BusinessEntitlement = {
 id:string; workspace_id:string; source:"invoice"|"trial"|"complimentary"; status:"active"|"suspended"|"revoked";
 seat_limit:number; starts_at:string; ends_at:string; contract_reference:string|null; invoice_reference:string|null;
 billing_frequency:string|null; revision:number;
};
export type CommercialEvent = BusinessEntitlement & {
 event_type:string; reason:string; actor_clerk_user_id:string; created_at:string; payment_received_date:string|null; after_entitlement_revision:number;
};
export type EntitlementView = {
 workspace:{id:string;client_id:null}|null; entitlement:BusinessEntitlement|null;
 effective_status:"absent"|"scheduled"|"active"|"expired"|"suspended"|"revoked";
 effective_seat_allowance:number; evaluated_at:string; history:CommercialEvent[]; history_total:number; page:number; page_size:number;
};
export function validateCommercialCommand(value:unknown, activation:boolean):CommercialCommand {
 const b=objectBody(value);
 const common=["operation_id","action","expected_onboarding_revision","expected_entitlement_revision","reason","confirmed"];
 const allowed=[...common,...(activation?["payment_received_date","contract_reference"]:b.action==="amend"?["seat_limit","ends_at","contract_reference"]:[])];
 if(Object.keys(b).some(k=>!allowed.includes(k)))throw new OnboardingError("Unsupported commercial command field.");
 if(typeof b.operation_id!=="string"||!uuidPattern.test(b.operation_id))throw new OnboardingError("A valid operation ID is required.");
 if(typeof b.action!=="string"||!(activation?[...activationActions]:[...amendmentActions]).some(a=>a===b.action))throw new OnboardingError("Invalid commercial action.");
 for(const k of ["expected_onboarding_revision","expected_entitlement_revision"]){
  const n=b[k];if(typeof n!=="number"||!Number.isSafeInteger(n)||n< (k==="expected_entitlement_revision"&&activation?0:1)||n>=Number.MAX_SAFE_INTEGER)throw new OnboardingError("A saved revision is required.");
 }
 if(activation&&b.expected_entitlement_revision!==0)throw new OnboardingError("Activation requires an absent entitlement.");
 if(b.confirmed!==true||typeof b.reason!=="string"||!b.reason.trim()||b.reason.length>2000||/[\x00-\x1f]/.test(b.reason))throw new OnboardingError("Explicit confirmation and an Admin reason are required.");
 if("contract_reference" in b&&b.contract_reference!==null&&(typeof b.contract_reference!=="string"||b.contract_reference.length>2000||/[\x00-\x1f]/.test(b.contract_reference)))throw new OnboardingError("Invalid contract reference.");
 if(b.action==="activate_invoice"){
  const d=b.payment_received_date;if(typeof d!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(d)||!Number.isFinite(Date.parse(d))||new Date(d).toISOString().slice(0,10)!==d)throw new OnboardingError("A valid payment received date is required.");
 }else if("payment_received_date" in b)throw new OnboardingError("Payment confirmation applies only to invoice activation.");
 if("seat_limit" in b&&(typeof b.seat_limit!=="number"||!Number.isInteger(b.seat_limit)||b.seat_limit<1||b.seat_limit>2147483647))throw new OnboardingError("Seat allowance must be a positive whole number.");
 if("ends_at" in b){const d=b.ends_at;if(typeof d!=="string"||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(d)||!Number.isFinite(Date.parse(d))||new Date(d).toISOString()!==d.replace(/Z$/,d.includes(".")?"Z":".000Z"))throw new OnboardingError("Expiry must be a valid UTC timestamp.");}
 if(b.action==="amend"&&!["seat_limit","ends_at","contract_reference"].some(k=>k in b))throw new OnboardingError("Supply an explicit commercial amendment.");
 return {...b,reason:b.reason.trim(),...("contract_reference" in b?{contract_reference:typeof b.contract_reference==="string"?b.contract_reference.trim()||null:null}:{})} as CommercialCommand;
}
