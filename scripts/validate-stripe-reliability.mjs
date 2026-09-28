// Executes the real server modules with an atomic in-memory store and fake Stripe.
// This suite never contacts a network or reads secrets. PostgreSQL coverage is separate.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { randomUUID } from 'node:crypto';
const user='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222';
const scope='acct_fixture:test';
const clone=x=>x===undefined?undefined:JSON.parse(JSON.stringify(x));
class ApiRouteError extends Error { constructor(status,code,message){super(message);this.status=status;this.code=code;} }
let now=Date.now();
class Clock extends Date { static now(){return now;} }
function load(file,deps){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Date:Clock,URL,Buffer,console,require(name){assert.ok(name in deps,`unexpected dependency: ${name}`);return deps[name];}});return exports;}
const namespace={hasDmiStripeAppNamespace:m=>m?.dmi_app==='dmi_cards_v2',DMI_STRIPE_APP_NAMESPACE:'dmi_cards_v2'};
const rel=load('src/lib/stripe/reliability.ts',{'server-only':{},'@/lib/supabase-admin':{},'@/lib/stripe/config':{},'@/lib/api/responses':{ApiRouteError},'@/lib/stripe/app-namespace':namespace});
const webhook=load('src/lib/stripe/webhook.ts',{'server-only':{},'@/lib/stripe/app-namespace':namespace,'@/lib/stripe/reliability':rel});
const checkout=load('src/lib/stripe/checkout.ts',{'server-only':{},'@/lib/stripe/app-namespace':namespace,'@/lib/stripe/config':{},'@/lib/stripe/reliability':rel});
const reconcile=load('src/lib/stripe/reconciliation.ts',{'server-only':{},'@/lib/stripe/reliability':rel});
function fixture(){
 const events=new Map(),accounts=new Map(),mirrors=[],audits=[],prices=[{stripe_scope:scope,stripe_price_id:'price_current',entitlement_enabled:true,checkout_enabled:true},{stripe_scope:scope,stripe_price_id:'price_historical',entitlement_enabled:true,checkout_enabled:false}];
 let failCommit=false, failStripe=false, retrieveGate=null, createGate=null, loseCheckout=false, loseCustomer=false, createdSessions=0,createdCustomers=0,retrieves=0;
 const customers=new Map([['cus_owned',{id:'cus_owned',livemode:false,metadata:{dmi_app:'dmi_cards_v2',dmi_user_id:user}}]]),sessions=new Map(),keys=new Map();
 const sub={id:'sub_owned',customer:'cus_owned',livemode:false,status:'active',metadata:{dmi_app:'dmi_cards_v2',dmi_user_id:user},items:{has_more:false,data:[{price:{id:'price_current'},current_period_start:100,current_period_end:9999999999}]},cancel_at_period_end:false,latest_invoice:'in_fixture',trial_end:null,ended_at:null};
 const subscriptions=new Map([[sub.id,sub]]);
 function table(name){return name==='billing_subscriptions'?mirrors:name==='billing_approved_prices'?prices:name==='billing_sync_runs'?audits:name==='billing_accounts'?[...accounts.values()]:[];}
 function query(name){let rows=table(name),filters=[],offset=0,max=Infinity,one=false;
  const q={select(){return q;},eq(k,v){filters.push(row=>row[k]===v);return q;},gt(k,v){filters.push(row=>row[k]>v);return q;},or(){return q;},order(){return q;},limit(n){max=n;return q;},range(a,b){offset=a;max=b-a+1;return q;},maybeSingle(){one=true;return q;},insert(value){rows.push(clone(value));return Promise.resolve({error:null});},then(resolve){const result=rows.filter(row=>filters.every(f=>f(row))).slice(offset,offset+max);return Promise.resolve({data:clone(one?result[0]||null:result),error:null}).then(resolve);}};return q;
 }
 const db={from:query,async rpc(_,{p_action:action,p_scope:sc,p_user:u,p_token:token,p_input:i}){
  assert.equal(sc,scope);try{
   if(action==='event_claim'){
    let e=events.get(i.id);if(!e){e={id:i.id,state:'received',attempts:0};events.set(i.id,e);}
    if(e.state==='processed')return {data:{duplicate:true}};
    if(e.state==='processing'&&e.until>now)throw Error('BILLING_BUSY');
    Object.assign(e,{state:'processing',attempts:e.attempts+1,token:randomUUID(),until:now+90000});return {data:{token:e.token}};
   }
   if(action==='event_finish'||action==='event_fail'){
    const e=events.get(i.id);if(!e||e.token!==token||e.state!=='processing'||e.until<=now)throw Error('BILLING_FENCE');
    Object.assign(e,{state:action==='event_finish'?'processed':'failed',outcome:i.outcome});return {data:{}};
   }
   let a=accounts.get(u);
   if(action==='claim'){
    if(!a){a={user_id:u,stripe_customer_id:null};accounts.set(u,a);}if(a.until>now)throw Error('BILLING_BUSY');
    Object.assign(a,{lease_token:randomUUID(),until:now+90000});return {data:clone(a)};
   }
   if(action==='release'){if(a?.lease_token===token)a.until=0;return {data:{}};}
   if(!a||a.lease_token!==token||a.until<=now)throw Error('BILLING_FENCE');
   if(action==='touch')a.until=now+90000;
   else if(action==='bind'){
    if((a.stripe_customer_id&&a.stripe_customer_id!==i.customer)||[...accounts.values()].some(x=>x.user_id!==u&&x.stripe_customer_id===i.customer))throw Error('BILLING_IDENTITY');a.stripe_customer_id=i.customer;
   }else if(action==='customer_prepare'){if(!a.customer_attempt)Object.assign(a,{customer_attempt:randomUUID(),customer_attempt_at:new Date(now).toISOString(),customer_parameters:clone(i)});}
   else if(action==='checkout_prepare'){if(!a.checkout_attempt)Object.assign(a,{checkout_attempt:randomUUID(),checkout_attempt_at:new Date(now).toISOString(),checkout_parameters:clone(i)});}
   else if(action==='checkout_record')a.checkout_session_id=i.session;
   else if(action==='checkout_clear')Object.assign(a,{checkout_attempt:null,checkout_attempt_at:null,checkout_parameters:null,checkout_session_id:null});
   else if(action==='commit'){
    if(failCommit){failCommit=false;throw Error('commit unavailable');}
    const e=i.event_id?events.get(i.event_id):null;if(i.event_id&&(!e||e.token!==i.event_token||e.until<=now||e.state!=='processing'))throw Error('BILLING_FENCE');
    let b=mirrors.find(row=>row.stripe_subscription_id===i.snapshot.subscription_id);
    if((b?.revision||0)!==i.expected_revision)throw Error('BILLING_REVISION');
    if(b&&b.user_id!==u)throw Error('BILLING_IDENTITY');
    let outcome;
    if(b?.last_event_created!=null&&i.event_created<b.last_event_created)outcome='stale_ignored';
    else if(b?.terminal&&!i.snapshot.terminal)outcome='terminal_ignored';
    else{
     if(i.snapshot.plan==='pro'&&!prices.some(p=>p.stripe_price_id===i.snapshot.price_id&&p.entitlement_enabled))throw Error('BILLING_UNKNOWN_PRICE');
     const changed=JSON.stringify(b?.sync_snapshot)!==JSON.stringify(i.snapshot);outcome=changed?'repaired':'unchanged';
     if(!b){b={id:randomUUID(),user_id:u,stripe_customer_id:a.stripe_customer_id,stripe_subscription_id:i.snapshot.subscription_id,revision:0};mirrors.push(b);}
     Object.assign(b,{stripe_scope:scope,sync_snapshot:clone(i.snapshot),revision:b.revision+(changed?1:0),terminal:i.snapshot.terminal,last_event_created:Math.max(b.last_event_created||0,i.event_created||0)});
    }
    if(e)Object.assign(e,{state:'processed',outcome});return {data:{outcome,revision:b?.revision||0}};
   }else throw Error('unknown command '+action);
   return {data:clone(a)};
  }catch(error){return {error:{message:error.message}};}
 }};
 function list(values,params){const matched=values.filter(v=>!params.customer||v.customer===params.customer).filter(v=>!params.status||params.status==='all'||v.status===params.status);const start=params.starting_after?matched.findIndex(v=>v.id===params.starting_after)+1:0;return {then:resolve=>Promise.resolve({data:clone(matched.slice(start,start+(params.limit||100))),has_more:start+(params.limit||100)<matched.length}).then(resolve),async *[Symbol.asyncIterator](){if(failStripe)throw Error('private Stripe error');for(const value of matched)yield clone(value);}};}
 const stripe={customers:{async retrieve(id){if(failStripe)throw Error('private Stripe error');const customer=customers.get(id);if(!customer)throw Object.assign(Error('missing'),{code:'resource_missing'});return clone(customer);},async create(params,opts){const key=opts.idempotencyKey;if(!keys.has(key)){createdCustomers++;const c={id:'cus_created'+createdCustomers,livemode:false,...clone(params)};customers.set(c.id,c);keys.set(key,c);}if(loseCustomer){loseCustomer=false;throw Error('lost response');}return clone(keys.get(key));}},subscriptions:{async retrieve(id){retrieves++;if(retrieveGate)await retrieveGate;if(failStripe)throw Error('private Stripe failure');if(!subscriptions.has(id))throw Object.assign(Error('missing'),{code:'resource_missing'});return clone(subscriptions.get(id));},list:params=>list([...subscriptions.values()],params)},checkout:{sessions:{list:params=>list([...sessions.values()],params),async retrieve(id){return clone(sessions.get(id));},async create(params,opts){if(createGate)await createGate;const key=opts.idempotencyKey;if(!keys.has(key)){createdSessions++;const session={id:'cs_'+createdSessions,status:'open',url:'https://checkout.stripe.test/'+createdSessions,livemode:false,...clone(params)};keys.set(key,session);sessions.set(session.id,session);}if(loseCheckout){loseCheckout=false;throw Error('lost response');}return clone(keys.get(key));}}}};
 return {r:{db,stripe,scope,live:false},sub,events,accounts,mirrors,prices,audits,customers,sessions,subscriptions,get createdSessions(){return createdSessions;},get createdCustomers(){return createdCustomers;},get retrieves(){return retrieves;},set failCommit(v){failCommit=v;},set failStripe(v){failStripe=v;},set retrieveGate(v){retrieveGate=v;},set createGate(v){createGate=v;},set loseCheckout(v){loseCheckout=v;},set loseCustomer(v){loseCustomer=v;}};
}
function event(f,id='evt_one',created=100,type='customer.subscription.updated',object=f.sub){return {id,created,type,livemode:false,data:{object:clone(object)}};}
const flush=()=>new Promise(setImmediate);
let f=fixture();f.failCommit=true;await assert.rejects(webhook.handleStripeWebhookEvent(event(f),f.r));assert.equal(f.events.get('evt_one').state,'failed');assert.equal(f.mirrors.length,0);
await webhook.handleStripeWebhookEvent(event(f),f.r);assert.equal(f.events.get('evt_one').state,'processed');assert.equal(f.mirrors[0].revision,1);const reads=f.retrieves;
assert.equal((await webhook.handleStripeWebhookEvent(event(f),f.r)).reason,'duplicate_event');assert.equal(f.retrieves,reads);
f.sub.cancel_at_period_end=true;await webhook.handleStripeWebhookEvent(event(f,'evt_new',200),f.r);const revision=f.mirrors[0].revision;
f.sub.cancel_at_period_end=false;assert.equal((await webhook.handleStripeWebhookEvent(event(f,'evt_old',199),f.r)).reason,'stale_ignored');assert.equal(f.mirrors[0].revision,revision);
await webhook.handleStripeWebhookEvent(event(f,'evt_same',200),f.r);assert.equal(f.mirrors[0].sync_snapshot.cancel_at_period_end,false);
f.sub.status='canceled';await webhook.handleStripeWebhookEvent(event(f,'evt_deleted',300,'customer.subscription.deleted'),f.r);f.sub.status='active';await webhook.handleStripeWebhookEvent(event(f,'evt_late',400),f.r);assert.equal(f.mirrors[0].sync_snapshot.status,'canceled');
f=fixture();let release;f.retrieveGate=new Promise(resolve=>release=resolve);const delivery=webhook.handleStripeWebhookEvent(event(f),f.r);await flush();await assert.rejects(webhook.handleStripeWebhookEvent(event(f),f.r),/BILLING_BUSY/);release();await delivery;assert.equal(f.mirrors[0].revision,1);
const first=await rel.command(f.r,'claim',user,null);now+=90001;const second=await rel.command(f.r,'claim',user,null);await assert.rejects(rel.command(f.r,'bind',user,first.lease_token,{customer:'cus_owned'}),/BILLING_FENCE/);await rel.command(f.r,'release',user,second.lease_token);
const claim=await rel.command(f.r,'event_claim',null,null,{id:'evt_expired',type:'x',created:1});now+=90001;const reclaimed=await rel.command(f.r,'event_claim',null,null,{id:'evt_expired',type:'x',created:1});await assert.rejects(rel.command(f.r,'event_finish',null,claim.token,{id:'evt_expired',outcome:'ignored'}),/BILLING_FENCE/);await rel.command(f.r,'event_finish',null,reclaimed.token,{id:'evt_expired',outcome:'ignored'});
f=fixture();f.sub.status='past_due';await webhook.handleStripeWebhookEvent(event(f,'evt_fail',10,'invoice.payment_failed',{id:'in_one',parent:{type:'subscription_details',subscription_details:{subscription:'sub_owned'}}}),f.r);assert.equal(f.mirrors[0].sync_snapshot.plan,'free');
f.sub.status='active';await webhook.handleStripeWebhookEvent(event(f,'evt_recover',11,'invoice.payment_succeeded',{id:'in_one',subscription:{id:'sub_owned'}}),f.r);assert.equal(f.mirrors[0].sync_snapshot.plan,'pro');
assert.equal((await webhook.handleStripeWebhookEvent(event(f,'evt_standalone',12,'invoice.paid',{id:'in_standalone',parent:null}),f.r)).reason,'standalone_invoice');
await assert.rejects(webhook.handleStripeWebhookEvent(event(f,'evt_malformed',13,'invoice.payment_failed',{parent:{type:'subscription_details',subscription_details:null}}),f.r),/MALFORMED_INVOICE/);
f.sub.items.data[0].price.id='price_historical';await rel.synchronizeSubscription(f.r,'sub_owned');assert.equal(f.mirrors[0].sync_snapshot.plan,'pro');f.sub.items.data[0].price.id='price_unknown';await assert.rejects(rel.synchronizeSubscription(f.r,'sub_owned'),/UNKNOWN_PRICE/);
for(const status of ['past_due','unpaid']){f.sub.status=status;assert.equal(await checkout.billingCustomerForUser(user,f.r),'cus_owned');}
await assert.rejects(checkout.billingCustomerForUser(other,f.r),/NO_BILLING_ACCOUNT/);f.accounts.get(other).stripe_customer_id='cus_owned';await assert.rejects(checkout.billingCustomerForUser(other,f.r),/IDENTITY_CONFLICT/);
const input={userId:user,email:'not-for-logs@example.invalid',plan:'pro',billingInterval:'monthly',priceId:'price_current',successUrl:'https://local.invalid/client/billing',cancelUrl:'https://local.invalid/client/billing'};
f=fixture();await rel.synchronizeSubscription(f.r,'sub_owned');await assert.rejects(checkout.createStripeCheckoutSession(input,f.r),/SUBSCRIPTION_EXISTS/);f.sub.status='unpaid';await assert.rejects(checkout.createStripeCheckoutSession(input,f.r),/BILLING_RECOVERY_REQUIRED/);f.sub.status='canceled';f.loseCheckout=true;await assert.rejects(checkout.createStripeCheckoutSession(input,f.r));const session=await checkout.createStripeCheckoutSession(input,f.r);assert.equal(f.createdSessions,1);assert.equal(session.id,'cs_1');
f.sessions.get('cs_1').status='expired';await checkout.createStripeCheckoutSession(input,f.r);assert.equal(f.createdSessions,2);
f=fixture();f.subscriptions.clear();f.loseCustomer=true;await assert.rejects(checkout.createStripeCheckoutSession(input,f.r));await checkout.createStripeCheckoutSession(input,f.r);assert.equal(f.createdCustomers,1);assert.equal(f.createdSessions,1);
f=fixture();await rel.synchronizeSubscription(f.r,'sub_owned');f.subscriptions.set('sub_two',{...clone(f.sub),id:'sub_two'});await assert.rejects(checkout.createStripeCheckoutSession(input,f.r),/MULTIPLE_SUBSCRIPTIONS/);f.failStripe=true;await assert.rejects(checkout.createStripeCheckoutSession(input,f.r));assert.equal(f.createdSessions,0);
f=fixture();await rel.synchronizeSubscription(f.r,'sub_owned');f.sub.cancel_at_period_end=true;
let result=await reconcile.reconcileBilling({mode:'dry_run'},'user_admin',f.r);assert.equal(result.results[0].outcome,'would_repair');assert.equal(f.mirrors[0].sync_snapshot.cancel_at_period_end,false);
result=await reconcile.reconcileBilling({mode:'repair'},'user_admin',f.r);assert.equal(result.results[0].outcome,'repaired');const rev=f.mirrors[0].revision;
result=await reconcile.reconcileBilling({mode:'repair'},'user_admin',f.r);assert.equal(result.results[0].outcome,'unchanged');assert.equal(f.mirrors[0].revision,rev);assert.equal(f.createdSessions+f.createdCustomers,0);
f.mirrors.length=0;result=await reconcile.reconcileBilling({mode:'repair',userId:user},'user_admin',f.r);assert.equal(result.results[0].outcome,'repaired');
console.log('PASS: real webhook retry/duplicate/concurrency, expired leases/fencing, chronology/equal timestamp/terminal cancellation, invoice shapes, recovery, portal ownership, checkout lost responses/resubscription/conflicts, historical price, reconciliation dry-run/repair/idempotency. Store transactions simulated; no network/SQL.');
// Actual checkout routes share the same durable coordinator even across different request shapes.
f=fixture();await rel.synchronizeSubscription(f.r,'sub_owned');f.sub.status='canceled';
const api={ApiRouteError,apiSuccess:body=>({status:200,body}),apiErrorFromUnknown:error=>({status:error.status||503,body:{error:'sanitized'}})};
const routeDeps={'@/lib/stripe/client-identity':{requireBillingIdentity:async()=>({userId:user,email:null,profileId:user})},'@/lib/api/responses':api,'@/lib/stripe/billing-state':{isCheckoutBillingPlan:p=>p==='pro',isStripeBillingInterval:i=>['monthly','annual'].includes(i),stripePriceForCheckoutPlan:()=>input.priceId},'@/lib/stripe/checkout':{createStripeCheckoutSession:i=>checkout.createStripeCheckoutSession(i,f.r)},'next/server':{NextResponse:{json:(body,options={})=>({body,status:options.status||200})}},'@/lib/client-auth':{ClientAuthRequiredError:class extends Error{},requireClientUser:()=>{throw Error('unexpected legacy auth');}}};
const oldRoute=load('src/app/api/stripe/checkout/route.ts',routeDeps),newRoute=load('src/app/api/v1/billing/checkout/route.ts',routeDeps);
let finishCreate;f.createGate=new Promise(resolve=>finishCreate=resolve);
const request=body=>({url:'https://local.invalid/api/stripe/checkout',headers:new Headers({authorization:'Bearer fixture'}),json:async()=>body});
const firstRoute=oldRoute.POST(request({interval:'monthly'}));await flush();const secondRoute=await newRoute.POST(request({plan:'pro',billing_interval:'monthly'}));assert.equal(secondRoute.status,503);finishCreate();assert.equal((await firstRoute).status,200);assert.equal((await newRoute.POST(request({plan:'pro',billing_interval:'monthly'}))).status,200);assert.equal(f.createdSessions,1);
// Admin endpoint auth, origin, bounded body, strict inputs; no Stripe permitted here.
let approved=false,invocations=0;
const admin=load('src/app/api/admin/billing/reconcile/route.ts',{'@clerk/nextjs/server':{auth:async()=>({userId:'admin'})},'@/lib/admin-auth':{requireAdminAccess:async()=>({authorized:approved,userId:'admin',error:'Forbidden'})},'next/server':routeDeps['next/server'],'@/lib/stripe/reconciliation':{isSubscriptionId:reconcile.isSubscriptionId,reconcileBilling:async()=>{invocations++;return {results:[]};}}});
const req=(body,origin='https://local.invalid')=>new Request('https://local.invalid/api/admin/billing/reconcile',{method:'POST',headers:{origin},body:JSON.stringify(body)});
assert.equal((await admin.POST(req({mode:'repair'}))).status,403);approved=true;
assert.equal((await admin.POST(req({mode:'repair'},'https://evil.invalid'))).status,403);
assert.equal((await admin.POST(req({mode:'repair',subscription:'injected'}))).status,400);
assert.equal((await admin.POST(req({mode:'repair',after:'x'.repeat(3000)}))).status,413);
assert.equal((await admin.POST(req({mode:'dry_run'}))).status,200);assert.equal(invocations,1);
const serialized=JSON.stringify(f.audits);assert.ok(!serialized.includes('email')&&!serialized.includes('metadata'));
console.log('PASS: both real checkout routes prevent duplicates; Admin reconciliation authorization, cross-origin denial, payload bounds and strict contract; audit DTO privacy.');
// Real portal route permits billing recovery independently of effective entitlement.
let portalUser=user,portalCalls=0;
const portal=load('src/app/api/stripe/portal/route.ts',{'next/server':routeDeps['next/server'],'@/lib/api/responses':api,'@/lib/stripe/client-identity':{requireBillingIdentity:async()=>{if(!portalUser)throw new ApiRouteError(401,'UNAUTHORIZED','Authentication required');return {userId:portalUser};}},'@/lib/stripe/checkout':{billingCustomerForUser:u=>checkout.billingCustomerForUser(u,f.r),createStripeBillingPortalSession:async({customerId})=>{assert.equal(customerId,'cus_owned');portalCalls++;return {url:'https://billing.stripe.test/recovery'};}}});
f=fixture();await rel.synchronizeSubscription(f.r,'sub_owned');
for(const status of ['past_due','unpaid']){f.sub.status=status;assert.equal((await portal.POST(request({}))).status,200);}
portalUser=other;assert.notEqual((await portal.POST(request({}))).status,200);portalUser=null;assert.equal((await portal.POST(request({}))).status,401);assert.equal(portalCalls,2);
// Actual cancellation/resume and billing-summary module: shared synchronization,
// narrow Stripe update, existing owner authorization and summary contract.
f=fixture();await rel.synchronizeSubscription(f.r,'sub_owned');
f.mirrors[0].stripe_subscription_status='active';
f.customers.get('cus_owned').invoice_settings={default_payment_method:null};
f.r.stripe.invoices={list:async()=>({data:[]})};
let updates=0;
f.r.stripe.subscriptions.update=async(id,patch)=>{assert.equal(id,'sub_owned');assert.deepEqual(Object.keys(patch),['cancel_at_period_end']);updates++;Object.assign(f.sub,patch);return clone(f.sub);};
const summary=load('src/lib/stripe/billing-summary.ts',{'server-only':{},'@/lib/api/responses':api,'@/lib/entitlements':{normalizeDmiPlan:p=>p==='pro'?'pro':'free'},'@/lib/supabase-admin':{createSupabaseAdminClient:()=>f.r.db},'@/lib/stripe/config':{getStripeServerClient:()=>f.r.stripe},'@/lib/stripe/reliability':{...rel,billingRuntime:async()=>f.r},'@/lib/stripe/billing-state':{dmiPlanForStripePrice:()=> 'pro',normalizeStripeSubscriptionStatus:s=>s,stripeSubscriptionCurrentPeriodEnd:()=>null,stripeSubscriptionItemForBilling:s=>s.items.data[0],stripeTimestampToIso:()=>null}});
assert.equal((await summary.getBillingSummaryForUser(other)).hasSubscription,false);
for(const cancelAtPeriodEnd of [true,false]){const response=await summary.setSubscriptionCancelAtPeriodEndForUser({userId:user,cancelAtPeriodEnd});assert.equal(response.cancelAtPeriodEnd,cancelAtPeriodEnd);assert.equal(f.mirrors[0].sync_snapshot.cancel_at_period_end,cancelAtPeriodEnd);}
await assert.rejects(summary.setSubscriptionCancelAtPeriodEndForUser({userId:other,cancelAtPeriodEnd:true}));assert.equal(updates,2);
console.log('PASS: real portal route past_due/unpaid recovery, unrelated/unauthenticated denial; real client billing summary, cancellation/resume and shared mirror refresh.');
