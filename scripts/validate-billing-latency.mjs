// Executes real modules at offline boundaries. No network, credentials or SQL.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {assertBillingLatencyFiles,billingLatencyReviewedPaths} from './billing-latency-contract.mjs';
import {assertAutomaticWorkerFiles} from './billing-work-auto-contract.mjs';
const root='src/lib/stripe/';
function load(file,deps={},globals={}){
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
 {exports,Date,performance,Promise,Response,Request,URL,AbortController,setTimeout,clearTimeout,Error,console,process:{env:{}},...globals,require:name=>{if(name==='server-only')return {};assert.ok(name in deps,'Unexpected dependency '+name);return deps[name];}});return exports;
}
const base=load(root+'billing-work-config.ts');
const environment={VERCEL_ENV:'preview',VERCEL_TARGET_ENV:'staging',VERCEL_PROJECT_ID:base.BILLING_WORK_PROJECT,NEXT_PUBLIC_SUPABASE_URL:base.BILLING_WORK_DATABASE};
const diagnostics=load(root+'billing-latency-diagnostics.ts',{'./billing-work-config':base});
const runner=load(root+'billing-work-auto-runner.ts',{'./billing-work-worker':{WORKER_TOTAL_MS:75000},'./billing-work-auto-config':{AUTOMATIC_FUNCTION_SECONDS:90,AUTOMATIC_RESPONSE_RESERVE_MS:5000,AUTOMATIC_ADMISSION_DEADLINE_MS:240000}});
const config={state:'enabled',scope:base.BILLING_WORK_SCOPE,worker:{target:'staging'}};
const runtime=()=>({deps:{store:{claim:async()=>null}},worker:config.worker});
const plain=x=>JSON.parse(JSON.stringify(x));
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
let count=0;
async function test(name,run){await run();count++;console.log('PASS latency '+name);}
function observer(source='webhook_kick',sink){const records=[];return {records,observe:diagnostics.createBillingLatencyObserver(source,environment,sink||((line)=>records.push(JSON.parse(line))))};}
await test('Production unknown and wrong Staging project/database cannot log',()=>{
 for(const change of [{VERCEL_ENV:'production',VERCEL_TARGET_ENV:'production'},{VERCEL_ENV:undefined},{VERCEL_PROJECT_ID:'foreign'},{NEXT_PUBLIC_SUPABASE_URL:'foreign'},{VERCEL_TARGET_ENV:'preview'}])assert.equal(diagnostics.createBillingLatencyObserver('activation',{...environment,...change},()=>assert.fail('NO_LOG')),undefined);
});
await test('records have only fixed keys/categories and generated UTC timestamps',()=>{
 const f=observer();f.observe({stage:'execution_end',consumer:'entitlement',ordinal:2,outcome:'dependency_wait',category:'routing_unresolved',duration_ms:123.4,remaining_ms:74000,minimum_start_ms:75000,customer:'cus_private',payload:{secret:'private'}});
 assert.equal(f.records.length,1);assert.deepEqual(Object.keys(f.records[0]).sort(),['component','source','stage','at','consumer','ordinal','outcome','category','duration_ms','remaining_ms','minimum_start_ms'].sort());assert.match(f.records[0].at,/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);assert.equal(f.records[0].duration_ms,123);assert.doesNotMatch(JSON.stringify(f.records),/cus_|private|payload|secret/);
});
await test('arbitrary strings invalid numbers and hostile getters never enter diagnostics',()=>{
 const f=observer();for(const field of ['stage','consumer','outcome','reason','category','ordinal','duration_ms','remaining_ms','minimum_start_ms'])f.observe({stage:'runner_start',[field]:'PRIVATE'});
 for(const value of [NaN,Infinity,-1])f.observe({stage:'runner_start',duration_ms:value});
 f.observe({get stage(){throw Error('PRIVATE');}});assert.equal(f.records.length,0);
 assert.equal(diagnostics.createBillingLatencyObserver('PRIVATE',environment),undefined);
});
await test('real console sink writes exactly one JSON line without expanding supplied data',()=>{
 const lines=[],d=load(root+'billing-latency-diagnostics.ts',{'./billing-work-config':base},{console:{info:line=>lines.push(line)}});d.createBillingLatencyObserver('activation',environment)({stage:'activation_end',outcome:'pro_ready',token:'PRIVATE'});assert.equal(lines.length,1);assert.equal(JSON.parse(lines[0]).outcome,'pro_ready');assert.ok(!lines[0].includes('PRIVATE'));
});
await test('diagnostic fields are captured once so changing getters cannot bypass allowlists',()=>{
 let stages=0,ordinals=0;const f=observer();f.observe({get stage(){return ++stages===1?'execution_start':'SECRET';},get ordinal(){return ++ordinals===1?1:'SECRET';}});assert.equal(f.records.length,1);assert.equal(stages,1);assert.equal(ordinals,1);assert.equal(f.records[0].stage,'execution_start');assert.equal(f.records[0].ordinal,1);assert.ok(!JSON.stringify(f.records).includes('SECRET'));
});
await test('all runner stop outcomes preserve aggregate and execution ordering with or without telemetry',async()=>{
 for(const stop of ['disabled','idle','retry_wait','dependency_wait','needs_attention','stopped']){
  const run=async(observe)=>{const calls=[],n={finance:0,entitlement:0};let nowCalls=0;const result=await runner.runAutomaticBillingWork(config,runtime,85000,()=>{nowCalls++;return 0;},async(_d,_s,c,event)=>{calls.push([c,event]);return {state:++n[c]===1?'bound':n[c]===2?'completed':stop,category:'routing_unresolved'};},observe);return {result:plain(result),calls,nowCalls};};
  const f=observer();assert.deepEqual(await run(f.observe),await run());
  for(const consumer of ['finance','entitlement']){
   const ends=f.records.filter(r=>r.stage==='execution_end'&&r.consumer===consumer);assert.deepEqual(ends.map(r=>r.outcome),['bound','completed',stop]);assert.deepEqual(ends.map(r=>r.ordinal),[1,2,3]);
   const exit=f.records.find(r=>r.stage==='lane_stop'&&r.consumer===consumer);assert.equal(exit.reason,'outcome_stop');assert.equal(exit.outcome,stop);
  }
 }
});
await test('initial insufficient 75-second headroom skip is observable without constructing runtime',async()=>{
 const f=observer();const r=await runner.runAutomaticBillingWork(config,()=>assert.fail('NO_RUNTIME'),74999,()=>0,()=>assert.fail('NO_EXECUTION'),f.observe);assert.equal(r.executions,0);const skip=f.records.find(r=>r.stage==='runner_skip');assert.equal(skip.reason,'insufficient_headroom');assert.equal(skip.remaining_ms,74999);assert.equal(skip.minimum_start_ms,75000);
});
await test('later headroom decision skips further executions without changing thresholds',async()=>{
 let time=0;const f=observer();const r=await runner.runAutomaticBillingWork(config,runtime,85000,()=>time,async()=>{time+=11000;return {state:'bound'};},f.observe);assert.equal(r.executions,1);assert.equal(f.records.filter(x=>x.stage==='lane_stop'&&x.reason==='insufficient_headroom').length,2);assert.equal(f.records.find(x=>x.reason==='insufficient_headroom').remaining_ms,74000);
});
await test('eight-execution ceiling and duration/start/end telemetry remain bounded per lane',async()=>{
 const f=observer();const r=await runner.runAutomaticBillingWork(config,runtime,85000,()=>0,async()=>({state:'completed'}),f.observe);assert.equal(r.executions,16);assert.equal(f.records.filter(x=>x.reason==='execution_limit').length,2);assert.equal(f.records.filter(x=>x.stage==='execution_start').length,16);assert.ok(f.records.filter(x=>x.stage==='execution_end').every(x=>x.duration_ms>=0));assert.equal(f.records.at(-1).stage,'runner_end');assert.equal(f.records[0].stage,'runner_start');
});
await test('throwing and rejecting sinks cannot change runner outcomes; raw failures stay private',async()=>{
 for(const sink of [()=>{throw Error('SECRET');},async()=>{throw Error('SECRET');}]){
  const f=observer('webhook_kick',sink);const r=await runner.runAutomaticBillingWork(config,runtime,85000,()=>0,async()=>{throw Error('cus_PRIVATE secret');},f.observe);assert.equal(r.counts.stopped,2);assert.doesNotMatch(JSON.stringify(r),/PRIVATE|secret/);await flush();
 }
 const f=observer();await runner.runAutomaticBillingWork(config,runtime,85000,()=>0,async()=>({state:'idle',get category(){throw Error('PRIVATE');}}),f.observe);assert.ok(f.records.some(r=>r.outcome==='idle'));
});
await test('source wiring distinguishes authenticated endpoint from webhook kick without trusting headers',async()=>{
 const sources=[],telemetry={createBillingLatencyObserver:source=>{sources.push(source);return ()=>{};}};
 const calls=[];const run={runAutomaticBillingWork:async(c,create,...args)=>{create();calls.push(args);return {ok:true,executions:2,counts:{idle:2}};}};
 const request=load(root+'billing-work-auto-request.ts',{'node:crypto':crypto,'./billing-latency-diagnostics':telemetry,'./billing-work-auto-runner':run});const secret='offline-only-recovery-secret-long-enough';
 const req=(token)=>new Request('https://offline.invalid/internal',{method:'POST',headers:{authorization:'Bearer '+token,'user-agent':'PRIVATE'}});
 assert.equal((await request.automaticBillingRequest(req('bad'),secret,config,()=>assert.fail('NO_RUNTIME'))).status,401);assert.equal(sources.length,0);
 assert.equal((await request.automaticBillingRequest(req(secret),secret,config,runtime)).status,200);
 let task;const kick=load(root+'billing-work-auto-kick.ts',{'./billing-latency-diagnostics':telemetry,'./billing-work-auto-config':{billingWorkAutomaticConfiguration:()=>config,AUTOMATIC_FUNCTION_SECONDS:90,AUTOMATIC_RESPONSE_RESERVE_MS:5000},'./billing-work-auto-execution':{createAutomaticBillingRuntime:runtime},'./billing-work-auto-runner':run});kick.registerAutomaticBillingKick(t=>task=t,1,performance.now());await task();assert.deepEqual(sources,['automatic_endpoint','webhook_kick']);assert.ok(calls.every(args=>typeof args.at(-1)==='function'));
});

