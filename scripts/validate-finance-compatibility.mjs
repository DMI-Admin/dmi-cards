import assert from 'node:assert/strict';
import {loadFinance,memoryHarness} from './validate-finance-consumer.mjs';
import {legacyEvents,flexibleStagingShape} from './fixtures/finance-webhook-2023.mjs';
import {graphFixture,apiVersion,fixtureNow,event} from './fixtures/finance-v1.mjs';
const {consumer,evidence}=loadFinance();
for(const e of legacyEvents()){
 const clean=evidence.reviewedFinanceEvent(e);assert.equal(clean.api_version,'2023-10-16');assert.equal(clean.created,e.created);assert.equal(clean.id,e.id);
 for(const field of ['items','subscription','invoice','charge','payment_intent','amount_paid','current_period_start','current_period_end','billing_details']){
  if(e.type==='charge.failed'&&field==='payment_intent')continue;
  assert.equal(clean.data.object[field],undefined,`${e.type}: ${field} must not become canonical state`);
 }
 assert.throws(()=>evidence.reviewedFinanceEvent({...e,api_version:apiVersion}),/FINANCE_WEBHOOK_COMPATIBILITY/);
 assert.throws(()=>evidence.reviewedFinanceEvent({...e,api_version:null}),/FINANCE_WEBHOOK_COMPATIBILITY/);
}
const scope='acct_compatibility:test',h=memoryHarness(scope),f=graphFixture();let reads=0;
const runtime={scope,apiVersion,now:()=>fixtureNow,store:h.store,source:{identity:async()=>({scope,apiVersion}),graph:async()=>{reads++;return structuredClone(f.graph);}}};
await consumer.consumeFinanceEvent(legacyEvents()[0],runtime);
f.invoice.status='paid';f.invoice.amount_paid=599;f.invoice.amount_remaining=0;f.invoice.status_transitions.paid_at=1760000000;
f.graph.invoices=[f.invoice];f.graph.charges=[f.charge];f.graph.allocations=[f.allocation];
const paid=legacyEvents().find(e=>e.type==='invoice.paid');await consumer.consumeFinanceEvent(paid,runtime);
assert.equal((await h.all('invoices'))[0].amount_paid_minor,'599');assert.equal((await h.all('invoices'))[0].stripe_subscription_id,'sub_one');
assert.equal((await h.all('invoices'))[0].stripe_api_version,apiVersion);
assert.equal((await h.all('invoices'))[0].source_event_id,paid.id);
assert.equal((await h.all('invoices'))[0].source_event_created_at,new Date(paid.created*1000).toISOString());
const n=reads;await consumer.consumeFinanceEvent(paid,runtime);assert.equal(reads,n);
assert.equal((await h.all('payments')).length,1);
assert.equal((await consumer.consumeFinanceEvent(event('allocationUnsupported','invoice_payment.paid',f.allocation),runtime)).outcome,'ignored');assert.equal(reads,n);
const failure=legacyEvents().find(e=>e.type==='charge.failed');await consumer.consumeFinanceEvent(failure,runtime);
let attempts=await h.all('attempts');assert.equal(attempts[0].attempt_key,'charge:ch_one');assert.equal(attempts[0].stripe_api_version,'2023-10-16');assert.equal(attempts[0].amount_minor,'599');
assert.equal(attempts[0].occurred_at,new Date(failure.created*1000).toISOString());
await consumer.consumeFinanceEvent({...failure,id:'evt_failureSecondDelivery'},runtime);assert.equal((await h.all('attempts')).length,1);
await assert.rejects(consumer.consumeFinanceEvent({...failure,id:'evt_wrongCurrency',data:{object:{...failure.data.object,currency:'usd'}}},runtime),/FAILURE_IDENTITY/);
await assert.rejects(consumer.consumeFinanceEvent({...failure,id:'evt_missingAmount',data:{object:{...failure.data.object,amount:undefined}}},runtime),/FAILURE_IDENTITY/);
// Current success alone never invents refund completion time.
f.graph.refunds=[{...f.refund,status:'succeeded'}];
await consumer.consumeFinanceEvent(event('refundNoTransition','refund.updated',f.graph.refunds[0]),runtime);assert.equal((await h.all('refunds'))[0].succeeded_at,null);
await consumer.consumeFinanceEvent(event('refundTransition','refund.updated',f.graph.refunds[0],{status:'pending'}),runtime);assert.ok((await h.all('refunds'))[0].succeeded_at);
console.log('PASS: reviewed 2023 webhook contract; unsupported versions fail; legacy relationship/amount fields excluded; current normalization and provenance; deterministic failed attempts with identity checks; refund transition-only timing; allocation event deferred.');

