// Actual protected route + actual Supabase HTTP query builder, fixture transport only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createClient } from '@supabase/supabase-js';
const plain = value => JSON.parse(JSON.stringify(value));
function load(file, deps={}, globals={}) {
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
 {exports,URL,URLSearchParams,console,...globals,require(name){assert.ok(name in deps,name);return deps[name];}});return exports;
}
const contract=load('src/lib/admin-card-support.ts');
const authHelper=load('src/lib/admin-auth.ts',{}, {process:{env:{DMI_ADMIN_CLERK_USER_IDS:'approved-admin'}}});
let identity={userId:'approved-admin'}, calls=[], fail=false, rows=[];
const published={id:'template',name:'Classic',status:'published',is_published:false};
const raw={id:'card',user_id:'owner',client_id:null,template_id:'template',card_name:'Primary',full_name:'Alex',company_name:'Example',slug:'alex-card',status:'draft',is_published:true,created_at:'2026-01-01',updated_at:'2026-01-02',template:published,
 email:'must-not-leak',phone:'must-not-leak',bio:'must-not-leak',custom_fields:{secret:true},lead_capture_settings:{secret:true},profile_image_url:'must-not-leak'};
// Fixture-side predicate interpreter: application still emits real PostgREST URLs.
function split(value){let depth=0,start=0,out=[];for(let i=0;i<value.length;i++){if(value[i]==='(')depth++;if(value[i]===')')depth--;if(value[i]===','&&depth===0){out.push(value.slice(start,i));start=i+1;}}out.push(value.slice(start));return out;}
function predicate(expression,row){
 if(expression.startsWith('and('))return split(expression.slice(4,-1)).every(x=>predicate(x,row));
 const [key,...parts]=expression.split('.'),op=parts.join('.'),value=row?.[key];
 if(op==='is.null')return value==null;
 if(op==='not.is.null')return value!=null;
 if(op.startsWith('ilike.'))return String(value||'').toLowerCase().includes(op.slice(7,-1).replaceAll('\\_','_').toLowerCase());
 if(op.startsWith('eq.'))return String(value)===op.slice(3);
 if(op.startsWith('neq.'))return value!=null&&String(value)!==op.slice(4);
 throw Error('Unhandled predicate '+expression);
}
const db=createClient('https://fixture.invalid','fixture-only-not-a-key',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(url,init)=>{
 const u=new URL(url);assert.equal(u.hostname,'fixture.invalid');assert.equal(u.pathname,'/rest/v1/cards');assert.ok(['GET','HEAD'].includes(init.method));
 calls.push({url:u,method:init.method});
 if(fail)return new Response(JSON.stringify({message:'private schema error',code:'PGRST200'}),{status:400});
 const select=u.searchParams.get('select');assert.doesNotMatch(select,/\*|email|phone|bio|media|lead|custom_fields|auth/);
 assert.equal(u.searchParams.get('business.account_type'),'in.(business,enterprise)');assert.equal(u.searchParams.get('individual.account_type'),'eq.individual');
 const matched=u.searchParams.get('matched_client.or');
 let result=rows.map(row=>({...row,business:['business','enterprise'].includes(row.client?.account_type)?row.client:null,individual:row.client?.account_type==='individual'?row.client:null,matched_client:!matched||split(matched.slice(1,-1)).some(x=>predicate(x,row.client))?row.client:null}));
 for(const [key,value] of u.searchParams){
  if(key==='or')result=result.filter(row=>split(value.slice(1,-1)).some(x=>predicate(x,row)));
  else if(['business','individual'].includes(key))result=result.filter(row=>predicate(key+'.'+value,row));
 }
 const count=result.length;
 if(init.method==='GET'){
  assert.equal(u.searchParams.get('order'),'updated_at.desc.nullslast,id.asc');assert.equal(u.searchParams.get('limit'),'25');
  result.sort((a,b)=>(b.updated_at||'').localeCompare(a.updated_at||'')||a.id.localeCompare(b.id));
  result=result.slice(Number(u.searchParams.get('offset')),Number(u.searchParams.get('offset'))+25);
 }
 return new Response(init.method==='HEAD'?null:JSON.stringify(result),{status:200,headers:{'Content-Type':'application/json','Content-Range':`0-${Math.max(0,result.length-1)}/${count}`}});
}}});
const server=load('src/lib/admin-card-support-server.ts',{'server-only':{},'next/server':{NextResponse:{json:(body,options={})=>({body,status:options.status||200,headers:options.headers})}},'@clerk/nextjs/server':{auth:async()=>identity},'@/lib/admin-auth':authHelper,'@/lib/supabase-admin':{createSupabaseAdminClient:()=>db},'@/lib/admin-card-support':contract});
const route=load('src/app/api/admin/cards/support/route.ts',{'@/lib/admin-card-support-server':server});
assert.deepEqual(Object.keys(route).sort(),['GET','dynamic','revalidate']);
async function get(query=''){const result=await route.GET({url:'https://local.invalid/api/admin/cards/support'+query});assert.equal(result.headers['Cache-Control'],'private, no-store');return result;}
for(identity of [{userId:null},{userId:'other',email:'admin@example.invalid'}]){calls=[];assert.equal((await get()).status,403);assert.equal(calls.length,0);}
identity={userId:'approved-admin'};
for(const q of ['?page=0','?page=-1','?page=10000','?page=1&page=2','?page=1.5','?account=paid','?publication=draft','?search=x%2Cor%28id.gt.0%29','?search=%25','?search='+('x'.repeat(81)),'?table=leads']){
 calls=[];assert.equal((await get(q)).status,400,q);assert.equal(calls.length,0);
}
rows=Array.from({length:31},(_,i)=>({...raw,id:String(i).padStart(3,'0'),slug:'card-'+i,full_name:'Owner '+i,client_id:i%3===0?'company':null,client:i%3===0?{id:'company',company_name:'Business_Co',account_type:'business',subscription_plan:'enterprise'}:null,status:i%2===0?'published':null,is_published:false}));
rows.push({...raw,id:'enterprise',client_id:'enterprise-client',client:{id:'enterprise-client',account_type:'enterprise',company_name:'Enterprise'},is_published:false,status:'draft'});
rows.push({...raw,id:'unknown',client_id:'missing',client:null,is_published:false,status:null});
rows.push({...raw,id:'unowned',user_id:null,client_id:null,is_published:null,status:null});
rows.push({...raw,id:'linked-individual',client_id:'person',client:{id:'person',account_type:'individual'},is_published:true,status:'draft'});
let result=await get();assert.equal(result.status,200);assert.equal(result.body.cards.length,25);assert.equal(result.body.total,35);assert.deepEqual(plain(result.body.summary),{total:35,published:17,unpublished:18,business:12,individual:21});
assert.ok(result.body.cards.every(card=>!('email' in card)&&!('custom_fields' in card)&&!('lead_capture_settings' in card)));
const firstIds=result.body.cards.map(c=>c.id);result=await get('?page=2');assert.equal(result.body.cards.length,10);assert.ok(result.body.cards.every(c=>!firstIds.includes(c.id)));
for(const [account,count] of [['business',12],['individual',21],['unknown',2]]){result=await get('?account='+account);assert.equal(result.body.total,count);assert.ok(result.body.cards.every(c=>c.accountType===account));}
result=await get('?publication=unpublished');assert.equal(result.body.total,18);assert.ok(result.body.cards.every(c=>!c.published));
result=await get('?account=business&publication=published&search=Business_Co');assert.equal(result.body.total,6);assert.ok(result.body.cards.every(c=>c.accountType==='business'&&c.published));assert.equal(result.body.summary.total,35);
result=await get('?search=card-30');assert.equal(result.body.cards.length,1);assert.equal(result.body.cards[0].id,'030');
result=await get('?search=no-match');assert.equal(result.body.total,0);assert.equal(result.body.cards.length,0);
result=await get('?page=9999');assert.equal(result.body.cards.length,0);
fail=true;result=await get();assert.equal(result.status,500);assert.ok(!JSON.stringify(result).includes('private schema error'));fail=false;
for(const slug of [null,'','../admin','a/b','https://evil.invalid','a?x=1','a#fragment',' a ','a%2Fb'])assert.equal(contract.supportPublicPath({...raw,slug},published),null);
assert.equal(contract.supportPublicPath(raw,published),'/u/alex-card');
assert.equal(contract.supportPublicPath({...raw,status:'draft',is_published:false},published),null);
assert.equal(contract.supportPublicPath(raw,{status:'draft',is_published:false}),null);
assert.equal(contract.supportPublicPath(raw,null),null);
const projection=server.projectSupportCard({...raw,public_url:'https://evil.invalid'});assert.equal(projection.publicPath,'/u/alex-card');assert.equal(projection.accountType,'individual');
assert.equal(server.projectSupportCard({...raw,user_id:null,company_name:'Business text is not identity'}).accountType,'unknown');
const source=fs.readFileSync('src/app/cards/page.tsx','utf8');assert.doesNotMatch(source,/supabase|mutateAdminCard|LegacyBusinessCards|method: "(?:POST|PATCH|PUT|DELETE)"/);
assert.match(source,/method: "GET"/);assert.match(source,/target="_blank" rel="noopener noreferrer"/);assert.match(source,/useAdminDialog\(onClose\)/);
assert.match(source,/overflow-x-auto/);assert.match(source,/max-h-\[90dvh\]/);assert.match(source,/md:hidden/);assert.doesNotMatch(source,/(?:bg|text)-(?:white|black)(?:\s|"|$)/);
const sidebar=fs.readFileSync('src/components/Sidebar.tsx','utf8');
const sections=[...sidebar.matchAll(/title: "([^"]+)"/g)].map(x=>x[1]);assert.deepEqual(sections,['Overview','Card Management','Individual','Business','Billing','Operations']);
const cardSection=sidebar.slice(sidebar.indexOf('title: "Card Management"'),sidebar.indexOf('title: "Individual"'));
assert.deepEqual([...cardSection.matchAll(/name: "([^"]+)"/g)].map(x=>x[1]),['Template Builder','Current Templates','Cards']);
assert.match(fs.readFileSync('src/lib/admin-auth.ts','utf8'),/"\/cards\(\.\*\)"/);
assert.match(fs.readFileSync('src/components/admin/legacy/LegacyBusinessCards.tsx','utf8'),/mutateAdminCard/);
console.log('PASS: actual Clerk ID authorization and GET-only route; real Supabase request construction; five bounded read queries; pagination/order/search/combined filters; global counts; individual/business/unknown linkage; OR publication parity; strict metadata projection; public-route gating; fail-closed errors; sidebar structure; read-only responsive/theme source contracts. No external requests/SQL.');

// Execute the page's real read lifecycle and handlers without mounting external APIs.
const jsx=(type,props)=>({type,props});
let slots=[],cursor=0,effects=[],pending=[],uiTree;
let confirmation=true, downloads=[];
const react={
 useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},
 useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],next=>{slots[i]=typeof next==='function'?next(slots[i]):next;}];},
 useEffect(fn,deps){const i=cursor++,previous=slots[i];if(previous&&deps.every((v,n)=>v===previous.deps[n]))return;previous?.cleanup?.();slots[i]={deps};effects.push(()=>{slots[i].cleanup=fn();});},
};
const pageCode=fs.readFileSync('src/app/cards/page.tsx','utf8')+'\nexport { PublicAction, CardDetails };';
const page={};
vm.runInNewContext(ts.transpileModule(pageCode,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{
 exports:page,URLSearchParams,AbortController,document:{body:{}},console,
 fetch:(url,options)=>{assert.equal(options.method,'GET');assert.equal(options.cache,'no-store');assert.equal(options.credentials,'same-origin');return new Promise(resolve=>pending.push({url,options,resolve}));},
 require(name){const deps={'@/components/AdminInteractionDialog':{useAdminInteraction:()=>({confirm:async()=>{return confirmation;},dialog:null})},'@/lib/admin-company-report':{downloadCompanyReport:report=>downloads.push(report)},'./cards.module.css':{default:{inventory:'inventory',filters:'filters'}},react,'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'fragment'},'react-dom':{createPortal:node=>node},'@/components/Sidebar':{default:()=>null},'@/hooks/useAdminDialog':{useAdminDialog:()=>({role:'dialog','aria-modal':true,tabIndex:-1})}};assert.ok(name in deps,name);return deps[name];},
});
function nodes(node){if(Array.isArray(node))return Array.from(node).flatMap(nodes);if(!node||typeof node!=='object')return [];return [node,...nodes(node.props?.children)];}
const textOf=node=>Array.isArray(node)?node.map(textOf).join(''):typeof node==='string'||typeof node==='number'?String(node):node?.props?textOf(node.props.children):'';
function render(){cursor=0;effects=[];uiTree=nodes(page.default());effects.forEach(fn=>fn());return uiTree;}
function control(predicate){const found=uiTree.filter(predicate);assert.equal(found.length,1,'unique control');return found[0];}
async function flush(){await new Promise(setImmediate);render();}
const sample={cards:[projection],page:1,pageSize:25,total:26,summary:{total:40,published:12,unpublished:28,business:10,individual:29}};
render();assert.equal(pending.length,1);assert.ok(uiTree.some(n=>n.props?.role==='status'));
control(n=>n.type==='select'&&nodes(n).some(x=>x.type==='option'&&x.props.value==='business')).props.onChange({target:{value:'business'}});render();
assert.equal(pending.length,2);assert.equal(pending[0].options.signal.aborted,true);
assert.equal(new URL(pending[1].url,'http://local').searchParams.get('account'),'business');
pending[1].resolve({ok:true,json:async()=>sample});await flush();
assert.ok(uiTree.some(n=>n.type==='table'));
pending[0].resolve({ok:true,json:async()=>({...sample,cards:[],total:0})});await flush();assert.ok(uiTree.some(n=>n.props?.['aria-label']==='View Details: Primary'),'stale result ignored');
control(n=>n.props?.['aria-label']==='View Details: Primary').props.onClick();render();
const detail=control(n=>n.type===page.CardDetails);assert.equal(detail.props.card.id,projection.id);
const detailTree=nodes(page.CardDetails(detail.props));assert.equal(detailTree[0].props.role,'dialog');assert.ok(detailTree.some(n=>n.props?.['data-dialog-initial-focus']===true));
assert.ok(!textOf(detailTree).includes('must-not-leak'));
detail.props.onClose();render();assert.ok(!uiTree.some(n=>n.type===page.CardDetails));
const publicLink=page.PublicAction({card:projection});assert.equal(publicLink.type,'a');assert.equal(publicLink.props.href,'/u/alex-card');assert.equal(publicLink.props.target,'_blank');assert.equal(publicLink.props.rel,'noopener noreferrer');
const disabled=nodes(page.PublicAction({card:{...projection,publicPath:null,unavailableReason:'Unavailable'}}));assert.ok(!disabled.some(n=>n.type==='a'));assert.ok(disabled.some(n=>n.type==='button'&&n.props.disabled));
control(n=>n.type==='button'&&textOf(n)==='Next').props.onClick();render();assert.equal(new URL(pending[2].url,'http://local').searchParams.get('page'),'2');
pending[2].resolve({ok:false,json:async()=>({error:'Inventory unavailable'})});await flush();assert.ok(uiTree.some(n=>n.props?.role==='alert'));assert.ok(!uiTree.some(n=>n.type==='table'));
control(n=>n.type==='button'&&textOf(n)==='Retry').props.onClick();render();assert.equal(pending.length,4);pending[3].resolve({ok:true,json:async()=>sample});await flush();
control(n=>n.type==='input').props.onChange({target:{value:'  Alex  '}});render();control(n=>n.type==='form').props.onSubmit({preventDefault(){}});render();
const searched=new URL(pending[4].url,'http://local');assert.equal(searched.searchParams.get('search'),'Alex');assert.equal(searched.searchParams.get('page'),'1');assert.equal(searched.searchParams.get('account'),'business');
pending[4].resolve({ok:true,json:async()=>({...sample,cards:[],total:0})});await flush();assert.ok(uiTree.some(n=>textOf(n).includes('No cards found')));

// Read-only workspace retains company CSV, with no Unpublish on published cards.
slots=[]; pending=[]; render();
const businessCard={...projection,clientId:'company-id',accountType:'business',company:'Example Company'};
pending[0].resolve({ok:true,json:async()=>({...sample,cards:[businessCard]})});await flush();
assert.ok(!uiTree.some(n=>String(n.props?.['aria-label']||'').startsWith('Unpublish:')));
const exportButton=()=>control(n=>n.props?.['aria-label']==='Export company CSV: Example Company');
confirmation=false;exportButton().props.onClick();await flush();assert.equal(pending.length,1);
confirmation=true;exportButton().props.onClick();exportButton().props.onClick();await flush();assert.equal(pending.length,2);
const exportUrl=new URL(pending[1].url,'http://local');assert.equal(exportUrl.pathname,'/api/admin/cards/support/export');assert.equal(exportUrl.searchParams.get('clientId'),'company-id');assert.equal(exportUrl.searchParams.get('search'),'');assert.equal(exportUrl.searchParams.has('page'),false);
pending[1].resolve({ok:true,json:async()=>({csv:'fixture',filename:'company.csv',count:1})});await flush();assert.equal(downloads.length,1);
exportButton().props.onClick();await flush();pending[2].resolve({ok:false,json:async()=>({error:'Export failed'})});await flush();assert.equal(downloads.length,1);assert.ok(uiTree.some(n=>n.props?.role==='alert'&&textOf(n)==='Export failed'));
slots=[];pending=[];render();pending[0].resolve({ok:true,json:async()=>sample});await flush();
assert.ok(!uiTree.some(n=>String(n.props?.['aria-label']||'').startsWith('Export company CSV:')));
assert.ok(!uiTree.some(n=>String(n.props?.['aria-label']||'').startsWith('Unpublish:')));
console.log('PASS: no Card Management mutation dependency or Unpublish action; company CSV cancel/duplicate guard/scope/download/error; no individual export.');

console.log('PASS: actual support UI loading/error/retry/empty lifecycle; stale requests ignored; filter changes reset pagination; GET-only search/page requests; details open/close; metadata-only modal; same-origin new-tab links and disabled unavailable actions.');

// One responsive inventory: no duplicated mobile handlers or hidden data branch.
const density = fs.readFileSync('src/app/cards/cards.module.css', 'utf8');
assert.match(source, /styles\.inventory/);
assert.match(source, /styles\.filters/);
assert.equal((source.match(/inventory\.cards\.map/g)||[]).length,1);
assert.match(density, /font-size: 0\.875rem/);
assert.match(density, /padding: 0\.5rem 0\.625rem/);
assert.match(density, /text-overflow: ellipsis/);
assert.match(density, /white-space: nowrap/);
assert.match(density, /@media \(max-width: 767px\)/);
assert.match(density, /min-width: 0/);
assert.match(density, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
assert.match(density, /content: attr\(data-label\)/);
assert.match(density, /overflow-wrap: anywhere/);
assert.match(density, /min-height: 2\.75rem/);
assert.match(source, /<table role="table">/);
assert.deepEqual([...source.matchAll(/data-label="([^"]+)"/g)].map(m=>m[1]), ['Card Owner / Name','Company','Account Type','Template','Status','Published state','Public URL / slug','Last Updated','Actions']);
assert.match(source, /<code data-public-slug[^>]*>\{card\.publicPath \|\| card\.slug \|\| "No slug"\}/);
assert.match(source, /\["Public route", card\.publicPath\], \["Stored slug", card\.slug\]/);
assert.match(source, /<p className="font-medium">\{card\.ownerName/);
assert.match(source, /<p className="mt-1 text-xs text-\[var\(--dmi-muted\)\]">\{card\.name\}/);
console.log('PASS: compact desktop cell spacing and badges; single labelled mobile card grid; retained full slug and details; desktop action sizing and 44px mobile targets; theme tokens and explicit table semantics. Source/handler verification, not browser visual measurement.');
