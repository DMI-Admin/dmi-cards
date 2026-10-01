// Offline: real route/orchestrator/entitlement/Finance modules, signed synthetic events.
// Existing atomic billing test fixture is reused; no network or environment files.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import Stripe from 'stripe';
import {randomUUID} from 'node:crypto';
import {loadFinance,memoryHarness} from './validate-finance-consumer.mjs';
import {graphFixture,apiVersion,webhookVersion,fixtureNow,user} from './fixtures/finance-v1.mjs';
const transpile=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const billingSource=fs.readFileSync('scripts/validate-stripe-reliability.mjs','utf8');
assert.ok(billingSource.includes('let f=fixture();'));
const billingExports={};
vm.runInNewContext(transpile(billingSource.split('let f=fixture();')[0]+'\nexports.fixture=fixture;exports.webhook=webhook;'),{
 exports:billingExports,Error,Date,URL,Buffer,console,Promise,setImmediate,
 require:name=>({'node:assert/strict':{default:assert},'node:fs':{default:fs},'node:vm':{default:vm},typescript:{default:ts},'node:crypto':{randomUUID}}[name]),
});
const {consumer,storeModule}=loadFinance();
function load(file,deps,env,logConsole=console){const exports={};vm.runInNewContext(transpile(fs.readFileSync(file,'utf8')),{exports,Error,Date,Promise,URL,console:logConsole,process:{env},require:name=>{assert.ok(name in deps,`Unexpected import: ${name}`);return deps[name];}});return exports;}
const signingSecret='whsec_offline_fixture';const sdk=new Stripe('sk_test_offline_fixture');
function setup(){
 const billing=billingExports.fixture(),h=memoryHarness('acct_fixture:test');
 const f=JSON.parse(JSON.stringify(graphFixture()).replaceAll('sub_one','sub_owned').replaceAll('cus_one','cus_owned').replaceAll('price_month','price_current'));
 f.graph.subscriptions=[f.subscription];Object.assign(billing.sub,f.subscription);
 let failFinance=false,reads=0,entitlementCalls=0;const logs=[];
 const env={VERCEL_ENV:'preview',VERCEL_TARGET_ENV:'staging',NEXT_PUBLIC_SUPABASE_URL:'https://uohdkewufeivdpaljnng.supabase.co',STRIPE_SECRET_KEY:'sk_test_offline_fixture'};
 const capture=line=>logs.push(JSON.parse(line.replace(/^\[DMI\] /,'')));
 const logger=load('src/lib/observability/logger.ts',{},env,{info:capture,warn:capture,error:capture});
 const source={identity:async()=>({scope:'acct_fixture:test',apiVersion}),graph:async()=>{reads++;if(failFinance)throw Error('PRIVATE_PROVIDER_ERROR');return structuredClone(f.graph);}};
 const orchestrator=load('src/lib/stripe/webhook-consumers.ts',{
  '@/lib/observability/logger':logger,
  './webhook-observer':load('src/lib/stripe/webhook-observer.ts',{'server-only':{}},env),
  './finance-runtime-guard':load('src/lib/stripe/finance-runtime-guard.ts',{'server-only':{}},env),
  'server-only':{},'./webhook':{handleStripeWebhookEvent:(...args)=>{entitlementCalls++;return billingExports.webhook.handleStripeWebhookEvent(args[0],billing.r,args[2]);}},
  './config':{getStripeServerClient:()=>sdk},'@/lib/supabase-admin':{createSupabaseAdminClient:()=>({})},
  './finance-store':{createFinanceStore:()=>h.store,createFinanceRuntime:(s,store)=>storeModule.createFinanceRuntime(s,store,()=>fixtureNow)},
  './finance-stripe-adapter':{stripeFinanceSource:()=>source},'./finance-webhook':consumer,
 },env);
 let signatures=0;
 const route=load('src/app/api/stripe/webhook/route.ts',{
  'next/server':{NextResponse:{json:(body,options)=>new Response(JSON.stringify(body),{status:options?.status||200})}},
  '@/lib/stripe/config':{constructStripeWebhookEvent:({payload,signature})=>{signatures++;return sdk.webhooks.constructEvent(payload,signature,signingSecret);}},
  '@/lib/stripe/webhook-consumers':orchestrator,
  '@/lib/observability/logger':logger,
  '@/lib/observability/request':{requestIdFromRequest:()=> 'offline-request',withRequestIdHeader:r=>r},
 },env);
 const make=(id,type,object)=>({id,object:'event',type,created:Math.floor(Date.now()/1000),api_version:webhookVersion,livemode:false,data:{object:structuredClone(object)}});
 async function send(e,bad=false){const payload=JSON.stringify(e),signature=bad?'invalid':sdk.webhooks.generateTestHeaderString({payload,secret:signingSecret});return route.POST(new Request('https://staging.invalid/api/stripe/webhook',{method:'POST',body:payload,headers:{'stripe-signature':signature}}));}
 return {billing,h,f,env,make,send,logs,get reads(){return reads;},get signatures(){return signatures;},get entitlementCalls(){return entitlementCalls;},set failFinance(v){failFinance=v;}};
}
// A: entitlement committed, failed Finance retries without another entitlement mutation.
let s=setup();let e=s.make('evt_isolationA','customer.subscription.created',s.f.subscription);s.failFinance=true;
assert.equal((await s.send(e)).status,500);assert.equal(s.billing.events.get(e.id).state,'processed');assert.equal((await s.h.delivery(e.id)).state,'failed');const revision=s.billing.mirrors[0].revision;
s.failFinance=false;assert.equal((await s.send(e)).status,200);assert.equal(s.billing.mirrors[0].revision,revision);assert.equal((await s.h.delivery(e.id)).state,'processed');
// B: Finance committed, entitlement failed. Retry skips Finance retrieval/rows.
s=setup();e=s.make('evt_isolationB','customer.subscription.created',s.f.subscription);s.billing.failCommit=true;
assert.equal((await s.send(e)).status,500);assert.equal(s.billing.events.get(e.id).state,'failed');assert.equal((await s.h.delivery(e.id)).state,'processed');const reads=s.reads;
assert.equal((await s.send(e)).status,200);assert.equal(s.reads,reads);assert.equal((await s.h.all('subscriptions')).length,1);assert.equal((await s.h.all('activity')).length,1);
// All five destination events traverse the real route and both real consumers.
for(const type of ['checkout.session.completed','customer.subscription.created','customer.subscription.updated','customer.subscription.deleted','invoice.payment_failed']){
 s=setup();let object=s.f.subscription;
 if(type==='checkout.session.completed')object={id:'cs_fixture',subscription:'sub_owned',client_reference_id:user,metadata:{dmi_app:'dmi_cards_v2',dmi_user_id:user}};
 if(type==='customer.subscription.deleted'){s.billing.sub.status='canceled';s.f.subscription.status='canceled';s.f.subscription.ended_at=1700000000;object=s.f.subscription;}
 if(type==='invoice.payment_failed'){s.billing.sub.status='past_due';s.f.subscription.status='past_due';s.f.graph.invoices=[s.f.invoice];object={...s.f.invoice,subscription:'sub_owned'};}
 e=s.make('evt_'+type.replace(/[^A-Za-z0-9]/g,''),type,object);
 const response=await s.send(e);assert.equal(response.status,200,JSON.stringify({type,entitlement:s.billing.events.get(e.id),finance:await s.h.delivery(e.id)}));assert.equal(s.billing.events.get(e.id).state,'processed');
 assert.equal((await s.h.delivery(e.id)).state,type==='checkout.session.completed'?'ignored':'processed');
 const before=JSON.stringify(s.billing.mirrors),activityCount=(await s.h.all('activity')).length;
 assert.equal((await s.send(e)).status,200);assert.equal(JSON.stringify(s.billing.mirrors),before);assert.equal((await s.h.all('activity')).length,activityCount);
 assert.equal(s.billing.mirrors[0].sync_snapshot.plan,['customer.subscription.deleted','invoice.payment_failed'].includes(type)?'free':'pro');
 assert.equal(s.signatures,2);
}
// Unsupported Finance types are ignored; unknown versions retry after entitlement success.
s=setup();e=s.make('evt_allocation','invoice_payment.paid',s.f.allocation);assert.equal((await s.send(e)).status,200);assert.equal((await s.h.delivery(e.id)).state,'ignored');assert.equal(s.reads,0);
e=s.make('evt_badversion','customer.subscription.updated',s.f.subscription);e.api_version='unreviewed';const rejected=await s.send(e);assert.equal(rejected.status,500);assert.equal(s.billing.events.get(e.id).state,'processed');assert.equal((await rejected.json()).error.code,'STRIPE_WEBHOOK_FAILED');
// Signature must reject before either consumer, including initialization.
s=setup();e=s.make('evt_signature','customer.subscription.created',s.f.subscription);assert.equal((await s.send(e,true)).status,400);assert.equal(s.entitlementCalls,0);assert.equal(s.reads,0);
// Finance configuration failures cannot prevent already-authorized entitlement work.
s=setup();s.env.NEXT_PUBLIC_SUPABASE_URL='https://wrong.invalid';e=s.make('evt_target','customer.subscription.created',s.f.subscription);assert.equal((await s.send(e)).status,500);assert.equal(s.billing.events.get(e.id).state,'processed');assert.equal(s.reads,0);
// Production retains the existing entitlement-only path; no Finance instantiation.
s=setup();s.env.VERCEL_ENV='production';e=s.make('evt_productionguard','customer.subscription.created',s.f.subscription);assert.equal((await s.send(e)).status,200);assert.equal(await s.h.delivery(e.id),null);assert.equal(s.reads,0);
assert.doesNotMatch(JSON.stringify(s.logs),/sk_test|whsec|PRIVATE_PROVIDER_ERROR/);
console.log('PASS: signed real webhook route; both real consumers; failure isolation/retry/duplicate; five configured events; ignored allocation; compatibility failure; staging guards; Production entitlement-only; sanitized responses.');

