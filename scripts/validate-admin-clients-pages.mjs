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
const styles=new Proxy({}, {get:(_,key)=>String(key)});
const sheet=load('src/components/admin/AdminClientSheet.tsx',{'react':React,'react/jsx-runtime':jsx,'./AdminClientsPage.module.css':{default:styles}});
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
 const mod=load(file,{'react':react,'react/jsx-runtime':jsx,'./AdminClientSheet':sheet,'./AdminClientsPage.module.css':{default:styles},'@clerk/nextjs':{useAuth:()=>({getToken:async()=>null})},'@/lib/admin-client-lists':lists,'@/components/Sidebar':{default:noop},'@/components/CardRenderer':{default:noop},'@/lib/admin-card-mutations':{},'@/lib/admin-inventory':{},'@/lib/templates':{},'@/lib/admin-client-contract':{},xlsx:{},'lucide-react':{Download:noop,FileSpreadsheet:noop,UploadCloud:noop}});
 return renderToStaticMarkup(mod.default({area}));
}
const individual=render('individual');const business=render('business');
assert.match(individual,/Add Individual Client/);assert.doesNotMatch(individual,/Bulk Company Import|Recent Companies|Company 59/);
assert.match(business,/Add Business/);assert.match(render("business",{importOpen:true}),/Bulk Company Import/);assert.match(business,/Legacy Enterprise/);assert.doesNotMatch(business,/Recent Individual Clients|>Plan<|>Paid</);
assert.equal((individual.match(/<tr class="border-t/g)||[]).length,10);assert.equal((business.match(/<tr class="border-t/g)||[]).length,10);
assert.ok(individual.indexOf('Person 29')<individual.indexOf('Person 28'));assert.ok(business.indexOf('Company 59')<business.indexOf('Company 58'));
assert.doesNotMatch(individual+business,/<option value="enterprise"/);
assert.match(render("individual",{createOpen:true}),/<option value="free" selected="">Free/);assert.match(render("individual",{createOpen:true}),/<option value="pro" disabled="">Pro/);
for(const area of ['individual','business']) {
 const full=render(area,{fullListMode:area});assert.match(full,/Page 1 of 2/);
 const modal=full.slice(full.lastIndexOf('All '+(area==='individual'?'Individual Clients':'Companies')));
 const pattern=area==='individual'?/<tr class="border-t/g:/<tr class="border-t/g;
 assert.equal((modal.match(pattern)||[]).length,25);
 const busy=render(area,{mutationBusy:true});assert.match(busy,/<fieldset disabled="" aria-busy="true"/);assert.match(busy,/Saving/);
 const route=fs.readFileSync(`src/app/clients/${area}/page.tsx`,'utf8');assert.match(route,new RegExp(`area="${area}"`));
}
assert.match(fs.readFileSync('src/app/clients/page.tsx','utf8'),/redirect\("\/clients\/individual"\)/);
const sidebar=fs.readFileSync('src/components/Sidebar.tsx','utf8');assert.doesNotMatch(sidebar,/Client Onboarding/);assert.match(sidebar,/\/clients\/individual/);assert.match(sidebar,/\/clients\/business/);
assert.match(source,/account_type: "business", status: clientStatus/);assert.match(source,/Send Pro Subscription Link/);
console.log('PASS: rendered account-area separation, latest ten, legacy Enterprise, no new Enterprise selection, Free-only creation, paginated full lists, busy controls, Business-only import and compatibility navigation.');

assert.doesNotMatch(individual, /Total Clients|Invited \/ Unlinked|All Plans|All Billing/);
assert.match(individual, /Total Individuals/);
assert.doesNotMatch(business, /Total Individuals|All Status/);
assert.match(business, /Active Companies/);
assert.match(business, /Suspended Companies/);
assert.match(business, /Company staff memberships/);
assert.match(render('individual', {individualSearch:'no-match', individualStatusFilter:'suspended'}), /Person 29/);
assert.match(render('business', {businessSearch:'no-match', businessStatusFilter:'suspended'}), /Company 59/);
assert.match(render('individual', {fullListMode:'individual'}), /All Plans/);
assert.match(render('business', {fullListMode:'business'}), /All Status/);
console.log('PASS: scoped summaries; recent lists unfiltered; filters retained exclusively in full inventories.');

