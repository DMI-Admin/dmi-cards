import Stripe from "stripe";
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {apiVersion,user,fixtureNow,sec,graphFixture,event} from './fixtures/finance-v1.mjs';
export function loadFinance(){
 const cache={};function load(file){if(cache[file])return cache[file];const exports={};cache[file]=exports;vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports,Error,Date,Intl,BigInt,Map,Set,Promise,require:name=>{if(name==='server-only')return {};if(name==='stripe')return {default:Stripe};if(name==='node:crypto')return {randomUUID};if(name.startsWith('.'))return load(path.join(path.dirname(file),name)+'.ts');throw Error('Unexpected import '+name);}});return exports;}
 return {evidence:load('src/lib/stripe/finance-event-evidence.ts'),consumer:load('src/lib/stripe/finance-webhook.ts'),sync:load('src/lib/stripe/finance-sync.ts'),reconcile:load('src/lib/stripe/finance-reconciliation.ts'),adapter:load('src/lib/stripe/finance-stripe-adapter.ts'),storeModule:load('src/lib/stripe/finance-store.ts')};
}
export function memoryHarness(scope){
 const rows={},deliveries=new Map(),runs=new Map();let lease=null,rev=0;
 const copy=x=>x==null?null:structuredClone(x);
 const store={
  async command(action,s,token,input={}){assert.equal(s,scope);
   if(action==='event_claim'){let d=deliveries.get(input.id);if(d?.state==='processed'||d?.state==='ignored')return {duplicate:true};if(d?.state==='processing')throw Error('FINANCE_BUSY');d={state:'processing',token:randomUUID()};deliveries.set(input.id,d);return {token:d.token};}
   if(action==='event_fail'){const d=deliveries.get(input.id);assert.equal(d.token,token);d.state='failed';return {};}
   if(action==='claim'){if(lease)throw Error('FINANCE_BUSY');lease=randomUUID();return {token:lease,revision:String(++rev)};}
   if(action==='release'){if(lease===token)lease=null;return {};}
   if(lease!==token)throw Error('FINANCE_FENCE');
   if(action==='run_start'){let run=runs.get(input.id);if(!run){run={id:input.id,stripe_scope:s,mode:input.mode,resource_type:input.resource,status:'running',window_start:input.start,window_end:input.end,cursor:{},error_count:0,processed_count:0};runs.set(input.id,run);}return copy(run);}
   assert.equal(action,'commit');assert.equal(input.expected_scope_revision,String(rev));
   if(input.event_id){const d=deliveries.get(input.event_id);assert.equal(d.token,input.event_token);assert.equal(d.state,'processing');}
   for(const resource of ['subscriptions','items','invoices','payments','allocations','attempts','refunds','activity'])for(const entry of input[resource]||[]){const row=entry.row,key=row.stripe_object_id??row.attempt_key??row.activity_key;rows[resource]||={};const old=rows[resource][key];
    if(old&&['activity','attempts'].includes(resource))continue;
    assert.equal(entry.expected_revision,String(old?.revision||0));
    const merged=copy(row);for(const [field,basis] of [['collected_at','collection_time_basis'],['succeeded_at','success_time_basis']])if(old?.[field]){merged[field]=old[field];merged[basis]=old[basis];}
    rows[resource][key]={...merged,revision:String(Number(old?.revision||0)+1)};
   }
   if(input.run){const patch=input.run,run=runs.get(patch.id);assert.deepEqual(copy(run.cursor),copy(patch.expected_cursor));run.cursor=copy(patch.cursor);run.status=patch.done?'completed':'partial';run.coverage_quality=patch.done&&patch.complete&&!run.error_count?'complete':'partial';if(!patch.complete)run.error_count++;run.processed_count+=patch.processed;}
   if(input.event_id)deliveries.get(input.event_id).state=input.ignored?'ignored':'processed';lease=null;rev++;return {};
  },
  async read(resource,s,id){assert.equal(s,scope);return copy(rows[resource]?.[id]||null);},
  async items(s,id){assert.equal(s,scope);return copy(Object.values(rows.items||{}).filter(x=>x.stripe_subscription_id===id));},
  async binding(s){assert.equal(s,scope);return {user_id:user,verified_at:fixtureNow};},
  async run(s,id){assert.equal(s,scope);return copy(runs.get(id)||null);},
 };
 return {store,all:async resource=>copy(Object.values(rows[resource]||{})),delivery:async id=>copy(deliveries.get(id)),failNext:()=>{const base=store.command;let fail=true;store.command=async(...args)=>{if(args[0]==='commit'&&fail){fail=false;throw Error('FINANCE_TEST_FAILURE');}return base(...args);};}};
}
export async function consumerScenarios(harness,scope='acct_consumer:test'){
 const {consumer,sync,reconcile}=loadFinance(),f=graphFixture();let graph=f.graph,graphFailure=false,actualScope=scope;
 const source={identity:async()=>({scope:actualScope,apiVersion}),graph:async()=>{if(graphFailure)throw Error('FINANCE_TEST_FAILURE');return structuredClone(graph);},scan:async()=>({roots:[{kind:'subscription',id:'sub_one'}],next:null,complete:false})};
 const runtime={source,store:harness.store,scope,apiVersion,now:()=>fixtureNow};
 const call=e=>consumer.consumeFinanceEvent(e,runtime);
 const created=event('created','customer.subscription.created',f.subscription);
 await call(created);assert.equal((await call(created)).outcome,'duplicate');assert.equal((await harness.all('subscriptions')).length,1);
 f.subscription.cancel_at_period_end=true;await call(event('cancel','customer.subscription.updated',f.subscription,{cancel_at_period_end:false}));
 f.subscription.cancel_at_period_end=false;await call(event('resume','customer.subscription.updated',f.subscription,{cancel_at_period_end:true}));
 const activity=await harness.all('activity');assert.ok(activity.some(x=>x.kind==='cancellation_scheduled'));assert.ok(activity.some(x=>x.kind==='cancellation_reversed'));
 graph.invoices=[f.invoice];await call(event('finalized','invoice.finalized',f.invoice));
 const finalized=event('finalized2','invoice.updated',f.invoice);await call(finalized);await call(finalized);assert.equal((await harness.all('invoices')).length,1);
 // Actual captured money is not the invoice face value: partial capture/payment.
 f.invoice.amount_paid=300;f.invoice.amount_remaining=299;f.charge.amount_captured=300;f.allocation.amount_paid=300;graph.charges=[f.charge];graph.allocations=[f.allocation];
 await call(event('capture','charge.succeeded',f.charge));
 let payments=await harness.all('payments');assert.equal(payments[0].amount_captured_minor,'300');assert.equal(payments[0].attribution_status,'verified');
 await call(event('captured','charge.captured',f.charge));assert.equal((await harness.all('payments')).length,1);
 f.invoice.status='paid';f.invoice.amount_paid=599;f.invoice.amount_remaining=0;f.invoice.status_transitions.paid_at=sec('2026-09-03');
 f.charge.amount_captured=599;f.allocation.amount_paid=599;
 await call(event('paid','invoice.paid',f.invoice));await call(event('paidDuplicateType','invoice.payment_succeeded',f.invoice));
 assert.equal((await harness.all('payments')).reduce((sum,x)=>sum+BigInt(x.amount_captured_minor),0n),599n);
 const old=event('old','invoice.updated',{...f.invoice,status:'open'});old.created=sec('2026-09-02');await call(old);assert.equal((await harness.all('invoices'))[0].status,'paid');
 // Failure evidence remains a failure occurrence even after successful recovery.
 const failed={...f.charge,id:'ch_failed',status:'failed',paid:false,captured:false,amount_captured:0,failure_code:'card_declined'};graph.charges.push(failed);
 await call(event('failed','charge.failed',failed));await call(event('failed','charge.failed',failed));assert.equal((await harness.all('attempts')).length,1);
 await call(event('recovered','invoice.paid',f.invoice));assert.equal((await harness.all('attempts')).length,1);
 graph.refunds=[f.refund];await call(event('refundPending','refund.created',f.refund));assert.equal((await harness.all('refunds'))[0].succeeded_at,null);
 f.refund.status='succeeded';f.charge.amount_refunded=100;await call(event('refundDone','refund.updated',f.refund,{status:'pending'}));
 const secondRefund={...f.refund,id:'re_two',amount:50,status:'failed'};graph.refunds.push(secondRefund);await call(event('refundFailed','refund.failed',secondRefund));
 assert.equal((await harness.all('refunds')).filter(x=>x.status==='succeeded').reduce((sum,x)=>sum+BigInt(x.amount_minor),0n),100n);
 const count=(await harness.all('activity')).length;await sync.synchronizeFinance(runtime,{kind:'invoice',id:'in_one'},'backfill');assert.equal((await harness.all('activity')).length,count);
 // A failed Finance delivery retries independently; receipt not falsely completed.
 graphFailure=true;const retry=event('retry','invoice.updated',f.invoice);await assert.rejects(call(retry));assert.equal((await harness.delivery(retry.id)).state,'failed');graphFailure=false;await call(retry);assert.equal((await harness.delivery(retry.id)).state,'processed');
 await assert.rejects(call({...created,id:'evt_live',livemode:true}),/SCOPE/);actualScope='acct_other:test';await assert.rejects(call({...created,id:'evt_account'}),/RUNTIME/);actualScope=scope;
 await assert.rejects(call({...created,id:'evt_version',api_version:'old'}),/COMPATIBILITY/);
 const saved=structuredClone(graph);graph=graphFixture().graph;graph.subscriptions[0].metadata.dmi_app='other';assert.equal((await call(event('foreign','customer.subscription.created',graph.subscriptions[0]))).outcome,'ignored');graph=saved;
 // Existing entitlement completion is independent (PG harness seeds its receipt).
 await call(event('entitlementAlreadyProcessed','invoice.updated',f.invoice));assert.equal((await harness.delivery('evt_entitlementAlreadyProcessed')).state,'processed');
 const run=await reconcile.startFinanceRun(runtime,{mode:'backfill',resource:'recent_failures',start:'2026-09-01T00:00:00Z',end:'2026-10-01T00:00:00Z',actor:'offline-admin'});
 const progress=await reconcile.resumeFinanceRun(runtime,run.id);assert.equal(progress.done,true);assert.equal(progress.complete,false);const persisted=await harness.store.run(scope,run.id);assert.equal(persisted.coverage_quality,'partial');
 const again=await reconcile.resumeFinanceRun(runtime,run.id);assert.equal(again.done,true);
 assert.equal((await harness.all('payments')).filter(x=>x.status==='succeeded').reduce((sum,x)=>sum+BigInt(x.amount_captured_minor),0n),599n);
 // Failure of either consumer leaves the other's independent completion intact.
 const orchestration=event('orchestration','invoice.updated',f.invoice);
 await assert.rejects(consumer.orchestrateBillingConsumers(orchestration,async()=>{throw Error('entitlement fixture failure');},runtime),/RETRY_REQUIRED/);
 assert.equal((await harness.delivery(orchestration.id)).state,'processed');
 await consumer.orchestrateBillingConsumers(orchestration,async()=>true,runtime);
 graphFailure=true;let entitlementSucceeded=false;
 const orchestration2=event('orchestration2','invoice.updated',f.invoice);
 await assert.rejects(consumer.orchestrateBillingConsumers(orchestration2,async()=>{entitlementSucceeded=true;},runtime),/RETRY_REQUIRED/);
 assert.equal(entitlementSucceeded,true);assert.equal((await harness.delivery(orchestration2.id)).state,'failed');graphFailure=false;await call(orchestration2);
 // Same-second transitions still serialize by revision; unknown metadata cannot link.
 graph=graphFixture().graph;graph.subscriptions[0].metadata.dmi_user_id='22222222-2222-4222-8222-222222222222';
 await assert.rejects(call(event('conflicting','customer.subscription.updated',graph.subscriptions[0])),/ATTRIBUTION/);
 graph=graphFixture().graph;graph.subscriptions[0].livemode=true;await assert.rejects(call(event('graphMode','customer.subscription.updated',graph.subscriptions[0])),/SCOPE/);
 graph=graphFixture().graph;
 // Two bounded pages: resume from the committed cursor; completion is not row count.
 source.scan=async ({after})=>({roots:[{kind:'subscription',id:'sub_one'}],next:after?null:'sub_page',complete:true});
 const pages=await reconcile.startFinanceRun(runtime,{mode:'reconcile',resource:'active_subscriptions',start:'2026-09-01T00:00:00Z',end:'2026-10-01T00:00:00Z',actor:'offline-admin'});
 assert.equal((await reconcile.resumeFinanceRun(runtime,pages.id)).done,false);
 assert.equal((await harness.store.run(scope,pages.id)).cursor.after,'sub_page');
 assert.equal((await reconcile.resumeFinanceRun(runtime,pages.id)).complete,true);
 // Verified deletion records the terminal transition without touching entitlement.
 graph.subscriptions[0].status='canceled';graph.subscriptions[0].ended_at=sec('2026-09-10');
 await call(event('ended','customer.subscription.deleted',graph.subscriptions[0]));
 assert.ok((await harness.all('activity')).some(x=>x.kind==='subscription_ended'));
 // Unresolved linkage can be mirrored but never promoted to attributed totals.
 const binding=harness.store.binding;harness.store.binding=async()=>null;
 graph=graphFixture().graph;graph.subscriptions[0].id='sub_unresolved';graph.subscriptions[0].items.data[0].id='si_unresolved';
 await call(event('unresolved','customer.subscription.created',graph.subscriptions[0]));assert.equal((await harness.all('subscriptions')).find(x=>x.stripe_object_id==='sub_unresolved').linkage_status,'unresolved');harness.store.binding=binding;
 // Zero-value / paid-out-of-band invoices do not create charge collections.
 graph.invoices=[{...f.invoice,id:'in_zero',parent:{type:'subscription_details',subscription_details:{subscription:'sub_unresolved'}},total:0,subtotal:0,amount_due:0,amount_paid:0,amount_remaining:0}];
 await call(event('zero','invoice.paid',graph.invoices[0]));graph.invoices[0]={...graph.invoices[0],id:'in_oob',total:599,subtotal:599,amount_due:599,amount_paid:599};await call(event('oob','invoice.paid',graph.invoices[0]));
 assert.equal((await harness.all('payments')).filter(x=>x.status==='succeeded').reduce((sum,x)=>sum+BigInt(x.amount_captured_minor),0n),599n);
 await legacyRefundScenarios(harness,scope);
 console.log('PASS: consumer duplicate/overlap, partial capture/payment, zero/out-of-band, failure/recovery, refunds, cancellation transitions, current-state refresh, independent retry, scope/version/foreign/unresolved isolation, historical suppression and partial resumable coverage.');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await consumerScenarios(memoryHarness('acct_consumer:test'));

// Also executed against the real writer by validate-finance-writer.mjs.
async function legacyRefundScenarios(h,scope){
 const {consumer}=loadFinance();
 const f=JSON.parse(JSON.stringify(graphFixture()).replaceAll('_one','_legacy').replaceAll('cus_legacy','cus_one'));
 f.graph.invoices=[f.invoice];f.graph.charges=[f.charge];f.graph.allocations=[f.allocation];
 f.refund.status='succeeded';f.graph.refunds=[f.refund];f.charge.amount_refunded=100;
 let root,fail=false;
 const r={scope,apiVersion,now:()=>fixtureNow,store:h.store,source:{identity:async()=>({scope,apiVersion}),graph:async x=>{root=x;if(fail)throw Error('FINANCE_PAGINATION_BOUND');return structuredClone(f.graph);}}};
 const send=(id,type,obj=f.charge,previous={})=>consumer.consumeFinanceEvent(event('legacy'+id,type,obj,previous),r);
 const refunds=async()=>(await h.all('refunds')).filter(x=>x.stripe_charge_id==='ch_legacy');
 const activity=async()=>(await h.all('activity')).filter(x=>x.kind==='refund_issued'&&x.object_id.startsWith('re_legacy'));
 const first=await send('Discovery','charge.refunded');assert.equal(first.complete,false);assert.equal(root.kind,'charge');
 assert.equal((await refunds())[0].amount_minor,'100');assert.equal((await refunds())[0].succeeded_at,null);assert.equal((await refunds())[0].success_time_basis,'unknown');assert.equal((await activity()).length,0);
 assert.equal((await send('Discovery','charge.refunded')).outcome,'duplicate');
 f.graph.refunds.push({...f.refund,id:'re_legacyTwo',amount:200});f.charge.amount_refunded=300;
 await send('Partial','charge.refunded');assert.equal((await refunds()).length,2);
 f.graph.refunds.push({...f.refund,id:'re_legacyThree',amount:299});f.charge.amount_refunded=599;
 await send('Full','charge.refunded');assert.equal((await refunds()).reduce((n,x)=>n+BigInt(x.amount_minor),0n),599n);
 await send('NoTransition','charge.refund.updated',f.refund);assert.equal(root.kind,'refund');assert.equal((await activity()).length,0);
 await send('Transition','charge.refund.updated',f.refund,{status:'pending'});
 let saved=(await refunds()).find(x=>x.stripe_object_id==='re_legacy');assert.equal(saved.success_time_basis,'verified_event');assert.equal(Date.parse(saved.succeeded_at),event('x','x',{}).created*1000);assert.equal((await activity()).length,1);
 await send('Overlap','refund.updated',f.refund,{status:'pending'});await send('Refresh','charge.refunded');
 const delayed=event('legacyDelayed','refund.failed',{...f.refund,status:'failed'});delayed.created-=100;
 await consumer.consumeFinanceEvent(delayed,r);assert.equal((await activity()).length,1);assert.equal((await refunds()).find(x=>x.stripe_object_id==='re_legacy').succeeded_at,saved.succeeded_at);assert.equal((await refunds()).find(x=>x.stripe_object_id==='re_legacy').status,'succeeded');
 for(const status of ['pending','failed','canceled']){
  const refund={...f.refund,id:'re_legacy'+status,status,amount:1};f.graph.refunds.push(refund);
  await send(status,status==='failed'?'refund.failed':'charge.refund.updated',refund,{status:'pending'});
  const row=(await refunds()).find(x=>x.stripe_object_id===refund.id);assert.equal(row.succeeded_at,null);assert.equal(row.status,status);
 }
 const before=JSON.stringify(await refunds());
 for(const [name,patch,pattern] of [['Currency',{currency:'usd'},/CURRENCY/],['Link',{charge:'ch_missing'},/PAYMENT_MISSING/],['Mode',{livemode:true},/SCOPE/]]){
  const old=f.graph.refunds[0];f.graph.refunds[0]={...old,...patch};await assert.rejects(send(name,'charge.refunded'),pattern);f.graph.refunds[0]=old;assert.equal(JSON.stringify(await refunds()),before);
 }
 await assert.rejects(consumer.consumeFinanceEvent({...event('legacyScope','charge.refunded',f.charge),account:'acct_wrong'},r),/SCOPE/);
 fail=true;await assert.rejects(send('Bound','charge.refunded'),/PAGINATION_BOUND/);assert.equal((await h.delivery('evt_legacyBound')).state,'failed');assert.equal(JSON.stringify(await refunds()),before);
 fail=false;await send('Bound','charge.refunded');
 // Valid transition for a different Refund cannot supply this Refund's timestamp.
 assert.equal((await refunds()).find(x=>x.stripe_object_id==='re_legacyTwo').succeeded_at,null);
 console.log('PASS: legacy refund roots, partial/full ID deduplication, overlap/retry, exact transition timing, delayed failures, timestamp preservation, scope/linkage/currency rejection and atomic failure.');
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
 const {consumer}=loadFinance(),scope='acct_sdkdecimal:test',h=memoryHarness(scope),f=graphFixture();
 const signedEvent=event('sdkDecimal','customer.subscription.updated',f.subscription);
 f.subscription.items.data[0].price.unit_amount_decimal=Stripe.Decimal.from('599');
 const r={scope,apiVersion,now:()=>fixtureNow,store:h.store,source:{identity:async()=>({scope,apiVersion}),graph:async()=>f.graph}};
 await consumer.consumeFinanceEvent(signedEvent,r);
 assert.equal((await h.delivery(signedEvent.id)).state,'processed');assert.equal((await h.all('items'))[0].unit_amount_decimal_minor,'599');
 assert.equal((await consumer.consumeFinanceEvent(signedEvent,r)).outcome,'duplicate');assert.equal((await h.all('items')).length,1);
 console.log('PASS: real SDK Decimal survives current-object consumer path, commits exact 599 text and remains duplicate-safe.');
}
