// Local, in-memory checks only. No Clerk/Supabase network calls or real credentials.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import ts from 'typescript';
function load(file, deps, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, { exports, Error, console, process: { env: { DMI_ADMIN_CLERK_USER_ID: 'admin' } },
    require: name => { assert.ok(name in deps, name); return deps[name]; }, ...globals });
  return exports;
}
const authHelper = load('src/lib/admin-auth.ts', {});
const contract = load('src/lib/admin-card-mutations.ts', {});
let identity, tables, calls, failAfterInsert = false;
const ids = Array.from({length: 10}, (_, i) => `11111111-1111-4111-a111-${String(i+1).padStart(12,'0')}`);
const [clientId, templateId, staffId, ownerId, unlinkedId, operationId, otherId] = ids;
function reset() {
 identity = {userId:'admin'}; calls=[]; failAfterInsert=false;
 tables={clients:[{id:clientId,account_type:'business',company_name:'Acme'}], templates:[{id:templateId,is_published:true,access_level:'free'}], client_users:[{id:staffId,client_id:clientId,user_id:ownerId,full_name:'Linked'}, {id:unlinkedId,client_id:clientId,user_id:null,full_name:'Unlinked'}],cards:[]};
}
function database() {
 calls.push('database');
 return {auth:{admin:{getUserById:async id=>({data:{user:id===ownerId?{id}:null},error:null})}},from(table) {
 let op='select',payload,columns,filters=[],single=false,limit;
 const q={select(v){columns=v;return q},eq(k,v){filters.push(r=>r[k]===v);return q},in(k,v){filters.push(r=>v.includes(r[k]));return q},limit(v){limit=v;return q},maybeSingle(){single=true;return q},insert(v){op='insert';payload=v;return q},update(v){op='update';payload=v;return q},delete(){op='delete';return q},then(resolve,reject){return Promise.resolve().then(()=>{
 calls.push({table,op,payload,columns});
 assert.ok(!String(columns).includes('profile_id'));
 if(payload) assert.ok(!('profile_id' in payload));
 let rows=tables[table].filter(r=>filters.every(f=>f(r)));
 if(op==='insert'){
  assert.ok(!('card_slot' in payload));
  if(tables[table].some(r=>r.id===payload.id)) return {error:{message:'duplicate'}};
  const slot=[1,2,3].find(s=>!tables.cards.some(r=>r.user_id===payload.user_id&&r.card_slot===s));
  if(!slot)return {error:{message:'CARD_SLOT_LIMIT_REACHED'}};
  const row={...payload,card_slot:slot};tables[table].push(row);rows=[row];
  if(failAfterInsert){failAfterInsert=false;throw Error('lost response')}
 }
 if(op==='update') rows.forEach(r=>Object.assign(r,payload));
 if(op==='delete')tables[table]=tables[table].filter(r=>!rows.includes(r));
 if(limit)rows=rows.slice(0,limit);
 const data=rows.map(r=>columns?Object.fromEntries(columns.split(',').map(k=>[k,r[k]])):{...r});
 return {data:single?data[0]||null:data,error:null};
 }).then(resolve,reject)}};return q;
 }};
}
const server=load('src/lib/admin-card-mutations-server.ts',{
 'server-only':{},'node:crypto':crypto,
 'next/server':{NextResponse:{json:(body,options={})=>({body,status:options.status||200})}},
 '@clerk/nextjs/server':{auth:async()=>identity,currentUser:async()=>({})},
 '@/lib/admin-auth':authHelper,'@/lib/supabase-admin':{createSupabaseAdminClient:database},'@/lib/admin-card-mutations':contract
});
const body={clientId,templateId,operationId,staff:[{staffId},{staffId:unlinkedId}]};
const run=(op='create',value=body,id)=>server.adminCardMutation(new Request('http://localhost/api/admin/cards',{method:'POST',body:JSON.stringify(value)}),op,id);
reset();
for(const userId of [null,'outsider']){identity={userId};for(const op of ['create','publish','delete'])assert.equal((await run(op,{},otherId)).status,403)}
assert.equal(calls.length,0);
reset();
assert.equal((await run('create',{...body,user_id:ownerId})).status,400);
assert.equal((await run('create',{...body,staff:[{staffId,seed:{user_id:ownerId}}]})).status,400);
const mixed=await run();assert.deepEqual(Array.from(mixed.body.results,r=>r.status),['created','ineligible']);
const card=tables.cards[0];assert.equal(card.user_id,ownerId);assert.equal(card.client_id,clientId);assert.equal(card.status,'published');assert.equal(card.is_published,true);assert.equal(card.card_slot,1);
assert.equal((await run()).body.results[0].status,'created');assert.equal(tables.cards.length,1);
const before={...card};
assert.equal((await run('publish',{operation:'unpublish'},card.id)).status,200);
assert.deepEqual(card,{...before,status:'draft',is_published:false});
assert.equal((await run('publish',{operation:'publish'},card.id)).status,200);assert.deepEqual(card,before);
assert.equal((await run('publish',{operation:'publish',slug:'changed'},card.id)).status,400);
assert.equal((await run('delete',{},card.id)).status,200);assert.equal((await run('delete',{},card.id)).status,404);
reset();failAfterInsert=true;assert.equal((await run()).body.results[0].status,'failed');assert.equal(tables.cards.length,1);assert.equal((await run()).body.results[0].status,'created');assert.equal(tables.cards.length,1);
reset();tables.client_users[0].client_id=otherId;assert.equal((await run()).body.results[0].status,'ineligible');assert.equal(tables.cards.length,0);
reset();tables.client_users.push({...tables.client_users[0],id:otherId});assert.equal((await run()).body.results[0].status,'ineligible');
reset();tables.client_users[0].user_id=otherId;assert.equal((await run()).body.results[0].status,'ineligible');
reset();tables.cards=[1,2,3].map(card_slot=>({id:crypto.randomUUID(),user_id:ownerId,card_slot}));assert.equal((await run()).body.results[0].status,'failed');assert.equal(tables.cards.length,3);
for(const file of ['cards','clients','public-pages']) {const source=fs.readFileSync(`src/app/${file}/page.tsx`,'utf8');assert.doesNotMatch(source, /\.from\(["']cards["']\)[\s\S]{0,160}\.(insert|update|upsert|delete)\(/);assert.ok(source.includes('mutateAdminCard'));}
console.log('PASS: authorization, bounded payloads, linked/missing/conflicting ownership, mixed batches, slot-capacity handling, lost-response retries, publication preservation, deletion/not-found and all three UI API paths. Slot assignment is simulated; no production writes.');
