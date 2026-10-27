// Offline normalized-policy equivalence. SQL atomicity/concurrency is tested separately.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {load} from './load.mjs';
import {probeCurrent} from '../phase1/current-system.mjs';
import {loadFinance,memoryHarness} from '../../../scripts/validate-finance-consumer.mjs';
import {graphFixture,apiVersion,fixtureNow,event,user} from '../../../scripts/fixtures/finance-v1.mjs';
const root='src/lib/billing-v2/';
const policy=load(root+'domain/subscription-policy.ts'),finance=load(root+'domain/finance-policy.ts'),sync=load(root+'application/synchronizer.ts'),comparison=load(root+'shadow/comparison.ts'),checkout=load(root+'domain/checkout-observation.ts'),backfill=load(root+'tooling/backfill.ts');
const fixtures=JSON.parse(fs.readFileSync('specs/billing-simplification/phase1/fixtures.json','utf8')).fixtures;
const scope='acct_fixture:test',account='33333333-3333-4333-8333-333333333333';
function input(){return {task:{scope,sourceKind:'webhook',sourceId:'evt_spec',eventCreated:'100',livemode:false,runtime:'staging',namespaceVerified:true},binding:{scope,accountId:account,principalId:user,customer:'cus_owned',verified:true,revision:'1'},provider:{id:'sub_owned',customer:'cus_owned',scope,livemode:false,owner:user,status:'active',price:'price_current',cancelAtPeriodEnd:false,periodStart:null,periodEnd:null,trialEnd:null,endedAt:null,latestInvoice:null,verifiedAt:'2026-10-27T00:00:00.000Z',itemsComplete:true,approvedItemCount:1},price:{scope,id:'price_current',revision:'1',entitlementEnabled:true,checkoutEnabled:true,active:true,application:'dmi_cards',interval:'monthly'},before:null};}
const normalized=(canonical,order='accepted',facts=[])=>({status:canonical?.status??null,plan:canonical?.plan??'free',entitlement:canonical?.plan??'free',owner_verified:!!canonical,order_decision:order,finance:facts,terminal:canonical?.terminal??false,providerMutations:0,unexpectedBusinessEffects:0});
async function runSubscription(f){const i=input();let state=null,failedBefore=false,failedAfter=false;const done=new Map();let commits=0;
 const store={async completeSubscription(fence,d){if(done.has(fence.task_id))return done.get(fence.task_id);if(failedBefore){failedBefore=false;throw Error('synthetic rollback');}state=d.canonical;commits++;const r={kind:'committed'};done.set(fence.task_id,r);if(failedAfter){failedAfter=false;throw Error('synthetic lost response');}return r;},async completeFinance(){throw Error('synthetic Finance failure');},async defer(){return {kind:'needs_attention'};}};
 const step=async(id='evt_spec',at='100')=>{i.task.sourceId=id;i.task.eventCreated=at;i.before=state;return sync.synchronize(i,{scope,task_id:id,account_id:account,token:randomUUID(),claim_generation:'1',authority_generation:'1',engine:'shadow'},store);};
 switch(f.id){
 case 'free':case 'lost_checkout':return {canonical:null,commits:0};
 case 'annual':i.price.id=i.provider.price='price_annual';i.price.interval='annual';break;
 case 'trialing':i.provider.status='trialing';break;
 case 'unknown_price':i.price=null;i.provider.price='price_unknown';break;
 case 'wrong_owner':i.provider.owner='22222222-2222-4222-8222-222222222222';break;
 case 'mode_staging':i.task.livemode=true;break;
 case 'mode_production':i.task.runtime='production';break;
 case 'unknown_runtime':i.task.runtime='unknown';break;
 case 'cancel_scheduled':i.provider.cancelAtPeriodEnd=true;break;
 case 'canceled':i.provider.status='canceled';break;
 case 'payment_failed':i.provider.status='past_due';break;
 case 'wrong_scope':state=policy.decideSubscription(i).canonical;state={...state,stripe_scope:'acct_other:test'};break;
 case 'provider_transient':case 'database_transient':failedBefore=true;await assert.rejects(step());assert.equal(state,null);break;
 case 'lost_commit':case 'crash_after':failedAfter=true;await assert.rejects(step());assert.equal(state.revision,'1');break;
 case 'reconciliation':i.task.sourceKind='reconciliation';break;
 }
 await step();
 if(f.id==='duplicate'){await step();assert.equal(commits,1);}
 if(f.id==='stale'||f.id==='equal_timestamp'){i.provider.cancelAtPeriodEnd=true;await step('evt_second',f.id==='stale'?'99':'100');assert.equal(state.cancel_at_period_end,f.id!=='stale');}
 if(f.id==='terminal_late'){i.provider.status='canceled';await step('evt_terminal','101');i.provider.status='active';await step('evt_late','102');}
 if(f.id==='resumption'){i.provider.cancelAtPeriodEnd=true;await step('evt_cancel','101');i.provider.cancelAtPeriodEnd=false;await step('evt_resume','102');}
 if(f.id==='unsupported_change'){i.price=null;i.provider.price='price_unknown';const before=JSON.stringify(state);await step('evt_bad','102');assert.equal(JSON.stringify(state),before);}
 if(f.id==='lost_commit'||f.id==='crash_after')assert.equal(commits,1);
 return {canonical:state,commits};
}
const resolver=load('src/lib/stripe/finance-charge-ownership-proof.ts');
async function currentProof(id){const allocation={stripe_scope:scope,stripe_object_id:'inpay_fixture',stripe_invoice_id:'in_fixture',stripe_charge_id:'ch_fixture',stripe_payment_intent_id:'pi_fixture'};const ev={scope,invoice:'in_fixture',customer:'cus_owned',subscription:'sub_owned',invoiceRevision:'3',complete:true,prices:[{id:'price_current',ownershipRevision:1}]};const owner={scope,type:'price',id:'price_current',application:'dmi_cards',basis:'price_owner',provenance:'reviewed_dmi_price',revision:1,state:'active',applicationActive:true};if(id==='foreign_charge')owner.application='known_other';if(id==='proof_revoked'){owner.revision=2;owner.state='revoked';}
 return resolver.resolveChargeOwnershipProof({readPayment:async()=>({stripe_scope:scope,stripe_object_id:'ch_fixture',stripe_customer_id:'cus_owned',stripe_payment_intent_id:'pi_fixture'}),readAllocations:async()=>({rows:id==='unresolved_charge'?[]:[allocation],complete:true}),readInvoice:async()=>({stripe_scope:scope,stripe_object_id:'in_fixture',stripe_customer_id:'cus_owned',stripe_subscription_id:'sub_owned',revision:'3'}),readOwnership:async()=>owner},{scope,type:'charge.succeeded',charge:'ch_fixture',customer:'cus_owned',paymentIntent:'pi_fixture'},[ev]);}
