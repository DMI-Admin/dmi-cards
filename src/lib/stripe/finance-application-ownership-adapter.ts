import "server-only";
import type {SupabaseClient} from "@supabase/supabase-js";
import {validOwnershipKey,type OwnershipKey,type OwnershipRecord} from "./finance-application-ownership";
import {RELATIONSHIP_DEADLINE_MS} from "./finance-customer-relationships";
/** Inactive exact-read adapter. One whole invocation: <=2 reads, <=2 seconds.
 * Application state is joined in the same exact read. No scans, retries, writes or provider fallback.
 * IDs remain internal; only fixed failure reasons leave this helper.
 */
export async function readFinanceOwnership(db:Pick<SupabaseClient,"from">,keys:readonly OwnershipKey[],
 options:{signal?:AbortSignal}={}):Promise<{state:"read";records:OwnershipRecord[]}|{state:"unresolved";reason:"invalid_evidence"|"lookup_unavailable"|"lookup_timeout_ambiguous"|"lookup_cancelled_ambiguous"}> {
 if(keys.length>2||!keys.length||keys.some(k=>!validOwnershipKey(k))||keys.some(k=>k.scope!==keys[0].scope)||new Set(keys.map(k=>`${k.type}:${k.id}`)).size!==keys.length)return {state:"unresolved",reason:"invalid_evidence"};
 const started=performance.now();const controller=new AbortController();let reason:"lookup_timeout_ambiguous"|"lookup_cancelled_ambiguous"="lookup_timeout_ambiguous";
 let stop!:()=>void;const interrupted=new Promise<{state:"unresolved";reason:"lookup_timeout_ambiguous"|"lookup_cancelled_ambiguous"}>(resolve=>{stop=()=>resolve({state:"unresolved",reason});});
 controller.signal.addEventListener("abort",stop,{once:true});
 const cancel=()=>{reason="lookup_cancelled_ambiguous";controller.abort();};
 const timer=setTimeout(()=>controller.abort(),RELATIONSHIP_DEADLINE_MS);options.signal?.addEventListener("abort",cancel,{once:true});
 if(options.signal?.aborted)cancel();
 const work=async()=>{
  const records:OwnershipRecord[]=[];
  for(const k of keys){
   if(performance.now()-started>=RELATIONSHIP_DEADLINE_MS){reason="lookup_timeout_ambiguous";controller.abort();}
   if(controller.signal.aborted)return {state:"unresolved" as const,reason};
   try {
    const {data,error}=await db.from("billing_stripe_resource_ownership")
     .select("stripe_scope,resource_type,stripe_resource_id,application_key,ownership_basis,provenance,revision,state,billing_stripe_applications!inner(state)")
     .eq("stripe_scope",k.scope).eq("resource_type",k.type).eq("stripe_resource_id",k.id).abortSignal(controller.signal).maybeSingle();
    if(performance.now()-started>=RELATIONSHIP_DEADLINE_MS){reason="lookup_timeout_ambiguous";controller.abort();}
   if(controller.signal.aborted)return {state:"unresolved" as const,reason};
    if(error)return {state:"unresolved" as const,reason:"lookup_unavailable" as const};
    if(!data)continue;
    const r=data as unknown as Record<string,unknown>,app=r.billing_stripe_applications as {state?:string}|null;
    if(r.stripe_scope!==k.scope||r.resource_type!==k.type||r.stripe_resource_id!==k.id||!app||Array.isArray(app))return {state:"unresolved" as const,reason:"lookup_unavailable" as const};
    records.push({...k,application:r.application_key as string,basis:r.ownership_basis as OwnershipRecord["basis"],provenance:r.provenance as OwnershipRecord["provenance"],revision:Number(r.revision),state:r.state as OwnershipRecord["state"],applicationActive:app.state==="active"});
   }catch{return {state:"unresolved" as const,reason:"lookup_unavailable" as const};}
  }
  return {state:"read" as const,records};
 };
 try{return await Promise.race([work(),interrupted]);}finally{clearTimeout(timer);options.signal?.removeEventListener("abort",cancel);}
}
