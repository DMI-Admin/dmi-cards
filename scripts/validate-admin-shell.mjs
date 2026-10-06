// Offline presentation/navigation contract checks; no hosted services.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
let pathname='/subscriptions', signedOut=0;
const window={location:{href:''}};
const jsx=(type,props)=>({type,props});
const styles=new Proxy({}, {get:(_,key)=>String(key)});
const exports={};
const source=fs.readFileSync('src/components/Sidebar.tsx','utf8');
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,window,require:name=>{
 if(name==='react/jsx-runtime')return {jsx,jsxs:jsx};
 if(name==='next/navigation')return {usePathname:()=>pathname};
 if(name==='@clerk/nextjs')return {useClerk:()=>({signOut:async()=>{signedOut++;}})};
 if(name==='lucide-react')return styles;
 if(name==='next/link')return {default:'Link'};
 if(name==='next/image')return {default:'Image'};
 assert.equal(name,'./Sidebar.module.css');return {default:styles};
}});
function nodes(root){return !root||typeof root!=='object'?[]:Array.isArray(root)?root.flatMap(nodes):[root,...nodes(root.props?.children)];}
const expected=['/admin/dashboard','/templates','/templates/current','/cards','/clients/individual','/business-onboarding','/clients/business','/subscriptions','/finance','/analytics','/uploads','/support','/audit-logs','/system-health','/security','/settings'];
for(const path of ['/subscriptions','/templates','/templates/current','/templates/current/example','/cards/example']){
 pathname=path;
 for(const variant of ['default','compact']){
  const tree=exports.default({variant}), all=nodes(tree), links=all.filter(n=>n.type==='Link');
  assert.deepEqual(links.map(n=>n.props.href),expected);
  const expectedActive=path.startsWith('/templates/current')?'/templates/current':path.startsWith('/cards/')?'/cards':path;
  assert.deepEqual(links.filter(n=>n.props['aria-current']==='page').map(n=>n.props.href),[expectedActive]);
  if(variant==='compact')assert.equal(tree.props.className,'compact');
  else assert.ok(tree.props.className.includes('w-72'));
  await all.find(n=>n.type==='button').props.onClick();
  assert.equal(window.location.href,'/admin');
 }
}
assert.equal(signedOut,10);
assert.ok(exports.default({}).props.className.includes('w-72'));
const shell=fs.readFileSync('src/components/admin/AdminShell.tsx','utf8');
for(const contract of ['showModal()','node.close()','onCancel','getBoundingClientRect()','previous.focus()','event.key !== "Tab"','document.body.style.overflow = overflow','document.documentElement.style.overflow = htmlOverflow','aria-expanded={open}','aria-label="Admin navigation"']) assert.ok(shell.includes(contract),contract);
assert.doesNotMatch(shell,/fetch\(|supabase|stripe|useClerk|requireAdminAccess/);
const css=fs.readFileSync('src/components/admin/AdminShell.module.css','utf8');
assert.ok(css.includes('248px')&&css.includes('max-width:1199px')&&css.includes('max-width:1600px'));
const sidebarCss=fs.readFileSync('src/components/Sidebar.module.css','utf8');
assert.doesNotMatch(sidebarCss,/!important|gradient|box-shadow/);
assert.ok(sidebarCss.includes('min-height:44px')&&sidebarCss.includes('focus-visible'));
const page=fs.readFileSync('src/app/subscriptions/page.tsx','utf8');
assert.ok(page.includes('<AdminShell>'));assert.doesNotMatch(page,/<main|<Sidebar|<details/);
console.log('PASS: identical destinations, default variant, active-route exceptions, sign-out, shell isolation and drawer accessibility source contracts. Browser verification still required.');
