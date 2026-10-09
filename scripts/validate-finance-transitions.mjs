// Offline/default or disposable local PostgreSQL only; never accepts hosted connection URLs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {loadFinance} from './validate-finance-consumer.mjs';
import {graphFixture,apiVersion,fixtureNow} from './fixtures/finance-v1.mjs';
const file='supabase/migrations/20261009230000_finance_protocol_transitions.sql',sql=fs.readFileSync(file,'utf8');
const previous=fs.readFileSync('supabase/migrations/20261009220000_finance_reconciliation_protocol_guard.sql','utf8');
const a=" IF p_input ? 'subscriptions'",b=" IF p_input ? 'run' THEN\n  rowdata";
assert.equal(sql.slice(sql.indexOf(a),sql.indexOf(b)),previous.slice(previous.indexOf(a),previous.indexOf(b)));
assert.equal(fs.readdirSync('supabase/migrations').filter(x=>x.startsWith('20261009230000_')).length,1);
assert.ok(sql.trim().endsWith('COMMIT;'));
for(const x of ['FOR UPDATE','lease_until>clock_timestamp()',"status IN ('running','partial')",'FINANCE_PROTOCOL_TRANSITION_STALE','FINANCE_PROTOCOL_DIRECT_TRANSITION',"p_target_mode IN ('legacy','customer')",'REVOKE ALL ON TABLE public.billing_finance_protocol_control','DROP CONSTRAINT billing_finance_protocol_foundation_legacy'])assert.ok(sql.includes(x),x);
assert.ok(sql.indexOf('CREATE TRIGGER')<sql.indexOf('DROP CONSTRAINT'));
assert.doesNotMatch(sql,/SELECT\s+public\.billing_finance_transition\(/i);
console.log('PASS static transitions: exact closed edges, exclusive authority, real lease/run drain, epoch boundary, direct-write guard, installation legacy, test-only scope, server-only RPC, financial rules preserved');
export async function validateTransitions(client,Client,socket){
 await client.query(sql);const scope='acct_transition:test';
 const legacy=async(action,token=null,input={},db=client)=>(await db.query('SELECT billing_finance_command($1,$2,$3,$4) r',[action,scope,token,input])).rows[0].r;
 const partition=async(action,customer,token=null,input={expected_epoch:1},db=client)=>(await db.query('SELECT billing_finance_partition_command($1,$2,$3,$4,$5) r',[action,scope,customer,token,input])).rows[0].r;
 const transition=async(mode,epoch,target,db=client)=>(await db.query('SELECT billing_finance_transition($1,$2,$3,$4) r',[scope,mode,epoch,target])).rows[0].r;
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 assert.equal((await client.query("SELECT count(*)::int n FROM billing_finance_protocol_control WHERE mode<>'legacy' OR epoch<>0")).rows[0].n,0);
 await legacy('read_protocol');
 await assert.rejects(client.query("UPDATE billing_finance_protocol_control SET mode='customer' WHERE stripe_scope=$1",[scope]),/FINANCE_PROTOCOL_DIRECT_TRANSITION/);
 await assert.rejects(transition('legacy',0,'customer'),/FINANCE_PROTOCOL_TRANSITION_INPUT/);
 const first=await legacy('claim',null,{expected_protocol_epoch:0});
 const run={id:randomUUID(),mode:'reconcile',resource:'recent_invoices',start:'2026-10-01',end:'2026-10-09',actor:'fixture',expected_protocol_epoch:0};
 await legacy('run_start',first.token,run);
 assert.deepEqual(await transition('legacy',0,'draining_to_customer'),{mode:'draining_to_customer',epoch:0});
 await assert.rejects(transition('draining_to_customer',0,'customer'),/FINANCE_PROTOCOL_DRAIN_REQUIRED/);
 await assert.rejects(legacy('claim'),/FINANCE_PROTOCOL_CLAIM_BLOCKED/);
 await legacy('release',first.token);
 await assert.rejects(transition('draining_to_customer',0,'customer'),/FINANCE_PROTOCOL_DRAIN_REQUIRED/);
 await client.query('SELECT billing_finance_suspend_run($1,$2,0)',[scope,run.id]);
 // Unexpected customer/other authority must also block activation.
 for(const type of ['customer','coordinator']){
  await client.query("INSERT INTO billing_finance_sync_state(stripe_scope,resource_type,resource_key,lease_token,lease_until) VALUES($1,$2,'unexpected',gen_random_uuid(),clock_timestamp()+interval '1 minute')",[scope,type]);
  await assert.rejects(transition('draining_to_customer',0,'customer'),/FINANCE_PROTOCOL_DRAIN_REQUIRED/);
  await client.query("UPDATE billing_finance_sync_state SET lease_until=clock_timestamp()-interval '1 second' WHERE stripe_scope=$1 AND resource_type=$2",[scope,type]);
 }
 assert.deepEqual(await transition('draining_to_customer',0,'customer'),{mode:'customer',epoch:1});
 await assert.rejects(transition('customer',0,'draining_to_legacy'),/FINANCE_PROTOCOL_TRANSITION_STALE/);
 await assert.rejects(legacy('claim'),/FINANCE_PROTOCOL_CLAIM_BLOCKED/);
 await assert.rejects(legacy('commit',first.token,{expected_scope_revision:first.revision,event_id:'evt_stale',event_token:first.token}),/FINANCE_PROTOCOL_WRITE_BLOCKED/);
 const other=new Client({host:socket,port:5432,user:'fixture',database:'postgres'});await other.connect();
 try{
  const one=await partition('claim_customer','cus_one');
  await assert.rejects(partition('claim_customer','cus_one',null,{expected_epoch:1},other),/FINANCE_BUSY/);
  const two=await partition('claim_customer','cus_two',null,{expected_epoch:1},other);
  await partition('release_customer','cus_two',two.token,{expected_epoch:1},other);
  // An expired worker cannot commit after a successor reclaims the same partition.
  await client.query("UPDATE billing_finance_sync_state SET lease_until=clock_timestamp()-interval '1 second' WHERE stripe_scope=$1 AND resource_key='cus_one'",[scope]);
  const successor=await partition('claim_customer','cus_one');
  await assert.rejects(partition('commit_customer','cus_one',one.token,{expected_epoch:1,expected_partition_revision:one.revision,event_id:'evt_stale',event_token:first.token,bundle:{}}),/FINANCE_PARTITION_FENCE/);
  const f=graphFixture();const runtime={scope,apiVersion,now:()=>fixtureNow,source:{identity:async()=>({scope,apiVersion}),graph:async()=>structuredClone(f.graph)},store:{read:async()=>null,items:async()=>[],binding:async()=>null}};
  const prepared=await loadFinance().sync.prepareFinanceSync(runtime,{kind:'subscription',id:'sub_one'});
  const receipt=await legacy('event_claim',null,{id:'evt_partitioncommit',type:'customer.subscription.created',subject:'sub_one',created:fixtureNow});
  const input={expected_epoch:1,expected_partition_revision:successor.revision,event_id:'evt_partitioncommit',event_token:receipt.token,bundle:prepared.bundle};
  await partition('bind_receipt','cus_one',successor.token,input);
  const cross=structuredClone(prepared.bundle);cross.subscriptions[0].row.stripe_customer_id='cus_two';
  await assert.rejects(partition('commit_customer','cus_one',successor.token,{...input,bundle:cross}),/FINANCE_PARTITION_OWNERSHIP/);
  assert.equal((await client.query('SELECT count(*)::int n FROM billing_finance_subscriptions WHERE stripe_scope=$1',[scope])).rows[0].n,0);
  assert.equal((await client.query("SELECT state FROM billing_finance_event_deliveries WHERE stripe_scope=$1 AND stripe_event_id='evt_partitioncommit'",[scope])).rows[0].state,'processing');
  // Commit retains shared authority until its enclosing transaction ends; transition cannot overtake it.
  await client.query('BEGIN');await partition('commit_customer','cus_one',successor.token,input);
  let settled=false;const draining=transition('customer',1,'draining_to_legacy',other).finally(()=>{settled=true;});
  await sleep(75);assert.equal(settled,false);await client.query('COMMIT');assert.deepEqual(await draining,{mode:'draining_to_legacy',epoch:1});
  assert.equal((await legacy('event_claim',null,{id:'evt_partitioncommit',type:'customer.subscription.created',subject:'sub_one',created:fixtureNow})).duplicate,true);
  await assert.rejects(partition('claim_customer','cus_one'),/FINANCE_PARTITION_DISABLED/);
  // Worker lease surviving the start of rollback keeps legacy activation blocked.
  // Local fixture inserts a held lease at current epoch; it is real DB drain evidence, not caller counts.
  await client.query("INSERT INTO billing_finance_sync_state(stripe_scope,resource_type,resource_key,lease_token,lease_until,lease_protocol_epoch) VALUES($1,'customer','cus_held',gen_random_uuid(),clock_timestamp()+interval '1 minute',1)",[scope]);
  await assert.rejects(transition('draining_to_legacy',1,'legacy'),/FINANCE_PROTOCOL_DRAIN_REQUIRED/);
  await client.query("UPDATE billing_finance_sync_state SET lease_until=clock_timestamp()-interval '1 second' WHERE stripe_scope=$1 AND resource_key='cus_held'",[scope]);
  assert.deepEqual(await transition('draining_to_legacy',1,'legacy'),{mode:'legacy',epoch:2});
  await assert.rejects(legacy('claim',null,{expected_protocol_epoch:0}),/FINANCE_PROTOCOL_EPOCH/);
  const fresh=await legacy('claim',null,{expected_protocol_epoch:2});await legacy('release',fresh.token);
  // Exclusive transition held in a transaction forces a waiting claim to re-read the changed mode.
  await client.query('BEGIN');await transition('legacy',2,'draining_to_customer');let done=false;
  const claim=legacy('claim',null,{expected_protocol_epoch:2},other).then(()=>{throw Error('UNSAFE_CLAIM');},e=>{assert.match(e.message,/FINANCE_PROTOCOL_CLAIM_BLOCKED/);done=true;});
  await sleep(75);assert.equal(done,false);await client.query('COMMIT');await claim;
  await transition('draining_to_customer',2,'customer');await transition('customer',3,'draining_to_legacy');await transition('draining_to_legacy',3,'legacy');
 }finally{await client.query('ROLLBACK');await other.query('ROLLBACK');await other.end();}
 for(const role of ['anon','authenticated'])assert.equal((await client.query("SELECT has_function_privilege($1,'billing_finance_transition(text,text,bigint,text)','EXECUTE') allowed",[role])).rows[0].allowed,false);
 assert.equal((await client.query("SELECT has_function_privilege('service_role','billing_finance_transition(text,text,bigint,text)','EXECUTE') allowed")).rows[0].allowed,true);
 for(const role of ['anon','authenticated','service_role'])for(const col of ['mode','epoch'])assert.equal((await client.query("SELECT has_column_privilege($1,'billing_finance_protocol_control',$2,'UPDATE') allowed",[role,col])).rows[0].allowed,false);
 await assert.rejects(client.query("SELECT billing_finance_transition('acct_fixture:live','legacy',0,'draining_to_customer')"),/FINANCE_PROTOCOL_TRANSITION_INPUT/);
 assert.equal((await legacy('read_protocol')).mode,'legacy');
 console.log('PASS PostgreSQL cutover: real lease/run drain; suspension; epoch switches/rollback; stale requests/workers; direct-write denial; independent customers/same-customer busy; expiry/successor; atomic receipt commit; duplicate; independent claim/commit transition races; legacy restored');
}
if(process.argv[2]==='--postgres'){
 const [bin,pg]=process.argv.slice(3);assert.ok(bin&&pg&&path.isAbsolute(bin)&&path.isAbsolute(pg));
 let runner=fs.readFileSync('scripts/validate-finance-postgres.mjs','utf8').replace("'./validate-finance-writer.mjs'",JSON.stringify(path.resolve('scripts/validate-finance-writer.mjs')));
 runner='import {validateTransitions} from '+JSON.stringify(path.resolve('scripts/validate-finance-transitions.mjs'))+';\n'+runner;
 const setup=`
 const installed=new Set(await Promise.all(['20260930130000_finance_v1_writer.sql','20261003120000_finance_tax_evidence.sql'].map(n=>fs.readFile('supabase/migrations/'+n,'utf8'))));
 for(const text of installed)await client.query(text);
 for(const name of ['20261009180000_finance_partition_foundation.sql','20261009200000_finance_legacy_protocol_gate.sql','20261009210000_finance_customer_commit_foundation.sql','20261009220000_finance_reconciliation_protocol_guard.sql'])await client.query(await fs.readFile('supabase/migrations/'+name,'utf8'));
 await validateTransitions(client,Client,socket);
 await validateWriter({query:(q,args)=>installed.has(q)?Promise.resolve({rows:[]}):client.query(q,args)});
 `;
 assert.ok(runner.includes(' await validateWriter(client);'));runner=runner.replace(' await validateWriter(client);',setup).replace('await fs.rm(temp,{recursive:true,force:true});}',"await fs.rm(temp,{recursive:true,force:true});console.log('CLEANUP: temporary PostgreSQL stopped and removed');}");
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'dmi-transition-runner-'));try{const entry=path.join(temp,'runner.mjs');fs.writeFileSync(entry,runner);execFileSync(process.execPath,[entry,bin,pg],{stdio:'inherit'});}finally{fs.rmSync(temp,{recursive:true,force:true});}
}
