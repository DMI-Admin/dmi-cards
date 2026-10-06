"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import AdminShell from "@/components/admin/AdminShell";
import { AdminPageHeader, AdminKpiCard, AdminStatusBadge } from "@/components/admin/AdminUI";
import { subscriptionDate, subscriptionEndLabel, type SubscriptionInventory } from "@/lib/admin-subscriptions";
import styles from "./subscriptions.module.css";

export default function SubscriptionsPage() {
  const [data,setData]=useState<SubscriptionInventory|null>(null);
  const [filters,setFilters]=useState({search:"",plan:"",status:"",interval:"",page:1});
  const [draft,setDraft]=useState("");
  const [loading,setLoading]=useState(true), [error,setError]=useState(""), [retry,setRetry]=useState(0);
  function changeFilters(update: (current: typeof filters) => typeof filters) { setLoading(true); setError(""); setFilters(update); }
  useEffect(()=>{
    const controller=new AbortController(); let active=true;
    void (async()=>{try {
      const response=await fetch(`/api/admin/subscriptions?${new URLSearchParams({...filters,page:String(filters.page)})}`,{cache:"no-store",credentials:"same-origin",signal:controller.signal});
      if(!response.ok) throw Error("Subscriptions could not be loaded.");
      const result=await response.json(); if(active)setData(result);
    }catch{if(active){setError("Subscriptions could not be loaded. Please retry.");setData(null);}}finally{if(active)setLoading(false);}})();
    return()=>{active=false;controller.abort();};
  },[filters,retry]);
  return <AdminShell>
    <section className={styles.page}>
      <AdminPageHeader title="Subscriptions" subtitle="Monitor customer subscriptions, plans and renewals." />
      <div className={styles.kpis}>{([['Total Paying','paying'],['Active','active'],['Cancelling','cancelling'],['Past Due','pastDue'],['Monthly','monthly'],['Annual','annual']] as const).map(([label,key])=><AdminKpiCard key={key} label={label} value={loading?'…':data?.summary[key]??'—'} />)}</div>
      <form className={styles.filters} onSubmit={e=>{e.preventDefault();changeFilters(x=>({...x,search:draft.trim(),page:1}));}}>
        <label className={styles.search}>Client or email<input className={styles.control} value={draft} maxLength={100} onChange={e=>setDraft(e.target.value)}/></label>
        {(['plan','status','interval'] as const).map(key=><label key={key}>{key==='interval'?'Billing':key==='plan'?'Plan':'Status'}<select className={styles.control} value={filters[key]} onChange={e=>changeFilters(x=>({...x,[key]:e.target.value,page:1}))}><option value="">All</option>{(data?.[key==='plan'?'plans':key==='status'?'statuses':'intervals']||[]).map(v=><option key={v}>{v}</option>)}</select></label>)}
        <button className={styles.button} type="submit">Search</button>
      </form>
      {error&&<div role="alert" className={styles.error}>{error} <button onClick={()=>{setLoading(true);setError("");setRetry(x=>x+1);}} className={styles.action}>Retry</button></div>}
      {loading?<p role="status" className={styles.state}>Loading subscriptions…</p>:data&&<div className={styles.surface}><div className={styles.tableViewport}><table className={styles.inventory}><caption className="sr-only">Subscriptions, newest mirrors first</caption><thead><tr>{['Client','Email','Plan','Status','Billing','Configured recurring unit price','Current period started','Next renewal / Current period end','Cards','Actions'].map(x=><th scope="col" key={x}>{x}</th>)}</tr></thead><tbody>{data.items.map(r=><tr key={r.id}><td data-label="Client" className={styles.client}>{r.name}</td><td data-label="Email" className={styles.email}>{r.email||'Not recorded'}</td><td data-label="Plan">{r.plan}</td><td data-label="Status" className={styles.status}><AdminStatusBadge label={r.status} /></td><td data-label="Billing">{r.interval}</td><td data-label="Configured recurring unit price">{r.price}{r.price!=="Unavailable"&&<small className={styles.priceContext}>{r.quantity ? `Per unit · Qty ${r.quantity}` : "Per unit"}</small>}</td><td data-label="Current period started">{subscriptionDate(r.periodStart)}</td><td data-label="Next renewal / Current period end">{subscriptionEndLabel(r)}<small className={styles.priceContext}>{r.renewal==='renewal'?'Next renewal':r.renewal==='ending'?'Scheduled end':'Current period end'}</small></td><td data-label="Cards">{r.cards}</td><td data-label="Actions">{r.clientLinked?<Link className={styles.action} href="/clients/individual">View client</Link>:<span className="text-xs text-[var(--dmi-muted)]">Client linkage unavailable</span>}</td></tr>)}</tbody></table>{!data.items.length&&<p className={styles.state}>No subscriptions found{filters.search||filters.plan||filters.status||filters.interval?' for these filters':''}.</p>}</div>
      <nav aria-label="Subscriptions pagination" className={styles.pagination}><button disabled={data.page<=1} className={styles.button} onClick={()=>changeFilters(x=>({...x,page:data.page-1}))}>Previous</button><span>{data.total} subscriptions · Page {data.page} of {Math.max(1,Math.ceil(data.total/data.pageSize))}</span><button disabled={data.page*data.pageSize>=data.total} className={styles.button} onClick={()=>changeFilters(x=>({...x,page:data.page+1}))}>Next</button></nav></div>}
    </section>
  </AdminShell>;
}
