// Offline only: PGlite or a dedicated local PostgreSQL cluster. Never Supabase.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import ts from 'typescript';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {loadStagingSchema} from './lib/admin-clients-staging-fixture.mjs';
const read=p=>fs.readFileSync(p,'utf8');
function load(p,deps={}){const exports={};vm.runInNewContext(ts.transpileModule(read(p),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,URL,Date,Number,Buffer,Request,Response,require:n=>{assert.ok(n in deps,n);return deps[n]}});return exports;}
const onboarding=load('src/lib/business-onboarding-contract.ts');
const contract=load('src/lib/business-entitlement-contract.ts',{'@/lib/business-onboarding-contract':onboarding});
const valid={operation_id:randomUUID(),action:'activate_trial',expected_onboarding_revision:1,expected_entitlement_revision:0,reason:'Approved local fixture',confirmed:true};
assert.equal(contract.validateCommercialCommand(valid,true).action,'activate_trial');
for(const patch of [{confirmed:false},{reason:''},{actor:'user_spoof'},{source:'invoice'},{expected_onboarding_revision:0},{expected_entitlement_revision:1},{operation_id:'bad'},{payment_received_date:'2026-09-01'},{seat_limit:100}])assert.throws(()=>contract.validateCommercialCommand({...valid,...patch},true));
assert.throws(()=>contract.validateCommercialCommand({...valid,action:'activate_invoice'},true));
for(const access_type of ['invoice','trial','complimentary']){
 const record={access_type,requested_seats:25,contract_start:'2026-09-25',contract_end:'2027-09-25',billing_frequency:access_type==='invoice'?'quarterly':null,invoice_reference:access_type==='invoice'?'INV-TEST':null,status:'draft'};
 const action='activate_'+access_type;
 assert.equal(contract.businessActivationReadiness(record,action),null);
 for(const [key,label] of [['requested_seats','Requested Seats'],['contract_start','Contract Start'],['contract_end','Contract End'],['access_type','Access Type']])assert.ok(contract.businessActivationReadiness({...record,[key]:null},action).includes(label));
 assert.match(contract.businessActivationReadiness({...record,contract_start:'2026-02-30'},action),/Contract Start/);
 assert.match(contract.businessActivationReadiness({...record,contract_end:record.contract_start},action),/after Contract Start/);
 assert.match(contract.businessActivationReadiness({...record,status:'awaiting_information'},action),/Awaiting Customer Information/);
 if(access_type==='invoice')for(const key of ['billing_frequency','invoice_reference'])assert.ok(contract.businessActivationReadiness({...record,[key]:null},action));
}
let authorized=false,calls=[];
const server=load('src/lib/business-entitlement-server.ts',{'server-only':{},'@clerk/nextjs/server':{auth:async()=>({userId:'user_verified'})},'@/lib/admin-auth':{requireAdminAccess:async()=>({authorized,userId:'user_verified',error:'Admin access is required.'})},'next/server':{NextResponse:Response},'@/lib/supabase-admin':{createSupabaseAdminClient:()=>({rpc:async(name,args)=>{calls.push({name,args});return {data:{fixture:true},error:null}}})},'@/lib/business-onboarding-contract':onboarding,'@/lib/business-entitlement-contract':contract});
const recordId=randomUUID();
async function http(operation,body=valid,headers={}){return server.businessEntitlementRequest(new Request('https://fixture.test/api/admin/test',{method:operation==='read'?'GET':'POST',headers,...(operation==='read'?{}:{body:typeof body==='string'?body:JSON.stringify(body)})}),operation,recordId)}
for(const op of ['read','activate','action'])assert.equal((await http(op)).status,403);assert.equal(calls.length,0);authorized=true;
assert.equal((await http('activate')).status,200);assert.equal(calls[0].args.p_actor,'user_verified');assert.equal(calls[0].args.p_onboarding_id,recordId);
assert.equal((await http('activate',valid,{origin:'https://foreign.test'})).status,403);
assert.equal((await http('activate','a'.repeat(16001))).status,413);
assert.equal((await http('activate',{...valid,actor:'user_attacker'})).status,400);
assert.equal((await http('read')).headers.get('cache-control'),'private, no-store');
console.log('PASS protected API auth/actor/origin/body bounds/contract checks');
const option=n=>process.argv.find(v=>v.startsWith(n+'='))?.slice(n.length+1);
let pg,client,Driver;
const port=option('--local-postgres-port');
if(port){
 assert.match(port,/^[0-9]{4,5}$/);const modulePath=option('--pg-module');assert.ok(modulePath);
 Driver=(await import(pathToFileURL(modulePath))).default.Client;
 client=new Driver({host:'127.0.0.1',port:Number(port),database:'postgres',user:'postgres'});await client.connect();
 pg={exec:sql=>client.query(sql),query:(sql,args)=>client.query(sql,args),close:()=>client.end()};
}else{const modulePath=option('--postgres-module');assert.ok(modulePath,'Provide offline PostgreSQL module or isolated localhost port');const {PGlite}=await import(pathToFileURL(modulePath));pg=new PGlite();}
const migration=read('supabase/migrations/20260925120000_business_entitlement_foundation.sql');
const commandSql='select public.admin_command_business_entitlement($1,$2,$3,$4::jsonb) result';
const isoDays=d=>new Date(Date.now()+d*86400000).toISOString().slice(0,10);
async function fixture(source='trial',status='draft'){
 const id=randomUUID();await pg.query(`insert into public.business_onboardings(id,company_name,access_type,requested_seats,contract_start,contract_end,billing_frequency,invoice_reference,status,created_by_clerk_user_id,updated_by_clerk_user_id,create_request_id) values($1,'Local commercial fixture',$2,25,$3,$4,$5,$6,$7,'user_fixture','user_fixture',$8)`,[id,source,isoDays(-1),isoDays(365),source==='invoice'?'quarterly':null,source==='invoice'?'INV-LOCAL':null,status,randomUUID()]);return id;
}
const cmd=(action,ov=1,ev=0,extra={})=>({...valid,operation_id:randomUUID(),action,expected_onboarding_revision:ov,expected_entitlement_revision:ev,...extra});
async function run(id,c,ent=null){await pg.exec('set role service_role');try{return (await pg.query(commandSql,[id,ent,'user_fixture',JSON.stringify(c)])).rows[0].result;}finally{await pg.exec('reset role');}}
async function view(id){return (await pg.query('select public.get_business_entitlement($1) result',[id])).rows[0].result;}
async function counts(){return (await pg.query(`select (select count(*) from clients) clients,(select count(*) from client_users) staff,(select count(*) from cards) cards,(select count(*) from auth.users) users,(select count(*) from billing_subscriptions) billing`)).rows;}
try{
 await loadStagingSchema(pg);
 await pg.exec(read('supabase/migrations/20260924090000_add_admin_clients_prerequisites.sql'));
 await pg.exec(read('supabase/migrations/20260924100000_admin_clients_foundation.sql'));
 await pg.exec(read('supabase/migrations/20260925090000_create_business_onboardings.sql'));
 const original=await counts();
 const catalogSql=`select jsonb_build_object('functions',(select jsonb_agg(jsonb_build_object('name',p.oid::regprocedure::text,'def',pg_get_functiondef(p.oid),'acl',p.proacl::text) order by p.oid::regprocedure::text) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname not in ('protect_business_entitlement_event','protect_activated_business_proposal','get_business_entitlement','admin_command_business_entitlement')),'tables',(select jsonb_agg(jsonb_build_object('name',c.relname,'acl',c.relacl::text,'rls',c.relrowsecurity) order by c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname not in ('business_workspaces','business_entitlements','business_entitlement_events'))) value`;
 const before=(await pg.query(catalogSql)).rows;
 await pg.exec('alter default privileges in schema public grant all on tables to anon,authenticated,service_role;');
 await pg.exec(migration);assert.deepEqual((await pg.query(catalogSql)).rows,before);
 await pg.exec(read('docs/review/business-entitlement-verification.sql'));
 await pg.exec(read('docs/review/business-entitlement-rollback.sql'));
 assert.equal((await pg.query("select to_regclass('public.business_workspaces') value")).rows[0].value,null);
 assert.deepEqual((await pg.query(catalogSql)).rows,before);
 await pg.exec(migration);
 for(const table of ['business_workspaces','business_entitlements','business_entitlement_events']){
  for(const role of ['anon','authenticated','service_role'])for(const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'])assert.equal((await pg.query('select has_table_privilege($1,$2,$3) ok',[role,'public.'+table,privilege])).rows[0].ok,role==='service_role'&&privilege==='SELECT');
 }
 for(const role of ['anon','authenticated']){await pg.exec('set role '+role);await assert.rejects(pg.query('select public.get_business_entitlement($1)',[randomUUID()]));await assert.rejects(pg.exec('select * from business_entitlements'));await pg.exec('reset role');}
 for(const source of ['invoice','trial','complimentary']){
  const id=await fixture(source),c=cmd('activate_'+source,1,0,source==='invoice'?{payment_received_date:isoDays(0)}:{});
  const saved=await run(id,c);assert.deepEqual(await run(id,c),saved);
  await assert.rejects(run(id,{...c,reason:'Changed'}),/BUSINESS_OPERATION_CONFLICT/);
  const v=await view(id);assert.equal(v.entitlement.source,source);assert.equal(v.effective_status,'active');assert.equal(v.effective_seat_allowance,25);assert.equal(v.workspace.client_id,null);assert.equal(v.history.length,1);
  assert.equal(new Date(v.entitlement.ends_at).toISOString(),isoDays(365)+'T00:00:00.000Z');
  await assert.rejects(run(id,cmd('activate_'+source,2,1)),/BUSINESS_ALREADY_ACTIVATED/);
  await assert.rejects(run(null,cmd('suspend',1,1),saved.entitlement_id),/BUSINESS_STALE_ONBOARDING/);
  await assert.rejects(run(null,cmd('suspend',2,99),saved.entitlement_id),/BUSINESS_STALE_ENTITLEMENT/);
  await run(null,cmd('amend',2,1,{seat_limit:10,ends_at:isoDays(400)+'T00:00:00Z',contract_reference:'CONTRACT-LOCAL'}),saved.entitlement_id);
  assert.equal((await view(id)).entitlement.seat_limit,10);
  await run(null,cmd('suspend',3,2),saved.entitlement_id);assert.equal((await view(id)).effective_status,'suspended');assert.equal((await view(id)).effective_seat_allowance,0);
  await run(null,cmd('reactivate',4,3),saved.entitlement_id);assert.equal((await view(id)).effective_status,'active');
  await run(null,cmd('revoke',5,4),saved.entitlement_id);assert.equal((await view(id)).effective_status,'revoked');assert.equal((await view(id)).effective_seat_allowance,0);
  await assert.rejects(run(null,cmd('reactivate',6,5),saved.entitlement_id),/BUSINESS_REVOKED_TERMINAL/);
  await assert.rejects(pg.query('update business_onboardings set requested_seats=999 where id=$1',[id]),/BUSINESS_TERMS_LOCKED/);
  await assert.rejects(pg.query('update business_entitlement_events set reason=$1 where onboarding_id=$2',['edited',id]),/BUSINESS_AUDIT_IMMUTABLE/);
  await pg.exec('set role service_role');await assert.rejects(pg.exec('insert into business_entitlements(workspace_id) values (gen_random_uuid())'));await assert.rejects(pg.exec('delete from business_entitlement_events'));await pg.exec('reset role');
  assert.equal((await view(id)).history.length,5);
 }
 const absent=await fixture('trial','ready_to_activate');assert.equal((await view(absent)).effective_status,'absent');assert.equal((await view(absent)).effective_seat_allowance,0);
 for(const patch of ["requested_seats=NULL","contract_end=NULL","contract_end='2020-01-01',contract_start='2019-01-01'"]){const invalid=await fixture();await pg.query('update business_onboardings set '+patch+' where id=$1',[invalid]);await assert.rejects(run(invalid,cmd('activate_trial')),/BUSINESS_INCOMPLETE/);assert.equal((await view(invalid)).workspace,null);}
 const incomplete=await fixture('trial','awaiting_information');await assert.rejects(run(incomplete,cmd('activate_trial')),/BUSINESS_INCOMPLETE/);assert.equal((await view(incomplete)).workspace,null);
 const future=await fixture();await pg.query('update business_onboardings set contract_start=$1 where id=$2',[isoDays(1),future]);await run(future,cmd('activate_trial'));assert.equal((await view(future)).effective_status,'scheduled');assert.equal((await view(future)).effective_seat_allowance,0);
 // Exact database timestamp boundaries, with fixture-only privileged setup.
 await pg.exec('begin');await pg.query(`update business_entitlements set starts_at=statement_timestamp()-interval '1 day',ends_at=statement_timestamp() where workspace_id=(select id from business_workspaces where origin_onboarding_id=$1)`,[future]);
 const expired=await view(future);assert.equal(expired.effective_status,'expired');assert.equal(expired.effective_seat_allowance,0);await pg.exec('rollback');
 // Inject failures only in this isolated test database.
 await pg.exec(`create function public.fixture_fail_event() returns trigger language plpgsql as $$begin if new.reason='fail event' then raise exception 'FIXTURE_EVENT_FAILURE'; end if;return new;end$$;create trigger fixture_fail_event before insert on business_entitlement_events for each row execute function fixture_fail_event();`);
 const eventFail=await fixture();await assert.rejects(run(eventFail,cmd('activate_trial',1,0,{reason:'fail event'})),/FIXTURE_EVENT_FAILURE/);assert.equal((await view(eventFail)).workspace,null);assert.equal(Number((await pg.query('select revision from business_onboardings where id=$1',[eventFail])).rows[0].revision),1);
 await pg.exec(`create function public.fixture_fail_onboarding() returns trigger language plpgsql as $$begin if new.company_name='FAIL ONBOARDING' and new.status='ready_to_activate' then raise exception 'FIXTURE_ONBOARDING_FAILURE'; end if;return new;end$$;create trigger fixture_fail_onboarding before update on business_onboardings for each row execute function fixture_fail_onboarding();`);
 const onboardingFail=await fixture();await pg.query("update business_onboardings set company_name='FAIL ONBOARDING' where id=$1",[onboardingFail]);await assert.rejects(run(onboardingFail,cmd('activate_trial')),/FIXTURE_ONBOARDING_FAILURE/);assert.equal((await view(onboardingFail)).workspace,null);
 if(Driver){
  // Independent, pre-established connections: actual row-lock serialization.
  const a=new Driver({host:'127.0.0.1',port:Number(port),database:'postgres',user:'postgres'}),b=new Driver({host:'127.0.0.1',port:Number(port),database:'postgres',user:'postgres'});
  await Promise.all([a.connect(),b.connect()]);
  try{
   await Promise.all([a.query('set role service_role'),b.query('set role service_role')]);
   for(const same of [true,false]){
    const id=await fixture(),first=cmd('activate_trial'),second=same?first:cmd('activate_trial');
    await a.query('begin');const firstResult=(await a.query(commandSql,[id,null,'user_fixture',JSON.stringify(first)])).rows[0].result;
    let settled=false;const contender=b.query(commandSql,[id,null,'user_fixture',JSON.stringify(second)]).then(r=>{settled=true;return {result:r.rows[0].result}},e=>{settled=true;return {error:e.message}});
    await new Promise(r=>setTimeout(r,200));assert.equal(settled,false,'contender waits on onboarding lock');await a.query('commit');const outcome=await contender;
    if(same)assert.deepEqual(outcome.result,firstResult);else assert.match(outcome.error,/BUSINESS_STALE_ONBOARDING/);
    assert.equal((await view(id)).history.length,1);
   }
   console.log('PASS real PostgreSQL two-connection activation lock wait, same-operation replay, different-operation conflict');
  }finally{await a.end();await b.end();}
 }else console.log('NOTE: run --local-postgres-port for independent-connection concurrency coverage.');
 await assert.rejects(pg.exec(read('docs/review/business-entitlement-rollback.sql')),/BUSINESS_ROLLBACK_REFUSED/);
 await pg.exec('rollback');
 assert.deepEqual(await counts(),original);
 console.log('PASS migration COMMIT; invoice full term; trial/complimentary; UTC/exclusive expiry; scheduled/suspended/revoked; stale revisions; immutable audit; atomic failure rollback; proposal lock; no stacking or operational side effects');
}finally{await pg.close();}
