// Execute the actual page coordinator with an in-memory React hook harness.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
let slots=[], cursor=0, effects=[], changed=false, context;
const React={
 createContext:()=>({Provider:'provider'}),useContext:()=>context,
 useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],value=>{const next=typeof value==='function'?value(slots[i]):value;if(next!==slots[i]){slots[i]=next;changed=true;}}];},
 useMemo:fn=>fn(),useCallback:fn=>fn,useLayoutEffect:fn=>effects.push(fn)
};
const jsx=(type,props)=>({type,props});
function load(file,deps={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require:name=>{if(name==='react')return React;if(name==='react/jsx-runtime')return {jsx,jsxs:jsx};assert.ok(name in deps,name);return deps[name];}});return exports;}
const contract=load('src/lib/page-card-readiness.ts');
const {default:Boundary,InventoryCardReadiness}=load('src/components/InitialCardsReadyBoundary.tsx',{'@/lib/page-card-readiness':contract});
let props,tree;
function render(){let loops=0;do{changed=false;cursor=0;effects=[];tree=Boundary(props);for(const effect of effects)effect();assert.ok(++loops<10);}while(changed);return tree;}
const busy=()=>tree.props.children.props['aria-busy'];
const report=(id,ready)=>tree.props.value(id,ready);
function reset(expected){slots=[];props={children:'mounted inventory',resolved:false,expected,generation:{}};render();assert.equal(busy(),true);props.resolved=true;render();}
reset(['one']);assert.equal(busy(),true);report('one',false);render();assert.equal(busy(),true);report('one',true);render();assert.equal(busy(),false);
// The one-time latch survives background refresh and later media changes.
props={...props,resolved:false,expected:['new'],generation:{}};render();report('new',false);render();assert.equal(busy(),false);
reset(['one','two','three']);for(const id of ['one','two']){report(id,true);render();assert.equal(busy(),true);}report('three',true);render();assert.equal(busy(),false);
reset([]);assert.equal(busy(),false,'empty inventory reveals without registration');
reset(['unavailable']);context=tree.props.value;effects=[];InventoryCardReadiness({id:'unavailable',unavailable:true,children:'Preview unavailable'});effects.forEach(f=>f());render();assert.equal(busy(),false);
reset(['one']);const obsolete=tree.props.value;props.generation={};render();obsolete('one',true);render();assert.equal(busy(),true,'obsolete generation cannot reveal');report('one',true);render();assert.equal(busy(),false);
for(const settlement of ['failed','timed-out']){reset(['one']);report('one',true);render();assert.equal(busy(),false,settlement+' settlement releases loader');}
reset(['one']);const content=tree.props.children.props.children[0];assert.equal(content.props.children,'mounted inventory');assert.equal(content.props.inert,true);assert.equal(content.props['aria-hidden'],true);assert.equal(content.props.style.opacity,0);assert.notEqual(content.props.style.display,'none');
const page=fs.readFileSync('src/app/client/cards/page.tsx','utf8');assert.ok(page.indexOf('<InitialCardsReadyBoundary')>page.indexOf('<ClientPortalPage>'));assert.doesNotMatch(page,/Loading your templates and cards/);assert.match(page,/inventoryCardSlots\(cards, isPaid\)\.filter\(slot => !slot.locked && slot.card\)/);assert.match(page,/<InventoryCardReadiness id=\{card.id\} unavailable=\{!previewTemplate\}/);
const source=fs.readFileSync('src/components/InitialCardsReadyBoundary.tsx','utf8');assert.doesNotMatch(source,/fetch\(|setTimeout\(|setInterval\(/);assert.match(source,/\/dmi-cards-logo.svg/);assert.match(source,/role="status"/);assert.match(source,/motion-safe:animate-pulse/);
console.log('PASS: actual coordinator one/three cards, empty/unavailable, failure/timeout settlement, obsolete generation ignored, reveal latch, mounted/inert content, existing brand and no additional requests/timers.');

// Viewport-sized initial container cannot recenter when hidden inventory grows.
reset(['one']);
const container=tree.props.children;
assert.equal(container.props.style.height,'max(20rem, calc(100svh - 8rem))');
assert.equal(container.props.style.overflow,'hidden');
const overlay=container.props.children[1];
assert.match(overlay.props.className,/absolute inset-0/);
const logo=overlay.props.children[0];
assert.equal(logo.props.width,240);assert.equal(logo.props.height,96);
for (const child of ['empty inventory', 'one card mounted', 'three tall card previews mounted']) {
 props.children=child;render();
 assert.equal(tree.props.children.props.style.height,container.props.style.height);
 assert.equal(tree.props.children.props.style.overflow,'hidden');
 assert.equal(tree.props.children.props.children[0].props.children,child,'hidden inventory remains mounted');
}
report('one',true);render();assert.equal(tree.props.children.props.style,undefined,'finished inventory resumes natural sizing');
console.log('PASS: stable content-only viewport-height overlay, larger responsive logo, natural finished layout restored. Browser visual verification remains separate.');
