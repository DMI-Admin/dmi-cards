// Offline Phase 2B preservation checks: compare executable handlers to the approved baseline.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';
const base='6404db489dad91d403543722b96e7384f35a83ac';
const read=file=>fs.readFileSync(file,'utf8');
const old=file=>execFileSync('git',['show',`${base}:${file}`],{encoding:'utf8'});
function inspect(file,source,name){
 const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);
 const logic=[];for(const st of fn.body.statements){if(ts.isReturnStatement(st))break;let text=st.getText(ast);if(text==='const [menuOpen, setMenuOpen] = useState(false);')continue;text=text.replace('const [menu,setMenu]=useState(false),','const ');logic.push(text);}
 const handlers=[];function walk(node){if(ts.isJsxAttribute(node)&&/^on[A-Z]/.test(node.name.getText(ast))){const text=node.getText(ast);if(!/setMenuOpen|setMenu\(!menu\)/.test(text))handlers.push(text);}ts.forEachChild(node,walk);}walk(ast);
 return {logic,handlers,ast};
}
for(const [file,name] of [['src/components/admin/AdminClientsPage.tsx','AdminClientsPage'],['src/components/admin/BusinessOnboardingPage.tsx','BusinessOnboardingPage']]){
 const before=inspect(file,old(file),name),after=inspect(file,read(file),name);
 assert.deepEqual(after.logic,before.logic,`${name}: all loading/state/business logic unchanged except retired navigation state`);
 assert.deepEqual(after.handlers,before.handlers,`${name}: all non-navigation JSX event handlers unchanged`);
 assert.match(read(file),/<AdminShell>/);assert.match(read(file),/<AdminPageHeader/);
 assert.doesNotMatch(read(file),/Sidebar|menuOpen|setMenuOpen|setMenu\(|<main/);
 const beforeFns=before.ast.statements.filter(ts.isFunctionDeclaration),afterFns=after.ast.statements.filter(ts.isFunctionDeclaration);
 for(const fn of beforeFns){if([name,'StatCard','StatusBadge'].includes(fn.name.text))continue;assert.equal(afterFns.find(n=>n.name.text===fn.name.text)?.getText(after.ast),fn.getText(before.ast),`${fn.name.text} helper unchanged`);}
}
for(const file of ['src/components/admin/AdminClientsPage.module.css','src/components/admin/BusinessOnboardingPage.module.css']){
 assert.ok((read(file).match(/!important/g)||[]).length<=(old(file).match(/!important/g)||[]).length);
 assert.doesNotMatch(read(file),/desktopSidebar|mobileSidebar|menuButton|menuOpen|flex:0 0 288px|padding:32px clamp/);
 assert.match(read(file),/var\(--admin-/);assert.match(read(file),/max-width:639px/);
}
const clients=read('src/components/admin/AdminClientsPage.tsx');
assert.match(clients,/status === "active" \? "success" : status === "pending" \? "completion" : "critical"/);
assert.match(clients,/<AdminStatusBadge label=\{status\} tone=\{tone\}/);
assert.match(clients,/<AdminSurface className=\{styles.stat\}/);
const business=read('src/components/admin/BusinessOnboardingPage.tsx');
assert.match(business,/<AdminKpiCard key=\{key\} label=\{label\} value=\{summary\?\.\[key\]\?\?"—"\}/);
// Cards presentation is owned by Phase 2C's cards/templates validator; client/card contracts remain pinned below.
for(const file of ['src/components/admin/AdminClientSheet.tsx','src/components/admin/BusinessEntitlementPanel.tsx','src/components/admin/AdminShell.tsx','src/components/admin/AdminShell.module.css','src/components/Sidebar.tsx','src/components/Sidebar.module.css','src/components/CardRenderer.tsx','src/lib/admin-inventory.ts','src/lib/admin-client-contract.ts','src/lib/admin-card-mutations.ts','src/lib/admin-client-lists.ts','src/lib/business-onboarding-contract.ts','src/lib/business-entitlement-contract.ts','src/lib/business-onboarding-server.ts','src/lib/business-entitlement-server.ts','src/app/clients/individual/page.tsx','src/app/clients/business/page.tsx','src/app/clients/page.tsx','src/app/business-onboarding/page.tsx','src/app/finance/page.tsx','src/app/subscriptions/page.tsx'])assert.equal(read(file),old(file),`${file} unchanged`);
console.log('PASS: existing handlers, loading/mutation/import/preview helpers, unsaved-navigation guards, entitlement panel, sheets, routes and shared shell unchanged; only duplicate navigation and presentation consolidated; no new important hacks.');
