import "server-only";
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/admin-auth";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { OnboardingError, objectBody, onboardingListOptions, textFields, uuidPattern, validateOnboarding } from "@/lib/business-onboarding-contract";
const table = "business_onboardings";
const columns = ["id", ...textFields, "requested_seats", "status", "onboarding_method", "revision", "create_request_id", "created_at", "updated_at"].join(",");
const headers = { "Cache-Control": "private, no-store" };
type Operation = "list" | "read" | "create" | "update" | "summary";
async function readBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new OnboardingError("Missing request body.");
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 40000) { await reader.cancel(); throw new OnboardingError("Request too large.",413); } chunks.push(part.value); }
  try { return objectBody(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { throw new OnboardingError("Invalid JSON object."); }
}
export async function businessOnboardingRequest(request: Request, operation: Operation, id?: string) {
  try {
    const access = await requireAdminAccess(await auth());
    if (!access.authorized) return NextResponse.json({ error: access.error }, { status: 403, headers });
    if (id !== undefined && !uuidPattern.test(id)) throw new OnboardingError("Invalid onboarding ID.");
    if (operation !== "list" && new URL(request.url).search) throw new OnboardingError("Unexpected query parameters.");
    const db = createSupabaseAdminClient();
    if (operation === "summary") {
      const count = async (status?: string, types?: string[]) => {
        let q = db.from(table).select("id",{count:"exact",head:true});
        if (status) q=q.eq("status",status); if(types) q=q.in("access_type",types);
        const r=await q; if(r.error) throw r.error; return r.count || 0;
      };
      const [inProgress,awaitingInformation,awaitingPayment,trialComplimentary,readyToActivate]=await Promise.all([count(),count("awaiting_information"),count("awaiting_payment"),count(undefined,["trial","complimentary"]),count("ready_to_activate")]);
      return NextResponse.json({summary:{inProgress,awaitingInformation,awaitingPayment,trialComplimentary,readyToActivate}}, {headers});
    }
    if (operation === "list") {
      const f=onboardingListOptions(request.url);
      let q=db.from(table).select(columns,{count:"exact"});
      if(f.status) q=q.eq("status",f.status); if(f.access) q=q.eq("access_type",f.access);
      if(f.search) q=q.or(["company_name","contact_first_name","contact_last_name","contact_email"].map(k=>`${k}.ilike.${f.operand}`).join(","));
      const {data,error,count}=await q.order("updated_at",{ascending:false}).order("id",{ascending:false}).range((f.page-1)*25,f.page*25-1);
      if(error) throw error;
      return NextResponse.json({items:data || [],total:count || 0,page:f.page,pageSize:25},{headers});
    }
    if(operation === "read") {
      const {data,error}=await db.from(table).select(columns).eq("id",id).maybeSingle();
      if(error) throw error; if(!data) throw new OnboardingError("Onboarding not found.",404);
      return NextResponse.json({record:data},{headers});
    }
    const origin=request.headers.get("origin");
    if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site") throw new OnboardingError("Cross-origin mutation denied.",403);
    const body=await readBody(request);
    const metadata=operation === "create" ? "create_request_id" : "revision";
    const { [metadata]: supplied, ...input }=body;
    const payload=validateOnboarding(input);
    const now=new Date().toISOString();
    if(operation === "create") {
      if(typeof supplied !== "string" || !uuidPattern.test(supplied)) throw new OnboardingError("A valid create request ID is required.");
      const inserted=await db.from(table).insert({...payload,create_request_id:supplied,onboarding_method:"dmi_managed",revision:1,created_at:now,updated_at:now,created_by_clerk_user_id:access.userId,updated_by_clerk_user_id:access.userId}).select(columns).single();
      if(!inserted.error) return NextResponse.json({record:inserted.data},{status:201,headers});
      if(inserted.error.code !== "23505") throw inserted.error;
      const existing=await db.from(table).select(columns+",created_by_clerk_user_id").eq("create_request_id",supplied).maybeSingle();
      if(existing.error) throw existing.error;
      const row=existing.data as unknown as Record<string,unknown> | null;
      if(!row || row.created_by_clerk_user_id !== access.userId || row.revision !== 1 || Object.entries(payload).some(([k,v])=>row[k] !== v)) throw new OnboardingError("Create request already used with different or updated data. Reload the saved record before continuing.",409);
      const {created_by_clerk_user_id: actor,...record}=row; void actor;
      return NextResponse.json({record},{headers});
    }
    if(typeof supplied !== "number" || !Number.isSafeInteger(supplied) || supplied<1 || supplied>=Number.MAX_SAFE_INTEGER) throw new OnboardingError("A valid saved revision is required.");
    const {data,error}=await db.from(table).update({...payload,updated_at:now,updated_by_clerk_user_id:access.userId,revision:supplied+1}).eq("id",id).eq("revision",supplied).select(columns).maybeSingle();
    if(error) throw error;
    if(!data) throw new OnboardingError("This onboarding changed or is unavailable. Reload it before saving; your inputs have been preserved.",409);
    return NextResponse.json({record:data},{headers});
  } catch(error) {
    if((error as {message?:string})?.message === "BUSINESS_TERMS_LOCKED_USE_COMMERCIAL_ACTION") error = new OnboardingError("Commercial terms are already approved. Reload and use an explicit commercial action; other inputs have been preserved.",409);
    return NextResponse.json({error:error instanceof OnboardingError ? error.message : "Onboarding operation was not confirmed. Keep your inputs and retry safely."},{status:error instanceof OnboardingError ? error.status : 503,headers});
  }
}
