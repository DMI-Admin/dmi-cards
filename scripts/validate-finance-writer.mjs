// Invoked only by the disposable Unix-socket PostgreSQL runner.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {consumerScenarios} from './validate-finance-consumer.mjs';
import {user,fixtureNow} from './fixtures/finance-v1.mjs';
const tables={subscriptions:'billing_finance_subscriptions',items:'billing_finance_subscription_items',invoices:'billing_invoices',payments:'billing_payments',allocations:'billing_invoice_payments',attempts:'billing_payment_attempts',refunds:'billing_refunds',activity:'billing_finance_activity'};
export async function validateWriter(db){
 await db.query(await fs.readFile('supabase/migrations/20260930130000_finance_v1_writer.sql','utf8'));
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
 assert.deepEqual(await protectedState(),baseline,'Finance must never mutate entitlement state or its receipts/accounts');
 console.log('PASS: transactional Finance writer; consumer scenarios on actual PostgreSQL; browser/direct-write denial; expired leases/reclaim; stale scope/event fences/revisions; atomic rollback; allowlists; stable revisions; no entitlement mutations.');
}
