import "server-only";
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/admin-auth";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { OnboardingError, uuidPattern } from "@/lib/business-onboarding-contract";
import { validateCommercialCommand } from "@/lib/business-entitlement-contract";
const headers={"Cache-Control":"private, no-store"};
const messages:Record<string,string>={
 BUSINESS_STALE_ONBOARDING:"Onboarding changed. Reload the saved record before confirming again.",
 BUSINESS_STALE_ENTITLEMENT:"Entitlement changed. Reload before confirming again.",
 BUSINESS_OPERATION_CONFLICT:"This operation ID was already used for a different command.",
 BUSINESS_ALREADY_ACTIVATED:"An entitlement already exists. Use an explicit commercial action.",
 BUSINESS_REVOKED_TERMINAL:"Revoked entitlement cannot be reactivated in this phase.",
 BUSINESS_INVALID_TRANSITION:"That transition is not valid for the current entitlement or expiry.",
 BUSINESS_INCOMPLETE_COMMERCIAL_TERMS:"Save complete seats, source and finite contract dates first. Resolve Awaiting Information before activation.",
 BUSINESS_PAYMENT_ATTESTATION_REQUIRED:"Invoice reference, billing frequency and payment received date are required.",
 BUSINESS_FUTURE_PAYMENT_DATE:"Payment received date cannot be in the future.",
 BUSINESS_EXPIRY_MUST_BE_FUTURE:"The amended expiry must be in the future.",
};
export async function businessEntitlementRequest(request:Request,operation:"read"|"activate"|"action",id:string){
 try{
  const access=await requireAdminAccess(await auth());
  if(!access.authorized)return NextResponse.json({error:access.error},{status:403,headers});
  if(!uuidPattern.test(id))throw new OnboardingError("Invalid record ID.");
  const query=new URL(request.url).searchParams;
  const db=createSupabaseAdminClient();
  if(operation==="read"){
   if([...query.keys()].some(k=>k!=="page")||query.getAll("page").length>1||! /^[1-9][0-9]{0,4}$/.test(query.get("page")||"1"))throw new OnboardingError("Invalid history page.");
   const {data,error}=await db.rpc("get_business_entitlement",{p_onboarding_id:id,p_page:Number(query.get("page")||1)});
   if(error)throw error;return NextResponse.json(data,{headers});
  }
  if(query.size)throw new OnboardingError("Unexpected query parameters.");
  const origin=request.headers.get("origin");
  if((origin&&origin!==new URL(request.url).origin)||request.headers.get("sec-fetch-site")==="cross-site")throw new OnboardingError("Cross-origin mutation denied.",403);
  const reader=request.body?.getReader();if(!reader)throw new OnboardingError("Missing command.");
  const chunks:Uint8Array[]=[];let size=0;
  while(true){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>16000){await reader.cancel();throw new OnboardingError("Command too large.",413);}chunks.push(next.value);}
  let body:unknown;try{body=JSON.parse(Buffer.concat(chunks).toString("utf8"));}catch{throw new OnboardingError("Invalid JSON.");}
  const command=validateCommercialCommand(body,operation==="activate");
  const {data,error}=await db.rpc("admin_command_business_entitlement",{p_onboarding_id:operation==="activate"?id:null,p_entitlement_id:operation==="action"?id:null,p_actor:access.userId,p_command:command});
  if(error)throw error;return NextResponse.json({result:data},{headers});
 }catch(error){
  if(error instanceof OnboardingError)return NextResponse.json({error:error.message},{status:error.status,headers});
  const failure=error as {code?:string;message?:string};
  const status=failure.code==="P0002"?404:failure.code==="P0001"||failure.code==="23505"?409:failure.code?.startsWith("22")||failure.code==="23514"?400:503;
  const message=messages[failure.message||""]||(status===404?"Onboarding or entitlement not found.":status===400?"Invalid commercial terms. Check dates, references and seats.":"Commercial operation was not confirmed. Keep the command and retry safely; do not assume access was granted.");
  return NextResponse.json({error:message},{status,headers});
 }
}
