'use client';
import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase';
import EmbeddedPayment from '@/components/EmbeddedPayment';
import {ShieldCheck,ArrowLeft} from 'lucide-react';
import {ClientPortalPage,ClientPortalHeader,clientButtonClass} from '@/components/ClientPortalShell';

import {proPricing,type BillingInterval} from '@/lib/pro-pricing';
type Checkout={sessionId:string;clientSecret:string;publishableKey:string};
export default function PaymentClient(){
 const [checkout,setCheckout]=useState<Checkout|null>(null),[error,setError]=useState(false);
 const [selectedInterval,setSelectedInterval]=useState<BillingInterval|null>(null);
 const operation=useRef<Promise<Checkout>|null>(null),owner=useRef<string|null>(null);
 useEffect(()=>{
  let disposed=false;
  const {data:{subscription}}=supabase.auth.onAuthStateChange((_e,s)=>{if(owner.current && s?.user.id!==owner.current){setCheckout(null);setError(true);disposed=true;}});
  operation.current ||= (async()=>{
   const interval=new URLSearchParams(window.location.search).get('interval');
   if(!['monthly','annual'].includes(interval || ''))throw Error('Choose an interval');
   setSelectedInterval(interval as BillingInterval);
   const {data:{session}}=await supabase.auth.getSession();
   if(!session)throw Error('Sign in required');owner.current=session.user.id;
   const response=await fetch('/api/v1/billing/checkout/embedded',{method:'POST',cache:'no-store',headers:{Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({interval,requestId:crypto.randomUUID()})});
   const result=await response.json();
   const {data:{session:after}}=await supabase.auth.getSession();
   if(!response.ok || after?.user.id!==owner.current)throw Error('Checkout unavailable');
   return result.data;
  })();
  void operation.current.then(result=>{if(!disposed)setCheckout(result);}).catch(()=>{if(!disposed)setError(true);});
  return()=>{disposed=true;subscription.unsubscribe();};
 },[]);
 const otherInterval=selectedInterval==='annual'?'monthly':'annual';
 return <ClientPortalPage>
  <ClientPortalHeader title="Checkout" description="Complete your Individual Pro subscription securely." action={<button type="button" onClick={()=>window.history.length>1?window.history.back():window.location.assign('/client/billing')} className={clientButtonClass.secondary}><ArrowLeft className="h-4 w-4"/>Back</button>}/>
  <div className="grid items-start gap-6 lg:grid-cols-[minmax(240px,0.65fr)_minmax(0,1.35fr)]">
   <section className="client-portal-panel p-6" aria-label="Order summary">
    <p className="text-xs font-semibold uppercase tracking-wider text-[var(--dmi-muted)]">Order summary</p><h2 className="mt-3 text-2xl font-bold">Individual Pro</h2>
    {selectedInterval?<><p className="mt-5 text-sm capitalize text-[var(--text-secondary)]">{selectedInterval}</p><p className="mt-2 text-3xl font-bold">{proPricing[selectedInterval].price}<span className="ml-2 text-sm font-normal text-[var(--text-secondary)]">{proPricing[selectedInterval].period}</span></p><a href={`/client/billing/pay?interval=${otherInterval}`} aria-disabled={!checkout&&!error} onClick={event=>{event.preventDefault();if(!checkout&&!error)return;window.location.replace(`/client/billing/pay?interval=${otherInterval}`);}} className={`mt-5 inline-block text-sm font-semibold text-[var(--text-accent)] underline underline-offset-4 ${!checkout&&!error?'pointer-events-none opacity-50':''}`}>Switch to {otherInterval==='annual'?'Annual':'Monthly'}</a></>:<p className="mt-5 text-sm text-[var(--text-secondary)]">Confirming your selected interval…</p>}
    <p className="mt-6 flex items-center gap-2 border-t border-[var(--dmi-border)] pt-5 text-xs text-[var(--dmi-muted)]"><ShieldCheck className="h-4 w-4"/>Secure payment powered by Stripe</p>
   </section>
   <section className="client-portal-panel min-w-0 p-5 sm:p-7" aria-label="Secure payment">
    {error?<div role="alert" className="rounded-2xl border border-red-400/25 bg-red-400/10 p-5"><p>Checkout could not open. Return to Billing to continue. You have not been asked to pay again.</p><Link href="/client/billing" className={`mt-4 ${clientButtonClass.secondary}`}>Return to Billing</Link></div>:checkout?<EmbeddedPayment {...checkout}/>:<div role="status" className="client-portal-panel-muted flex min-h-80 flex-col items-center justify-center gap-4 p-8 text-center"><span className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--dmi-border)] border-t-[#AC00FF] motion-reduce:animate-none"/><p className="font-semibold">Preparing your secure checkout…</p></div>}
   </section>
  </div>
 </ClientPortalPage>;
}
