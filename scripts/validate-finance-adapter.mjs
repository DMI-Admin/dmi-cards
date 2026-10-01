import assert from 'node:assert/strict';
import fs from 'node:fs';
import {loadFinance,memoryHarness} from './validate-finance-consumer.mjs';
import {graphFixture,apiVersion,fixtureNow,event} from './fixtures/finance-v1.mjs';
const {adapter}=loadFinance(),f=graphFixture(),calls=[];
function method(name,callback){return async(...args)=>{calls.push({name,args});const options=args.at(-1);assert.equal(options.apiVersion,apiVersion);assert.equal(options.maxNetworkRetries,0);return callback(...args);};}
const stripe={
 accounts:{retrieve:method('accounts.retrieve',id=>{assert.equal(id,null);return {id:'acct_adapter'};})},balance:{retrieve:method('balance.retrieve',()=>({livemode:false}))},
 customers:{retrieve:method('customers.retrieve',()=>f.graph.customers[0])},
 subscriptions:{retrieve:method('subscriptions.retrieve',()=>f.subscription),list:method('subscriptions.list',()=>({data:[f.subscription],has_more:false}))},
 invoices:{retrieve:method('invoices.retrieve',()=>f.invoice),list:method('invoices.list',()=>({data:[f.invoice],has_more:false}))},
 invoicePayments:{retrieve:method('invoicePayments.retrieve',()=>f.allocation),list:method('invoicePayments.list',()=>({data:[f.allocation],has_more:false}))},
 charges:{retrieve:method('charges.retrieve',()=>f.charge),list:method('charges.list',()=>({data:[f.charge],has_more:false}))},
 refunds:{retrieve:method('refunds.retrieve',()=>f.refund),list:method('refunds.list',()=>({data:[f.refund],has_more:false}))},
};
const source=adapter.stripeFinanceSource(stripe);
assert.equal((await source.identity()).scope,'acct_adapter:test');
const graph=await source.graph({kind:'refund',id:'re_one'});
for(const key of ['subscriptions','customers','invoices','allocations','charges','refunds'])assert.equal(graph[key].length,1);
const input={start:'2026-09-01T00:00:00Z',end:'2026-10-01T00:00:00Z'};
for(const resource of ['recent_invoices','open_invoices','pending_refunds','active_subscriptions','recent_failures']){
 const page=await source.scan({...input,resource});assert.equal(page.complete,resource!=='recent_failures');
 const call=calls.at(-1);assert.equal(call.args[0].limit,20);
 if(['open_invoices','pending_refunds','active_subscriptions'].includes(resource))assert.equal(call.args[0].created,undefined);
 else assert.ok(call.args[0].created.gte<call.args[0].created.lt);
}
stripe.invoicePayments.list=method('invoicePayments.list',()=>({data:[f.allocation],has_more:true}));
await assert.rejects(source.graph({kind:'invoice',id:'in_one'}),/PAGINATION_BOUND/);
f.subscription.items.has_more=true;await assert.rejects(source.graph({kind:'subscription',id:'sub_one'}),/ITEMS_BOUND/);
assert.ok(calls.every(x=>/\.(retrieve|list)$/.test(x.name)));
const route=fs.readFileSync('src/app/api/stripe/webhook/route.ts','utf8');assert.match(route,/handleStripeWebhookConsumers/);assert.match(route,/constructStripeWebhookEvent/);
const sql=fs.readFileSync('supabase/migrations/20260930130000_finance_v1_writer.sql','utf8');
assert.doesNotMatch(sql,/(?:INSERT INTO|UPDATE|DELETE FROM) public\.(?:billing_subscriptions|billing_accounts|stripe_webhook_events)\b/i);
assert.match(fs.readFileSync('src/lib/supabase-admin.ts','utf8'),/import "server-only"/);
console.log('PASS: injectable read-only Stripe adapter, pinned request version, current parent/allocation graph, deduplication, bounded paging, all-open/old-pending scans, partial failure coverage, signature entrypoint retained and no entitlement writers.');
// The real Supabase adapter retains exact SQL decimal/bigint text and exact scope.
const {storeModule}=loadFinance();let query;
const db={from(table){query={table,filters:[]};const chain={select(value){query.select=value;return chain;},eq(k,v){query.filters.push([k,v]);return chain;},limit(){return chain;},returns(){return chain;},async maybeSingle(){return {data:null,error:null};}};return chain;}};
const store=storeModule.createFinanceStore(db);
await store.read('items','acct_store:test','si_one');
assert.deepEqual(query.filters,[['stripe_scope','acct_store:test'],['stripe_object_id','si_one']]);
assert.match(query.select,/unit_amount_decimal_minor::text/);assert.match(query.select,/quantity::text/);assert.match(query.select,/revision::text/);assert.doesNotMatch(query.select,/\*/);
await store.read('payments','acct_store:live','ch_one');assert.match(query.select,/amount_captured_minor::text/);
console.log('PASS: server store exact scope filters and pre-JSON bigint/decimal text casts.');

