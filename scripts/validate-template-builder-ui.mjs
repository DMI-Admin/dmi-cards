// Real page handlers and release contracts, synthetic templates, no network/DB.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const plain = x => JSON.parse(JSON.stringify(x));
const jsx = (type, props) => ({type, props});
let slots, cursor, effects, rows, requests, location, confirmAnswer=true, promptAnswer='Duplicate name', confirmations=[], tree;
const same=(a,b)=>a && b && a.length===b.length && a.every((v,i)=>v===b[i]);
const react={
 useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value;}];},
 useRef(initial){const i=cursor++;return slots[i] ||= {current:initial};},
 useMemo(fn,deps){const i=cursor++;if(!same(slots[i]?.deps,deps))slots[i]={deps,value:fn()};return slots[i].value;},
 useCallback(fn,deps){return react.useMemo(()=>fn,deps);},
 useEffect(fn,deps){const i=cursor++;if(!same(slots[i],deps)){slots[i]=deps;effects.push(fn);}},
};
const noopComponent=()=>null;
const cache={};
const deps={
 react,'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'fragment'},
 'next/navigation':{useRouter:()=>({push:url=>{location.search=new URL(url,'http://local').search;}})},
 'lucide-react':new Proxy({}, {get:(_,key)=>key}),
 '@/lib/supabase':{},
 '@/components/CardRenderer':{default:noopComponent,displayName:c=>c.full_name||''},
 '@/hooks/useAdminDialog':{useAdminDialog:()=>({})},
 '@/components/AdminInteractionDialog':{useAdminInteraction:()=>({dialog:null,confirm:async message=>{confirmations.push(message);return confirmAnswer;},prompt:async()=>promptAnswer})},
 '@/components/card-builder/ClientCardEditor':{EditorPanel:'EditorPanel',PreviewPanelContent:'PreviewPanelContent',EditorStepNavigation:'EditorStepNavigation',findDevice:()=>({}),filterDeviceGroups:()=>[],previewFrameDimensions:()=>({})},
};
async function fetchMock(url,init={}) {
 assert.ok(url.startsWith('/api/admin/templates'),`Unexpected endpoint ${url}`);
 if(init.method==='GET')return {ok:true,json:async()=>({templates:plain(rows)})};
 const id=url.split('/').at(-1),payload=init.body?JSON.parse(init.body):undefined;
 requests.push({method:init.method,id,payload});
 if(init.method==='DELETE'){rows=rows.filter(r=>r.id!==id);return {ok:true,json:async()=>({})};}
 const existing=init.method==='PATCH'?rows.find(r=>r.id===id):undefined;
 const patch=load('@/lib/admin-template-write').validateAdminTemplateWrite(payload,existing);
 const saved={...existing,...patch,id:existing?.id||'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'};
 rows=[saved,...rows.filter(r=>r.id!==saved.id)];
 return {ok:true,json:async()=>({template:plain(saved)})};
}
function load(name) {
 if(name.endsWith('.module.css'))return {default:{page:'page',builderGrid:'builderGrid',livePreview:'livePreview'}};
 if(deps[name])return deps[name];
 if(cache[name])return cache[name];
 if(name.startsWith('@/components/'))return {default:noopComponent};
 assert.ok(name.startsWith('@/'),name);
 let path='src/'+name.slice(2);path+=fs.existsSync(path+'.ts')?'.ts':'.tsx';
 const exports={};cache[name]=exports;
 const extra=name==='@/app/templates/page'?'\nexport {ClientExperiencePreview};':'';
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(path,'utf8')+extra,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{
  exports,require:load,fetch:fetchMock,URLSearchParams,console,crypto:{randomUUID:()=> 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'},
  window:{get location(){return location;},scrollTo(){},addEventListener(){},removeEventListener(){}},document:{body:{style:{}}},
 });return exports;
}
const builder=load('@/app/templates/page'),catalogue=load('@/app/templates/current/page');
function nodes(node){if(Array.isArray(node))return Array.from(node).flatMap(nodes);if(!node||typeof node!=='object')return [];return [node,...nodes(node.props?.children)];}
const text=node=>Array.isArray(node)?node.map(text).join(''):typeof node==='string'||typeof node==='number'?String(node):node?.props?text(node.props.children):'';
let Component;
function render(){cursor=0;effects=[];tree=nodes(Component());effects.forEach(fn=>fn());return tree;}
async function settle(){for(let i=0;i<5;i++){await new Promise(setImmediate);render();}}
async function mount(component,fixtures=[],search=''){Component=component;slots=[];rows=plain(fixtures);requests=[];confirmations=[];location={search};render();await settle();}
function one(predicate){const found=tree.filter(predicate);assert.equal(found.length,1,'unique UI control');return found[0];}
function button(label){return one(n=>n.type==='button'&&text(n)===label);}
function navigate(step){one(n=>n.type?.name==='TemplateStepNavigation').props.onStepChange(step);render();}
async function save(){navigate('review');button(rows.some(r=>r.id===new URLSearchParams(location.search).get('edit'))?'Update Template':'Save New Template').props.onClick();await settle();}
const id='11111111-1111-1111-1111-111111111111';
const base={id,name:'  Bespoke preserved name  ',slug:null,layout_type:'brand_paid',access_level:'paid',status:'draft',is_published:false,
 allowed_fonts:['Inter'],default_font:'Inter',custom_colour_allowed:false,custom_text_colour_allowed:false,free_colour_palette:['#112233','#445566'],text_colours:['#FFFFFF','#EEEEEE'],gradient_enabled:false,
 allowed_fields:['first_name','last_name','email'],custom_fields:{personal:['first_name','last_name'],contact:['email']},field_config:{sections:{personal:['first_name','last_name'],contact:['email']},private_metadata:{keep:true}},renderer_options:{private_metadata:{keep:true}},profile_image_allowed:false,logo_allowed:false,banner_allowed:false};