async function financeCase(f){
 const i=input(),access=policy.decideSubscription(i).canonical;
 if(f.id==='wrong_event_account'){const original=loadFinance(),h=memoryHarness(scope);let calls=0;const r={scope,apiVersion,store:{...h.store,command:async()=>{calls++;throw Error('unexpected storage');}},source:{},now:()=>fixtureNow};await assert.rejects(original.consumer.consumeFinanceEvent({...event('scope','charge.succeeded',{id:'ch_fixture'}),account:'acct_wrong'},r),/SCOPE/);assert.equal(calls,0);const decision=finance.decideFinance({task:{...i.task,eventAccount:'acct_wrong'},binding:i.binding,complete:true,rows:[],proofs:[],catalog:[i.price]});assert.equal(decision.kind,'reject');return {baseline:normalized(null,'rejected'),candidate:normalized(null,'rejected')};}
 if(f.id==='finance_failure'){let originalAccess=false;await assert.rejects(loadFinance().consumer.orchestrateBillingConsumers(event('separate','invoice.paid',{id:'in_fixture'}),async()=>{originalAccess=true;},async()=>{throw Error('unavailable');}));assert.equal(originalAccess,true);const store={completeSubscription:async()=>({kind:'committed'}),completeFinance:async()=>{throw Error('unavailable');},defer:async()=>{throw Error('unavailable');}};assert.equal((await sync.synchronize(i,{scope},store)).kind,'committed');await assert.rejects(sync.projectFinance({task:i.task,binding:i.binding,complete:false,rows:[],proofs:[],catalog:[]},{scope},store));return {baseline:normalized(access,'accepted',[{state:'retry_wait'}]),candidate:normalized(access,'accepted',[{state:'retry_wait'}])};}
 if(f.id==='refund'){
  const current=loadFinance(),h=memoryHarness(scope),g=graphFixture();g.refund.status='succeeded';g.charge.amount_refunded=100;g.graph.invoices=[g.invoice];g.graph.charges=[g.charge];g.graph.allocations=[g.allocation];g.graph.refunds=[g.refund];const runtime={scope,apiVersion,now:()=>fixtureNow,store:h.store,source:{identity:async()=>({scope,apiVersion}),graph:async()=>structuredClone(g.graph)}};
  await current.consumer.consumeFinanceEvent(event('refund','refund.updated',g.refund,{status:'pending'}),runtime);const refund=(await h.all('refunds'))[0];assert.equal(refund.amount_minor,'100');
  const columns=JSON.parse(JSON.stringify(refund));delete columns.revision;
  const proof={invoice:'in_one',customer:'cus_one',subscription:'sub_one',invoiceRevision:'1',certificateRevision:'1',prices:[{id:'price_month',revision:'1'}],complete:true,application:'dmi_cards',allocations:[{id:'inpay_one',charge:'ch_one',intent:'pi_one'}]};
  const d=finance.decideFinance({task:{...i.task,eventType:'refund.updated',subject:'re_one'},binding:{...i.binding,customer:'cus_one'},complete:true,rows:[{table:'refunds',expectedRevision:'0',columns},...(await h.all('payments')).map(r=>{const c={...r};delete c.revision;return {table:'payments',expectedRevision:'1',columns:c};})],proofs:[proof],catalog:[{...i.price,id:'price_month'}]});assert.equal(d.kind,'commit');const facts=r=>[{kind:'refund',id:r.stripe_object_id,charge:r.stripe_charge_id,currency:r.currency,amount_minor:r.amount_minor,status:r.status}];return {baseline:normalized(access,'accepted',facts(refund)),candidate:normalized(access,'accepted',facts(d.rows[0].columns))};
 }
 const old=await currentProof(f.id);assert.ok(old.state!=='dmi');const proof={invoice:'in_fixture',customer:'cus_owned',subscription:'sub_owned',invoiceRevision:'3',certificateRevision:'1',prices:[{id:'price_current',revision:'1'}],complete:f.id!=='unresolved_charge',application:f.id==='foreign_charge'?'known_other':'dmi_cards',allocations:[{id:'inpay_fixture',charge:'ch_fixture',intent:'pi_fixture'}]};
 const d=finance.decideFinance({task:{...i.task,eventType:'charge.succeeded',subject:'ch_fixture',namespaceVerified:false},binding:i.binding,complete:true,rows:[{table:'payments',expectedRevision:'0',columns:{stripe_scope:scope,stripe_object_id:'ch_fixture',stripe_customer_id:'cus_owned',stripe_payment_intent_id:'pi_fixture'}}],proofs:[proof],catalog:[{...i.price,active:f.id!=='proof_revoked',revision:f.id==='proof_revoked'?'2':'1'}]});assert.equal(d.kind,'defer');
 // Deployed DMI certificate path maps known foreign to unresolved as well.
 const source=fs.readFileSync('src/lib/stripe/finance-dmi-charge-integration.ts','utf8');assert.match(source,/result.state===\"foreign\".*state:\"unresolved\"/);
 return {baseline:normalized(access,'accepted',[{state:'dependency_wait'}]),candidate:normalized(access,'accepted',[{state:'dependency_wait'}])};
}
let existing=0,future=0;
for(const f of fixtures){
 if(f.future_only){future++;if(f.id==='crash_after')await runSubscription(f);if(f.id==='shadow'){const e=normalized(null);assert.equal(comparison.compare(e,{...e,providerMutations:1}),'unexpected_business_effect');}console.log('CLASSIFIED FUTURE '+f.id);continue;}
 if(f.current_evidence.probe){const old=await probeCurrent(f);const candidate=await runSubscription(f);if(f.id==='lost_checkout'){const params={ui_mode:'embedded_page',price:'price_current'};const attempt={key:'persisted_fixture_key',parameters:params,parametersDigest:policy.digest(params),createdAt:'2026-10-01',replayDeadline:'2026-10-02',sessionId:'cs_1'};const observed=checkout.observeAttempt(attempt,'2026-10-01T01:00:00Z');assert.equal(observed.key,attempt.key);assert.equal(observed.sessionId,'cs_1');assert.equal(checkout.observeAttempt(attempt,'2026-10-03').kind,'needs_attention');}
 const baseline=normalized(old.canonical??null,f.expected.task.order_decision),actual=normalized(candidate.canonical,f.expected.task.order_decision);assert.equal(comparison.compare(baseline,actual),'equivalent',f.id);
 }else{const observed=await financeCase(f);assert.equal(comparison.compare(observed.baseline,observed.candidate),'equivalent',f.id);}
 existing++;console.log('EQUIVALENT '+f.id);
}
assert.equal(existing+future,35);assert.equal(existing,31);assert.equal(future,4);
// Additional fail-closed comparator and backfill/resumption checks.
const e=normalized(null);assert.equal(comparison.compare(e,null),'missing_projection');assert.equal(comparison.compare(e,{...e,owner_verified:true}),'ownership_mismatch');assert.equal(comparison.compare(e,{...e,plan:'pro'}),'policy_mismatch');assert.equal(comparison.compare(e,e,true),'expected_representation_difference');
const blank=name=>Object.fromEntries(Object.entries(load(root+'domain/finance-contract.ts').tableContracts[name].columns).map(([key,c])=>[key,c.nullable?null:key.endsWith('_at')?'2026-10-27T00:00:00.000Z':null]));
const rows={accounts:[{...blank('accounts'),stripe_scope:scope,id:account,principal_kind:'individual',principal_id:user,stripe_customer_id:'cus_owned',binding_state:'verified',binding_revision:'1',verified_at:'2026-10-27T00:00:00.000Z'}],price_catalog:[{...blank('price_catalog'),stripe_scope:scope,stripe_price_id:'price_current',application_key:'dmi_cards',plan:'pro',billing_interval:'monthly',entitlement_enabled:true,checkout_enabled:true,ownership_state:'active',ownership_basis:'price_owner',revision:'1',verified_at:'2026-10-27T00:00:00.000Z',application_active:true}]};const snapshot={scope,checkpoint:'snapshot_fixture',complete:true,rows,digests:Object.fromEntries(Object.entries(rows).map(([k,v])=>[k,policy.digest(v)]))};const first=backfill.planBackfill(snapshot,null,1),second=backfill.planBackfill(snapshot,first.next,1);assert.equal(first.manifestDigest,second.manifestDigest);assert.equal(first.rows.length+second.rows.length,2);assert.throws(()=>backfill.planBackfill({...snapshot,complete:false}));assert.throws(()=>backfill.planBackfill({...snapshot,digests:{accounts:'bad'}}));const bad=structuredClone(snapshot);bad.rows.accounts.push({...bad.rows.accounts[0],id:'other',principal_id:'other'});bad.digests.accounts=policy.digest(bad.rows.accounts);assert.throws(()=>backfill.planBackfill(bad),/OWNER/);
console.log(`V2 fixtures: ${existing}/${existing} existing normalized-policy equivalence; ${future}/${future} future-only classified. Provider dispatch remains prohibited, not claimed tested.`);

assert.throws(()=>backfill.planBackfill({...snapshot,checkpoint:'other'},first.next,1),/CURSOR/);

const legacyRow={stripe_scope:scope,user_id:user,stripe_customer_id:'cus_owned',created_at:'2026-10-01T00:00:00.000Z',updated_at:'2026-10-01T00:00:00.000Z',customer_attempt:null,checkout_attempt:null};
const s0=input(),canonical=policy.decideSubscription(s0).canonical;
const legacySub={stripe_scope:scope,user_id:user,stripe_customer_id:'cus_owned',stripe_subscription_id:'sub_owned',verified:true,terminal:false,revision:'1',last_event_created:'100',created_at:legacyRow.created_at,updated_at:legacyRow.updated_at,sync_snapshot:{subscription_id:'sub_owned',customer_id:'cus_owned',status:'active',price_id:'price_current',plan:'pro',cancel_at_period_end:false,period_start:null,period_end:null,trial_end:null,ended_at:null,invoice_id:null,terminal:false}};
const legacyRows={billing_accounts:[legacyRow],billing_subscriptions:[legacySub],billing_approved_prices:[{stripe_scope:scope,stripe_price_id:'price_current',entitlement_enabled:true,checkout_enabled:true,approved_at:legacyRow.created_at}],billing_stripe_resource_ownership:[{stripe_scope:scope,resource_type:'price',stripe_resource_id:'price_current',application_key:'dmi_cards',ownership_basis:'price_owner',revision:1,state:'active',updated_at:legacyRow.updated_at}],billing_stripe_applications:[{application_key:'dmi_cards',state:'active'}]};const raw={scope,priceEvidence:{price_current:{interval:'monthly',product:'prod_current',verifiedAt:legacyRow.updated_at}},checkpoint:'2026-10-01T00:00:00Z',complete:true,rows:legacyRows,digests:Object.fromEntries(Object.entries(legacyRows).map(([k,v])=>[k,policy.digest(v)]))};const planned=backfill.planBackfill(raw);const seeded=planned.rows.find(r=>r.table==='subscriptions').row;assert.equal(seeded.snapshot_digest,canonical.snapshot_digest);assert.equal(seeded.revision,'1');assert.equal(policy.decideSubscription({...s0,binding:{...s0.binding,accountId:user},before:{...seeded}}).kind,'no_change');

const missingCatalog=structuredClone(raw);missingCatalog.rows.billing_approved_prices=[];missingCatalog.rows.billing_stripe_resource_ownership=[];missingCatalog.digests=Object.fromEntries(Object.entries(missingCatalog.rows).map(([k,v])=>[k,policy.digest(v)]));assert.throws(()=>backfill.planBackfill(missingCatalog),/PRICE_PROOF/);

const unsafe=structuredClone(snapshot);unsafe.rows.accounts[0].binding_revision=9007199254740994;unsafe.digests.accounts=policy.digest(unsafe.rows.accounts);assert.throws(()=>backfill.planBackfill(unsafe),/UNSAFE_NUMBER/);

// Current registry references must remain usable by the V2 certificate readers.
const certificateExport=structuredClone(raw);
certificateExport.archiveDigest='a'.repeat(64);
certificateExport.rows.billing_invoices=[{stripe_scope:scope,stripe_object_id:'in_import',stripe_customer_id:'cus_owned',stripe_subscription_id:null,revision:'3',verified_at:legacyRow.updated_at}];
certificateExport.rows.billing_finance_application_proofs=[{stripe_scope:scope,stripe_invoice_id:'in_import',state:'proven',application_key:'dmi_cards',lines_complete:true,source_invoice_revision:'3',source_invoice_verified_at:legacyRow.updated_at,stripe_customer_id:'cus_owned',stripe_subscription_id:null,certificate_revision:'2',source_event_id:'evt_import',registry_proofs:[{price_id:'price_current',application_key:'dmi_cards',revision:1}]}];
certificateExport.digests=Object.fromEntries(Object.entries(certificateExport.rows).map(([k,v])=>[k,policy.digest(v)]));
const imported=backfill.normalizeSnapshot(certificateExport).rows.invoices[0].ownership_provenance;
assert.deepEqual(JSON.parse(JSON.stringify(imported.price_proofs)),[{id:'price_current',revision:'1'}]);
assert.equal(imported.invoice_revision,'3');assert.equal(imported.certificate_revision,'2');
assert.equal(imported.source_event_id,'evt_import');
console.log('PASS backfill registry references retain V2-consumable price identity and revision');

for(const corrupt of [x=>{x.rows.billing_stripe_resource_ownership[0].state='revoked';},x=>{x.rows.billing_finance_application_proofs[0].source_invoice_revision='2';},x=>{x.rows.billing_finance_application_proofs=[];}]){
 const bad=structuredClone(certificateExport);corrupt(bad);bad.digests=Object.fromEntries(Object.entries(bad.rows).map(([k,v])=>[k,policy.digest(v)]));assert.throws(()=>backfill.normalizeSnapshot(bad),/CERTIFICATE/);
}
console.log('PASS imported certificate refuses revoked, stale and missing proof');

// Case-sensitive provider IDs must use one ordering for page sorting and resume.
const mixedCase=structuredClone(snapshot);
mixedCase.rows.price_catalog=['price_A','price_a','price_Z','price_z'].map(id=>({...mixedCase.rows.price_catalog[0],stripe_price_id:id}));
mixedCase.digests=Object.fromEntries(Object.entries(mixedCase.rows).map(([k,v])=>[k,policy.digest(v)]));
const allKeys=backfill.planBackfill(mixedCase).rows.map(r=>r.key);let cursor=null;const pagedKeys=[];
for(let n=0;n<allKeys.length+1;n++){const page=backfill.planBackfill(mixedCase,cursor,1);pagedKeys.push(...page.rows.map(r=>r.key));cursor=page.next;if(cursor===null)break;}
assert.deepEqual(pagedKeys,Array.from(allKeys));assert.equal(new Set(pagedKeys).size,5);
console.log('PASS mixed-case provider identities resume without omissions or duplicates');
