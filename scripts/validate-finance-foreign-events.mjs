// Mocked/offline by default; optional disposable native PostgreSQL, never a hosted URL.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {loadFinance} from './validate-finance-consumer.mjs';
import {graphFixture,event,fixtureNow} from './fixtures/finance-v1.mjs';
const file='supabase/migrations/20261010010000_finance_foreign_receipt_completion.sql',sql=fs.readFileSync(file,'utf8');
assert.equal(fs.readdirSync('supabase/migrations').filter(n=>n.startsWith('20261010010000_')).length,1);
assert.ok(sql.trim().endsWith('COMMIT;'));assert.doesNotMatch(sql,/UPDATE public\.billing_finance_protocol_control|CREATE OR REPLACE FUNCTION|INSERT INTO|DELETE FROM/);
const {consumer,storeModule}=loadFinance();
function harness(owner='other_app'){
 let acquisitions=0,graphs=0,completions=0,writes=0;const receipts=new Map(),records={};
 const f=graphFixture(),scope='acct_fixture:test';
 const row=(type,id,application)=>({stripe_scope:scope,resource_type:type,stripe_resource_id:id,application_key:application,ownership_basis:type==='customer'?'exclusive_customer':'price_owner',provenance:'operator_review',revision:1,state:'active',billing_stripe_applications:{state:'active'}});
 records['customer:cus_one']=row('customer','cus_one',owner);records['price:price_month']=row('price','price_month',owner);
 const db={from:table=>{const filters={};return {select(){return this;},eq(k,v){filters[k]=v;return this;},abortSignal(){return this;},maybeSingle:async()=>({error:null,data:table==='billing_stripe_resource_ownership'?records[filters.resource_type+':'+filters.stripe_resource_id]??null:table==='billing_payments'?{stripe_scope:scope,stripe_object_id:'ch_one',stripe_customer_id:'cus_one',stripe_payment_intent_id:'pi_one'}:null})};}};
 const runtime={scope,apiVersion:'2026-07-29.dahlia',now:()=>fixtureNow,relationshipDb:db,source:{identity:async()=>{throw Error('NO_PROVIDER');},graph:async()=>{graphs++;throw Error('NO_PROVIDER');}},store:{command:async(action,s,token,input={})=>{
  assert.equal(s,scope);if(action==='read_protocol')return {mode:'customer',epoch:1};
  if(action==='event_claim'){if(receipts.get(input.id)?.state==='ignored')return {duplicate:true};const r={state:'processing',token:'receipt'};receipts.set(input.id,r);return r;}
  if(action==='event_fail'){receipts.get(input.id).state='failed';return {};}
  if(action==='foreign_complete'){completions++;assert.equal(token,'receipt');assert.ok(input.proofs.every(p=>p.application==='other_app'));assert.ok(!('customer' in input));receipts.get(input.event_id).state='ignored';return {};}
  if(action==='partition_claim'){acquisitions++;throw Error('FINANCE_BUSY');}
  writes++;throw Error('NO_FINANCIAL_WRITES');
 }}};
 return {runtime,records,f,counts:()=>({acquisitions,graphs,completions,writes})};
}
{
 const h=harness();delete h.records['customer:cus_one'];const e=event('priceforeign','customer.subscription.created',h.f.subscription);
 assert.equal((await consumer.consumeFinanceEvent(e,h.runtime)).outcome,'ignored');assert.equal((await consumer.consumeFinanceEvent(e,h.runtime)).outcome,'duplicate');assert.deepEqual(h.counts(),{acquisitions:0,graphs:0,completions:1,writes:0});
}
for(const [type,resource] of Object.entries({'customer.subscription.created':'subscription','customer.subscription.updated':'subscription','customer.subscription.deleted':'subscription','invoice.finalized':'invoice','invoice.updated':'invoice','invoice.paid':'invoice','invoice.payment_failed':'invoice','invoice.voided':'invoice','invoice.marked_uncollectible':'invoice','charge.succeeded':'charge','charge.failed':'charge','charge.captured':'charge','charge.refunded':'charge','charge.refund.updated':'refund','refund.created':'refund','refund.updated':'refund','refund.failed':'refund'})){
 const h=harness();let raw=h.f[resource];if(type==='charge.failed')raw={...raw,status:'failed',paid:false,amount_captured:0};
 assert.equal((await consumer.consumeFinanceEvent(event('alltypes',type,raw),h.runtime)).outcome,'ignored');assert.deepEqual(h.counts(),{acquisitions:0,graphs:0,completions:1,writes:0});
}
for(const variant of ['unknown','missing','mixed','revoked','incomplete','metadata']){
 const h=harness();if(variant==='unknown')h.f.subscription.items.data[0].price.id='price_missing';
 if(variant==='missing'||variant==='metadata'){delete h.records['customer:cus_one'];delete h.records['price:price_month'];}
 if(variant==='mixed')h.records['price:price_month'].application_key='dmi_cards';
 if(variant==='revoked')h.records['price:price_month'].state='revoked';
 if(variant==='incomplete')h.f.subscription.items.has_more=true;
 h.f.subscription.metadata.dmi_app='other';
 await assert.rejects(consumer.consumeFinanceEvent(event('bad','customer.subscription.created',h.f.subscription),h.runtime),new RegExp(variant==='mixed'?'FINANCE_OWNERSHIP_CONFLICT':'FINANCE_OWNERSHIP_UNRESOLVED'));
 assert.deepEqual(h.counts(),{acquisitions:0,graphs:0,completions:0,writes:0});
}
{
 const h=harness('dmi_cards');await assert.rejects(consumer.consumeFinanceEvent(event('dmi','customer.subscription.created',h.f.subscription),h.runtime),/FINANCE_BUSY/);assert.equal(h.counts().acquisitions,1);assert.equal(h.counts().completions,0);
}
{
 const h=harness();const original=h.runtime.store.command;h.runtime.store.command=async(...args)=>{if(args[0]==='foreign_complete')throw Error('FINANCE_OWNERSHIP_STALE');return original(...args);};await assert.rejects(consumer.consumeFinanceEvent(event('stale','charge.succeeded',h.f.charge),h.runtime),/FINANCE_OWNERSHIP_STALE/);assert.equal(h.counts().writes,0);
}
{
 const h=harness();h.runtime.relationshipDb={from:()=>({select(){return this;},eq(){return this;},abortSignal(){return this;},maybeSingle:async()=>({data:{stripe_scope:h.runtime.scope,stripe_object_id:'sub_one',stripe_customer_id:'cus_conflict'},error:null})})};
 await assert.rejects(consumer.consumeFinanceEvent(event('storedconflict','customer.subscription.created',h.f.subscription),h.runtime),/FINANCE_OWNERSHIP_CONFLICT/);assert.equal(h.counts().completions,0);
}
{
 const calls=[];const db={rpc:(name,input)=>{calls.push({name,input});return Promise.resolve({data:{outcome:'foreign_proven'},error:null});}};
 await storeModule.createFinanceStore(db).command('foreign_complete','acct_fixture:test','receipt',{event_id:'evt_fixture',expected_epoch:1,evidence:{},proofs:[]});assert.equal(calls[0].name,'billing_finance_complete_foreign');assert.ok(!('p_customer' in calls[0].input));
}
for(const name of ['finance-foreign-event','finance-customer-webhook'])assert.doesNotMatch(fs.readFileSync('src/lib/stripe/'+name+'.ts','utf8'),/console\.|logInfo|fetch\(/);
const legacyBefore=execFileSync('git',['show','HEAD:src/lib/stripe/finance-webhook.ts'],{encoding:'utf8'});assert.equal(fs.readFileSync('src/lib/stripe/finance-webhook.ts','utf8'),legacyBefore);
const head=file=>execFileSync('git',['show','HEAD:src/lib/stripe/'+file],{encoding:'utf8'});
assert.equal(fs.readFileSync('src/lib/stripe/webhook-observer.ts','utf8').replace('"FINANCE_OWNERSHIP_UNRESOLVED", "FINANCE_OWNERSHIP_CONFLICT", "FINANCE_OWNERSHIP_STALE", ',''),head('webhook-observer.ts'));
assert.equal(fs.readFileSync('src/lib/stripe/webhook-consumers.ts','utf8').replace(',foreign_complete:"event_finish"',''),head('webhook-consumers.ts'));
const priorCustomer=head('finance-customer-webhook.ts');
assert.equal(fs.readFileSync('src/lib/stripe/finance-customer-webhook.ts','utf8').slice(fs.readFileSync('src/lib/stripe/finance-customer-webhook.ts','utf8').indexOf('  const evidence=projectVerifiedFinanceRouting')).replace('   // Includes existing financial/attribution rules and retirement of stored items.\n',''),priorCustomer.slice(priorCustomer.indexOf('  const evidence=projectVerifiedFinanceRouting')).replace('   // Includes existing financial/attribution rules and retirement of stored items.\n','').replace('   // FINANCE_FOREIGN_APPLICATION deliberately remains retryable here: SQL has no reviewed foreign proof action.\n',''),'DMI customer path preserves acquisition/preparation/ownership/commit/release semantics');
console.log('PASS foreign runtime: 17 event types, price/exclusive-customer/refund proof, DMI normal acquisition, unknown/missing/mixed/revoked/truncated/metadata fail closed, stale completion retryable, duplicate, no provider/lease/binding/financial writes for foreign');
export async function validateForeignDatabase(client,Client,socket){
 const legacyBefore=(await client.query("SELECT pg_get_functiondef('billing_finance_command(text,text,uuid,jsonb)'::regprocedure) d")).rows[0].d;
 await client.query(sql);assert.equal((await client.query("SELECT pg_get_functiondef('billing_finance_command(text,text,uuid,jsonb)'::regprocedure) d")).rows[0].d,legacyBefore);const scope='acct_foreign:test';
 const cmd=async(action,input={},token=null)=>(await client.query('SELECT billing_finance_command($1,$2,$3,$4) r',[action,scope,token,input])).rows[0].r;
 await cmd('read_protocol');await client.query("SELECT billing_finance_transition($1,'legacy',0,'draining_to_customer')",[scope]);await client.query("SELECT billing_finance_transition($1,'draining_to_customer',0,'customer')",[scope]);
 await client.query("INSERT INTO billing_stripe_applications(application_key) VALUES ('other_app')");
 const register=async(type,id,app='other_app')=>client.query('SELECT billing_stripe_register_ownership($1,$2,$3,$4,$5,$6,$7,$8)',[scope,type,id,app,type==='price'?'price_owner':'exclusive_customer','operator_review','review_fixture','reviewed_operator_action']);
 await register('price','price_foreign');await register('customer','cus_foreign');await register('price','price_dmi','dmi_cards');
 const price={scope,type:'price',id:'price_foreign'},customer={scope,type:'customer',id:'cus_foreign'};
 const evidence={scope,id:'sub_foreign',kind:'subscription',complete:true,prices:[price]},proofs=[{...price,application:'other_app',revision:1}];
 const receipt=async id=>cmd('event_claim',{id,type:'customer.subscription.created',subject:'sub_foreign',created:fixtureNow});
 const complete=async(id,token,ev=evidence,ps=proofs,epoch=1,db=client)=>(await db.query('SELECT billing_finance_complete_foreign($1,$2,$3,$4,$5,$6) r',[scope,id,token,epoch,JSON.stringify(ev),JSON.stringify(ps)])).rows[0].r;
 const counts=async()=>{const result={};for(const table of ['billing_finance_subscriptions','billing_finance_subscription_items','billing_invoices','billing_payments','billing_invoice_payments','billing_payment_attempts','billing_refunds','billing_finance_activity'])result[table]=(await client.query('SELECT count(*)::int n FROM '+table+' WHERE stripe_scope=$1',[scope])).rows[0].n;return result;};
 const before=await counts(),r=await receipt('evt_foreign');
 await assert.rejects(complete('evt_foreign','11111111-1111-4111-8111-111111111111'),/FINANCE_PARTITION_RECEIPT_FENCE/);
 await assert.rejects(complete('evt_foreign',r.token,evidence,proofs,0),/FINANCE_PROTOCOL_EPOCH/);
 await assert.rejects(complete('evt_foreign',r.token,evidence,[{...proofs[0],revision:2}]),/FINANCE_OWNERSHIP_STALE/);
 await assert.rejects(complete('evt_foreign',r.token,{...evidence,prices:[{...price,id:'price_missing'}]}),/FINANCE_OWNERSHIP_UNRESOLVED/);
 await assert.rejects(complete('evt_foreign',r.token,{...evidence,complete:false}),/FINANCE_OWNERSHIP_UNRESOLVED/);
 await assert.rejects(complete('evt_foreign',r.token,{...evidence,prices:[price,{...price,id:'price_dmi'}]},[...proofs,{...price,id:'price_dmi',application:'dmi_cards',revision:1}]),/FINANCE_OWNERSHIP_CONFLICT/);
 await client.query('BEGIN');await complete('evt_foreign',r.token);await client.query('ROLLBACK');
 assert.equal((await client.query("SELECT state FROM billing_finance_event_deliveries WHERE stripe_scope=$1 AND stripe_event_id='evt_foreign'",[scope])).rows[0].state,'processing');
 assert.deepEqual(await complete('evt_foreign',r.token),{outcome:'foreign_proven'});assert.equal((await complete('evt_foreign',r.token)).duplicate,true);assert.equal((await receipt('evt_foreign')).duplicate,true);
 assert.deepEqual(await counts(),before);
 const row=(await client.query("SELECT state,partition_customer_id,partition_protocol_epoch FROM billing_finance_event_deliveries WHERE stripe_scope=$1 AND stripe_event_id='evt_foreign'",[scope])).rows[0];assert.deepEqual(row,{state:'ignored',partition_customer_id:null,partition_protocol_epoch:null});
 assert.equal((await client.query("SELECT count(*)::int n FROM billing_finance_sync_state WHERE stripe_scope=$1 AND resource_type='customer'",[scope])).rows[0].n,0);
 const c=await receipt('evt_customerforeign');await complete('evt_customerforeign',c.token,{...evidence,prices:[],customer},[{...customer,application:'other_app',revision:1}]);
 const stale=await receipt('evt_revoked');await client.query("SELECT billing_stripe_revoke_ownership($1,'price','price_foreign',1,'review_revoke','reviewed_operator_action')",[scope]);await assert.rejects(complete('evt_revoked',stale.token),/FINANCE_OWNERSHIP_STALE/);
 assert.equal((await client.query("SELECT state FROM billing_finance_event_deliveries WHERE stripe_scope=$1 AND stripe_event_id='evt_revoked'",[scope])).rows[0].state,'processing');
 // Registry share locks prevent revocation from overtaking a completion transaction.
 const other=new Client({host:socket,port:5432,user:'fixture',database:'postgres'});await other.connect();
 try{const held=await receipt('evt_lock');await client.query('BEGIN');await complete('evt_lock',held.token,{...evidence,prices:[],customer},[{...customer,application:'other_app',revision:1}]);let done=false;const revoke=other.query("SELECT billing_stripe_revoke_ownership($1,'customer','cus_foreign',1,'review_revoke','reviewed_operator_action')",[scope]).finally(()=>{done=true;});await new Promise(r=>setTimeout(r,40));assert.equal(done,false);await client.query('COMMIT');await revoke;}finally{await client.query('ROLLBACK');await other.end();}
 const expired=await receipt('evt_expired');await register('customer','cus_expired');await client.query("UPDATE billing_finance_event_deliveries SET lease_until=clock_timestamp()-interval '1 second' WHERE stripe_scope=$1 AND stripe_event_id='evt_expired'",[scope]);await assert.rejects(complete('evt_expired',expired.token,{...evidence,prices:[],customer:{...customer,id:'cus_expired'}},[{...customer,id:'cus_expired',application:'other_app',revision:1}]),/FINANCE_PARTITION_RECEIPT_FENCE/);
 assert.deepEqual(await counts(),before);
 assert.equal((await client.query('SELECT count(*)::int n FROM billing_finance_event_deliveries WHERE stripe_scope=$1 AND (partition_customer_id IS NOT NULL OR partition_protocol_epoch IS NOT NULL)',[scope])).rows[0].n,0);
 const security=(await client.query("SELECT prosecdef,proconfig FROM pg_proc WHERE oid='billing_finance_complete_foreign(text,text,uuid,bigint,jsonb,jsonb)'::regprocedure")).rows[0];assert.equal(security.prosecdef,true);assert.ok(security.proconfig.includes('search_path=pg_catalog, public'));
 for(const role of ['anon','authenticated','service_role'])assert.equal((await client.query("SELECT has_function_privilege($1,'billing_finance_complete_foreign(text,text,uuid,bigint,jsonb,jsonb)','EXECUTE') allowed",[role])).rows[0].allowed,role==='service_role');
 await client.query("SELECT billing_finance_transition($1,'customer',1,'draining_to_legacy')",[scope]);await client.query("SELECT billing_finance_transition($1,'draining_to_legacy',1,'legacy')",[scope]);
 console.log('PASS PostgreSQL foreign receipt: price/customer proof, stale/revoked/conflicting/missing proof, receipt token/expiry/epoch, atomic rollback, terminal duplicate, zero resources/partition binding/leases, concurrent revocation fencing, service-only RPC, restored legacy');
}
if(process.argv[2]==='--postgres'){
 const [bin,pg]=process.argv.slice(3);assert.ok(bin&&pg&&path.isAbsolute(bin)&&path.isAbsolute(pg));
 let runner=fs.readFileSync('scripts/validate-finance-postgres.mjs','utf8').replace("'./validate-finance-writer.mjs'",JSON.stringify(path.resolve('scripts/validate-finance-writer.mjs')));
 runner='import {validateForeignDatabase} from '+JSON.stringify(path.resolve('scripts/validate-finance-foreign-events.mjs'))+';\n'+runner;
 const setup=`
 const installed=new Set(await Promise.all(['20260930130000_finance_v1_writer.sql','20261003120000_finance_tax_evidence.sql'].map(n=>fs.readFile('supabase/migrations/'+n,'utf8'))));for(const text of installed)await client.query(text);
 for(const name of ['20261009180000_finance_partition_foundation.sql','20261009200000_finance_legacy_protocol_gate.sql','20261009210000_finance_customer_commit_foundation.sql','20261009220000_finance_reconciliation_protocol_guard.sql','20261009230000_finance_protocol_transitions.sql','20261010000000_stripe_application_ownership_registry.sql'])await client.query(await fs.readFile('supabase/migrations/'+name,'utf8'));
 await validateForeignDatabase(client,Client,socket);
 await validateWriter({query:(q,args)=>installed.has(q)?Promise.resolve({rows:[]}):client.query(q,args)});
 `;
 assert.ok(runner.includes(' await validateWriter(client);'));runner=runner.replace(' await validateWriter(client);',setup).replace('await fs.rm(temp,{recursive:true,force:true});}',"await fs.rm(temp,{recursive:true,force:true});console.log('CLEANUP: temporary PostgreSQL stopped and removed');}");
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'dmi-foreign-runner-'));try{const entry=path.join(temp,'runner.mjs');fs.writeFileSync(entry,runner);execFileSync(process.execPath,[entry,bin,pg],{stdio:'inherit'});}finally{fs.rmSync(temp,{recursive:true,force:true});}
}
