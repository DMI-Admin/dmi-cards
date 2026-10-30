// Offline only: no credentials, provider client or network requests.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=fs.readFileSync('src/lib/stripe/simple-billing.ts','utf8');
class BillingConfigurationError extends Error {}
const loaded={exports:{}};
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
vm.runInNewContext(js,{module:loaded,exports:loaded.exports,require:()=>({BillingConfigurationError}),console,Date,Set,Error,process:{env:{}}});
const {billingService,BillingUnavailable}=loaded.exports;
const user='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const metadata={dmi_app:'dmi_cards',dmi_user_id:user};
let rows=new Map(),calls=[],sub,session,open=[],inventory=[],configs,invoice,customerRecord,knownAccount;
function reset(price='price_month',status='active'){
 rows=new Map();calls=[];open=[];inventory=[];knownAccount=true;customerRecord={id:'cus_fixture',livemode:false,metadata:{...metadata}};
 sub={id:'sub_fixture',customer:'cus_fixture',livemode:false,metadata:{...metadata},status,cancel_at_period_end:false,items:{has_more:false,data:[{price:{id:price,product:'prod_pro'},quantity:1,current_period_end:1800000000}]}};
 session={id:'cs_fixture',customer:'cus_fixture',subscription:sub.id,livemode:false,mode:'subscription',ui_mode:'embedded_page',metadata:{...metadata,billing_interval:price==='price_year'?'annual':'monthly'},client_reference_id:user,status:'complete',payment_status:'paid',client_secret:'synthetic-secret'};
 configs=[{id:'bpc_fixture',features:{subscription_update:{enabled:true,default_allowed_updates:['price'],products:[{prices:['price_month','price_year']}]},payment_method_update:{enabled:true},subscription_cancel:{enabled:true,mode:'at_period_end'}}}];
 invoice={id:'in_fixture',parent:{subscription_details:{subscription:sub.id}}};
}
const stripe={
 customers:{retrieve:async()=>structuredClone(customerRecord),create:async(p,o)=>{calls.push(['customer',p,o]);return{id:'cus_fixture'};}},
 subscriptions:{retrieve:async id=>{calls.push(['retrieve',id]);return structuredClone(sub);},list:async()=>({data:inventory,has_more:false})},
 checkout:{sessions:{expire:async id=>{calls.push(['expire',id]);return{...session,status:'expired'};},list:async()=>({data:open,has_more:false}),create:async(p,o)=>{calls.push(['checkout',p,o]);return{...session,status:'open'};},retrieve:async()=>structuredClone(session)}},
 billingPortal:{configurations:{list:async()=>({data:configs})},sessions:{create:async p=>{calls.push(['portal',p]);return{url:'https://billing.stripe.com/synthetic'};}}},
 invoices:{retrieve:async()=>invoice},
};
const store={hasAccount:async()=>knownAccount,read:async id=>rows.get(id)||null,save:async row=>{calls.push(['save']);rows.set(row.account_id,structuredClone(row));},bind:async(id,customer)=>{rows.set(id,{...(rows.get(id)||{account_id:id,plan:'free'}),stripe_customer_id:customer});}};
const service=()=>billingService(stripe,store,{monthly:'price_month',annual:'price_year',enterpriseProduct:'prod_enterprise'},'https://staging.example.invalid',false);
let passed=0;
async function test(name,fn){reset();await fn();console.log('PASS '+name);passed++;}
await test('new Free account has no paid billing row',async()=>assert.equal(await store.read(user),null));
for(const [interval,price]of [['monthly','price_month'],['annual','price_year']]){
 await test('Pro '+interval+' checkout accepts only the configured price',async()=>{const result=await service().checkout(user,interval,other);assert.equal(result.clientSecret,'synthetic-secret');const [,p,o]=calls.find(c=>c[0]==='checkout');assert.equal(p.line_items[0].price,price);assert.equal(p.subscription_data.metadata.dmi_user_id,user);assert.equal(p.ui_mode,'embedded_page');assert.ok(o.idempotencyKey.includes(other));});
 await test('Pro '+interval+' shared sync',async()=>{sub.items.data[0].price.id=price;assert.equal((await service().syncSubscriptionFromStripe(sub.id)).plan,'pro');});
}
await test('deleted Customer does not prevent canceling access',async()=>{await service().syncSubscriptionFromStripe(sub.id);sub.status='canceled';const original=stripe.customers.retrieve;stripe.customers.retrieve=async()=>({id:'cus_fixture',deleted:true});try{assert.equal((await service().syncSubscriptionFromStripe(sub.id)).plan,'free');}finally{stripe.customers.retrieve=original;}});
await test('deleted Customer cannot receive a paid grant',async()=>{const original=stripe.customers.retrieve;stripe.customers.retrieve=async()=>({id:'cus_fixture',deleted:true});try{await assert.rejects(service().syncSubscriptionFromStripe(sub.id));assert.equal(rows.size,0);}finally{stripe.customers.retrieve=original;}});
await test('lost return response can be repeated without duplicate rows or Sessions',async()=>{await service().complete(user,session.id);await service().complete(user,session.id);assert.equal(rows.size,1);assert.ok(!calls.some(c=>c[0]==='checkout'));});
await test('database failure never reports activation success',async()=>{const original=store.save;store.save=async()=>{throw new BillingUnavailable();};try{await assert.rejects(service().complete(user,session.id));assert.equal(rows.size,0);}finally{store.save=original;}});
await test('checkout return commits Pro before reporting success',async()=>{assert.equal((await service().complete(user,session.id)).plan,'pro');assert.equal(rows.get(user).plan,'pro');});
await test('return cannot sync another authenticated account',async()=>{await assert.rejects(service().complete(other,session.id));assert.equal(rows.size,0);});
await test('incomplete or unpaid checkout never grants Pro',async()=>{session.payment_status='unpaid';await assert.rejects(service().complete(user,session.id));assert.equal(rows.size,0);});
await test('duplicate webhook has one business row',async()=>{const e={type:'customer.subscription.created',livemode:false,data:{object:{id:sub.id,metadata:{...metadata}}}};await service().webhook(e);await service().webhook(e);assert.equal(rows.size,1);});
await test('out-of-order payload loses to current fetched Stripe truth',async()=>{sub.status='canceled';await service().webhook({type:'customer.subscription.updated',livemode:false,data:{object:{id:sub.id,metadata:{...metadata},status:'active'}}});assert.equal(rows.get(user).plan,'free');});
await test('delayed canceled old Subscription cannot overwrite current Pro',async()=>{await service().syncSubscriptionFromStripe(sub.id);sub.status='canceled';const original=stripe.subscriptions.retrieve;const current={...sub,id:'sub_current',status:'active'};rows.get(user).stripe_subscription_id=current.id;stripe.subscriptions.retrieve=async id=>structuredClone(id===current.id?current:sub);try{const r=await service().syncSubscriptionFromStripe(sub.id);assert.equal(r.plan,'pro');assert.equal(r.stripe_subscription_id,current.id);}finally{stripe.subscriptions.retrieve=original;}});
await test('monthly to annual and annual to monthly use same sync',async()=>{await service().syncSubscriptionFromStripe(sub.id);sub.items.data[0].price.id='price_year';await service().syncSubscriptionFromStripe(sub.id);sub.items.data[0].price.id='price_month';assert.equal((await service().syncSubscriptionFromStripe(sub.id)).plan,'pro');assert.equal(rows.size,1);});
await test('cancel at period end retains Pro and its date',async()=>{sub.cancel_at_period_end=true;const r=await service().syncSubscriptionFromStripe(sub.id);assert.equal(r.plan,'pro');assert.equal(r.cancel_at_period_end,true);assert.ok(r.current_period_end);});
for(const [status,plan]of [['canceled','free'],['unpaid','free'],['past_due','pro'],['trialing','pro'],['incomplete','free'],['incomplete_expired','free'],['paused','free'],['future_status','free']])await test(status+' policy',async()=>{sub.status=status;assert.equal((await service().syncSubscriptionFromStripe(sub.id)).plan,plan);});
await test('Enterprise manual fixture uses existing entitlement plan and quantity',async()=>{sub.items.data[0].price={id:'price_any_enterprise',product:'prod_enterprise'};sub.items.data[0].quantity=25;const row=await service().syncSubscriptionFromStripe(sub.id);assert.equal(row.plan,'enterprise');assert.equal(row.seat_quantity,25);});
await test('Enterprise has no self-service checkout input',async()=>await assert.rejects(service().checkout(user,'enterprise',other)));
await test('portal rejects another or unknown account',async()=>{await assert.rejects(service().portal(other));assert.ok(!calls.some(c=>c[0]==='portal'));});
await test('Enterprise cannot enter self-service portal',async()=>{sub.items.data[0].price={id:'price_any_enterprise',product:'prod_enterprise'};await service().syncSubscriptionFromStripe(sub.id);await assert.rejects(service().portal(user));});
await test('Pro-only Portal configuration required',async()=>{await service().syncSubscriptionFromStripe(sub.id);await service().portal(user);configs[0].features.subscription_update.products[0].prices.push('price_enterprise');await assert.rejects(service().portal(user));});
await test('wrong mode, irrelevant events perform zero writes',async()=>{await assert.rejects(service().webhook({type:'customer.subscription.updated',livemode:true,data:{object:{id:sub.id,metadata:{...metadata}}}}));await service().webhook({type:'charge.succeeded',livemode:false,data:{object:{id:'ch_fixture'}}});assert.equal(calls.length,0);});
await test('invoice.payment_failed directly resolves or retrieves its Subscription',async()=>{sub.status='past_due';await service().webhook({type:'invoice.payment_failed',livemode:false,data:{object:{id:invoice.id}}});assert.equal(rows.get(user).plan,'pro');});
await test('changing an unpaid checkout interval expires the old Session first',async()=>{open=[{...session,status:'open'}];await service().checkout(user,'annual',other);assert.ok(calls.findIndex(c=>c[0]==='expire')<calls.findIndex(c=>c[0]==='checkout'));assert.equal(calls.find(c=>c[0]==='checkout')[1].line_items[0].price,'price_year');});
await test('unmapped subscriptions cannot enter the self-service Portal',async()=>{sub.items.data[0].price.id='price_unknown';await service().syncSubscriptionFromStripe(sub.id);await assert.rejects(service().portal(user));});
await test('open embedded session resumes without creation',async()=>{open=[{...session,status:'open'}];await service().checkout(user,'monthly',other);assert.ok(!calls.some(c=>c[0]==='checkout'));});
await test('existing subscription blocks duplicate purchase',async()=>{inventory=[sub];await assert.rejects(service().checkout(user,'monthly',other));assert.ok(!calls.some(c=>c[0]==='checkout'));});
await test('unknown prices fail closed',async()=>{sub.items.data[0].price.id='price_unknown';assert.equal((await service().syncSubscriptionFromStripe(sub.id)).plan,'free');});
await test('provider failure never reports success or saves invented state',async()=>{const original=stripe.subscriptions.retrieve;stripe.subscriptions.retrieve=async()=>{throw Error('fixture');};await assert.rejects(service().syncSubscriptionFromStripe(sub.id));assert.equal(rows.size,0);stripe.subscriptions.retrieve=original;});
console.log(`Simple billing ${passed}/${passed}`);
// Real installed SDK cryptography, no provider requests.
const {default:Stripe}=await import('stripe');
const sdk=new Stripe('sk_test_offline_fixture'),secret='whsec_offline_fixture';
const modeModule={exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/stripe/webhook-mode-guard.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{module:modeModule,exports:modeModule.exports,require:()=>({}),process:{env:{VERCEL_PROJECT_ID:'prj_FPTsXDokhm5uSDMaxieuo5Cmp0Rn',VERCEL_ENV:'preview',VERCEL_TARGET_ENV:'staging'}}});
const json=(data,init={})=>Response.json(data,init);
let serviceAccess=0;const warnings=[];let makeService=service;
const responseHelpers={apiSuccess:data=>json({data}),apiError:(status,code,message)=>json({error:{code,message}},{status}),apiErrorFromUnknown:error=>json({error:{code:'UNAVAILABLE'}},{status:error.message==='Unauthorized'?401:503})};
function route(file){
 const loaded={exports:{}};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:loaded,exports:loaded.exports,Request,Response,URL,console:{warn:(...args)=>warnings.push(args)},process:{env:{NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY:'pk_test_offline'}},require:name=>{
  if(name==='next/server')return {NextResponse:{json}};
  if(name.endsWith('/config'))return{BillingConfigurationError,constructStripeWebhookEvent:({payload,signature})=>sdk.webhooks.constructEvent(payload,signature,secret)};
  if(name.endsWith('/webhook-mode-guard'))return modeModule.exports;
  if(name.endsWith('/simple-billing'))return{...moduleService,isTransientBillingFailure:error=>moduleService.isTransientBillingFailure(error),simpleBilling:()=>{serviceAccess++;return makeService();}};
  if(name.endsWith('/client-identity'))return{requireBillingIdentity:async r=>{if(r.headers.get('Authorization')!=='Bearer offline')throw Error('Unauthorized');return{userId:user};}};
  return responseHelpers;
 }});return loaded.exports;
}
const moduleService=loaded.exports;
const webhookRoute=route('src/app/api/stripe/webhook/route.ts');
await test('invalid webhook signature is rejected before service/database creation',async()=>{serviceAccess=0;const r=await webhookRoute.POST(new Request('https://fixture.invalid/api/stripe/webhook',{method:'POST',body:'{}',headers:{'stripe-signature':'invalid'}}));assert.equal(r.status,400);assert.equal(serviceAccess,0);});
await test('validly signed wrong-mode event is acknowledged before DB/service access',async()=>{serviceAccess=0;const body=JSON.stringify({id:'evt_fixture',type:'customer.subscription.updated',livemode:true,data:{object:{id:sub.id,metadata:{...metadata}}}});const signature=sdk.webhooks.generateTestHeaderString({payload:body,secret});const r=await webhookRoute.POST(new Request('https://fixture.invalid/api/stripe/webhook',{method:'POST',body,headers:{'stripe-signature':signature}}));assert.equal(r.status,200);assert.equal((await r.json()).reason,'stripe_livemode_mismatch');assert.equal(serviceAccess,0);});
await test('valid signed webhook reaches shared sync',async()=>{const body=JSON.stringify({id:'evt_fixture',type:'customer.subscription.updated',livemode:false,data:{object:{id:sub.id,metadata:{...metadata}}}});const signature=sdk.webhooks.generateTestHeaderString({payload:body,secret});assert.equal((await webhookRoute.POST(new Request('https://fixture.invalid',{method:'POST',body,headers:{'stripe-signature':signature}}))).status,200);assert.equal(rows.get(user).plan,'pro');});
async function signedWebhook(object={id:sub.id,metadata:{...metadata}},live=false){
 const body=JSON.stringify({id:'evt_private_fixture',type:'customer.subscription.updated',livemode:live,data:{object}});
 return webhookRoute.POST(new Request('https://fixture.invalid',{method:'POST',body,headers:{'stripe-signature':sdk.webhooks.generateTestHeaderString({payload:body,secret})}}));
}
async function skipped(object,live=false){
 warnings.length=0;const r=await signedWebhook(object,live);
 assert.equal(r.status,200);assert.equal((await r.json()).handled,false);
 assert.equal(rows.size,0);assert.ok(!calls.some(c=>c[0]==='save'));
 assert.equal(warnings.length,1);
 assert.deepEqual(Object.keys(warnings[0][1]),['reason']);
 assert.match(warnings[0][1].reason,/^(billing_validation_or_ownership|stripe_livemode_mismatch)$/);
 assert.doesNotMatch(JSON.stringify(warnings),/evt_private|sub_fixture|cus_fixture|11111111|sensitive/);
}
for(const [label,meta] of [
 ['missing app',{dmi_user_id:user}],['foreign app',{...metadata,dmi_app:'foreign'}],
 ['missing user',{dmi_app:'dmi_cards'}],['invalid user',{...metadata,dmi_user_id:'invalid'}],
])await test('signed '+label+' metadata: 200/unhandled/no writes/sanitized warning',async()=>skipped({id:sub.id,metadata:meta}));
await test('missing metadata object is acknowledged without writes',async()=>skipped({id:sub.id}));
await test('ownership rejection leaves an existing billing row byte-for-byte unchanged',async()=>{
 await service().syncSubscriptionFromStripe(sub.id);const before=JSON.stringify([...rows]);calls=[];
 customerRecord.metadata.dmi_user_id=other;const r=await signedWebhook();
 assert.equal(r.status,200);assert.equal((await r.json()).handled,false);
 assert.equal(JSON.stringify([...rows]),before);assert.ok(!calls.some(c=>c[0]==='save'));
});
await test('unknown DMI user is acknowledged without writes',async()=>{knownAccount=false;await skipped();});
await test('incoming and current subscription user mismatch is acknowledged',async()=>{sub.metadata.dmi_user_id=other;await skipped();});
await test('current subscription metadata is revalidated before writes',async()=>{sub.metadata={};await skipped();});
await test('foreign Stripe Customer metadata is acknowledged without writes',async()=>{customerRecord.metadata.dmi_app='foreign';await skipped();});
await test('mismatched Customer user is acknowledged without writes',async()=>{customerRecord.metadata.dmi_user_id=other;await skipped();});
await test('unknown Stripe Customer resource is permanent',async()=>{
 const original=stripe.customers.retrieve;stripe.customers.retrieve=async()=>{throw {type:'StripeInvalidRequestError',statusCode:404,code:'resource_missing',message:'sensitive'};};
 try{await skipped();}finally{stripe.customers.retrieve=original;}
});
await test('unrecognized deleted Customer cannot write billing state',async()=>{customerRecord={id:'cus_fixture',deleted:true};sub.status='canceled';await skipped();});
await test('signed wrong livemode is acknowledged without writes',async()=>skipped(undefined,true));
await test('fetched subscription wrong mode is acknowledged without writes',async()=>{sub.livemode=true;await skipped();});
await test('fetched Customer wrong mode is acknowledged without writes',async()=>{customerRecord.livemode=true;await skipped();});
for(const type of ['StripeConnectionError','StripeAPIError','StripeRateLimitError'])await test(type+' returns 503',async()=>{
 const original=stripe.subscriptions.retrieve;stripe.subscriptions.retrieve=async()=>{throw {type,message:'sensitive'};};
 try{assert.equal((await signedWebhook()).status,503);assert.equal(rows.size,0);}finally{stripe.subscriptions.retrieve=original;}
});
await test('transient database failure returns 503',async()=>{
 const original=store.save;store.save=async()=>{throw new BillingUnavailable();};
 try{assert.equal((await signedWebhook()).status,503);assert.equal(rows.size,0);}finally{store.save=original;}
});
await test('transient account lookup failure returns 503',async()=>{
 const original=store.hasAccount;store.hasAccount=async()=>{throw new BillingUnavailable();};
 try{assert.equal((await signedWebhook()).status,503);assert.equal(rows.size,0);}finally{store.hasAccount=original;}
});
await test('invalid quantity is permanent and cannot write',async()=>{sub.items.data[0].quantity=0;await skipped();});
await test('arbitrary and expanded Prices under Enterprise Product map Enterprise seats',async()=>{
 for(const [id,product] of [['price_custom_one','prod_enterprise'],['price_custom_two',{id:'prod_enterprise'}]]){
  sub.items.data[0].price={id,product};sub.items.data[0].quantity=42;
  const row=await service().syncSubscriptionFromStripe(sub.id);assert.equal(row.plan,'enterprise');assert.equal(row.seat_quantity,42);
 }
});
await test('unrelated Product never maps Enterprise regardless of Price label',async()=>{
 sub.items.data[0].price={id:'price_enterprise',product:'prod_other'};assert.equal((await service().syncSubscriptionFromStripe(sub.id)).plan,'free');
});
await test('Enterprise subscription is blocked by provider inventory before self-service checkout',async()=>{
 sub.items.data[0].price={id:'price_custom','product':'prod_enterprise'};inventory=[sub];
 await assert.rejects(service().checkout(user,'monthly',other));assert.ok(!calls.some(c=>c[0]==='checkout'));
});
// Exercise the real default storage/auth adapter, including SQLSTATE/HTTP error classification.
function adapterService({authError=null,readError=null,writeError=null,status=200,env={}}={}){
 const db={auth:{admin:{getUserById:async()=>({data:{user:authError?null:{id:user}},error:authError})}},from:()=>({
  select:()=>({eq:()=>({maybeSingle:async()=>({data:null,error:readError,status})})}),
  upsert:async()=>({error:writeError,status}),
 })};
 const adapter={exports:{}};
 vm.runInNewContext(js,{module:adapter,exports:adapter.exports,require:name=>{
  if(name.endsWith('/supabase-admin'))return{createSupabaseAdminClient:()=>db};
  if(name==='./config')return{getStripeServerClient:()=>stripe,BillingConfigurationError};return{};
 },Date,Set,Error,console,process:{env:{VERCEL_ENV:'preview',VERCEL_TARGET_ENV:'staging',VERCEL_PROJECT_ID:'prj_FPTsXDokhm5uSDMaxieuo5Cmp0Rn',NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY:'pk_test_fixture',STRIPE_SECRET_KEY:'sk_test_fixture',STRIPE_PRICE_PRO_MONTHLY:'price_month',STRIPE_PRICE_PRO_ANNUAL:'price_year',STRIPE_PRODUCT_ENTERPRISE:'prod_enterprise',...env}}});
 // Return the corresponding classifier too: error classes belong to this VM module.
 return {create:()=>adapter.exports.simpleBilling(),classify:adapter.exports.isTransientBillingFailure};
}
for(const [label,options,expected] of [
 ['unknown user',{authError:{status:404}},200],
 ['missing monthly price',{env:{STRIPE_PRICE_PRO_MONTHLY:undefined}},503],
 ['missing annual price',{env:{STRIPE_PRICE_PRO_ANNUAL:undefined}},503],
 ['invalid price syntax',{env:{STRIPE_PRICE_PRO_MONTHLY:'not-a-price'}},503],
 ['identical Pro prices',{env:{STRIPE_PRICE_PRO_ANNUAL:'price_month'}},503],
 ['missing publishable key',{env:{NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY:undefined}},503],
 ['wrong publishable mode',{env:{NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY:'pk_live_fixture'}},503],
 ['invalid secret key',{env:{STRIPE_SECRET_KEY:'invalid'}},503],
 ['missing secret key',{env:{STRIPE_SECRET_KEY:undefined}},503],
 ['wrong secret key mode',{env:{STRIPE_SECRET_KEY:'sk_live_fixture'}},503],
 ['wrong project',{env:{VERCEL_PROJECT_ID:'other'}},503],
 ['wrong environment',{env:{VERCEL_TARGET_ENV:'preview'}},503],
 ['auth rate limit',{authError:{status:429}},503],
 ['auth unavailable',{authError:{status:503}},503],
 ['database connection',{readError:{code:'08006'},status:503},503],
 ['database transport',{readError:{code:''},status:0},503],
 ['database HTTP unavailable',{readError:{code:'unexpected_failure'},status:503},503],
 ['database write timeout',{writeError:{code:'57014'},status:500},503],
 ['database FK rejection',{writeError:{code:'23503'},status:409},200],
 ['database binding conflict',{writeError:{code:'23505'},status:409},200],
 ['database permission configuration',{readError:{code:'42501'},status:403},503],
 ['missing migration configuration',{readError:{code:'42P01'},status:404},503],
])await test('real adapter '+label+' returns '+expected,async()=>{
 const adapter=adapterService(options),original=moduleService.isTransientBillingFailure;
 makeService=adapter.create;moduleService.isTransientBillingFailure=adapter.classify;
 try{const r=await signedWebhook();assert.equal(r.status,expected);if(expected===200)assert.equal((await r.json()).handled,false);assert.equal(rows.size,0);}
 finally{makeService=service;moduleService.isTransientBillingFailure=original;}
});
await test('untrusted runtime returns 503 before service/database access with sanitized warning',async()=>{
 const original=modeModule.exports.stripeWebhookModeDecision;serviceAccess=0;warnings.length=0;
 modeModule.exports.stripeWebhookModeDecision=mode=>original(mode,{});
 try{assert.equal((await signedWebhook()).status,503);assert.equal(serviceAccess,0);assert.equal(rows.size,0);assert.equal(warnings[0][1].reason,'billing_configuration');}
 finally{modeModule.exports.stripeWebhookModeDecision=original;}
});
for(const type of ['StripeAuthenticationError','StripePermissionError'])await test(type+' is retryable configuration, not a permanent event rejection',async()=>{
 const original=stripe.subscriptions.retrieve;stripe.subscriptions.retrieve=async()=>{throw {type,message:'sensitive'};};warnings.length=0;
 try{assert.equal((await signedWebhook()).status,503);assert.equal(rows.size,0);assert.equal(warnings[0][1].reason,'billing_configuration');}
 finally{stripe.subscriptions.retrieve=original;}
});
await test('missing price config logs only fixed configuration warning and performs no writes',async()=>{
 const adapter=adapterService({env:{STRIPE_PRICE_PRO_MONTHLY:undefined}});makeService=adapter.create;warnings.length=0;
 try{assert.equal((await signedWebhook()).status,503);assert.equal(rows.size,0);assert.equal(JSON.stringify(warnings),'[["[DMI billing] webhook configuration unavailable",{"reason":"billing_configuration"}]]');}
 finally{makeService=service;}
});
// Actual signature/key configuration module, offline SDK only.
await test('missing Stripe/signing keys are configuration errors, not invalid signatures',async()=>{
 const config={exports:{}},env={STRIPE_SECRET_KEY:'sk_test_fixture',STRIPE_WEBHOOK_SECRET:secret};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/stripe/config.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:config,exports:config.exports,require:name=>name==='stripe'?{default:Stripe}:{},process:{env}});
 const payload=JSON.stringify({livemode:false}),signature=sdk.webhooks.generateTestHeaderString({payload,secret});
 assert.ok(config.exports.constructStripeWebhookEvent({payload,signature}));
 for(const key of ['STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET']){
  const value=env[key];delete env[key];
  try{assert.throws(()=>config.exports.constructStripeWebhookEvent({payload,signature}),e=>e instanceof config.exports.BillingConfigurationError);}
  finally{env[key]=value;}
 }
 assert.throws(()=>config.exports.constructStripeWebhookEvent({payload,signature:'invalid'}),e=>!(e instanceof config.exports.BillingConfigurationError));
});
for(const path of ['src/app/api/stripe/portal/route.ts','src/app/api/v1/billing/checkout/embedded/route.ts','src/app/api/v1/billing/complete/route.ts'])await test('authentication precedes provider work: '+path,async()=>{serviceAccess=0;assert.equal((await route(path).POST(new Request('https://fixture.invalid',{method:'POST',body:'{}'}))).status,401);assert.equal(serviceAccess,0);});
await test('checkout API rejects arbitrary price/customer fields before Stripe',async()=>{serviceAccess=0;const r=await route('src/app/api/v1/billing/checkout/embedded/route.ts').POST(new Request('https://fixture.invalid',{method:'POST',headers:{Authorization:'Bearer offline','Content-Type':'application/json'},body:JSON.stringify({interval:'monthly',requestId:other,price:'price_enterprise',customer:'cus_other'})}));assert.equal(r.status,400);assert.equal(serviceAccess,0);});
await test('central client read uses only account_billing for access',async()=>{const s=fs.readFileSync('src/lib/api/client-context.ts','utf8');assert.ok(s.includes('.from("account_billing")'));assert.doesNotMatch(s,/billing_subscriptions|entitlementsForTrustedBillingState/);assert.ok(s.includes('getEntitlementsForPlan(plan)'));});
await test('return is one authenticated sync, never polling or worker calls',async()=>{const s=fs.readFileSync('src/app/client/billing/complete/page.tsx','utf8');assert.doesNotMatch(s,/setTimeout|setInterval|billing-work|localStorage|sessionStorage/);assert.ok(s.includes('/api/v1/billing/complete'));});
console.log(`Simple billing full ${passed}/${passed}`);
