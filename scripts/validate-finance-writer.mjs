// Invoked only by the disposable Unix-socket PostgreSQL runner.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {consumerScenarios} from './validate-finance-consumer.mjs';
import {user,fixtureNow} from './fixtures/finance-v1.mjs';
const tables={subscriptions:'billing_finance_subscriptions',items:'billing_finance_subscription_items',invoices:'billing_invoices',payments:'billing_payments',allocations:'billing_invoice_payments',attempts:'billing_payment_attempts',refunds:'billing_refunds',activity:'billing_finance_activity'};
export async function validateWriter(db){
 await db.query(await fs.readFile('supabase/migrations/20260930130000_finance_v1_writer.sql','utf8'));
 await db.query(await fs.readFile('supabase/migrations/20261003120000_finance_tax_evidence.sql','utf8'));
 const scope='acct_consumer:test';
 await db.query('INSERT INTO auth.users(id) VALUES($1)',[user]);
 await db.query('INSERT INTO billing_accounts(stripe_scope,user_id,stripe_customer_id,verified_at) VALUES($1,$2,$3,$4)',[scope,user,'cus_one',fixtureNow]);
 await db.query("INSERT INTO stripe_webhook_events(stripe_event_id,event_type,state) VALUES('evt_entitlementAlreadyProcessed','invoice.updated','processed')");
 const protectedState=async()=> (await db.query(`SELECT (SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]') FROM billing_subscriptions t) subscriptions,(SELECT jsonb_agg(to_jsonb(t)) FROM billing_accounts t) accounts,(SELECT jsonb_agg(to_jsonb(t)) FROM stripe_webhook_events t) events`)).rows;
 const baseline=await protectedState();
 const key=r=>r==='activity'?'activity_key':r==='attempts'?'attempt_key':'stripe_object_id';
 const json=async(sql,args)=>(await db.query(sql,args)).rows[0]?.data??null;
 const store={
  async command(action,s,token,input={}){await db.query('SET ROLE service_role');try{return await json('SELECT billing_finance_command($1,$2,$3,$4::jsonb) data',[action,s,token,JSON.stringify(input)]);}finally{await db.query('RESET ROLE');}},
  read:(r,s,id)=>json(`SELECT to_jsonb(t) data FROM ${tables[r]} t WHERE stripe_scope=$1 AND ${key(r)}=$2`,[s,id]),
  items:async(s,id)=>(await db.query('SELECT to_jsonb(t) data FROM billing_finance_subscription_items t WHERE stripe_scope=$1 AND stripe_subscription_id=$2',[s,id])).rows.map(x=>x.data),
  binding:(s,id)=>json('SELECT to_jsonb(t) data FROM billing_accounts t WHERE stripe_scope=$1 AND stripe_customer_id=$2',[s,id]),
  run:(s,id)=>json('SELECT to_jsonb(t) data FROM billing_finance_sync_runs t WHERE stripe_scope=$1 AND id=$2',[s,id]),
 };
 const harness={store,all:async r=>(await db.query(`SELECT to_jsonb(t) data FROM ${tables[r]} t WHERE stripe_scope=$1`,[scope])).rows.map(x=>x.data),delivery:id=>json('SELECT to_jsonb(t) data FROM billing_finance_event_deliveries t WHERE stripe_scope=$1 AND stripe_event_id=$2',[scope,id])};
 // JSON bigint fields are represented numerically by pg JSON; normalize to strings for shared assertions.
 const originalAll=harness.all;harness.all=async r=>(await originalAll(r)).map(x=>Object.fromEntries(Object.entries(x).map(([k,v])=>[k,(k.endsWith('_minor')||k==='revision')&&v!==null?String(v):v])));
 await consumerScenarios(harness,scope);
 for(const role of ['anon','authenticated']){await db.query('SET ROLE '+role);await assert.rejects(db.query("SELECT billing_finance_command('claim','acct_denied:test',NULL,'{}')"),/permission denied/);await db.query('RESET ROLE');}
 for(const table of Object.values(tables)){await db.query('SET ROLE service_role');await assert.rejects(db.query(`DELETE FROM ${table}`),/permission denied/);await db.query('RESET ROLE');}
 let lease=await store.command('claim',scope,null);
 await assert.rejects(store.command('claim',scope,null),/FINANCE_BUSY/);
 await db.query("UPDATE billing_finance_sync_state SET lease_until=clock_timestamp()-interval '1 second' WHERE stripe_scope=$1",[scope]);
 const next=await store.command('claim',scope,null);
 await assert.rejects(store.command('commit',scope,lease.token,{expected_scope_revision:lease.revision}),/FINANCE_FENCE/);
 await assert.rejects(store.command('commit',scope,next.token,{expected_scope_revision:'0'}),/FINANCE_REVISION/);
 await store.command('release',scope,next.token);
 const receipt={id:'evt_expiry',type:'invoice.updated',subject:'in_one',created:fixtureNow};
 const oldEvent=await store.command('event_claim',scope,null,receipt);
 await assert.rejects(store.command('event_claim',scope,null,receipt),/FINANCE_BUSY/);
 await db.query("UPDATE billing_finance_event_deliveries SET lease_until=clock_timestamp()-interval '1 second' WHERE stripe_scope=$1 AND stripe_event_id=$2",[scope,receipt.id]);
 const newEvent=await store.command('event_claim',scope,null,receipt);
 lease=await store.command('claim',scope,null);
 await assert.rejects(store.command('commit',scope,lease.token,{expected_scope_revision:lease.revision,event_id:receipt.id,event_token:oldEvent.token}),/FINANCE_EVENT_FENCE/);
 const before=await store.read('invoices',scope,'in_one');
 const {revision,created_at:_c,updated_at:_u,...row}=before;void _c;void _u;
 const input={expected_scope_revision:lease.revision,event_id:receipt.id,event_token:newEvent.token,invoices:[{row:{...row,amount_due_minor:700},expected_revision:String(revision)}]};
 // Late invalid activity forces rollback after an invoice write has executed.
 await assert.rejects(store.command('commit',scope,lease.token,{...input,activity:[{row:{stripe_scope:'acct_other:test'},expected_revision:'0'}]}),/FINANCE_ROW_SCOPE/);
 assert.deepEqual(await store.read('invoices',scope,'in_one'),before);assert.equal((await harness.delivery(receipt.id)).state,'processing');
 await assert.rejects(store.command('commit',scope,lease.token,{...input,invoices:[{row,expected_revision:'0'}]}),/FINANCE_OBJECT_REVISION/);
 await assert.rejects(store.command('commit',scope,lease.token,{...input,invoices:[{row:{...row,verified_at:'2000-01-01'},expected_revision:String(revision)}]}),/FINANCE_STALE_SNAPSHOT/);
 await assert.rejects(store.command('commit',scope,lease.token,{...input,invoices:[{row:{...row,secret:'not-allowed'},expected_revision:String(revision)}]}),/FINANCE_ROW_SCOPE/);
 await store.command('commit',scope,lease.token,{...input,invoices:[{row,expected_revision:String(revision)}]});
 assert.equal((await harness.delivery(receipt.id)).state,'processed');
 assert.equal((await store.read('invoices',scope,'in_one')).revision,revision,'identical refresh preserves revision');
 assert.equal((await store.command('event_claim',scope,null,receipt)).duplicate,true);

 // Newly added evidence defaults never certify historical rows.
 const oldItem=await db.query("SELECT forecast_tax_evidence FROM billing_finance_subscription_items WHERE stripe_scope='acct_fixture:test' AND stripe_object_id='si_one'");
 assert.equal(oldItem.rows[0].forecast_tax_evidence.status,'unknown');assert.equal(oldItem.rows[0].forecast_tax_evidence.taxMinor,null);
 const taxEvidence={version:1,status:'verified',reason:'verified_invoice_totals',basis:'finalized_invoice',grossMinor:'599',taxMinor:'100',vatMinor:'100',netMinor:'499',automaticTaxEnabled:true,automaticTaxStatus:'complete',breakdownComplete:true,linesComplete:true,lineCount:1,breakdown:[{amountMinor:'100',taxableAmountMinor:'499',behavior:'inclusive',taxRateId:'txr_test',ratePercent:'20',taxType:'vat',country:'GB',reason:'standard_rated'}]};
 const taxLease=await store.command('claim',scope,null);
 const priorTax=await store.read('invoices',scope,'in_one');
 const {revision:taxRevision,created_at:tc,updated_at:tu,...taxRow}=priorTax;void tc;void tu;
 const taxInput=e=>({expected_scope_revision:taxLease.revision,invoices:[{row:{...taxRow,total_minor:'599',tax_minor:'100',tax_evidence:e},expected_revision:String(taxRevision)}]});
 for(const bad of [{...taxEvidence,secret:'FORBIDDEN'},{...taxEvidence,netMinor:'500'},{...taxEvidence,status:'unknown'},{...taxEvidence,automaticTaxStatus:'failed'},{...taxEvidence,breakdown:[{...taxEvidence.breakdown[0],raw:{secret:'FORBIDDEN'}}]}])await assert.rejects(store.command('commit',scope,taxLease.token,taxInput(bad)),/check constraint/);
 assert.deepEqual(await store.read('invoices',scope,'in_one'),priorTax,'tax validation failure is atomic');
 await store.command('commit',scope,taxLease.token,taxInput(taxEvidence));
 assert.deepEqual((await store.read('invoices',scope,'in_one')).tax_evidence,taxEvidence);
 const duplicateLease=await store.command('claim',scope,null),persisted=await store.read('invoices',scope,'in_one');
 const {revision:pr,created_at:pc,updated_at:pu,...repeat}=persisted;void pc;void pu;
 await store.command('commit',scope,duplicateLease.token,{expected_scope_revision:duplicateLease.revision,invoices:[{row:repeat,expected_revision:String(pr)}]});
 assert.equal((await store.read('invoices',scope,'in_one')).revision,pr,'duplicate tax evidence keeps revision');
 for(const role of ['anon','authenticated','service_role'])assert.equal((await db.query("SELECT has_function_privilege($1,'public.billing_finance_tax_evidence_valid(jsonb,boolean)','EXECUTE') allowed",[role])).rows[0].allowed,false);
 // Forecast storage is reserved for a separately verified same-configuration preview.
 const savedItem=await store.read('items',scope,'si_one');
 const {revision:ir,created_at:ic,updated_at:iu,...itemRow}=savedItem;void ic;void iu;
 const forecast={...savedItem.forecast_tax_evidence,status:'verified',basis:'stripe_invoice_preview',reason:'verified_preview_totals',sourceRef:'upcoming_in_fixture',verifiedAt:new Date(savedItem.verified_at).toISOString(),grossMinor:'719',taxMinor:'120',netMinor:'599'};
 const forecastLease=await store.command('claim',scope,null);
 const forecastInput=f=>({expected_scope_revision:forecastLease.revision,items:[{row:{...itemRow,forecast_tax_evidence:f},expected_revision:String(ir)}]});
 await assert.rejects(store.command('commit',scope,forecastLease.token,forecastInput({...forecast,configuration:{...forecast.configuration,scope:'acct_other:test'}})),/check constraint/);
 await assert.rejects(store.command('commit',scope,forecastLease.token,forecastInput({...forecast,taxMinor:'121'})),/check constraint/);
 await store.command('commit',scope,forecastLease.token,forecastInput(forecast));
 const forecastSaved=await store.read('items',scope,'si_one');
 assert.equal(forecastSaved.forecast_tax_evidence.taxMinor,'120');
 assert.equal(forecastSaved.effective_cycle_amount_minor,savedItem.effective_cycle_amount_minor,'forecast does not redefine net/MRR field');
 console.log('PASS tax writer: old rows unknown, verified pennies/breakdown persistence, malformed evidence and totals rejected atomically, duplicate stable, no direct helper/browser writes.');
 assert.deepEqual(await protectedState(),baseline,'Finance must never mutate entitlement state or its receipts/accounts');
 console.log('PASS: transactional Finance writer; consumer scenarios on actual PostgreSQL; browser/direct-write denial; expired leases/reclaim; stale scope/event fences/revisions; atomic rollback; allowlists; stable revisions; no entitlement mutations.');
}
