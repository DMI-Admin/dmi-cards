// Offline contract/API and PostgreSQL validation. Never connects to Supabase.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {pathToFileURL} from 'node:url';
import {loadStagingSchema} from './lib/admin-clients-staging-fixture.mjs';
const source=p=>fs.readFileSync(p,'utf8');
function load(file,deps={}){const exports={};vm.runInNewContext(ts.transpileModule(source(file),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:n=>{if(n in deps)return deps[n];throw Error(n)},URL,Buffer,Date,Number,Request,Response});return exports;}
const contract=load('src/lib/business-onboarding-contract.ts');
const base={company_name:'Prospective company',status:'draft'};
assert.equal(contract.validateOnboarding(base).requested_seats,null);
for(const patch of [{status:'active'},{status:'completed'},{requested_seats:0},{requested_seats:1.5},{company_name:' '},{company_name:'a'.repeat(2001)},{contact_email:'bad'},{website:'javascript:bad'},{website:'https://user:pass@example.com'},{contract_start:'2026-02-30'},{contract_start:'2026-09-02',contract_end:'2026-09-01'},{billing_frequency:'annual'},{created_by_clerk_user_id:'user_spoof'},{client_id:'fake'}])assert.throws(()=>contract.validateOnboarding({...base,...patch}));
for(const status of contract.onboardingStatuses)assert.equal(contract.validateOnboarding({...base,status}).status,status);
const options=contract.onboardingListOptions('https://fixture.test/?page=2&status=draft&access_type=trial&search=a%22%2Cb%25');
assert.equal(options.page,2);assert.equal(options.pageSize,25);assert.ok(options.operand.startsWith('"%'));assert.ok(options.operand.includes('\\"'));assert.ok(options.operand.includes('\\%'));
for(const q of ['page=0','page=1&page=2','limit=999','status=active','access_type=paid'])assert.throws(()=>contract.onboardingListOptions('https://fixture.test/?'+q));
let authorized=true, actor='user_admin', calls=[],rows=[],sequence=1;
function query(){let mode='read',values,filters=[],single=false,selection='',head=false,range=null,orders=[];const q={
 select(s,o={}){selection=s;head=o.head;return q},eq(k,v){filters.push(r=>r[k]===v);return q},in(k,v){filters.push(r=>v.includes(r[k]));return q},or(v){calls.push({or:v});return q},order(k,o){orders.push([k,o]);return q},range(a,b){range=[a,b];return q},insert(v){mode='insert';values=v;return q},update(v){mode='update';values=v;return q},single(){single=true;return q},maybeSingle(){single=true;return q},then(resolve,reject){return Promise.resolve().then(()=>{
 calls.push({mode,range,orders,values});let matches=rows.filter(r=>filters.every(f=>f(r)));
 if(mode==='insert'){if(rows.some(r=>r.create_request_id===values.create_request_id))return {error:{code:'23505'}};const row={...values,id:'00000000-0000-4000-8000-'+String(sequence++).padStart(12,'0')};rows.push(row);matches=[row];}
 if(mode==='update')matches.forEach(r=>Object.assign(r,values));
 const count=matches.length;if(range)matches=matches.slice(range[0],range[1]+1);
 const result=matches.map(r=>Object.fromEntries(selection.split(',').filter(k=>k in r).map(k=>[k,r[k]])));
 return {data:head?null:single?(result[0]||null):result,count,error:null};
 }).then(resolve,reject)}};return q;}
