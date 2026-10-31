'use client';
import Link from 'next/link';
import {CreditCard,Sparkles,ArrowUpRight} from 'lucide-react';
import UpgradeToProButton from '@/components/UpgradeToProButton';
import {ClientPortalPage,ClientPortalHeader,clientButtonClass} from '@/components/ClientPortalShell';

import {useEffect,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {resolveEffectiveClientPlan,type EffectiveClientPlanResult} from '@/lib/entitlements/plan-resolver';
import {proPricing} from '@/lib/pro-pricing';
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
 const periodEnd=state?.billing.currentPeriodEnd?new Date(state.billing.currentPeriodEnd).toLocaleDateString('en-GB'):'the end of your current period';
 const view=state?.plan==='enterprise'?'enterprise':state?.plan!=='pro'?'free':state.billing.status==='past_due'?'past_due':state.billing.cancelAtPeriodEnd?'ending':'active';
 const planName=view==='enterprise'?'Enterprise':view==='free'?'Free':'Individual Pro';
 const hasSubscription=state?.source==='stripe_billing';
 return <ClientPortalPage>
  <ClientPortalHeader title="Billing" description="Your plan, subscription and billing preferences — all in one place."/>
  {error&&<p role="alert" className="mb-6 rounded-2xl border border-red-400/25 bg-red-400/10 p-4 text-sm text-red-500 dark:text-red-200">{error}</p>}
  {!state?<div role="status" className="client-portal-panel flex items-center gap-3 p-8 text-[var(--text-secondary)]"><span className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--dmi-border)] border-t-[#AC00FF] motion-reduce:animate-none"/>Loading your subscription…</div>:<section className={`client-portal-panel max-w-3xl p-6 sm:p-8 ${view==='past_due'?'border-amber-500/40 bg-amber-500/5':''}`} aria-label="Current plan">
   <CreditCard className={`mb-5 h-8 w-8 ${view==='past_due'?'text-amber-500':'text-[#AC00FF]'}`}/>
   <h2 className="text-3xl font-bold tracking-normal">{planName}{view==='active'?' · Active':view==='ending'?` · Ends on ${periodEnd}`:view==='past_due'?' · Past due':''}</h2>
   {view==='active'&&<p className="mt-4 text-[var(--text-secondary)]">Renews on {periodEnd}.</p>}
   {view==='ending'&&<p className="mt-4 text-[var(--text-secondary)]">You keep Pro until then.</p>}
   {view==='past_due'&&<p role="status" className="mt-4 font-medium text-amber-600 dark:text-amber-200">Payment failed — update your card to keep Pro</p>}
   {view==='enterprise'?<><p className="mt-4 text-[var(--text-secondary)]">Seats: {state.billing.seatQuantity}</p><Link href="mailto:sales@dmicards.com" className={`mt-6 ${clientButtonClass.primary}`}>Contact Sales<ArrowUpRight className="h-4 w-4"/></Link></>:view==='free'?<div className="client-portal-panel-muted mt-6 p-5"><h3 className="flex items-center gap-2 text-xl font-semibold"><Sparkles className="h-5 w-5 text-[#AC00FF]"/>Individual Pro</h3><div className="my-5 grid gap-3 sm:grid-cols-2"><p>Monthly <strong>{proPricing.monthly.price}</strong></p><p>Annual <strong>{proPricing.annual.price}</strong></p></div><UpgradeToProButton className={clientButtonClass.primary}>Upgrade to Pro</UpgradeToProButton></div>:hasSubscription&&<button onClick={portal} disabled={opening} className={`mt-6 ${clientButtonClass.primary}`}>{opening?'Opening Stripe…':view==='ending'?'Manage or resume subscription':'Manage subscription, payment method and invoices'}<ArrowUpRight className="h-4 w-4"/></button>}
  </section>}
 </ClientPortalPage>;
}
