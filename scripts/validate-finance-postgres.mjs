// Runs ONLY an ephemeral local PostgreSQL cluster on a private Unix socket.
// Usage: node scripts/validate-finance-postgres.mjs /absolute/native/bin /absolute/pg/module
import assert from 'node:assert/strict';
import {validateWriter} from './validate-finance-writer.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
const [bin,pgModule]=process.argv.slice(2);
if(!bin||!pgModule||!path.isAbsolute(bin)||!path.isAbsolute(pgModule))throw Error('Local PostgreSQL binary directory required; no connection URL accepted.');
const {Client}=createRequire(import.meta.url)(pgModule);
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'dmi-finance-pg-')),data=path.join(temp,'data'),socket=path.join(temp,'socket');await fs.mkdir(socket);
const run=(file,args)=>new Promise((resolve,reject)=>{const p=spawn(file,args,{stdio:['ignore','pipe','pipe']});let output='';p.stdout.on('data',b=>output+=b);p.stderr.on('data',b=>output+=b);p.on('error',reject);p.on('exit',code=>code===0?resolve():reject(Error(output)));});
let server,client;
try{
 await run(path.join(bin,'initdb'),['-D',data,'--no-locale','-E','UTF8','-U','fixture','--auth=trust']);
 server=spawn(path.join(bin,'postgres'),['-D',data,'-k',socket,'-h','','-p','5432'],{stdio:['ignore','pipe','pipe']});let logs='';server.stderr.on('data',b=>logs+=b);server.stdout.resume();
 for(let n=0;n<100;n++){const candidate=new Client({host:socket,port:5432,user:'fixture',database:'postgres'});try{await candidate.connect();client=candidate;break;}catch{await candidate.end().catch(()=>{});await new Promise(r=>setTimeout(r,100));}}
 if(!client)throw Error(logs);
 await client.query(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE TABLE profiles(id uuid PRIMARY KEY REFERENCES auth.users(id));CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;GRANT USAGE ON SCHEMA auth TO authenticated;`);
 for(const name of ['20260807143000_create_stripe_billing_state.sql','20260810100000_update_billing_plan_constraint.sql','20260927010000_stripe_reliability_foundation.sql'])await client.query(await fs.readFile('supabase/migrations/'+name,'utf8'));
 const baseline=await client.query(`SELECT relname,relacl::text,relrowsecurity FROM pg_class WHERE oid IN ('billing_subscriptions'::regclass,'billing_accounts'::regclass,'stripe_webhook_events'::regclass) ORDER BY relname`);
 const foundation=await fs.readFile('supabase/migrations/20260930120000_finance_v1_foundation.sql','utf8');await client.query(foundation);
 assert.deepEqual((await client.query(`SELECT relname,relacl::text,relrowsecurity FROM pg_class WHERE oid IN ('billing_subscriptions'::regclass,'billing_accounts'::regclass,'stripe_webhook_events'::regclass) ORDER BY relname`)).rows,baseline.rows);
 const tables=[...foundation.matchAll(/CREATE TABLE public\.(\w+)/g)].map(m=>m[1]);assert.equal(tables.length,11);
 for(const table of tables){
  assert.equal((await client.query('SELECT count(*)::int n FROM '+table)).rows[0].n,0);
  assert.equal((await client.query('SELECT relrowsecurity r FROM pg_class WHERE oid=$1::regclass',[table])).rows[0].r,true);
  for(const role of ['anon','authenticated']){await client.query('SET ROLE '+role);await assert.rejects(client.query('SELECT * FROM '+table),/permission denied/);await client.query('RESET ROLE');}
  await client.query('SET ROLE service_role');await client.query('SELECT * FROM '+table);
  await assert.rejects(client.query('DELETE FROM '+table),/permission denied/);await assert.rejects(client.query('UPDATE '+table+' SET stripe_scope=stripe_scope'),/permission denied/);await client.query('RESET ROLE');
 }
 const scope='acct_fixture:test';
 const insert=async(table,row)=>{const keys=Object.keys(row);return client.query(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map((_,i)=>'$'+(i+1)).join(',')})`,Object.values(row));};
 const base={stripe_scope:scope,stripe_object_id:'sub_one',stripe_created_at:'2026-09-01',stripe_api_version:'fixture',normalizer_version:1,verified_at:'2026-09-01'};
 const sub={...base,stripe_customer_id:'cus_one',status:'active',cancel_at_period_end:false,collection_paused:false,linkage_status:'unresolved',valuation_status:'incomplete',valuation_reason:'fixture',items_complete:false};
 await insert('billing_finance_subscriptions',sub);
 await assert.rejects(insert('billing_finance_subscriptions',sub),/duplicate key/);
 await insert('billing_finance_subscriptions',{...sub,stripe_scope:'acct_fixture:live'});
 const item={...base,stripe_object_id:'si_one',stripe_subscription_id:'sub_one',stripe_price_id:'price_one',stripe_product_id:'prod_one',currency:'gbp',quantity:'9007199254740993',unit_amount_decimal_minor:'599.123456789012',recurring_interval:'month',interval_count:1,usage_type:'licensed',billing_scheme:'per_unit',tax_behavior:'exclusive',valuation_status:'incomplete',valuation_reason:'fixture'};
 await insert('billing_finance_subscription_items',item);
 assert.equal((await client.query('SELECT quantity,unit_amount_decimal_minor::text AS decimal FROM billing_finance_subscription_items')).rows[0].quantity,'9007199254740993');
 assert.equal((await client.query('SELECT unit_amount_decimal_minor::text AS decimal FROM billing_finance_subscription_items')).rows[0].decimal,'599.123456789012');
 await assert.rejects(insert('billing_finance_subscription_items',{...item,stripe_object_id:'si_cross',stripe_scope:'acct_other:test'}),/foreign key/);
 await assert.rejects(insert('billing_finance_subscription_items',{...item,stripe_object_id:'si_bad',quantity:-1}),/check constraint/);
 await assert.rejects(insert('billing_finance_subscription_items',{...item,stripe_object_id:'si_bad',currency:'GBP'}),/check constraint/);
 await assert.rejects(client.query("DELETE FROM billing_finance_subscriptions WHERE stripe_scope=$1",[scope]),/foreign key/);
 // Entire migration rolls back on conflicting names rather than accepting drift.
 await assert.rejects(client.query(foundation),/already exists/);await client.query('ROLLBACK');
 assert.equal((await client.query('SELECT count(*)::int n FROM billing_finance_subscriptions')).rows[0].n,2);
 const fks=await client.query(`SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE contype='f' AND conrelid IN (SELECT oid FROM pg_class WHERE relname=ANY($1::text[]))`,['{'+tables.join(',')+'}']);
 for(const row of fks.rows){assert.match(row.d,/FOREIGN KEY \(stripe_scope,/);assert.match(row.d,/ON DELETE RESTRICT/);}
 assert.equal((await client.query('SELECT count(*)::int n FROM billing_subscriptions')).rows[0].n,0);
 await validateWriter(client);
 console.log('PASS: 11 additive tables; RLS/browser denial; service read-only; exact bigint/decimal; scoped PK/FK; no cascade; malformed-value constraints; migration conflict rollback; entitlement baseline untouched.');
}finally{await client?.end().catch(()=>{});if(server&&server.exitCode===null)await new Promise(resolve=>{server.once('exit',resolve);server.kill('SIGTERM');});await fs.rm(temp,{recursive:true,force:true});}
