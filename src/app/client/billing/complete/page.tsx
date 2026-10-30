'use client';
import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {ShieldCheck,ArrowLeft} from 'lucide-react';
import {ClientPortalPage,ClientPortalHeader,clientButtonClass} from '@/components/ClientPortalShell';

export default function CheckoutComplete(){
 const [error,setError]=useState(false),operation=useRef<Promise<void>|null>(null);
 useEffect(()=>{
  let disposed=false;
  operation.current ||= (async()=>{
   const {data:{session}}=await supabase.auth.getSession();
   const sessionId=new URLSearchParams(window.location.search).get('session_id');
   if(!session || !sessionId)throw Error('Checkout reference missing');
   const response=await fetch('/api/v1/billing/complete',{method:'POST',cache:'no-store',headers:{Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({sessionId})});
   const result=await response.json();
   const {data:{session:after}}=await supabase.auth.getSession();
   if(!response.ok || result.data?.plan!=='pro' || after?.user.id!==session.user.id)throw Error('Upgrade could not be confirmed');
  })();
  void operation.current.then(()=>{if(!disposed)window.location.replace('/client/dashboard?upgraded=pro');}).catch(()=>{if(!disposed)setError(true);});
  return()=>{disposed=true;};
 },[]);
 return <ClientPortalPage>
  <ClientPortalHeader title="Your Pro upgrade" description="A little more possibility. A lot more connection."/>
  <section className="client-portal-panel mx-auto max-w-2xl p-8 text-center sm:p-12" aria-live="polite">
   {error?<ShieldCheck className="mx-auto h-12 w-12 text-[#AC00FF]"/>:<span className="mx-auto block h-12 w-12 animate-spin rounded-full border-[3px] border-[var(--dmi-border)] border-t-[#AC00FF] motion-reduce:animate-none"/>}
   <h2 className="mt-6 text-2xl font-bold tracking-normal sm:text-3xl">{error?'We could not confirm your upgrade':'Finishing your upgrade'}</h2>
   <p className="mx-auto mt-4 max-w-md text-sm leading-7 text-[var(--text-secondary)]" role={error?'alert':'status'}>{error?'Please view Billing or contact support. Do not submit another payment.':'Confirming your Stripe subscription. We’ll take you to your Pro dashboard as soon as it’s confirmed.'}</p>
   {error&&<Link href="/client/billing" className={`mt-7 ${clientButtonClass.secondary}`}><ArrowLeft className="h-4 w-4"/>View Billing</Link>}
  </section>
 </ClientPortalPage>;
}
