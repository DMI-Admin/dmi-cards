// LOCAL ONLY: actual worker with in-memory RPC/Storage. Never connects to a database.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {randomUUID} from 'node:crypto';
const exports={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/card-media-cleanup-server.ts','utf8'),
  {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
  {exports, require(n){assert.equal(n,'server-only');return {};}});
const {runCardMediaCleanup}=exports;
function harness(options={}) {
  const id=randomUUID(), token=randomUUID(), path=`${randomUUID()}/${randomUUID()}/profile/${id}.webp`;
  let state=options.state||'cleanup_pending', lease=false, attempts=0, object=options.absent?false:true;
  let failRemove=!!options.failRemove, reference=!!options.referenced;
  const calls=[];
  const db={from(table){assert.equal(table,'card_media_assets');return {
    select(){return this;},eq(column,value){assert.equal(column,'id');assert.equal(value,id);calls.push(['exact_read',value]);return this;},
    async maybeSingle(){return {data:options.invalid?null:{id,state,
      cleanup_after:new Date(Date.now()+(options.notDue?60000:-60000)).toISOString(),
      cleanup_lease_until:options.busy?new Date(Date.now()+60000).toISOString():null}};}
  };},async rpc(name,args){calls.push([name,args]);
    if(name==='check_card_media_cleanup_boundary')return options.unsafe?{error:{}}:{data:null};
    if(name==='card_media_cleanup_candidates') {
      if(options.unsafe)return {error:{}};
      return {data:Array.from({length:options.count??1},()=>id)};
    }
    if(name==='prune_empty_card_media_sessions')return {data:0};
    assert.equal(name,'manage_card_media_cleanup');assert.equal(args.p_asset,id);
    if(reference)return {data:{status:'referenced'}};
    if(args.p_action==='claim'){
      if(options.claimStatus)return {data:{status:options.claimStatus}};
      if(lease)return {data:{status:'busy'}};
      if(state==='attached'){state='cleanup_pending';return {data:{status:'cleanup_pending'}};}
      if(options.notDue)return {data:{status:'not_due'}};
      state='deleting';lease=true;return {data:{status:'claimed',token,path,retried:attempts++>0}};
    }
    if(args.p_token!==token||options.stale)return {data:{status:'stale'}};
    if(args.p_action==='check'){
      if(options.referenceAtCheck){reference=true;return {data:{status:'referenced'}};}
      return {data:{status:'authorized'}};
    }
    if(args.p_action==='retry'){lease=false;return {data:{status:'retry'}};}
    assert.equal(args.p_action,'complete');assert.equal(object,false,'never complete while object exists');
    state='deleted';lease=false;return {data:{status:'deleted'}};
  },storage:{from(bucket){assert.equal(bucket,'card-media');return {
    async info(p){assert.equal(p,path);calls.push(['info']);if(options.networkError)throw new Error('Simulated network failure');if(options.storageError)return {error:options.storageError};if(options.infoError)return {error:{status:403}};if(options.noSuchKey)return {error:{status:400,statusCode:'NoSuchKey'}};
      return object?{data:{size:100}}:{error:{status:404}};},
    async remove(paths){assert.deepEqual([...paths],[path]);calls.push(['remove']);
      if(failRemove){failRemove=false;return {error:{}};} if(!options.unconfirmed)object=false;return {data:[]};}
  };}}};
  return {db,calls,id,path,get state(){return state;},get object(){return object;}};
}
for(const label of ['replaced after grace','explicit remove','abandoned upload','expired session']) {
  const h=harness();const result=await runCardMediaCleanup(h.db);assert.equal(result.deleted,1,label);assert.equal(h.state,'deleted');
  assert.ok(h.calls.findIndex(c=>c[1]?.p_action==='check')<h.calls.findIndex(c=>c[0]==='remove'));
}
for(const label of ['finalized','attached','referenced by another card','replacement won race']) {
  const h=harness({referenced:true});const result=await runCardMediaCleanup(h.db);
  assert.equal(result.skippedReferenced,1,label);assert.equal(h.object,true);
}
const orphan=harness({state:'attached'});assert.equal((await runCardMediaCleanup(orphan.db)).deferred,1);assert.equal(orphan.object,true);
const grace=harness({notDue:true});assert.equal((await runCardMediaCleanup(grace.db)).deferred,1);
const failure=harness({failRemove:true});assert.equal((await runCardMediaCleanup(failure.db)).failed,1);assert.equal(failure.object,true);
assert.equal((await runCardMediaCleanup(failure.db)).retried,1);assert.equal(failure.state,'deleted');
const absent=harness({absent:true});assert.equal((await runCardMediaCleanup(absent.db)).alreadyAbsent,1);assert.ok(!absent.calls.some(c=>c[0]==='remove'));
const missingCode=harness({absent:true,noSuchKey:true});assert.equal((await runCardMediaCleanup(missingCode.db)).alreadyAbsent,1);
// Exercise the actual worker against each Storage error shape, including staging's
// HTTP 400 + API statusCode '404'. Generic failures must retain a retryable row.
for (const [label, storageError] of [
  ['HTTP 404', {status:404}],
  ['API 404 with HTTP 400', {status:400,statusCode:'404'}],
  ['NoSuchKey', {status:400,statusCode:'NoSuchKey'}],
]) {
  const h=harness({absent:true,storageError});
  const result=await runCardMediaCleanup(h.db);
  assert.equal(result.alreadyAbsent,1,label);assert.equal(result.failed,0,label);
  assert.equal(result.deleted,0,label);assert.equal(h.state,'deleted',label);
  assert.ok(!h.calls.some(c=>c[0]==='remove'),label+' must not issue Storage delete');
  assert.ok(h.calls.some(c=>c[1]?.p_action==='check'),label+' still rechecks authorization');
  assert.ok(h.calls.some(c=>c[1]?.p_action==='complete'),label+' completes only after absence');
}
for (const [label, options] of [
  ['generic HTTP 400', {storageError:{status:400}}],
  ['HTTP 401', {storageError:{status:401,statusCode:'Unauthorized'}}],
  ['HTTP 403', {storageError:{status:403,statusCode:'AccessDenied'}}],
  ['permission failure', {storageError:{status:400,statusCode:'AccessDenied'}}],
  ['unknown Storage error', {storageError:{message:'Unknown failure'}}],
  ['server failure', {storageError:{status:500}}],
  ['network error', {networkError:true}],
]) {
  const h=harness(options);const result=await runCardMediaCleanup(h.db);
  assert.equal(result.failed,1,label);assert.equal(result.alreadyAbsent,0,label);
  assert.equal(result.deleted,0,label);assert.equal(h.state,'deleting',label);
  assert.equal(h.object,true,label+' preserves the object');
  assert.ok(h.calls.some(c=>c[1]?.p_action==='retry'),label+' schedules retry');
  assert.ok(!h.calls.some(c=>c[0]==='remove'||c[1]?.p_action==='complete'),label+' never deletes/completes');
  delete options.storageError;delete options.networkError;
  const retry=await runCardMediaCleanup(h.db);
  assert.equal(retry.retried,1,label);assert.equal(retry.deleted,1,label+' remains recoverable');
}
console.log('PASS: HTTP/API 404 and NoSuchKey absence; generic 400, 401/403, permission, unknown/server/network errors fail closed and retry.');
const stale=harness({stale:true});assert.equal((await runCardMediaCleanup(stale.db)).staleInvalid,1);assert.equal(stale.object,true);
const raced=harness({referenceAtCheck:true});assert.equal((await runCardMediaCleanup(raced.db)).skippedReferenced,1);assert.equal(raced.object,true);
const ambiguous=harness({infoError:true});assert.equal((await runCardMediaCleanup(ambiguous.db)).failed,1);assert.equal(ambiguous.object,true);
const unconfirmed=harness({unconfirmed:true});assert.equal((await runCardMediaCleanup(unconfirmed.db)).failed,1);assert.equal(unconfirmed.state,'deleting');
const duplicate=harness();const pair=await Promise.all([runCardMediaCleanup(duplicate.db),runCardMediaCleanup(duplicate.db)]);
assert.equal(pair.reduce((n,c)=>n+c.deleted,0),1);assert.equal(duplicate.calls.filter(c=>c[0]==='remove').length,1);
await assert.rejects(runCardMediaCleanup(harness().db,51));
await assert.rejects(runCardMediaCleanup(harness({count:21}).db,20));
await assert.rejects(runCardMediaCleanup(harness({unsafe:true}).db));
// An individual failure must not prevent the next independent object being reclaimed.
const rows=[harness({failRemove:true}),harness(),harness({absent:true})];
const batchDb={async rpc(name,args){
  if(name==='card_media_cleanup_candidates')return {data:rows.map(h=>h.id)};
  if(name==='prune_empty_card_media_sessions')return {data:0};
  return rows.find(h=>h.id===args.p_asset).db.rpc(name,args);
},storage:{from(bucket){return {
  info(path){return rows.find(h=>h.path===path).db.storage.from(bucket).info(path);},
  remove(paths){return rows.find(h=>h.path===paths[0]).db.storage.from(bucket).remove(paths);}
};}}};
const mixed=await runCardMediaCleanup(batchDb);
assert.equal(mixed.failed,1);assert.equal(mixed.deleted,1);assert.equal(mixed.alreadyAbsent,1);
const sql=fs.readFileSync('supabase/migrations/20260922130000_add_card_media_cleanup_worker.sql','utf8');
for(const needle of ['public.retire_card_media_asset(a.id)','public.claim_card_media_cleanup(a.id)',
  'pg_advisory_xact_lock','for update','cleanup_token is distinct from p_token',
  "a.state not in ('deleting','deleted')", "interval '24 hours'", "interval '5 minutes'",
  "interval '15 minutes'", "interval '7 days'",'finalization_digest is null','finalization_result is null',
  'not exists(select 1 from public.card_media_assets','skip locked',"custom_fields->>'company_banner_url'=ref",
  'has_any_column_privilege',"pg_has_role('authenticated',oid,'MEMBER')",'from public,anon,authenticated',
  'to service_role','limit p_limit']) assert.ok(sql.includes(needle),needle);
assert.equal((sql.match(/create function /g)||[]).length,4);
assert.equal((sql.match(/security invoker set search_path = pg_catalog/g)||[]).length,4);
assert.ok(!/security definer|delete from public\.cards\b|alter policy|storage\.objects/i.test(sql.replace(/--[^\n]*/g,"")));
const finalizer=fs.readFileSync('supabase/migrations/20260919120000_add_card_media_finalization.sql','utf8');
assert.ok(finalizer.includes("a.state<>'ready'"));
console.log('PASS: cleanup worker deletion/absence confirmation, failure retry, bounded batch, duplicate worker, stale claim, reference recheck, orphan grace, security preflight and SQL contract checks.');
console.log('LIMITATION: database concurrency/DDL tests require isolated staging; this suite does not execute SQL.');

// Exercise exact mode through the actual worker: discovery/pruning are forbidden.
for (const options of [{}, {absent:true,storageError:{status:400,statusCode:'404'}},
  {referenced:true}, {notDue:true}, {busy:true}, {stale:true}, {invalid:true},
  {referenceAtCheck:true}, {unsafe:true}, ...['not_due','busy','stale','invalid','referenced'].map(claimStatus=>({claimStatus}))]) {
  const h=harness(options);
  if(options.unsafe) await assert.rejects(runCardMediaCleanup(h.db,1,h.id));
  else {
    const result=await runCardMediaCleanup(h.db,1,h.id);
    assert.equal(result.sessionsPruned,0);
    const denied=options.referenced||options.notDue||options.busy||options.stale||options.invalid||options.referenceAtCheck||options.claimStatus;
    assert.equal(result.deleted+result.alreadyAbsent,denied?0:1);
    if(denied)assert.ok(!h.calls.some(c=>c[0]==='remove'||c[1]?.p_action==='complete'));
    if(options.absent)assert.equal(result.alreadyAbsent,1);
  }
  assert.ok(!h.calls.some(c=>['card_media_cleanup_candidates','prune_empty_card_media_sessions'].includes(c[0])));
  for(const c of h.calls.filter(c=>c[0]==='manage_card_media_cleanup'))assert.equal(c[1].p_asset,h.id);
}
await assert.rejects(runCardMediaCleanup(harness().db,1,''));
await assert.rejects(runCardMediaCleanup(harness().db,20,randomUUID()));
// Execute runner argument handling without network, credentials or a real worker.
const runner=fs.readFileSync('scripts/run-card-media-cleanup.mjs','utf8').replace(/^import .*;$/gm,'');
async function runCli(args) {
  let invoked=false;const process={argv:['node','runner',...args],env:{NEXT_PUBLIC_SUPABASE_URL:'https://test.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'test-only'}};
  await vm.runInNewContext('(async()=>{'+runner.replaceAll('import.meta.url',"'file:///runner.mjs'")+ '})()', {
    process,URL,AbortSignal,Date,fs:{readFileSync(){return '';}},ts:{ModuleKind:{CommonJS:1},ScriptTarget:{ES2022:1},transpileModule(){return {outputText:''};}},
    vm:{runInNewContext(_,context){context.exports.runCardMediaCleanup=async(db,batch,id)=>{invoked=true;assert.equal(batch,1);assert.equal(id,asset);return {deleted:0,alreadyAbsent:0,deferred:1};};}},
    createClient(){return {};},console:{log(){},error(){}}
  });
  return {invoked,exitCode:process.exitCode};
}
const asset=randomUUID();
assert.deepEqual(await runCli(['--execute','--project-ref=test','--asset-id='+asset]),{invoked:true,exitCode:1});
for(const tail of [['--asset-id'],['--asset-id='],['--asset-id=invalid'],['--asset-id='+asset,'--batch=1'],['--asset-id='+asset,'--asset-id='+asset]])
  await assert.rejects(runCli(['--execute','--project-ref=test',...tail]));
console.log('PASS: exact UUID only; no discovery/pruning; referenced/not-due/busy/stale/invalid/boundary failure fail closed; API 404; strict CLI and unsuccessful exit status.');