for(const area of ['individual','business']) {
 const add=render(area,{createOpen:true});
 assert.match(add,/Create Account/);
 assert.match(render(area,{createOpen:true,mutationBusy:true}),/Creating…/);
 const success=render(area,{createOpen:true,createdAccount:{id:'created-id',name:'Created account',email:'created@example.invalid',status:'active'}});
 assert.match(success,/Account created/);assert.match(success,/Created account/);assert.match(success,/Next steps/);
 assert.doesNotMatch(success,/>Create Account</);
 const confirm=render(area,{statusTarget:{...rows[0],status:'active'}});
 assert.match(confirm,/Suspend Client/);assert.match(confirm,/Client Portal access/);
 assert.match(render(area,{statusTarget:rows[0],mutationBusy:true}),/Suspending…/);
 assert.match(render(area,{statusTarget:{...rows[0],status:'suspended'},mutationBusy:true}),/Reactivating…/);
 assert.match(render(area,{statusTarget:rows[0],operationError:'Request failed'}),/role="alert"[^>]*>Request failed/);
}
assert.doesNotMatch(source.slice(source.indexOf('function toggleClientStatus'),source.indexOf('async function createClientUser')),/window.confirm/);
const css=fs.readFileSync('src/components/admin/AdminClientsPage.module.css','utf8');
assert.match(css,/max-width:1800px/);assert.match(css,/width:78vw/);assert.match(css,/width:100vw/);
assert.match(css,/max-width:639px/);assert.match(css,/inventoryTable thead.*display:none/);
assert.match(css,/desktopSidebar.*display:none/);assert.match(css,/prefers-reduced-motion/);
const drawer=fs.readFileSync('src/components/admin/AdminClientSheet.tsx','utf8');
assert.match(drawer,/showModal/);assert.match(drawer,/aria-labelledby/);assert.match(drawer,/if \(!busy\) onClose/);assert.match(drawer,/previous.focus/);
console.log('PASS: create/success/manage presentation, confirmation busy/error states, native dialog focus contract, scoped sidebar and phone/tablet layout rules.');

const stackedAdd=render('individual',{createOpen:true});
assert.match(stackedAdd,/class="stackedFields"/);
assert.match(stackedAdd,/class="[^"]*primary[^"]*"[^>]*>Create Account/);
const clientDetail={type:'client',data:rows[0]};
const managed=render('individual',{detailsModal:clientDetail,detailsForm:{full_name:'Person 0',status:'active'}});
assert.match(managed,/class="detailStack"/);
assert.doesNotMatch(managed,/key="[^"]*" class="rounded-2xl/);
assert.ok(managed.indexOf('Account Actions')>managed.indexOf('detailStack'));
assert.match(render('individual',{detailsModal:clientDetail,detailsEditMode:true,detailsForm:{full_name:'Person 0'}}),/class="[^"]*primary[^"]*"[^>]*>Save Changes/);
const allIndividuals=render('individual',{fullListMode:'individual'});
assert.match(allIndividuals,/placeholder="Search"/);
assert.match(allIndividuals,/class="paginationPill" disabled=""[^>]*>Previous/);
assert.match(allIndividuals,/class="paginationPill"[^>]*>Next/);
assert.match(css,/stackedFields.*grid-template-columns:minmax\(0,1fr\)/);
assert.match(css,/detailStack.*grid-template-columns:minmax\(0,1fr\)/);
assert.match(css,/paginationPill.*border-radius:999px/);
assert.match(css,/paginationPill:disabled.*background:/);
assert.match(css,/primary.*color:var\(--admin-on-primary\)!important/);
console.log('PASS: Individual stacked create/manage/edit, lower Account Actions, explicit white primary text, Search placeholder and shaped disabled pagination.');

const compactEdit=render('individual',{detailsModal:clientDetail,detailsEditMode:true,detailsForm:{full_name:'Person 0',status:'active'}}).split('<dialog')[1];
assert.doesNotMatch(compactEdit,/Company Name|Account Type|Billing Status|>Subscription</);
assert.deepEqual([...compactEdit.matchAll(/aria-label="(Full Name|Email|Phone Number)"/g)].map(m=>m[1]),['Full Name','Email','Phone Number']);
assert.match(compactEdit,/aria-label="Client summary"/);
assert.match(compactEdit,/<dt>Plan<\/dt>/);assert.match(compactEdit,/<dt>Cards<\/dt>/);assert.match(compactEdit,/<dt>Status<\/dt>/);
console.log('PASS: Individual contact-only editor and compact display-only Plan/Cards/Status summary.');

for(const area of ['individual','business']){
 const pattern=new RegExp('class="inventoryTable compactInventory '+area+'Inventory"');
 assert.match(render(area),pattern);assert.match(render(area,{fullListMode:area}),pattern);
}
assert.match(css,/@media \(min-width:1024px\)/);
assert.match(css,/compactInventory td.*padding:6px 12px; font-size:13px/);
assert.match(css,/compactInventory td button.*min-height:44px/);
console.log('PASS: Recent/View All share scoped desktop density and column variants; touch targets retained.');
