// Offline static by default. --postgres <absolute-bin> <absolute-pg-module>
// creates only the repository's temporary private Unix-socket PostgreSQL cluster.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {execFileSync} from "node:child_process";
const file="supabase/migrations/20261009200000_finance_legacy_protocol_gate.sql";
const sql=fs.readFileSync(file,"utf8"),previous=fs.readFileSync("supabase/migrations/20261003120000_finance_tax_evidence.sql","utf8");
assert.ok(sql.startsWith("-- Legacy-only"));assert.ok(sql.trim().endsWith("COMMIT;"));
for(const text of ["SET LOCAL lock_timeout = '5s'","SET LOCAL statement_timeout = '60s'","ADD COLUMN lease_protocol_epoch bigint","FINANCE_PROTOCOL_DRAIN_REQUIRED","lease_protocol_epoch=protocol.epoch","lease_protocol_epoch IS DISTINCT FROM protocol.epoch","FOR SHARE","protocol.mode<>'legacy'","protocol.mode NOT IN ('legacy','draining_to_customer')"])assert.ok(sql.includes(text),text);
assert.doesNotMatch(sql,/DROP\s|UPDATE public\.billing_finance_protocol_control|ALTER TABLE public\.billing_finance_protocol_control|billing_finance_partition_command\(/i);
const start=" IF p_input ? 'subscriptions'",end=" IF clock_timestamp()>=lockrow.lease_until";
assert.equal(sql.slice(sql.indexOf(start),sql.indexOf(end)),previous.slice(previous.indexOf(start),previous.indexOf(end)),"All financial validation/write rules preserved verbatim");
assert.ok(sql.indexOf("FOR SHARE")<sql.indexOf("FOR UPDATE"));
assert.ok(sql.indexOf("lease_protocol_epoch IS DISTINCT")<sql.indexOf(start));
assert.doesNotMatch(sql,/UPDATE[^;]+lease_protocol_epoch=0/s);
assert.equal(execFileSync("git",["diff","HEAD","--","src","supabase/migrations/20261009180000_finance_partition_foundation.sql"],{encoding:"utf8"}),"");
console.log("PASS static legacy protocol: epoch binding, lock order, active-lease install refusal, unchanged financial validations, no activation/runtime edits");
async function databaseTests(client,Client,socket,readFile){
 const scope="acct_gate:test";
 const rpc=async(action,token=null,input={},db=client)=>(await db.query('SELECT billing_finance_command($1,$2,$3,$4) r',[action,scope,token,input])).rows[0].r;
 const migration=await readFile('supabase/migrations/20261009200000_finance_legacy_protocol_gate.sql','utf8');
 // Historical live authority prevents installation; no guessed epoch/backfill.
 const old=await rpc('claim');
 await assert.rejects(client.query(migration),/FINANCE_PROTOCOL_DRAIN_REQUIRED/);await client.query('ROLLBACK');
 assert.equal((await client.query("SELECT count(*)::int n FROM information_schema.columns WHERE table_name='billing_finance_sync_state' AND column_name='lease_protocol_epoch'")).rows[0].n,0);
 await rpc('release',old.token);await client.query(migration);
 const first=await rpc('claim');
 assert.equal((await client.query("SELECT lease_protocol_epoch::text e FROM billing_finance_sync_state WHERE stripe_scope=$1",[scope])).rows[0].e,'0');
 await assert.rejects(rpc('claim'),/FINANCE_BUSY/);
 await assert.rejects(rpc('release',old.token),/FINANCE_FENCE/);
 await client.query('UPDATE billing_finance_sync_state SET lease_protocol_epoch=1 WHERE stripe_scope=$1',[scope]);
 await assert.rejects(rpc('commit',first.token,{expected_scope_revision:first.revision}),/FINANCE_PROTOCOL_EPOCH/);
 await assert.rejects(rpc('release',first.token),/FINANCE_PROTOCOL_EPOCH/);
 await client.query('UPDATE billing_finance_sync_state SET lease_protocol_epoch=0 WHERE stripe_scope=$1',[scope]);
 const run={id:'11111111-1111-4111-8111-111111111111',mode:'reconcile',resource:'recent_invoices',actor:'fixture',start:'2026-10-01T00:00:00Z',end:'2026-10-09T00:00:00Z'};
 await rpc('run_start',first.token,run);await rpc('commit',first.token,{expected_scope_revision:first.revision});
 assert.equal((await client.query("SELECT lease_protocol_epoch e FROM billing_finance_sync_state WHERE stripe_scope=$1",[scope])).rows[0].e,null);
 // Hypothetical future modes ONLY in rolled-back local fixtures. Migration keeps constraint.
 const rejectWithin=async(promise,pattern)=>{await client.query('SAVEPOINT expected_failure');await assert.rejects(promise(),pattern);await client.query('ROLLBACK TO SAVEPOINT expected_failure');};
 for(const mode of ['draining_to_customer','customer','draining_to_legacy']){
  const lease=await rpc('claim');
  await client.query('BEGIN');
  try{
   await client.query('ALTER TABLE billing_finance_protocol_control DROP CONSTRAINT billing_finance_protocol_foundation_legacy');
   await client.query('UPDATE billing_finance_protocol_control SET mode=$1 WHERE stripe_scope=$2',[mode,scope]);
   await rejectWithin(()=>rpc('claim'),/FINANCE_PROTOCOL_CLAIM_BLOCKED/);
   await rejectWithin(()=>rpc('run_start',lease.token,{...run,id:'22222222-2222-4222-8222-222222222222'}),/FINANCE_PROTOCOL_WRITE_BLOCKED/);
   if(mode==='draining_to_customer')await rpc('commit',lease.token,{expected_scope_revision:lease.revision});
   else await rejectWithin(()=>rpc('commit',lease.token,{expected_scope_revision:lease.revision}),/FINANCE_PROTOCOL_WRITE_BLOCKED/);
  }finally{await client.query('ROLLBACK');}
  await rpc('release',lease.token);
 }
 // Foundation still disables customer authority and activation after tests.
 await assert.rejects(client.query("UPDATE billing_finance_protocol_control SET mode='customer' WHERE stripe_scope=$1",[scope]),e=>e.code==='23514');
 await assert.rejects(client.query("SELECT billing_finance_partition_command('claim_customer',$1,'cus_fixture',NULL,'{\"expected_epoch\":0}')",[scope]),/FINANCE_PARTITION_DISABLED/);
 const other=new Client({host:socket,port:5432,user:'fixture',database:'postgres'});await other.connect();
 try{
  // Exclusive protocol authority blocks a writer until mode is re-read after wait.
  await client.query('BEGIN');await client.query('SELECT * FROM billing_finance_protocol_control WHERE stripe_scope=$1 FOR UPDATE',[scope]);
  let settled=false;const pending=rpc('claim',null,{},other).finally(()=>{settled=true;});
  await new Promise(r=>setTimeout(r,100));assert.equal(settled,false);
  await client.query('COMMIT');const lease=await pending;await rpc('release',lease.token);
  // A transaction retaining writer authority's shared gate blocks exclusive transition.
  await client.query('BEGIN');const fenced=await rpc('claim');
  await other.query('BEGIN');let exclusive=false;
  const transition=other.query('SELECT * FROM billing_finance_protocol_control WHERE stripe_scope=$1 FOR UPDATE',[scope]).then(()=>{exclusive=true;});
  await new Promise(r=>setTimeout(r,100));assert.equal(exclusive,false);
  await rpc('commit',fenced.token,{expected_scope_revision:fenced.revision});await client.query('COMMIT');await transition;await other.query('ROLLBACK');
  // Waiting on a writer row refreshes the wall clock before busy/expiry evaluation.
  await client.query('BEGIN');await client.query('SELECT * FROM billing_finance_sync_state WHERE stripe_scope=$1 FOR UPDATE',[scope]);
  const waiting=rpc('claim',null,{},other);await new Promise(r=>setTimeout(r,50));await client.query('COMMIT');const got=await waiting;await rpc('release',got.token);
 }finally{await client.query('ROLLBACK');await other.query('ROLLBACK');await other.end();}
 assert.equal((await client.query("SELECT count(*)::int n FROM billing_finance_protocol_control WHERE mode<>'legacy' OR epoch<>0")).rows[0].n,0);
 assert.equal((await client.query("SELECT count(*)::int n FROM pg_constraint WHERE conname='billing_finance_protocol_foundation_legacy' AND convalidated")).rows[0].n,1);
 for(const role of ['anon','authenticated'])assert.equal((await client.query("SELECT has_function_privilege($1,'billing_finance_command(text,text,uuid,jsonb)','EXECUTE') allowed",[role])).rows[0].allowed,false);
 console.log('PASS PostgreSQL: install rollback/drain; epoch/token fences; all four modes; reconciliation gate; independent protocol/writer lock races; no customer activation');
}
if(process.argv[2]==='--postgres'){
 const [bin,pg]=process.argv.slice(3);assert.ok(bin&&pg&&path.isAbsolute(bin)&&path.isAbsolute(pg),'Explicit local binary/module paths required; no connection URLs');
 let runner=fs.readFileSync('scripts/validate-finance-postgres.mjs','utf8').replace("'./validate-finance-writer.mjs'",JSON.stringify(path.resolve('scripts/validate-finance-writer.mjs')));
 const replacement=`
 await client.query(await fs.readFile('supabase/migrations/20260930130000_finance_v1_writer.sql','utf8'));
 await client.query(await fs.readFile('supabase/migrations/20261003120000_finance_tax_evidence.sql','utf8'));
 await client.query(await fs.readFile('supabase/migrations/20261009180000_finance_partition_foundation.sql','utf8'));
 await (${databaseTests.toString()})(client,Client,socket,fs.readFile);
 // Existing writer/consumer regression suite against the gated writer. Suppress
 // only its two exact already-applied migration strings; never overwrite new gate.
 const installed=new Set(await Promise.all(['20260930130000_finance_v1_writer.sql','20261003120000_finance_tax_evidence.sql'].map(n=>fs.readFile('supabase/migrations/'+n,'utf8'))));
 await validateWriter({query:(q,args)=>installed.has(q)?Promise.resolve({rows:[]}):client.query(q,args)});
 `;
 assert.ok(runner.includes(' await validateWriter(client);'));runner=runner.replace(' await validateWriter(client);',replacement);
 runner=runner.replace('await fs.rm(temp,{recursive:true,force:true});}',"await fs.rm(temp,{recursive:true,force:true});console.log('CLEANUP: temporary PostgreSQL stopped and cluster removed');}");
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'dmi-legacy-gate-runner-')),entry=path.join(temp,'runner.mjs');
 try{fs.writeFileSync(entry,runner);execFileSync(process.execPath,[entry,bin,pg],{stdio:'inherit'});}
 finally{fs.rmSync(temp,{recursive:true,force:true});}
}
