// Manual backend runner only. No schedule is installed. No automatic dotenv loading.
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createClient } from '@supabase/supabase-js';
const args = process.argv.slice(2);
// Reject malformed/duplicate options rather than silently falling back to batch mode.
const names = args.map(a => a.split('=')[0]);
if (new Set(names).size !== names.length || args.some(a =>
  a !== '--execute' && !/^--(project-ref|batch|asset-id)=[^=]+$/.test(a))) {
  throw Error('Invalid cleanup arguments. No connection opened.');
}
const assetId = args.find(a => a.startsWith('--asset-id='))?.slice(11);
if (assetId !== undefined && (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(assetId)
  || names.includes('--batch'))) throw Error('Exact mode requires one UUID and no --batch. No connection opened.');
const ref = args.find(a => a.startsWith('--project-ref='))?.slice(14);
const batch = Number(args.find(a => a.startsWith('--batch='))?.slice(8) ?? (assetId === undefined ? 20 : 1));
if (!args.includes('--execute') || !ref || !/^[a-z0-9]+$/.test(ref)) {
  throw Error('Explicit --execute --project-ref=<approved-project-ref> required. No connection opened.');
}
let url;
try { url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || ''); }
catch { throw Error('Invalid target URL. No connection opened.'); }
if (url.protocol !== 'https:' || url.hostname !== `${ref}.supabase.co` || url.username || url.password) {
  throw Error('Target project mismatch. No connection opened.');
}
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!key || !Number.isInteger(batch) || batch<1 || batch>50) throw Error('Missing server credential or invalid batch.');
// Bound every network call. Never race a write Promise against a timer and forget it.
const database = createClient(url.origin, key, { auth: { persistSession:false, autoRefreshToken:false },
  global: { fetch: (input, init={}) => fetch(input, { ...init, signal: init.signal
    ? AbortSignal.any([init.signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000) }) } });
// Use the same TypeScript worker without adding a runtime dependency or HTTP endpoint.
const exports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../src/lib/card-media-cleanup-server.ts',import.meta.url),'utf8'),
  {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
  {exports, Date, require(name) { if(name==='server-only') return {}; throw Error('Unexpected cleanup dependency'); }});
try {
  const counts = await exports.runCardMediaCleanup(database,batch,assetId);
  console.log(JSON.stringify({ mode: assetId === undefined ? 'batch' : 'exact', ...(assetId ? {assetId} : {}), ...counts }));
  if (assetId !== undefined && (counts.deleted + counts.alreadyAbsent !== 1 || counts.failed
    || counts.staleInvalid || counts.deferred || counts.skippedReferenced || counts.sessionsPruned)) process.exitCode=1;
}
catch { console.error('Cleanup stopped: target/security preflight or coordination failed. No credentials logged.'); process.exitCode=1; }