const server=load('src/lib/business-onboarding-server.ts',{'server-only':{},'@clerk/nextjs/server':{auth:async()=>({userId:actor})},'next/server':{NextResponse:Response},'@/lib/admin-auth':{requireAdminAccess:async()=>({authorized,userId:actor,error:'Admin access is required.'})},'@/lib/supabase-admin':{createSupabaseAdminClient:()=>({from:t=>{assert.equal(t,'business_onboardings','No operational table side effects');calls.push({table:t});return query()}})},'@/lib/business-onboarding-contract':contract});
const id='10000000-0000-4000-8000-000000000001';
async function request(op,body,path='',headers={}){const method=op==='create'?'POST':op==='update'?'PATCH':'GET';return server.businessOnboardingRequest(new Request('https://fixture.test/api/admin/business-onboardings'+path,{method,headers,...(body!==undefined?{body:typeof body==='string'?body:JSON.stringify(body)}:{})}),op,['read','update'].includes(op)?path.slice(1):undefined);}
authorized=false;for(const op of ['list','read','create','update','summary'])assert.equal((await request(op,undefined,'/'+id)).status,403);assert.equal(calls.length,0);authorized=true;
const payload={...base,create_request_id:id};const [a,b]=await Promise.all([request('create',payload),request('create',payload)]);assert.deepEqual([a.status,b.status].sort(),[200,201]);assert.equal(rows.length,1);assert.equal(rows[0].created_by_clerk_user_id,actor);assert.equal(a.headers.get('cache-control'),'private, no-store');
const saved=(await a.json()).record;assert.equal((await request('create',{...payload,company_name:'Different'})).status,409);
actor='user_other_admin';assert.equal((await request('create',payload)).status,409);actor='user_admin';
assert.equal((await request('update',{...base,revision:1,company_name:'Edited'},'/'+saved.id)).status,200);
assert.equal((await request('update',{...base,revision:1},'/'+saved.id)).status,409);assert.equal(rows[0].company_name,'Edited');assert.equal(rows[0].revision,2);
assert.equal((await request('create',payload,'',{origin:'https://foreign.test'})).status,403);
assert.equal((await request('create','x'.repeat(40001))).status,413);
assert.equal((await request('create',{...payload,status:'active'})).status,400);
assert.equal((await request('read',undefined,'/invalid')).status,400);
await request('list',undefined,'?page=2&status=draft&access_type=trial&search=hello');assert.ok(calls.some(c=>c.range?.[0]===25&&c.range[1]===49&&c.orders.length===2));assert.ok(calls.some(c=>c.or?.includes('company_name.ilike.')));
const summary=await (await request('summary')).json();assert.equal(summary.summary.inProgress,1);assert.equal(summary.summary.awaitingPayment,0);
const sql=source('supabase/migrations/20260925090000_create_business_onboardings.sql');
assert.ok(!/public\.(clients|client_users|cards|billing|subscriptions)\b/i.test(sql));
for(const file of ['src/components/admin/BusinessOnboardingPage.tsx','src/lib/business-onboarding-server.ts'])assert.ok(!/from\(["'](?:clients|client_users|cards|subscriptions)["']\)|auth\.admin|stripe\./.test(source(file)));
for(const route of ['route.ts','[onboardingId]/route.ts','summary/route.ts'])assert.match(source('src/app/api/admin/business-onboardings/'+route),/businessOnboardingRequest/);
assert.match(source('src/lib/admin-auth.ts'),/business-onboarding/);assert.match(source('src/lib/admin-appearance.ts'),/business-onboarding/);
console.log('PASS onboarding contract/API: auth, validation, idempotency, revision conflicts, bounded list and summaries, isolated writes');
const modulePath=process.argv.find(v=>v.startsWith('--postgres-module='))?.split('=').slice(1).join('=');
if(!modulePath)throw Error('Supply --postgres-module=/path/to/pglite/dist/index.js for mandatory offline PostgreSQL migration validation');
const {PGlite}=await import(pathToFileURL(modulePath));const pg=new PGlite();
try{
 await loadStagingSchema(pg);
 await pg.exec("insert into auth.users(id,email) values ('11111111-1111-4111-a111-111111111111','fixture@example.test');select set_config('test.user','11111111-1111-4111-a111-111111111111',false);select * from ensure_current_client_account();insert into cards(user_id,slug,profile_image_url) values ('11111111-1111-4111-a111-111111111111','onboarding-existing-card','https://example.test/profile.webp');");
 const fingerprint=async()=>JSON.stringify((await pg.query(`select c.relname,c.relacl::text,c.relrowsecurity,c.relforcerowsecurity, (select jsonb_agg(to_jsonb(p)) from pg_policy p where p.polrelid=c.oid) policies from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname <> 'business_onboardings' order by c.relname`)).rows);
 const existingTables=(await pg.query("select tablename from pg_tables where schemaname='public' order by tablename")).rows.map(r=>r.tablename);
 const contracts=async()=>JSON.stringify({catalog:(await pg.query(`select c.relname,a.attname,format_type(a.atttypid,a.atttypmod) type,a.attnotnull,pg_get_expr(d.adbin,d.adrelid) default_value from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum where n.nspname='public' and c.relkind='r' and c.relname <> 'business_onboardings' order by c.relname,a.attnum`)).rows,functions:(await pg.query(`select p.oid::regprocedure::text signature,pg_get_functiondef(p.oid) definition,p.proacl::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f' order by signature`)).rows,data:await Promise.all(existingTables.map(t=>pg.query('select to_jsonb(t) row from public."'+t+'" t order by to_jsonb(t)::text').then(r=>r.rows)))});
 const before=await fingerprint(), contractBefore=await contracts();await pg.exec(sql);assert.equal(await fingerprint(),before);assert.equal(await contracts(),contractBefore);
 const version=(await pg.query('show server_version')).rows[0].server_version;assert.ok(version.startsWith('17.'));
 for(const role of ['anon','authenticated'])for(const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'])assert.equal((await pg.query(`select has_table_privilege($1,'public.business_onboardings',$2) ok`,[role,privilege])).rows[0].ok,false);
 for(const privilege of ['SELECT','INSERT','UPDATE'])assert.equal((await pg.query(`select has_table_privilege('service_role','public.business_onboardings',$1) ok`,[privilege])).rows[0].ok,true);
 const insert=`insert into public.business_onboardings(company_name,created_by_clerk_user_id,updated_by_clerk_user_id,create_request_id) values ('Fixture','user_admin','user_admin',gen_random_uuid())`;
 await pg.exec('set role service_role');await pg.exec(insert);await pg.exec(`update public.business_onboardings set requested_seats=500 where company_name='Fixture'`);assert.equal((await pg.query('select count(*)::int n from public.business_onboardings')).rows[0].n,1);
 for(const update of ["status='active'","status='completed'","requested_seats=0","billing_frequency='annual'","company_name=repeat('a',2001)","onboarding_method='self_service'","contract_start='2026-02-02',contract_end='2026-02-01'"])await assert.rejects(pg.exec('update public.business_onboardings set '+update));
 await assert.rejects(pg.exec('delete from public.business_onboardings'));
 await pg.exec('reset role');for(const role of ['anon','authenticated']){await pg.exec('set role '+role);await assert.rejects(pg.exec('select * from public.business_onboardings'));await assert.rejects(pg.exec(insert));await pg.exec('reset role');}
 assert.equal(await fingerprint(),before);
 assert.equal(await contracts(),contractBefore);
 const rollback=source('docs/review/business-onboarding-rollback.sql');
 await assert.rejects(pg.exec(rollback),/onboarding rows require/);await pg.exec('rollback');
 await pg.exec('delete from public.business_onboardings');await pg.exec(rollback);
 assert.equal(await contracts(),contractBefore);
 // A grant through a reachable role must abort the complete migration.
 await pg.exec('create role dangerous;grant dangerous to authenticated;alter default privileges in schema public grant insert on tables to dangerous');
 await assert.rejects(pg.exec(sql),/Browser privilege path remains/);await pg.exec('rollback');assert.equal((await pg.query("select to_regclass('public.business_onboardings') t")).rows[0].t,null);
 console.log('PASS PostgreSQL '+version+': migration COMMIT, untouched existing ACL/RLS/policies, service writes, browser denial, constraints and inherited-default-grant rollback');
}finally{await pg.close();}