// Temporary staging observer: trace both real consumers without changing failures.
s=setup();e=s.make('evt_diagnostic','customer.subscription.updated',s.f.subscription);
assert.equal((await s.send(e)).status,200);
let diagnostics=s.logs.filter(x=>x.code==='STRIPE_WEBHOOK_DIAGNOSTIC').map(x=>x.metadata);
for(const consumer of ['entitlement','finance'])for(const stage of ['runtime','event_claim','claim','commit','release'])assert.ok(diagnostics.some(x=>x.consumer===consumer&&x.stage===stage&&x.outcome==='succeeded'),consumer+':'+stage);
for(const stage of ['envelope','stripe_retrieval','identity_binding','normalization','mirror_read','item_read'])assert.ok(diagnostics.some(x=>x.consumer==='finance'&&x.stage===stage&&x.outcome==='succeeded'),stage);
assert.ok(diagnostics.every(x=>x.stripeEventId===e.id&&x.requestId==='offline-request'));
assert.ok(diagnostics.findIndex(x=>x.consumer==='finance')>diagnostics.findLastIndex(x=>x.consumer==='entitlement'));
// Failure to record event_fail must not hide the original consumer error.
s=setup();s.failFinance=true;const originalCommand=s.h.store.command;
s.h.store.command=async(...args)=>{if(args[0]==='event_fail')throw Error('FINANCE_FENCE');return originalCommand(...args);};
e=s.make('evt_diagnosticFailure','customer.subscription.updated',s.f.subscription);assert.equal((await s.send(e)).status,500);
diagnostics=s.logs.filter(x=>x.code==='STRIPE_WEBHOOK_DIAGNOSTIC').map(x=>x.metadata);
assert.ok(diagnostics.some(x=>x.stage==='event_fail'&&x.outcome==='failed'&&x.errorCode==='FINANCE_FENCE'));
assert.ok(diagnostics.some(x=>x.consumer==='finance'&&x.stage==='consumer'&&x.outcome==='failed'&&x.errorCode==='FINANCE_RETRYABLE_FAILURE'));
assert.doesNotMatch(JSON.stringify(diagnostics),/PRIVATE_PROVIDER_ERROR|sk_test|whsec|cus_|sub_owned|lease_token/);
for(const target of ['preview','production']){s=setup();s.env.VERCEL_ENV=target;s.env.VERCEL_TARGET_ENV=target;e=s.make('evt_noDiagnostic'+target,'customer.subscription.updated',s.f.subscription);await s.send(e);assert.equal(s.logs.filter(x=>x.code==='STRIPE_WEBHOOK_DIAGNOSTIC').length,0);}
console.log('PASS: temporary diagnostics trace real consumer/RPC stages, preserve original failure despite event_fail failure, sanitize data and stay disabled outside staging.');