const legacyUpdate=legacyEvents().find(e=>e.type==='charge.refund.updated');
const sanitized=evidence.reviewedFinanceEvent({...legacyUpdate,data:{...legacyUpdate.data,object:{...legacyUpdate.data.object,captured:true,amount_captured:999}}});
assert.equal(sanitized.data.object.captured,undefined);assert.equal(sanitized.data.object.amount_captured,undefined);assert.equal(sanitized.data.previous_attributes.status,'pending');
const chargeDiscovery=evidence.reviewedFinanceEvent(legacyEvents().find(e=>e.type==='charge.refunded'));
assert.equal(chargeDiscovery.data.object.refunds,undefined);
console.log('PASS: legacy Refund update classified before generic Charge evidence; embedded refunds excluded.');

// Supplied shape must not be misdiagnosed as malformed tax behavior/billing mode.
const shaped=flexibleStagingShape(),shapeScope='acct_synthetic:test',shapeStore=memoryHarness(shapeScope);
const shapeRuntime={scope:shapeScope,apiVersion,now:()=>fixtureNow,store:shapeStore.store,source:{identity:async()=>({scope:shapeScope,apiVersion}),graph:async()=>structuredClone(shaped.graph)}};
const shapeEvent=event('syntheticFlexible','customer.subscription.updated',shaped.subscription);
assert.equal((await consumer.consumeFinanceEvent(shapeEvent,shapeRuntime)).outcome,'processed');
const sub=(await shapeStore.all('subscriptions'))[0],item=(await shapeStore.all('items'))[0];
assert.equal(sub.linkage_status,'verified');assert.equal(sub.valuation_reason,'tax_basis_unresolved');
assert.equal(item.tax_behavior,'unspecified');assert.equal(item.valuation_status,'unsupported');assert.equal(item.unit_amount_minor,'599');assert.equal(item.unit_amount_decimal_minor,'599');assert.equal(item.currency,'gbp');assert.equal(item.effective_cycle_amount_minor,null);
assert.equal((await shapeStore.all('activity')).length,0);
assert.equal((await shapeStore.delivery(shapeEvent.id)).state,'processed');
// Isolate omitted prerequisites without inventing what staging actually returned.
for(const [label,mutate] of [
 ['subscriptionCreated',s=>{delete s.created;}],
 ['itemCreated',s=>{delete s.items.data[0].created;}],
 ['hasMore',s=>{delete s.items.has_more;}],
 ['billingScheme',s=>{delete s.items.data[0].price.billing_scheme;}],
 ['cancelFlag',s=>{delete s.cancel_at_period_end;}],
 ['productId',s=>{s.items.data[0].price.product='invalid';}],
 ['priceCurrency',s=>{delete s.items.data[0].price.currency;}],
 ['badPeriod',s=>{s.items.data[0].current_period_end=s.items.data[0].current_period_start;}],
]){
 const f=flexibleStagingShape();mutate(f.subscription);
 const h=memoryHarness(shapeScope),r={...shapeRuntime,store:h.store,source:{...shapeRuntime.source,graph:async()=>structuredClone(f.graph)}};
 await assert.rejects(consumer.consumeFinanceEvent(event('omitted'+label,'customer.subscription.updated',f.subscription),r),/FINANCE_MALFORMED_STRIPE_DATA/);
 assert.equal((await h.all('subscriptions')).length,0);
}
console.log('PASS: supplied flexible/unspecified-tax shape processes with explicit unsupported valuation; omitted-field probes reproduce malformed errors without claiming a staging root cause.');
