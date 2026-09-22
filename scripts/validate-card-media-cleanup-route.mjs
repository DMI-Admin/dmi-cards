// Offline only: no database, network or cleanup operations.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {timingSafeEqual} from 'node:crypto';
const source=fs.readFileSync('src/app/api/internal/card-media-cleanup/route.ts','utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const secret='x'.repeat(48);
async function test({env={},auth='Bearer '+secret,query='',result={},throws=false}={}) {
 const calls=[],logs=[],exports={};
 vm.runInNewContext(code,{exports,Buffer,Request,Response,URL,Date,AbortSignal,
 process:{env:{CRON_SECRET:secret,VERCEL_ENV:'production',NEXT_PUBLIC_SUPABASE_URL:'https://gdpwqivdsjymivleruac.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'mock-server-key',...env}},
 console:{info:s=>logs.push(s),error:s=>logs.push(s)},
 require(name){
  if(name==='node:crypto')return {timingSafeEqual};
  if(name==='@supabase/supabase-js')return {createClient(url,key){assert.equal(url,'https://gdpwqivdsjymivleruac.supabase.co');assert.equal(key,'mock-server-key');calls.push('client');return {};}};
  assert.equal(name,'@/lib/card-media-cleanup-server');return {async runCardMediaCleanup(db,limit){assert.equal(limit,5);calls.push('worker');if(throws)throw Error('sensitive failure');return {candidates:5,claimed:5,deleted:5,alreadyAbsent:0,skippedReferenced:0,failed:0,retried:0,staleInvalid:0,deferred:0,sessionsPruned:0,...result};}};
 }});
 const response=await exports.GET(new Request('https://example.test/api/internal/card-media-cleanup'+query,{headers:{authorization:auth}}));
 for(const log of logs)for(const value of [secret,'mock-server-key','sensitive failure'])assert(!log.includes(value));
 assert.equal(response.headers.get('cache-control'),'no-store');
 return {status:response.status,calls,logs};
}
for(const options of [{auth:''},{auth:'Bearer wrong'},{auth:'Bearer '+ 'y'.repeat(48)},{env:{CRON_SECRET:''}},{env:{CRON_SECRET:'short'}}]) {
 const r=await test(options);assert.equal(r.status,401);assert.deepEqual(r.calls,[]);
}
for(const env of [{VERCEL_ENV:'preview'},{NEXT_PUBLIC_SUPABASE_URL:'https://staging.supabase.co'},{SUPABASE_SERVICE_ROLE_KEY:''}]) {
 const r=await test({env});assert.equal(r.status,503);assert.deepEqual(r.calls,[]);
}
for(const query of ['?batch=50','?asset-id=anything']){const r=await test({query});assert.equal(r.status,400);assert.deepEqual(r.calls,[]);}
const ok=await test();assert.equal(ok.status,200);assert.deepEqual(ok.calls,['client','worker']);
for(const options of [{result:{failed:1}},{result:{staleInvalid:1}},{throws:true}]) {
 const r=await test(options);assert.equal(r.status,503);assert.deepEqual(r.calls,['client','worker']);assert.equal(r.logs.length,1);
}
assert.deepEqual(JSON.parse(fs.readFileSync('vercel.json','utf8')), {crons:[{path:'/api/internal/card-media-cleanup',schedule:'*/15 * * * *'}]}, 'Only the fixed reviewed schedule is allowed');
console.log('PASS: fail-closed secret/Production target checks; fixed five; no caller controls; one invocation/no retry loop; safe structured logs; no-store; exact 15-minute cron configuration.');

for(const url of ['https://gdpwqivdsjymivleruac.supabase.co','https://auth.dmicards.com']) {
 const r=await test({env:{NEXT_PUBLIC_SUPABASE_URL:url}});assert.equal(r.status,200);assert.deepEqual(r.calls,['client','worker']);
}
for(const url of [undefined,'','not a URL','https://other.example.com','https://uohdkewufeivdpaljnng.supabase.co',
 'http://auth.dmicards.com','https://auth.dmicards.com.evil.example','https://auth.dmicards.com@evil.example',
 'https://auth.dmicards.com/path','https://auth.dmicards.com?target=other',' https://auth.dmicards.com']) {
 const r=await test({env:{NEXT_PUBLIC_SUPABASE_URL:url}});assert.equal(r.status,503);assert.deepEqual(r.calls,[]);
}
console.log('PASS: only canonical Production and verified custom origin accepted; service client remains canonical; staging/arbitrary/malformed/missing URLs rejected before client creation.');