// TEMPORARY: actual normalization failure emits only the fixed assertion label.
s=setup();delete s.f.subscription.items.data[0].created;
e=s.make('evt_assertion','customer.subscription.updated',s.f.subscription);
const assertionResponse=await s.send(e);assert.equal(assertionResponse.status,500);
assert.equal((await assertionResponse.json()).error.code,'STRIPE_WEBHOOK_FAILED');
assert.equal(s.billing.events.get(e.id).state,'processed');
assert.equal((await s.h.delivery(e.id)).state,'failed');
const assertionLogs=s.logs.filter(x=>x.code==='STRIPE_WEBHOOK_DIAGNOSTIC'&&x.metadata.check).map(x=>x.metadata);
assert.equal(assertionLogs.length,1);assert.equal(assertionLogs[0].fieldPath,'subscription.items[].created');assert.equal(assertionLogs[0].check,'unix_timestamp');assert.equal(assertionLogs[0].present,false);assert.equal(assertionLogs[0].primitiveType,'undefined');assert.equal(assertionLogs[0].errorCode,'FINANCE_MALFORMED_STRIPE_DATA');
assert.doesNotMatch(JSON.stringify(assertionLogs),/cus_|sub_owned|sk_test|whsec|PRIVATE_PROVIDER_ERROR/);
console.log('PASS: actual webhook assertion trace, unchanged sanitized 500, entitlement processed and Finance failed receipt retained.');

assert.equal(assertionLogs[0].stripeEventId,e.id);
assert.equal(s.logs.filter(x=>x.code==='STRIPE_WEBHOOK_DIAGNOSTIC'&&x.metadata.stage==='normalization'&&x.metadata.outcome==='failed').length,1);
console.log('PASS: assertion fields survive the real logger on the single event-correlated normalization failure record.');
