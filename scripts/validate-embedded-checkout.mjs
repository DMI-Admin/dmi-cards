// Real modules, fake Stripe and atomic in-memory billing store. No network/secrets.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {randomUUID} from 'node:crypto';
import {assertEmbeddedCheckoutFiles,embeddedCheckoutReviewedPaths} from './billing-embedded-checkout-contract.mjs';

function load(path,deps={},globals={}) {
 const exports={};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
  {exports,URL,URLSearchParams,Response,Request,Error,Promise,performance,console,setTimeout,clearTimeout,...globals,require(name){assert.ok(name in deps,`Unexpected dependency ${name}`);return deps[name];}});
 return exports;
}
let count=0;
async function test(name,run){await run();count++;console.log('PASS '+name);}
const fixtureExports={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('scripts/validate-stripe-reliability.mjs','utf8').split('let f=fixture();')[0]+'\nexports.fixture=fixture;exports.checkout=checkout;exports.rel=rel;',
 {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:fixtureExports,URL,Buffer,console,performance,AbortController,setTimeout,clearTimeout,require:name=>({
 'node:assert/strict':{default:assert},'node:fs':{default:fs},'node:vm':{default:vm},typescript:{default:ts},'node:crypto':{randomUUID},
 }[name])});
const {checkout}=fixtureExports;
const user='11111111-1111-4111-8111-111111111111';
const input={userId:user,email:null,plan:'pro',billingInterval:'monthly',priceId:'price_current',successUrl:'https://staging.dmicards.com/client/billing/activating?session_id={CHECKOUT_SESSION_ID}',cancelUrl:'https://staging.dmicards.com/client/billing?checkout=cancelled'};
const embedded={...input,presentation:'embedded',returnUrl:'https://staging.dmicards.com/client/billing/pay?session_id={CHECKOUT_SESSION_ID}'};
function fixture(){
 const f=fixtureExports.fixture();f.subscriptions.clear();
 const original=f.r.stripe.checkout.sessions.create;
 f.r.stripe.checkout.sessions.create=async(...args)=>{
  try {return await original(...args);} finally {
   for(const s of f.sessions.values())if(s.ui_mode==='embedded_page'){s.url=null;s.client_secret=s.id+'_secret_fixture';}
  }
 };
 // The fixture returns a clone before finally; emulate the SDK's real response.
 const wrapped=f.r.stripe.checkout.sessions.create;
 f.r.stripe.checkout.sessions.create=async(...args)=>{
  const s=await wrapped(...args);return s.ui_mode==='embedded_page'?{...s,url:null,client_secret:s.id+'_secret_fixture'}:s;
 };
 return f;
}
const constants=load('src/lib/stripe/billing-work-config.ts',{'server-only':{}});
const env={VERCEL_ENV:'preview',VERCEL_TARGET_ENV:'staging',VERCEL_PROJECT_ID:constants.BILLING_WORK_PROJECT,NEXT_PUBLIC_SUPABASE_URL:constants.BILLING_WORK_DATABASE,STRIPE_ACCOUNT_SCOPE:constants.BILLING_WORK_SCOPE,STRIPE_SECRET_KEY:'sk_test_fixture',NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY:'pk_test_fixture',BILLING_EMBEDDED_CHECKOUT_ENABLED:'true'};
const config=load('src/lib/stripe/embedded-checkout-config.ts',{'server-only':{},'./billing-work-config':constants},{process:{env}});
class ApiRouteError extends Error {constructor(status,code,message){super(message);this.status=status;this.code=code;}}
const responses={ApiRouteError,apiSuccess:(data,options)=>Response.json({data},options),apiError:(status,code,message)=>Response.json({error:{code,message}},{status})};
const billingState={isStripeBillingInterval:v=>v==='monthly'||v==='annual',stripePriceForCheckoutPlan:(_plan,interval)=>interval==='monthly'?'price_monthly':'price_annual'};
const dto=load('src/lib/stripe/embedded-checkout-response.ts',{'server-only':{},'@/lib/api/responses':responses,'./billing-state':billingState});
const client=load('src/lib/embedded-checkout-client.ts');
const startup=load('src/lib/checkout-startup-timing.ts',{}, {console:{info(){}}});
await test('flag defaults OFF and all exact Staging deployment/key guards are required',()=>{
 assert.equal(config.embeddedCheckoutEnabled(env),true);
 assert.equal(config.embeddedCheckoutEnabled({...env,BILLING_EMBEDDED_CHECKOUT_ENABLED:undefined}),false);
 for(const [key,value] of Object.entries({VERCEL_ENV:'production',VERCEL_TARGET_ENV:'preview',VERCEL_PROJECT_ID:'other',NEXT_PUBLIC_SUPABASE_URL:'other',STRIPE_ACCOUNT_SCOPE:'other:test',STRIPE_SECRET_KEY:'sk_live_fixture',NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY:'pk_live_fixture',BILLING_EMBEDDED_CHECKOUT_ENABLED:'TRUE'}))assert.equal(config.embeddedCheckoutEnabled({...env,[key]:value}),false,key);
});
await test('hosted creation retains URLs, metadata and subscription mode',async()=>{
 const f=fixture(),s=await checkout.createStripeCheckoutSession(input,f.r);
 assert.equal(s.success_url,input.successUrl);assert.equal(s.cancel_url,input.cancelUrl);assert.equal(s.mode,'subscription');assert.equal(s.ui_mode,undefined);
 assert.equal(s.metadata.dmi_app,'dmi_cards_v2');assert.equal(s.subscription_data.metadata.dmi_user_id,user);assert.equal(f.createdSessions,1);
});
await test('embedded creation supplies supported UI, card-only methods and return URL without hosted URLs',async()=>{
 const f=fixture(),s=await checkout.createStripeCheckoutSession(embedded,f.r);
 assert.equal(s.ui_mode,'embedded_page');assert.equal(s.success_url,undefined);assert.equal(s.cancel_url,undefined);
 assert.equal(s.return_url,embedded.returnUrl);assert.equal(s.redirect_on_completion,'if_required');assert.equal(s.payment_method_types.join(','),'card');assert.ok(s.client_secret);assert.equal(s.url,null);
});
await test('hosted and embedded open attempts resume their original presentation across flag changes',async()=>{
 for(const [first,second] of [[input,embedded],[embedded,input]]){
  const f=fixture(),a=await checkout.createStripeCheckoutSession(first,f.r),params=JSON.stringify(f.accounts.get(user).checkout_parameters);
  const b=await checkout.createStripeCheckoutSession(second,f.r);
  assert.equal(a.id,b.id);assert.equal(a.ui_mode,b.ui_mode);assert.equal(JSON.stringify(f.accounts.get(user).checkout_parameters),params);assert.equal(f.createdSessions,1);
 }
});
await test('lost provider response replays persisted parameters and original mode under the same key',async()=>{
 for(const [first,second] of [[input,embedded],[embedded,input]]){
  const f=fixture();f.loseCheckout=true;await assert.rejects(checkout.createStripeCheckoutSession(first,f.r));
  const attempt=f.accounts.get(user).checkout_attempt,s=await checkout.createStripeCheckoutSession(second,f.r);
  assert.equal(f.createdSessions,1);assert.equal(s.metadata.dmi_checkout_attempt,attempt);assert.equal(s.ui_mode,first.presentation==='embedded'?'embedded_page':undefined);
 }
});
await test('account lease prevents concurrent duplicate Session creation',async()=>{
 const f=fixture();let release;f.createGate=new Promise(resolve=>release=resolve);
 const first=checkout.createStripeCheckoutSession(embedded,f.r);await new Promise(setImmediate);
 await assert.rejects(checkout.createStripeCheckoutSession(embedded,f.r),/BILLING_BUSY/);release();await first;assert.equal(f.createdSessions,1);
});
await test('approved-price and live-subscription fences remain authoritative',async()=>{
 const f=fixture();await assert.rejects(checkout.createStripeCheckoutSession({...embedded,priceId:'price_arbitrary'},f.r));assert.equal(f.createdSessions,0);
 f.accounts.get(user).stripe_customer_id='cus_owned';f.subscriptions.set(f.sub.id,f.sub);await assert.rejects(checkout.createStripeCheckoutSession(embedded,f.r),/SUBSCRIPTION_EXISTS/);assert.equal(f.createdSessions,0);
});
async function owned(){const f=fixture();const s=await checkout.createStripeCheckoutSession(embedded,f.r);Object.assign(f.accounts.get(user),{verified_at:'verified',stripe_scope:f.r.scope});return {f,s};}
await test('recorded owned resumption is read-only and uses SDK-correct bounded retrieve',async()=>{
 const {f,s}=await owned();const before=JSON.stringify([...f.accounts]);let args;
 const retrieve=f.r.stripe.checkout.sessions.retrieve;f.r.stripe.checkout.sessions.retrieve=(...a)=>{args=a;return retrieve(...a);};
 const result=await checkout.readOwnedCheckoutSession(user,s.id,f.r);assert.equal(result.client_secret,s.client_secret);assert.equal(args[1],undefined);assert.equal(args[2].timeout,8000);assert.equal(args[2].maxNetworkRetries,0);
 assert.equal(JSON.stringify([...f.accounts]),before);assert.equal(f.createdSessions,1);
});
await test('foreign owner, customer, namespace, attempt, mode and unrecorded Sessions fail closed',async()=>{
 for(const mutate of [s=>s.customer='cus_foreign',s=>s.client_reference_id='foreign',s=>s.metadata.dmi_user_id='foreign',s=>s.metadata.dmi_app='other',s=>s.metadata.dmi_checkout_attempt='other',s=>s.livemode=true,s=>s.mode='payment',s=>s.ui_mode='hosted_page']){
  const {f,s}=await owned();mutate(f.sessions.get(s.id));await assert.rejects(checkout.readOwnedCheckoutSession(user,s.id,f.r),/IDENTITY_CONFLICT/);
 }
 const {f}=await owned();await assert.rejects(checkout.readOwnedCheckoutSession(user,'cs_test_foreign',f.r),/IDENTITY_CONFLICT/);await assert.rejects(checkout.readOwnedCheckoutSession('foreign','cs_1',f.r),/IDENTITY_CONFLICT/);
});
await test('revoked approval prevents client-secret resumption; malformed IDs fail before storage',async()=>{
 const {f,s}=await owned();f.prices[0].checkout_enabled=false;await assert.rejects(checkout.readOwnedCheckoutSession(user,s.id,f.r),/UNKNOWN_CHECKOUT_PRICE/);
 await assert.rejects(checkout.readOwnedCheckoutSession(user,'../invalid',{get db(){throw Error('must not access');}}),/INVALID_CHECKOUT/);
});
const session={id:'cs_test_owned',status:'open',ui_mode:'embedded_page',client_secret:'cs_test_owned_secret_private',metadata:{billing_interval:'monthly',private:'must-not-return'},customer:'cus_private'};
function apiFixture({auth=true,enabled=true,actualScope=constants.BILLING_WORK_SCOPE,actualLive=false}={}){
 const calls=[];const environment={...env,...(!enabled?{BILLING_EMBEDDED_CHECKOUT_ENABLED:undefined}:{})};
 const cfg=load('src/lib/stripe/embedded-checkout-config.ts',{'server-only':{},'./billing-work-config':constants},{process:{env:environment}});
 const route=load('src/app/api/v1/billing/checkout/embedded/route.ts',{
  '@/lib/stripe/client-identity':{async requireBillingIdentity(){calls.push('auth');if(!auth)throw new ApiRouteError(401,'UNAUTHENTICATED','private');return {userId:user,email:null};}},
  '@/lib/checkout-startup-timing':startup,
  '@/lib/api/responses':responses,'@/lib/stripe/embedded-checkout-config':cfg,'@/lib/stripe/embedded-checkout-response':dto,'@/lib/stripe/billing-state':billingState,'@/lib/stripe/billing-work-config':constants,
  '@/lib/stripe/reliability':{async billingRuntime(){calls.push('runtime');return {scope:actualScope,live:actualLive};}},
  '@/lib/stripe/checkout':{async createStripeCheckoutSession(i){calls.push(i);return session;},async readOwnedCheckoutSession(...args){calls.push(args);return session;}},
 });return {route,calls};
}
function request(body={interval:'monthly'},query='',method='POST'){return new Request('https://staging.dmicards.com/api/v1/billing/checkout/embedded'+query,{method,...(method==='POST'?{body:JSON.stringify(body)}:{})});}
await test('authentication occurs first and OFF denies creation before runtime',async()=>{
 for(const options of [{auth:false},{enabled:false}]){
  const {route,calls}=apiFixture(options);assert.equal((await route.POST(request())).status,options.auth===false?401:403);assert.equal(calls.join(','),'auth');
 }
});
await test('availability read authenticates without Stripe or billing-runtime calls',async()=>{
 const {route,calls}=apiFixture({enabled:false});const response=await route.GET(request(null,'','GET'));assert.equal((await response.json()).data.available,false);assert.equal(calls.join(','),'auth');
});
await test('API selects approved server price, never browser customer/price; response is private/no-store',async()=>{
 const {route,calls}=apiFixture();const response=await route.POST(request({interval:'annual'}));assert.equal(response.status,200);assert.equal(calls[0],'auth');assert.equal(calls[2].priceId,'price_annual');assert.equal(calls[2].userId,user);assert.equal(calls[2].presentation,'embedded');
 assert.match(response.headers.get('cache-control'),/private, no-store/);assert.equal(response.headers.get('referrer-policy'),'no-referrer');
 const text=await response.text();assert.ok(text.includes(session.client_secret));for(const unsafe of ['cus_private','must-not-return','metadata'])assert.ok(!text.includes(unsafe));
});
await test('arbitrary prices/customers, malformed bodies, extra/duplicate query and hostile Origin reject before runtime',async()=>{
 for(const body of [{interval:'monthly',priceId:'arbitrary'},{interval:'monthly',customer:'arbitrary'},{interval:'weekly'},null,[],{}]){
  const {route,calls}=apiFixture();assert.equal((await route.POST(request(body))).status,400);assert.equal(calls.length,1);
 }
 for(const query of ['?x=1','?session_id=cs_test_owned&session_id=cs_test_owned','?session_id=bad']){
  const {route,calls}=apiFixture();assert.equal((await route.GET(request(null,query,'GET'))).status,400);assert.equal(calls.length,1);
 }
 const {route,calls}=apiFixture();const req=request();req.headers.set('origin','https://foreign.example');assert.equal((await route.POST(req)).status,400);assert.equal(calls.length,1);
});
await test('actual runtime account/mode mismatch fails before checkout creation',async()=>{
 for(const options of [{actualScope:'foreign:test'},{actualLive:true}]){const {route,calls}=apiFixture(options);assert.equal((await route.POST(request())).status,403);assert.equal(calls.length,2);}
});
await test('flag rollback permits authenticated owned resumption without new creation',async()=>{
 const {route,calls}=apiFixture({enabled:false});assert.equal((await route.GET(request(null,'?session_id=cs_test_owned','GET'))).status,200);assert.equal(calls[2][0],user);assert.equal(calls[2][1],session.id);
});
await test('narrow DTO handles hosted, embedded, paid, unpaid and expired without provider objects',()=>{
 assert.equal(dto.embeddedCheckoutResponse(session,'pk_test_fixture').kind,'embedded');
 assert.equal(dto.embeddedCheckoutResponse({...session,ui_mode:undefined,url:'https://checkout.stripe.test/owned'},'pk_test_fixture').kind,'hosted');
 for(const [status,payment_status,kind] of [['complete','paid','complete'],['complete','unpaid','processing'],['expired','unpaid','expired']])assert.equal(dto.embeddedCheckoutResponse({...session,status,payment_status},'pk_test_fixture').kind,kind);
 assert.throws(()=>dto.embeddedCheckoutResponse({...session,status:'invalid'},'pk_test_fixture'));
});
await test('client rejects malformed/secret-bearing URLs and completion goes only to authoritative activation',()=>{
 assert.equal(client.activationReturnUrl(session.id),'/client/billing/activating?session_id=cs_test_owned');
 for(const query of ['?session_id=cs_test_owned&interval=monthly','?interval=monthly&interval=annual','?client_secret=private','?interval=weekly'])assert.throws(()=>client.paymentPageInput(query));
 assert.throws(()=>client.paymentCheckout({kind:'embedded',sessionId:session.id,interval:'monthly',clientSecret:'foreign_secret',publishableKey:'pk_test_fixture'}));
 assert.ok(!client.activationReturnUrl(session.id).includes('secret'));assert.equal(client.paymentCheckout(dto.embeddedCheckoutResponse(session,'pk_test_fixture')).kind,'embedded');
});

