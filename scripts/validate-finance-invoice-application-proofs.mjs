// Offline structure assertions or disposable native PostgreSQL on a private Unix socket.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const migration='supabase/migrations/20261010020000_finance_invoice_application_proofs.sql';
const sql=fs.readFileSync(migration,'utf8');
let checks=0;
const check=(name,fn)=>{fn();checks++;console.log('PASS '+name);};
check('unique migration timestamp',()=>assert.equal(fs.readdirSync('supabase/migrations').filter(n=>n.startsWith('20261010020000_')).length,1));
check('transaction and installation time bounds',()=>{assert.match(sql,/BEGIN;/);assert.match(sql,/lock_timeout = '5s'/);assert.match(sql,/statement_timeout = '60s'/);assert.ok(sql.trim().endsWith('COMMIT;'));});
check('additive and inactive',()=>assert.doesNotMatch(sql,/CREATE OR REPLACE|ALTER TABLE public\.(?!billing_finance_application_proofs)|billing_finance_transition\(|UPDATE public\.|DELETE FROM|INSERT INTO public\.(?!billing_finance_application_proofs)/));
check('append identity and source anchor',()=>{assert.match(sql,/PRIMARY KEY\(stripe_scope,stripe_invoice_id,certificate_revision\)/);assert.match(sql,/source_invoice_verified_at timestamptz NOT NULL/);assert.match(sql,/BEFORE UPDATE OR DELETE/);});
check('closed structure, 200 lines and 2 prices',()=>{assert.match(sql,/jsonb_array_length\(p_lines\)>200/);assert.match(sql,/jsonb_array_length\(p_refs\)>2/);assert.match(sql,/cardinality\(prices\)>2/);assert.match(sql,/65536/);assert.match(sql,/4096/);assert.match(sql,/73728/);assert.match(sql,/count\(DISTINCT value->>'line_id'\)/);});
check('no financial or foreign authority',()=>assert.doesNotMatch(sql,/PERFORM.*billing_finance_customer|billing_finance_complete_foreign\(|billing_finance_partition_command\(|billing_stripe_register_ownership\(/));
check('latest before proof state with no older fallback',()=>{assert.equal((sql.match(/ORDER BY certificate_revision DESC LIMIT 1/g)||[]).length,3);assert.ok(sql.indexOf('ORDER BY certificate_revision DESC LIMIT 1')<sql.indexOf("IF proof.state='unresolved'"));assert.doesNotMatch(sql,/WHERE.*state='proven'/);});
check('registry locks before invoice',()=>{const append=sql.split('CREATE FUNCTION public.billing_finance_invoice_proof_append')[1].split('CREATE FUNCTION public.billing_finance_invoice_proof_read')[0];assert.ok(append.indexOf('billing_stripe_applications')<append.indexOf('FROM public.billing_stripe_resource_ownership'));assert.ok(append.indexOf('FROM public.billing_stripe_resource_ownership')<append.indexOf('SELECT * INTO invoice'));assert.match(append,/FOR UPDATE/);});
check('runtime and previous migrations unchanged',()=>{assert.equal(execFileSync('git',['diff','--name-only','HEAD','--','src','supabase/migrations',':(exclude)src/lib/stripe/finance-contract.ts',':(exclude)src/lib/stripe/finance-customer-webhook.ts',':(exclude)src/lib/stripe/finance-store.ts',':(exclude)src/lib/stripe/webhook-consumers.ts',':(exclude)src/app/api/stripe/webhook/route.ts',':(exclude)src/middleware.ts',':(exclude)src/lib/stripe/billing-work-recovery.ts'],{encoding:'utf8'}),'');for(const file of execFileSync('git',['ls-files','src'],{encoding:'utf8'}).trim().split('\n'))assert.doesNotMatch(fs.readFileSync(file,'utf8'),/billing_finance_invoice_proof_|billing_finance_application_proofs/);});
console.log(`PASS invoice proof offline: ${checks}/${checks}`);
export async function validateInvoiceProofDatabase(client,connect){
 let total=0;
 const test=async(name,fn)=>{await fn();total++;console.log('PASS PostgreSQL '+name);};
 const scope='acct_fixture:test',invoice='in_proof';
 const before=(await client.query("SELECT oid::regprocedure::text signature,pg_get_functiondef(oid) definition FROM pg_proc WHERE pronamespace='public'::regnamespace ORDER BY signature")).rows;
 const protocolBefore=(await client.query('SELECT * FROM billing_finance_protocol_control')).rows;
 await client.query(sql);
 const input={proof_version:1,state:'proven',reason_code:null,customer:'cus_one',subscription:'sub_one',source_revision:1,source_verified_at:'2026-10-10T10:00:00Z',line_count:2,lines_complete:true,line_evidence:[{line_id:'il_one',price_id:'price_proof'},{line_id:'il_two',price_id:'price_proof'}],registry_proofs:[{price_id:'price_proof',application_key:'dmi_cards',revision:1}]};
 const unresolved={...input,state:'unresolved',reason_code:'incomplete_evidence',line_count:0,lines_complete:false,line_evidence:[],registry_proofs:[]};
 const append=(i=input,s=scope,id=invoice)=>client.query('SELECT billing_finance_invoice_proof_append($1,$2,$3) revision',[s,id,i]);
 const read=async()=> (await client.query('SELECT billing_finance_invoice_proof_read($1,$2) proof',[scope,invoice])).rows[0].proof;
 await client.query("INSERT INTO billing_invoices(stripe_scope,stripe_object_id,stripe_created_at,source_event_id,source_event_created_at,stripe_api_version,normalizer_version,verified_at,stripe_customer_id,stripe_subscription_id,status,collection_method,currency,subtotal_minor,discount_minor,tax_minor,total_minor,amount_due_minor,amount_paid_minor,amount_remaining_minor,attempt_count,payments_complete) VALUES($1,$2,'2026-10-10','evt_proof','2026-10-10','fixture',1,'2026-10-10 10:00:00Z','cus_one','sub_one','paid','charge_automatically','gbp',599,0,0,599,599,599,0,1,true)",[scope,invoice]);
 const register=async(id,app='dmi_cards')=>client.query("SELECT billing_stripe_register_ownership($1,'price',$2,$3,'price_owner','operator_review','review_proof','reviewed_operator_action')",[scope,id,app]);
 await register('price_proof');await register('price_two');await register('price_three');
 await test('valid certificate and exact latest read',async()=>{assert.equal((await append()).rows[0].revision,'1');const p=await read();assert.equal(p.state,'proven');assert.equal(p.line_count,2);assert.equal(p.source_event_id,'evt_proof');assert.equal(p.application_key,'dmi_cards');});
 for(const [name,change] of [
 ['customer',{customer:'BAD'}],['subscription',{subscription:'BAD'}],['cross customer',{customer:'cus_other'}],['source revision',{source_revision:2}],['source anchor',{source_verified_at:'2026-10-10T11:00:00Z'}],['malformed anchor',{source_verified_at:'BAD'}],
 ['extra input',{metadata:{secret:'synthetic'}}],['null lines',{line_evidence:null}],['line count',{line_count:3}],['incomplete',{lines_complete:false}],['extra line field',{line_evidence:[{line_id:'il_one',price_id:'price_proof',description:'synthetic'}]}],
 ['malformed line',{line_count:1,line_evidence:[{line_id:'BAD',price_id:'price_proof'}]}],['malformed price',{line_count:1,line_evidence:[{line_id:'il_one',price_id:'BAD'}]}],
 ['duplicate line',{line_evidence:[{line_id:'il_one',price_id:'price_proof'},{line_id:'il_one',price_id:'price_proof'}]}],['three prices',{line_count:3,line_evidence:['proof','two','three'].map((n,j)=>({line_id:'il_'+j,price_id:'price_'+n})),registry_proofs:['proof','two','three'].map(n=>({price_id:'price_'+n,application_key:'dmi_cards',revision:1}))}],
 ['over 200 lines',{line_count:201,line_evidence:Array.from({length:201},(_,n)=>({line_id:'il_'+n,price_id:'price_proof'}))}],
 ['oversized payload',{reason_code:'x'.repeat(74000)}],['missing refs',{registry_proofs:[]}],['unknown ref',{registry_proofs:[{price_id:'price_missing',application_key:'dmi_cards',revision:1}]}],
 ['mixed owner',{registry_proofs:[{price_id:'price_proof',application_key:'known_other',revision:1}]}],['stale revision',{registry_proofs:[{price_id:'price_proof',application_key:'dmi_cards',revision:2}]}],
 ['extra ref field',{registry_proofs:[{price_id:'price_proof',application_key:'dmi_cards',revision:1,payload:'synthetic'}]}],['duplicate refs',{registry_proofs:[input.registry_proofs[0],input.registry_proofs[0]]}],['unknown unresolved reason',{...unresolved,reason_code:'raw_error'}],['unresolved with proof',{...unresolved,registry_proofs:input.registry_proofs}]
 ])await test('reject '+name,()=>assert.rejects(append({...input,...change}),/APPLICATION_PROOF_/));
 await test('two distinct prices accepted',async()=>{await append({...input,line_evidence:[input.line_evidence[0],{line_id:'il_two',price_id:'price_two'}],registry_proofs:[...input.registry_proofs,{price_id:'price_two',application_key:'dmi_cards',revision:1}]});});
 await test('200 lines accepted',async()=>{await append({...input,line_count:200,line_evidence:Array.from({length:200},(_,n)=>({line_id:'il_'+n,price_id:'price_proof'}))});});
 await test('malformed scope and invoice rejected',async()=>{await assert.rejects(append(input,'BAD'),/APPLICATION_PROOF_INVALID/);await assert.rejects(append(input,scope,'BAD'),/APPLICATION_PROOF_INVALID/);assert.equal((await client.query("SELECT billing_finance_invoice_proof_read('BAD','BAD') p")).rows[0].p.reason_code,'malformed_evidence');});
 await test('source event constraint',async()=>{await assert.rejects(client.query("UPDATE billing_invoices SET source_event_id='BAD' WHERE stripe_scope=$1 AND stripe_object_id=$2",[scope,invoice]),/check constraint/);});
 await test('certificate constraints independently reject malformed identities',async()=>{
  for(const [column,value] of [['stripe_scope','BAD'],['stripe_invoice_id','BAD'],['stripe_customer_id','BAD'],['stripe_subscription_id','BAD'],['source_event_id','BAD']]){
   const fields=(await client.query("SELECT attname FROM pg_attribute WHERE attrelid='billing_finance_application_proofs'::regclass AND attnum>0 AND NOT attisdropped ORDER BY attnum")).rows.map(r=>r.attname);
   const projection=fields.map(n=>n===column?'$1':n==='certificate_revision'?'999':n).join(',');
   await assert.rejects(client.query('INSERT INTO billing_finance_application_proofs('+fields.join(',')+') SELECT '+projection+' FROM billing_finance_application_proofs LIMIT 1',[value]),/check constraint/);
  }
 });
 await test('subscription relationship mismatch rejected',async()=>{
  await client.query("UPDATE billing_invoices SET stripe_customer_id='cus_other' WHERE stripe_scope=$1 AND stripe_object_id=$2",[scope,invoice]);
  await assert.rejects(append({...input,customer:'cus_other'}),/APPLICATION_PROOF_SOURCE/);
  await client.query("UPDATE billing_invoices SET stripe_customer_id='cus_one' WHERE stripe_scope=$1 AND stripe_object_id=$2",[scope,invoice]);
 });
 await test('stored provenance changes invalidate proof',async()=>{
  await client.query("UPDATE billing_invoices SET source_event_id='evt_new' WHERE stripe_scope=$1 AND stripe_object_id=$2",[scope,invoice]);
  assert.equal((await read()).reason_code,'ownership_stale');
  await client.query("UPDATE billing_invoices SET source_event_id='evt_proof' WHERE stripe_scope=$1 AND stripe_object_id=$2",[scope,invoice]);
 });
 await test('actual foreign registry row rejected',async()=>{
  await client.query("INSERT INTO billing_stripe_applications(application_key) VALUES ('known_other')");await register('price_foreign','known_other');
  await assert.rejects(append({...input,line_count:1,line_evidence:[{line_id:'il_foreign',price_id:'price_foreign'}],registry_proofs:[{price_id:'price_foreign',application_key:'dmi_cards',revision:1}]}),/APPLICATION_PROOF_AUTHORITY/);
 });
 await test('append only even for owner',async()=>{await assert.rejects(client.query('UPDATE billing_finance_application_proofs SET proof_version=1'),/APPLICATION_PROOF_IMMUTABLE/);await assert.rejects(client.query('DELETE FROM billing_finance_application_proofs'),/APPLICATION_PROOF_IMMUTABLE/);});
 await test('latest unresolved prevents fallback',async()=>{const n=(await append(unresolved)).rows[0].revision;const p=await read();assert.equal(p.state,'unresolved');assert.equal(String(p.certificate_revision),n);assert.equal(p.reason_code,'incomplete_evidence');});
 await test('stale source revision rejected on read',async()=>{await append();await client.query('UPDATE billing_invoices SET revision=revision+1 WHERE stripe_scope=$1 AND stripe_object_id=$2',[scope,invoice]);assert.equal((await read()).reason_code,'ownership_stale');await client.query('UPDATE billing_invoices SET revision=1 WHERE stripe_scope=$1 AND stripe_object_id=$2',[scope,invoice]);});
 await test('unchanged revision with new verification anchor rejected',async()=>{await client.query("UPDATE billing_invoices SET verified_at=verified_at+interval '1 second' WHERE stripe_scope=$1 AND stripe_object_id=$2",[scope,invoice]);assert.equal((await read()).reason_code,'ownership_stale');await client.query("UPDATE billing_invoices SET verified_at='2026-10-10 10:00:00Z' WHERE stripe_scope=$1 AND stripe_object_id=$2",[scope,invoice]);});
 await test('inactive application invalidates read and append',async()=>{await client.query("UPDATE billing_stripe_applications SET state='revoked' WHERE application_key='dmi_cards'");assert.equal((await read()).reason_code,'ownership_stale');await assert.rejects(append(),/APPLICATION_PROOF_AUTHORITY/);await client.query("UPDATE billing_stripe_applications SET state='active' WHERE application_key='dmi_cards'");});
 await test('concurrent certificate revisions serialize',async()=>{
  const a=connect(),b=connect();await a.connect();await b.connect();
  try{await a.query('BEGIN');const x=(await a.query('SELECT billing_finance_invoice_proof_append($1,$2,$3) n',[scope,invoice,input])).rows[0].n;
   let done=false;const pending=b.query('SELECT billing_finance_invoice_proof_append($1,$2,$3) n',[scope,invoice,unresolved]).then(r=>{done=true;return r;});
   await new Promise(r=>setTimeout(r,50));assert.equal(done,false);await a.query('COMMIT');const y=(await pending).rows[0].n;assert.equal(BigInt(y),BigInt(x)+1n);assert.equal((await read()).state,'unresolved');
  }finally{await a.query('ROLLBACK');await a.end();await b.end();}
 });
 await test('append authority locks serialize concurrent revocation',async()=>{
  const a=connect(),b=connect();await a.connect();await b.connect();
  try{
   await register('price_race');const evidence={...input,line_count:1,line_evidence:[{line_id:'il_race',price_id:'price_race'}],registry_proofs:[{price_id:'price_race',application_key:'dmi_cards',revision:1}]};
   await a.query('BEGIN');await a.query('SELECT billing_finance_invoice_proof_append($1,$2,$3)',[scope,invoice,evidence]);
   let done=false;const pending=b.query("SELECT billing_stripe_revoke_ownership($1,'price','price_race',1,'review_race','reviewed_operator_action')",[scope]).then(r=>{done=true;return r;});
   await new Promise(r=>setTimeout(r,50));assert.equal(done,false);await a.query('COMMIT');await pending;
   assert.equal((await read()).reason_code,'ownership_stale');
  }finally{await a.query('ROLLBACK');await a.end();await b.end();}
 });
 await test('revoked registry proof invalidates current and historical proof',async()=>{await append();await client.query("SELECT billing_stripe_revoke_ownership($1,'price','price_proof',1,'review_revoke','reviewed_operator_action')",[scope]);assert.equal((await read()).reason_code,'ownership_stale');await assert.rejects(append(),/APPLICATION_PROOF_AUTHORITY/);});
 await test('RLS and role ACLs',async()=>{
  assert.equal((await client.query("SELECT relrowsecurity r FROM pg_class WHERE oid='billing_finance_application_proofs'::regclass")).rows[0].r,true);
  for(const role of ['anon','authenticated','service_role']){
   for(const priv of ['SELECT','INSERT','UPDATE','DELETE'])assert.equal((await client.query("SELECT has_table_privilege($1,'billing_finance_application_proofs',$2) allowed",[role,priv])).rows[0].allowed,false);
   for(const [fn,sig,allowed] of [['append','text,text,jsonb',false],['read','text,text',role==='service_role'],['shape','text,text,boolean,integer,jsonb,jsonb',false],['guard','',false]])assert.equal((await client.query("SELECT has_function_privilege($1,$2,'EXECUTE') allowed",[role,'billing_finance_invoice_proof_'+fn+'('+sig+')'])).rows[0].allowed,allowed);
   await client.query('SET ROLE '+role);await assert.rejects(client.query('SELECT * FROM billing_finance_application_proofs'),/permission denied/);await assert.rejects(client.query('INSERT INTO billing_finance_application_proofs DEFAULT VALUES'),/permission denied/);await assert.rejects(client.query('UPDATE billing_finance_application_proofs SET proof_version=1'),/permission denied/);await assert.rejects(client.query('DELETE FROM billing_finance_application_proofs'),/permission denied/);await assert.rejects(append(unresolved),/permission denied/);
   if(role==='service_role')assert.equal((await read()).state,'unresolved');else await assert.rejects(read(),/permission denied/);await client.query('RESET ROLE');
  }
 });
 await test('definer search path and no PUBLIC execute',async()=>{const rows=(await client.query("SELECT proname,prosecdef,proconfig,proacl::text[] proacl FROM pg_proc WHERE proname LIKE 'billing_finance_invoice_proof_%'")).rows;assert.equal(rows.length,4);for(const row of rows){assert.ok(row.proconfig.includes('search_path=pg_catalog, public'));assert.equal(row.prosecdef,['billing_finance_invoice_proof_append','billing_finance_invoice_proof_read'].includes(row.proname));assert.ok(!row.proacl.some(a=>a.startsWith('=')));}});
 await test('append rollback leaves no certificate',async()=>{const before=(await client.query('SELECT count(*)::int n FROM billing_finance_application_proofs')).rows[0].n;await client.query('BEGIN');await append(unresolved);await assert.rejects(append(input),/APPLICATION_PROOF_AUTHORITY/);await client.query('ROLLBACK');assert.equal((await client.query('SELECT count(*)::int n FROM billing_finance_application_proofs')).rows[0].n,before);});
 await test('all preexisting functions and protocol unchanged',async()=>{for(const f of before)assert.equal((await client.query('SELECT pg_get_functiondef($1::regprocedure) d',[f.signature])).rows[0].d,f.definition);assert.deepEqual((await client.query('SELECT * FROM billing_finance_protocol_control')).rows,protocolBefore);assert.equal((await client.query('SELECT count(*)::int n FROM billing_finance_sync_state WHERE lease_token IS NOT NULL')).rows[0].n,0);assert.equal((await client.query("SELECT count(*)::int n FROM billing_finance_application_proofs WHERE stripe_scope LIKE '%:live'")).rows[0].n,0);assert.equal((await client.query("SELECT count(*)::int n FROM billing_stripe_resource_ownership WHERE resource_type='customer'")).rows[0].n,0);});
 await test('failed reinstall transaction preserves certificate history',async()=>{
  const count=(await client.query('SELECT count(*)::int n FROM billing_finance_application_proofs')).rows[0].n;
  await assert.rejects(client.query(sql),/already exists/);await client.query('ROLLBACK');
  assert.equal((await client.query('SELECT count(*)::int n FROM billing_finance_application_proofs')).rows[0].n,count);
 });
 console.log(`PASS invoice certificate PostgreSQL: ${total}/${total}`);
}
if(process.argv[2]==='--postgres'){
 const [bin,pg]=process.argv.slice(3);assert.ok(bin&&pg&&path.isAbsolute(bin)&&path.isAbsolute(pg));
 let runner=fs.readFileSync('scripts/validate-finance-postgres.mjs','utf8').replace("'./validate-finance-writer.mjs'",JSON.stringify(path.resolve('scripts/validate-finance-writer.mjs')));
 runner='import {validateInvoiceProofDatabase} from '+JSON.stringify(path.resolve('scripts/validate-finance-invoice-application-proofs.mjs'))+';\n'+runner;
 const setup=`
 const installed=new Set(await Promise.all(['20260930130000_finance_v1_writer.sql','20261003120000_finance_tax_evidence.sql'].map(n=>fs.readFile('supabase/migrations/'+n,'utf8'))));
 for(const text of installed)await client.query(text);
 for(const name of ['20261009180000_finance_partition_foundation.sql','20261009200000_finance_legacy_protocol_gate.sql','20261009210000_finance_customer_commit_foundation.sql','20261009220000_finance_reconciliation_protocol_guard.sql','20261009230000_finance_protocol_transitions.sql','20261010000000_stripe_application_ownership_registry.sql','20261010010000_finance_foreign_receipt_completion.sql'])await client.query(await fs.readFile('supabase/migrations/'+name,'utf8'));
 await validateInvoiceProofDatabase(client,()=>new Client({host:socket,port:5432,user:'fixture',database:'postgres'}));
 await validateWriter({query:(q,args)=>installed.has(q)?Promise.resolve({rows:[]}):client.query(q,args)});
 `;
 assert.ok(runner.includes(' await validateWriter(client);'));
 runner=runner.replace(' await validateWriter(client);',setup).replace('await fs.rm(temp,{recursive:true,force:true});}',"await fs.rm(temp,{recursive:true,force:true});console.log('CLEANUP: temporary PostgreSQL stopped and removed');}");
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'dmi-invoice-proof-runner-'));try{const entry=path.join(temp,'runner.mjs');fs.writeFileSync(entry,runner);execFileSync(process.execPath,[entry,bin,pg],{stdio:'inherit'});}finally{fs.rmSync(temp,{recursive:true,force:true});}
}
