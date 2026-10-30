// Explicit disposable local PostgreSQL binaries and driver only. TCP disabled.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
const [bin,driver]=process.argv.slice(2);if(!path.isAbsolute(bin||'')||!path.isAbsolute(driver||''))throw Error('Explicit local paths required');
const {Client}=createRequire(import.meta.url)(driver),temp=await fs.mkdtemp(path.join(os.tmpdir(),'dmi-simple-pg-')),data=path.join(temp,'data'),socket=path.join(temp,'socket');await fs.mkdir(socket);
const run=(cmd,args)=>new Promise((resolve,reject)=>{const p=spawn(cmd,args,{stdio:['ignore','pipe','pipe']});let out='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>out+=b);p.on('error',reject);p.on('exit',n=>n?reject(Error(out)):resolve());});
let db,server,n=0;const q=async s=>(await db.query(s)).rows;const test=async(name,fn)=>{await fn();n++;console.log('PASS '+name);};
const user='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
try{
 await run(path.join(bin,'initdb'),['-D',data,'-U','fixture','--auth=trust','--no-locale']);server=spawn(path.join(bin,'postgres'),['-D',data,'-k',socket,'-h',''],{stdio:'ignore'});
 for(let i=0;i<100;i++){const c=new Client({host:socket,user:'fixture',database:'postgres'});try{await c.connect();db=c;break;}catch{await c.end();await new Promise(r=>setTimeout(r,50));}}if(!db)throw Error('Local server unavailable');
 await q(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);INSERT INTO auth.users VALUES('${user}'),('${other}');CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;GRANT USAGE ON SCHEMA auth TO authenticated`);
 await q('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role');
 await db.query(await fs.readFile('supabase/migrations/20261030000100_account_billing.sql','utf8'));
 await test('one table, no functions/queues/jobs/events, initially empty',async()=>{assert.deepEqual((await q("SELECT relname FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r'")),[{relname:'account_billing'}]);assert.equal((await q('SELECT count(*)::int n FROM public.account_billing'))[0].n,0);});
 await test('RLS enabled and forced',async()=>assert.deepEqual((await q("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='public.account_billing'::regclass"))[0],{relrowsecurity:true,relforcerowsecurity:true}));
 await test('server can sync one Pro row',async()=>{await q(`SET ROLE service_role;INSERT INTO public.account_billing(account_id,stripe_customer_id,stripe_subscription_id,plan,status) VALUES('${user}','cus_fixture','sub_fixture','pro','active');RESET ROLE`);});
 await test('duplicate upsert keeps one canonical row',async()=>{await q(`SET ROLE service_role;INSERT INTO public.account_billing(account_id,stripe_customer_id,stripe_subscription_id,plan,status) VALUES('${user}','cus_fixture','sub_fixture','pro','past_due') ON CONFLICT(account_id) DO UPDATE SET status=excluded.status;RESET ROLE`);assert.equal((await q('SELECT count(*)::int n FROM public.account_billing'))[0].n,1);});
 await test('authenticated user sees own row only',async()=>{await q(`SET ROLE authenticated;SET request.jwt.claim.sub='${user}'`);assert.equal((await q('SELECT count(*)::int n FROM public.account_billing'))[0].n,1);await q(`SET request.jwt.claim.sub='${other}'`);assert.equal((await q('SELECT count(*)::int n FROM public.account_billing'))[0].n,0);await q('RESET ROLE');});
 for(const sql of [`INSERT INTO public.account_billing(account_id) VALUES('${other}')`,`UPDATE public.account_billing SET plan='enterprise'`,`DELETE FROM public.account_billing`])await test('browser mutation denied: '+sql.split(' ')[0],async()=>{await q('SET ROLE authenticated');await assert.rejects(db.query(sql),e=>e.code==='42501');await q('RESET ROLE');});
 await test('anonymous read denied',async()=>{await q('SET ROLE anon');await assert.rejects(db.query('SELECT * FROM public.account_billing'),e=>e.code==='42501');await q('RESET ROLE');});
 await test('service role has no unnecessary delete privilege',async()=>{await q('SET ROLE service_role');await assert.rejects(db.query('DELETE FROM public.account_billing'),e=>e.code==='42501');await q('RESET ROLE');});
 await test('paid plan requires a Stripe subscription and paid status',async()=>await assert.rejects(db.query(`INSERT INTO public.account_billing(account_id,plan,status) VALUES('${other}','pro','canceled')`),e=>e.code==='23514'));
 await test('customer/subscription cannot bind to a second account',async()=>await assert.rejects(db.query(`INSERT INTO public.account_billing(account_id,stripe_customer_id,stripe_subscription_id,plan,status) VALUES('${other}','cus_fixture','sub_fixture','pro','active')`),e=>e.code==='23505'));
 console.log(`Simple billing PostgreSQL ${n}/${n}`);
}finally{await db?.end();if(server)await run(path.join(bin,'pg_ctl'),['-D',data,'-m','immediate','-w','stop']).catch(()=>{});await fs.rm(temp,{recursive:true,force:true});}
