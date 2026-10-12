// Strict offline mocks only: no provider, database, environment-file or hosted access.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as crypto from "node:crypto";
import {execFileSync} from "node:child_process";
const configFile="src/lib/stripe/finance-invoice-proof-config.ts",routeFile="src/app/api/stripe/webhook/route.ts";
function load(file,deps={},env={}){
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports,process:{env},Request,Response,URL,Error,Buffer,performance,setTimeout,clearTimeout,require:name=>{if(name==="server-only")return {};assert.ok(Object.hasOwn(deps,name),"UNEXPECTED_IMPORT");return deps[name];}});return exports;
}
const configuration=load(configFile),billing=load("src/lib/stripe/billing-work-config.ts");
const approved={DMI_FINANCE_INVOICE_PROOF_PRODUCTION_ENABLED:"true",VERCEL_ENV:"preview",VERCEL_TARGET_ENV:"staging",VERCEL_PROJECT_ID:"prj_FPTsXDokhm5uSDMaxieuo5Cmp0Rn",NEXT_PUBLIC_SUPABASE_URL:"https://uohdkewufeivdpaljnng.supabase.co",STRIPE_ACCOUNT_SCOPE:"acct_1OoTzlG71GpCYtA4:test",STRIPE_SECRET_KEY:"sk_test_synthetic"};
const expected={approvedScope:approved.STRIPE_ACCOUNT_SCOPE,approval:"reviewed_staging_dmi_charge_v1",production:true,consumption:false,wake:false};
const plain=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
let count=0;async function test(name,fn){await fn();count++;console.log("PASS proof configuration "+name);}
await test("absent flag and empty configuration OFF",()=>{assert.equal(configuration.invoiceProofProductionOptions({}),undefined);assert.equal(configuration.invoiceProofProductionOptions({...approved,DMI_FINANCE_INVOICE_PROOF_PRODUCTION_ENABLED:undefined}),undefined);});
await test("only exact string true enables",()=>{for(const value of ["false","FALSE","TRUE","True"," true","true ","1","yes","",true,1,null])assert.equal(configuration.invoiceProofProductionOptions({...approved,DMI_FINANCE_INVOICE_PROOF_PRODUCTION_ENABLED:value}),undefined);});
await test("approved Staging produces exact production-only object",()=>assert.deepEqual(plain(configuration.invoiceProofProductionOptions(approved)),expected));
await test("restricted test credential accepted",()=>assert.deepEqual(plain(configuration.invoiceProofProductionOptions({...approved,STRIPE_SECRET_KEY:"rk_test_synthetic"})),expected));
for(const [key,value] of [["VERCEL_ENV","production"],["VERCEL_ENV","development"],["VERCEL_ENV","staging"],["VERCEL_TARGET_ENV","preview"],["VERCEL_TARGET_ENV","production"],["VERCEL_PROJECT_ID","prj_other"],["NEXT_PUBLIC_SUPABASE_URL","https://other.supabase.co"],["NEXT_PUBLIC_SUPABASE_URL",approved.NEXT_PUBLIC_SUPABASE_URL+"/"],["STRIPE_ACCOUNT_SCOPE","acct_other:test"],["STRIPE_ACCOUNT_SCOPE",approved.STRIPE_ACCOUNT_SCOPE.replace(":test",":live")],["STRIPE_SECRET_KEY","sk_live_synthetic"],["STRIPE_SECRET_KEY","rk_live_synthetic"],["STRIPE_SECRET_KEY","sk_test_"],["STRIPE_SECRET_KEY","not_a_credential"]])await test("reject guard "+key+" variant",()=>assert.equal(configuration.invoiceProofProductionOptions({...approved,[key]:value}),undefined));
for(const key of ["VERCEL_ENV","VERCEL_TARGET_ENV","VERCEL_PROJECT_ID","NEXT_PUBLIC_SUPABASE_URL","STRIPE_ACCOUNT_SCOPE","STRIPE_SECRET_KEY"])await test("missing "+key+" OFF",()=>{const env={...approved};delete env[key];assert.equal(configuration.invoiceProofProductionOptions(env),undefined);});
await test("worker scope cannot substitute Finance account scope",()=>assert.equal(configuration.invoiceProofProductionOptions({...approved,STRIPE_ACCOUNT_SCOPE:undefined,BILLING_WORK_STRIPE_SCOPE:approved.STRIPE_ACCOUNT_SCOPE}),undefined));
await test("handoff and recovery switches stay independent",()=>{
 const env={...approved,BILLING_WORK_STRIPE_SCOPE:approved.STRIPE_ACCOUNT_SCOPE,BILLING_WORK_RECOVERY_ENABLED:"true"};
 for(const kind of ["handoff","recovery"])assert.deepEqual(plain(billing.billingWorkConfiguration(kind,env)),plain(billing.billingWorkConfiguration(kind,{...env,DMI_FINANCE_INVOICE_PROOF_PRODUCTION_ENABLED:"false"})));
 assert.equal(billing.billingWorkConfiguration("handoff",env).state,"disabled");assert.equal(billing.billingWorkConfiguration("recovery",env).state,"enabled");
 for(const value of [undefined,"false","true"]){assert.deepEqual(plain(configuration.invoiceProofProductionOptions({...env,BILLING_WORK_HANDOFF_ENABLED:value,BILLING_WORK_RECOVERY_ENABLED:value})),expected);}
});
function route(env,options={}){
 const calls=[],consumerArgs=[];const config=load(configFile,{},env);
 const deps={
  "@/lib/stripe/finance-invoice-proof-config":{invoiceProofProductionOptions:()=>{calls.push("proof_options");return config.invoiceProofProductionOptions();}},
  "@/lib/stripe/billing-work-config":{billingWorkConfiguration:()=>{calls.push("handoff_config");return options.handoff?{state:"enabled"}:{state:"disabled"};}},
  "@/lib/stripe/billing-work-handoff":{handoffBillingWork:async()=>{calls.push("handoff");return {state:"unfinished",applicable:2,terminal:0};}},
  "@/lib/supabase-admin":{createSupabaseAdminClient:()=>{throw Error("UNEXPECTED_DATABASE");}},
  "next/server":{NextResponse:{json:(value,init)=>new Response(JSON.stringify(value),{status:init?.status??200})}},
  "@/lib/stripe/config":{constructStripeWebhookEvent:()=>{calls.push("signature");if(options.signatureError)throw Error("Invalid signature");return {id:"evt_synthetic",type:"invoice.paid"};}},
  "@/lib/stripe/webhook-consumers":{handleStripeWebhookConsumers:async(...args)=>{calls.push("consumer");consumerArgs.push(args);if(options.consumerError)throw Error("FINANCE_PROOF_AUTHORITY");return {handled:true};}},
  "@/lib/observability/logger":{logInfo:()=>calls.push("info"),logError:()=>calls.push("error"),safeErrorMetadata:()=>({})},
  "@/lib/observability/request":{requestIdFromRequest:()=>"synthetic-request",withRequestIdHeader:r=>r},
 };
 const mod=load(routeFile,deps,env);return {calls,consumerArgs,post:()=>mod.POST(new Request("https://staging.invalid/api/stripe/webhook",{method:"POST",body:"synthetic",headers:{"stripe-signature":"synthetic"}}))};
}
await test("OFF route retains exactly three original consumer arguments",async()=>{const f=route({...approved,DMI_FINANCE_INVOICE_PROOF_PRODUCTION_ENABLED:undefined});assert.equal((await f.post()).status,200);assert.equal(f.consumerArgs.length,1);assert.equal(f.consumerArgs[0].length,3);assert.deepEqual(f.calls,["signature","handoff_config","proof_options","consumer","info"]);});
await test("ON route passes only exact reviewed fourth argument",async()=>{const f=route(approved);assert.equal((await f.post()).status,200);assert.equal(f.consumerArgs.length,1);assert.equal(f.consumerArgs[0].length,4);assert.deepEqual(plain(f.consumerArgs[0][3]),expected);});
await test("invalid configuration keeps route ordinary without options",async()=>{const f=route({...approved,VERCEL_ENV:"production"});assert.equal((await f.post()).status,200);assert.equal(f.consumerArgs[0].length,3);});
await test("signature rejection precedes configuration and consumer",async()=>{const f=route(approved,{signatureError:true});assert.equal((await f.post()).status,400);assert.equal(f.consumerArgs.length,0);assert.ok(!f.calls.includes("proof_options"));});
await test("handoff branch does not construct proof options or run inline",async()=>{const f=route(approved,{handoff:true});assert.equal((await f.post()).status,500);assert.equal(f.consumerArgs.length,0);assert.ok(!f.calls.includes("proof_options"));});
await test("proof failure stays retryable without ordinary fallback",async()=>{const f=route(approved,{consumerError:true});assert.equal((await f.post()).status,500);assert.equal(f.consumerArgs.length,1);assert.equal(f.consumerArgs[0].length,4);});
await test("wake cannot implicitly enable consumption or production",()=>{
 const base={...approved,DMI_FINANCE_INVOICE_PROOF_PRODUCTION_ENABLED:undefined,DMI_FINANCE_CHARGE_DEPENDENCY_WAKE_ENABLED:"true"};
 assert.equal(configuration.invoiceProofProductionOptions(base),undefined);
 assert.deepEqual(plain(configuration.invoiceProofProductionOptions({...base,DMI_FINANCE_INVOICE_PROOF_PRODUCTION_ENABLED:"true"})),expected);
 assert.doesNotMatch(fs.readFileSync(configFile,"utf8"),/BILLING_WORK_HANDOFF_ENABLED|BILLING_WORK_RECOVERY_ENABLED/);
});
await test("helper has no I/O, mutation, logging or browser inputs",()=>assert.doesNotMatch(fs.readFileSync(configFile,"utf8"),/console\.|logInfo|logError|fetch\(|\.rpc\(|\.insert\(|\.update\(|\.delete\(|Request|window|document/));
await test("normalize bridge away and entire route matches approved OFF baseline",()=>{
 const source=fs.readFileSync(routeFile,"utf8").replace('import {invoiceProofProductionOptions} from "@/lib/stripe/finance-invoice-proof-config";\n','').replace('    const invoiceProofOptions = invoiceProofProductionOptions();\n    const result = invoiceProofOptions\n      ? await handleStripeWebhookConsumers(event, requestId, invocationStartedAt, invoiceProofOptions)\n      : await handleStripeWebhookConsumers(event, requestId, invocationStartedAt);','    const result = await handleStripeWebhookConsumers(event, requestId, invocationStartedAt);');
 assert.equal(source,execFileSync("git",["show","bae038d3058692f845825ec7ece10b003612e853:"+routeFile],{encoding:"utf8"}));
});
await test("recovery configuration, protocol, foreign authority and migrations unchanged",()=>{
 for(const file of ["src/lib/stripe/billing-work-config.ts","src/lib/stripe/billing-work-runtime.ts","src/lib/stripe/finance-dmi-charge-integration.ts","src/lib/stripe/finance-foreign-event.ts","vercel.json"])assert.equal(fs.readFileSync(file,"utf8"),execFileSync("git",["show","HEAD:"+file],{encoding:"utf8"}));
 assert.equal(execFileSync("git",["diff","--name-only","HEAD","--","supabase/migrations"],{encoding:"utf8"}),"");
});
const flags=["DMI_FINANCE_INVOICE_PROOF_PRODUCTION_ENABLED","DMI_FINANCE_CHARGE_PROOF_CONSUMPTION_ENABLED","DMI_FINANCE_CHARGE_DEPENDENCY_WAKE_ENABLED"];
const guardFailures=[["VERCEL_ENV","production"],["VERCEL_ENV","development"],["VERCEL_ENV",undefined],["VERCEL_TARGET_ENV","preview"],["VERCEL_TARGET_ENV",undefined],["VERCEL_PROJECT_ID","prj_other"],["VERCEL_PROJECT_ID",undefined],["NEXT_PUBLIC_SUPABASE_URL","https://other.supabase.co"],["NEXT_PUBLIC_SUPABASE_URL",undefined],["STRIPE_ACCOUNT_SCOPE","acct_other:test"],["STRIPE_ACCOUNT_SCOPE","acct_other:live"],["STRIPE_ACCOUNT_SCOPE",undefined],["STRIPE_SECRET_KEY","sk_live_synthetic"],["STRIPE_SECRET_KEY",undefined]];
for(let mask=0;mask<8;mask++)await test("flag combination "+mask+" config and real route",async()=>{
 const env={...approved};for(let n=0;n<3;n++)env[flags[n]]=mask&(1<<n)?"true":undefined;
 const production=!!(mask&1),consumption=!!(mask&2),wake=consumption&&!!(mask&4);
 const result=production||consumption?{...expected,production,consumption,wake}:undefined;
 assert.deepEqual(plain(configuration.invoiceProofProductionOptions(env)),result);
 const f=route(env);assert.equal((await f.post()).status,200);assert.equal(f.consumerArgs.length,1);assert.equal(f.consumerArgs[0].length,result?4:3);assert.deepEqual(plain(f.consumerArgs[0][3]),result);
 for(const [key,value] of guardFailures){const invalid={...env,[key]:value};assert.equal(configuration.invoiceProofProductionOptions(invalid),undefined);const rejected=route(invalid);assert.equal((await rejected.post()).status,200);assert.equal(rejected.consumerArgs[0].length,3);}
});
for(const flag of flags)await test("exact true only for "+flag,()=>{
 for(const value of [undefined,"false","FALSE","TRUE","True"," true","true ","1","yes","",true,1,null]){
  const env={...approved,DMI_FINANCE_INVOICE_PROOF_PRODUCTION_ENABLED:undefined,DMI_FINANCE_CHARGE_PROOF_CONSUMPTION_ENABLED:undefined,DMI_FINANCE_CHARGE_DEPENDENCY_WAKE_ENABLED:undefined,[flag]:value};
  assert.equal(configuration.invoiceProofProductionOptions(env),undefined);
 }
});
await test("malformed wake remains false with effective consumption",()=>{
 for(const value of [undefined,"false","TRUE"," true","true ",true])assert.deepEqual(plain(configuration.invoiceProofProductionOptions({...approved,DMI_FINANCE_CHARGE_PROOF_CONSUMPTION_ENABLED:"true",DMI_FINANCE_CHARGE_DEPENDENCY_WAKE_ENABLED:value})),{...expected,consumption:true,wake:false});
});
const recoveryFile="src/app/api/internal/billing-work/route.ts";
const recovery=load("src/lib/stripe/billing-work-recovery.ts",{"node:crypto":crypto});
const bearer="synthetic_bearer_for_offline_validation_only";
function recoveryRoute(env){
 const calls=[],workers=[],executions=[],config=load(configFile,{},env);
 const mod=load(recoveryFile,{
  "@/lib/stripe/finance-invoice-proof-config":{invoiceProofProductionOptions:()=>{calls.push("proof_options");return config.invoiceProofProductionOptions();}},
  "@/lib/stripe/billing-work-config":{billingWorkConfiguration:kind=>billing.billingWorkConfiguration(kind,env)},
  "@/lib/stripe/billing-work-recovery":recovery,
  "@/lib/stripe/billing-work-runtime":{createDisabledBillingWorkerRuntime:(_db,_stripe,worker)=>{workers.push(worker);return {}; }},
  "@/lib/stripe/billing-work-worker":{executeBillingWorker:async(_deps,scope,consumer,event,worker)=>{executions.push({scope,consumer,event,worker});return {state:"idle"};}},
  "@/lib/supabase-admin":{createSupabaseAdminClient:()=>{calls.push("database");return {}; }},
  "@/lib/stripe/config":{getStripeServerClient:()=>{calls.push("stripe");return {}; }},
 },env);
 return {calls,workers,executions,post:(options={})=>mod.POST(new Request("https://staging.invalid/api/internal/billing-work"+(options.query??""),{method:"POST",headers:{authorization:options.authorization??"Bearer "+bearer},...(options.body!==undefined?{body:options.body}:{})}))};
}
const recoveryEnv={...approved,BILLING_WORK_RECOVERY_ENABLED:"true",BILLING_WORK_STRIPE_SCOPE:approved.STRIPE_ACCOUNT_SCOPE,BILLING_WORK_RECOVERY_SECRET:bearer};
for(let mask=0;mask<8;mask++)await test("recovery worker flag combination "+mask,async()=>{
 const env={...recoveryEnv};for(let n=0;n<3;n++)env[flags[n]]=mask&(1<<n)?"true":undefined;
 const f=recoveryRoute(env);const response=await f.post();assert.equal(response.status,200);assert.equal(f.workers.length,1);assert.equal(f.executions.length,2);assert.deepEqual(f.executions.map(x=>x.consumer),["finance","entitlement"]);
 const options=plain(configuration.invoiceProofProductionOptions(env));assert.deepEqual(plain(f.workers[0].proofs),options);
 for(const x of f.executions){assert.equal(x.worker,f.workers[0]);assert.equal(x.scope,approved.STRIPE_ACCOUNT_SCOPE);assert.equal(x.event,undefined);}
 assert.doesNotMatch(await response.text(),/acct_|cus_|evt_|synthetic|approval|proofs/);
});
await test("recovery authentication and body checks precede proof configuration",async()=>{
 for(const options of [{authorization:"Bearer wrong"},{query:"?unexpected=true"},{body:"{}"}]){const f=recoveryRoute({...recoveryEnv,DMI_FINANCE_CHARGE_PROOF_CONSUMPTION_ENABLED:"true",DMI_FINANCE_CHARGE_DEPENDENCY_WAKE_ENABLED:"true"});assert.notEqual((await f.post(options)).status,200);assert.equal(f.calls.length,0);assert.equal(f.workers.length,0);assert.equal(f.executions.length,0);}
});
await test("proof flags cannot enable disabled recovery",async()=>{
 const f=recoveryRoute({...recoveryEnv,BILLING_WORK_RECOVERY_ENABLED:undefined,DMI_FINANCE_CHARGE_PROOF_CONSUMPTION_ENABLED:"true",DMI_FINANCE_CHARGE_DEPENDENCY_WAKE_ENABLED:"true"});assert.equal((await f.post()).status,503);assert.equal(f.calls.length,0);
});
await test("recovery guard failures reject privileged proof options",async()=>{
 for(const [key,value] of guardFailures){const env={...recoveryEnv,DMI_FINANCE_CHARGE_PROOF_CONSUMPTION_ENABLED:"true",DMI_FINANCE_CHARGE_DEPENDENCY_WAKE_ENABLED:"true",[key]:value};const f=recoveryRoute(env);await f.post();for(const worker of f.workers)assert.equal(worker.proofs,undefined);}
});
await test("recovery bridge normalizes to the exact approved original route",()=>{
 const source=fs.readFileSync(recoveryFile,"utf8").replace('import {invoiceProofProductionOptions} from "@/lib/stripe/finance-invoice-proof-config";\n','').replace('  const proofs=invoiceProofProductionOptions();\n  const worker=proofs?{...config.worker,proofs}:config.worker;\n','').replace('getStripeServerClient(),worker)','getStripeServerClient(),config.worker)').replace('consumer,undefined,worker)','consumer,undefined,config.worker)');
 assert.equal(source,execFileSync("git",["show","494250bea2ea5fa9989e563850f91641b78a2252:"+recoveryFile],{encoding:"utf8"}));
});
console.log(`PASS invoice-proof config/route: ${count}/${count}`);
