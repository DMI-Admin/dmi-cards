// Offline by default. Explicit --postgres paths create a disposable Unix-socket cluster only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {loadFinance,memoryHarness} from './validate-finance-consumer.mjs';
import {apiVersion,fixtureNow} from './fixtures/finance-v1.mjs';
const file='supabase/migrations/20261009220000_finance_reconciliation_protocol_guard.sql';
const sql=fs.readFileSync(file,'utf8'),old=fs.readFileSync('supabase/migrations/20261009200000_finance_legacy_protocol_gate.sql','utf8');
const start=" IF p_input ? 'subscriptions'",end=" IF p_input ? 'run' THEN\n  rowdata";
assert.equal(sql.slice(sql.indexOf(start),sql.indexOf(end)),old.slice(old.indexOf(start),old.indexOf(end)),'Financial writer unchanged');
assert.equal(fs.readdirSync('supabase/migrations').filter(f=>f.startsWith('20261009220000_')).length,1);
for(const text of ['BEGIN;',"SET LOCAL lock_timeout = '5s'","SET LOCAL statement_timeout = '60s'",'protocol_epoch bigint NOT NULL DEFAULT 0','runrow.protocol_epoch IS DISTINCT FROM protocol.epoch','FINANCE_RECONCILIATION_SUSPENDED','FOR UPDATE','REVOKE ALL ON FUNCTION public.billing_finance_suspend_run','FOR SHARE'])assert.ok(sql.includes(text),text);
assert.ok(sql.trim().endsWith('COMMIT;'));
assert.doesNotMatch(sql,/DROP CONSTRAINT|UPDATE public\.billing_finance_protocol_control|billing_finance_partition_command|DELETE FROM|CREATE TABLE/i);
// Only the approved reconciliation entrypoints may change; lease and graph work stay byte-identical.
const syncFile='src/lib/stripe/finance-sync.ts',currentSync=fs.readFileSync(syncFile,'utf8');
const oldSync=execFileSync('git',['show','HEAD:'+syncFile],{encoding:'utf8'});
assert.equal(currentSync.slice(currentSync.indexOf('export type Lease='),currentSync.indexOf('export async function synchronizeFinance')),oldSync.slice(oldSync.indexOf('export type Lease='),oldSync.indexOf('export async function synchronizeFinance')));
assert.equal(execFileSync('git',['diff','HEAD','--','src',':(exclude)src/lib/stripe/finance-sync.ts',':(exclude)src/lib/stripe/finance-reconciliation.ts'],{encoding:'utf8'}),'');
assert.equal(execFileSync('git',['diff','HEAD','--','supabase/migrations'],{encoding:'utf8'}),'','No earlier migrations modified');
const scope='acct_reconcilefixture:test';
const {reconcile,sync}=loadFinance();
for(const mode of ['draining_to_customer','customer','draining_to_legacy']){
 const h=memoryHarness(scope);let provider=0,claims=0;
 const command=h.store.command;h.store.command=async(a,...args)=>{if(a==='read_protocol')return {mode,epoch:0};if(a==='claim')claims++;return command(a,...args);};
 const r={scope,apiVersion,now:()=>fixtureNow,store:h.store,source:{identity:async()=>{provider++;throw Error('unexpected provider');},scan:async()=>{provider++;throw Error('unexpected provider');},graph:async()=>{provider++;throw Error('unexpected provider');}}};
 const input={mode:'reconcile',resource:'recent_invoices',start:'2026-10-01',end:'2026-10-09',actor:'fixture'};
 await assert.rejects(reconcile.startFinanceRun(r,input),/FINANCE_RECONCILIATION_BLOCKED/);
 await assert.rejects(reconcile.resumeFinanceRun(r,randomUUID()),/FINANCE_RECONCILIATION_BLOCKED/);
 await assert.rejects(sync.synchronizeFinance(r,{kind:'invoice',id:'in_fixture'}),/FINANCE_RECONCILIATION_BLOCKED/);
 assert.equal(provider,0);assert.equal(claims,0);
}
{
 const h=memoryHarness(scope);let provider=0;const r={scope,apiVersion,now:()=>fixtureNow,store:h.store,source:{identity:async()=>{provider++;return {scope,apiVersion};},scan:async()=>({roots:[],next:null,complete:true}),graph:async()=>{throw Error('unexpected graph');}}};
 const run=await reconcile.startFinanceRun(r,{mode:'reconcile',resource:'recent_invoices',start:'2026-10-01',end:'2026-10-09',actor:'fixture'});assert.equal(run.protocol_epoch,0);
 assert.equal((await reconcile.resumeFinanceRun(r,run.id)).done,true);
 const read=h.store.run;h.store.run=async(...args)=>({...await read(...args),protocol_epoch:1});provider=0;
 await assert.rejects(reconcile.resumeFinanceRun(r,run.id),/FINANCE_RECONCILIATION_EPOCH/);assert.equal(provider,0);
 h.store.run=async(...args)=>({...await read(...args),status:'failed'});
 await assert.rejects(reconcile.resumeFinanceRun(r,run.id),/FINANCE_RECONCILIATION_RUN_BLOCKED/);assert.equal(provider,0);
}
console.log('PASS mocked reconciliation: early mode/epoch/suspension rejection; no provider or claims in blocked modes; normal legacy start/resume');
export async function validateReconciliationProtocol(client){
 const rpc=async(a,t=null,i={})=>(await client.query('SELECT billing_finance_command($1,$2,$3,$4) r',[a,scope,t,i])).rows[0].r;
 const suspend=async(id,epoch=0)=>client.query('SELECT billing_finance_suspend_run($1,$2,$3)',[scope,id,epoch]);
 const before=(await client.query("SELECT pg_get_functiondef('billing_finance_command(text,text,uuid,jsonb)'::regprocedure) d")).rows[0].d;
 // Failed installation rolls back all changes. Duplicate column is local fixture only.
 await client.query('ALTER TABLE billing_finance_sync_runs ADD COLUMN protocol_epoch bigint');
 await assert.rejects(client.query(sql),/already exists/);await client.query('ROLLBACK');
 assert.equal((await client.query("SELECT pg_get_functiondef('billing_finance_command(text,text,uuid,jsonb)'::regprocedure) d")).rows[0].d,before);
 await client.query('ALTER TABLE billing_finance_sync_runs DROP COLUMN protocol_epoch');
 await client.query(sql);
 await rpc('read_protocol');
 const input={id:randomUUID(),mode:'reconcile',resource:'recent_invoices',actor:'fixture',start:'2026-10-01',end:'2026-10-09',expected_protocol_epoch:0};
 let lease=await rpc('claim');let run=await rpc('run_start',lease.token,input);assert.equal(run.protocol_epoch,0);
 await assert.rejects(suspend(run.id),/FINANCE_RECONCILIATION_DRAIN_REQUIRED/);
 await assert.rejects(rpc('commit',lease.token,{expected_scope_revision:lease.revision,expected_protocol_epoch:1,run:{id:run.id}}),/FINANCE_RECONCILIATION_EPOCH/);
 const patch={id:run.id,expected_cursor:{},cursor:{after:'in_cursor'},processed:2,done:false,complete:true};
 await rpc('commit',lease.token,{expected_scope_revision:lease.revision,expected_protocol_epoch:0,run:patch});
 const read=async(id)=>(await client.query('SELECT * FROM billing_finance_sync_runs WHERE id=$1',[id])).rows[0];
 run=await read(run.id);assert.equal(run.status,'partial');assert.equal(run.processed_count,'2');
 const stateBefore={...run};await assert.rejects(suspend(run.id,1),/FINANCE_RECONCILIATION_EPOCH/);
 await suspend(run.id);const suspended=await read(run.id);assert.equal(suspended.status,'failed');assert.equal(suspended.error_code,'FINANCE_RECONCILIATION_SUSPENDED');
 for(const k of Object.keys(stateBefore).filter(k=>!['status','error_code','updated_at'].includes(k)))assert.deepEqual(suspended[k],stateBefore[k]);
 await assert.rejects(suspend(run.id),/FINANCE_RECONCILIATION_RUN_BLOCKED/);
 lease=await rpc('claim');await assert.rejects(rpc('run_start',lease.token,input),/FINANCE_RECONCILIATION_RUN_BLOCKED/);
 await assert.rejects(rpc('commit',lease.token,{expected_scope_revision:lease.revision,run:patch}),/FINANCE_RECONCILIATION_RUN_BLOCKED/);await rpc('release',lease.token);
 const activeId=randomUUID();lease=await rpc('claim');await rpc('run_start',lease.token,{...input,id:activeId});await rpc('release',lease.token);
 for(const mode of ['draining_to_customer','customer','draining_to_legacy']){
  const delivery=await rpc('event_claim',null,{id:'evt_webhookdrain'+mode.replaceAll('_',''),type:'invoice.updated',subject:'in_fixture',created:fixtureNow});
  lease=await rpc('claim');await client.query('BEGIN');
  try{
   await client.query('ALTER TABLE billing_finance_protocol_control DROP CONSTRAINT billing_finance_protocol_foundation_legacy');
   await client.query('UPDATE billing_finance_protocol_control SET mode=$1 WHERE stripe_scope=$2',[mode,scope]);
   const reject=async(p)=>{await client.query('SAVEPOINT rejected');await assert.rejects(p(),/FINANCE_RECONCILIATION_BLOCKED/);await client.query('ROLLBACK TO SAVEPOINT rejected');};
   await reject(()=>rpc('run_start',lease.token,{...input,id:randomUUID()}));
   // Old runtime omits epoch: SQL still blocks reconciliation and standalone financial writes.
   await reject(()=>rpc('commit',lease.token,{expected_scope_revision:lease.revision,run:{...patch,id:activeId}}));
   await reject(()=>rpc('commit',lease.token,{expected_scope_revision:lease.revision}));
   if(mode==='draining_to_customer')await rpc('commit',lease.token,{expected_scope_revision:lease.revision,event_id:'evt_webhookdrain'+mode.replaceAll('_',''),event_token:delivery.token,ignored:true});
  }finally{await client.query('ROLLBACK');}
  await rpc('release',lease.token);
 }
 // A future epoch change cannot resurrect a prior run, even for an old caller without selected epoch.
 lease=await rpc('claim');await client.query('BEGIN');
 try{
  await client.query('ALTER TABLE billing_finance_protocol_control DROP CONSTRAINT billing_finance_protocol_foundation_legacy');
  await client.query('UPDATE billing_finance_protocol_control SET epoch=1 WHERE stripe_scope=$1',[scope]);
  await client.query("UPDATE billing_finance_sync_state SET lease_protocol_epoch=1 WHERE stripe_scope=$1 AND resource_type='scope'",[scope]);
  await assert.rejects(rpc('commit',lease.token,{expected_scope_revision:lease.revision,run:{...patch,id:activeId}}),/FINANCE_RECONCILIATION_EPOCH/);
 }finally{await client.query('ROLLBACK');}await rpc('release',lease.token);
 // Matching-epoch completion remains atomic and cannot be suspended or reopened.
 lease=await rpc('claim');await rpc('commit',lease.token,{expected_scope_revision:lease.revision,expected_protocol_epoch:0,run:{id:activeId,expected_cursor:{},cursor:{},processed:0,done:true,complete:true}});
 await assert.rejects(suspend(activeId),/FINANCE_RECONCILIATION_RUN_BLOCKED/);
 lease=await rpc('claim');await assert.rejects(rpc('run_start',lease.token,{...input,id:activeId}),/FINANCE_RECONCILIATION_RUN_BLOCKED/);await rpc('release',lease.token);
 // Browser and routine service role cannot invoke the operator suspension RPC.
 for(const role of ['anon','authenticated','service_role'])assert.equal((await client.query("SELECT has_function_privilege($1,'billing_finance_suspend_run(text,uuid,bigint)','EXECUTE') allowed",[role])).rows[0].allowed,false);
 await assert.rejects(client.query("UPDATE billing_finance_protocol_control SET mode='customer' WHERE stripe_scope=$1",[scope]),e=>e.code==='23514');
 assert.equal((await client.query("SELECT count(*)::int n FROM billing_finance_protocol_control WHERE mode<>'legacy' OR epoch<>0")).rows[0].n,0);
 console.log('PASS PostgreSQL reconciliation: epoch binding, all mode gates, stale old-runtime rejection, drained-only suspension/history preservation, terminal protection, ACL, install rollback, legacy-only constraint');
}
if(process.argv[2]==='--postgres'){
 const [bin,pg]=process.argv.slice(3);assert.ok(bin&&pg&&path.isAbsolute(bin)&&path.isAbsolute(pg));
 let runner=fs.readFileSync('scripts/validate-finance-postgres.mjs','utf8').replace("'./validate-finance-writer.mjs'",JSON.stringify(path.resolve('scripts/validate-finance-writer.mjs')));
 runner='import {validateReconciliationProtocol} from '+JSON.stringify(path.resolve('scripts/validate-finance-reconciliation-protocol.mjs'))+';\n'+runner;
 const setup=`
 const installed=new Set(await Promise.all(['20260930130000_finance_v1_writer.sql','20261003120000_finance_tax_evidence.sql'].map(n=>fs.readFile('supabase/migrations/'+n,'utf8'))));
 for(const text of installed)await client.query(text);
 for(const name of ['20261009180000_finance_partition_foundation.sql','20261009200000_finance_legacy_protocol_gate.sql','20261009210000_finance_customer_commit_foundation.sql'])await client.query(await fs.readFile('supabase/migrations/'+name,'utf8'));
 await validateReconciliationProtocol(client);
 await validateWriter({query:(q,args)=>installed.has(q)?Promise.resolve({rows:[]}):client.query(q,args)});
 `;
 assert.ok(runner.includes(' await validateWriter(client);'));runner=runner.replace(' await validateWriter(client);',setup).replace('await fs.rm(temp,{recursive:true,force:true});}',"await fs.rm(temp,{recursive:true,force:true});console.log('CLEANUP: temporary PostgreSQL stopped and removed');}");
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'dmi-reconcile-runner-'));try{const entry=path.join(temp,'runner.mjs');fs.writeFileSync(entry,runner);execFileSync(process.execPath,[entry,bin,pg],{stdio:'inherit'});}finally{fs.rmSync(temp,{recursive:true,force:true});}
}
