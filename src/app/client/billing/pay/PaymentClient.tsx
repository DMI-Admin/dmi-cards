'use client';
import Image from 'next/image';
import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase';
import EmbeddedPayment from '@/components/EmbeddedPayment';
import {Check,ShieldCheck,ArrowLeft} from 'lucide-react';
import {ClientPortalPage,ClientPortalHeader,clientButtonClass} from '@/components/ClientPortalShell';

type Checkout={sessionId:string;clientSecret:string;publishableKey:string};
export default function PaymentClient(){
 const [checkout,setCheckout]=useState<Checkout|null>(null),[error,setError]=useState(false);
 const operation=useRef<Promise<Checkout>|null>(null),owner=useRef<string|null>(null);
 useEffect(()=>{
  let disposed=false;
  const {data:{subscription}}=supabase.auth.onAuthStateChange((_e,s)=>{if(owner.current && s?.user.id!==owner.current){setCheckout(null);setError(true);disposed=true;}});
  operation.current ||= (async()=>{
   const interval=new URLSearchParams(window.location.search).get('interval');
   if(!['monthly','annual'].includes(interval || ''))throw Error('Choose an interval');
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
 return <ClientPortalPage>
  <ClientPortalHeader title="Upgrade to Individual Pro" description="More ways to connect. One secure checkout, right here in DMI Cards." action={<Link href="/client/billing" className={clientButtonClass.secondary}><ArrowLeft className="h-4 w-4"/>Back to Billing</Link>}/>
  <div className="grid items-start gap-6 lg:grid-cols-[minmax(260px,0.8fr)_minmax(0,1.2fr)]">
   <section className="client-portal-panel p-6 sm:p-8">
    <Image src="/dmi-cards-logo.svg" width={48} height={48} alt="DMI Cards" className="rounded-xl bg-white p-1.5"/>
    <span className="mt-6 inline-flex rounded-full border border-[#AC00FF]/30 bg-[var(--brand-gradient-subtle)] px-3 py-1 text-xs font-semibold">Individual Pro</span>
    <h2 className="mt-4 text-3xl font-bold tracking-normal">Make every connection count.</h2>
    <p className="mt-4 text-sm leading-6 text-[var(--text-secondary)]">Your next chapter starts with Pro. Confirm your selected price and billing interval in secure checkout.</p>
    <ul className="my-6 space-y-4">{['Contacts and lead capture','Tap to Share','Advanced analytics','CRM integrations','Premium templates and custom branding'].map(benefit=><li key={benefit} className="flex items-center gap-3 text-sm"><Check className="h-4 w-4 shrink-0 text-[#AC00FF]"/>{benefit}</li>)}</ul>
    <p className="flex items-center gap-2 border-t border-[var(--dmi-border)] pt-5 text-xs text-[var(--dmi-muted)]"><ShieldCheck className="h-4 w-4"/>Secure payment powered by Stripe</p>
   </section>
   <section className="client-portal-panel min-w-0 p-5 sm:p-7" aria-label="Secure payment">
    <h2 className="mb-5 text-xl font-semibold">Your secure checkout</h2>
    {error?<div role="alert" className="rounded-2xl border border-red-400/25 bg-red-400/10 p-5"><p>Checkout could not open. Return to Billing to continue. You have not been asked to pay again.</p><Link href="/client/billing" className={`mt-4 ${clientButtonClass.secondary}`}>Return to Billing</Link></div>:checkout?<EmbeddedPayment {...checkout}/>:<div role="status" className="client-portal-panel-muted flex min-h-80 flex-col items-center justify-center gap-4 p-8 text-center"><span className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--dmi-border)] border-t-[#AC00FF] motion-reduce:animate-none"/><p className="font-semibold">Preparing your secure checkout…</p><p className="text-sm text-[var(--text-secondary)]">Your Stripe payment form will appear here.</p></div>}
   </section>
  </div>
 </ClientPortalPage>;
}
