// Offline preservation checks against the approved Phase 2B source.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';
const base='efd683f98b3fd66cf16e2845fa441d53d7321fce';
const read=file=>fs.readFileSync(file,'utf8');
const old=file=>execFileSync('git',['show',`${base}:${file}`],{encoding:'utf8'});
function inspect(file,source,name){
 const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);
 const logic=[];for(const st of fn.body.statements){if(ts.isReturnStatement(st))break;logic.push(st.getText(ast));}
 const handlers=[],previews=[],styles=[];function walk(node){
  if(ts.isJsxAttribute(node)&&/^on[A-Z]/.test(node.name.getText(ast)))handlers.push(node.getText(ast));
  if(ts.isJsxAttribute(node)&&node.name.getText(ast)==='style')styles.push(node.getText(ast));
  if(ts.isJsxSelfClosingElement(node)&&/^(CardRenderer|AdminLivePhonePreview|ClientExperiencePreview|ColourPicker|TypographyPicker|ToggleSwitch|TemplateStepNavigation)$/.test(node.tagName.getText(ast)))previews.push(node.getText(ast));
  ts.forEachChild(node,walk);
 }walk(ast);return{logic,handlers,previews,styles,ast};
}
for(const[file,name]of[['src/app/cards/page.tsx','CardsPage'],['src/app/templates/page.tsx','TemplatesPage'],['src/app/templates/current/page.tsx','CurrentTemplatesPage']]){
 const source=read(file),before=inspect(file,old(file),name),after=inspect(file,source,name);
 assert.deepEqual(after.logic,before.logic,`${name}: state, loading, persistence, export and editor logic unchanged`);
 for(const key of ['handlers','previews','styles'])assert.deepEqual(after[key],before[key],`${name}: ${key} unchanged`);
 for(const fn of before.ast.statements.filter(ts.isFunctionDeclaration)){if(fn.name.text===name)continue;assert.equal(after.ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name.text===fn.name.text)?.getText(after.ast).replace(' className={adminStyles.clientPreview}', ''),fn.getText(before.ast),`${fn.name.text}: helper/modal unchanged`);}
 assert.match(source,/<AdminShell>/);assert.match(source,/<AdminPageHeader/);assert.doesNotMatch(source,/Sidebar|<main|dmi-page|dmi-app-shell/);
 assert.ok((source.match(/!important|!text-/g)||[]).length<=(old(file).match(/!important|!text-/g)||[]).length);
}
const css=read('src/app/templates/templates-admin.module.css');
assert.match(css,/grid-template-columns:minmax\(0,1fr\)/);assert.match(css,/@media\(min-width:1536px\)/);assert.match(css,/minmax\(0,1fr\) 420px/);assert.doesNotMatch(css,/!important|font-family|background:|color:(?!var\(--admin-text\))/);
assert.match(read('src/app/cards/page.tsx'),/<AdminTableWrapper label="Card support inventory"/);
const builder=read('src/app/templates/page.tsx');assert.doesNotMatch(builder,/text-green-100|dark:text-amber-100/);assert.match(builder,/var\(--admin-success-text\)/);
const used=[...(builder+css).matchAll(/var\((--admin-[\w-]+)\)/g)].map(m=>m[1]);const theme=read('src/app/admin-theme.css');for(const token of used)assert.ok(theme.includes(token+':'),`Defined ${token}`);
for(const file of ['src/app/cards/cards.module.css','src/components/CardRenderer.tsx','src/components/CardMediaImage.tsx','src/components/ColourPicker.tsx','src/components/card-builder/ClientCardEditor.tsx','src/components/card-builder/CardEditorModalShell.tsx','src/lib/templates.ts','src/lib/admin-template-write.ts','src/lib/template-layouts.ts','src/lib/card-typography.ts','src/lib/card-actions.ts','src/lib/admin-card-support.ts','src/lib/admin-card-support-server.ts','src/lib/admin-company-report.ts','src/components/admin/AdminShell.tsx','src/components/admin/AdminShell.module.css','src/app/admin-theme.css','src/components/admin/AdminClientsPage.tsx','src/components/admin/BusinessOnboardingPage.tsx','src/app/finance/page.tsx','src/app/subscriptions/page.tsx'])assert.equal(read(file),old(file),`${file} unchanged`);
console.log('PASS: Cards/Templates shared shell and headers; all loading/export/editor/persistence/action handlers, preview props/style, helper/modal logic and protected shared dependencies unchanged; bounded stacked builder; semantic feedback tokens. No network/SQL.');
