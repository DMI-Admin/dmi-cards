import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import sharp from 'sharp';
import ts from 'typescript';
const sql = fs.readFileSync('supabase/migrations/20260918160000_prepare_card_media_staging.sql','utf8');
const source = fs.readFileSync('src/lib/card-media-staging-server.ts','utf8');
const cleanupSql = sql.slice(sql.indexOf('create function public.claim_card_media_cleanup('), sql.indexOf('\nrevoke all on function'));
assert.doesNotMatch(cleanupSql, /\bp_owner\b/, 'cleanup has no owner parameter');
assert.match(cleanupSql, /if s\.state = 'pending'\s+and \(\s+s\.expires_at <= now\(\)\s+or not exists \(\s+select 1 from auth\.users where id = s\.owner_user_id\s+\)\s+\)\s+then/);
// Catch undeclared p_* parameters in every SQL function, not only this regression.
for (const match of sql.matchAll(/create function public\.(\w+)\(([^)]*)\)[\s\S]*?as \$\$([\s\S]*?)\$\$;/g)) {
  const declared = new Set(match[2].match(/\bp_\w+\b/g) || []);
  for (const parameter of match[3].match(/\bp_\w+\b/g) || []) {
    assert.ok(declared.has(parameter), `${match[1]}: undeclared ${parameter}`);
  }
}
assert.match(sql, /'card-media','card-media',false,2097152/);
assert.match(sql, /array\['image\/jpeg','image\/png','image\/webp'\]/);
assert.doesNotMatch(sql, /(?:grant|revoke)[^;]*on (?:table )?storage\./i);
assert.doesNotMatch(sql, /create policy/i);
assert.doesNotMatch(sql, /references auth.users/);
assert.match(sql, /CARD_MEDIA_BUCKET_CONFIGURATION_CONFLICT/);
assert.match(sql, /if a.state='attached' then return 'attached'/);
assert.match(sql, /state='cleanup_pending'/);
for (const table of ['card_media_assets','card_media_sessions']) {
  assert.ok(sql.includes(`alter table public.${table} enable row level security`));
}
for (const name of ['reserve_card_media_asset','mark_card_media_ready','attach_card_media_session','claim_card_media_cleanup','retire_card_media_asset']) {
  assert.ok(sql.includes(`create function public.${name}`));
  assert.equal(sql.split(`public.${name}(`).length-1,3,'function has explicit revoke and grant');
}
assert.match(sql, /from public, anon, authenticated/);
assert.match(sql, /to service_role/);
assert.match(sql, /unique \(session_id, kind, sha256\)/);
assert.match(sql, /on conflict\(session_id,kind,sha256\) do nothing/);
assert.match(sql, /public.cards.card_slot:/);
assert.match(sql, /for update/g);
assert.match(sql, /a.state <> 'ready'/);
assert.match(sql, /return 'referenced'/);
assert.doesNotMatch(sql, /(?:update|insert into|delete from) public\.cards\b/i);
assert.doesNotMatch(sql, /create (?:or replace )?function public\.(?:create_client_card_atomic|assign_card_slot)/i);

class ApiRouteError extends Error { constructor(status,code,message){ super(message); this.status=status; } }
const owner='11111111-1111-4111-8111-111111111111', sid='22222222-2222-4222-8222-222222222222';
let signedIn=true, plan='free', supports=true, ownCard=true, calls=[], rows=[];
const db={from(table){let filters=[]; const q={select(){return q},eq(k,v){filters.push([k,v]);return q},or(){return q},insert(value){rows.push(value);return q},async single(){return{data:{id:sid,expires_at:'later'}}},async maybeSingle(){calls.push({table,filters});return {data:table==='templates'?{id:sid,profile_image_allowed:supports,logo_allowed:supports,banner_allowed:supports}:table==='cards'?(ownCard?{id:sid}:null):{template_id:sid,card_id:null}}}};return q},async rpc(name,args){calls.push({name,args});return{data:{asset_id:sid,state:'reserved',object_path:'server/path'}}}};
const exports={};
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{exports,Buffer,require(name){return {
  'server-only':{},'node:crypto':crypto,sharp,
  '@/lib/api/client-context':{requireApiClient:async()=>{if(!signedIn)throw new ApiRouteError(401,'','denied');return{userId:owner,plan}}},
  '@/lib/api/responses':{ApiRouteError},'@/lib/supabase-admin':{createSupabaseAdminClient:()=>db},
  '@/lib/templates':{normalizeTemplate:x=>x},'@/lib/services/card-payload':{canSelectTemplate:()=>true},
}[name]??assert.fail(name)}});
const req={};
signedIn=false;await assert.rejects(exports.beginCardMediaSession(req,sid),e=>e.status===401);signedIn=true;
ownCard=false;await assert.rejects(exports.beginCardMediaSession(req,sid,sid),e=>e.status===404);ownCard=true;
await exports.beginCardMediaSession(req,sid);assert.equal(rows.at(-1).owner_user_id,owner);assert.equal(rows.at(-1).card_id,null);assert.ok(!('id' in rows.at(-1)));
const png=await sharp({create:{width:380,height:81,channels:4,background:{r:0,g:100,b:200,alpha:0.5}}}).png().toBuffer();
const first=await exports.prepareCardMediaAsset(req,sid,'banner',png);
const second=await exports.prepareCardMediaAsset(req,sid,'banner',png);
assert.equal(first.sha256,second.sha256);assert.equal((await sharp(first.bytes).metadata()).hasAlpha,true);
assert.equal(calls.at(-1).args.p_owner,owner);assert.equal(calls.at(-1).args.p_mime,'image/webp');
supports=false;await assert.rejects(exports.prepareCardMediaAsset(req,sid,'banner',png),e=>e.status===403);supports=true;
await assert.rejects(exports.prepareCardMediaAsset(req,sid,'banner',Buffer.from('<svg/>')),e=>e.status===400);
await assert.rejects(exports.prepareCardMediaAsset(req,sid,'banner',Buffer.alloc(2097153)),e=>e.status===400);
await assert.rejects(exports.prepareCardMediaAsset(req,sid,'../other',png),e=>e.status===400);
plan='enterprise';await assert.rejects(exports.beginCardMediaSession(req,sid),e=>e.status===403);
// Logical lock/state invariants (not a substitute for isolated PostgreSQL tests).
for(const first of ['attach','cleanup']){let state='ready';const attach=()=>{if(state!=='ready')return false;state='attached';return true};const cleanup=()=>{if(state==='attached')return'attached';state='deleting';return'deleting'};
if(first==='attach'){assert.equal(attach(),true);assert.equal(cleanup(),'attached')}else{assert.equal(cleanup(),'deleting');assert.equal(attach(),false)}}
console.log('PASS: private bucket/security SQL invariants; authenticated owner resolution; new-card staging; capability denial; image decoding/alpha/size/type; deterministic retry hash; logical attachment/cleanup exclusion. No SQL or Storage calls executed.');
