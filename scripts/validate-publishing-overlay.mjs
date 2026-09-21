import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const page=fs.readFileSync('src/app/client/cards/page.tsx','utf8');
const ast=ts.createSourceFile('page.tsx',page,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const functions={};
function visit(n){if(ts.isFunctionDeclaration(n)&&['handleSaveCard','changeEditorStep'].includes(n.name?.text))functions[n.name.text]=n.getText(ast);ts.forEachChild(n,visit);}visit(ast);
const compile=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
let publishing=null,success=null,saveStatus='',error='',calls=0,resolveSave,rejectSave;
let draft={id:'card-1',first_name:'Test',last_name:'User',company_logo_url:'card-media:retained'};
let pending;
const reset=()=>{publishing=null;success=null;pending=new Promise((resolve,reject)=>{resolveSave=resolve;rejectSave=reject;});};
const ctx={console:{error(){}},publishLock:{current:false},validateEditorStepTransition:()=>true,
 setPublishing:v=>{publishing=v;},startClientMediaTiming:()=>()=>{},normalizeCardPhoneFields:x=>x,
 draftCard:draft,setSaveError:v=>{error=v;},setSaveMessage(){},setSaveStatus:v=>{saveStatus=v;},getActiveUserForCardSave:async()=>({id:'owner'}),
 templateForCard:()=>({id:'template',name:'Template'}),adminTemplates:[],currentPlan:'pro',buildCardSlugBase:()=> 'test',hasVisitedActionsStep:false,
 buildPublicCardUrl:s=>'https://app.dmicards.com/u/'+s,fieldOrder:{},normalizeLeadCaptureSettings:x=>x,
 saveCardToSupabase:async()=>{calls++;return pending;},databaseReady:true,panelMode:'edit',
 setCards:fn=>fn([draft]),sortCardsBySlotOrder:x=>x,setDraftCard:v=>{draft=v;},setPanelMode(){},setSelectedCardId(){},
 setPublishedSuccessCard:v=>{success=v;},setShowBuilder(){},finishPublishing(){ctx.publishLock.current=false;publishing=null;},
 activeStep:3,setActiveStep(){throw Error('Navigation must be blocked');},router:{replace(){}}
};
vm.runInNewContext(compile(Object.values(functions).join('\n')),ctx);
reset();const save=ctx.handleSaveCard('published');assert.equal(publishing,'pending');assert.equal(ctx.publishLock.current,true);
for(let i=0;i<10;i++) await Promise.resolve();assert.equal(calls,1);assert.equal(success,null);
await ctx.handleSaveCard('published');assert.equal(calls,1,'synchronous lock prevents duplicate saves');
ctx.changeEditorStep(2);assert.equal(publishing,'pending');
const saved={...draft,edit_revision:'fresh'};resolveSave(saved);await save;
assert.equal(success,saved);assert.equal(publishing,'finishing');assert.equal(ctx.publishLock.current,true,'blocked until trace completes');
ctx.finishPublishing();assert.equal(publishing,null);assert.equal(ctx.publishLock.current,false);
reset();const original=draft;const failed=ctx.handleSaveCard('published');for(let i=0;i<10;i++) await Promise.resolve();rejectSave(Error('Safe save failure'));await failed;
assert.equal(publishing,null);assert.equal(ctx.publishLock.current,false);assert.equal(saveStatus,'failed');assert.ok(error);assert.equal(draft,original,'failure retains editor data');assert.equal(success,null);
assert.ok(page.includes('inert={publishing !== null}'),'all editor inputs, close and navigation are inert');
assert.ok(page.includes('onClose={() => { if (!publishLock.current) setShowBuilder(false); }}'));
assert.ok(page.includes('<PublishSuccessState'),'existing success UI retained');
const source=fs.readFileSync('src/components/card-builder/PublishingOverlay.tsx','utf8');
let effects=[],reduced=false,finished=0,timers=[];
const jsx=(type,props)=>({type,props});const exports={};
vm.runInNewContext(compile(source),{exports,document:{activeElement:null,hidden:false,addEventListener(){},removeEventListener(){}},window:{matchMedia:()=>({matches:reduced,addEventListener(){},removeEventListener(){}}),setTimeout:fn=>{timers.push(fn);return 1;},clearTimeout(){}},require(name){if(name==='react')return{useRef:()=>({current:null}),useEffect:fn=>effects.push(fn)};if(name==='react/jsx-runtime')return{jsx,jsxs:jsx};if(name.endsWith('.css'))return{default:{}};throw Error(name);}});
function render(finishing){effects=[];timers=[];return exports.default({finishing,onFinished:()=>{finished++;}});}
let tree=render(false);effects[1]();assert.equal(finished,0);assert.equal(timers.length,0);
const uses=tree.props.children.props.children[0].props.children;
uses[1].props.onAnimationIteration();assert.equal(finished,0,'cycle while pending cannot show success');
tree=render(true);effects[1]();assert.equal(finished,0);assert.equal(timers.length,1);tree.props.children.props.children[0].props.children[1].props.onAnimationIteration();assert.equal(finished,1);
reduced=true;render(true);effects[1]();assert.equal(finished,2);assert.equal(timers.length,0,'reduced motion completes without waiting');
const css=fs.readFileSync('src/components/card-builder/PublishingOverlay.module.css','utf8');
assert.match(css,/stroke-dashoffset/);assert.match(css,/1\.8s linear infinite/);assert.match(css,/prefers-reduced-motion: reduce[^}]*animation: none/s);
const svg=fs.readFileSync('public/devmaster-publishing-outline.svg','utf8');assert.equal((svg.match(/<path /g)||[]).length,2);assert.ok(svg.length<2000);assert.ok(!/<image|data:|href=/.test(svg));assert.match(svg,/viewBox="0 0 600 600"/);
console.log('PASS: actual save handler pending/double-submit/navigation/success/failure; inert close guard; cycle boundary and reduced-motion completion; two lightweight raster-free vector paths.');

const cardTree=render(false).props.children;
const stages=cardTree.props.children.find(n=>n?.type==='ul');
assert.equal(stages.props['aria-label'],'Publishing stages');
assert.deepEqual(Array.from(stages.props.children,n=>n.props.children),['Uploading media','Saving changes','Finalising']);
for(const stage of stages.props.children) assert.equal(stage.props['aria-current'],undefined,'stages do not pretend measured progress');
assert.ok(cardTree.props.children.some(n=>n?.props?.children==='Saving your latest changes and media.'));
assert.ok(cardTree.props.children.some(n=>n?.props?.children==='Please don’t close this window or navigate away.'));
assert.match(css,/background: #fff/);assert.match(css,/width: min\(100%, 480px\)/);
console.log('PASS: white responsive card, neutral three-stage list and requested supporting/warning copy.');