for(const layout_type of ['brand_paid','premium_classic','glassmorphism','banner_card','split_card','monogram_card','unexpected',null]){
 await mount(builder.default,[{...base,layout_type}],`?edit=${id}`);
 assert.equal(one(n=>n.type==='input'&&n.props['aria-label']==='Template name').props.value,base.name);
 assert.ok(tree.filter(n=>n.type==='select').every(n=>n.props.disabled));
 await save();assert.equal(requests.length,1);assert.equal(requests[0].id,id);assert.deepEqual(requests[0].payload,{});
 assert.deepEqual(rows[0],{...base,layout_type},'no-op edit preserves every raw stored field');
}
await mount(builder.default,[{...base,is_published:true,status:'published'}],`?edit=${id}`);
await save();assert.equal(requests.length,0,'live edits require confirmation');
one(n=>n.type?.name==='LiveTemplateUpdateModal').props.onCancel();render();assert.equal(requests.length,0);
await save();one(n=>n.type?.name==='LiveTemplateUpdateModal').props.onConfirm();await settle();
assert.deepEqual(requests[0].payload,{});assert.equal(rows[0].is_published,true);
await mount(builder.default,[base],`?edit=${id}`);
one(n=>n.type==='input'&&n.props['aria-label']==='Template name').props.onChange({target:{value:'Explicit rename'}});render();await save();
assert.deepEqual(requests[0].payload,{name:'Explicit rename'});
await mount(builder.default,[base],`?edit=${id}`);navigate('design');
const typography=one(n=>n.type?.name==='TypographyPicker');assert.deepEqual(plain(typography.props.fonts),['Inter']);
one(n=>n.props?.label==='Card Colour').props.onChange('#ABCDEF');render();await save();
for(const key of ['name','slug','layout_type','access_level','allowed_fonts','free_colour_palette','text_colours','custom_colour_allowed','supports_gradient'])assert.ok(!(key in requests[0].payload),key);
assert.equal(rows[0].primary_color,'#ABCDEF');assert.deepEqual(rows[0].renderer_options.private_metadata,{keep:true});
await mount(builder.default,[base],`?edit=${id}`);
button('Preview Client Experience').props.onClick();render();
let localPreview=one(n=>n.type?.name==='ClientExperiencePreview');
localPreview.props.onUpdateCard('selected_colour','#FF0000');
localPreview.props.onUpdateCustomField('__dmi_font_family','Poppins');
render();one(n=>n.type?.name==='ClientExperiencePreview').props.onClose();render();
await save();assert.deepEqual(requests[0].payload,{},'preview changes must never modify the template');
for(const access of ['free','paid']){
 await mount(builder.default,[base]);
 one(n=>n.type==='select'&&n.props.value==='free').props.onChange({target:{value:access}});render();
 const select=one(n=>n.type==='select'&&n.props.value==='');
 const options=nodes(select.props.children).filter(n=>n.type==='option'&&n.props.value).map(n=>n.props.value);
 assert.deepEqual(options,access==='free'?['classic_free','profile_free']:['modern_minimal','executive_paid','brand_paid']);
 select.props.onChange({target:{value:options.at(-1)}});render();await save();
 assert.equal(requests[0].method,'POST','layout choice creates instead of matching an existing row');assert.equal(requests[0].payload.layout_type,options.at(-1));assert.ok(!('supports_gradient' in requests[0].payload));
}
await mount(builder.default,[base],'?edit=missing');assert.equal(requests.length,0);assert.ok(tree.some(n=>text(n).includes('exact template UUID')));assert.ok(tree.filter(n=>n.type==='select').every(n=>n.props.disabled));
const legacy={...base,id:'22222222-2222-2222-2222-222222222222',name:'Legacy',layout_type:'premium_classic'};
const free={...base,id:'33333333-3333-3333-3333-333333333333',name:'Profile',layout_type:'profile_free',access_level:'free'};
const classic={...free,id:'44444444-4444-4444-4444-444444444444',name:'Classic',layout_type:'classic_free'};
const unknown={...base,id:'55555555-5555-5555-5555-555555555555',name:'Unknown',layout_type:null,access_level:null};
await mount(catalogue.default,[legacy,base,free,classic,unknown]);
const sections=tree.filter(n=>n.type==='section'&&n.props['aria-labelledby']);
assert.deepEqual(sections.map(n=>n.props['aria-labelledby']),['free-templates-heading','paid-templates-heading','other-templates-heading']);
assert.deepEqual(nodes(sections[0]).filter(n=>n.type==='option'&&n.props.value).map(n=>text(n)),['Classic','Profile']);
assert.deepEqual(nodes(sections[1]).filter(n=>n.type==='option'&&n.props.value).map(n=>text(n)),[base.name,'Legacy']);
one(n=>n.type==='input'&&n.props.type==='search').props.onChange({target:{value:'Bespoke'}});render();
assert.equal(tree.filter(n=>n.type==='button'&&text(n)==='Edit').length,1);
confirmAnswer=false;await button('Publish').props.onClick();await settle();assert.equal(requests.length,0);assert.ok(confirmations[0].includes('Publish'));
confirmAnswer=true;await button('Publish').props.onClick();await settle();assert.deepEqual(requests.at(-1).payload,{is_published:true,status:'published'});
await button('Unpublish').props.onClick();await settle();assert.deepEqual(requests.at(-1).payload,{is_published:false,status:'draft'});
promptAnswer=null;const beforeDuplicate=requests.length;await button('Duplicate').props.onClick();await settle();assert.equal(requests.length,beforeDuplicate);
promptAnswer='Duplicate name';await button('Duplicate').props.onClick();await settle();const duplicate=requests.at(-1);
assert.equal(duplicate.method,'POST');assert.equal(duplicate.payload.name,promptAnswer);assert.equal(duplicate.payload.is_published,false);assert.equal(duplicate.payload.layout_type,'brand_paid');assert.equal(duplicate.payload.slug,'duplicate-name-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
for(const key of ['id','supports_gradient','created_at','updated_at','font_family'])assert.ok(!(key in duplicate.payload));
assert.deepEqual(duplicate.payload.allowed_fonts,base.allowed_fonts);assert.equal(duplicate.payload.custom_colour_allowed,false);
confirmAnswer=false;const before=requests.length;await button('Delete').props.onClick();await settle();assert.equal(requests.length,before);
confirmAnswer=true;await button('Delete').props.onClick();await settle();assert.equal(requests.at(-1).method,'DELETE');assert.equal(requests.at(-1).id,id);
await mount(catalogue.default,[legacy]);await button('Duplicate').props.onClick();await settle();assert.equal(requests.length,0,'legacy cannot create new template');
// Client preview uses the actual release reconciler for controls AND live rendering.
const card={id:'sample',full_name:'Synthetic',selected_colour:'#BADBAD',custom_fields:{__dmi_font_family:'Poppins'},field_order:{personal:['first_name','last_name'],company:[],contact:['email'],social:[]}};
const props={step:1,template:base,cardData:card,fieldOrder:card.field_order,onClose(){},leadSettings:{}};
await mount(()=>builder.ClientExperiencePreview(props));
const panel=one(n=>n.type==='EditorPanel'),preview=one(n=>n.type==='PreviewPanelContent');
assert.equal(panel.props.enforceClientContract,true);assert.equal(panel.props.showTemplateContractControls,undefined);
assert.deepEqual(plain(panel.props.draftCard),plain(preview.props.previewCard));assert.notEqual(panel.props.draftCard.selected_colour,'#BADBAD');assert.equal(panel.props.draftCard.custom_fields.__dmi_font_family,undefined);
assert.deepEqual(plain(preview.props.previewTemplate.field_config.sections),plain(panel.props.fieldOrder));
const customTemplate={...base,allowed_fields:['custom:One','custom:Two'],field_config:{sections:{'custom_section:extra':['custom:One','custom:Two']}}};
const customOrder={'custom_section:extra':['custom:Two','custom:One']};
await mount(()=>builder.ClientExperiencePreview({...props,template:customTemplate,fieldOrder:customOrder}));
assert.deepEqual(plain(one(n=>n.type==='EditorPanel').props.fieldOrder['custom_section:extra']),['custom:Two','custom:One'],'custom sections retain client order');
console.log('PASS: real Builder/Current Templates handlers; exact UUID and raw no-op preservation across canonical/legacy/null layouts; explicit rename; sparse design edits; Free/Paid options; create without row matching; grouping/order/search/unknown visibility; duplicate restrictions and identity; publish/unpublish/delete confirmations; release preview contract parity. No network/database access.');
