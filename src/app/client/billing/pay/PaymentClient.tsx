'use client';
import Image from 'next/image';
import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase';
import EmbeddedPayment from '@/components/EmbeddedPayment';
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
 return <main className="mx-auto grid max-w-5xl gap-8 px-6 py-12 lg:grid-cols-2">
  <section className="rounded-3xl border border-[var(--dmi-border)] bg-[var(--dmi-surface)] p-8">
   <Image src="/dmi-cards-logo.svg" width={48} height={48} alt="DMI Cards" />
   <h1 className="mt-6 text-3xl font-bold">Individual Pro</h1>
   <p className="my-6">Contacts, analytics, premium templates and advanced sharing. Confirm your price in secure checkout.</p>
   <Link href="/client/billing" className="underline">Return to Billing</Link>
  </section>
  <section className="rounded-3xl border border-[var(--dmi-border)] bg-[var(--dmi-surface)] p-6" aria-label="Secure payment">
   {error?<p role="alert">Checkout could not open. Return to Billing to continue. You have not been asked to pay again.</p>:checkout?<EmbeddedPayment {...checkout}/>:<p role="status">Preparing your secure checkout…</p>}
  </section>
 </main>;
}
