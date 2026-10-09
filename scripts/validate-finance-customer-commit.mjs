// Static/offline default; --postgres <local-bin> <absolute-pg-module> only.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {loadFinance} from "./validate-finance-consumer.mjs";
import {graphFixture,apiVersion,fixtureNow} from "./fixtures/finance-v1.mjs";
const file="supabase/migrations/20261009210000_finance_customer_commit_foundation.sql",sql=fs.readFileSync(file,"utf8");
const legacy=fs.readFileSync("supabase/migrations/20261009200000_finance_legacy_protocol_gate.sql","utf8");
const start=" IF p_input ? 'subscriptions'",end=" IF p_input ? 'run'";
const core=legacy.slice(legacy.indexOf(start),legacy.indexOf(end));assert.ok(sql.includes(core),'Financial writer rules preserved verbatim');
assert.ok(sql.trim().endsWith('COMMIT;'));
for(const guard of ['SET LOCAL lock_timeout = \'5s\'','SET LOCAL statement_timeout = \'60s\'','bind_receipt','commit_customer','complete_unsupported','lease.lease_protocol_epoch IS DISTINCT FROM control.epoch','lease.revision IS DISTINCT FROM expected_revision','receipt.partition_customer_id IS DISTINCT FROM p_customer','receipt.partition_protocol_epoch IS DISTINCT FROM control.epoch','pg_advisory_xact_lock(lock_key)','FINANCE_PARTITION_BINDING_IMMUTABLE','FINANCE_PARTITION_BINDING_TERMINAL','FINANCE_PARTITION_PRIVATE_HELPER_ACCESS'])assert.ok(sql.includes(guard),guard);
assert.doesNotMatch(sql,/DROP\s|ALTER TABLE public\.billing_finance_protocol_control|UPDATE public\.billing_finance_protocol_control|CREATE OR REPLACE FUNCTION public\.billing_finance_command\(/i);
const rpcSql=sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.billing_finance_partition_command'));
assert.ok(rpcSql.indexOf('FOR SHARE')<rpcSql.indexOf('FOR UPDATE'));
assert.equal(execFileSync('git',['diff','HEAD','--','src','supabase/migrations/20261009180000_finance_partition_foundation.sql','supabase/migrations/20261009200000_finance_legacy_protocol_gate.sql'],{encoding:'utf8'}),'');
console.log('PASS static customer commit: financial rules preserved, closed gates/fences, private helpers, receipt guards, no legacy/runtime/activation/reconciliation changes');
export async function validateCustomerCommit(client,Client,socket){
 const scope='acct_customerfixture:test',customer='cus_one';
 const legacyBefore=(await client.query("SELECT pg_get_functiondef('billing_finance_command(text,text,uuid,jsonb)'::regprocedure) d")).rows[0].d;
 await client.query(fs.readFileSync(file,'utf8'));
 assert.equal((await client.query("SELECT pg_get_functiondef('billing_finance_command(text,text,uuid,jsonb)'::regprocedure) d")).rows[0].d,legacyBefore);
 const rpc=async(action,token=null,input={expected_epoch:0},cus=customer,db=client)=>{
  await db.query('SET ROLE service_role');try{return (await db.query('SELECT billing_finance_partition_command($1,$2,$3,$4,$5) r',[action,scope,cus,token,input])).rows[0].r;}finally{await db.query('RESET ROLE');}
 };
 const eventClaim=async(id='evt_customer',type='customer.subscription.created',subject='sub_one')=>{
  await client.query('SET ROLE service_role');try{return (await client.query("SELECT billing_finance_command('event_claim',$1,NULL,$2) r",[scope,{id,type,subject,created:fixtureNow}])).rows[0].r;}finally{await client.query('RESET ROLE');}
 };
 await rpc('read_protocol',null,{},null);await assert.rejects(rpc('claim_customer'),/FINANCE_PARTITION_DISABLED/);
 await assert.rejects(client.query("UPDATE billing_finance_protocol_control SET mode='customer' WHERE stripe_scope=$1",[scope]),e=>e.code==='23514');
 const f=graphFixture(),g={...f.graph,invoices:[f.invoice],charges:[f.charge],allocations:[f.allocation],refunds:[f.refund]};
 const fake={scope,apiVersion,now:()=>fixtureNow,source:{identity:async()=>({scope,apiVersion}),graph:async()=>structuredClone(g)},store:{read:async()=>null,items:async()=>[],binding:async()=>null}};
 const {bundle}=await loadFinance().sync.prepareFinanceSync(fake,{kind:'subscription',id:'sub_one'});
 const empty=()=>Object.fromEntries(['subscriptions','items','invoices','payments','allocations','attempts','refunds','activity'].map(k=>[k,[]]));
 const state=async()=> (await client.query(`SELECT
 (SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]') FROM billing_finance_subscriptions t WHERE stripe_scope=$1) subscriptions,
 (SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]') FROM billing_invoices t WHERE stripe_scope=$1) invoices,
 (SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]') FROM billing_payments t WHERE stripe_scope=$1) payments,
 (SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]') FROM billing_finance_subscription_items t WHERE stripe_scope=$1) items,
 (SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]') FROM billing_invoice_payments t WHERE stripe_scope=$1) allocations,
 (SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]') FROM billing_payment_attempts t WHERE stripe_scope=$1) attempts,
 (SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]') FROM billing_refunds t WHERE stripe_scope=$1) refunds,
 (SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]') FROM billing_finance_activity t WHERE stripe_scope=$1) activity,
 (SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]') FROM billing_finance_event_deliveries t WHERE stripe_scope=$1) receipts,
 (SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]') FROM billing_finance_sync_state t WHERE stripe_scope=$1) leases`,[scope])).rows[0];
 // Customer-mode fixtures exist ONLY in disposable local PostgreSQL, never migration.
 await client.query('ALTER TABLE billing_finance_protocol_control DROP CONSTRAINT billing_finance_protocol_foundation_legacy');
 await client.query("UPDATE billing_finance_protocol_control SET mode='customer' WHERE stripe_scope=$1",[scope]);
 try{
  const receipt=await eventClaim(),lease=await rpc('claim_customer');
  const input={expected_epoch:0,expected_partition_revision:lease.revision,event_id:'evt_customer',event_token:receipt.token,bundle};
  await assert.rejects(rpc('bind_receipt',lease.token,{...input,event_token:'11111111-1111-4111-8111-111111111111'}),/FINANCE_PARTITION_RECEIPT_FENCE/);
  await assert.rejects(rpc('bind_receipt',lease.token,{...input,expected_epoch:1}),/FINANCE_PARTITION_EPOCH/);
  await rpc('bind_receipt',lease.token,input);
  const binding=(await client.query("SELECT partition_customer_id,partition_protocol_epoch FROM billing_finance_event_deliveries WHERE stripe_scope=$1 AND stripe_event_id='evt_customer'",[scope])).rows[0];assert.equal(binding.partition_customer_id,customer);assert.equal(binding.partition_protocol_epoch,'0');
  for(const value of ['cus_other',null])await assert.rejects(client.query("UPDATE billing_finance_event_deliveries SET partition_customer_id=$1 WHERE stripe_scope=$2 AND stripe_event_id='evt_customer'",[value,scope]),/FINANCE_PARTITION_BINDING_IMMUTABLE/);
  const otherLease=await rpc('claim_customer',null,{expected_epoch:0},'cus_other');const otherBundle=structuredClone(bundle);for(const k of ['subscriptions','invoices','payments','activity'])for(const entry of otherBundle[k])entry.row.stripe_customer_id='cus_other';
  await assert.rejects(rpc('bind_receipt',otherLease.token,{...input,expected_partition_revision:otherLease.revision,bundle:otherBundle},'cus_other'),/FINANCE_PARTITION_BINDING_IMMUTABLE/);
  await assert.rejects(rpc('commit_customer',otherLease.token,{...input,expected_partition_revision:otherLease.revision,bundle:otherBundle},'cus_other'),/FINANCE_PARTITION_RECEIPT_OWNER/);
  await rpc('release_customer',otherLease.token,{expected_epoch:0},'cus_other');
  const baseline=await state();
  await assert.rejects(rpc('commit_customer','11111111-1111-4111-8111-111111111111',input),/FINANCE_PARTITION_FENCE/);
  await assert.rejects(rpc('commit_customer',lease.token,{...input,expected_partition_revision:'0'}),/FINANCE_PARTITION_REVISION/);
  for(const kind of ['subscriptions','invoices','payments']){const bad=structuredClone(bundle);bad[kind][0].row.stripe_customer_id='cus_other';await assert.rejects(rpc('commit_customer',lease.token,{...input,bundle:bad}),/FINANCE_PARTITION_OWNERSHIP/);assert.deepEqual(await state(),baseline);}
  for(const mutate of [b=>b.refunds[0].row.stripe_charge_id='ch_missing',b=>b.items[0].row.stripe_subscription_id='sub_missing',b=>b.allocations[0].row.stripe_invoice_id='in_missing',b=>b.attempts.push({row:{stripe_scope:scope,attempt_key:'charge:ch_missing',stripe_charge_id:'ch_missing',stripe_customer_id:customer},expected_revision:'0'}),b=>b.activity.push({row:{stripe_scope:scope,activity_key:'subscription:missing',object_type:'subscriptions',object_id:'sub_missing',stripe_customer_id:customer},expected_revision:'0'}),b=>b.items.push(structuredClone(b.items[0]))]){const bad=structuredClone(bundle);mutate(bad);await assert.rejects(rpc('commit_customer',lease.token,{...input,bundle:bad}),/FINANCE_PARTITION_OWNERSHIP/);assert.deepEqual(await state(),baseline);}
  await client.query("UPDATE billing_finance_sync_state SET lease_until=clock_timestamp()-interval '1 second' WHERE stripe_scope=$1 AND resource_key=$2",[scope,customer]);
  await assert.rejects(rpc('commit_customer',lease.token,input),/FINANCE_PARTITION_FENCE/);
  const successor=await rpc('claim_customer');const current={...input,expected_partition_revision:successor.revision};
  await assert.rejects(rpc('commit_customer',lease.token,input),/FINANCE_PARTITION_FENCE/);
  const beforeWriteFailure=await state();const malformed=structuredClone(bundle);malformed.refunds[0].row.unexpected_field='PRIVATE_SYNTHETIC';
  await assert.rejects(rpc('commit_customer',successor.token,{...current,bundle:malformed}),/FINANCE_ROW/);assert.deepEqual(await state(),beforeWriteFailure);
  await client.query("CREATE FUNCTION fail_customer_receipt() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.state='processed' AND NEW.stripe_scope='acct_customerfixture:test' THEN RAISE EXCEPTION 'TEST_RECEIPT_FAILURE'; END IF; RETURN NEW; END$$; CREATE TRIGGER fail_customer_receipt BEFORE UPDATE ON billing_finance_event_deliveries FOR EACH ROW EXECUTE FUNCTION fail_customer_receipt()");
  await assert.rejects(rpc('commit_customer',successor.token,current),/TEST_RECEIPT_FAILURE/);assert.deepEqual(await state(),beforeWriteFailure);
  await client.query('DROP TRIGGER fail_customer_receipt ON billing_finance_event_deliveries; DROP FUNCTION fail_customer_receipt()');
  const result=await rpc('commit_customer',successor.token,current);assert.ok(result.written>0);
  const done=await state();assert.equal(done.receipts.find(x=>x.stripe_event_id==='evt_customer').state,'processed');const finished=done.leases.find(x=>x.resource_key===customer);assert.equal(finished.revision,Number(successor.revision)+1);assert.equal(finished.lease_token,null);assert.equal(finished.lease_protocol_epoch,null);
  await assert.rejects(rpc('commit_customer',successor.token,current),/FINANCE_PARTITION_FENCE/);assert.deepEqual(await state(),done);assert.equal((await eventClaim()).duplicate,true);
  // Terminal historical NULL receipt cannot gain a new association.
  const terminal=await eventClaim('evt_terminal');await client.query("UPDATE billing_finance_event_deliveries SET state='processed' WHERE stripe_scope=$1 AND stripe_event_id='evt_terminal'",[scope]);
  const next=await rpc('claim_customer');const terminalInput={...input,event_id:'evt_terminal',event_token:terminal.token,expected_partition_revision:next.revision};
  await assert.rejects(rpc('bind_receipt',next.token,terminalInput),/FINANCE_PARTITION_RECEIPT_FENCE/);
  await assert.rejects(client.query("UPDATE billing_finance_event_deliveries SET partition_customer_id='cus_one',partition_protocol_epoch=0 WHERE stripe_scope=$1 AND stripe_event_id='evt_terminal'",[scope]),/FINANCE_PARTITION_BINDING_TERMINAL/);
  // Stale stored immutable identity, including retired item, rejects and rolls back.
  const retry=await eventClaim('evt_identity'),proof=empty();proof.subscriptions=[{row:bundle.subscriptions[0].row,expected_revision:'1'}];
  await rpc('bind_receipt',next.token,{expected_epoch:0,expected_partition_revision:next.revision,event_id:'evt_identity',event_token:retry.token,bundle:proof});
  const staleBundle=empty();staleBundle.payments=[{row:{...bundle.payments[0].row,stripe_payment_intent_id:'pi_other'},expected_revision:'1'}];
  const staleInput={expected_epoch:0,expected_partition_revision:next.revision,event_id:'evt_identity',event_token:retry.token,bundle:staleBundle};const staleBefore=await state();
  await assert.rejects(rpc('commit_customer',next.token,staleInput),/FINANCE_PARTITION_IDENTITY/);assert.deepEqual(await state(),staleBefore);
  const retired=empty();retired.items=[{row:{...bundle.items[0].row,stripe_subscription_id:'sub_other',active:false},expected_revision:'1'}];
  await assert.rejects(rpc('commit_customer',next.token,{...staleInput,bundle:retired}),/FINANCE_PARTITION_IDENTITY/);assert.deepEqual(await state(),staleBefore);
  await rpc('release_customer',next.token);
  // Narrow ignored completion, idempotent, zero financial writes.
  const ignored=await eventClaim('evt_ignore','checkout.session.completed','cs_fixture');const financialBefore=await state();
  await rpc('complete_unsupported',ignored.token,{expected_epoch:0,event_id:'evt_ignore',reason:'unsupported_event'},null);
  const ignoredState=await state();for(const key of ['subscriptions','items','invoices','payments','allocations','attempts','refunds','activity','leases'])assert.deepEqual(ignoredState[key],financialBefore[key]);
  assert.equal((await rpc('complete_unsupported',ignored.token,{expected_epoch:0,event_id:'evt_ignore',reason:'unsupported_event'},null)).duplicate,true);
  await assert.rejects(rpc('complete_unsupported',retry.token,{expected_epoch:0,event_id:'evt_identity',reason:'unsupported_event'},null),/FINANCE_PARTITION_UNSUPPORTED/);
  await assert.rejects(rpc('complete_unsupported',ignored.token,{expected_epoch:0,event_id:'evt_ignore',reason:'foreign_application'},null),/FINANCE_PARTITION_INPUT/);
  for(const role of ['anon','authenticated','service_role'])for(const signature of ['billing_finance_customer_apply_bundle(text,jsonb,timestamptz)','billing_finance_customer_resource_owner(text,text,jsonb,text,text,integer)','billing_finance_customer_bundle_owner(text,text,jsonb)'])assert.equal((await client.query('SELECT has_function_privilege($1,$2,\'EXECUTE\') allowed',[role,signature])).rows[0].allowed,false);
  const fn=(await client.query("SELECT prosecdef,proconfig FROM pg_proc WHERE oid='billing_finance_partition_command(text,text,text,uuid,jsonb)'::regprocedure")).rows[0];assert.equal(fn.prosecdef,true);assert.deepEqual(fn.proconfig,['search_path=pg_catalog, public']);
  // Independent connections: the same customer's lease remains serialized.
  const other=new Client({host:socket,port:5432,user:'fixture',database:'postgres'});await other.connect();
  try{const held=await rpc('claim_customer');await assert.rejects(rpc('claim_customer',null,{expected_epoch:0},customer,other),/FINANCE_BUSY/);const independent=await rpc('claim_customer',null,{expected_epoch:0},'cus_independent',other);await rpc('release_customer',independent.token,{expected_epoch:0},'cus_independent',other);await rpc('release_customer',held.token);}finally{await other.end();}
 }finally{
  await client.query("UPDATE billing_finance_sync_state SET lease_token=NULL,lease_until=NULL,lease_protocol_epoch=NULL WHERE stripe_scope=$1",[scope]);
  await client.query("UPDATE billing_finance_protocol_control SET mode='legacy',epoch=0 WHERE stripe_scope=$1",[scope]);
  await client.query("ALTER TABLE billing_finance_protocol_control ADD CONSTRAINT billing_finance_protocol_foundation_legacy CHECK(mode='legacy' AND epoch=0)");
 }
 await assert.rejects(rpc('claim_customer'),/FINANCE_PARTITION_DISABLED/);
 assert.equal((await client.query("SELECT count(*)::int n FROM billing_finance_protocol_control WHERE mode<>'legacy' OR epoch<>0")).rows[0].n,0);
 console.log('PASS PostgreSQL customer commit: binding/fences/ownership; atomic financial and receipt failure rollback; duplicate/stale-worker/revision/lease guards; ignored zero writes; private helpers; independent customer leases; legacy-only restored');
}
if(process.argv[2]==='--postgres'){
 const [bin,pg]=process.argv.slice(3);assert.ok(bin&&pg&&path.isAbsolute(bin)&&path.isAbsolute(pg),'Local binary/module paths required; no hosted URL');
 let runner=fs.readFileSync('scripts/validate-finance-postgres.mjs','utf8').replace("'./validate-finance-writer.mjs'",JSON.stringify(path.resolve('scripts/validate-finance-writer.mjs')));
 runner='import {validateCustomerCommit} from '+JSON.stringify(path.resolve('scripts/validate-finance-customer-commit.mjs'))+';\n'+runner;
 const setup=`
 const installed=new Set(await Promise.all(['20260930130000_finance_v1_writer.sql','20261003120000_finance_tax_evidence.sql'].map(n=>fs.readFile('supabase/migrations/'+n,'utf8'))));
 for(const text of installed)await client.query(text);
 await client.query(await fs.readFile('supabase/migrations/20261009180000_finance_partition_foundation.sql','utf8'));
 await client.query(await fs.readFile('supabase/migrations/20261009200000_finance_legacy_protocol_gate.sql','utf8'));
 await validateCustomerCommit(client,Client,socket);
 await validateWriter({query:(q,args)=>installed.has(q)?Promise.resolve({rows:[]}):client.query(q,args)});
 `;
 runner=runner.replace(' await validateWriter(client);',setup).replace('await fs.rm(temp,{recursive:true,force:true});}',"await fs.rm(temp,{recursive:true,force:true});console.log('CLEANUP: disposable cluster stopped and removed');}");
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'dmi-customer-commit-runner-'));try{const entry=path.join(temp,'runner.mjs');fs.writeFileSync(entry,runner);execFileSync(process.execPath,[entry,bin,pg],{stdio:'inherit'});}finally{fs.rmSync(temp,{recursive:true,force:true});}
}
