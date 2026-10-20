import {recoveryDiagnosticGitDiff} from './billing-recovery-diagnostic-contract.mjs';
// Real checkout/client modules, offline store and mocked SDK; no hosted calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {load,apiFixture,request,pageFixture,paymentFixture,flush,nodes,fixture,checkout,embedded,session,client} from './validate-embedded-checkout.mjs';
const timing=load('src/lib/checkout-startup-timing.ts');
let count=0;
async function test(name,run){await run();count++;console.log('PASS '+name);}
await test('disabled telemetry has no sink or callback',()=>{
 assert.equal(timing.checkoutStartupObserver(false,()=>assert.fail('disabled sink')),undefined);
});
await test('output contains fixed labels and finite rounded duration only',()=>{
 const rows=[];const observe=timing.checkoutStartupObserver(true,x=>rows.push(JSON.parse(x)));
 observe('auth',12.4);
 assert.equal(JSON.stringify(rows),JSON.stringify([{component:'checkout_startup',stage:'auth',duration_ms:12}]));
 for(const stage of ['cus_private','email@example.test','session_secret_fixture',{},null])observe(stage,1);
 for(const value of ['secret',{},null,NaN,Infinity,-1,86400001])observe('auth',value);
 assert.equal(rows.length,1);
});
await test('throwing and rejected logging cannot alter results or original failures',async()=>{
 const original=Error('private provider message');
 for(const sink of [()=>{throw original;},()=>Promise.reject(original)]){
  const time=timing.checkoutStartupTiming(timing.checkoutStartupObserver(true,sink));
  assert.equal(await time('auth',async()=>42),42);
  await assert.rejects(time('auth',async()=>{throw original;}),e=>e===original);
 }
 await flush();
});
await test('timing executes each operation once and measures successful and failed boundaries',async()=>{
 const stages=[];let calls=0;const time=timing.checkoutStartupTiming((stage,ms)=>{assert.ok(ms>=0);stages.push(stage);});
 await time('auth',async()=>++calls);
 await assert.rejects(time('runtime',async()=>{calls++;throw Error('private');}));
 assert.equal(calls,2);assert.equal(stages.join(','),'auth,runtime');
});
await test('page issues exactly one creation POST without an availability GET',async()=>{
 const f=pageFixture();f.effect();await flush();
 assert.equal(f.requests.length,1);assert.equal(f.requests[0][1].method,'POST');
 assert.ok(nodes(f.render()).some(n=>n.type==='embedded'));
});
await test('disabled API still denies before runtime; rejected page shows safe error',async()=>{
 const f=apiFixture({enabled:false});assert.equal((await f.route.POST(request())).status,403);assert.equal(f.calls.join(','),'auth');
 const p=pageFixture({available:false});p.effect();await flush();assert.ok(nodes(p.render()).some(n=>n.props?.role==='alert'));
});
await test('only guarded API can issue browser timing capability',async()=>{
 const f=apiFixture();const response=await f.route.POST(request());assert.equal((await response.json()).data.startupDiagnostics,true);
 for(const options of [{enabled:false},{actualLive:true},{actualScope:'foreign:test'},{auth:false}]){
  const f=apiFixture(options),text=await (await f.route.POST(request())).text();assert.ok(!text.includes('startupDiagnostics'));
 }
 const guardSource=fs.readFileSync('src/lib/stripe/embedded-checkout-config.ts','utf8');
 for(const guard of ['VERCEL_ENV','VERCEL_TARGET_ENV','VERCEL_PROJECT_ID','NEXT_PUBLIC_SUPABASE_URL','STRIPE_ACCOUNT_SCOPE','STRIPE_SECRET_KEY'])assert.ok(guardSource.includes(guard));
});
await test('browser parser accepts only literal true and strips arbitrary diagnostic values',()=>{
 for(const value of ['true',1,{secret:'private'},null,false])assert.equal(client.paymentCheckout({kind:'embedded',sessionId:session.id,interval:'monthly',clientSecret:session.client_secret,publishableKey:'pk_test_fixture',startupDiagnostics:value}).startupDiagnostics,false);
});
await test('checkout instrumentation preserves exact provider/store call sequence and count',async()=>{
 async function run(measured){
  const f=fixture(),trace=[],stages=[];
  const rpc=f.r.db.rpc;f.r.db.rpc=(...args)=>{trace.push('rpc:'+args[1].p_action);return rpc(...args);};
  const from=f.r.db.from;f.r.db.from=(...args)=>{trace.push('read:'+args[0]);return from(...args);};
  for(const resource of ['customers','subscriptions'])for(const method of Object.keys(f.r.stripe[resource])){
   const original=f.r.stripe[resource][method];f.r.stripe[resource][method]=(...args)=>{trace.push(resource+'.'+method);return original(...args);};
  }
  for(const method of Object.keys(f.r.stripe.checkout.sessions)){
   const original=f.r.stripe.checkout.sessions[method];f.r.stripe.checkout.sessions[method]=(...args)=>{trace.push('sessions.'+method);return original(...args);};
  }
  await checkout.createStripeCheckoutSession(embedded,f.r,measured?timing.checkoutStartupTiming(stage=>stages.push(stage)):undefined);
  assert.equal(f.createdSessions,1);return {trace,stages};
 }
 const a=await run(false),b=await run(true);assert.deepEqual(a.trace,b.trace);
 for(const stage of ['individual_check','approved_price','customer_lookup','customer_prepare','customer_create','customer_verify','customer_bind','subscription_inventory','session_lookup','checkout_prepare','checkout_touch','session_create','attempt_record','account_operation'])assert.ok(b.stages.includes(stage),stage);
});
await test('same persisted attempt survives repeated preparation and owned resume without duplicate Session',async()=>{
 const f=fixture();const time=timing.checkoutStartupTiming(()=>{});
 const first=await checkout.createStripeCheckoutSession(embedded,f.r,time);
 const second=await checkout.createStripeCheckoutSession(embedded,f.r,time);
 Object.assign(f.accounts.get(embedded.userId),{verified_at:'verified',stripe_scope:f.r.scope});
 const resumed=await checkout.readOwnedCheckoutSession(embedded.userId,first.id,f.r,time);
 assert.equal(first.id,second.id);assert.equal(first.id,resumed.id);assert.equal(f.createdSessions,1);
});
await test('rendered callback emits one duration without forwarding SDK data',async()=>{
 const rows=[];const custom={...timing,checkoutStartupObserver:enabled=>timing.checkoutStartupObserver(enabled,x=>rows.push(JSON.parse(x)))};
 const f=paymentFixture({startupDiagnostics:true,timing:custom});const cleanup=f.effect();await flush();
 const analytics=f.analytics();assert.equal(typeof analytics,'function');
 assert.doesNotThrow(()=>analytics({get eventType(){throw Error('private');}}));
 const event={eventType:'checkoutRendered',checkoutSession:'cs_private',details:{email:'private',card:'private'},clientMetadata:{secret:'private'}};
 analytics(event);analytics(event);analytics({...event,eventType:'checkoutSubmitted'});
 for(const stage of ['stripe_js_load','embedded_initialize','embedded_mount','form_ready'])assert.equal(rows.filter(r=>r.stage===stage).length,1);
 assert.ok(!JSON.stringify(rows).includes('private'));
 cleanup();analytics(event);assert.equal(rows.filter(r=>r.stage==='form_ready').length,1);
});
await test('default browser SDK path registers no diagnostics callback',async()=>{
 const f=paymentFixture();f.effect();await flush();assert.equal(f.analytics(),undefined);
});
await test('Stripe loader only receives publishable key after guarded Session response',()=>{
 const page=fs.readFileSync('src/app/client/billing/pay/page.tsx','utf8'),payment=fs.readFileSync('src/components/EmbeddedPayment.tsx','utf8'),modal=fs.readFileSync('src/components/UpgradeToProModal.tsx','utf8');
 assert.match(payment,/loadStripe\(publishableKey\)/);assert.doesNotMatch(payment,/localStorage|sessionStorage|fetch\(/);
 assert.doesNotMatch(page,/localStorage|sessionStorage|loadStripe/);assert.match(page,/history.replaceState/);
 assert.match(modal,/window.location.assign\(`\/client\/billing\/pay\?interval=/);
 assert.doesNotMatch(page+payment,/billing-work|reconcile/);
});
await test('billing authority, workers, SQL, webhook and activation files remain untouched',async()=>{
 // Exact hash-pinned observability additions only; authority still frozen.
 assert.equal(recoveryDiagnosticGitDiff(['diff','--name-only','HEAD','--','src','supabase/migrations'],{encoding:'utf8'}),'');
});
console.log(`Checkout startup: ${count}/${count} passed (offline).`);
