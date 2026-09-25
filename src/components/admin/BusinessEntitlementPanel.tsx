"use client";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import type { OnboardingRecord } from "@/lib/business-onboarding-contract";
import { commercialLabels, type CommercialCommand, type EntitlementView } from "@/lib/business-entitlement-contract";
import styles from "./BusinessOnboardingPage.module.css";
const displayUTC=(value:string)=>new Date(value).toISOString().replace("T"," ").replace(/\.\d{3}Z$/," UTC");
const labels:Record<string,string>={activate_invoice:"Mark Payment Received",activate_trial:"Activate Trial",activate_complimentary:"Activate Complimentary Access",amend:"Amend Commercial Terms",suspend:"Suspend Entitlement",reactivate:"Reactivate Entitlement",revoke:"Revoke Entitlement"};
type Props={record:OnboardingRecord;disabled:boolean;onBusy:(value:boolean)=>void;onLocked:(value:boolean)=>void;onCommitted:()=>Promise<void>};
export default function BusinessEntitlementPanel({record,disabled,onBusy,onLocked,onCommitted}:Props){
 const {getToken}=useAuth();
 const [view,setView]=useState<EntitlementView|null>(null),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const [reviewed,setReviewed]=useState<{record:OnboardingRecord;view:EntitlementView}|null>(null);
 const [page,setPage]=useState(1),[refresh,setRefresh]=useState(0),[action,setAction]=useState("");
 const [reason,setReason]=useState(""),[reference,setReference]=useState(""),[payment,setPayment]=useState(()=>new Date().toISOString().slice(0,10));
 const [seats,setSeats]=useState(""),[expiry,setExpiry]=useState(""),[busy,setBusy]=useState(false);
 const pending=useRef(false),retry=useRef<{fingerprint:string;command:CommercialCommand}|null>(null);
 useEffect(()=>{
  const abort=new AbortController();
  fetch(`/api/admin/business-onboardings/${record.id}/entitlement?page=${page}`,{credentials:"same-origin",cache:"no-store",signal:abort.signal})
   .then(async r=>{const j=await r.json();if(!r.ok)throw Error(j.error||"Could not load commercial approval.");if(!abort.signal.aborted){setView(j);onLocked(Boolean(j.entitlement));setError("");}})
   .catch(e=>{if(!abort.signal.aborted){setView(null);setError(e.message);onLocked(true);}});
  return ()=>abort.abort();
 },[record.id,record.revision,page,refresh,onLocked]);
 function choose(next:string){
  if(!view)return;setReviewed({record,view});setAction(next);setReason("");setNotice("");setError("");setReference(view?.entitlement?.contract_reference||"");
  setSeats(String(view?.entitlement?.seat_limit||record.requested_seats||""));setExpiry(view?.entitlement?.ends_at?new Date(view.entitlement.ends_at).toISOString().slice(0,16):"");retry.current=null;
 }
 async function submit(){
  if(pending.current||disabled||!view||!reviewed)return;
  pending.current=true;setBusy(true);onBusy(true);setError("");setNotice("");let committed=false;
  try{
   const previous=reviewed.view.entitlement;
   const amendment=action==="amend"?{
    ...(Number(seats)!==previous?.seat_limit?{seat_limit:Number(seats)}:{}),
    ...(expiry!==(previous?.ends_at?new Date(previous.ends_at).toISOString().slice(0,16):"")?{ends_at:new Date(expiry+":00Z").toISOString()}:{}),
    ...(reference!==(previous?.contract_reference||"")?{contract_reference:reference}:{})
   }:{};
   if(action==="amend"&&!Object.keys(amendment).length)throw Error("Change at least one commercial term before confirming.");
   const input={action,expected_onboarding_revision:reviewed.record.revision,expected_entitlement_revision:previous?.revision||0,reason,confirmed:true as const,
    ...(action.startsWith("activate_")?{contract_reference:reference,...(action==="activate_invoice"?{payment_received_date:payment}:{})}:action==="amend"?amendment:{})};
   const fingerprint=JSON.stringify(input);if(retry.current?.fingerprint!==fingerprint)retry.current={fingerprint,command:{...input,operation_id:crypto.randomUUID()}};
   const token=await getToken({skipCache:true});if(!token?.trim())throw Error("Please sign in again. No commercial command was sent.");
   const url=action.startsWith("activate_")?`/api/admin/business-onboardings/${record.id}/activate`:`/api/admin/business-entitlements/${previous!.id}/actions`;
   const r=await fetch(url,{method:"POST",credentials:"same-origin",cache:"no-store",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify(retry.current.command)});
   const j=await r.json();if(!r.ok)throw Error(j.error||"Commercial command was not confirmed. Retry the unchanged command safely.");
   committed=true;onLocked(true);setView(null);await onCommitted();setRefresh(n=>n+1);setAction("");retry.current=null;
   setNotice("Commercial approval recorded. No portal, staff, cards or employee seats were created.");
  }catch(e){setError((committed?"Command committed, but refresh failed. Reload the saved onboarding before another action. ":"")+(e instanceof Error?e.message:"Commercial command unavailable."));}
  finally{pending.current=false;setBusy(false);onBusy(false);}
 }
 const ent=view?.entitlement;
 return <section className={styles.commercial} aria-label="Business Entitlement">
  <h3>Business Entitlement</h3>
  <p className={styles.explainer}>Commercial approval is separate from Business Portal activation. Requested seats are proposals, not confirmed Business seats. No seat usage is tracked in this phase.</p>
  {error&&<p role="alert" className={styles.error}>{error}</p>}{notice&&<p role="status" className={styles.success}>{notice}</p>}
  {!view?<p>Commercial approval unavailable or loading. <button disabled={busy} onClick={()=>setRefresh(n=>n+1)}>Reload entitlement</button></p>:<>
   {ent?<dl className={styles.entitlementSummary}>
    {[["Source",ent.source],["Effective Status",view.effective_status],["Confirmed Seat Allowance",String(ent.seat_limit)],["Effective Allowance",String(view.effective_seat_allowance)],["Valid From",displayUTC(ent.starts_at)],["Valid Until (exclusive)",displayUTC(ent.ends_at)],["Billing Frequency",ent.billing_frequency||"Not applicable"],["Invoice Reference",ent.invoice_reference||"—"],["Contract Reference",ent.contract_reference||"—"],["Entitlement Revision",String(ent.revision)]].map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
   </dl>:<p>No authoritative Business entitlement has been granted.</p>}
   <p className={styles.explainer}>Evaluated by the database at {displayUTC(view.evaluated_at)}. <button disabled={busy} onClick={()=>setRefresh(n=>n+1)}>Refresh status</button></p>
   {!action&&<div className={styles.commercialActions}>
    {!ent&&record.access_type&&<button className={styles.primary} disabled={disabled||busy} onClick={()=>choose("activate_"+record.access_type)}>{labels["activate_"+record.access_type]}</button>}
    {ent&&ent.status!=="revoked"&&<>
     <button disabled={disabled||busy} onClick={()=>choose("amend")}>Amend Commercial Terms</button>
     <button disabled={disabled||busy} onClick={()=>choose(ent.status==="suspended"?"reactivate":"suspend")}>{ent.status==="suspended"?"Reactivate Entitlement":"Suspend Entitlement"}</button>
     <button className={styles.destructive} disabled={disabled||busy} onClick={()=>choose("revoke")}>Revoke Entitlement</button>
    </>}
   </div>}
   {disabled&&!busy&&<p className={styles.explainer}>Save or reload onboarding changes before a commercial command.</p>}
   {action&&reviewed&&<form className={styles.confirmation} aria-label="Confirm commercial action" onSubmit={e=>{e.preventDefault();void submit();}}>
    <h3>{labels[action]}</h3>
    <p><strong>{reviewed.record.company_name}</strong></p>
    {action.startsWith("activate_")&&<dl className={styles.entitlementSummary}>
     <div><dt>Seats</dt><dd>{reviewed.record.requested_seats??"Required"}</dd></div>
     <div><dt>Start (UTC)</dt><dd>{reviewed.record.contract_start?reviewed.record.contract_start+" 00:00 UTC":"Required"}</dd></div>
     <div><dt>End / expiry (exclusive, UTC)</dt><dd>{reviewed.record.contract_end?reviewed.record.contract_end+" 00:00 UTC":"Required"}</dd></div>
     {action==="activate_invoice"&&<><div><dt>Billing frequency</dt><dd>{reviewed.record.billing_frequency||"Required"}</dd></div><div><dt>Invoice reference</dt><dd>{reviewed.record.invoice_reference||"Required"}</dd></div></>}
    </dl>}
    {action==="activate_invoice"&&<p className={styles.explainer}>You are attesting that payment was received. This approves the full agreed contract term; quarterly/annual describes billing frequency only. No banking verification is performed.</p>}
    {action==="revoke"&&<p className={styles.error}>Revocation is terminal in this phase. It cannot restore an earlier entitlement.</p>}
    <fieldset disabled={busy||disabled} className={styles.fields}>
     {action==="activate_invoice"&&<label>Payment received date (UTC)<input required type="date" value={payment} onChange={e=>setPayment(e.target.value)}/></label>}
     {(action.startsWith("activate_")||action==="amend")&&<label>Contract reference<input maxLength={2000} value={reference} onChange={e=>setReference(e.target.value)}/></label>}
     {action==="amend"&&<><label>Confirmed seat allowance<input required type="number" min={1} step={1} value={seats} onChange={e=>setSeats(e.target.value)}/></label><label>Valid until (UTC, exclusive)<input required type="datetime-local" value={expiry} onChange={e=>setExpiry(e.target.value)}/></label></>}
     <label>Admin reason / confirmation reference<textarea required maxLength={2000} value={reason} onChange={e=>setReason(e.target.value)}/></label>
    </fieldset>
    <div className={styles.commercialActions}><button type="button" disabled={busy} onClick={()=>setAction("")}>Cancel</button><button type="submit" className={styles.primary} disabled={disabled||busy}>{busy?"Recording…":"Confirm "+labels[action]}</button></div>
   </form>}
   <h3>Entitlement History / Commercial Activity</h3>
   {!view.history.length?<p>No commercial commands recorded.</p>:<ol className={styles.history}>{view.history.map(event=><li key={event.id}>
    <strong>{commercialLabels[event.event_type]||event.event_type}</strong><p>{displayUTC(event.created_at)} · {event.actor_clerk_user_id}</p>
    <p>{event.seat_limit} confirmed seats · {displayUTC(event.starts_at)} — {displayUTC(event.ends_at)} (exclusive)</p>
    <p>{event.reason}</p>{event.invoice_reference&&<p>Invoice: {event.invoice_reference}</p>}{event.contract_reference&&<p>Contract: {event.contract_reference}</p>}
   </li>)}</ol>}
   <nav className={styles.pagination} aria-label="Commercial history pages"><button disabled={page<=1||busy} onClick={()=>setPage(p=>p-1)}>Previous activity</button><span>Page {page} of {Math.max(1,Math.ceil(view.history_total/25))}</span><button disabled={page*25>=view.history_total||busy} onClick={()=>setPage(p=>p+1)}>Next activity</button></nav>
  </>}
 </section>;
}
