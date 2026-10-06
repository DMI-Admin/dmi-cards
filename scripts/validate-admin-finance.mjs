// Offline reporting contracts; optional --postgres runs only the existing disposable socket cluster.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const migration='supabase/migrations/20261002120000_admin_finance_reporting.sql';
const sql=fs.readFileSync(migration,'utf8');
const body=sql.split('$report$')[1];
assert.doesNotMatch(body,/\b(INSERT|UPDATE|DELETE|TRUNCATE|CALL)\b/i);
assert.match(sql,/STABLE SECURITY INVOKER SET search_path = pg_catalog/);
assert.match(sql,/FROM PUBLIC,anon,authenticated/);assert.match(sql,/TO service_role/);
assert.doesNotMatch(sql,/billing_finance_command|billing_foundation_command/);
const env={};
function load(file,deps){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,URL,Intl,Date,Map,Set,process:{env},require:n=>{assert.ok(n in deps,n);return deps[n];}});return exports;}
const metrics=load('src/lib/stripe/finance-metrics.ts',{'server-only':{}});
const contractual=load('src/lib/stripe/finance-contractual.ts',{'server-only':{},'./finance-metrics':metrics});
const helpers=load('src/lib/admin-finance.ts',{'server-only':{},'./stripe/finance-metrics':metrics});
assert.deepEqual(JSON.parse(JSON.stringify(helpers.recurringTotals([{numerator:'5999',denominator:'12'}]))),{mrr:'500',arr:'5999'});
assert.equal(helpers.recurringTotals([{numerator:'599',denominator:'1'}]).mrr,'599');
assert.equal(helpers.recurringTotals([{numerator:'9007199254740993',denominator:'1'}]).mrr,'9007199254740993');
assert.throws(()=>helpers.recurringTotals([{numerator:'1.2',denominator:'1'}]));
assert.equal(metrics.londonMonthBounds(2026,10).start,'2026-09-30T23:00:00.000Z');
assert.equal(metrics.londonMonthBounds(2026,10).end,'2026-11-01T00:00:00.000Z');
assert.equal(metrics.londonMonthBounds(2026,3).end,'2026-03-31T23:00:00.000Z');
const evidence={subscriptionPopulation:{paidActiveCount:'1',verifiedUserCount:'1',unresolvedIdentityCount:'0',unsupportedCount:'0',incompleteItemCount:'0',missingMirrorCount:'0',oldestVerifiedAt:null},recurringRevenue:{groups:[{numerator:'599',denominator:'1'}],blockerCount:'0',includedCount:'1',groupLimitExceeded:false},collections:{minor:'599',includedCount:'1',missingTimestampCount:'0',excludedCount:'0'},invoices:{minor:'599',openCount:'1',blockerCount:'0',oldestVerifiedAt:null},failedAttempts:{count:'0'},coverage:[]};
const now='2026-10-02T00:00:00Z';
let report=helpers.reportingResult(evidence,now);
for(const k of ['mrr','arr','collectedThisMonth','outstandingInvoices'])assert.equal(report.kpis[k].value,null);
assert.equal(report.kpis.activePaidCustomers.value,'1');assert.equal(report.kpis.recordedFailedAttempts.basis,'observed');
evidence.subscriptionPopulation.unsupportedCount='1';assert.equal(helpers.reportingResult(evidence,now).kpis.mrr.status,'unsupported');evidence.subscriptionPopulation.unsupportedCount='0';
evidence.subscriptionPopulation.incompleteItemCount='1';assert.equal(helpers.reportingResult(evidence,now).kpis.mrr.status,'incomplete');evidence.subscriptionPopulation.incompleteItemCount='0';
evidence.coverage=[{resource_type:'active_subscriptions',status:'completed',coverage_quality:'complete',coverage_start:'2026-10-01',coverage_end:now,completed_at:'2026-10-01',error_count:'0'}];
assert.equal(helpers.reportingResult(evidence,now).kpis.mrr.status,'stale');
evidence.coverage.push({...evidence.coverage[0],resource_type:'recent_invoices'});assert.equal(helpers.reportingResult(evidence,now).kpis.collectedThisMonth.value,null);
evidence.subscriptionPopulation.unresolvedIdentityCount='1';assert.equal(helpers.reportingResult(evidence,now).kpis.activePaidCustomers.value,null);evidence.subscriptionPopulation.unresolvedIdentityCount='0';
let authorized=false,calls=0;const queries=[];
const datasets={
 billing_payments:[{stripe_scope:'acct_fixture:test',stripe_object_id:'ch_a',stripe_customer_id:'cus_a',status:'succeeded',amount_captured_minor:'9007199254740993',currency:'gbp',collected_at:null},{stripe_scope:'acct_fixture:test',stripe_object_id:'ch_b',stripe_customer_id:'cus_a',status:'succeeded',amount_captured_minor:'599',currency:'gbp',collected_at:null},{stripe_scope:'acct_other:test',stripe_object_id:'ch_foreign',status:'succeeded'}],
 billing_accounts:[{stripe_scope:'acct_fixture:test',stripe_customer_id:'cus_a',user_id:'user_a',verified_at:'2026-01-01'}],
 profiles:[{id:'user_a',full_name:'Synthetic Client'}]
};
const db={rpc:async(name,args)=>{calls++;assert.equal(name,'admin_finance_report');assert.equal(args.p_scope,env.STRIPE_ACCOUNT_SCOPE);return {data:evidence,error:null};},from:table=>{const filters=[];let bound,ids,field,order;const greater=[];const q={select:()=>q,eq:(k,v)=>{filters.push([k,v]);return q;},order:k=>{order=k;return q;},limit:n=>{bound=n;return q;},gt:(k,v)=>{greater.push([k,v]);return q;},is:()=>q,in:(k,v)=>{field=k;ids=v;return q;},then:resolve=>{queries.push({table,filters,bound});if(table!=='profiles')assert.deepEqual(filters[0],['stripe_scope',env.STRIPE_ACCOUNT_SCOPE]);assert.ok(bound<=501);const rows=(datasets[table]||[]).filter(r=>filters.every(([k,v])=>r[k]===v)&&(!ids||ids.includes(r[field]))&&greater.every(([k,v])=>r[k]>v)).sort((a,b)=>String(a[order]).localeCompare(String(b[order]))).slice(0,bound);resolve({data:rows,error:null});}};return q;}};
const serverSource=fs.readFileSync('src/lib/admin-finance-server.ts','utf8');assert.doesNotMatch(serverSource,/stripe\/config|stripe\/reliability|prices\.retrieve|email|fetch\(/);
const server=load('src/lib/admin-finance-server.ts',{'server-only':{},'@clerk/nextjs/server':{auth:async()=>({})},'next/server':{NextResponse:{json:Response.json}},'@/lib/admin-auth':{requireAdminAccess:async()=>({authorized})},'@/lib/supabase-admin':{createSupabaseAdminClient:()=>db},'@/lib/stripe/finance-metrics':metrics,'@/lib/stripe/finance-contractual':contractual,'@/lib/admin-finance':helpers});
const get=q=>server.readAdminFinance(new Request('https://local.invalid/api/admin/finance'+q));
assert.equal((await get('')).status,403);assert.equal((await get('?view=monthly&year=2026&month=10')).status,403);assert.equal(calls,0);authorized=true;
assert.equal((await get('')).status,503);env.STRIPE_ACCOUNT_SCOPE='bad';assert.equal((await get('')).status,503);
env.STRIPE_ACCOUNT_SCOPE='acct_fixture:live';env.VERCEL_TARGET_ENV='staging';assert.equal((await get('')).status,503);
env.STRIPE_ACCOUNT_SCOPE='acct_fixture:test';env.VERCEL_ENV='production';assert.equal((await get('')).status,503);delete env.VERCEL_ENV;
assert.equal((await get('?scope=acct_other:test')).status,400);assert.equal((await get('?list=payments&limit=51')).status,400);
assert.equal((await get('?list=payments&cursor=refunds|re_x')).status,400);
const response=await get('');assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.ok(!JSON.stringify(await response.json()).includes('acct_fixture'));
for(const list of helpers.listNames)assert.equal((await get('?list='+list)).status,200);
const first=await (await get('?list=payments&limit=1')).json();assert.equal(first.items.length,1);assert.equal(first.items[0].amount,'9007199254740993');assert.equal(first.items[0].date,null);assert.equal(first.items[0].client.name,'Synthetic Client');assert.equal(first.nextCursor,'payments|ch_a');
const second=await (await get('?list=payments&limit=1&cursor='+encodeURIComponent(first.nextCursor))).json();assert.equal(second.items[0].id,'ch_b');assert.equal(second.nextCursor,null);assert.ok(!JSON.stringify(second).includes('acct_'));

assert.equal(server.parseFinanceQuery('https://local.invalid/?list=payments&cursor=payments|ch_123').after,'ch_123');
for(const file of ['src/lib/stripe/finance-webhook.ts','supabase/migrations/20260930120000_finance_v1_foundation.sql','supabase/migrations/20260930130000_finance_v1_writer.sql']){
 const committed=spawnSync('git',['show','HEAD:'+file],{encoding:'utf8'});assert.equal(committed.status,0);assert.equal(fs.readFileSync(file,'utf8'),committed.stdout,file+' changed');
}
console.log('PASS Admin Finance offline: auth/scope/mode denial; no Stripe dependency; bounded queries; exact rational money; London DST; coverage fail-closed; observed counts; protected SQL; verified backend unchanged.');
if(process.argv[2]==='--postgres'){
 const [bin,pg]=process.argv.slice(3);assert.ok(bin&&pg,'Pass existing native PostgreSQL bin and pg module paths');
 let runner=fs.readFileSync('scripts/validate-finance-postgres.mjs','utf8').replace("'./validate-finance-writer.mjs'",JSON.stringify(path.resolve('scripts/validate-finance-writer.mjs')));
 runner=runner.replace('await validateWriter(client);',`await validateWriter(client);
 // Supabase platform baseline grants service SELECT; bare PostgreSQL has no default ACLs.
 await client.query('GRANT SELECT ON public.billing_subscriptions TO service_role');
 await client.query(await fs.readFile('${migration}','utf8'));
 for(const role of ['anon','authenticated']){await client.query('SET ROLE '+role);await assert.rejects(client.query("SELECT public.admin_finance_report('acct_fixture:test',now(),date_trunc('month',now()),date_trunc('month',now())+interval '1 month')"),/permission denied/);await client.query('RESET ROLE');}
 await client.query('SET ROLE service_role');
 const report=await client.query("SELECT public.admin_finance_report('acct_empty:test','2026-10-02','2026-10-01','2026-11-01') r");
 assert.equal(report.rows[0].r.subscriptionPopulation.paidActiveCount,'0');assert.equal(report.rows[0].r.failedAttempts.count,'0');assert.deepEqual(report.rows[0].r.recurringRevenue.groups,[]);
 assert.equal((await client.query("SELECT public.admin_finance_report('invalid','2026-10-02','2026-10-01','2026-11-01') r")).rows[0].r,null);
 await client.query('RESET ROLE');
 const definition=await client.query("SELECT prosecdef,provolatile,proconfig FROM pg_proc WHERE oid='public.admin_finance_report(text,timestamptz,timestamptz,timestamptz)'::regprocedure");
 assert.equal(definition.rows[0].prosecdef,false);assert.equal(definition.rows[0].provolatile,'s');
 // Synthetic local-only fixtures exercise exact aggregate math and cross-scope isolation.
 await client.query("INSERT INTO billing_accounts(stripe_scope,user_id,stripe_customer_id,verified_at) SELECT 'acct_fixture:test',id,'cus_one','2026-10-01' FROM auth.users LIMIT 1");
 await client.query("UPDATE billing_finance_subscriptions SET user_id=(SELECT id FROM auth.users LIMIT 1),linkage_status='verified',valuation_status='complete',valuation_reason=NULL,items_complete=true WHERE stripe_scope='acct_fixture:test'");
 await client.query("UPDATE billing_finance_subscription_items SET currency='gbp',period_start='2026-10-01',period_end='2026-11-01',valuation_status='complete',valuation_reason=NULL,effective_cycle_amount_minor=5999,recurring_interval='year' WHERE stripe_scope='acct_fixture:test'");
 await client.query("INSERT INTO billing_subscriptions(user_id,stripe_scope,stripe_customer_id,stripe_subscription_id,stripe_subscription_status,dmi_plan,current_period_end) SELECT id,'acct_fixture:test','cus_one','sub_one','active','pro','2026-11-01' FROM auth.users LIMIT 1");
 const readReport=async scope=>(await client.query("SELECT public.admin_finance_report($1,'2026-10-02','2026-10-01','2026-11-01') r",[scope])).rows[0].r;
 await client.query('SET ROLE service_role');
 let actual=await readReport('acct_fixture:test');assert.equal(actual.subscriptionPopulation.verifiedUserCount,'1');assert.deepEqual(actual.recurringRevenue.groups,[{numerator:'5999',denominator:'12'}]);
 assert.deepEqual((await readReport('acct_fixture:live')).recurringRevenue.groups,[]);
 await client.query('RESET ROLE');
 await client.query("UPDATE billing_finance_subscription_items SET valuation_status='unsupported',valuation_reason='tax_basis_unresolved' WHERE stripe_scope='acct_fixture:test'");
 actual=await readReport('acct_fixture:test');assert.deepEqual(actual.recurringRevenue.groups,[]);assert.equal(actual.subscriptionPopulation.unsupportedCount,'1');
 await client.query("INSERT INTO billing_payments(stripe_scope,stripe_object_id,stripe_created_at,stripe_api_version,normalizer_version,verified_at,stripe_customer_id,currency,status,amount_minor,amount_captured_minor,amount_refunded_minor,paid,captured,collected_at,collection_time_basis,attribution_status) VALUES('acct_fixture:test','ch_reporting','2026-10-01','fixture',1,'2026-10-01','cus_one','gbp','succeeded',9007199254740993,9007199254740993,0,true,true,'2026-10-01','verified_event','verified')");
 actual=await readReport('acct_fixture:test');assert.equal(actual.collections.minor,'9007199254740993');assert.equal(actual.collections.includedCount,'1');
 await assert.rejects(client.query("INSERT INTO billing_payments SELECT * FROM billing_payments WHERE stripe_scope='acct_fixture:test' AND stripe_object_id='ch_reporting'"),/duplicate key/);
 await client.query("UPDATE billing_payments SET collected_at=NULL,collection_time_basis='unknown' WHERE stripe_scope='acct_fixture:test' AND stripe_object_id='ch_reporting'");
 actual=await readReport('acct_fixture:test');assert.equal(actual.collections.minor,'0');assert.equal(actual.collections.missingTimestampCount,'1');
 console.log('PASS reporting RPC PostgreSQL: role grants, scope/mode isolation, exact annual groups, unsupported exclusion, distinct linkage, bigint serialization, duplicate PK rejection, unknown collection timestamp exclusion.');`);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dmi-report-test-')),file=path.join(dir,'runner.mjs');
 try{fs.writeFileSync(file,runner);const result=spawnSync(process.execPath,[file,bin,pg],{stdio:'inherit'});assert.equal(result.status,0);}finally{fs.rmSync(dir,{recursive:true,force:true});}
}

// V1 UI contracts replace the superseded diagnostic table layout tests.
await import('./validate-admin-finance-v1.mjs');
