import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
function load(path,deps={}) {
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require:n=>{assert.ok(n in deps,n);return deps[n];},console,Map,Set});return exports;
}
const lists=load('src/lib/admin-client-lists.ts');
const rows=Array.from({length:60},(_,i)=>({id:String(i).padStart(3,'0'),full_name:'Person '+i,company_name:'Company '+i,email:'test@example.invalid',account_type:i<30?'individual':i===59?'enterprise':'business',created_at:new Date(Date.UTC(2026,0,i+1)).toISOString(),status:'active',subscription_plan:'free',billing_status:'free',card_count:2}));
const original=JSON.stringify(rows);
assert.equal(lists.accountsForArea(rows,'individual').length,30);assert.equal(lists.accountsForArea(rows,'business').length,30);
assert.equal(lists.accountsForArea(rows,'individual')[0].id,'029');assert.equal(lists.accountsForArea(rows,'business')[0].id,'059');assert.equal(JSON.stringify(rows),original);
assert.equal(lists.clientPage(rows,1).rows.length,25);assert.equal(lists.clientPage(rows,2).rows[0].id,'025');assert.equal(lists.clientPage(rows,99).rows.length,10);assert.equal(lists.clientPage([],1).pages,1);
const file='src/components/admin/AdminClientsPage.tsx',source=fs.readFileSync(file,'utf8');
const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const component=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='AdminClientsPage');
const hookNames=[];
for(const st of component.body.statements) if(ts.isVariableStatement(st)) for(const d of st.declarationList.declarations) if(ts.isCallExpression(d.initializer)&&d.initializer.expression.getText(ast)==='useState') hookNames.push(d.name.elements[0].name.text);
function render(area,overrides={}) {
 let index=0;
 const react={...React,useState:initial=>{const name=hookNames[index++];const values={clients:rows,loading:false,...overrides};return [Object.hasOwn(values,name)?values[name]:initial,()=>{}];},useEffect:()=>{},useMemo:fn=>fn(),useRef:value=>({current:value})};
 const noop=()=>null;
 const mod=load(file,{'react':react,'react/jsx-runtime':jsx,'@clerk/nextjs':{useAuth:()=>({getToken:async()=>null})},'@/lib/admin-client-lists':lists,'@/components/Sidebar':{default:noop},'@/components/CardRenderer':{default:noop},'@/lib/admin-card-mutations':{},'@/lib/admin-inventory':{},'@/lib/templates':{},'@/lib/admin-client-contract':{},xlsx:{},'lucide-react':{Download:noop,FileSpreadsheet:noop,UploadCloud:noop}});
 return renderToStaticMarkup(mod.default({area}));
}
const individual=render('individual');const business=render('business');
assert.match(individual,/Add Individual Client/);assert.doesNotMatch(individual,/Bulk Company Import|Recent Companies|Company 59/);
assert.match(business,/Add Business/);assert.match(business,/Bulk Company Import/);assert.match(business,/Legacy Enterprise/);assert.doesNotMatch(business,/Recent Individual Clients|>Plan<|>Paid</);
assert.equal((individual.match(/<tr class="border-t/g)||[]).length,10);assert.equal((business.match(/<tr class="cursor-pointer/g)||[]).length,10);
assert.ok(individual.indexOf('Person 29')<individual.indexOf('Person 28'));assert.ok(business.indexOf('Company 59')<business.indexOf('Company 58'));
assert.doesNotMatch(individual+business,/<option value="enterprise"/);
assert.match(individual,/<option value="free" selected="">Free/);assert.match(individual,/<option value="pro" disabled="">Pro/);
for(const area of ['individual','business']) {
 const full=render(area,{fullListMode:area});assert.match(full,/Page 1 of 2/);
 const modal=full.slice(full.lastIndexOf('All '+(area==='individual'?'Individual Clients':'Companies')));
 const pattern=area==='individual'?/<tr class="border-t/g:/<tr class="cursor-pointer/g;
 assert.equal((modal.match(pattern)||[]).length,25);
 const busy=render(area,{mutationBusy:true});assert.match(busy,/<fieldset disabled="" aria-busy="true"/);assert.match(busy,/Saving/);
 const route=fs.readFileSync(`src/app/clients/${area}/page.tsx`,'utf8');assert.match(route,new RegExp(`area="${area}"`));
}
assert.match(fs.readFileSync('src/app/clients/page.tsx','utf8'),/redirect\("\/clients\/individual"\)/);
const sidebar=fs.readFileSync('src/components/Sidebar.tsx','utf8');assert.doesNotMatch(sidebar,/Client Onboarding/);assert.match(sidebar,/\/clients\/individual/);assert.match(sidebar,/\/clients\/business/);
assert.match(source,/account_type: "business", status: clientStatus/);assert.match(source,/Send Pro Subscription Link/);
console.log('PASS: rendered account-area separation, latest ten, legacy Enterprise, no new Enterprise selection, Free-only creation, paginated full lists, busy controls, Business-only import and compatibility navigation.');
