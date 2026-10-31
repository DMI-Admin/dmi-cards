'use client';
import {useEffect,useRef,useState} from 'react';
import {loadStripe} from '@stripe/stripe-js/pure';
import type {StripeEmbeddedCheckout} from '@stripe/stripe-js';
export default function EmbeddedPayment({sessionId,clientSecret,publishableKey}:{sessionId:string;clientSecret:string;publishableKey:string}){
 const container=useRef<HTMLDivElement>(null),[error,setError]=useState(false),[rendered,setRendered]=useState(false);
 useEffect(()=>{
  let disposed=false,checkout:StripeEmbeddedCheckout|undefined,revealTimer:ReturnType<typeof setTimeout>|undefined;
  const frames=new Set<HTMLIFrameElement>(),ready=()=>{if(!disposed)setRendered(true);},failed=()=>{if(!disposed)setError(true);};
  const watchFrames=()=>{for(const frame of container.current?.querySelectorAll('iframe')||[]){if(!frames.has(frame)){frames.add(frame);frame.addEventListener('load',ready);frame.addEventListener('error',failed);}}};
  const observer=new MutationObserver(watchFrames);
  void (async()=>{
   try{
    const stripe=await loadStripe(publishableKey);if(disposed)return;
    if(!stripe)throw Error('Payment unavailable');
    checkout=await stripe.createEmbeddedCheckoutPage({clientSecret,onComplete:()=>{if(!disposed)window.location.assign(`/client/billing/complete?session_id=${encodeURIComponent(sessionId)}`);}});
    if(disposed){checkout.destroy();return;}
    if(container.current){observer.observe(container.current,{childList:true,subtree:true});checkout.mount(container.current);revealTimer=setTimeout(ready,6000);watchFrames();}
   }catch{if(!disposed)setError(true);}
  })();
  return()=>{disposed=true;clearTimeout(revealTimer);observer.disconnect();for(const frame of frames){frame.removeEventListener('load',ready);frame.removeEventListener('error',failed);}checkout?.destroy();};
 },[sessionId,clientSecret,publishableKey]);
 return <div className="relative min-h-96" aria-busy={!rendered&&!error}>{!rendered&&!error&&<div role="status" className="absolute inset-0 flex items-center justify-center gap-3 rounded-2xl bg-[var(--dmi-surface-soft)] p-4 text-sm text-[var(--text-secondary)]"><span className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-[var(--dmi-border)] border-t-[#AC00FF] motion-reduce:animate-none"/>Loading your secure Stripe payment form…</div>}{error&&<p role="alert" className="mb-4 rounded-2xl border border-red-400/25 bg-red-400/10 p-4">Secure payment could not load. Return to Billing to continue.</p>}<div ref={container} aria-hidden={!rendered||error} inert={!rendered||error} className={`min-h-96 ${rendered&&!error?'':'opacity-0 pointer-events-none'}`}/></div>;
}
