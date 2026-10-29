// Offline fixtures only: no credentials, network or database.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {load} from '../local/load.mjs';
import {verifyBoundary} from '../local/boundary.mjs';
import {checksum,exportFixture} from './export-fixtures.mjs';
verifyBoundary();const adapter=load('src/lib/billing-v2/tooling/frozen-export.ts');let n=0;
const test=async(name,fn)=>{await fn();n++;console.log('PASS '+name);};
const encode=v=>JSON.stringify(v);
async function prepare(value){const text=encode(value);return adapter.prepareFrozenExport(text,checksum(text));}
async function bad(mutate,pattern=/V2_EXPORT_/){const v=exportFixture();mutate(v[0].frozen_access_source);await assert.rejects(prepare(v),pattern);}
await test('valid exact one-row SQL Editor JSON export prepares existing seed contract',async()=>{const r=await prepare(exportFixture());assert.deepEqual(JSON.parse(JSON.stringify(r.prepared.manifest.counts)),{accounts:1,price_catalog:1,subscriptions:1});});
await test('JSON-valued cell and JSON-string-valued cell are both accepted',async()=>{const v=exportFixture();v[0].frozen_access_source=encode(v[0].frozen_access_source);assert.equal((await prepare(v)).prepared.manifest.counts.subscriptions,1);});
await test('all six datasets are mandatory',async()=>{for(const k of ['billing_accounts','billing_approved_prices','billing_subscriptions','billing_stripe_resource_ownership','billing_stripe_applications','price_items'])await bad(e=>delete e[k]);});
await test('extra datasets, metadata and row fields reject',async()=>{await bad(e=>e.secret='synthetic');await bad(e=>e.billing_accounts[0].metadata={});});
await test('wrong scope in envelope or any scoped row rejects',async()=>{await bad(e=>e.scope='acct_other:test');await bad(e=>e.billing_accounts[0].stripe_scope='acct_other:test');});
await test('duplicate account identity and conflicting customer bindings reject',async()=>{await bad(e=>e.billing_accounts.push({...e.billing_accounts[0]}),/DUPLICATE/);await bad(e=>e.billing_accounts.push({...e.billing_accounts[0],user_id:'22222222-2222-4222-8222-222222222222'}),/DUPLICATE/);});
await test('subscription customer mismatch rejects',async()=>{await bad(e=>e.billing_subscriptions[0].stripe_customer_id='cus_foreign',/BINDING/);});
await test('missing and malformed canonical sync snapshots reject',async()=>{await bad(e=>e.billing_subscriptions[0].sync_snapshot=null);await bad(e=>e.billing_subscriptions[0].sync_snapshot={});await bad(e=>e.billing_subscriptions[0].sync_snapshot.cancel_at_period_end='false');});
await test('canonical identity, terminality and Pro policy remain authoritative',async()=>{await bad(e=>e.billing_subscriptions[0].sync_snapshot.subscription_id='sub_other');await bad(e=>e.billing_subscriptions[0].sync_snapshot.terminal=true);await bad(e=>e.billing_subscriptions[0].sync_snapshot.plan='free');await bad(e=>e.billing_approved_prices[0].entitlement_enabled=false);});
await test('verification timestamp alone, synthetic verified flag and zero revision are insufficient',async()=>{await bad(e=>e.billing_subscriptions[0].verified_at=null);await bad(e=>e.billing_subscriptions[0].revision='0');await bad(e=>e.billing_subscriptions[0].verified=true);await bad(e=>e.billing_subscriptions[0].sync_snapshot=null);});
await test('physical status plan price and terminal disagreement reject canonical import',async()=>{await bad(e=>e.billing_subscriptions[0].stripe_subscription_status='past_due');await bad(e=>e.billing_subscriptions[0].dmi_plan='free');await bad(e=>e.billing_subscriptions[0].stripe_price_id='price_other');await bad(e=>e.billing_subscriptions[0].terminal=true);});
await test('equivalent timestamp instants agree while conflicting periods reject',async()=>{const v=exportFixture(),r=v[0].frozen_access_source.billing_subscriptions[0];r.current_period_end='2026-12-01T00:00:00+00:00';r.sync_snapshot.period_end='2026-12-01T00:00:00.000Z';assert.equal((await prepare(v)).prepared.manifest.counts.subscriptions,1);await bad(e=>e.billing_subscriptions[0].current_period_end='2026-12-01T00:00:00Z');});
await test('verification refresh preserves verified_at independently of updated_at',async()=>{const v=exportFixture();v[0].frozen_access_source.captured_at='2026-10-28T10:00:00Z';v[0].frozen_access_source.billing_subscriptions[0].verified_at='2026-10-28T09:01:00.000Z';const prepared=(await prepare(v)).prepared;assert.equal(prepared.pages.flatMap(p=>p.rows).find(r=>r.table==='subscriptions').row.verified_at,'2026-10-28T09:01:00.000Z');});
await test('persisted canceled terminal snapshot is retained without granting Pro',async()=>{const v=exportFixture(),r=v[0].frozen_access_source.billing_subscriptions[0];r.stripe_subscription_status='canceled';r.dmi_plan='free';r.terminal=true;Object.assign(r.sync_snapshot,{status:'canceled',plan:'free',terminal:true});const prepared=(await prepare(v)).prepared;assert.equal(prepared.pages.flatMap(p=>p.rows).find(r=>r.table==='subscriptions').row.terminal,true);});
await test('ownership revision duplicates and malformed revision reject',async()=>{await bad(e=>e.billing_stripe_resource_ownership.push({...e.billing_stripe_resource_ownership[0],revision:'4'}));await bad(e=>e.billing_stripe_resource_ownership[0].revision='0');});
await test('revoked, foreign application and missing catalog ownership reject',async()=>{await bad(e=>e.billing_stripe_resource_ownership[0].state='revoked');await bad(e=>e.billing_stripe_resource_ownership[0].application_key='other');await bad(e=>e.billing_stripe_resource_ownership=[]);});
await test('missing and ambiguous product or interval facts reject',async()=>{await bad(e=>e.price_items=[]);await bad(e=>e.price_items.push({...e.price_items[0],stripe_product_id:'prod_other'}));await bad(e=>e.price_items[0].interval_count=2);await bad(e=>e.price_items[0].stripe_product_id=null);});
await test('nonzero and malformed screening counts reject',async()=>{await bad(e=>e.checks.unverified_accounts=1);await bad(e=>e.checks.unverified_accounts='0');});
await test('checksum mismatch detects byte tampering',async()=>{const text=encode(exportFixture());await assert.rejects(adapter.prepareFrozenExport(text+' ',checksum(text)),/CHECKSUM_MISMATCH/);});
await test('independently recorded SHA256 is mandatory',async()=>{await assert.rejects(adapter.prepareFrozenExport(encode(exportFixture()),''),/CHECKSUM_REQUIRED/);});
await test('duplicate JSON keys reject even when file checksum matches',async()=>{const text=encode(exportFixture()).replace('"scope":','"scope":"ignored","scope":');await assert.rejects(adapter.prepareFrozenExport(text,checksum(text)),/DUPLICATE_KEY/);});
await test('zero/multiple rows and malformed JSON reject without leaking source',async()=>{for(const text of ['[]','[{},{}]','{"password":"SYNTHETIC_PRIVATE"'])await assert.rejects(adapter.prepareFrozenExport(text,checksum(text)),e=>/^V2_EXPORT_/.test(e.message)&&!e.message.includes('SYNTHETIC_PRIVATE'));});
await test('unsafe numeric revisions and invalid timestamps reject',async()=>{await bad(e=>e.billing_subscriptions[0].revision=9007199254740992);await bad(e=>e.billing_accounts[0].verified_at='2026-02-30T00:00:00Z');});
await test('multiple nonterminal subscriptions cannot choose an arbitrary entitlement',async()=>{await bad(e=>e.billing_subscriptions.push({...e.billing_subscriptions[0],stripe_subscription_id:'sub_other',sync_snapshot:{...e.billing_subscriptions[0].sync_snapshot,subscription_id:'sub_other'}}),/AMBIGUOUS_SUBSCRIPTION/);});
await test('empty access baseline with approved catalog is valid, missing catalog is not',async()=>{const v=exportFixture();v[0].frozen_access_source.billing_accounts=[];v[0].frozen_access_source.billing_subscriptions=[];assert.equal((await prepare(v)).prepared.manifest.counts.accounts,0);await bad(e=>e.billing_approved_prices=[]);});
await test('same frozen bytes produce identical normalized digests and manifests',async()=>{const text=encode(exportFixture()),before=text;const a=await adapter.prepareFrozenExport(text,checksum(text)),b=await adapter.prepareFrozenExport(text,checksum(text));assert.equal(text,before);assert.equal(encode(a),encode(b));});
await test('only isolated operator dependencies; no network, provider or filesystem in adapter',async()=>{const source=fs.readFileSync('src/lib/billing-v2/tooling/frozen-export.ts','utf8');assert.doesNotMatch(source,/node:fs|process\.env|fetch\s*\(|new Client|new Stripe|createClient/);});
if(process.argv.length>2){
 const [bin,driver]=process.argv.slice(2);assert.ok(path.isAbsolute(bin)&&path.isAbsolute(driver));const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dmi-frozen-fixture-'));
 try{
  const file=path.join(dir,'fixture.json'),text=encode(exportFixture());fs.writeFileSync(file,text,{mode:0o600});const before=fs.statSync(file).mtimeMs;
  const cli=(f=file,sha=checksum(text))=>{const r=spawnSync(process.execPath,['specs/billing-simplification/shadow/validate-export.mjs',f,sha,bin,driver],{encoding:'utf8',timeout:180000});assert.doesNotMatch(r.stdout,/cus_fixture|sub_fixture|11111111-1111|password|client_secret/);return {status:r.status,body:JSON.parse(r.stdout)};};
  let result;
  await test('file CLI validates synthetic export using disposable PostgreSQL only',async()=>{result=cli();assert.equal(result.status,0);assert.equal(result.body.typedRowsVerified,true);assert.equal(result.body.executionEnabled,false);assert.equal(result.body.counts.subscriptions,1);});
  await test('file CLI re-import is deterministic and original bytes/mtime stay unchanged',async()=>{const again=cli();assert.deepEqual(again,result);assert.equal(fs.readFileSync(file,'utf8'),text);assert.equal(fs.statSync(file).mtimeMs,before);});
  await test('file CLI rejects tampering without exposing source or attempting import',async()=>{const tampered=path.join(dir,'tampered.json');fs.writeFileSync(tampered,text+' ');const r=cli(tampered);assert.equal(r.status,1);assert.equal(r.body.reason,'V2_EXPORT_CHECKSUM_MISMATCH');});
  await test('file CLI rejects repository files and malformed private JSON safely',async()=>{const internal=cli(path.resolve('specs/billing-simplification/shadow/README.md'));assert.equal(internal.body.reason,'V2_EXPORT_FILE');const invalid=path.join(dir,'invalid.json');const privateText='{"password":"SYNTHETIC_PRIVATE"';fs.writeFileSync(invalid,privateText);const r=cli(invalid,checksum(privateText));assert.equal(r.status,1);assert.equal(r.body.reason,'V2_EXPORT_JSON');});
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
console.log(`Frozen export offline ${n}/${n}`);