// Actual adapter + consumer: embedded Charge refunds are never the inventory.
f.subscription.items.has_more=false;
stripe.invoicePayments.list=method('invoicePayments.list',()=>({data:[f.allocation],has_more:false}));
const refundRows=[{...f.refund,status:'succeeded'},{...f.refund,id:'re_two',amount:200,status:'succeeded'}];
stripe.refunds.retrieve=method('refunds.retrieve',id=>refundRows.find(x=>x.id===id));
stripe.refunds.list=method('refunds.list',p=>{assert.equal(p.charge,'ch_one');return p.starting_after?{data:[refundRows[1]],has_more:false}:{data:[refundRows[0]],has_more:true};});
const {consumer}=loadFinance(),h=memoryHarness('acct_adapter:test');
const runtime={scope:'acct_adapter:test',apiVersion,now:()=>fixtureNow,store:h.store,source};
for(const [i,embedded] of [undefined,{data:[f.refund],has_more:true}].entries()){
 f.charge.refunds=embedded;
 await consumer.consumeFinanceEvent(event('adapterRefund'+i,'charge.refunded',f.charge),runtime);
 assert.equal((await h.all('refunds')).length,2);assert.ok((await h.all('refunds')).every(x=>x.succeeded_at===null));
}
const baseline=JSON.stringify(await h.all('refunds'));
stripe.refunds.list=method('refunds.list',()=>({data:[refundRows[0]],has_more:true}));
await assert.rejects(consumer.consumeFinanceEvent(event('refundPageBound','charge.refunded',f.charge),runtime),/PAGINATION_BOUND/);
assert.equal(JSON.stringify(await h.all('refunds')),baseline);assert.equal((await h.delivery('evt_refundPageBound')).state,'failed');
const many=Array.from({length:65},(_,i)=>({...f.refund,id:'re_many'+i}));
stripe.refunds.list=method('refunds.list',()=>({data:many,has_more:false}));
stripe.refunds.retrieve=method('refunds.retrieve',id=>many.find(x=>x.id===id));
await assert.rejects(consumer.consumeFinanceEvent(event('refundReadBound','charge.refunded',f.charge),runtime),/GRAPH_BOUND/);assert.equal(JSON.stringify(await h.all('refunds')),baseline);
// A list claiming a Refund belongs to A must not silently retrieve/link it to B.
stripe.refunds.list=method('refunds.list',p=>({data:p.charge==='ch_one'?[f.refund]:[],has_more:false}));
stripe.refunds.retrieve=method('refunds.retrieve',()=>({...f.refund,charge:'ch_other'}));
stripe.charges.retrieve=method('charges.retrieve',id=>({...f.charge,id}));
await assert.rejects(source.graph({kind:'charge',id:'ch_one'}),/REFUND_CHARGE/);
console.log('PASS: paginated Refund discovery ignores embedded lists; pagination/read exhaustion commits no state; listed/retrieved Charge linkage checked.');
