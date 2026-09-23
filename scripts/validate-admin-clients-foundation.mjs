// Local-only: mocked HTTP/Auth and optional isolated PostgreSQL (PGlite).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import ts from 'typescript';
import { pathToFileURL } from 'node:url';
import { loadStagingSchema } from './lib/admin-clients-staging-fixture.mjs';
function load(file, deps = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, { exports, Error, console, URL, Request, Set, process: { env: { DMI_ADMIN_CLERK_USER_IDS: 'admin' } },
    ...globals, require: name => { assert.ok(name in deps, name); return deps[name]; } });
  return exports;
}
const plain = value => JSON.parse(JSON.stringify(value));
const ids = Array.from({length: 12}, (_, i) => `11111111-1111-4111-a111-${String(i+1).padStart(12,'0')}`);
const [individual, company, owner, staffId, staffOwner, cardId, operationId, unlinked, missingOwner, other] = ids;
const contract = load('src/lib/admin-client-contract.ts');
const clients = [{id:individual,account_type:'individual',user_id:owner,cards_active:999}, {id:company,account_type:'business'}];
const staff = [{id:staffId,client_id:individual,user_id:owner}, {id:unlinked,client_id:company,email:'same@test.test'}, {id:other,client_id:company,user_id:staffOwner}, {id:'missing',client_id:company,user_id:missingOwner}];
const cards = [{id:cardId,user_id:owner}, {id:'company-card',client_id:company,user_id:staffOwner}, {id:'not-owned',email:'same@test.test',full_name:'Same'}];
const counts = plain(contract.clientRelationshipCounts(clients, staff, cards, new Set([owner,staffOwner])));
assert.equal(counts.cardCounts[individual],1); assert.equal(counts.cardCounts[company],1);
assert.deepEqual(counts.staffCards[unlinked],[]); assert.deepEqual(counts.staffCards[other],['company-card']);
assert.equal(counts.summary.activatedUsers,2); assert.equal(counts.summary.unlinkedStaff,2); assert.equal(counts.summary.cards,3);
assert.equal(contract.linkedUser({id:individual,user_id:owner,profile_id:staffOwner}),null);
assert.equal(contract.clientRelationshipCounts([{id:individual,account_type:'individual',profile_id:owner}],[],cards,new Set([owner])).cardCounts[individual],1);
let identity = {}, calls = [], rpcError = false, deleteResult = [{id:unlinked}];
const db = {
  rpc: async (name, args) => { calls.push({name,args:plain(args)}); return {error: rpcError ? {} : null}; },
  from: table => {
    const call={table}; calls.push(call);
    const query = {
      insert: value => { call.insert=plain(value); return query; }, update: value => {call.update=plain(value); return query;},
      delete: () => {call.delete=true; return query;}, eq: (key,value) => {call[key]=value;return query;},
      is: (key,value) => {call[key]=value;return query;}, select: async () => ({data:call.delete?deleteResult:[{id:individual}],error:null}),
    }; return query;
  },
};
const authHelper=load('src/lib/admin-auth.ts');
const server=load('src/lib/admin-client-mutations-server.ts', {
  'server-only':{}, 'node:crypto':crypto, '@clerk/nextjs/server':{auth:async()=>identity},
  'next/server':{NextResponse:{json:(body,options={})=>({body,status:options.status||200})}},
  '@/lib/admin-auth':authHelper, '@/lib/supabase-admin':{createSupabaseAdminClient:()=>db},
});
const operations=['create-client','update-client','status','create-staff','update-staff','delete-staff','import'];
const run=(operation,body={},id=individual,origin) => server.adminClientMutation(new Request('http://localhost/api/admin/clients',{
  method:'POST',headers:origin?{origin}:{},body:JSON.stringify(body),
}),operation,id);
for(const userId of [null,'outsider']){identity={userId}; for(const op of operations)assert.equal((await run(op)).status,403);}
assert.equal(calls.length,0);identity={userId:'admin'};
assert.equal((await run('create-client',{},individual,'http://evil.example')).status,403);
for(const key of ['user_id','profile_id','cards_active','subscription_plan','billing_status']){
 assert.equal((await run('update-client',{full_name:'Name',[key]:owner})).status,400);
 assert.equal((await run('update-staff',{full_name:'Name',[key]:owner})).status,400);
}
assert.equal(calls.length,0);
assert.equal((await run('create-client',{full_name:'Name',email:'person@test.test',account_type:'individual'})).status,200);
assert.equal(calls.at(-1).insert.subscription_plan,'free');
assert.equal((await run('create-client',{full_name:'Name',email:'person@test.test',status:'suspended'})).status,200);assert.equal(calls.at(-1).insert.status,'suspended');
assert.equal((await run('update-client',{full_name:'Updated'})).status,200);
assert.equal((await run('status',{status:'suspended'})).status,200);assert.equal(calls.at(-1).name,'admin_set_client_status');
assert.equal((await run('create-staff',{client_id:company,full_name:'Staff'})).status,200);assert.equal(calls.at(-1).name,'admin_create_client_staff');
assert.equal((await run('update-staff',{full_name:'Updated'},staffId)).status,200);assert.equal(calls.at(-1).name,'admin_update_client_staff');
assert.equal((await run('delete-staff',{},unlinked)).status,200);assert.equal(calls.at(-1).user_id,null);assert.equal(calls.at(-1).profile_id,null);
deleteResult=[];assert.equal((await run('delete-staff',{},staffId)).status,409);
const payload={operationId,companies:[{client:{full_name:'Owner',company_name:'Company',email:'company@test.test',account_type:'business'},staff:[{full_name:'Staff',email:'staff@test.test'}]}]};
assert.equal((await run('import',payload)).status,200);const first=calls.at(-1);
assert.equal((await run('import',payload)).status,200);assert.deepEqual(calls.at(-1),first);
rpcError=true;assert.equal((await run('import',payload)).status,409);rpcError=false;
const before=calls.length;assert.equal((await run('import',{...payload,companies:[...payload.companies,{client:{},staff:[]}]})).status,400);assert.equal(calls.length,before);
assert.equal((await run('import',{...payload,companies:Array(51).fill(payload.companies[0])})).status,400);
for(const file of fs.readdirSync('src',{recursive:true}).filter(file=>/\.(ts|tsx)$/.test(file))){
 const source=fs.readFileSync('src/'+file,'utf8');
 if(/^\s*["']use client["']/.test(source))assert.doesNotMatch(source,/\.from\(["'](?:clients|client_users)["']\)[\s\S]{0,200}\.(insert|update|delete|upsert)\(/,file);
}
const page=fs.readFileSync('src/app/clients/page.tsx','utf8');
// Execute the actual page handlers with controlled Clerk/fetch promises.
const parsedPage = ts.createSourceFile('page.tsx', page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const handlers = {};
function visit(node) {
 if (ts.isFunctionDeclaration(node) && ['mutate','toggleClientStatus'].includes(node.name?.text)) handlers[node.name.text] = node.getText(parsedPage);
 ts.forEachChild(node, visit);
}
visit(parsedPage);
assert.match(page, /const \{ getToken \} = useAuth\(\)/);
assert.equal(Object.keys(handlers).length, 2);
function statusHarness({confirmed=true, token=async()=> 'fresh-session-token', response=async()=>({ok:true,json:async()=>({ok:true})})}={}) {
 const events=[], requests=[], errors=[], pending={current:false};
 const clientContract=load('src/lib/admin-client-contract.ts', {}, {fetch:async(path,options)=>{
  events.push('fetch'); requests.push({path,...plain(options)}); return response();
 }});
 const context={mutationPending:pending, window:{confirm:()=>{events.push('confirm');return confirmed;}},
  getToken:async options=>{events.push('token');assert.deepEqual(plain(options),{skipCache:true});return token();},
  mutateAdminClient:clientContract.mutateAdminClient,alert:message=>errors.push(message),fetchClientData:()=>events.push('refresh'),Error};
 vm.createContext(context);
 vm.runInContext(ts.transpileModule(Object.values(handlers).join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText,context);
 return {context,events,requests,errors,pending};
}
for (const [status,next] of [['active','suspended'],['suspended','active']]) {
 const h=statusHarness();await h.context.toggleClientStatus({id:individual,status,full_name:'Test'});
 assert.deepEqual(h.events,['confirm','token','fetch','refresh']);
 assert.equal(h.requests.length,1);const req=h.requests[0];
 assert.equal(req.path,`/api/admin/clients/${individual}/status`);assert.equal(req.method,'PATCH');
 assert.deepEqual(JSON.parse(req.body),{status:next});assert.equal(req.credentials,'same-origin');
 assert.equal(req.headers.Authorization,'Bearer fresh-session-token');assert.equal(h.pending.current,false);
}
const cancel=statusHarness({confirmed:false});await cancel.context.toggleClientStatus({id:individual,status:'active'});
assert.deepEqual(cancel.events,['confirm']);assert.equal(cancel.requests.length,0);
for(const token of [async()=>null,async()=>'',async()=> '  ',async()=>{throw new Error('refresh failed');}]){
 const h=statusHarness({token});await h.context.toggleClientStatus({id:individual,status:'active'});
 assert.equal(h.requests.length,0);assert.equal(h.errors.length,1);assert.equal(h.pending.current,false);
}
let releaseToken, releaseResponse;
const duplicate=statusHarness({token:()=>new Promise(resolve=>{releaseToken=resolve;}),response:()=>new Promise(resolve=>{releaseResponse=resolve;})});
const inFlight=duplicate.context.toggleClientStatus({id:individual,status:'active'});
await duplicate.context.toggleClientStatus({id:individual,status:'active'});
assert.deepEqual(duplicate.events,['confirm','token']);
releaseToken('fresh-session-token');
for(let i=0;i<10 && !releaseResponse;i++) await Promise.resolve();
assert.ok(releaseResponse);await duplicate.context.toggleClientStatus({id:individual,status:'active'});
assert.equal(duplicate.requests.length,1);releaseResponse({ok:true,json:async()=>({ok:true})});await inFlight;
assert.equal(duplicate.pending.current,false);
for(const response of [async()=>({ok:false,json:async()=>({error:'Admin access is required.'})}),async()=>{throw new Error('network failure');}]){
 const h=statusHarness({response});await h.context.toggleClientStatus({id:individual,status:'active'});
 assert.equal(h.requests.length,1);assert.equal(h.errors.length,1);assert.equal(h.pending.current,false);assert.ok(!h.events.includes('refresh'));
}
for(const [method,path] of [['POST','/api/admin/clients'],['PATCH',`/api/admin/clients/${individual}`]]){
 const h=statusHarness();assert.equal(await h.context.mutate(path,method,{full_name:'Test'}),true);
 assert.deepEqual(h.events,['fetch']);assert.equal(h.requests[0].headers.Authorization,undefined);assert.equal(h.requests[0].credentials,'same-origin');
}
console.log('PASS: actual status handlers refresh after confirmation; suspend/reactivate PATCH + Bearer; cancel/refresh failure; duplicate lock; no replay; Create/Edit compatibility.');
assert.doesNotMatch(page,/cards_active|supabase|Paid Users|Overdue["']/);
assert.match(page,/relationships\?\.staffCards/);assert.match(page,/getAdminClientCounts\(\)/);
assert.doesNotMatch(page.slice(page.indexOf('function findCardsForUser'),page.indexOf('function openCardPreview')),/email|full_name/);
assert.match(page,/importOperation\?\.signature === signature/);
for(const route of ['clients','clients/[clientId]','clients/[clientId]/status','clients/import','client-users','client-users/[clientUserId]'])assert.match(fs.readFileSync(`src/app/api/admin/${route}/route.ts`,'utf8'),/adminClientMutation/);
let summaryDbCalls = 0;
const summaryServer=load('src/lib/admin-client-summary-server.ts', {
 'server-only':{}, '@clerk/nextjs/server':{auth:async()=>identity},
 'next/server':{NextResponse:{json:(body,options={})=>({body,status:options.status||200})}},
 '@/lib/admin-auth':authHelper, '@/lib/admin-client-contract':contract,
 '@/lib/supabase-admin':{createSupabaseAdminClient:()=>{
  summaryDbCalls++;
  return {
   from:table=>({select:()=>({order:()=>({range:async()=>({data:{clients,client_users:staff,cards}[table],error:null})})})}),
   auth:{admin:{getUserById:async id=>[owner,staffOwner].includes(id)?{data:{user:{id}},error:null}:{data:{user:null},error:{status:404}}}},
  };
 }},
});
identity={userId:'outsider'};assert.equal((await summaryServer.readAdminClientCounts()).status,403);assert.equal(summaryDbCalls,0);
identity={userId:'admin'};const summaryResponse=await summaryServer.readAdminClientCounts();assert.equal(summaryResponse.status,200);assert.deepEqual(plain(summaryResponse.body),counts);
console.log('PASS: Admin authorization, mutation allowlists, UUID counts, real/distinct identities, no contact ownership fallback, import retries/bounds/errors, browser API wiring.');

const modulePath=process.argv.find(arg=>arg.startsWith('--postgres-module='))?.split('=').slice(1).join('=');
if(!modulePath){console.log('PostgreSQL execution not requested (use --postgres-module=/path/to/pglite/dist/index.js).');process.exit(0);}
const {PGlite}=await import(pathToFileURL(modulePath).href);
const pg=new PGlite();
try {
 console.log('Isolated engine:',(await pg.query('select version()')).rows[0].version);
 await loadStagingSchema(pg);
 await pg.exec(fs.readFileSync('supabase/migrations/20260924090000_add_admin_clients_prerequisites.sql','utf8'));
 const old=fs.readFileSync('supabase/migrations/20260608113000_add_split_name_fields.sql','utf8');
 const previous=old.slice(old.indexOf('create or replace function public.ensure_client_records_for_profile'),old.indexOf('drop trigger if exists ensure_client_records_after_profile_update'));
 const aclBefore=await pg.query("select proname,proacl::text from pg_proc where proname in ('ensure_client_records_for_profile','ensure_current_client_account') order by proname");
 const migration=fs.readFileSync('supabase/migrations/20260924100000_admin_clients_foundation.sql','utf8');
 // The only provisioning changes are removal of reset assignments; preserve all other semantics.
 const expected=previous.replace("      account_type = 'individual',\n      subscription_plan = 'free',\n      billing_status = 'free',\n",'').replace("    subscription_plan = 'free',\n    plan = 'free',\n",'');
 assert.ok(migration.includes(expected));
 await pg.exec(migration); // Must reach COMMIT.
 assert.deepEqual((await pg.query("select proname,proacl::text from pg_proc where proname in ('ensure_client_records_for_profile','ensure_current_client_account') order by proname")).rows,aclBefore.rows);
 for(const signature of ['admin_set_client_status(uuid,text)','admin_create_client_staff(uuid,jsonb)','admin_update_client_staff(uuid,jsonb)','admin_import_client_accounts(jsonb)']){
  const grant=(await pg.query("select has_function_privilege('authenticated',$1,'execute') as browser,has_function_privilege('anon',$1,'execute') as anon,has_function_privilege('service_role',$1,'execute') as service",[signature])).rows[0];
  assert.deepEqual(grant,{browser:false,anon:false,service:true});
 }
 await pg.query('insert into auth.users(id,email) values ($1,$2)',[owner,'owner@test.test']);
 await pg.query("select set_config('test.user',$1,false)",[owner]);
 await pg.query('select * from ensure_current_client_account()');
 assert.equal((await pg.query('select count(*)::int n from clients')).rows[0].n,1);
 assert.equal((await pg.query('select count(*)::int n from client_users')).rows[0].n,1);
 assert.equal((await pg.query('select subscription_plan from clients')).rows[0].subscription_plan,'free');
 for(const type of ['individual','business','enterprise']){
  await pg.query("update clients set account_type=$1,subscription_plan='paid',billing_status='overdue',status='suspended',cards_active=17",[type]);
  await pg.exec("update profiles set subscription_plan='paid',plan='paid'");
  await pg.exec('select * from ensure_current_client_account(); select * from ensure_current_client_account();');
  assert.deepEqual((await pg.query('select account_type,subscription_plan,billing_status,status,cards_active from clients')).rows[0],{account_type:type,subscription_plan:'paid',billing_status:'overdue',status:'suspended',cards_active:17});
  assert.deepEqual((await pg.query('select subscription_plan,plan from profiles')).rows[0],{subscription_plan:'paid',plan:'paid'});
  assert.equal((await pg.query('select count(*)::int n from clients')).rows[0].n,1);
 }
 const imported=first.args.p_companies;
 await pg.query('select admin_import_client_accounts($1)',[JSON.stringify(imported)]);
 await pg.query('select admin_import_client_accounts($1)',[JSON.stringify(imported)]);
 assert.equal((await pg.query('select count(*)::int n from clients')).rows[0].n,2);
 assert.equal((await pg.query('select count(*)::int n from client_users')).rows[0].n,2);
 const importedId=imported[0].client.id, importedStaff=imported[0].staff[0].id;
 const snapshot=async()=>JSON.stringify((await pg.query("select (select jsonb_agg(c order by id) from clients c) clients,(select jsonb_agg(s order by id) from client_users s) staff")).rows);
 let beforeRows=await snapshot();
 const broken=plain(imported);broken[0].client.id=company;broken[0].staff[0].id=staffId;broken[0].staff[0].client_id=individual;
 await assert.rejects(pg.query('select admin_import_client_accounts($1)',[JSON.stringify(broken)]));assert.equal(await snapshot(),beforeRows,'partial import rolls back');
 const changed=plain(imported);changed[0].client.company_name='Changed';
 await assert.rejects(pg.query('select admin_import_client_accounts($1)',[JSON.stringify(changed)]));assert.equal(await snapshot(),beforeRows);
 await pg.query("select admin_set_client_status($1,'suspended')",[importedId]);
 assert.equal((await pg.query('select status from client_users where id=$1',[importedStaff])).rows[0].status,'suspended');
 await assert.rejects(pg.query('select admin_update_client_staff($1,$2)',[importedStaff,JSON.stringify({status:'active'})]));
 await pg.query('select admin_create_client_staff($1,$2)',[importedId,JSON.stringify({full_name:'New Staff',status:'active'})]);
 assert.equal((await pg.query("select status from client_users where full_name='New Staff'")).rows[0].status,'suspended');
 // Deliberate local trigger failure proves status updates are atomic across parent and staff.
 await pg.exec(`create function reject_staff_update() returns trigger language plpgsql as $$ begin raise exception 'test failure'; end $$;
 create trigger reject_staff before update on client_users for each row execute function reject_staff_update();`);
 beforeRows=await snapshot();await assert.rejects(pg.query("select admin_set_client_status($1,'active')",[importedId]));assert.equal(await snapshot(),beforeRows);
 await pg.exec('drop trigger reject_staff on client_users;');
 await pg.query("select admin_set_client_status($1,'active')",[importedId]);
 assert.equal((await pg.query('select count(*)::int n from client_users where client_id=$1 and status<>\'active\'',[importedId])).rows[0].n,0);
 await pg.exec('set role authenticated;');
 await assert.rejects(pg.query("select admin_set_client_status($1,'suspended')",[importedId]),/permission denied/);
 await pg.exec('reset role;');
 console.log('PASS: PostgreSQL COMMIT; provisioning new/repeat/paid/business/enterprise; preserved provisioning ACLs; service-only RPCs; atomic import rollback/retry/conflict; atomic suspension rollback/reactivation; parent-lock staff guards.');
} finally {await pg.close();}
