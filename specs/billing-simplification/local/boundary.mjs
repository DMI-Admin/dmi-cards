import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
export function verifyBoundary(){
 const manifest=JSON.parse(fs.readFileSync('specs/billing-simplification/local/implementation.json','utf8'));
 execFileSync('git',['merge-base','--is-ancestor',manifest.specification_commit,'HEAD']);
 const baseline=JSON.parse(fs.readFileSync('specs/billing-simplification/phase1/baseline.json','utf8'));
 const hash=f=>createHash('sha256').update(fs.readFileSync(f)).digest('hex');
 for(const [f,h]of Object.entries(baseline.sha256))assert.equal(hash(f),h,'Legacy runtime changed: '+f);
 for(const [f,h]of Object.entries(manifest.sha256))assert.equal(hash(f),h,'V2 implementation drift: '+f);
 function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);}
 for(const f of [...walk('src'),...walk('supabase/migrations')])assert.ok(Object.hasOwn(baseline.sha256,f)||Object.hasOwn(manifest.sha256,f),'Unreviewed runtime/migration: '+f);
 for(const f of Object.keys(baseline.sha256).filter(f=>f.startsWith('src/')&&/\.[jt]sx?$/.test(f)))assert.doesNotMatch(fs.readFileSync(f,'utf8'),/billing-v2|billing_v2|billing-simplification/,'Legacy runtime reached V2: '+f);
 for(const f of Object.keys(baseline.sha256).filter(f=>f.startsWith('supabase/')))assert.doesNotMatch(fs.readFileSync(f,'utf8'),/billing_v2/);
 for(const f of manifest.sources){const source=fs.readFileSync(f,'utf8');assert.doesNotMatch(source,/from ["'](?:stripe|next|@supabase|@\/lib\/stripe|@\/lib\/supabase)|\bfetch\s*\(|process\.env|createSupabase|executeBillingWorker|runAutomaticBillingWork/,'V2 gained live capability: '+f);assert.doesNotMatch(source,/specs\/|public\.billing/);}
 const allowed=new Set([...Object.keys(manifest.sha256),...manifest.specification_edits,...manifest.local_files]);
 for(const mode of [['diff','--name-only','HEAD'],['ls-files','--others','--exclude-standard']]){for(const f of execFileSync('git',mode,{encoding:'utf8'}).trim().split('\n').filter(Boolean))assert.ok(allowed.has(f),'Unrelated change: '+f);}
 return manifest;
}
