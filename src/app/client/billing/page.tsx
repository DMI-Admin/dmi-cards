'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {resolveEffectiveClientPlan,type EffectiveClientPlanResult} from '@/lib/entitlements/plan-resolver';
type State=EffectiveClientPlanResult&{billing:EffectiveClientPlanResult['billing']&{seatQuantity:number;hasCustomer:boolean}};
export default function BillingPage(){
 const [state,setState]=useState<State|null>(null),[error,setError]=useState(''),[opening,setOpening]=useState(false);
 useEffect(()=>{let disposed=false;void resolveEffectiveClientPlan().then(s=>{if(!disposed)setState(s as State);}).catch(()=>{if(!disposed)setError('Could not load Billing. Please reload or contact support.');});return()=>{disposed=true;};},[]);
 async function portal(){
  setOpening(true);setError('');
  try{
   const {data:{session}}=await supabase.auth.getSession();if(!session)throw Error('Sign in required');
   const response=await fetch('/api/stripe/portal',{method:'POST',headers:{Authorization:`Bearer ${session.access_token}`}});
   const result=await response.json();const {data:{session:after}}=await supabase.auth.getSession();if(!response.ok || !result.data?.url || after?.user.id!==session.user.id)throw Error('Portal unavailable');
   window.location.assign(result.data.url);
  }catch{setError('Stripe billing management is unavailable. Please contact support.');setOpening(false);}
 }
 return <main className="mx-auto max-w-4xl px-6 py-10"><h1 className="text-3xl font-bold">Billing</h1>
  {error&&<p role="alert" className="my-6">{error}</p>}
  {!state?<p role="status" className="my-6">Loading your subscription…</p>:<>
   <section className="my-8 rounded-3xl border border-[var(--dmi-border)] bg-[var(--dmi-surface)] p-8">
    <h2 className="text-2xl font-bold">{state.plan==='pro'?'Individual Pro':state.plan==='enterprise'?'Enterprise':'Free'}</h2>
    <p className="my-4">{state.billing.status==='free'||!state.billing.status?'No subscription':state.billing.status.replaceAll('_',' ')}</p>
    <p>Effective feature access: {state.plan==='free'?'Free':'Pro'}</p>
    {state.billing.currentPeriodEnd&&<p className="mt-4">{state.billing.cancelAtPeriodEnd?'Ends':'Current period ends'} {new Date(state.billing.currentPeriodEnd).toLocaleDateString('en-GB')}</p>}
    {state.plan==='enterprise'&&<p className="mt-4">Seats: {state.billing.seatQuantity}</p>}
    {state.plan==='enterprise'?<Link href="mailto:sales@dmicards.com" className="mt-6 block underline">Contact Sales</Link>:state.billing.hasCustomer&&<button onClick={portal} disabled={opening} className="mt-6 rounded-xl bg-[#8C16EB] px-5 py-3 text-white">{opening?'Opening Stripe…':'Manage subscription and payment method'}</button>}
   </section>
   {state.plan==='free'&&<section className="flex flex-wrap gap-4" aria-label="Upgrade to Pro"><Link className="rounded-xl bg-[#8C16EB] px-5 py-3 text-white" href="/client/billing/pay?interval=monthly">Pro monthly</Link><Link className="rounded-xl border border-[var(--dmi-border)] px-5 py-3" href="/client/billing/pay?interval=annual">Pro annual</Link><Link className="px-5 py-3 underline" href="mailto:sales@dmicards.com">Enterprise — Contact Sales</Link></section>}
  </>}
 </main>;
}
