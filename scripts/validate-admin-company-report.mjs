// Local fixture transport only; no database or network access.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createClient } from '@supabase/supabase-js';
function load(file,deps={},globals={}) {
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,URL,console,...globals,require(name){assert.ok(name in deps,name);return deps[name];}});return exports;
}
const canonical=load('src/lib/public-url.ts',{}, {process:{env:{}}});
const contract=load('src/lib/admin-card-support.ts');
const report=load('src/lib/admin-company-report.ts',{'@/lib/public-url':canonical,'@/lib/admin-card-support':contract});
let csv=report.companyReport('Company "Quoted"',[{full_name:'=HYPERLINK("evil")',email:'a@example.invalid',slug:'one two',status:'published',is_published:false}]);
assert.equal(csv.count,1);assert.ok(csv.csv.includes('"\'=HYPERLINK(""evil"")"'));assert.ok(csv.csv.includes('"Company ""Quoted"""'));assert.ok(csv.csv.includes('https://app.dmicards.com/u/one%20two'));assert.ok(csv.csv.endsWith('"0","0","0","published"'));
for(const value of ['+formula','-formula','@formula',' \t=foo','\rfoo','\nfoo'])assert.ok(report.companyReport(value,[{}]).csv.includes("\"'"+value));
assert.equal(report.companyReport('!!!',[]).filename,'company-public-pages-report.csv');
const id='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222';
let identity={userId:'approved'},requests=[],fail=false,cap=500,company={id,company_name:'Business',full_name:'Owner',account_type:'business'},rows=[];
const auth=load('src/lib/admin-auth.ts',{}, {process:{env:{DMI_ADMIN_CLERK_USER_IDS:'approved'}}});
const db=createClient('https://fixture.invalid','fixture-only',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(url,init)=>{
 const u=new URL(url);assert.equal(u.hostname,'fixture.invalid');assert.equal(init.method,'GET');requests.push(u);
 assert.doesNotMatch(u.searchParams.get('select'),/\*|phone|bio|media|lead|custom_fields|user_id/);
 if(fail)return new Response(JSON.stringify({message:'private failure'}),{status:500});
 if(u.pathname.endsWith('/clients')){assert.equal(u.searchParams.get('id'),'eq.'+id);return new Response(JSON.stringify(company),{status:200});}
 assert.equal(u.pathname,'/rest/v1/cards');assert.equal(u.searchParams.get('client_id'),'eq.'+id);
 assert.equal(u.searchParams.get('limit'),'500');assert.equal(u.searchParams.get('order'),'created_at.desc.nullslast,id.asc');
 const offset=Number(u.searchParams.get('offset'));return new Response(JSON.stringify(rows.filter(r=>r.client_id===id).slice(offset,offset+cap)),{status:200});
}}});
const server=load('src/lib/admin-company-report-server.ts',{'server-only':{},'next/server':{NextResponse:{json:(body,options)=>({body,...options})}},'@clerk/nextjs/server':{auth:async()=>identity},'@/lib/admin-auth':auth,'@/lib/supabase-admin':{createSupabaseAdminClient:()=>db},'@/lib/admin-company-report':report});
const route=load('src/app/api/admin/cards/support/export/route.ts',{'@/lib/admin-company-report-server':server});
assert.deepEqual(Object.keys(route).sort(),['GET','dynamic','revalidate']);
async function get(query='clientId='+id){const response=await route.GET({url:'https://local.invalid/api/admin/cards/support/export?'+query});assert.equal(response.headers['Cache-Control'],'private, no-store');return response;}
for(identity of [{userId:null},{userId:'other'}]){requests=[];assert.equal((await get()).status,403);assert.equal(requests.length,0);}
identity={userId:'approved'};
for(const query of ['', 'clientId=nope','clientId='+id+'&clientId='+other,'clientId='+id+'&page=2','clientId='+id+'&search='+('x'.repeat(81))]){requests=[];assert.equal((await get(query)).status,400);assert.equal(requests.length,0);}
company.account_type='individual';assert.equal((await get()).status,404);company.account_type='enterprise';
rows=Array.from({length:501},(_,i)=>({id:String(i),client_id:id,card_name:'Staff '+i,full_name:'Name '+i,email:'staff'+i+'@example.invalid',slug:'card-'+i,status:i%2?'published':'draft',is_published:false,template:{name:'Classic'}}));rows.push({client_id:other,full_name:'Other company private name'});
let result=await get();assert.equal(result.status,200);assert.equal(result.body.count,501);assert.equal(result.body.csv.split('\n').length,502);assert.ok(!result.body.csv.includes('Other company'));assert.deepEqual(Object.keys(result.body).sort(),['count','csv','filename']);
cap=37;assert.equal((await get()).body.count,501);cap=500;
result=await get('clientId='+id+'&search=staff500%40example.invalid');assert.equal(result.body.count,1);
result=await get('clientId='+id+'&search=Classic');assert.equal(result.body.count,501);
result=await get('clientId='+id+'&search=no-match');assert.equal(result.body.count,0);
fail=true;result=await get();assert.equal(result.status,500);assert.ok(!JSON.stringify(result).includes('private failure'));fail=false;
rows=Array.from({length:10001},(_,i)=>({client_id:id,card_name:String(i)}));assert.equal((await get()).status,413);
// Existing Public Pages delegates the exact selected company group to the shared formatter.
const source=fs.readFileSync('src/app/public-pages/page.tsx','utf8');
const ast=ts.createSourceFile('page.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let fn;
function visit(n){if(ts.isFunctionDeclaration(n)&&n.name?.text==='downloadCompanyReport')fn=n.getText(ast);ts.forEachChild(n,visit);}visit(ast);
let downloaded;
const context={companyReport:report.companyReport,downloadReport:r=>downloaded=r};
vm.runInNewContext(ts.transpileModule(fn,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
context.downloadCompanyReport({companyName:'Selected company',cards:[{full_name:'Selected staff',is_published:true}]});assert.equal(downloaded.count,1);assert.ok(downloaded.csv.includes('Selected staff'));
assert.match(source,/operation: "unpublish"/);assert.match(source,/const businessRows = filteredRows\.filter/);
console.log('PASS: exact legacy company CSV columns/search scope; all pages; narrow GET-only reads; Admin ID authorization before DB; no global/individual export; canonical URLs; OR status; formula/quote escaping; errors/oversize fail without partial download; Public Pages shared formatter and retained unpublish.');
