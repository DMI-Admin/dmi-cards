import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const sql=fs.readFileSync('supabase/migrations/20261004120000_admin_finance_v1_reporting.sql','utf8');
assert.doesNotMatch(sql.split('$report$')[1],/\b(INSERT|UPDATE|DELETE|TRUNCATE|CALL)\b/i);assert.match(sql,/STABLE SECURITY INVOKER SET search_path=pg_catalog/);
assert.match(sql,/FROM PUBLIC,anon,authenticated/);assert.match(sql,/TO service_role/);assert.doesNotMatch(sql,/billing_finance_command|billing_foundation_command|ALTER TABLE|CREATE TABLE/);
function load(file,deps){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,URL,Date,Intl,Set,Map,require:n=>{assert.ok(n in deps,n);return deps[n];}});return exports;}
const metrics=load('src/lib/stripe/finance-metrics.ts',{'server-only':{}}),dto=load('src/lib/admin-finance-v1.ts',{}),contract=load('src/lib/stripe/finance-contractual.ts',{'server-only':{},'./finance-metrics':metrics});
let result={items:[],months:[{label:'2026-10',newCustomers:'0',invoiceCount:'0',gross:null,vat:null,net:null,failedPayments:'0',cancelledCustomers:'0',refunds:'0'}],activePaidCustomers:'1',recoveryCustomers:'0',undatedInvoices:'0',undatedRefunds:'0',nextAfter:null};
const db={rpc:async(name,args)=>{assert.equal(name,'admin_finance_v1_report');assert.equal(args.p_scope,'acct_fixture:test');assert.equal(args.p_limit,25);assert.equal(args.p_periods[0].start_at,'2026-09-30T23:00:00.000Z');return {data:result};},from:()=>{throw Error('Unexpected identity lookup');}};
const server=load('src/lib/admin-finance-v1-server.ts',{'server-only':{},'next/server':{NextResponse:{json:Response.json}},'@/lib/supabase-admin':{createSupabaseAdminClient:()=>db},'@/lib/stripe/finance-metrics':metrics,'@/lib/stripe/finance-contractual':contract,'./admin-finance-v1':dto});
const base='https://local.invalid/?view=monthly&year=2026&month=10&list=invoices';
for(const suffix of ['&scope=acct_other:test','&limit=51','&year=2025','&cursor=monthly|2026|9|invoices|in_one'])assert.throws(()=>server.parseV1Query(base+suffix));
const year=server.parseV1Query('https://local.invalid/?view=yearly&year=2026');assert.equal(year.periods.length,12);assert.equal(year.periods[0].start_at,'2026-01-01T00:00:00.000Z');assert.equal(year.periods[11].end_at,'2027-01-01T00:00:00.000Z');assert.equal(year.periods[2].end_at,'2026-03-31T23:00:00.000Z');
const get=()=>server.readFinanceV1(new Request(base),'acct_fixture:test');assert.equal((await get()).status,200);
result={...result,items:[{id:'in_one',amount:'599',currency:'gbp',status:'paid',invoiceTax:{version:1,status:'verified',basis:'finalized_invoice',vatMinor:'100',netMinor:'499'}}]};
let output=await (await get()).json();assert.equal(output.items[0].vat,'100');assert.equal(output.items[0].net,'499');assert.equal(output.items[0].amount,'599');assert.equal(output.items[0].invoiceTax,undefined);
result.items[0].invoiceTax.status='unknown';output=await (await get()).json();assert.equal(output.items[0].vat,null);assert.equal(output.items[0].net,null);
const src=fs.readFileSync('src/app/finance/page.tsx','utf8');
const compiled=ts.transpileModule(src+'\nexport {money,cells,billingInterval,sections};',{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const react=await import('react'),jsx=await import('react/jsx-runtime'),{renderToStaticMarkup}=await import('react-dom/server');
const ui={};const deps={'react':react,'react/jsx-runtime':jsx,'next/link':{default:({children})=>jsx.jsx('a',{children})},'@/components/admin/AdminShell':{default:({children})=>children},'@/components/admin/AdminUI':{AdminPageHeader:()=>null,AdminKpiCard:()=>null,AdminStatusBadge:({label})=>jsx.jsx('span',{children:label})},'./finance.module.css':{default:{}}};
vm.runInNewContext(compiled,{exports:ui,Intl,Date,URLSearchParams,require:n=>{assert.ok(n in deps,n);return deps[n];}});
assert.equal(ui.sections.length,6);assert.equal(ui.money(null),'Unavailable');assert.equal(ui.money('0'),'£0.00');assert.equal(ui.money('9007199254740993'),'£90,071,992,547,409.93');
const row={id:'fixture',status:'paid',amount:'599',vat:'100',net:'499',currency:'gbp',interval:'month',intervalCount:1};
const html=renderToStaticMarkup(jsx.jsx('div',{children:ui.cells('invoices',row).map((v,i)=>jsx.jsx('span',{children:v},i))}));assert.match(html,/£5.99/);assert.match(html,/£1.00/);assert.match(html,/£4.99/);assert.doesNotMatch(html,/Tax:/);
assert.equal(ui.cells('refunds',row)[4],'Unavailable');assert.equal(ui.cells('refunds',row)[5],'Unavailable');
assert.equal(ui.billingInterval(row),'Monthly');assert.equal(ui.billingInterval({...row,interval:'year'}),'Annual');assert.equal(ui.billingInterval({...row,intervalCount:2}),'Every 2 months');assert.equal(ui.billingInterval({...row,intervalCount:0}),'Unavailable');
assert.doesNotMatch(src,/method:\s*['"]POST|Opening MRR|Churned MRR|Send reminder|Cancel subscription/);
console.log('PASS V1 offline: period/cursor validation, London DST/year, exact money and tax projection, six tabs, unknown/zero, no destructive UI or V2 metrics.');
if(process.argv[2]==='--postgres'){
 const [bin,pg]=process.argv.slice(3);assert.ok(bin&&pg);
 let runner=fs.readFileSync('scripts/validate-finance-postgres.mjs','utf8').replace("'./validate-finance-writer.mjs'",JSON.stringify(path.resolve('scripts/validate-finance-writer.mjs')));
 runner=`import {validateV1Reporting} from ${JSON.stringify(path.resolve('scripts/validate-finance-v1-reporting-postgres.mjs'))};\n`+runner.replace('await validateWriter(client);','await validateWriter(client); await validateV1Reporting(client);');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'finance-v1-test-'));try{const file=path.join(dir,'runner.mjs');fs.writeFileSync(file,runner);assert.equal(spawnSync(process.execPath,[file,bin,pg],{stdio:'inherit'}).status,0);}finally{fs.rmSync(dir,{recursive:true,force:true});}
}
