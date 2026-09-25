"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import Sidebar from "@/components/Sidebar";
import { accessTypes, onboardingStatuses, statusLabels, textFields, validateOnboarding, type OnboardingRecord } from "@/lib/business-onboarding-contract";
import BusinessEntitlementPanel from "./BusinessEntitlementPanel";
import styles from "./BusinessOnboardingPage.module.css";
type Form = Record<string,string>;
type Summary = { inProgress:number; awaitingInformation:number; awaitingPayment:number; trialComplimentary:number; readyToActivate:number };
const blank = (): Form => Object.fromEntries([...textFields.map(k=>[k,""]),["requested_seats",""],["status","draft"]]);
function formFor(record:OnboardingRecord):Form { return Object.fromEntries(Object.keys(blank()).map(k=>[k,String(record[k as keyof OnboardingRecord] ?? "")])); }
const groups = [
 {title:"Company Details",fields:[["company_name","Company / Trading Name"],["legal_company_name","Legal Company Name"],["registration_number","Company Registration Number"],["country_code","Country code (e.g. GB)"],["website","Website"],["address","Address"]]},
 {title:"Primary Contact",fields:[["contact_first_name","First Name"],["contact_last_name","Last Name"],["contact_email","Work Email"],["contact_phone","Phone"]]},
];
async function read<T>(path:string, signal?:AbortSignal):Promise<T> { const r=await fetch(path,{credentials:"same-origin",cache:"no-store",signal});const j=await r.json();if(!r.ok)throw Error(j.error || "Could not load onboarding.");return j; }
export default function BusinessOnboardingPage(){
 const {getToken}=useAuth();
 const [menu,setMenu]=useState(false),[open,setOpen]=useState(false),[record,setRecord]=useState<OnboardingRecord|null>(null);
 const [form,setForm]=useState<Form>(blank),[baseline,setBaseline]=useState(()=>JSON.stringify(blank()));
 const [commercialLocked,setCommercialLocked]=useState(true);
 const [requestId,setRequestId]=useState(""); const [busy,setBusy]=useState(false);const pending=useRef(false);
 const [error,setError]=useState(""),[notice,setNotice]=useState("");
 const [items,setItems]=useState<OnboardingRecord[]>([]),[total,setTotal]=useState(0),[summary,setSummary]=useState<Summary|null>(null);
 const [loading,setLoading]=useState(true),[listError,setListError]=useState("");
 const [search,setSearch]=useState(""),[status,setStatus]=useState(""),[access,setAccess]=useState(""),[page,setPage]=useState(1),[refresh,setRefresh]=useState(0);
 const panel=useRef<HTMLElement>(null);const dirty=open && JSON.stringify(form)!==baseline;
 const askLeave=useCallback(()=>!pending.current && (!dirty || window.confirm("Discard unsaved onboarding changes?")),[dirty]);
 useEffect(()=>{
  if(!dirty&&!busy)return;
  const unload=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue="";};
  const link=(e:MouseEvent)=>{const target=e.target as Element;const leaving=target?.closest?.("a[href]") || target?.closest?.("aside button")?.textContent?.trim()==="Sign Out";if(leaving && (pending.current || !window.confirm("Discard unsaved onboarding changes?"))){e.preventDefault();e.stopImmediatePropagation();}};
  // Capture history navigation before the App Router's bubble listener. A
  // cancelled navigation restores this page's URL/state without dropping inputs.
  const savedUrl=window.location.href, savedState=window.history.state;
  const historyNavigation=(e:PopStateEvent)=>{
   if(pending.current || !window.confirm("Discard unsaved onboarding changes?")){
    e.stopImmediatePropagation();window.history.pushState(savedState,"",savedUrl);
   }
  };
  window.addEventListener("beforeunload",unload);document.addEventListener("click",link,true);window.addEventListener("popstate",historyNavigation,true);
  return ()=>{window.removeEventListener("beforeunload",unload);document.removeEventListener("click",link,true);window.removeEventListener("popstate",historyNavigation,true);};
 },[dirty,busy]);
 useEffect(()=>{
  const abort=new AbortController();
  const timer=setTimeout(()=>{
   setLoading(true);setListError("");
   const params=new URLSearchParams({page:String(page),search,status,access_type:access});
   Promise.all([read<{items:OnboardingRecord[];total:number}>("/api/admin/business-onboardings?"+params,abort.signal),read<{summary:Summary}>("/api/admin/business-onboardings/summary",abort.signal)])
    .then(([list,counts])=>{if(!abort.signal.aborted){setItems(list.items);setTotal(list.total);setSummary(counts.summary);}})
    .catch(e=>{if(!abort.signal.aborted){setListError(e.message);setSummary(null);setItems([]);}})
    .finally(()=>{if(!abort.signal.aborted)setLoading(false);});
  },200);
  return ()=>{clearTimeout(timer);abort.abort();};
 },[search,status,access,page,refresh]);
 function start(){if(!askLeave())return;setCommercialLocked(false);const f=blank();setForm(f);setBaseline(JSON.stringify(f));setRecord(null);setRequestId(crypto.randomUUID());setError("");setNotice("");setOpen(true);}
 async function manage(id:string){
  if(!askLeave())return;setCommercialLocked(true);pending.current=true;setBusy(true);setError("");
  try{const {record:saved}=await read<{record:OnboardingRecord}>(`/api/admin/business-onboardings/${id}`);const f=formFor(saved);setRecord(saved);setForm(f);setBaseline(JSON.stringify(f));setOpen(true);setNotice("");setRequestId(saved.create_request_id);}
  catch(e){setError(e instanceof Error?e.message:"Could not open onboarding.");}finally{pending.current=false;setBusy(false);}
 }
 useEffect(()=>{if(open)panel.current?.focus();},[open,record?.id]);
 function update(key:string,value:string){setNotice("");setForm(f=>({...f,[key]:value,...(key==="access_type"&&value!=="invoice"?{billing_frequency:""}:{})}));}
 async function save(){
  if(pending.current)return;pending.current=true;setBusy(true);setError("");setNotice("");
  try{
   const payload=validateOnboarding({...form,requested_seats:form.requested_seats===""?null:Number(form.requested_seats)});
   const token=await getToken({skipCache:true});if(!token?.trim())throw Error("Please sign in again before saving. Your inputs are preserved.");
   const r=await fetch(record?`/api/admin/business-onboardings/${record.id}`:"/api/admin/business-onboardings",{method:record?"PATCH":"POST",credentials:"same-origin",cache:"no-store",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify({...payload,...(record?{revision:record.revision}:{create_request_id:requestId})})});
   const result=await r.json();if(!r.ok)throw Error(result.error || "Save was not confirmed. Retry without changing the inputs.");
   const saved=result.record as OnboardingRecord;const f=formFor(saved);setRecord(saved);setForm(f);setBaseline(JSON.stringify(f));setNotice("Onboarding saved successfully.");setRefresh(n=>n+1);
  }catch(e){setError(e instanceof Error?e.message:"Save was not confirmed. Keep your inputs and retry.");}
  finally{pending.current=false;setBusy(false);}
 }
 const field=(key:string,label:string,type="text")=><label key={key}>{label}{key==="address"?<textarea rows={3} maxLength={2000} value={form[key]} onChange={e=>update(key,e.target.value)}/>:<input type={type} maxLength={key==="contact_email"?254:2000} min={key==="requested_seats"?1:undefined} step={key==="requested_seats"?1:undefined} value={form[key]} onChange={e=>update(key,e.target.value)}/>}</label>;
 return <div className={styles.page}>
  <div className={`${styles.sidebar} ${menu?styles.menuOpen:""}`}><Sidebar/></div>
  <main className={styles.content}>
   <button className={styles.menu} aria-expanded={menu} onClick={()=>setMenu(!menu)}>{menu?"Close navigation":"☰ Menu"}</button>
   <header className={styles.header}><div><h1>Business Onboarding</h1><p>Manage new Business customers before workspace activation.</p></div><button className={styles.primary} disabled={busy} onClick={start}>+ New Business Onboarding</button></header>
   <div className={styles.metrics}>{([["In Progress","inProgress"],["Awaiting Information","awaitingInformation"],["Awaiting Payment","awaitingPayment"],["Trial / Complimentary","trialComplimentary"],["Ready to Activate","readyToActivate"]] as const).map(([label,key])=><div key={key}><span>{label}</span><strong>{summary?.[key]??"—"}</strong></div>)}</div>
   {error && <p role="alert" className={styles.error}>{error}</p>}
   {open && <section ref={panel} tabIndex={-1} className={styles.workspace} aria-label="Onboarding workspace">
    <div className={styles.header}><h2>{record?"Manage Business Onboarding":"New Business Onboarding"}</h2><button disabled={busy} onClick={()=>{if(askLeave())setOpen(false);}}>Close workspace</button></div>
    <p className={styles.explainer}>Proposed information only. Saving does not activate a business, confirm payment or allocate seats.</p>
    {notice && <p role="status" className={styles.success}>{notice}</p>}
    {record && <button disabled={busy} onClick={()=>void manage(record.id)}>Reload saved version</button>}
    <form onSubmit={e=>{e.preventDefault();void save();}}>
     <fieldset disabled={busy} className={styles.sections}>
      {groups.map(group=><section key={group.title}><h3>{group.title}</h3><div className={styles.fields}>{group.fields.map(([key,label])=>field(key,label,key==="contact_email"?"email":key==="website"?"url":"text"))}</div></section>)}
      <section><h3>Proposed Commercial Terms</h3><p className={styles.explainer}>Dates use 00:00 UTC. End / expiry is exclusive. Saving proposals grants no commercial entitlement.</p>{commercialLocked&&record&&<p className={styles.explainer}>Saved commercial terms are locked while checking approval or after activation. Use explicit commercial actions below.</p>}<fieldset className={styles.fields} disabled={busy||commercialLocked}>
       {field("requested_seats","Requested Seats","number")}
       <label>Access Type<select value={form.access_type} onChange={e=>update("access_type",e.target.value)}><option value="">Not specified</option>{accessTypes.map(v=><option key={v} value={v}>{v[0].toUpperCase()+v.slice(1)}</option>)}</select></label>
       {field("contract_start","Contract Start","date")}{field("contract_end","Contract End / Expiry","date")}
       {form.access_type==="invoice"&&<label>Billing Frequency<select value={form.billing_frequency} onChange={e=>update("billing_frequency",e.target.value)}><option value="">Not specified</option><option value="annual">Annual</option><option value="quarterly">Quarterly</option></select></label>}
       {field("invoice_reference","Invoice Reference")}{field("po_reference","PO Reference")}
       <label>Onboarding Method<input value="DMI Managed" readOnly/></label>
      </fieldset></section>
      <section><h3>Onboarding Status</h3><label>Status<select value={form.status} onChange={e=>update("status",e.target.value)}>{onboardingStatuses.map(v=><option key={v} value={v}>{statusLabels[v]}</option>)}</select></label><p className={styles.explainer}>Ready to Activate records commercial preparation only. Business Portal activation is a separate future phase.</p></section>
      <button type="submit" className={styles.primary}>{busy?"Saving…":"Save Onboarding"}</button>
     </fieldset>
    </form>
    {record&&<BusinessEntitlementPanel key={record.id} record={record} disabled={busy||dirty} onLocked={setCommercialLocked} onBusy={value=>{pending.current=value;setBusy(value);}} onCommitted={async()=>{
     const {record:saved}=await read<{record:OnboardingRecord}>(`/api/admin/business-onboardings/${record.id}`);const f=formFor(saved);setRecord(saved);setForm(f);setBaseline(JSON.stringify(f));setRefresh(n=>n+1);
    }}/>}
   </section>}
   <section className={styles.pipeline} aria-label="Saved Business Onboardings"><h2>Saved Business Onboardings</h2>
    <div className={styles.filters}>
     <label>Search<input maxLength={100} placeholder="Search" value={search} onChange={e=>{setPage(1);setSearch(e.target.value);}}/></label>
     <label>Status filter<select value={status} onChange={e=>{setPage(1);setStatus(e.target.value);}}><option value="">All statuses</option>{onboardingStatuses.map(v=><option key={v} value={v}>{statusLabels[v]}</option>)}</select></label>
     <label>Access Type filter<select value={access} onChange={e=>{setPage(1);setAccess(e.target.value);}}><option value="">All access types</option>{accessTypes.map(v=><option key={v} value={v}>{v}</option>)}</select></label>
    </div>
    {listError && <p role="alert" className={styles.error}>{listError} <button onClick={()=>setRefresh(n=>n+1)}>Retry loading</button></p>}
    <div className={styles.tableClip}><table><thead><tr>{["Company","Primary Contact","Requested Seats","Access Type","Status","Updated","Manage"].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>
     {loading?<tr><td colSpan={7}>Loading onboardings…</td></tr>:!items.length?<tr><td colSpan={7}>No saved onboardings match these filters.</td></tr>:items.map(row=><tr key={row.id}>
      <td data-label="Company"><strong>{row.company_name}</strong></td><td data-label="Primary Contact">{[row.contact_first_name,row.contact_last_name].filter(Boolean).join(" ")||"—"}<small>{row.contact_email}</small></td><td data-label="Requested Seats">{row.requested_seats??"—"}</td><td data-label="Access Type">{row.access_type||"—"}</td><td data-label="Status">{statusLabels[row.status]}</td><td data-label="Updated">{new Date(row.updated_at).toLocaleDateString("en-GB")}</td><td data-label="Manage"><button disabled={busy} onClick={()=>void manage(row.id)}>Manage</button></td>
     </tr>)}
    </tbody></table></div>
    <nav className={styles.pagination} aria-label="Onboarding pages"><button disabled={loading||page<=1} onClick={()=>setPage(p=>p-1)}>Previous</button><span>Page {page} of {Math.max(1,Math.ceil(total/25))}</span><button disabled={loading||page*25>=total} onClick={()=>setPage(p=>p+1)}>Next</button></nav>
   </section>
  </main>
 </div>;
}
