'use client';
import {useEffect,useRef,useState} from 'react';
import {loadStripe} from '@stripe/stripe-js/pure';
import type {StripeEmbeddedCheckout} from '@stripe/stripe-js';
export default function EmbeddedPayment({sessionId,clientSecret,publishableKey}:{sessionId:string;clientSecret:string;publishableKey:string}){
 const container=useRef<HTMLDivElement>(null),[error,setError]=useState(false);
 useEffect(()=>{
  let disposed=false,checkout:StripeEmbeddedCheckout|undefined;
  void (async()=>{
   try{
    const stripe=await loadStripe(publishableKey);if(disposed)return;
    if(!stripe)throw Error('Payment unavailable');
    checkout=await stripe.createEmbeddedCheckoutPage({clientSecret,onComplete:()=>{if(!disposed)window.location.assign(`/client/billing/complete?session_id=${encodeURIComponent(sessionId)}`);}});
    if(disposed){checkout.destroy();return;}
    if(container.current)checkout.mount(container.current);
   }catch{if(!disposed)setError(true);}
  })();
  return()=>{disposed=true;checkout?.destroy();};
 },[sessionId,clientSecret,publishableKey]);
 return <>{error&&<p role="alert">Secure payment could not load. Return to Billing to continue.</p>}<div ref={container} className="min-h-96"/></>;
}
