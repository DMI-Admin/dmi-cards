// Offline mocks and optional disposable PostgreSQL assertions only. No network/secrets.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
const paths=['src/lib/stripe/billing-work-evidence.ts','src/lib/stripe/billing-work-admission.ts'];
function load(file,deps={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Buffer,Error,require:name=>{if(name==='server-only')return {};assert.ok(name in deps,'UNEXPECTED_IMPORT');return deps[name];}});return exports;}
const evidence=load(paths[0],{'node:crypto':crypto});
const admission=load(paths[1],{'./billing-work-evidence':evidence});
const contract=load('src/lib/stripe/finance-contract.ts');
const finance=load('src/lib/stripe/finance-event-evidence.ts',{'./finance-contract':contract});
const scope='acct_fixture:test',user='11111111-1111-4111-8111-111111111111';
const schemas=JSON.parse(JSON.stringify(evidence.workEvidenceSchemas));
const sql=fs.readFileSync('supabase/migrations/20261010040000_billing_consumer_work_scheduler.sql','utf8');
const events=[...new Set(Object.keys(schemas).map(k=>k.slice(k.indexOf(':')+1)))];
function signed(type='invoice.paid'){
 const kind=schemas['finance:'+type].properties.subject_type.enum[0],prefix={subscription:'sub',invoice:'in',charge:'ch',refund:'re',checkout_session:'cs',allocation:'inpay',customer:'cus'}[kind];
 let object={id:prefix+'_fixture',object:kind==='checkout_session'?'checkout.session':kind==='allocation'?'invoice_payment':kind};
 if(['subscription','invoice','charge','checkout_session'].includes(kind))object.customer='cus_owned';
 if(kind==='subscription')Object.assign(object,{created:100,livemode:false,status:type.endsWith('deleted')?'canceled':'active',cancel_at_period_end:false,trial_end:null,ended_at:type.endsWith('deleted')?101:null,latest_invoice:'in_fixture',metadata:{dmi_app:'dmi_cards_v2',dmi_user_id:user,dmi_profile_id:user,unrelated:'PRIVATE'},items:{has_more:false,data:[{id:'si_fixture',price:{id:'price_current'},current_period_start:100,current_period_end:200}]}});
 if(kind==='invoice')Object.assign(object,{status:'paid',subscription:'sub_owned',parent:{type:'subscription_details',subscription_details:{subscription:'sub_owned'}},lines:{has_more:false,data:[{price:{id:'price_current'}}]}});
 if(kind==='charge')Object.assign(object,{created:99,livemode:false,currency:'gbp',status:type==='charge.failed'?'failed':'succeeded',payment_intent:'pi_fixture',amount:599,amount_captured:type==='charge.failed'?0:599,amount_refunded:0,paid:type!=='charge.failed',captured:type!=='charge.failed',failure_code:type==='charge.failed'?'card_declined':null});
 if(kind==='refund')Object.assign(object,{status:'succeeded',charge:'ch_fixture'});
 if(kind==='checkout_session')Object.assign(object,{subscription:'sub_owned',client_reference_id:user,metadata:{dmi_app:'dmi_cards_v2',dmi_user_id:user}});
 return {id:'evt_fixture',type,created:102,api_version:'2023-10-16',livemode:false,data:{object,previous_attributes:{status:kind==='subscription'?'trialing':'pending',cancel_at_period_end:true}}};
}
export function schedulerFixtureEvidence(consumer){return evidence.prepareBillingWorkEvidence('acct_work:test',signed(),consumer).evidence;}
const prepare=(event,consumer='finance')=>{const r=evidence.prepareBillingWorkEvidence(scope,event,consumer);assert.equal(r.state,'prepared');return r;};
let count=0;async function test(name,run){await run();count++;console.log('PASS evidence '+name);}
await test('SQL and TypeScript have identical closed schemas',()=>assert.deepEqual(JSON.parse(sql.match(/\$schemas\$(.*?)\$schemas\$/s)[1]),JSON.parse(JSON.stringify(evidence.workEvidenceContract))));
await test('21 distinct currently handled/explicitly ignored event families, separate consumers',()=>{
 assert.equal(events.length,21);
 const roots=fs.readFileSync('src/lib/stripe/finance-webhook.ts','utf8');
 const customer=fs.readFileSync('src/lib/stripe/finance-customer-webhook.ts','utf8');
 for(const match of (roots+customer).matchAll(/["']((?:customer|invoice|charge|refund|checkout)[a-z_.]+)["']/g))if(match[1].includes('.'))assert.ok(events.includes(match[1]),'MISSING_FAMILY');
 for(const type of events)for(const consumer of ['finance','entitlement']){const r=prepare(signed(type),consumer);assert.equal(evidence.replayBillingWorkEvidence(r.evidence).type,type);assert.equal(r.evidence.consumer,consumer);}
});
await test('Finance historical/narrative evidence equals the committed reviewed projection',()=>{
 for(const type of events){const original=signed(type),restored=evidence.replayBillingWorkEvidence(prepare(original).evidence);assert.equal(JSON.stringify(finance.reviewedFinanceEvent(restored)),JSON.stringify(finance.reviewedFinanceEvent(original)));}
});
await test('recognized typed namespace identity retained without arbitrary metadata',()=>{
 const r=prepare(signed('customer.subscription.deleted'),'entitlement');
 assert.equal(r.evidence.object.dmi_user_id,user);assert.equal(r.evidence.object.dmi_profile_id,user);assert.equal(r.evidence.object.namespace,'dmi_cards_v2');
 assert.doesNotMatch(JSON.stringify(r.evidence),/metadata|PRIVATE|unrelated/);
 assert.equal(evidence.replayBillingWorkEvidence(r.evidence).data.object.metadata.dmi_app,'dmi_cards_v2');
});
await test('actual entitlement deleted fallback after resource_missing',async()=>{
 const source=fs.readFileSync('scripts/validate-stripe-reliability.mjs','utf8'),exports={};
 vm.runInNewContext(ts.transpileModule(source.split('let f=fixture();')[0]+'\nexports.fixture=fixture;exports.webhook=webhook;',{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Error,performance,AbortController,setTimeout,clearTimeout,Date,URL,Buffer,console,Promise,setImmediate,require:name=>({'node:assert/strict':{default:assert},'node:fs':{default:fs},'node:vm':{default:vm},typescript:{default:ts},'node:crypto':crypto}[name])});
 const f=exports.fixture();f.sub.status='canceled';f.sub.ended_at=101;f.sub.metadata.dmi_profile_id=user;
 const original={...signed('customer.subscription.deleted'),data:{object:f.sub}},restored=evidence.replayBillingWorkEvidence(prepare(original,'entitlement').evidence);
 f.subscriptions.delete(f.sub.id);
 await exports.webhook.handleStripeWebhookEvent(restored,f.r);
 assert.equal(f.events.get(original.id).state,'processed');assert.equal(f.mirrors[0].sync_snapshot.status,'canceled');assert.equal(f.mirrors[0].sync_snapshot.plan,'free');assert.equal(f.mirrors[0].sync_snapshot.terminal,true);assert.equal(f.retrieves,2);
});
await test('every entitlement event replays through the committed consumer with identical outcome',async()=>{
 const source=fs.readFileSync('scripts/validate-stripe-reliability.mjs','utf8'),exports={};
 vm.runInNewContext(ts.transpileModule(source.split('let f=fixture();')[0]+'\nexports.fixture=fixture;exports.webhook=webhook;',{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Error,performance,AbortController,setTimeout,clearTimeout,Date,URL,Buffer,console,Promise,setImmediate,require:name=>({'node:assert/strict':{default:assert},'node:fs':{default:fs},'node:vm':{default:vm},typescript:{default:ts},'node:crypto':crypto}[name])});
 for(const type of events){
  const original=signed(type);if(type.startsWith('customer.subscription.')){const f=exports.fixture();original.data.object=JSON.parse(JSON.stringify(f.sub));if(type.endsWith('deleted'))original.data.object.status='canceled';}
  const restored=evidence.replayBillingWorkEvidence(prepare(original,'entitlement').evidence),a=exports.fixture(),b=exports.fixture();
  const first=await exports.webhook.handleStripeWebhookEvent(original,a.r),second=await exports.webhook.handleStripeWebhookEvent(restored,b.r);
  assert.equal(JSON.stringify(second),JSON.stringify(first));assert.equal(a.events.get(original.id).state,b.events.get(original.id).state);assert.equal(JSON.stringify(a.mirrors.map(r=>r.sync_snapshot)),JSON.stringify(b.mirrors.map(r=>r.sync_snapshot)));
 }
});
await test('bounded subscription items preserve duplicates and periods',()=>{
 const e=signed('customer.subscription.deleted');e.data.object.items.data=Array.from({length:20},()=>({...e.data.object.items.data[0]}));
 const r=prepare(e,'entitlement');assert.equal(r.evidence.object.items.data.length,20);assert.equal(r.evidence.object.items.data[0].current_period_end,200);
 e.data.object.items.data.push(e.data.object.items.data[0]);assert.equal(evidence.prepareBillingWorkEvidence(scope,e,'entitlement').reason,'invalid_evidence');
});
await test('incomplete collections stay incomplete, never fabricated complete',()=>{const e=signed('customer.subscription.deleted');e.data.object.items.has_more=true;assert.equal(prepare(e,'entitlement').evidence.object.items.has_more,true);});
await test('historical failed charge and captured collection facts survive replay',()=>{
 for(const type of ['charge.failed','charge.succeeded','charge.captured']){
  const e=signed(type),r=prepare(e),restored=evidence.replayBillingWorkEvidence(r.evidence);for(const key of Object.keys(r.evidence.object))assert.equal(JSON.stringify(restored.data.object[key]),JSON.stringify(e.data.object[key]));
 }
});
await test('failure code allowlist; arbitrary failure text excluded',()=>{
 const e=signed('charge.failed');e.data.object.failure_code='PRIVATE_PROVIDER_ERROR';e.data.object.failure_message='PRIVATE';e.data.object.outcome={secret:'PRIVATE'};
 const r=prepare(e);assert.equal(r.evidence.object.failure_code,null);assert.doesNotMatch(JSON.stringify(r),/PRIVATE|failure_message|outcome/);
 for(const code of schemas['finance:charge.failed'].properties.object.properties.failure_code.enum){e.data.object.failure_code=code;assert.equal(prepare(e).evidence.object.failure_code,code);}
});
await test('exact redelivery and object key order canonical digest agree',()=>{
 const a=signed('charge.failed'),b=structuredClone(a);b.data.object=Object.fromEntries(Object.entries(b.data.object).reverse());assert.equal(prepare(a).digest,prepare(b).digest);
});
await test('every retained historical field changes canonical digest',()=>{
 const r=prepare(signed('charge.failed'));
 for(const [key,value] of Object.entries(r.evidence.object)){const c=structuredClone(r.evidence);c.object[key]=typeof value==='number'?value+1:typeof value==='boolean'?!value:typeof value==='string'?value+'x':value===null?'changed':{};assert.notEqual(crypto.createHash('sha256').update(evidence.canonicalWorkEvidence(c)).digest('hex'),r.digest);}
 const d=prepare(signed('customer.subscription.deleted'),'entitlement');for(const change of [e=>e.object.items.data[0].current_period_end++,e=>e.object.ended_at++,e=>e.object.dmi_profile_id='22222222-2222-4222-8222-222222222222',e=>e.object.items.data.push({...e.object.items.data[0]})]){const c=structuredClone(d.evidence);change(c);assert.notEqual(crypto.createHash('sha256').update(evidence.canonicalWorkEvidence(c)).digest('hex'),d.digest);}
});
await test('identity/scope/API version included in immutable digest',()=>{
 const a=prepare(signed());for(const [key,value] of Object.entries(a.evidence)){if(key==='object'||key==='previous')continue;const c=structuredClone(a.evidence);c[key]=typeof value==='number'?value+1:String(value)+'x';assert.notEqual(crypto.createHash('sha256').update(evidence.canonicalWorkEvidence(c)).digest('hex'),a.digest);}
});
await test('malformed identity/type/timestamp/version fail closed',()=>{
 for(const change of [e=>e.id='SECRET',e=>e.created=-1,e=>e.created=1.1,e=>e.livemode=true,e=>e.account='acct_other',e=>e.api_version='2026-07-29.dahlia',e=>e.data.object.id='cus_wrong',e=>e.data.object.customer={id:'INVALID'},e=>e.data.object.status='PRIVATE']){const e=signed();change(e);assert.equal(evidence.prepareBillingWorkEvidence(scope,e,'finance').reason,'invalid_evidence');}
 const e=signed('customer.subscription.deleted');e.data.object.metadata.dmi_user_id='PRIVATE';assert.equal(evidence.prepareBillingWorkEvidence(scope,e,'entitlement').reason,'invalid_evidence');
});
await test('missing mandatory historical facts and malformed deletion fail closed',()=>{
 for(const field of ['amount','amount_captured','amount_refunded','currency','paid','captured','created','customer','payment_intent']){const e=signed('charge.failed');delete e.data.object[field];assert.equal(evidence.prepareBillingWorkEvidence(scope,e,'finance').reason,'invalid_evidence');}
 const e=signed('customer.subscription.deleted');e.data.object.status='active';assert.equal(evidence.prepareBillingWorkEvidence(scope,e,'entitlement').reason,'invalid_evidence');
});
await test('strict nested allowlists reject added sensitive fields and excessive evidence',()=>{
 const r=prepare(signed('customer.subscription.deleted'),'entitlement');
 for(const change of [e=>e.email='PRIVATE',e=>e.object.metadata={secret:'PRIVATE'},e=>e.object.items.data[0].description='PRIVATE',e=>e.previous.raw='PRIVATE',e=>e.version=3,e=>e.api_version='a'.repeat(33000),e=>e.object.items.data.push(...Array(21).fill(e.object.items.data[0]))]){const c=structuredClone(r.evidence);change(c);assert.equal(evidence.validateWorkEvidence(c),false);}
 assert.ok(Buffer.byteLength(evidence.canonicalWorkEvidence(r.evidence))<32768);
});
await test('unsupported events produce fixed rejection',()=>assert.equal(evidence.prepareBillingWorkEvidence(scope,{...signed(),type:'payment_intent.created'},'finance').reason,'unsupported_event'));
await test('sensitive raw event fields excluded in every family',()=>{
 for(const type of events)for(const consumer of ['finance','entitlement']){const e=signed(type);Object.assign(e.data.object,{email:'PRIVATE',description:'PRIVATE',billing_details:{secret:'PRIVATE'},payment_method_details:{secret:'PRIVATE'},arbitrary_metadata:{secret:'PRIVATE'}});assert.doesNotMatch(JSON.stringify(prepare(e,consumer)),/PRIVATE|email|description|billing_details|payment_method_details|arbitrary_metadata/);}
});
await test('adapter disabled by default; independent one-action identities when opt-in supplied',async()=>{
 const calls=[],storage={rpc:async(name,args)=>{calls.push([name,args]);return {data:{state:'pending'},error:null};}},opt={approvedScope:scope,approval:'reviewed_staging_work_admission_v2'};
 assert.equal((await admission.admitBillingConsumerWork(storage,scope,signed(),'finance')).state,'disabled');assert.equal(calls.length,0);
 for(const consumer of ['finance','entitlement'])assert.equal((await admission.admitBillingConsumerWork(storage,scope,signed(),consumer,opt)).state,'admitted');
 assert.equal(calls.length,2);assert.deepEqual(calls.map(c=>c[1].p_consumer),['finance','entitlement']);for(const c of calls)assert.equal(c[0],'billing_consumer_work_admit');
});
await test('adapter never retries ambiguous failures or exposes errors',async()=>{
 let calls=0;const opt={approvedScope:scope,approval:'reviewed_staging_work_admission_v2'};
 for(const throwing of [false,true]){calls=0;const storage={rpc:async()=>{calls++;if(throwing)throw Error('PRIVATE_SECRET');return {data:null,error:{message:'PRIVATE_SECRET'}};}};const r=await admission.admitBillingConsumerWork(storage,scope,signed(),'finance',opt);assert.equal(r.reason,'admission_ambiguous');assert.equal(calls,1);assert.doesNotMatch(JSON.stringify(r),/PRIVATE|SECRET|cus_|evt_/);}
});
await test('live scope or malformed/unsupported evidence cannot invoke admission',async()=>{
 let calls=0;const storage={rpc:async()=>{calls++;throw Error('UNEXPECTED');}},opt={approvedScope:scope,approval:'reviewed_staging_work_admission_v2'};
 for(const [s,e,o] of [['acct_fixture:live',signed(),{...opt,approvedScope:'acct_fixture:live'}],[scope,{...signed(),created:-1},opt],[scope,{...signed(),type:'unknown'},opt],[scope,signed(),{...opt,approval:'wrong'}]])assert.equal((await admission.admitBillingConsumerWork(storage,s,e,'finance',o)).state,'rejected');assert.equal(calls,0);
});
await test('only reviewed disabled route imports; no provider calls, mutation, logging, or sensitive outputs',()=>{
 for(const p of paths){const source=fs.readFileSync(p,'utf8').replace('.update(canonicalWorkEvidence(evidence))','');assert.doesNotMatch(source,/console\.|logInfo|logError|fetch\(|process\.env|\.insert\(|\.update\(|\.delete\(|stripe\./);}
 for(const p of execFileSync('git',['ls-files','--cached','--others','--exclude-standard','src'],{encoding:'utf8'}).trim().split('\n'))if(!['src/app/api/stripe/webhook/route.ts', 'src/app/api/internal/billing-work/route.ts', 'src/lib/stripe/billing-work-admission.ts', 'src/lib/stripe/billing-work-config.ts', 'src/lib/stripe/billing-work-evidence.ts', 'src/lib/stripe/billing-work-handoff.ts', 'src/lib/stripe/billing-work-recovery.ts', 'src/lib/stripe/billing-work-routing.ts', 'src/lib/stripe/billing-work-runtime.ts', 'src/lib/stripe/billing-work-store.ts', 'src/lib/stripe/billing-work-worker.ts'].includes(p))assert.doesNotMatch(fs.readFileSync(p,'utf8'),/billing-work-(?:evidence|admission)/);
 // Recovery's reviewed body check is independent of admission/evidence. Preserve
 // its authentication, configuration and execution tail outside that exact check.
 const recoveryPath='src/lib/stripe/billing-work-recovery.ts';
 const recoveryTail=source=>source.slice(source.indexOf('/** No session auth')).replace('!await hasEmptyBody(request)','request.body!==null');
 assert.equal(recoveryTail(fs.readFileSync(recoveryPath,'utf8')),recoveryTail(execFileSync('git',['show','HEAD:'+recoveryPath],{encoding:'utf8'})));
 for(const changed of execFileSync('git',['diff','--name-only','HEAD','--','src','supabase/migrations'],{encoding:'utf8'}).trim().split('\n').filter(Boolean))assert.ok(['src/app/api/stripe/webhook/route.ts','src/middleware.ts','src/lib/stripe/billing-work-recovery.ts','src/lib/stripe/billing-work-runtime.ts','src/lib/stripe/billing-work-store.ts','src/lib/stripe/billing-work-worker.ts','src/lib/stripe/finance-contract.ts','src/lib/stripe/finance-customer-webhook.ts','src/lib/stripe/finance-store.ts','src/lib/stripe/webhook-consumers.ts'].includes(changed),'Only the reviewed disabled wiring may differ from HEAD');
});
console.log(`PASS billing work evidence/admission: ${count}/${count}`);

// Called only from the existing disposable Unix-socket cluster harness.
export async function validateWorkEvidenceDatabase(db){
 let total=0;const test=async(name,fn)=>{await fn();total++;console.log('PASS PostgreSQL v2 '+name);};
 const admit=async(e,c=e.consumer)=>db.query('SELECT billing_consumer_work_admit($1,$2,$3,$4)',[e.scope,e.event_id,c,{consumer_version:c+'_v1',event_type:e.event_type,event_created:e.event_created,evidence:e}]);
 await test('all family/consumer v2 digests exactly match PostgreSQL JSONB canonical SHA256',async()=>{
  for(const type of events)for(const consumer of ['finance','entitlement']){const raw=signed(type);raw.id='evt_v2'+total+events.indexOf(type)+consumer;const r=prepare(raw,consumer);await admit(r.evidence);const row=(await db.query('SELECT evidence_version,evidence_digest FROM billing_consumer_work WHERE stripe_scope=$1 AND stripe_event_id=$2 AND consumer=$3',[scope,raw.id,consumer])).rows[0];assert.equal(row.evidence_version,2);assert.equal(row.evidence_digest,r.digest);await admit(r.evidence);}
 });
 await test('historical field conflict cannot replace original signed snapshot',async()=>{
  const e=prepare({...signed('charge.failed'),id:'evt_historical'}).evidence;await admit(e);for(const field of ['created','amount','amount_refunded']){const c=structuredClone(e);c.object[field]++;await assert.rejects(admit(c),/BILLING_WORK_CONFLICT/);}
  const d=prepare({...signed('customer.subscription.deleted'),id:'evt_deletedhistorical'},'entitlement').evidence;await admit(d);const c=structuredClone(d);c.object.items.data[0].current_period_end++;await assert.rejects(admit(c),/BILLING_WORK_CONFLICT/);
 });
 await test('SQL independently rejects malformed nested/private/historical fields',async()=>{
  const base=prepare(signed('charge.failed')).evidence;
  for(const change of [e=>e.object.email='PRIVATE',e=>e.object.failure_code='PRIVATE',e=>delete e.object.amount,e=>e.object.amount=-1,e=>e.object.amount=0.5,e=>e.object.paid=true,e=>e.object.livemode=true,e=>e.consumer='entitlement',e=>e.object.id='ch_other',e=>e.customer='cus_other',e=>delete e.customer,e=>e.version=3]){const c=structuredClone(base);change(c);await assert.rejects(admit(c));}
 });
 await test('SQL enforces typed deletion identity, item bounds, periods and metadata exclusion',async()=>{
  const base=prepare(signed('customer.subscription.deleted'),'entitlement').evidence;
  for(const change of [e=>e.object.dmi_user_id='PRIVATE',e=>e.object.items.data[0].metadata={secret:'PRIVATE'},e=>e.object.items.data[0].current_period_end=-1,e=>e.object.items.data.push(...Array(21).fill(e.object.items.data[0])),e=>e.object.status='active']){const c=structuredClone(base);change(c);await assert.rejects(admit(c));}
 });
 await test('column identity cannot disagree with v2 envelope',async()=>{
  const e=prepare(signed()).evidence;await assert.rejects(db.query('SELECT billing_consumer_work_admit($1,$2,$3,$4)',[scope,'evt_wrong','finance',{consumer_version:'finance_v1',event_type:e.event_type,event_created:e.event_created,evidence:e}]));
 });
 await test('v1 routing-only rows cannot be admitted or replayed',async()=>{const v1={version:1,subject_type:'invoice',subject_id:'in_fixture'};assert.equal(evidence.validateWorkEvidence(v1),false);await assert.rejects(db.query('SELECT billing_consumer_work_admit($1,$2,$3,$4)',[scope,'evt_v1','finance',{consumer_version:'finance_v1',event_type:'invoice.paid',event_created:100,evidence:v1}]));});
 console.log(`PASS PostgreSQL work evidence: ${total}/${total}`);
}
