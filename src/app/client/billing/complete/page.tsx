'use client';
import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase';
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
  void operation.current.then(()=>{if(!disposed)window.location.replace('/client/billing');}).catch(()=>{if(!disposed)setError(true);});
  return()=>{disposed=true;};
 },[]);
 return <main className="mx-auto max-w-xl px-6 py-16"><h1 className="text-2xl font-bold">{error?'We could not confirm your upgrade':'Finishing your upgrade'}</h1><p className="my-6">{error?'Please view Billing or contact support. Do not submit another payment.':'Confirming your Stripe subscription…'}</p>{error&&<Link href="/client/billing" className="underline">View Billing</Link>}</main>;
}