class ApiRouteError extends Error {constructor(status,code,message){super(message);this.status=status;this.code=code;}}
const responses={ApiRouteError,apiSuccess:(data,init)=>Response.json({data},init),apiError:(status,code,message)=>Response.json({error:{code,message}},{status})};
function activationFixture({authorized=true,authoritative=true,verified=true,broken=false,sink}={}){
 const calls=[],f=observer('activation',sink);let authCalls=0;
 const ent=load('src/lib/entitlements/index.ts');const billing=load(root+'billing-state.ts',{'@/lib/entitlements':ent},{process:{env:{STRIPE_PRICE_PRO_MONTHLY:'price_approved'}}});
 const db={auth:{async getUser(token){authCalls++;assert.equal(token,'offline-token');return authorized?{data:{user:{id:'owner'}}}:{error:{code:'invalid'},data:{user:null}};}},from(table){calls.push(table);const q={select:()=>q,eq:()=>q,order:()=>q,maybeSingle:async()=>({data:{id:'owner',subscription_plan:'free'}}),limit:async()=>({data:[{stripe_price_id:authoritative?'price_approved':'price_other',stripe_subscription_status:'active'}]})};return q;}};
 const context=load('src/lib/api/client-context.ts',{'@supabase/supabase-js':{createClient:()=>db},'@/lib/entitlements':ent,'@/lib/api/responses':responses,'@/lib/stripe/billing-state':billing},{process:{env:{NEXT_PUBLIC_SUPABASE_URL:'https://offline.invalid',NEXT_PUBLIC_SUPABASE_ANON_KEY:'offline-placeholder'}},console:{warn(){},error(){}}});
 const identity=load(root+'client-identity.ts',{'@/lib/api/client-context':context,'@/lib/api/responses':responses});
 const route=load('src/app/api/v1/billing/activation/route.ts',{'@/lib/stripe/client-identity':identity,'@/lib/api/client-context':context,'@/lib/api/responses':responses,'@/lib/stripe/billing-latency-diagnostics':{createBillingLatencyObserver:()=>f.observe},'@/lib/stripe/checkout-activation':{
  async acknowledgeCheckout(user,id){calls.push(['ack',user,id]);if(broken)throw Error('SECRET provider payload');return {paymentReceived:true};},
  async verifiedProReady(user,pro){calls.push(['ready',user,pro]);if(broken)throw Error('SECRET database payload');return pro&&verified;},
 }});
 return {calls,records:f.records,get authCalls(){return authCalls;},get:query=>route.GET(new Request('https://offline.invalid/activation'+query,{headers:{authorization:'Bearer offline-token'}}))};
}
await test('real readiness route authenticates once and passes only verified context identity to existing Pro gate',async()=>{
 const f=activationFixture();const r=await f.get('');assert.equal(r.status,200);assert.deepEqual(await r.json(),{data:{proReady:true}});assert.equal(f.authCalls,1);assert.deepEqual(f.calls.at(-1),['ready','owner',true]);assert.equal(r.headers.get('Cache-Control'),'private, no-store');
});
await test('real acknowledgement also authenticates once and retains owner/session validation boundary',async()=>{
 const f=activationFixture();assert.equal((await f.get('?session_id=cs_test_owned')).status,200);assert.equal(f.authCalls,1);assert.deepEqual(f.calls,[['ack','owner','cs_test_owned']]);assert.deepEqual(f.records.map(r=>r.stage),['activation_start','acknowledgement_start','acknowledgement_end','activation_end']);assert.equal(f.records.at(-1).outcome,'payment_acknowledged');
});
await test('unauthenticated readiness and acknowledgement reject before owner reads',async()=>{
 for(const query of ['', '?session_id=cs_test_owned']){const f=activationFixture({authorized:false});assert.equal((await f.get(query)).status,401);assert.equal(f.authCalls,1);assert.equal(f.calls.length,0);assert.equal(f.records.at(-1).outcome,'safe_error');}
});
await test('malformed authenticated query cannot perform mirror/price/provider reads',async()=>{
 for(const query of ['?user_id=foreign','?session_id=cs_test_owned&extra=x','?session_id=a&session_id=b']){const f=activationFixture();assert.equal((await f.get(query)).status,400);assert.equal(f.authCalls,1);assert.equal(f.calls.length,0);}
});
await test('authoritative plan and verified mirror remain independent requirements',async()=>{
 for(const options of [{authoritative:false},{verified:false}]){const f=activationFixture(options);assert.deepEqual(await (await f.get('')).json(),{data:{proReady:false}});assert.equal(f.records.at(-1).outcome,'pro_not_ready');}
});
await test('activation timing surrounds real phases with bounded records and no raw exceptions/identities',async()=>{
 for(const query of ['', '?session_id=cs_test_owned']){const f=activationFixture({broken:true});const r=await f.get(query);assert.equal(r.status,503);assert.doesNotMatch(await r.text(),/SECRET|payload/);assert.equal(f.records.at(-1).outcome,'safe_error');assert.ok(f.records.at(-1).duration_ms>=0);assert.doesNotMatch(JSON.stringify(f.records),/cs_test|owner|token|payload|SECRET/);}
 const f=activationFixture();await f.get('');assert.deepEqual(f.records.map(r=>r.stage),['activation_start','readiness_start','readiness_end','activation_end']);assert.equal(f.records.at(-1).outcome,'pro_ready');
});
await test('activation logging failure preserves HTTP/body and authorization',async()=>{
 for(const sink of [()=>{throw Error('PRIVATE');},async()=>{throw Error('PRIVATE');}]){const f=activationFixture({sink});assert.deepEqual(await (await f.get('')).json(),{data:{proReady:true}});assert.equal(f.authCalls,1);await flush();}
});
await test('only exact reviewed latency changes are exempted from authority diff guards',()=>{
 assertAutomaticWorkerFiles();assertBillingLatencyFiles();for(const target of billingLatencyReviewedPaths)assert.throws(()=>assertBillingLatencyFiles((file,encoding)=>fs.readFileSync(file,encoding)+(file===target?'\n// unrelated\n':'')),/Unexpected activation latency change/);
 assert.equal(execFileSync('git',['diff','--name-only','HEAD','--','supabase/migrations','src/lib/stripe/finance*','src/lib/stripe/reliability.ts','src/lib/stripe/billing-work-worker.ts','src/lib/stripe/billing-work-store.ts','src/lib/stripe/billing-work-routing.ts','src/app/api/stripe/webhook/route.ts','src/lib/stripe/webhook-mode-guard.ts','src/lib/api/client-context.ts','vercel.json'],{encoding:'utf8'}),'');
});
console.log(`Billing latency: ${count}/${count} passed (offline).`);
