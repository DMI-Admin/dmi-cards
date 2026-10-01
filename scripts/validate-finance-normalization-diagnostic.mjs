import Stripe from "stripe";
import assert from 'node:assert/strict';
import {projectSubscription,diagnoseSubscription} from './lib/finance-normalization-diagnostic.mjs';
import {flexibleStagingShape} from './fixtures/finance-webhook-2023.mjs';
import {apiVersion,fixtureNow,user,event} from './fixtures/finance-v1.mjs';
const c={scope:'acct_fixture:test',apiVersion,verifiedAt:fixtureNow,event:{id:'evt_synthetic',type:'customer.subscription.updated',created:event('x','x',{}).created,subjectId:'sub_one'}};
const f=flexibleStagingShape();
assert.equal(diagnoseSubscription(f.subscription,c,user).status,'passed');
const broken=structuredClone(f.subscription);delete broken.items.data[0].created;
const d=diagnoseSubscription(broken,c,user);assert.equal(d.status,'failed');assert.equal(d.helper,'iso');assert.ok(d.fieldPath.includes('iso(o.created)'));assert.ok(d.fieldPath.some(x=>x.startsWith('provenance(it,')));
const poison='NEVER_EXPOSE_123';f.subscription.customer=poison;f.subscription.metadata={private:poison};f.subscription.email=poison;f.subscription.items.data[0].price.product={id:poison};f.subscription.items.data[0].price.currency=poison;
const safe=JSON.stringify({projection:projectSubscription(f.subscription,c,poison),diagnostic:diagnoseSubscription(f.subscription,c,poison)});
assert.doesNotMatch(safe,new RegExp(poison));assert.doesNotMatch(safe,/11111111-1111|cus_one|sub_one|evt_synthetic/);
console.log('PASS: local-only structural projection, static helper/call-site trace, passing baseline, failing item.created isolation and private-data exclusion.');

// TEMPORARY runtime assertion observer: remove after the staging checkpoint.
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const load=(file,deps={},source=fs.readFileSync(file,'utf8'))=>{const exports={};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports,Error,Date,Intl,BigInt,require:name=>{if(name==='server-only')return {};if(name==='stripe')return {default:Stripe};assert.ok(name in deps,name);return deps[name];}});return exports;};
const metrics=load('src/lib/stripe/finance-metrics.ts');
const normalizer=load('src/lib/stripe/finance-normalize.ts',{'./finance-metrics':metrics});
const {createWebhookObserver}=load('src/lib/stripe/webhook-observer.ts');
const base=flexibleStagingShape().subscription;
const logs=[];
assert.equal(JSON.stringify(normalizer.normalizeSubscription(base,c,user,x=>logs.push(x))),JSON.stringify(normalizer.normalizeSubscription(base,c,user)));
assert.equal(logs.length,0);
for(const [path,mutate] of [
 ['subscription.created',s=>delete s.created],
 ['subscription.items[].created',s=>delete s.items.data[0].created],
 ['subscription.items[].price.tax_behavior',s=>s.items.data[0].price.tax_behavior=null],
 ['subscription.items[].price.currency',s=>s.items.data[0].price.currency=poison],
 ['subscription.items[].price.product',s=>s.items.data[0].price.product=poison],
 ['subscription.items[].discounts',s=>s.items.data[0].discounts={}],
 ['subscription.items[].current_period_end',s=>s.items.data[0].current_period_end=1],
 ['subscription.items[].price.unit_amount',s=>s.items.data[0].price.unit_amount=600],
 ['subscription.items[].price.billing_scheme',s=>delete s.items.data[0].price.billing_scheme],
]){
 const input=structuredClone(base);mutate(input);const emitted=[],safeLogs=[];
 const observer=createWebhookObserver({requestId:'offline',stripeEventId:'evt_private',stripeEventType:'customer.subscription.updated',consumer:'finance'},x=>safeLogs.push(x));
 let observedError;
 assert.throws(()=>normalizer.normalizeSubscription(input,c,user,x=>{emitted.push(x);observer.assertion(x);}),e=>{observedError=e;return e.message==='FINANCE_MALFORMED_STRIPE_DATA';});
 assert.equal(emitted.length,1);assert.equal(emitted[0].fieldPath,path);
 assert.equal(safeLogs.length,1);assert.equal(safeLogs[0].fieldPath,path);assert.doesNotMatch(JSON.stringify(safeLogs),/evt_private|NEVER_EXPOSE|cus_one|sub_one|11111111/);
 assert.throws(()=>normalizer.normalizeSubscription(input,c,user),e=>e.message===observedError.message);
 assert.throws(()=>normalizer.normalizeSubscription(input,c,user,()=>{throw Error('logger failure');}),e=>e.message===observedError.message);
 assert.doesNotMatch(JSON.stringify(emitted),/NEVER_EXPOSE|cus_one|sub_one|11111111/);
}
console.log('PASS: assertion field isolation; unchanged successful values/errors; first-failure only; broken observer safety; no raw values.');

