'use client';
import {useEffect,useRef,useState} from 'react';
import {loadStripe} from '@stripe/stripe-js/pure';
import type {StripeEmbeddedCheckout} from '@stripe/stripe-js';
export default function EmbeddedPayment({sessionId,clientSecret,publishableKey}:{sessionId:string;clientSecret:string;publishableKey:string}){
 const container=useRef<HTMLDivElement>(null),[error,setError]=useState(false),[rendered,setRendered]=useState(false);
 useEffect(()=>{
  let disposed=false,checkout:StripeEmbeddedCheckout|undefined;
  void (async()=>{
   try{
    const stripe=await loadStripe(publishableKey);if(disposed)return;
    if(!stripe)throw Error('Payment unavailable');
    checkout=await stripe.createEmbeddedCheckoutPage({clientSecret,onAnalyticsEvent:event=>{if(!disposed&&event.eventType==='checkoutRendered')setRendered(true);},onComplete:()=>{if(!disposed)window.location.assign(`/client/billing/complete?session_id=${encodeURIComponent(sessionId)}`);}});
    if(disposed){checkout.destroy();return;}
    if(container.current)checkout.mount(container.current);
   }catch{if(!disposed)setError(true);}
  })();
  return()=>{disposed=true;checkout?.destroy();};
 },[sessionId,clientSecret,publishableKey]);
 return <div aria-busy={!rendered&&!error}>{!rendered&&!error&&<div role="status" className="mb-5 flex items-center gap-3 rounded-2xl bg-[var(--dmi-surface-soft)] p-4 text-sm text-[var(--text-secondary)]"><span className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-[var(--dmi-border)] border-t-[#AC00FF] motion-reduce:animate-none"/>Loading your secure Stripe payment form…</div>}{error&&<p role="alert" className="mb-4 rounded-2xl border border-red-400/25 bg-red-400/10 p-4">Secure payment could not load. Return to Billing to continue.</p>}<div ref={container} className="min-h-96"/></div>;
}
