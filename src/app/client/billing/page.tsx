'use client';
import Link from 'next/link';
import {CreditCard,ShieldCheck,Sparkles,ArrowUpRight} from 'lucide-react';
import UpgradeToProButton from '@/components/UpgradeToProButton';
import {ClientPortalPage,ClientPortalHeader,clientButtonClass} from '@/components/ClientPortalShell';

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
 const planName=state?.plan==='pro'?'Individual Pro':state?.plan==='enterprise'?'Enterprise':'Free';
 const periodEnd=state?.billing.currentPeriodEnd?new Date(state.billing.currentPeriodEnd).toLocaleDateString('en-GB'):null;
 const statusLabel=!state||state.plan==='free'?'Free':state.billing.cancelAtPeriodEnd&&periodEnd?`Ending on ${periodEnd}`:state.billing.status==='past_due'?'Past due':'Active';
 return <ClientPortalPage>
  <ClientPortalHeader title="Billing" description="Your plan, subscription and billing preferences — all in one place." />
  {error&&<p role="alert" className="mb-6 rounded-2xl border border-red-400/25 bg-red-400/10 p-4 text-sm text-red-500 dark:text-red-200">{error}</p>}
  {!state?<div role="status" className="client-portal-panel flex items-center gap-3 p-8 text-[var(--text-secondary)]"><span className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--dmi-border)] border-t-[#AC00FF] motion-reduce:animate-none"/>Loading your subscription…</div>:<div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
   <section className="client-portal-panel p-6 sm:p-8" aria-label="Current plan">
    <div className="flex flex-wrap items-start justify-between gap-5">
     <div><span className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--brand-gradient-subtle)] text-[#AC00FF]"><CreditCard className="h-6 w-6"/></span><p className="text-sm font-medium text-[var(--text-secondary)]">Current plan</p><h2 className="mt-2 text-3xl font-bold tracking-normal">{planName}</h2></div>
     <span className="inline-flex min-h-8 items-center gap-2 rounded-full border border-[#AC00FF]/30 bg-[var(--brand-gradient-subtle)] px-3 py-1 text-xs font-semibold"><Sparkles className="h-3.5 w-3.5 text-[#AC00FF]"/>{statusLabel}</span>
    </div>
    <p className="mt-4 text-sm leading-6 text-[var(--text-secondary)]">{state.plan==='free'?'Your digital card essentials, ready to share.':state.plan==='enterprise'?'Your sales-managed subscription and agreed team seats.':'Your Pro tools are unlocked. Make every connection count.'}</p>
    <dl className="client-portal-panel-muted mt-6 grid gap-5 p-5 sm:grid-cols-2">
     <div><dt className="text-xs font-semibold uppercase tracking-wider text-[var(--dmi-muted)]">Feature access</dt><dd className="mt-2 font-semibold">{state.plan==='free'?'Free':'Pro'}</dd></div>
     <div><dt className="text-xs font-semibold uppercase tracking-wider text-[var(--dmi-muted)]">{state.billing.cancelAtPeriodEnd?'Subscription ends':'Current period end'}</dt><dd className="mt-2 font-semibold">{periodEnd||'No active billing period'}</dd></div>
     {state.plan==='enterprise'&&<div><dt className="text-xs font-semibold uppercase tracking-wider text-[var(--dmi-muted)]">Agreed seats</dt><dd className="mt-2 font-semibold">{state.billing.seatQuantity}</dd></div>}
    </dl>
    <div className="mt-6 flex flex-wrap gap-3">
     {state.plan==='enterprise'?<Link href="mailto:sales@dmicards.com" className={clientButtonClass.primary}>Contact Sales<ArrowUpRight className="h-4 w-4"/></Link>:state.billing.hasCustomer&&<button onClick={portal} disabled={opening} className={clientButtonClass.primary}>{opening?'Opening Stripe…':'Manage subscription, payment method and invoices'}<ArrowUpRight className="h-4 w-4"/></button>}
     {state.plan==='free'&&<UpgradeToProButton className={clientButtonClass.primary}><Sparkles className="h-4 w-4"/>Upgrade to Pro</UpgradeToProButton>}
    </div>
   </section>
   <aside className="space-y-6">
    {state.plan==='free'&&<section className="client-portal-panel border-[#AC00FF]/25 p-6"><Sparkles className="mb-4 h-6 w-6 text-[#AC00FF]"/><h2 className="text-xl font-semibold">More possibilities with Pro</h2><p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">Unlock Contacts, Tap to Share, Analytics and Integrations with monthly or annual billing.</p><UpgradeToProButton className={`mt-5 w-full ${clientButtonClass.secondary}`}>Explore Individual Pro</UpgradeToProButton></section>}
    <section className="client-portal-panel p-6"><ShieldCheck className="mb-4 h-6 w-6 text-[#AC00FF]"/><h2 className="text-lg font-semibold">Secure billing with Stripe</h2><p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">Manage your invoices and card details securely in Stripe’s Customer Portal.</p>{state.plan==='enterprise'&&<p className="mt-3 text-sm text-[var(--text-secondary)]">Contact Sales for changes to your Enterprise plan.</p>}</section>
   </aside>
  </div>}
 </ClientPortalPage>;
}
