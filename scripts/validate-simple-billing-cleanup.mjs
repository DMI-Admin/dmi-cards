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
 await q("CREATE TABLE public.profiles(id uuid PRIMARY KEY,full_name text,email text,plan text,subscription_plan text)");
 const inventory=JSON.parse(await fs.readFile('docs/simple-billing/INVENTORY.json','utf8'));
 for(const file of inventory.migrations_retained_unchanged)await db.query(await fs.readFile(file,'utf8'));
 await db.query(await fs.readFile('supabase/migrations/20261030000100_account_billing.sql','utf8'));
 const cleanup=await fs.readFile('supabase/cleanup/retire_legacy_billing.review.sql','utf8');
 await q('CREATE VIEW public.nonbilling_dependency AS SELECT * FROM public.billing_accounts');
 await test('cleanup rejects a non-billing dependent view without CASCADE',async()=>{await assert.rejects(db.query(cleanup),e=>e.code==='2BP01');await q('ROLLBACK');assert.equal((await q("SELECT count(*)::int n FROM pg_class WHERE oid=to_regclass('public.billing_accounts')"))[0].n,1);});
 await q('DROP VIEW public.nonbilling_dependency');
 await db.query(cleanup);
 await test('review cleanup leaves only the new billing table and protected profile data',async()=>{assert.deepEqual((await q("SELECT relname FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r' ORDER BY relname")),[{relname:'account_billing'},{relname:'profiles'}]);assert.equal((await q("SELECT to_regnamespace('billing_v2') IS NULL gone"))[0].gone,true);});
 console.log(`Simple billing PostgreSQL ${n}/${n}`);
}finally{await db?.end();if(server)await run(path.join(bin,'pg_ctl'),['-D',data,'-m','immediate','-w','stop']).catch(()=>{});await fs.rm(temp,{recursive:true,force:true});}
