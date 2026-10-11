// Offline or disposable Unix-socket PostgreSQL only. No hosted URL accepted.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {execFileSync} from 'node:child_process';
const migration='supabase/migrations/20261010000000_stripe_application_ownership_registry.sql';
const sql=fs.readFileSync(migration,'utf8');
function load(name,deps={}){const source=fs.readFileSync('src/lib/stripe/'+name+'.ts','utf8');const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const exports={};vm.runInNewContext(output,{exports,require:n=>n==='server-only'?{}:deps[n],AbortController,setTimeout,clearTimeout,performance});return exports;}
const classifier=load('finance-application-ownership');
const adapter=load('finance-application-ownership-adapter',{'./finance-application-ownership':classifier,'./finance-customer-relationships':{RELATIONSHIP_DEADLINE_MS:15}});
const scope='acct_fixture:test',key=(type,id)=>({scope,type,id});
const own=(k,application='dmi_cards',extra={})=>({...k,application,basis:k.type==='price'?'price_owner':'exclusive_customer',provenance:'operator_review',revision:1,state:'active',applicationActive:true,...extra});
const p=key('price','price_one'),q=key('price','price_two'),c=key('customer','cus_one');
const sub={scope,id:'sub_one',kind:'subscription',complete:true,prices:[p]},classify=(e,r,expected=[])=>classifier.classifyFinanceApplication(scope,e,r,expected).state;
assert.equal(classify({...sub,prices:[p,q]},[own(p),own(q)]),'dmi');assert.equal(classify(sub,[own(p)]),'dmi');assert.equal(classify(sub,[own(p,'known_other')]),'foreign');
assert.equal(classify({...sub,prices:[p,q]},[own(p),own(q,'known_other')]),'conflict');
assert.equal(classify({...sub,prices:[p,q]},[own(p)]),'unresolved');
assert.equal(classify(sub,[]),'unresolved');assert.equal(classify({...sub,metadata:{dmi_app:'other'}},[]),'unresolved');
assert.equal(classify({...sub,complete:false},[own(p,'known_other')]),'unresolved');
assert.equal(classify({scope,id:'in_one',kind:'invoice',complete:false,customer:c},[own(c,'known_other')]),'unresolved');
assert.equal(classify({scope,id:'ch_one',kind:'charge',complete:true,customer:c},[own(c,'known_other')]),'foreign');
assert.equal(classify({scope,id:'ch_one',kind:'charge',complete:true,customer:c},[]),'unresolved');
assert.equal(classify({scope,id:'ch_one',kind:'charge',complete:true,customer:c},[own(c,'known_other',{basis:'shared_customer'})]),'unresolved');
const charge={scope,id:'ch_one',kind:'charge',complete:true,customer:c},refund={scope,id:'re_one',kind:'refund',complete:true,relationships:['ch_one'],dependencies:[charge]};
assert.equal(classify(refund,[own(c,'known_other')]),'foreign');
const invoice={scope,id:'in_one',kind:'invoice',complete:true,customer:c};
const allocation={scope,id:'inpay_one',kind:'allocation',complete:true,relationships:['in_one'],dependencies:[invoice]};
assert.equal(classify({scope,id:'ch_one',kind:'charge',complete:true,relationships:['inpay_one'],dependencies:[allocation]},[own(c,'known_other')]),'foreign');
assert.equal(classify({scope,id:'in_one',kind:'invoice',complete:true,relationships:['sub_one'],dependencies:[sub]},[own(p)]),'dmi');
assert.equal(classify({scope,id:'ch_one',kind:'charge',complete:true,relationships:['in_one'],dependencies:[{scope,id:'in_one',kind:'invoice',complete:true,relationships:['sub_one'],dependencies:[sub]}]},[own(p)]),'dmi');
assert.equal(classify({scope,id:'re_one',kind:'refund',complete:true,relationships:['ch_one'],dependencies:[{scope,id:'ch_one',kind:'charge',complete:true,relationships:['in_one'],dependencies:[{scope,id:'in_one',kind:'invoice',complete:true,relationships:['sub_one'],dependencies:[sub]}]}]},[own(p,'known_other')]),'unresolved');
assert.equal(classify({...sub,id:'SECRET'},[own(p)]),'unresolved');
assert.equal(classify({scope,id:'in_one',kind:'invoice',complete:true,relationships:['sub_other'],dependencies:[sub]},[own(p)]),'unresolved');
assert.equal(classify({scope,id:'in_one',kind:'invoice',complete:true,customer:key('customer','cus_other'),relationships:['sub_one'],dependencies:[{...sub,customer:c}]},[own(p),own(c)]),'conflict');
for(const changed of [{state:'revoked'},{applicationActive:false},{scope:'acct_fixture:live'},{id:'price_wrong'},{provenance:'metadata'}])assert.equal(classify(sub,[own(p,'known_other',changed)]),'unresolved');
assert.equal(classify(sub,[own(p)], [{key:p,revision:2}]),'unresolved');
assert.equal(classify(sub,[own(p)], [{key:p,revision:1}]),'dmi');
assert.equal(classify({...sub,prices:[key('price','BAD_SECRET')]},[own(p)]),'unresolved');
assert.equal(classify(sub,[own(p),own(p,'known_other')]),'unresolved');
const dbFixture=(read)=>{const calls=[];return {calls,db:{from(table){assert.equal(table,'billing_stripe_resource_ownership');const request={};return {select(columns){assert.ok(!columns.includes('*'));request.columns=columns;return this;},eq(k,v){request[k]=v;return this;},abortSignal(signal){request.signal=signal;return this;},maybeSingle(){calls.push(request);return read(request);}};}}};};
const row=k=>({stripe_scope:k.scope,resource_type:k.type,stripe_resource_id:k.id,application_key:'known_other',ownership_basis:'price_owner',provenance:'operator_review',revision:1,state:'active',billing_stripe_applications:{state:'active'}});
{
 const h=dbFixture(async r=>({data:row(key(r.resource_type,r.stripe_resource_id)),error:null}));const result=await adapter.readFinanceOwnership(h.db,[p,q]);assert.equal(result.state,'read');assert.equal(h.calls.length,2);assert.equal(classify({...sub,prices:[p,q]},result.records),'foreign');
 assert.equal((await adapter.readFinanceOwnership(h.db,[p,q,c])).reason,'invalid_evidence');assert.equal(h.calls.length,2);
}
{
 const h=dbFixture(async()=>{throw Error('SECRET_ID_PAYLOAD');});const result=await adapter.readFinanceOwnership(h.db,[p]);assert.equal(result.reason,'lookup_unavailable');assert.doesNotMatch(JSON.stringify(result),/SECRET|price_|cus_/);
}
for(const cancel of [false,true]){
 let late;const h=dbFixture(()=>new Promise(resolve=>{late=()=>resolve({data:row(p),error:null});}));const controller=new AbortController();const pending=adapter.readFinanceOwnership(h.db,[p,q],{signal:controller.signal});if(cancel)controller.abort();const result=await pending;assert.equal(result.reason,cancel?'lookup_cancelled_ambiguous':'lookup_timeout_ambiguous');late();await new Promise(r=>setTimeout(r,0));assert.equal(h.calls.length,1);
}
for(const name of ['finance-application-ownership','finance-application-ownership-adapter','finance-charge-ownership-proof'])assert.doesNotMatch(fs.readFileSync('src/lib/stripe/'+name+'.ts','utf8'),/console\.|\.rpc\(|\.insert\(|\.update\(|\.delete\(|stripe\./);
assert.equal(execFileSync('git',['diff','--name-only','HEAD','--','src',':(exclude)src/lib/stripe/finance-contract.ts',':(exclude)src/lib/stripe/finance-customer-webhook.ts',':(exclude)src/lib/stripe/finance-store.ts',':(exclude)src/lib/stripe/webhook-consumers.ts',':(exclude)src/lib/stripe/webhook-observer.ts','supabase/migrations',':(exclude)src/app/api/stripe/webhook/route.ts',':(exclude)src/middleware.ts',':(exclude)src/lib/stripe/billing-work-recovery.ts',':(exclude)src/lib/stripe/billing-work-runtime.ts',':(exclude)src/lib/stripe/billing-work-store.ts',':(exclude)src/lib/stripe/billing-work-worker.ts'],{encoding:'utf8'}),'','Tracked runtime and prior migrations unchanged');
for(const file of execFileSync('git',['ls-files','src'],{encoding:'utf8'}).trim().split('\n').filter(f=>!f.endsWith('/finance-foreign-event.ts')&&!f.endsWith('/finance-application-ownership-adapter.ts')&&!f.endsWith('/finance-charge-ownership-proof.ts')))assert.doesNotMatch(fs.readFileSync(file,'utf8'),/from ["']\.\/finance-application-ownership|billing_stripe_register_ownership|billing_stripe_revoke_ownership/);
assert.equal(fs.readdirSync('supabase/migrations').filter(n=>n.startsWith('20261010000000_')).length,1);
assert.ok(sql.startsWith('-- Inactive'));assert.ok(sql.trim().endsWith('COMMIT;'));assert.doesNotMatch(sql,/DELETE FROM|DROP TABLE|ALTER TABLE public\.billing_finance|billing_finance_partition_command/);
console.log('PASS ownership classifier/adapter: positive DMI/foreign, unknown/conflict, complete indirect proof, exclusive customer, revocation/stale/scope isolation, two-read/depth bounds, timeout/late-response, no runtime integration/provider/mutation/logging');
export async function validateOwnershipDatabase(client){
 await client.query(sql);
 const reg=(type,id,app='dmi_cards',provenance='operator_review',review='review_fixture')=>client.query('SELECT billing_stripe_register_ownership($1,$2,$3,$4,$5,$6,$7,$8) r',[scope,type,id,app,type==='price'?'price_owner':'exclusive_customer',provenance,review,'reviewed_operator_action']);
 await client.query("INSERT INTO billing_stripe_applications(application_key) VALUES ('known_other')");
 assert.equal((await reg('price','price_one','dmi_cards','reviewed_dmi_price')).rows[0].r.revision,1);
 await reg('price','price_foreign','known_other');await reg('customer','cus_foreign','known_other');
 await client.query("INSERT INTO billing_stripe_applications(application_key,state) VALUES ('revoked_app','revoked')");
 await assert.rejects(reg('price','price_revokedapp','revoked_app'),/OWNERSHIP_APPLICATION_UNAVAILABLE/);
 await reg('price','price_one','dmi_cards','reviewed_dmi_price');
 assert.equal((await client.query('SELECT count(*)::int n FROM billing_stripe_ownership_audit')).rows[0].n,3);
 await assert.rejects(reg('price','price_one','known_other'),/OWNERSHIP_CONFLICT/);
 await assert.rejects(reg('price','price_foreign','known_other','reviewed_dmi_price'),/check constraint/);
 await assert.rejects(reg('price','price_unknown','missing_app'),/OWNERSHIP_APPLICATION_UNAVAILABLE/);
 await assert.rejects(reg('price','*','dmi_cards'),/check constraint/);
 await client.query('SELECT billing_stripe_register_ownership($1,$2,$3,$4,$5,$6,$7,$8)',['acct_fixture:live','price','price_one','known_other','price_owner','operator_review','review_fixture','reviewed_operator_action']);
 await assert.rejects(client.query("SELECT billing_stripe_revoke_ownership($1,'price','price_foreign',2,'review_revoke','reviewed_operator_action')",[scope]),/OWNERSHIP_STALE/);
 await client.query("SELECT billing_stripe_revoke_ownership($1,'price','price_foreign',1,'review_revoke','reviewed_operator_action')",[scope]);
 assert.deepEqual((await client.query("SELECT state,revision::int FROM billing_stripe_resource_ownership WHERE stripe_scope=$1 AND stripe_resource_id='price_foreign'",[scope])).rows[0],{state:'revoked',revision:2});
 await assert.rejects(reg('price','price_foreign','known_other'),/OWNERSHIP_CONFLICT/);
 await assert.rejects(client.query("UPDATE billing_stripe_resource_ownership SET application_key='known_other' WHERE stripe_resource_id='price_one'"),/OWNERSHIP_IMMUTABLE/);
 await assert.rejects(client.query('DELETE FROM billing_stripe_ownership_audit'),/OWNERSHIP_AUDIT_IMMUTABLE/);
 assert.equal((await client.query('SELECT count(*)::int n FROM billing_stripe_ownership_audit')).rows[0].n,5);
 const tables=['billing_stripe_applications','billing_stripe_resource_ownership','billing_stripe_ownership_audit'];
 for(const table of tables){assert.equal((await client.query('SELECT relrowsecurity r FROM pg_class WHERE oid=$1::regclass',[table])).rows[0].r,true);for(const role of ['anon','authenticated'])for(const privilege of ['SELECT','INSERT','UPDATE','DELETE'])assert.equal((await client.query('SELECT has_table_privilege($1,$2,$3) allowed',[role,table,privilege])).rows[0].allowed,false);for(const privilege of ['INSERT','UPDATE','DELETE'])assert.equal((await client.query("SELECT has_table_privilege('service_role',$1,$2) allowed",[table,privilege])).rows[0].allowed,false);}
 for(const [fn,args] of [['billing_stripe_register_ownership','text,text,text,text,text,text,text,text'],['billing_stripe_revoke_ownership','text,text,text,bigint,text,text']]){
 for(const role of ['anon','authenticated','service_role'])assert.equal((await client.query("SELECT has_function_privilege($1,$2,'EXECUTE') allowed",[role,fn+'('+args+')'])).rows[0].allowed,role==='service_role');
 const r=(await client.query('SELECT prosecdef,proconfig FROM pg_proc WHERE oid=$1::regprocedure',[fn+'('+args+')'])).rows[0];assert.equal(r.prosecdef,true);assert.ok(r.proconfig.includes('search_path=pg_catalog, public'));
 }
 await client.query('SET ROLE service_role');await reg('price','price_service');await assert.rejects(client.query("SELECT billing_stripe_register_ownership($1,'price','price_denied','dmi_cards','price_owner','operator_review','review_fixture','unreviewed')",[scope]),/OWNERSHIP_OPERATOR_REQUIRED/);await client.query('RESET ROLE');
 // A failed operator transaction leaves no registration or audit entry behind.
 await client.query('BEGIN');await reg('price','price_rollback');await assert.rejects(reg('price','price_rollback','known_other'),/OWNERSHIP_CONFLICT/);await client.query('ROLLBACK');
 assert.equal((await client.query("SELECT count(*)::int n FROM billing_stripe_resource_ownership WHERE stripe_resource_id='price_rollback'")).rows[0].n,0);
 console.log('PASS PostgreSQL ownership: register/duplicate/conflict/revoke, scope/test/live isolation, immutable identity, append-only atomic audit, RLS/ACL/service-only RPC, operator contract, transaction rollback');
}
if(process.argv[2]==='--postgres'){
 const [bin,pg]=process.argv.slice(3);assert.ok(bin&&pg&&path.isAbsolute(bin)&&path.isAbsolute(pg));
 let runner=fs.readFileSync('scripts/validate-finance-postgres.mjs','utf8').replace("'./validate-finance-writer.mjs'",JSON.stringify(path.resolve('scripts/validate-finance-writer.mjs')));
 runner='import {validateOwnershipDatabase} from '+JSON.stringify(path.resolve('scripts/validate-finance-application-ownership.mjs'))+';\n'+runner;
 const setup=`
 const installed=new Set(await Promise.all(['20260930130000_finance_v1_writer.sql','20261003120000_finance_tax_evidence.sql'].map(n=>fs.readFile('supabase/migrations/'+n,'utf8'))));
 for(const text of installed)await client.query(text);
 for(const name of ['20261009180000_finance_partition_foundation.sql','20261009200000_finance_legacy_protocol_gate.sql','20261009210000_finance_customer_commit_foundation.sql','20261009220000_finance_reconciliation_protocol_guard.sql','20261009230000_finance_protocol_transitions.sql'])await client.query(await fs.readFile('supabase/migrations/'+name,'utf8'));
 const before=(await client.query("SELECT pg_get_functiondef('billing_finance_command(text,text,uuid,jsonb)'::regprocedure) definition")).rows[0].definition;
 await validateOwnershipDatabase(client);
 assert.equal((await client.query("SELECT pg_get_functiondef('billing_finance_command(text,text,uuid,jsonb)'::regprocedure) definition")).rows[0].definition,before);
 await validateWriter({query:(q,args)=>installed.has(q)?Promise.resolve({rows:[]}):client.query(q,args)});
 `;
 assert.ok(runner.includes(' await validateWriter(client);'));
 runner=runner.replace(' await validateWriter(client);',setup).replace('await fs.rm(temp,{recursive:true,force:true});}',"await fs.rm(temp,{recursive:true,force:true});console.log('CLEANUP: temporary PostgreSQL stopped and removed');}");
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'dmi-ownership-runner-'));try{const entry=path.join(temp,'runner.mjs');fs.writeFileSync(entry,runner);execFileSync(process.execPath,[entry,bin,pg],{stdio:'inherit'});}finally{fs.rmSync(temp,{recursive:true,force:true});}
}