// Exercise the real React components with hook/DOM/SDK boundaries mocked.
const jsx={jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props}),Fragment:'fragment'};
const flush=async()=>{for(let i=0;i<12;i++)await new Promise(setImmediate);};
function hooks(){let index=0;const slots=[],effects=[];const react={useState(initial){const i=index++;slots[i]??={value:typeof initial==='function'?initial():initial};return [slots[i].value,v=>{slots[i].value=typeof v==='function'?v(slots[i].value):v;}];},useRef(initial){const i=index++;slots[i]??={current:initial};return slots[i];},useEffect(fn){effects.push(fn);},useMemo:fn=>fn(),useId:()=>String(index++)};return {react,slots,effects,reset(){index=0;effects.length=0;}};}
function nodes(tree){if(!tree||typeof tree!=='object')return [];return [tree,...[tree.props?.children].flat(Infinity).flatMap(nodes)];}
function pageFixture({available=true,query='?interval=annual',authenticated=true,result=dto.embeddedCheckoutResponse(session,'pk_test_fixture'),earlyPublishableKey='pk_test_fixture',postGate=Promise.resolve(),stripeGate=Promise.resolve(),rejectLoad=false,timing=startup}={}){
 const h=hooks(),requests=[],navigation=[],history=[];let authCallback;const identity=authenticated?{user:{id:user},access_token:'offline-token'}:null;
 const loaderCalls=[];const stripeLoaderModule=load('src/lib/embedded-stripe-loader.ts',{'@/lib/checkout-startup-timing':timing,'@stripe/stripe-js/pure':{async loadStripe(key){loaderCalls.push(key);await stripeGate;if(rejectLoad)throw Error('private');return {fixtureStripe:true};}}});
 const page=load('src/app/client/billing/pay/PaymentClient.tsx',{'react':h.react,'react/jsx-runtime':jsx,'next/image':{default:'img'},'next/link':{default:'a'},'lucide-react':{Check:'check',LockKeyhole:'lock'},'@/components/EmbeddedPayment':{default:'embedded'},'@/lib/embedded-stripe-loader':stripeLoaderModule,'@/lib/checkout-startup-timing':timing,'@/lib/embedded-checkout-client':client,'@/lib/supabase':{supabase:{auth:{async getSession(){return {data:{session:identity}};},onAuthStateChange(fn){authCallback=fn;return {data:{subscription:{unsubscribe(){}}}};}}}}},
 {window:{location:{search:query,assign:url=>navigation.push(url)},history:{replaceState:(_a,_b,url)=>history.push(url)}},fetch:async(url,init)=>{requests.push([url,init]);await postGate;return {ok:available,json:async()=>({data:result})};}}).default;
 const render=()=>{h.reset();return page({earlyPublishableKey});};render();const effect=h.effects[0];return {...h,requests,navigation,history,loaderCalls,render,effect,changeIdentity(){authCallback('SIGNED_OUT',null);}};
}
await test('payment page rejected POST and unauthenticated paths never mount a Session',async()=>{
 for(const opts of [{available:false},{authenticated:false}]){const f=pageFixture(opts);f.effect();await flush();assert.equal(f.requests.length,opts.authenticated===false?0:1);assert.equal(f.navigation.length,0);assert.ok(!nodes(f.render()).some(n=>n.type==='embedded'));}
});
await test('authenticated page creates once across Strict Mode probe, sends only interval and stores only Session ID',async()=>{
 const f=pageFixture();const cleanup=f.effect();cleanup();f.effect();await flush();
 const posts=f.requests.filter(([,i])=>i.method==='POST');assert.equal(posts.length,1);assert.equal(posts[0][1].body,'{"interval":"annual"}');
 for(const [,init] of f.requests){assert.equal(init.headers.Authorization,'Bearer offline-token');assert.equal(init.cache,'no-store');assert.equal(init.referrerPolicy,'no-referrer');}
 assert.equal(f.history[0],'/client/billing/pay?session_id=cs_test_owned');assert.ok(!JSON.stringify(f.history).includes('secret'));assert.ok(nodes(f.render()).some(n=>n.type==='embedded'));
 f.changeIdentity();assert.ok(!nodes(f.render()).some(n=>n.type==='embedded'));
});
await test('refresh resumes with GET; paid completion redirects to activation, never grants Pro',async()=>{
 const f=pageFixture({query:'?session_id=cs_test_owned',result:{kind:'complete',sessionId:session.id,interval:'monthly'}});f.effect();await flush();assert.equal(f.requests.length,1);assert.equal(f.requests[0][1].method,undefined);assert.deepEqual(f.navigation,['/client/billing/activating?session_id=cs_test_owned']);
});
await test('unmounted page ignores late results and does not navigate',async()=>{
 const f=pageFixture({result:{kind:'complete',sessionId:session.id,interval:'monthly'}});f.effect()();await flush();assert.equal(f.navigation.length,0);assert.equal(f.history.length,0);
});
function paymentFixture({reject=false,delayed=false,startupDiagnostics=false,timing=startup,stripeLoader}={}){
 const h=hooks(),navigation=[],calls=[];let complete,release,analytics;
 const gate=delayed?new Promise(resolve=>release=resolve):Promise.resolve();
 const stripeLoaderModule=load('src/lib/embedded-stripe-loader.ts',{'@/lib/checkout-startup-timing':timing,'@stripe/stripe-js/pure':{loadStripe(){calls.push('load');return Promise.resolve(sdk);}}});
 const sdk={async createEmbeddedCheckoutPage(options){calls.push('create');complete=options.onComplete;analytics=options.onAnalyticsEvent;await gate;if(reject)throw new Error('private provider exception');return {mount:()=>calls.push('mount'),destroy:()=>calls.push('destroy')};}};
 const payment=load('src/components/EmbeddedPayment.tsx',{'react':h.react,'react/jsx-runtime':jsx,'@/lib/checkout-startup-timing':timing,'@/lib/embedded-checkout-client':client,'@/lib/embedded-stripe-loader':stripeLoaderModule},{window:{location:{assign:url=>navigation.push(url)}}}).default;
 payment({sessionId:session.id,clientSecret:session.client_secret,publishableKey:'pk_test_fixture',startupDiagnostics,stripeLoader});h.slots[0].current={};
 return {...h,calls,navigation,effect:h.effects[0],complete:()=>complete(),analytics:()=>analytics,release:()=>release?.()};
}
await test('Stripe iframe mount/completion has no authority or recovery side effect',async()=>{
 const f=paymentFixture();const cleanup=f.effect();await flush();assert.deepEqual(f.calls,['load','create','mount']);f.complete();assert.deepEqual(f.navigation,['/client/billing/activating?session_id=cs_test_owned']);cleanup();assert.equal(f.calls.at(-1),'destroy');
});
await test('unmount during SDK initialization destroys late instance and suppresses late completion',async()=>{
 const f=paymentFixture({delayed:true});const cleanup=f.effect();await flush();cleanup();f.release();await flush();f.complete();assert.ok(!f.calls.includes('mount'));assert.equal(f.calls.at(-1),'destroy');assert.equal(f.navigation.length,0);
});
await test('SDK exception is caught into fixed safe UI state without logging provider data',async()=>{
 const f=paymentFixture({reject:true});f.effect();await flush();assert.equal(f.slots[3].value,'error');assert.equal(f.navigation.length,0);
});
await test('upgrade entry OFF preserves hosted POST and ON navigates without creating a Session',async()=>{
 for(const available of [false,true]){
  const h=hooks(),requests=[],navigation=[];
  const modal=load('src/components/UpgradeToProModal.tsx',{'react':h.react,'react/jsx-runtime':jsx,'lucide-react':{},'@/components/UpgradeToProModal.module.css':{default:{}},'@/lib/supabase':{supabase:{auth:{async getSession(){return {data:{session:{access_token:'offline-token'}}};}}}}},
   {window:{location:{assign:url=>navigation.push(url)}},fetch:async(url,init)=>{requests.push([url,init]);return {ok:true,json:async()=>url.endsWith('/embedded')?{data:{available}}:{url:'https://checkout.stripe.test/hosted'}};}}).default;
  const tree=modal({open:true,onClose(){}});const cta=nodes(tree).find(n=>n.type==='button'&&String(n.props.children).startsWith('Continue with Pro'));
  assert.ok(cta);await cta.props.onClick();
  assert.equal(requests.length,available?1:2);assert.equal(navigation[0],available?'/client/billing/pay?interval=monthly':'https://checkout.stripe.test/hosted');
  if(!available){assert.equal(requests[1][0],'/api/stripe/checkout');assert.equal(requests[1][1].body,'{"interval":"monthly"}');}
 }
});
await test('both hosted APIs resume embedded attempts by owned page URL without leaking secret',async()=>{
 for(const file of ['src/app/api/stripe/checkout/route.ts','src/app/api/v1/billing/checkout/route.ts']){
  const calls=[];const identity={async requireBillingIdentity(){return {userId:user,profileId:user,email:null};}};
  const route=load(file,{'next/server':{NextResponse:Response},'@/lib/client-auth':{ClientAuthRequiredError:class extends Error{}},'@/lib/stripe/client-identity':identity,'@/lib/api/responses':responses,'@/lib/stripe/billing-state':{...billingState,isCheckoutBillingPlan:v=>v==='pro'},'@/lib/stripe/checkout':{async createStripeCheckoutSession(i){calls.push(i);return session;}}});
  const req=new Request('https://staging.dmicards.com/api/checkout',{method:'POST',headers:{authorization:'Bearer offline-token'},body:JSON.stringify(file.includes('/v1/')?{plan:'pro',billing_interval:'monthly'}:{interval:'monthly'})});
  const response=await route.POST(req);assert.equal(response.status,200);const text=await response.text();assert.ok(text.includes('/client/billing/pay?session_id=cs_test_owned'));assert.ok(!text.includes('secret'));assert.equal(calls.length,1);assert.equal(calls[0].presentation,undefined);
 }
});
await test('expired and unpaid Sessions do not mount payment or navigate into Pro',async()=>{
 for(const kind of ['expired','processing']){const f=pageFixture({query:'?session_id=cs_test_owned',result:{kind,sessionId:session.id,interval:'monthly'}});f.effect();await flush();assert.equal(f.navigation.length,0);assert.ok(!nodes(f.render()).some(n=>n.type==='embedded'));assert.equal(f.requests.length,1);}
});
await test('Strict Mode initialization is serialized; disposed probe never mounts a second iframe',async()=>{
 const f=paymentFixture({delayed:true});const cleanup=f.effect();await flush();cleanup();f.effect();await flush();assert.equal(f.calls.filter(c=>c==='create').length,1);f.release();await flush();assert.equal(f.calls.filter(c=>c==='create').length,2);assert.equal(f.calls.filter(c=>c==='mount').length,1);assert.equal(f.calls.filter(c=>c==='destroy').length,1);
});
await test('exact presentation diff contract still rejects arbitrary edits in every reviewed file',()=>{
 assertEmbeddedCheckoutFiles();for(const target of embeddedCheckoutReviewedPaths)assert.throws(()=>assertEmbeddedCheckoutFiles((file,encoding)=>fs.readFileSync(file,encoding)+(file===target?'\n// unrelated\n':'')),/Unexpected checkout change/);
});
console.log(`Embedded checkout: ${count}/${count} passed (offline).`);
export {load,startup,apiFixture,request,pageFixture,paymentFixture,flush,nodes,fixture,checkout,embedded,input,session,client};
