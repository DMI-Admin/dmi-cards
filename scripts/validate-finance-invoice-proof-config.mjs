// Strict offline mocks only: no provider, database, environment-file or hosted access.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import {execFileSync} from "node:child_process";
const configFile="src/lib/stripe/finance-invoice-proof-config.ts",routeFile="src/app/api/stripe/webhook/route.ts";
function load(file,deps={},env={}){
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports,process:{env},Request,Response,URL,Error,performance,require:name=>{if(name==="server-only")return {};assert.ok(Object.hasOwn(deps,name),"UNEXPECTED_IMPORT");return deps[name];}});return exports;
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
await test("helper never enables charge consumption or wake",()=>{assert.doesNotMatch(fs.readFileSync(configFile,"utf8"),/consumption\s*:\s*true|wake\s*:\s*true|BILLING_WORK_HANDOFF_ENABLED|BILLING_WORK_RECOVERY_ENABLED|DMI_FINANCE_CHARGE|DMI_FINANCE_WAKE/);});
await test("helper has no I/O, mutation, logging or browser inputs",()=>assert.doesNotMatch(fs.readFileSync(configFile,"utf8"),/console\.|logInfo|logError|fetch\(|\.rpc\(|\.insert\(|\.update\(|\.delete\(|Request|window|document/));
await test("normalize bridge away and entire route matches approved OFF baseline",()=>{
 const source=fs.readFileSync(routeFile,"utf8").replace('import {invoiceProofProductionOptions} from "@/lib/stripe/finance-invoice-proof-config";\n','').replace('    const invoiceProofOptions = invoiceProofProductionOptions();\n    const result = invoiceProofOptions\n      ? await handleStripeWebhookConsumers(event, requestId, invocationStartedAt, invoiceProofOptions)\n      : await handleStripeWebhookConsumers(event, requestId, invocationStartedAt);','    const result = await handleStripeWebhookConsumers(event, requestId, invocationStartedAt);');
 assert.equal(source,execFileSync("git",["show","bae038d3058692f845825ec7ece10b003612e853:"+routeFile],{encoding:"utf8"}));
});
await test("recovery configuration, protocol, foreign authority and migrations unchanged",()=>{
 for(const file of ["src/lib/stripe/billing-work-config.ts","src/lib/stripe/billing-work-runtime.ts","src/app/api/internal/billing-work/route.ts","src/lib/stripe/finance-dmi-charge-integration.ts","src/lib/stripe/finance-foreign-event.ts","vercel.json"])assert.equal(fs.readFileSync(file,"utf8"),execFileSync("git",["show","HEAD:"+file],{encoding:"utf8"}));
 assert.equal(execFileSync("git",["diff","--name-only","HEAD","--","supabase/migrations"],{encoding:"utf8"}),"");
});
console.log(`PASS invoice-proof config/route: ${count}/${count}`);
