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
await test('early loader is public-only, page-owned and has no Session or storage API',()=>{
 const page=fs.readFileSync('src/app/client/billing/pay/PaymentClient.tsx','utf8'),payment=fs.readFileSync('src/components/EmbeddedPayment.tsx','utf8'),loader=fs.readFileSync('src/lib/embedded-stripe-loader.ts','utf8');
 assert.doesNotMatch(loader,/fetch\(|clientSecret|localStorage|sessionStorage/);
 assert.doesNotMatch(page+payment,/localStorage|sessionStorage|billing-work|reconcile/);
 assert.match(page,/history.replaceState/);
 assert.match(loader,/loadStripe\(publishableKey\)/);
});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function readGates({individualError=false,priceError=false}={}){
 const f=fixture(),individual=deferred(),price=deferred(),started=[],released=[],rpc=f.r.db.rpc,from=f.r.db.from;
 f.r.db.rpc=(name,args)=>{if(args.p_action==='release')released.push('release');return rpc(name,args);};
 f.r.db.from=name=>{
  const q=from(name);if(!['clients','client_users','billing_approved_prices'].includes(name))return q;
  const then=q.then;q.then=async resolve=>{
   assert.ok(f.accounts.get(embedded.userId)?.lease_token,'lease precedes reads');started.push(name);
   await (name==='billing_approved_prices'?price:individual).promise;
   if(name==='billing_approved_prices'&&priceError)return resolve({error:{},data:null});
   if(name!=='billing_approved_prices'&&individualError)return resolve({error:{},data:null});
   return then(resolve);
  };return q;
 };
 return {f,individual,price,started,released};
}
await test('embedded independent reads overlap inside lease and both precede customer/provider work',async()=>{
 const g=readGates(),run=checkout.createStripeCheckoutSession(embedded,g.f.r);await flush();
 assert.equal(g.started.length,3);assert.equal(g.f.createdCustomers,0);
 g.price.resolve();await flush();assert.equal(g.f.createdCustomers,0);assert.equal(g.released.length,0);
 g.individual.resolve();await run;assert.equal(g.f.createdSessions,1);assert.equal(g.released.length,1);
});
await test('either read failure blocks provider work and waits for other read before releasing lease',async()=>{
 for(const options of [{individualError:true},{priceError:true},{individualError:true,priceError:true}]){
  const g=readGates(options),run=checkout.createStripeCheckoutSession(embedded,g.f.r);
  const result=run.then(()=>assert.fail('must fail'),e=>e);await flush();
  g.individual.resolve();await flush();assert.equal(g.released.length,0);assert.equal(g.f.createdCustomers,0);
  g.price.resolve();const error=await result;
  assert.match(error.message,options.individualError?/IDENTITY_UNAVAILABLE/:/PRICE_REGISTRY_UNAVAILABLE/);
  assert.equal(g.f.createdSessions,0);assert.equal(g.f.createdCustomers,0);assert.equal(g.released.length,1);
 }
});
await test('unapproved price still blocks customer creation',async()=>{
 const f=fixture();f.prices[0].checkout_enabled=false;
 await assert.rejects(checkout.createStripeCheckoutSession(embedded,f.r),/UNKNOWN_CHECKOUT_PRICE/);
 assert.equal(f.createdCustomers,0);assert.equal(f.createdSessions,0);
});
await test('hosted reads retain original sequential order',async()=>{
 const g=readGates(),hosted={...embedded};delete hosted.presentation;delete hosted.returnUrl;
 const run=checkout.createStripeCheckoutSession({...hosted,successUrl:'https://staging.dmicards.com',cancelUrl:'https://staging.dmicards.com'},g.f.r);await flush();
 assert.equal(g.started.includes('billing_approved_prices'),false);
 g.individual.resolve();await flush();assert.equal(g.started.includes('billing_approved_prices'),true);
 g.price.resolve();await run;assert.equal(g.f.createdSessions,1);
});
await test('server wrapper exposes early key only through existing exact Staging enablement guard',()=>{
 const Page=load('src/app/client/billing/pay/page.tsx',{'react/jsx-runtime':{jsx:(type,props)=>({type,props})},'./PaymentClient':{default:'client'},'@/lib/stripe/embedded-checkout-config':{embeddedCheckoutEnabled:()=>false,embeddedCheckoutEnvironment:()=>assert.fail('OFF must not issue capability')}}).default;
 assert.equal(Page().props.earlyPublishableKey,null);
 const Enabled=load('src/app/client/billing/pay/page.tsx',{'react/jsx-runtime':{jsx:(type,props)=>({type,props})},'./PaymentClient':{default:'client'},'@/lib/stripe/embedded-checkout-config':{embeddedCheckoutEnabled:()=>true,embeddedCheckoutEnvironment:()=>({publishableKey:'pk_test_fixture'})}}).default;
 assert.equal(Enabled().props.earlyPublishableKey,'pk_test_fixture');
});
await test('authenticated load overlaps pending POST and Strict Mode reuses one page operation',async()=>{
 const gate=deferred(),f=pageFixture({postGate:gate.promise});const cleanup=f.effect();cleanup();f.effect();await flush();
 assert.equal(f.requests.length,1);assert.equal(f.loaderCalls.length,1);assert.ok(!nodes(f.render()).some(n=>n.type==='embedded'));
 gate.resolve();await flush();const node=nodes(f.render()).find(n=>n.type==='embedded');
 assert.ok(node.props.stripeLoader);assert.equal(node.props.stripeLoader.publishableKey,'pk_test_fixture');
 f.render();assert.equal(f.loaderCalls.length,1);
});
await test('disabled capability, unauthenticated page and Session resumption do not load early',async()=>{
 for(const options of [{earlyPublishableKey:null},{authenticated:false},{query:'?session_id=cs_test_owned'}]){
  const f=pageFixture(options);f.effect();await flush();assert.equal(f.loaderCalls.length,0);
 }
});
await test('unmount before authentication completes does not load or POST',async()=>{
 const f=pageFixture();f.effect()();await flush();assert.equal(f.loaderCalls.length,0);assert.equal(f.requests.length,0);
});
await test('account change during pending POST never mounts returned owner secret',async()=>{
 const gate=deferred(),f=pageFixture({postGate:gate.promise});f.effect();await flush();f.changeIdentity();gate.resolve();await flush();
 assert.ok(!nodes(f.render()).some(n=>n.type==='embedded'));assert.equal(f.history.length,0);
});
await test('failed POST is safe even after Stripe.js completed',async()=>{
 const f=pageFixture({available:false});f.effect();await flush();assert.equal(f.loaderCalls.length,1);
 assert.ok(nodes(f.render()).some(n=>n.props?.role==='alert'));assert.equal(f.history.length,0);
});
await test('failed early loader is safely reused without unhandled rejection or second load',async()=>{
 const f=pageFixture({rejectLoad:true});f.effect();await flush();const node=nodes(f.render()).find(n=>n.type==='embedded');
 assert.equal(await node.props.stripeLoader.promise,null);assert.equal(f.loaderCalls.length,1);
 const payment=paymentFixture({stripeLoader:node.props.stripeLoader});payment.effect();await flush();assert.equal(payment.calls.length,0);assert.equal(payment.slots[3].value,'error');
});
await test('payment consumes supplied promise without invoking loader again',async()=>{
 let initialized=0,mounted=0;const stripeLoader={publishableKey:'pk_test_fixture',promise:Promise.resolve({async createEmbeddedCheckoutPage(){initialized++;return {mount(){mounted++;},destroy(){}};}})};
 const f=paymentFixture({stripeLoader});f.effect();await flush();assert.equal(initialized,1);assert.equal(mounted,1);assert.equal(f.calls.length,0);
});
await test('mismatched loader key fails closed before SDK initialization',async()=>{
 const f=paymentFixture({stripeLoader:{publishableKey:'pk_test_other',promise:Promise.resolve({})}});f.effect();await flush();assert.equal(f.calls.length,0);assert.equal(f.slots[3].value,'error');
});
await test('overlap timing distinguishes completion before and after Session response without identifiers',async()=>{
 for(const early of [true,false]){
  const gate=deferred(),rows=[],custom={...timing,checkoutStartupObserver:enabled=>timing.checkoutStartupObserver(enabled,x=>rows.push(JSON.parse(x)))};
  const post=deferred(),f=pageFixture({postGate:post.promise,stripeGate:gate.promise,timing:custom});f.effect();await flush();
  if(early){gate.resolve();await flush();post.resolve();}else{post.resolve();await flush();gate.resolve();}
  await flush();const remaining=rows.find(r=>r.stage==='stripe_js_remaining_after_session');assert.ok(remaining);if(early)assert.equal(remaining.duration_ms,0);
  assert.equal(rows.filter(r=>r.stage==='stripe_js_load').length,1);assert.ok(!JSON.stringify(rows).includes('pk_test'));
 }
});
await test('billing authority, workers, SQL, webhook and activation files remain untouched',async()=>{
 // Exact hash-pinned observability additions only; authority still frozen.
 assert.equal(recoveryDiagnosticGitDiff(['diff','--name-only','HEAD','--','src','supabase/migrations'],{encoding:'utf8'}),'');
});
console.log(`Checkout startup: ${count}/${count} passed (offline).`);
