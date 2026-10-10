import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {loadFinance} from './validate-finance-consumer.mjs';
import {graphFixture,event,apiVersion,fixtureNow,user} from './fixtures/finance-v1.mjs';
const {consumer,storeModule,timing}=loadFinance();
function fixture(mode='customer'){
 let protocolReads=0,graphs=0,legacy=0,commits=0,binds=0,claims=0,releases=0,busy=0;
 const receipts=new Map(),leases=new Map();let revision=0;
 const f=graphFixture();let graph=f.graph;
 const store={async command(action,scope,token,input={}){
  if(action==='read_protocol'){protocolReads++;return {mode,epoch:1};}
  if(action==='event_claim'){if(receipts.get(input.id)?.state==='processed')return {duplicate:true};const receipt={token:'receipt_'+input.id,state:'processing'};receipts.set(input.id,receipt);return receipt;}
  if(action==='event_fail'){receipts.get(input.id).state='failed';return {};}
  if(action==='claim'||action==='commit'){legacy++;throw Error('LEGACY_FALLBACK_FORBIDDEN');}
  const customer=input.customer;
  if(action==='partition_claim'){claims++;if(busy>0){busy--;throw new storeModule.FinanceLeaseBusyFailure();}if(leases.has(customer))throw new storeModule.FinanceLeaseBusyFailure();const lease={token:'lease_'+(++revision),revision:String(revision),epoch:1};leases.set(customer,lease);return lease;}
  if(action==='partition_release'){releases++;assert.equal(leases.get(customer).token,token);leases.delete(customer);return {};}
  if(action==='partition_bind'){binds++;assert.equal(leases.get(customer).token,token);return {};}
  if(action==='partition_commit'){commits++;assert.equal(leases.get(customer).token,token);receipts.get(input.event_id).state='processed';leases.delete(customer);return {};}
  if(action==='partition_ignored'){receipts.get(input.event_id).state='processed';return {};}
  throw Error('UNEXPECTED_COMMAND');
 },read:async()=>null,items:async()=>[],binding:async()=>({user_id:user,verified_at:fixtureNow}),run:async()=>null};
 const db={from:table=>{const filters={};return {select(){return this;},eq(k,v){filters[k]=v;return this;},abortSignal(){return this;},maybeSingle:async()=>({data:table==='billing_stripe_resource_ownership'?{stripe_scope:filters.stripe_scope,resource_type:filters.resource_type,stripe_resource_id:filters.stripe_resource_id,application_key:'dmi_cards',ownership_basis:filters.resource_type==='price'?'price_owner':'exclusive_customer',provenance:'operator_review',revision:1,state:'active',billing_stripe_applications:{state:'active'}}:null,error:null})};}};
 const runtime={store,relationshipDb:db,scope:'acct_fixture:test',apiVersion,now:()=>fixtureNow,source:{identity:async()=>({scope:'acct_fixture:test',apiVersion}),graph:async root=>{graphs++;return typeof graph==='function'?await graph(root):structuredClone(graph);},scan:async()=>{throw Error('NO_SCAN');}}};
 return {runtime,f,counts:()=>({protocolReads,graphs,legacy,commits,binds,claims,releases}),graph:g=>{graph=g;},busy:n=>{busy=n;},leases};
}
for(const mode of ['draining_to_customer','draining_to_legacy']){const h=fixture(mode);await assert.rejects(consumer.consumeFinanceEvent(event('draining','customer.subscription.created',h.f.subscription),h.runtime),/FINANCE_PROTOCOL_DRAINING/);assert.deepEqual(h.counts(),{protocolReads:1,graphs:0,legacy:0,commits:0,binds:0,claims:0,releases:0});}
{
 const h=fixture();const e=event('customer','customer.subscription.created',h.f.subscription);
 assert.equal((await consumer.consumeFinanceEvent(e,h.runtime)).outcome,'processed');
 assert.deepEqual(h.counts(),{protocolReads:1,graphs:1,legacy:0,commits:1,binds:1,claims:1,releases:0});
 assert.equal((await consumer.consumeFinanceEvent(e,h.runtime)).outcome,'duplicate');assert.equal(h.counts().commits,1);
}
{
 const h=fixture();h.busy(2);const diagnostics=[];h.runtime.leaseRetry=timing.createLeaseRetryPolicy(timing.createAcquisitionTiming(),m=>diagnostics.push(m));
 await consumer.consumeFinanceEvent(event('retry','customer.subscription.created',h.f.subscription),h.runtime);
 assert.equal(h.counts().claims,3);assert.equal(h.counts().graphs,1);assert.equal(h.counts().commits,1);assert.equal(diagnostics[0].lease_kind,"customer");assert.doesNotMatch(JSON.stringify(diagnostics),/cus_|evt_|sub_|PRIVATE/);
}
{
 const h=fixture();h.busy(3);h.runtime.leaseRetry=timing.createLeaseRetryPolicy(timing.createAcquisitionTiming());
 await assert.rejects(consumer.consumeFinanceEvent(event('exhaust','customer.subscription.created',h.f.subscription),h.runtime),/FINANCE_BUSY/);
 assert.equal(h.counts().claims,3);assert.equal(h.counts().graphs,0);assert.equal(h.counts().commits,0);
}
{
 const h=fixture();let timedClaims=0;h.runtime.store.command=async(action)=>{if(action==='read_protocol')return {mode:'customer',epoch:1};if(action==='event_claim')return {token:'receipt'};if(action==='partition_claim'){timedClaims++;throw new timing.AcquisitionTimingFailure('timeout_ambiguous');}if(action==='event_fail')return {};throw Error('NO_RETRY');};
 h.runtime.leaseRetry=timing.createLeaseRetryPolicy(timing.createAcquisitionTiming());
 await assert.rejects(consumer.consumeFinanceEvent(event('timeout','customer.subscription.created',h.f.subscription),h.runtime));assert.equal(h.counts().graphs,0);assert.equal(timedClaims,1);
}
{
 const h=fixture();const missing={...h.f.subscription,customer:null};await assert.rejects(consumer.consumeFinanceEvent(event('missing','customer.subscription.created',missing),h.runtime),/FINANCE_OWNERSHIP_UNRESOLVED/);assert.equal(h.counts().claims,0);
}
{
 const h=fixture();const g=structuredClone(h.f.graph);g.subscriptions[0].customer='cus_other';g.customers[0].id='cus_other';h.graph(g);
 await assert.rejects(consumer.consumeFinanceEvent(event('cross','customer.subscription.created',h.f.subscription),h.runtime),/FINANCE_CUSTOMER_GRAPH_OWNERSHIP/);assert.equal(h.counts().commits,0);assert.equal(h.counts().releases,1);assert.equal(h.counts().legacy,0);
}
{
 const h=fixture();const g=structuredClone(h.f.graph);g.subscriptions[0].metadata.dmi_app='other';h.graph(g);
 await assert.rejects(consumer.consumeFinanceEvent(event('foreign','customer.subscription.created',h.f.subscription),h.runtime),/FINANCE_FOREIGN_APPLICATION/);assert.equal(h.counts().commits,0);assert.equal(h.counts().legacy,0);
}
{
 const h=fixture();h.runtime.store.read=async(resource)=>resource==='subscriptions'?{stripe_scope:'acct_fixture:test',stripe_object_id:'sub_one',stripe_customer_id:'cus_other',revision:'0'}:null;
 await assert.rejects(consumer.consumeFinanceEvent(event('storeconflict','customer.subscription.created',h.f.subscription),h.runtime),/FINANCE_CUSTOMER_BUNDLE_OWNERSHIP/);assert.equal(h.counts().commits,0);assert.equal(h.counts().releases,1);
}
// Hold a worker at provider retrieval to prove distinct customers progress while same-customer work contends.
{
 const h=fixture();let open;const gate=new Promise(resolve=>{open=resolve;});let entered;const ready=new Promise(resolve=>{entered=resolve;});
 const second=graphFixture();second.subscription.id='sub_two';second.subscription.customer='cus_two';second.subscription.items.data[0].id='si_two';second.graph.customers[0].id='cus_two';
 h.graph(async root=>{if(root.id==='sub_one'){entered();await gate;return structuredClone(h.f.graph);}return structuredClone(second.graph);});
 const first=consumer.consumeFinanceEvent(event('parallelone','customer.subscription.created',h.f.subscription),h.runtime);await ready;
 await assert.rejects(consumer.consumeFinanceEvent(event('samecustomer','customer.subscription.updated',h.f.subscription),h.runtime),/FINANCE_BUSY/);
 assert.equal((await consumer.consumeFinanceEvent(event('paralleltwo','customer.subscription.created',second.subscription),h.runtime)).outcome,'processed');
 assert.equal(h.leases.has('cus_one'),true);assert.equal(h.leases.has('cus_two'),false);open();await first;assert.equal(h.counts().commits,2);assert.equal(h.counts().legacy,0);
}
// Explicit test-only proof option; live constructors still supply no option.
for(const ambiguous of [false,true]){
 const h=fixture();h.runtime.invoiceProofProduction={approvedScope:h.runtime.scope,approval:'reviewed_staging_invoice_proofs_v1'};
 const base=h.runtime.store.command;let proofCalls=0;
 h.runtime.store.command=async(action,scope,token,input={})=>{
  if(action==='invoice_proof_commit'){
   proofCalls++;assert.equal(JSON.stringify(input.candidates),'[]');assert.equal(input.authority.evidence.kind,'subscription');
   if(ambiguous)throw Error('FINANCE_STORE_UNAVAILABLE');
   return base('partition_commit',scope,token,{customer:input.customer,...input.input});
  }
  return base(action,scope,token,input);
 };
 const call=consumer.consumeFinanceEvent(event('proofmode'+ambiguous,'customer.subscription.created',h.f.subscription),h.runtime);
 if(ambiguous){await assert.rejects(call,/FINANCE_STORE_UNAVAILABLE/);assert.equal(h.counts().commits,0);assert.equal(h.counts().releases,1);}
 else {assert.equal((await call).outcome,'processed');assert.equal(h.counts().commits,1);assert.equal(h.counts().releases,0);}
 assert.equal(proofCalls,1);assert.equal(h.counts().graphs,1);assert.equal(h.counts().claims,1);assert.equal(h.counts().legacy,0);
}
// Adapter proves customer claim is bounded, HTTP busy is definite, and response metadata never returns raw errors.
{
 const calls=[];const db={rpc:(name,input)=>{calls.push({name,input});const response=Promise.resolve({data:{token:'lease',epoch:1,revision:'1'},error:null});response.abortSignal=()=>response;return response;}};
 const store=storeModule.createFinanceStore(db,timing.createAcquisitionTiming());await store.command('partition_claim','acct_fixture:test',null,{customer:'cus_fixture',expected_epoch:1});assert.equal(calls[0].name,'billing_finance_partition_command');assert.equal(calls[0].input.p_customer,'cus_fixture');assert.equal(JSON.stringify(calls[0].input.p_input),JSON.stringify({expected_epoch:1}));
}
for(const file of execFileSync('git',['ls-files','src'],{encoding:'utf8'}).trim().split('\n'))assert.doesNotMatch(fs.readFileSync(file,'utf8'),/billing_finance_transition|billing_finance_suspend_run/,'No automatic/operator transition endpoint');
{
 const db={rpc:()=>{const result=Promise.resolve({data:null,error:{code:'P0001',message:'FINANCE_BUSY',details:'PRIVATE_CUSTOMER'}});result.abortSignal=()=>result;return result;}};
 await assert.rejects(storeModule.createFinanceStore(db,timing.createAcquisitionTiming()).command('partition_claim','acct_fixture:test',null,{customer:'cus_fixture',expected_epoch:1}),e=>e instanceof storeModule.FinanceLeaseBusyFailure&&e.message==='FINANCE_BUSY');
}
const customer=fs.readFileSync('src/lib/stripe/finance-customer-webhook.ts','utf8');assert.doesNotMatch(customer,/console\.|logInfo|fetch\(/);
assert.ok(customer.includes('if(!committed)'));assert.ok(customer.includes('validateFinanceBundleOwnership'));assert.ok(customer.includes('validateFinanceGraphOwnership'));
console.log('PASS mode-aware runtime: legacy regressions separate; one mode read; draining blocks graph/acquisition; owned customer commit; terminal duplicate; three-attempt busy retry; ambiguity stops; unresolved/cross/foreign fail closed; no legacy fallback; no sensitive logs');