// Every subscription-facing malformed-data check, including nested helpers.
const cases=[];
function put(o,path,value){const parts=path.split('.');const last=parts.pop();for(const p of parts)o=o[p];o[last]=value;}
for(const [path,value] of [
 ['id','bad'],['created',-1],['livemode',null],['metadata',null],['customer',[]],['status',''],
 ['cancel_at_period_end',null],['cancel_at',-1],['canceled_at',-1],['ended_at',-1],['trial_end',-1],
 ['items',null],['items.has_more',null],['items.data',{}],['discounts',null],
 ['items.data.0',null],['items.data.0.id','bad'],['items.data.0.created',-1],['items.data.0.quantity',-1],
 ['items.data.0.current_period_start',-1],['items.data.0.current_period_end',-1],['items.data.0.discounts',null],
 ['items.data.0.price',null],['items.data.0.price.id','bad'],['items.data.0.price.product',[]],
 ['items.data.0.price.currency',''],['items.data.0.price.currency','GBP'],['items.data.0.price.billing_scheme',''],
 ['items.data.0.price.tax_behavior',''],['items.data.0.price.unit_amount',0.5],['items.data.0.price.unit_amount',{}],
 ['items.data.0.price.unit_amount','1.5'],['items.data.0.price.unit_amount','9223372036854775808'],
 ['items.data.0.price.unit_amount_decimal',123],['items.data.0.price.unit_amount',600],
 ['items.data.0.price.recurring',null],['items.data.0.price.recurring.interval',''],['items.data.0.price.recurring.interval','invalid'],
 ['items.data.0.price.recurring.interval_count',0],['items.data.0.price.recurring.interval_count',2147483648],
 ['items.data.0.price.recurring.usage_type',''],
])cases.push({path:'subscription.'+path.replace('.data.0','[]'),mutate:s=>put(s,path,value)});
cases.push({path:'subscription',input:null});
cases.push({path:'subscription.items.data',mutate:s=>s.items.data=Array(10001).fill(null)});
cases.push({path:'subscription.items[].id',mutate:s=>s.items.data.push(structuredClone(s.items.data[0]))});
cases.push({path:'subscription.items[].current_period_end',mutate:s=>s.items.data[0].current_period_end=s.items.data[0].current_period_start});
cases.push({path:'subscription.items[].effective_cycle_amount_minor',mutate:s=>{s.items.data[0].price.tax_behavior='exclusive';s.items.data[0].quantity='9223372036854775807';}});
for(const [path,value] of [['scope','bad'],['verifiedAt','bad'],['apiVersion',''],['event.id','bad'],['event.created',-1],['event.type',''],['event.subjectId','']])cases.push({path:'context',context:x=>put(x,path,value)});
cases.push({path:'context.verified_user',user:'PRIVATE_INVALID_USER'});
const coupon={id:'di_fixture',start:1700000000,end:null,source:{coupon:{id:'coupon_fixture',percent_off:10,amount_off:null,currency:null,duration:'forever'}}};
for(const prefix of ['discounts','items.data.0.discounts'])for(const [path,value] of [
 ['',null],['source',[]],['source.coupon',[]],['id','bad'],['start',-1],['end',-1],
 ['source.coupon.id',''],['source.coupon.percent_off',101],['source.coupon.amount_off',-1],['source.coupon.currency','BAD'],
])cases.push({path:'subscription.'+prefix.replace('.data.0','[]')+'[]'+(path?'.'+path.replace('source.coupon','coupon'):''),mutate:s=>{put(s,prefix,[structuredClone(coupon)]);put(s,prefix+'.0'+(path?'.'+path:''),value);}});
let checked=0;
for(const test of cases){
 const input='input' in test?test.input:structuredClone(base),context=structuredClone(c);test.mutate?.(input);test.context?.(context);
 const safeLogs=[];const observer=createWebhookObserver({requestId:'offline',stripeEventId:'evt_fixture',stripeEventType:'customer.subscription.updated',consumer:'finance'},x=>safeLogs.push(x));
 const normalize=callback=>normalizer.normalizeSubscription(input,context,test.user??user,callback);
 assert.throws(()=>observer.sync('normalization',()=>normalize(observer.assertion)),e=>e.message==='FINANCE_MALFORMED_STRIPE_DATA',test.path);
 const failures=safeLogs.filter(x=>x.outcome==='failed');assert.equal(failures.length,1,test.path);
 const row=failures[0];assert.equal(row.fieldPath,test.path);assert.equal(typeof row.check,'string');assert.equal(typeof row.present,'boolean');assert.equal(typeof row.primitiveType,'string');assert.equal(row.errorCode,'FINANCE_MALFORMED_STRIPE_DATA');
 assert.throws(()=>normalize(),/FINANCE_MALFORMED_STRIPE_DATA/);assert.throws(()=>normalize(()=>{throw Error('sink failed');}),/FINANCE_MALFORMED_STRIPE_DATA/);
 assert.doesNotMatch(JSON.stringify(failures),/PRIVATE_INVALID_USER|cus_one|sub_one|price_month|11111111/);checked++;
}
// A future missed wrapper must still report once, preserving the exact thrown object.
const sentinel=new Error('FINANCE_MALFORMED_STRIPE_DATA');
const source=fs.readFileSync('src/lib/stripe/finance-normalize.ts','utf8').replace('const mixed=new Set','throw require("fault").sentinel; const mixed=new Set');
const faulted=load('src/lib/stripe/finance-normalize.ts',{'./finance-metrics':metrics,fault:{sentinel}},source);
const fallback=[];assert.throws(()=>faulted.normalizeSubscription(base,c,user,x=>fallback.push(x)),e=>e===sentinel);assert.equal(fallback.length,1);assert.equal(fallback[0].check,'normalization_boundary');assert.equal(fallback[0].fieldPath,'subscription');
console.log(`PASS: ${checked} malformed subscription/helper cases; one correlated diagnostic each; original code and fail-safe observer; boundary preserves error identity.`);
