// Disposable Unix-socket PostgreSQL only. No URL/env/hosted connection accepted.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {load} from '../local/load.mjs';
const [bin,driver]=process.argv.slice(2);if(!bin||!driver||!path.isAbsolute(bin)||!path.isAbsolute(driver))throw Error('Explicit local binary/driver paths required');
const {Client}=createRequire(import.meta.url)(driver);
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'dmi-v2-local-')),data=path.join(temp,'data'),socket=path.join(temp,'socket');await fs.mkdir(socket);
const run=(file,args)=>new Promise((resolve,reject)=>{const p=spawn(file,args,{stdio:['ignore','pipe','pipe']});let text='';p.stdout.on('data',b=>text+=b);p.stderr.on('data',b=>text+=b);p.on('error',reject);p.on('exit',n=>n?reject(Error(text)):resolve());});
let server,db;const connections=[];let passed=0;
const test=async(name,fn)=>{await fn();passed++;console.log('PASS '+name);};
const scope='acct_1OoTzlG71GpCYtA4:test',account=randomUUID(),principal='11111111-1111-4111-8111-111111111111';
const migrations=['20261027000100_billing_v2_shadow_schema.sql','20261027000200_billing_v2_task_transactions.sql','20261027000300_billing_v2_shadow_operations.sql','20261028000100_billing_v2_shadow_foundation.sql'];
const schema=JSON.parse(await fs.readFile('specs/billing-simplification/phase2/schema.json','utf8'));
const stamp='2026-10-27T00:00:00.000Z';
function row(name,values){const t=schema.tables.find(t=>t.name==='billing_v2.'+name);const r={};for(const [k,c]of Object.entries(t.columns)){r[k]=null;if(c.default_sql==='clock_timestamp()')r[k]=stamp;if(c.default_sql==='gen_random_uuid()')r[k]=randomUUID();if(c.default_sql==='0'||c.default_sql==='1')r[k]=c.default_sql;}return {...r,...values};}
const catalog=row('price_catalog',{stripe_scope:scope,stripe_price_id:'price_pro',stripe_product_id:'prod_pro',application_key:'dmi_cards',plan:'pro',billing_interval:'monthly',entitlement_enabled:true,checkout_enabled:true,ownership_state:'active',ownership_basis:'price_owner',revision:'1',verified_at:stamp,application_active:true});
const owned=row('accounts',{stripe_scope:scope,id:account,principal_kind:'individual',principal_id:principal,stripe_customer_id:'cus_owned',binding_state:'verified',binding_revision:'1',verified_at:stamp});
const q=async(sql,values=[],connection=db)=>(await connection.query(sql,values)).rows;
const call=async(name,args=[],connection=db)=>(await q('SELECT billing_v2.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') AS r',args.map(v=>Array.isArray(v)?JSON.stringify(v):v),connection))[0].r;
try{
 await run(path.join(bin,'initdb'),['-D',data,'--no-locale','-E','UTF8','-U','fixture','--auth=trust']);server=spawn(path.join(bin,'postgres'),['-D',data,'-k',socket,'-h','','-p','5432'],{stdio:['ignore','pipe','pipe']});let logs='';server.stderr.on('data',b=>logs+=b);server.stdout.resume();
 const connect=async()=>{const c=new Client({host:socket,port:5432,user:'fixture',database:'postgres'});await c.connect();connections.push(c);return c;};
 for(let n=0;n<100;n++){try{db=await connect();break;}catch{await new Promise(r=>setTimeout(r,50));}}if(!db)throw Error(logs);
 await q('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE TABLE public.v2_legacy_sentinel(id integer PRIMARY KEY,value text);INSERT INTO public.v2_legacy_sentinel VALUES(1,\'unchanged\');REVOKE ALL ON public.v2_legacy_sentinel FROM PUBLIC;CREATE FUNCTION public.v2_legacy_sentinel_writer() RETURNS void LANGUAGE sql AS $$UPDATE public.v2_legacy_sentinel SET value=\'changed\'$$;REVOKE EXECUTE ON FUNCTION public.v2_legacy_sentinel_writer() FROM PUBLIC');
 const before=(await q("SELECT oid,pg_get_functiondef(oid) def FROM pg_proc WHERE oid='public.v2_legacy_sentinel_writer()'::regprocedure"))[0];
 for(const migration of migrations)await db.query(await fs.readFile('supabase/migrations/'+migration,'utf8'));

 const tooling=load('src/lib/billing-v2/tooling/staging-seed.ts');
 const target={environment:'staging',project:'prj_FPTsXDokhm5uSDMaxieuo5Cmp0Rn',scope,databaseProject:'uohdkewufeivdpaljnng',capability:'seed_only'};
 const subscription=row('subscriptions',{stripe_scope:scope,stripe_subscription_id:'sub_seed',billing_account_id:account,stripe_customer_id:'cus_owned',stripe_price_id:'price_pro',status:'active',plan:'pro',cancel_at_period_end:false,terminal:false,revision:'7',verified_at:stamp,snapshot_digest:'d'.repeat(64)});
 const policy=load('src/lib/billing-v2/domain/subscription-policy.ts');subscription.snapshot_digest=policy.canonicalDigest(subscription);
 const snapshot={scope,checkpoint:stamp,complete:true,rows:{accounts:[owned],price_catalog:[catalog],subscriptions:[subscription]},digests:{}};
 function plan(changes){const s=structuredClone(snapshot);if(changes)changes(s);s.digests=Object.fromEntries(Object.entries(s.rows).map(([k,v])=>[k,policy.digest(v)]));return tooling.prepareAccessSeed(target,s);}
 const prepared=plan();
 // Force one-row pages for interruption and publication checks without changing the 100-row cap.
 function paginate(p){const all=p.pages.flatMap(p=>p.rows);p.pages=all.map((r,index)=>({index,rows:[r]}));p.manifest.pages=p.pages.map(p=>({index:p.index,first:p.rows[0].key,last:p.rows[0].key,count:1,digest:tooling.seedDigest(p.rows)}));p.manifest.digest=tooling.seedDigest(Object.fromEntries(Object.entries(p.manifest).filter(([k])=>k!=='digest')));return p;}
 const p=paginate(prepared);
 const seed=async(name,args=[])=>call(name,args);
 const begin=p=>seed('seed_begin',[p.manifest]);
 const page=(p,i)=>seed('seed_page',[p.manifest.generation,i,p.manifest.checkpoint,p.pages[i].rows]);
 const finalize=p=>seed('seed_finalize',[p.manifest.generation]);
 const reject=async(fn,pattern)=>{await q('SAVEPOINT denied');try{await assert.rejects(fn(),pattern);}finally{await q('ROLLBACK TO SAVEPOINT denied');await q('RELEASE SAVEPOINT denied');}};
 const scenario=async fn=>{await q('BEGIN');try{await q('SET LOCAL ROLE billing_v2_seed');await fn();}finally{await q('ROLLBACK');}};
 await test('clean install has 15 private tables and seed-only role with five callable functions',async()=>{assert.equal((await q("SELECT count(*)::int n FROM pg_tables WHERE schemaname='billing_v2'"))[0].n,15);assert.equal((await q("SELECT count(*)::int n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='billing_v2'"))[0].n,41);await scenario(async()=>assert.equal((await seed('seed_privileges')).safe,true));});
 await test('migration replay fails closed and transaction rollback preserves installed definitions',async()=>{const before=(await q("SELECT pg_get_functiondef('billing_v2.seed_begin(jsonb)'::regprocedure) def"))[0].def;for(const migration of migrations){await assert.rejects(db.query(await fs.readFile('supabase/migrations/'+migration,'utf8')),/already exists/);await q('ROLLBACK');}assert.equal((await q("SELECT pg_get_functiondef('billing_v2.seed_begin(jsonb)'::regprocedure) def"))[0].def,before);});
 await test('seed role cannot mutate V1, its writers, sequences or V2 directly',async()=>scenario(async()=>{for(const sql of ["INSERT INTO public.v2_legacy_sentinel VALUES(2,'bad')","UPDATE public.v2_legacy_sentinel SET value='bad'","DELETE FROM public.v2_legacy_sentinel","SELECT public.v2_legacy_sentinel_writer()","INSERT INTO billing_v2.accounts(stripe_scope) VALUES('bad')","SELECT billing_v2.claim('"+scope+"','access')","SELECT billing_v2.backfill_page('"+scope+"',gen_random_uuid(),'{}','[]',NULL)"])await reject(()=>q(sql),/permission denied/);}));
 await test('anon authenticated and service cannot import or execute shadow tasks',async()=>{for(const role of ['anon','authenticated','service_role']){await q('BEGIN');try{await q('SET LOCAL ROLE '+role);await reject(()=>begin(p),/permission denied/);await reject(()=>seed('claim',[scope,'access']),/permission denied/);}finally{await q('ROLLBACK');}}});
 await test('effective PUBLIC writer grants fail audit without changing V1 grants',async()=>{await q('BEGIN');try{await q('GRANT EXECUTE ON FUNCTION public.v2_legacy_sentinel_writer() TO PUBLIC');await q('SET LOCAL ROLE billing_v2_seed');await reject(()=>seed('seed_privileges'),/V2_SEED_FUNCTION_PRIVILEGE/);}finally{await q('ROLLBACK');}});
 await test('inherited membership, PUBLIC table/sequence/schema privileges are detected',async()=>{
  for(const setup of ["GRANT billing_v2_executor TO billing_v2_seed","GRANT UPDATE ON public.v2_legacy_sentinel TO PUBLIC","CREATE SEQUENCE public.seed_sequence;GRANT USAGE ON SEQUENCE public.seed_sequence TO PUBLIC","GRANT CREATE ON SCHEMA public TO PUBLIC"]){await q('BEGIN');try{await q(setup);await q('SET LOCAL ROLE billing_v2_seed');await reject(()=>seed('seed_privileges'),/V2_SEED_(ROLE|TABLE|SEQUENCE|SCHEMA)_/);}finally{await q('ROLLBACK');}}
 });

 await test('PUBLIC extension functions and pg-prefixed application schemas are not exempt',async()=>{
  await q('BEGIN');try{await q("CREATE SCHEMA pgsodium;CREATE FUNCTION pgsodium.seed_external() RETURNS void LANGUAGE sql SECURITY DEFINER AS $$UPDATE public.v2_legacy_sentinel SET value='bad'$$;ALTER EXTENSION plpgsql ADD FUNCTION pgsodium.seed_external()");await q('SET LOCAL ROLE billing_v2_seed');await reject(()=>seed('seed_privileges'),/V2_SEED_FUNCTION_PRIVILEGE/);}finally{await q('ROLLBACK');}
 });
 await test('wrong project/environment/scope rejected locally before database calls',async()=>{for(const patch of [{environment:'production'},{databaseProject:'other'},{scope:'acct_other:test'},{project:'other'}])assert.throws(()=>tooling.prepareAccessSeed({...target,...patch},snapshot),/V2_SEED_TARGET/);});
 await test('dry-run preview performs zero database calls',async()=>{const r=await tooling.importAccessSeed(target,{project:target.databaseProject,capability:'seed_only',query:()=>{throw Error('DB_CALLED');}},p);assert.equal(r.dryRun,true);assert.equal(r.executionEnabled,false);});
 await test('source capture transaction is read-only and errors cannot fall back to a writer',async()=>{const seen=[];const source={project:target.databaseProject,query:async sql=>{seen.push(sql);if(sql.includes('current_setting'))return {rows:[{read_only:'off'}]};return {rows:[]};}};await assert.rejects(tooling.captureAccessSnapshot(target,source),/SOURCE_REJECTED/);assert.equal(seen[0],'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');assert.equal(seen.at(-1),'ROLLBACK');});
 await test('wrong manifest digest rejected before import',async()=>scenario(async()=>{await reject(()=>seed('seed_begin',[{...p.manifest,digest:'0'.repeat(64)}]),/V2_SEED_MANIFEST/);}));
 await test('premature finalize and interrupted import remain non-published',async()=>scenario(async()=>{await begin(p);await page(p,0);await reject(()=>finalize(p),/V2_SEED_INCOMPLETE/);assert.equal((await begin(p)).kind,'resume');await page(p,1);await page(p,2);assert.equal((await finalize(p)).complete,true);}));
 await test('duplicate pages and lost acknowledgement replay do not duplicate rows',async()=>scenario(async()=>{await begin(p);await page(p,0);assert.equal((await page(p,0)).kind,'duplicate');for(let i=1;i<p.pages.length;i++)await page(p,i);assert.equal((await finalize(p)).complete,true);assert.equal((await finalize(p)).complete,true);assert.equal((await begin(p)).complete,true);}));
 await test('same page identity with changed payload is rejected atomically',async()=>scenario(async()=>{await begin(p);await page(p,0);const bad=structuredClone(p.pages[0].rows);bad[0].row.binding_revision='9';await reject(()=>seed('seed_page',[p.manifest.generation,0,p.manifest.checkpoint,bad]),/V2_SEED_PAGE_DIGEST/);}));
 await test('wrong checkpoint cursor order and excessive page size rejected',async()=>scenario(async()=>{await begin(p);await reject(()=>seed('seed_page',[p.manifest.generation,0,{snapshot:'wrong'},p.pages[0].rows]),/V2_SEED_PAGE/);await reject(()=>page(p,1),/V2_SEED_PAGE_ORDER/);await reject(()=>seed('seed_page',[p.manifest.generation,0,p.manifest.checkpoint,Array(101).fill(p.pages[0].rows[0])]),/V2_SEED_PAGE/);}));
 await test('missing catalog/binding and ambiguous ownership fail normalization',async()=>{for(const mutate of [s=>{s.rows.price_catalog=[];},s=>{s.rows.accounts=[];},s=>{s.rows.accounts.push({...owned,id:randomUUID(),principal_id:randomUUID()});}])assert.throws(()=>plan(mutate));});
 await test('subscription customer relationship mismatch cannot publish',async()=>scenario(async()=>{const bad=structuredClone(p);bad.pages[2].rows[0].row.stripe_customer_id='cus_foreign';bad.manifest.pages[2].digest=tooling.seedDigest(bad.pages[2].rows);bad.manifest.digest=tooling.seedDigest(Object.fromEntries(Object.entries(bad.manifest).filter(([k])=>k!=='digest')));await begin(bad);for(let i=0;i<3;i++)await page(bad,i);await reject(()=>finalize(bad),/V2_SEED_RELATIONSHIP/);}));
 await test('row count disagreement and changed checkpoint generation cannot resume',async()=>scenario(async()=>{const bad=structuredClone(p);bad.manifest.counts.accounts=2;bad.manifest.digest=tooling.seedDigest(Object.fromEntries(Object.entries(bad.manifest).filter(([k])=>k!=='digest')));await reject(()=>begin(bad),/V2_SEED_COUNTS/);await begin(p);bad.manifest.counts.accounts=1;bad.manifest.checkpoint.snapshot='changed';bad.manifest.digest=tooling.seedDigest(Object.fromEntries(Object.entries(bad.manifest).filter(([k])=>k!=='digest')));await reject(()=>begin(bad),/V2_SEED_CONFLICT/);}));
 await test('mixed-case identities use stable page ordering and complete every row',async()=>scenario(async()=>{const mixed=paginate(plan(s=>{s.rows.price_catalog.push(...['price_A','price_a','price_Z','price_z'].map(id=>({...catalog,stripe_price_id:id})));}));await begin(mixed);for(let i=0;i<mixed.pages.length;i++)await page(mixed,i);assert.equal((await finalize(mixed)).counts.price_catalog,5);}));
 await test('actual typed-row tampering is detected during verification',async()=>{await q('BEGIN');try{await begin(p);for(let i=0;i<3;i++)await page(p,i);await q("UPDATE billing_v2.accounts SET binding_revision=2");await reject(()=>finalize(p),/V2_SEED_CONTENT/);}finally{await q('ROLLBACK');}});
 await test('completed manifest is immutable and seed leaves no task or authority',async()=>{await q('BEGIN');try{await begin(p);for(let i=0;i<3;i++)await page(p,i);const result=await finalize(p);assert.equal(result.execution_enabled,false);assert.ok(result.completed_at);await reject(()=>q("UPDATE billing_v2.operations SET status='running' WHERE id=$1",[p.manifest.generation]),/V2_SEED_IMMUTABLE/);for(const table of ['event_inbox','authority','checkout_attempts','finance_subscriptions','invoices','payments'])assert.equal((await q('SELECT count(*)::int n FROM billing_v2.'+table))[0].n,0);assert.equal((await seed('claim',[scope,'access'])).kind,'blocked_seed');}finally{await q('ROLLBACK');}});
 await test('whole operator import uses seed-only RPCs and can resume frozen manifest',async()=>scenario(async()=>{const calls=[];const c={project:target.databaseProject,capability:'seed_only',query:async(sql,args)=>{calls.push(sql);return db.query(sql,args);}};const result=await tooling.importAccessSeed(target,c,p,false);assert.equal(result.complete,true);assert.equal((await tooling.importAccessSeed(target,c,p,false)).complete,true);assert.ok(calls.every(sql=>sql==='SELECT current_user AS actor'||/^SELECT billing_v2.seed_(privileges|begin|page|finalize)\(/.test(sql)));}));

 await test('real SELECT-only source capture produces a complete importable access snapshot',async()=>{
  await q(`CREATE ROLE v2_source_reader NOLOGIN;
   CREATE TABLE public.billing_accounts(stripe_scope text,user_id uuid,stripe_customer_id text,verified_at timestamptz,generation bigint,updated_at timestamptz);
   CREATE TABLE public.billing_approved_prices(stripe_scope text,stripe_price_id text,entitlement_enabled boolean,checkout_enabled boolean,approved_at timestamptz);
   CREATE TABLE public.billing_subscriptions(stripe_scope text,user_id uuid,stripe_customer_id text,stripe_subscription_id text,verified boolean,terminal boolean,revision bigint,last_event_created bigint,last_event_id text,verified_at timestamptz,created_at timestamptz,updated_at timestamptz,sync_snapshot jsonb);
   CREATE TABLE public.billing_stripe_resource_ownership(stripe_scope text,resource_type text,stripe_resource_id text,application_key text,ownership_basis text,revision bigint,state text,updated_at timestamptz);
   CREATE TABLE public.billing_stripe_applications(application_key text,state text);
   CREATE TABLE public.billing_finance_subscription_items(stripe_scope text,stripe_price_id text,stripe_product_id text,recurring_interval text,interval_count integer,verified_at timestamptz,removed_at timestamptz);
   REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
   GRANT USAGE ON SCHEMA public TO v2_source_reader;
   GRANT SELECT ON public.billing_accounts,public.billing_approved_prices,public.billing_subscriptions,public.billing_stripe_resource_ownership,public.billing_stripe_applications,public.billing_finance_subscription_items TO v2_source_reader`);
  await q('INSERT INTO public.billing_accounts VALUES($1,$2,$3,$4,9,$4)',[scope,principal,'cus_owned',stamp]);
  await q('INSERT INTO public.billing_approved_prices VALUES($1,$2,true,true,$3)',[scope,'price_pro',stamp]);
  const syncSnapshot={subscription_id:'sub_seed',customer_id:'cus_owned',status:'active',price_id:'price_pro',plan:'pro',period_start:null,period_end:null,trial_end:null,ended_at:null,cancel_at_period_end:false,invoice_id:null,terminal:false};
  await q('INSERT INTO public.billing_subscriptions VALUES($1,$2,$3,$4,true,false,7,100,$5,$6,$6,$6,$7)',[scope,principal,'cus_owned','sub_seed','evt_seed',stamp,syncSnapshot]);
  await q("INSERT INTO public.billing_stripe_resource_ownership VALUES($1,'price','price_pro','dmi_cards','price_owner',3,'active',$2)",[scope,stamp]);
  await q("INSERT INTO public.billing_stripe_applications VALUES('dmi_cards','active')");
  await q("INSERT INTO public.billing_finance_subscription_items VALUES($1,'price_pro','prod_pro','month',1,$2,NULL)",[scope,stamp]);
  const source=new Client({host:socket,port:5432,user:'fixture',database:'postgres'});await source.connect();connections.push(source);await source.query('SET ROLE v2_source_reader');
  await assert.rejects(source.query("UPDATE public.billing_accounts SET generation=0"),/permission denied/);
  const captured=await tooling.captureAccessSnapshot(target,{project:target.databaseProject,query:(sql,args)=>source.query(sql,args)});
  const planned=tooling.prepareAccessSeed(target,captured);assert.equal(planned.manifest.counts.subscriptions,1);assert.equal(planned.pages.flatMap(p=>p.rows).find(r=>r.table==='subscriptions').row.revision,'7');assert.equal(planned.pages.flatMap(p=>p.rows).find(r=>r.table==='subscriptions').row.last_event_id,'evt_seed');
  await scenario(async()=>{const result=await tooling.importAccessSeed(target,{project:target.databaseProject,capability:'seed_only',query:(sql,args)=>db.query(sql,args)},planned,false);assert.equal(result.complete,true);});
  // Simulate a missing persisted price fact; capture must fail without any provider fallback.
  await assert.rejects(tooling.captureAccessSnapshot(target,{project:target.databaseProject,query:(sql,args)=>sql.includes('FROM public.billing_finance_subscription_items')?Promise.resolve({rows:[]}):source.query(sql,args)}),/SOURCE_REJECTED/);assert.equal((await q('SELECT count(*)::int n FROM public.billing_finance_subscription_items'))[0].n,1);
 });
 await test('actual V1 billing and Finance tables and writer RPCs reject seed mutation',async()=>{
  await q("CREATE FUNCTION public.billing_foundation_command(text) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$UPDATE public.billing_subscriptions SET revision=0$$;REVOKE ALL ON FUNCTION public.billing_foundation_command(text) FROM PUBLIC");
  await q("CREATE FUNCTION public.billing_finance_command(text) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$DELETE FROM public.billing_finance_subscription_items$$;REVOKE ALL ON FUNCTION public.billing_finance_command(text) FROM PUBLIC");
  await q("CREATE FUNCTION public.billing_reconciliation_writer() RETURNS void LANGUAGE sql SECURITY DEFINER AS $$UPDATE public.billing_accounts SET generation=0$$;REVOKE ALL ON FUNCTION public.billing_reconciliation_writer() FROM PUBLIC");
  await scenario(async()=>{for(const table of ['billing_accounts','billing_subscriptions','billing_finance_subscription_items'])for(const verb of ['INSERT INTO '+table+' DEFAULT VALUES','UPDATE '+table+' SET stripe_scope=\'bad\'','DELETE FROM '+table])await reject(()=>q(verb),/permission denied/);for(const sql of ["SELECT public.billing_foundation_command('commit')","SELECT public.billing_finance_command('commit')","SELECT public.billing_reconciliation_writer()"] )await reject(()=>q(sql),/permission denied/);});
 });

 await test('a falsely labelled operator connection is rejected before seed mutation',async()=>{await assert.rejects(tooling.importAccessSeed(target,{project:target.databaseProject,capability:'seed_only',query:(sql,args)=>db.query(sql,args)},p,false),/V2_SEED_CONNECTION_ROLE/);});
 await test('duplicate logical identities and historical lease fields fail closed',async()=>{assert.throws(()=>plan(s=>s.rows.accounts.push({...owned})),/DUPLICATE/);assert.throws(()=>plan(s=>s.rows.accounts[0].lease_until=stamp),/FIELDS/);});

 await test('mid-page uniqueness failure rolls back every row and page receipt',async()=>scenario(async()=>{
  const bad=structuredClone(p);const extra=structuredClone(bad.pages[0].rows[0]);extra.row.id='ffffffff-ffff-4fff-afff-ffffffffffff';extra.row.principal_id=randomUUID();extra.key='accounts:'+extra.row.id;bad.pages[0].rows.push(extra);bad.manifest.counts.accounts=2;bad.manifest.pages[0]={index:0,first:bad.pages[0].rows[0].key,last:extra.key,count:2,digest:tooling.seedDigest(bad.pages[0].rows)};bad.manifest.digest=tooling.seedDigest(Object.fromEntries(Object.entries(bad.manifest).filter(([k])=>k!=='digest')));
  await begin(bad);await reject(()=>page(bad,0),/duplicate key/);await q('SET LOCAL ROLE fixture');assert.equal((await q('SELECT count(*)::int n FROM billing_v2.accounts'))[0].n,0);assert.equal((await q("SELECT count(*)::int n FROM billing_v2.operations WHERE outcome='seed_page'"))[0].n,0);await q('SET LOCAL ROLE billing_v2_seed');
 }));
 await test('lost page acknowledgement stops import; explicit same-manifest resume is safe',async()=>scenario(async()=>{
  let lost=false;const c={project:target.databaseProject,capability:'seed_only',query:async(sql,args)=>{const r=await db.query(sql,args);if(!lost&&sql.includes('billing_v2.seed_page(')){lost=true;throw Error('PRIVATE_TRANSPORT_DETAILS');}return r;}};
  await assert.rejects(tooling.importAccessSeed(target,c,p,false),e=>e.message==='V2_SEED_STORE_UNCONFIRMED');assert.equal((await tooling.importAccessSeed(target,c,p,false)).complete,true);
 }));
 await test('V1 data and writer definition remain unchanged',async()=>{assert.equal((await q('SELECT value FROM public.v2_legacy_sentinel'))[0].value,'unchanged');assert.deepEqual((await q("SELECT oid,pg_get_functiondef(oid) def FROM pg_proc WHERE oid='public.v2_legacy_sentinel_writer()'::regprocedure"))[0],before);});
 console.log('Shadow foundation PostgreSQL '+passed+'/'+passed);
}finally{for(const c of connections)await c.end().catch(()=>{});if(server&&server.exitCode===null)await new Promise(resolve=>{server.once('exit',resolve);server.kill('SIGTERM');});await fs.rm(temp,{recursive:true,force:true});}
