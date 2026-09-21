import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const diagnosticEnvironment = { NODE_ENV: "development" };
function load(path, deps) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText, { URL, process: { env: diagnosticEnvironment }, exports, require(name) { if (["@/lib/card-typography", "@/lib/card-section-label", "@/lib/client-media-intent", "@/lib/card-media", "@/lib/client-media-request"].includes(name)) return load(name.replace("@/", "src/") + ".ts", {}); assert.ok(name in deps, name); return deps[name]; } });
  return exports;
}
class ApiRouteError extends Error { constructor(status, code, message) { super(message); this.status = status; } }
const actions = load('src/lib/card-actions.ts', {});
const payload = load('src/lib/services/card-payload.ts', {
  '@/components/CardRenderer': { displayName: c => c.full_name },
  '@/lib/card-actions': actions,
  '@/lib/public-url': { buildPublicCardUrl: s => '/u/' + s },
  '@/lib/templates': { normalizeColourPalette: x => Array.isArray(x) ? x : [] },
});
const { validateClientCard: validate } = load('src/lib/client-card-contract.ts', {
  'server-only': {}, '@/lib/api/responses': { ApiRouteError },
  '@/lib/card-actions': actions, '@/lib/services/card-payload': payload,
});
const template = {
  id: 'template', name: 'Test template', access_level: 'free', layout_type: 'profile_free',
  primary_color: '#FFFFFF', free_colour_palette: ['#FFFFFF', '#000000'],
  text_colours: ['#111111', '#EEEEEE'], profile_image_allowed: true,
  logo_allowed: false, banner_allowed: false,
  allowed_fields: ['full_name', 'email'],
  field_config: { allowed_fields: ['full_name', 'email'], sections: { personal: ['full_name'], contact: ['email'] } },
  allowed_actions: { actions: [{ id: 'save_contact', type: 'save_contact', enabled: true, default_visible: true }] },
};
const card = { id: 'card-new', card_name: 'Mine', full_name: 'Tester', status: 'published',
  selected_colour: '#FFFFFF', selected_text_colour: '#111111', email: 'tester@example.invalid',
  action_config: { actions: [{ id: 'save_contact', type: 'save_contact', visible: true, order: 0 }] } };
assert.equal(payload.canSelectTemplate(template, 'free'), true);
assert.equal(payload.canSelectTemplate({ ...template, access_level: 'paid', layout_type: 'brand_paid' }, 'free'), false);
const valid = validate(card, template, 'free');
const alternate = validate({ ...card, selected_colour: '#000000', selected_text_colour: '#EEEEEE', selected_gradient_start: '#FFFFFF' }, template, 'free');
assert.equal(alternate.selected_colour, '#000000');
assert.equal(alternate.custom_fields.__dmi_gradient_start, undefined);
assert.equal(valid.email, card.email);
assert.equal(valid.action_config.actions[0].type, 'save_contact');
assert.equal(validate({ ...card, profile_image_url: 'https://example.invalid/profile' }, template, 'free').profile_image_url, 'https://example.invalid/profile');
for (const patch of [
  { company_logo_url: 'logo' }, { company_banner_url: 'banner' },
  { selected_background_mode: 'gradient' }, { selected_colour: '#123456' },
  { selected_text_colour: '#123456' }, { font_family: 'Comic Sans' },
  { company_name: 'Forbidden' }, { custom_fields: { secret: 'Injected' } },
  { field_visibility: { secret: true } }, { field_order: { injected: ['email'] } },
  { action_config: { actions: [{ id: 'website', type: 'website', visible: true }] } },
]) assert.throws(() => validate({ ...card, ...patch }, template, 'free'), ApiRouteError);
assert.throws(() => validate({ ...card, profile_image_url: 'photo' }, { ...template, profile_image_allowed: false }, 'free'));
const pro = validate({ ...card, selected_colour: '#123456', selected_text_colour: '#ABCDEF', selected_background_mode: 'gradient', selected_gradient_end: '#654321' },
  { ...template, custom_colour_allowed: true, custom_text_colour_allowed: true, gradient_enabled: true }, 'pro');
assert.equal(pro.custom_fields.__dmi_gradient_end, '#654321');
// Transactional writer/receipt/revision tests now live in validate-card-media-integration.mjs.
// This suite retains the complete pure template contract and original allowance invariants.
assert.throws(() => validate({ ...card, id: 'existing', selected_colour: '#123456' }, template, 'free'));
// Logical concurrency model. SQL is inspected below; no database is invoked.
let tail = Promise.resolve(), count = 0;
function create(limit) {
  const work = tail.then(() => { if (count >= limit) throw Error('limit'); return ++count; });
  tail = work.catch(() => {});
  return work;
}
const concurrent = await Promise.allSettled([create(1), create(1)]);
assert.equal(concurrent.filter(r => r.status === 'fulfilled').length, 1);
assert.equal(count, 1);
await create(3); await create(3); await assert.rejects(create(3));
const sql = fs.readFileSync('supabase/migrations/20260917210000_add_atomic_client_card_creation.sql', 'utf8');
assert.match(sql, /security invoker/i);
assert.match(sql, /from public, anon, authenticated/);
assert.match(sql, /to service_role/);
assert.match(sql, /p_card_allowance not in \(1, 3\)/);
assert.ok(sql.indexOf('pg_advisory_xact_lock') < sql.indexOf('select count(*)'));
assert.ok(sql.indexOf('select count(*)') < sql.indexOf('insert into public.cards'));
assert.match(sql, /hashtextextended\('public.cards.card_slot:' \|\| p_owner_user_id::text, 0\)/);
assert.doesNotMatch(sql.match(/insert into public.cards \(([^)]+)\)/)[1], /card_slot|profile_id/);
assert.doesNotMatch(sql, /revoke .*on table/i);
console.log('PASS: Free/Pro contract, concurrency model and migration invariants (no SQL executed).');


// Client capability projection must produce a payload accepted by the real server validator.
const viewHelpers = load('src/lib/client-template-view.ts', {
  '@/lib/card-actions': actions, '@/lib/services/card-payload': payload,
});
const { reconcileClientCard: reconcile, clientTemplateView: capabilities } = viewHelpers;
const stale = { ...card, company_logo_url: 'stale-logo', company_name: 'old company',
  custom_fields: { forbidden: 'old value' },
  selected_background_mode: 'gradient', selected_colour: '#123456',
  field_order: { contact: ['email', 'company_name'], secret: ['forbidden'] },
  action_config: { actions: [...card.action_config.actions, { id: 'website', type: 'website', visible: true, order: 1 }] },
};
const original = JSON.stringify(stale);
const reconciled = reconcile(stale, template, 'free');
assert.equal(JSON.stringify(stale), original, 'Opening/projection must not mutate original card data');
assert.ok(reconciled.changes.includes('unapproved actions'));
assert.ok(!reconciled.changes.includes('company_logo_url'));
assert.equal(reconciled.card.company_logo_url,'stale-logo');
assert.equal(reconciled.card.email, card.email);
assert.equal(reconciled.card.company_name, undefined);
assert.equal(reconciled.card.selected_background_mode, 'solid');
assert.equal(reconciled.card.action_config.actions.length, 1);
assert.throws(()=>validate(reconciled.card, template, 'free'),/unsupported/, 'untrusted direct media input remains denied');
validate({...reconciled.card,company_logo_url:''}, template, 'free');
for (const layout_type of ['classic_free', 'profile_free']) {
  const t = { ...template, layout_type, profile_image_default_enabled: true };
  const visible = reconcile({ ...card, profile_image_url: 'photo' }, t, 'free').card;
  assert.equal(visible.field_visibility.profile_image_url, true);
  const hidden = reconcile({ ...visible, field_visibility: { ...visible.field_visibility, profile_image_url: false } }, t, 'free').card;
  assert.equal(hidden.field_visibility.profile_image_url, false);
  assert.equal(hidden.profile_image_url, 'photo', 'Toggle preserves valid media');
  validate(hidden, t, 'free');
}
const customTemplate = { ...template, logo_allowed: true, banner_allowed: true,
  allowed_fields: ['email', 'custom:expertise:specialty'],
  field_config: { allowed_fields: ['email', 'custom:expertise:specialty'],
    sections: { contact: ['email'], expertise: ['custom:expertise:specialty'], disabled: ['email'] },
    section_order: ['expertise', 'contact', 'disabled'], section_labels: { expertise: 'Expertise' },
    default_visibility: { 'section:disabled': false } },
};
const customCard = reconcile({ ...card, company_logo_url: 'logo', company_banner_url: 'banner',
  custom_fields: { specialty: 'Consulting' }, field_visibility: { 'section:expertise': false } }, customTemplate, 'free').card;
assert.equal(capabilities(customTemplate, 'free').sections[0].label, 'Expertise');
assert.equal(customCard.custom_fields.specialty, 'Consulting');
assert.equal(customCard.field_visibility['section:expertise'], false);
assert.ok(!('disabled' in customCard.field_order));
validate(customCard, customTemplate, 'free');
const paidTemplate = { ...template, access_level: 'paid', layout_type: 'brand_paid',
  custom_colour_allowed: true, custom_text_colour_allowed: true, gradient_enabled: true };
const paid = reconcile({ ...card, selected_colour: '#123456', selected_text_colour: '#ABCDEF', selected_background_mode: 'gradient', selected_gradient_end: '#654321' }, paidTemplate, 'pro');
assert.equal(paid.card.selected_colour, '#123456');
validate(paid.card, paidTemplate, 'pro');
assert.equal(capabilities(paidTemplate, 'free').gradient, false);
assert.equal(capabilities(paidTemplate, 'pro').gradient, true);
assert.equal(capabilities(template, 'pro').customColour, false);
assert.equal(capabilities(template, 'free').typographyEditable, false);
assert.equal(reconcile(stale, template, 'enterprise').card, stale);
console.log('PASS: Client Classic/Profile/Pro capability mapping, custom sections, media toggles, stale-state projection without mutation, normalized payloads accepted by server, Enterprise unchanged.');

const normalizedTemplates = load('src/lib/templates.ts', {
  '@/lib/supabase': { supabase: {} }, '@/lib/card-actions': actions,
});
for (const layout_type of ['executive_paid', 'brand_paid']) {
  const solidWithCapability = normalizedTemplates.normalizeTemplate({ ...paidTemplate, layout_type, gradient_enabled: false, supports_gradient: true });
  assert.equal(capabilities(solidWithCapability, 'pro').gradient, true);
  validate({ ...card, selected_background_mode: 'gradient' }, solidWithCapability, 'pro');
  assert.equal(capabilities(solidWithCapability, 'free').gradient, false);
  const denied = normalizedTemplates.normalizeTemplate({ ...paidTemplate, layout_type, gradient_enabled: true, supports_gradient: false });
  assert.equal(capabilities(denied, 'pro').gradient, false);
  assert.throws(() => validate({ ...card, selected_background_mode: 'gradient' }, denied, 'pro'));
}
for (const key of ['profile_image_url', 'company_logo_url', 'company_banner_url']) {
  const t = { ...customTemplate, profile_image_default_enabled: true, logo_default_enabled: true, banner_default_enabled: true };
  let current = reconcile({ ...card, [key]: 'first-image' }, t, 'free').card;
  assert.equal(current[key], 'first-image');
  current = reconcile({ ...current, [key]: 'replacement' }, t, 'free').card;
  const stored = validate(current, t, 'free');
  const reopened = payload.mapSupabaseCard({ ...stored, id: 'saved', slug: 'saved' }, [t], 'free', t);
  assert.equal(reopened[key], 'replacement');
  const removed = reconcile({ ...current, custom_fields: { [key]: 'old-image' }, [key]: '', media_edits: { [key]: 'remove' } }, t, 'free').card;
  assert.equal(removed[key], '');
  const { media_edits: removalIntent, ...removedPayload } = removed;
  assert.equal(removalIntent[key], 'remove');
  const savedRemoval = validate({ ...removedPayload, custom_fields: { [key]: 'old-image' } }, t, 'free');
  assert.ok(!savedRemoval.custom_fields[key]);
  if (key !== 'company_banner_url') assert.equal(savedRemoval[key], '');
}
const hiddenAction = reconcile({ ...card, action_config: { actions: [{ ...card.action_config.actions[0], visible: false }] } }, template, 'free').card;
assert.equal(hiddenAction.action_config.actions[0].visible, false);
assert.throws(() => validate({ ...card, custom_fields: { __dmi_font: 'Inter' } }, template, 'free'));
const jsx = (type, props) => ({ type, props });
const renderer = load('src/components/CardRenderer.tsx', {
  'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'fragment' },
  'lucide-react': new Proxy({}, { get: (_, k) => k }),
  'react-icons/fa': new Proxy({}, { get: (_, k) => k }),
  '@/lib/card-actions': actions,
  '@/lib/card-action-routing': { resolveCardActionHref: () => null, resolveCardFieldHref: () => null, vCardDataHref: () => '', vCardFilename: () => '' },
  '@/components/CardMediaImage': { default: props => ({ type: 'img', props }) },
  '@/lib/media-slots': load('src/lib/media-slots.ts', {}),
});
function flatten(node) {
  if (Array.isArray(node)) return node.flatMap(flatten);
  if (!node || typeof node !== 'object') return [node];
  if (typeof node.type === 'function') return flatten(node.type(node.props));
  return [node, ...flatten(node.props?.children)];
}
for (const layout_type of ['classic_free', 'profile_free', 'modern_minimal', 'executive_paid', 'brand_paid']) {
  const paid = !layout_type.endsWith('_free');
  const t = { ...template, layout_type, access_level: paid ? 'paid' : 'free',
    requires_profile_image: true, profile_image_allowed: true,
    logo_allowed: paid, requires_logo: paid, banner_allowed: paid && layout_type !== 'executive_paid', requires_banner: paid && layout_type !== 'executive_paid' };
  for (const visible of [true, false]) {
    const data = { ...card, action_config: { actions: [] }, field_visibility: { profile_image_url: visible, company_logo_url: visible, company_banner_url: visible } };
    const nodes = flatten(renderer.default({ template: t, cardData: data, mode: 'preview', showMediaPlaceholders: true }));
    assert.equal(nodes.some(n => n?.type === 'UserRound'), visible, layout_type + ' profile placeholder');
    assert.equal(nodes.includes('Logo'), visible && paid, layout_type + ' logo placeholder');
    assert.equal(nodes.includes('Banner'), visible && Boolean(t.banner_allowed), layout_type + ' banner placeholder');
  }
}
// Missing/invalid resolved media never reserves Client/public image slots.
for (const layout_type of ['classic_free', 'profile_free', 'modern_minimal', 'executive_paid', 'brand_paid']) {
  const t = { ...template, layout_type, access_level: 'paid', requires_profile_image: true,
    profile_image_allowed:true, requires_logo:true, logo_allowed:true, requires_banner:true, banner_allowed:true };
  for (const mode of ['preview','public']) for (const value of ['',null,undefined,'invalid']) {
    const data = { ...card, action_config:{actions:[]}, profile_image_url:value, company_logo_url:value, company_banner_url:value };
    const tree = renderer.default({template:t,cardData:data,mode,showMediaPlaceholders:false});
    assert.equal(tree.props.requiresProfileImage,false);
    assert.equal(tree.props.requiresLogo,false);
    assert.equal(Boolean(tree.props.requiresBanner),false);
    const nodes = flatten(tree);
    assert.equal(nodes.some(n => n?.type === 'img' || n?.type === 'UserRound'),false,layout_type+' missing media collapsed');
  }
}
const { incompleteVisibleMedia } = load('src/lib/client-media-visibility.ts', {'@/lib/services/card-payload':payload});
const mediaCapabilities = {profile_image_url:true,company_logo_url:true,company_banner_url:true};
for (const field of Object.keys(mediaCapabilities)) {
  const c = {...card, profile_image_url:'',company_logo_url:'',company_banner_url:'',custom_fields:{},
    field_visibility:Object.fromEntries(Object.keys(mediaCapabilities).map(k=>[k,k===field])),hidden_fields:[]};
  assert.equal(incompleteVisibleMedia(c,mediaCapabilities)[0].key,field);
  assert.equal(incompleteVisibleMedia({...c,field_visibility:{...c.field_visibility,[field]:false}},mediaCapabilities).length,0);
  for (const value of ['data:image/png;base64,YQ==','https://example.invalid/photo.png','card-media:11111111-1111-4111-8111-111111111111']) {
    assert.equal(incompleteVisibleMedia({...c,[field]:value},mediaCapabilities).length,0);
    assert.equal(incompleteVisibleMedia({...c,[field]:value,media_edits:{[field]:'remove'}},mediaCapabilities).length,1);
  }
}
// Execute actual page functions, including the collection and hide handler.
const pageSource = fs.readFileSync('src/app/client/cards/page.tsx','utf8');
function functionSource(source, names) {
  const ast=ts.createSourceFile('test.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const found=[];
  function visit(node){if(ts.isFunctionDeclaration(node)&&names.includes(node.name?.text)) found.push(node.getText(ast));ts.forEachChild(node,visit);}
  visit(ast);assert.equal(found.length,names.length);return found.join('\n');
}
const stepSource=functionSource(pageSource,['incompleteBuildFields','validateEditorStepTransition','continueAfterValidation','fieldHasDraftValue','forceHideFieldsOnCard','CompletionValidationModal']);
const stepTemplate={...template,access_level:'paid',layout_type:'modern_minimal',profile_image_allowed:true,logo_allowed:true,banner_allowed:true,
  allowed_fields:['department','bio'],field_config:{sections:{company:['department'],personal:['bio']}}};
const validLogo='https://example.invalid/logo.webp';
for(const plan of ['pro','enterprise']) {
  const draft={...card,department:'',bio:'',profile_image_url:'',company_logo_url:validLogo,company_banner_url:'',custom_fields:{},hidden_fields:[],
    media_edits:{},field_visibility:{department:true,bio:true,profile_image_url:true,company_logo_url:true,company_banner_url:true}};
  let pending,hidden,continued;
  const context={exports:{},...payload,currentPlan:plan,draftTemplateRecord:stepTemplate,editorCard:draft,draftCard:draft,activeStep:1,fieldOrder:{},
    fieldLabels:{department:'Department',bio:'Bio'},friendlyFieldLabel:x=>x,
    incompleteVisibleMedia,clientTemplateView:capabilities,
    buildStepSections:()=>capabilities(stepTemplate,'pro').sections,
    setPendingValidation:v=>{pending=v;},setDraftCard:v=>{hidden=v;},changeEditorStep:step=>{continued=step;},
    incompleteActions:()=>[],incompleteActionsForCard:()=>[],incompleteLeadCaptureSettings:()=>[],
    clientButtonClass:{primary:'primary',secondary:'secondary'},X:'X',require:()=>({jsx,jsxs:jsx})};
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(stepSource,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText,context);
  for(const publish of [false,true]) {
    assert.equal(publish ? context.validateEditorStepTransition(undefined,'published') : context.validateEditorStepTransition(2),false);
    assert.equal(pending.kind,'fields');
    assert.deepEqual(Array.from(pending.issues,i=>i.key).sort(),['department','bio','profile_image_url','company_banner_url'].sort());
  }
  context.validateEditorStepTransition(2);
  const before=JSON.stringify(draft);
  const modal=context.CompletionValidationModal({validation:pending,onGoBack:()=>{pending=null;},onHideAndContinue:()=>{},onUpload:()=>{}});
  flatten(modal).find(n=>n?.type==='button'&&n.props.children==='Go back').props.onClick();
  assert.equal(JSON.stringify(draft),before,'Go back changes no card state');
  context.validateEditorStepTransition(2);
  context.continueAfterValidation(pending);
  assert.equal(continued,2);
  for(const field of ['department','bio','profile_image_url','company_banner_url'])assert.equal(hidden.field_visibility[field],false);
  assert.equal(hidden.field_visibility.company_logo_url,true);
  assert.equal(hidden.company_logo_url,validLogo);
  assert.equal(JSON.stringify(hidden.media_edits),'{}','hide does not remove/replace');
  assert.equal(JSON.stringify(draft),before,'original draft is not mutated');
  context.editorCard=hidden;
  assert.equal(context.validateEditorStepTransition(2),true);
}
// Render the actual shared editor preview, then its actual CardRenderer/layout.
const editorSource=fs.readFileSync('src/components/card-builder/ClientCardEditor.tsx','utf8');
const previewContext={exports:{},CardRenderer:renderer.default,DevicePreviewPicker:'picker',DevicePreviewFrame:'frame',LeadCapturePreviewCard:'lead',require:()=>({jsx,jsxs:jsx})};
vm.createContext(previewContext);
vm.runInContext(ts.transpileModule(functionSource(editorSource,['PreviewPanelContent']).replace('export ',''),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText,previewContext);
for(const mode of ['empty','uploaded']) {
  const data={...card,action_config:{actions:[]},company_logo_url:validLogo,profile_image_url:mode==='empty'?'':'https://example.invalid/profile.webp',company_banner_url:mode==='empty'?'':'https://example.invalid/banner.webp'};
  const tree=previewContext.PreviewPanelContent({title:'Live Edit Preview',previewCard:data,previewTemplate:stepTemplate,dimensions:{},filteredGroups:[],showMediaPlaceholders:true});
  const all=flatten(tree);
  const images=all.filter(n=>n?.type==='img');
  assert.equal(images.length,mode==='empty'?1:3,'actual editor preview contains only uploaded media');
  assert.ok(images.some(n=>n.props.src===validLogo),'valid logo always renders');
  assert.equal(all.some(n=>n?.type==='UserRound'||n==='Banner'||n==='Logo'),false);
  if(mode==='empty')assert.equal(all.some(n=>String(n?.props?.className||'').includes('rounded-full border font-semibold')),false,'no empty Modern Minimal profile circle');
}
console.log('PASS: actual Step 2 collection/modal/continue: Department+Bio+Profile+Banner together; Go back unchanged; bulk hide preserves logo/intents; actual editor preview collapses empty slots and restores uploaded layout.');
// Decode failures hide the image and mark its slot for collapse; a new source
// is independent of an earlier failure (no kind/card-level failure cache).
let imageSlots=[], imageCursor=0;
const imageComponent=load('src/components/CardMediaImage.tsx',{
  react:{useState(initial){const i=imageCursor++;if(!(i in imageSlots))imageSlots[i]=initial;return [imageSlots[i],v=>{imageSlots[i]=v;}];},useEffect(){}},
  'react/jsx-runtime':{jsx,jsxs:jsx},'@/lib/supabase':{supabase:{}}
}).default;
function imageRender(src){imageCursor=0;return imageComponent({src,alt:'Logo'});}
const failedImage=imageRender('https://example.invalid/old.webp');
failedImage.props.onError({});
assert.equal(imageRender('https://example.invalid/old.webp').props['data-media-unavailable'],true);
assert.equal(imageRender('https://example.invalid/old.webp').props.style.display,'none');
assert.equal(imageRender('https://example.invalid/new.webp').props['data-media-unavailable'],undefined);
assert.equal(imageRender('').props['data-media-unavailable'],true);
console.log('PASS: all three visible empty media blocked; hiding permits progression; retain/upload accepted; remove still visible blocked; empty legacy Client/public slots collapsed.');

console.log('PASS: gradient capability/default separation; all media save/reopen/replace/remove paths; hidden actions unchanged; shared renderer placeholders honor visibility in all five layouts.');

// Exercise the actual Admin hydration/save expressions: default mode must not
// become the capability again when an existing paid template is saved as Solid.
const builderSource = fs.readFileSync('src/app/templates/page.tsx', 'utf8');
const builderAst = ts.createSourceFile('builder.tsx', builderSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const permissionExpressions = [];
let hydratePermission;
function visitBuilder(node) {
  if (ts.isPropertyAssignment(node) && node.name.getText(builderAst) === 'supports_gradient') {
    permissionExpressions.push(node.initializer.getText(builderAst));
  }
  if (ts.isCallExpression(node) && node.expression.getText(builderAst) === 'setSupportsGradient' && node.arguments[0]?.getText(builderAst).includes('template.supports_gradient')) {
    hydratePermission = node.arguments[0].getText(builderAst);
  }
  ts.forEachChild(node, visitBuilder);
}
visitBuilder(builderAst);
assert.equal(permissionExpressions.length, 2, 'save and preview carry independent permission');
assert.ok(hydratePermission, 'existing permission is hydrated');
for (const allowed of [true, false]) {
  const supportsGradient = vm.runInNewContext(hydratePermission, { normalizedAccessLevel: 'paid', template: { supports_gradient: allowed, gradient_enabled: !allowed } });
  assert.equal(supportsGradient, allowed);
  for (const gradientEnabled of [true, false]) {
    for (const expression of permissionExpressions) {
      assert.equal(vm.runInNewContext(expression, { accessLevel: 'paid', supportsGradient, gradientEnabled }), allowed);
      assert.equal(vm.runInNewContext(expression, { accessLevel: 'free', supportsGradient, gradientEnabled }), false);
    }
  }
}
assert.match(builderSource, /setGradientEnabled\(event.target.value === "gradient"\)/, 'baseline Solid/Gradient selector changes default only');
console.log('PASS: Admin hydration preserves permission/denial; Solid/Gradient default changes cannot overwrite it; Free permission stays false.');
const payloadFunction = builderAst.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'buildTemplatePayload');
const payloadHelpers = Object.fromEntries(['sanitizeTextColourPalette', 'sanitizeFreeColourPalette', 'sanitizeTemplateFonts', 'sanitizeDefaultFont', 'templateAllowedActionsIncludes', 'sanitizeAllowedFields', 'sanitizeTemplateAllowedActions', 'sanitizeCustomFields', 'readTemplateContentSections'].map(name => [name, value => value]));
const makeAdminPayload = vm.runInNewContext(ts.transpileModule(payloadFunction.getText(builderAst) + '\nbuildTemplatePayload;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, payloadHelpers);
for (const supports_gradient of [true, false]) {
  const saved = makeAdminPayload({ name: 'Brand', access_level: 'paid', supports_gradient, gradient_enabled: false });
  assert.equal(saved.supports_gradient, supports_gradient, 'save serializer carries independent permission');
  assert.equal(saved.gradient_enabled, false, 'solid remains default');
}
console.log('PASS: actual Admin payload serializer preserves gradient permission separately from Solid default.');

const sectionDisplay = load('src/lib/card-section-label.ts', {});
for (const [key, label] of Object.entries({ personal: 'Personal Details', company: 'Company Details', contact: 'Contact' })) {
  assert.equal(sectionDisplay.cardSectionLabel(key), label);
  assert.equal(sectionDisplay.cardSectionLabel(key, key), label);
  assert.equal(sectionDisplay.cardSectionLabel(key, 'Our Team'), 'Our Team');
}
for (const layout_type of ['classic_free','profile_free','modern_minimal','executive_paid','brand_paid']) {
  const free = layout_type.endsWith('_free');
  const fontTemplate = { ...template, id: 'font-template', layout_type, access_level: free ? 'free' : 'paid', allowed_fonts: ['Inter','Poppins'], default_font: 'Inter' };
  const input = { ...card, template_id: fontTemplate.id, custom_fields: { __dmi_font_family: 'Poppins' } };
  assert.throws(() => validate(input, fontTemplate, 'free'));
  assert.throws(() => validate({ ...input, custom_fields: { __dmi_font_family: 'Arial; color:red' } }, fontTemplate, 'pro'));
  const saved = validate(input, fontTemplate, 'pro');
  const reopened = payload.mapSupabaseCard({ ...saved, id: 'font-card', slug: 'font-card' }, [fontTemplate], 'pro', fontTemplate);
  assert.equal(reopened.custom_fields.__dmi_font_family, 'Poppins');
  assert.equal(reconcile(reopened, fontTemplate, 'pro').card.custom_fields.__dmi_font_family, 'Poppins');
  assert.equal(reconcile(reopened, fontTemplate, 'free').card.custom_fields.__dmi_font_family, undefined);
  const rendered = flatten(renderer.default({ template: fontTemplate, cardData: reopened, mode: 'public' }));
  assert.ok(rendered.some(node => node?.props?.style?.fontFamily?.includes('--font-poppins')), layout_type + ' renders persisted font');
}
console.log('PASS: canonical section display labels; bounded Pro typography save/reopen/render across all five layouts; Free/injected font denied; stale font cleaned on explicit save.');

// Temporary local bounded-text diagnostics. No API/database request is made.
const overlong = "x".repeat(12001);
assert.throws(() => validate({ ...card, full_name: overlong }, template, "free"),
  e => e.message === "BOUNDED_TEXT_INVALID field=full_name reason=too_long length=12001");
assert.throws(() => validate({ ...card, email: { private: "never print me" } }, template, "free"),
  e => e.message === "BOUNDED_TEXT_INVALID field=email reason=non_string length=not_applicable");
diagnosticEnvironment.NODE_ENV = "production";
assert.throws(() => validate({ ...card, full_name: overlong }, template, "free"),
  e => e.message === "Card fields must be bounded text.");
diagnosticEnvironment.NODE_ENV = "development";
// Optional local reproduction using an actual image, without logging its bytes.
if (process.argv[2]) {
  const image = fs.readFileSync(process.argv[2]);
  const dataUrl = "data:image/png;base64," + image.toString("base64");
  assert.ok(dataUrl.length > 12000 && dataUrl.length < 100000);
  const mediaTemplate = { ...template, access_level: "paid", layout_type: "brand_paid",
    profile_image_allowed: true, logo_allowed: true, banner_allowed: true,
    allowed_fonts: ["Inter", "Poppins"], default_font: "Inter" };
  for (const field of ["company_banner_url", "profile_image_url", "company_logo_url"]) {
    const submitted = JSON.parse(JSON.stringify({ ...card, [field]: dataUrl,
      field_visibility: { "section:personal": true },
      custom_fields: { __dmi_font_family: "Poppins" } }));
    assert.throws(() => validate(submitted, mediaTemplate, "pro"), e => {
      const expected = `BOUNDED_TEXT_INVALID field=${field} reason=too_long length=${dataUrl.length}`;
      assert.equal(e.message, expected);
      console.log(e.message);
      return true;
    });
  }
}
console.log("PASS: local diagnostics identify field/reason/length only; production error and text bound unchanged.");

const previousMedia={...card,profile_image_url:'profile',company_logo_url:'logo',company_banner_url:'banner',field_visibility:{profile_image_url:true,company_logo_url:false,company_banner_url:true}};
const preservedVisibility=viewHelpers.retainedClientMediaVisibility(previousMedia,paidTemplate,'pro');
assert.equal(preservedVisibility.field_visibility.company_logo_url,false);
assert.equal(preservedVisibility.field_visibility.company_banner_url,true);
assert.ok(preservedVisibility.hidden_fields.includes('company_logo_url'));
const profileOnly=reconcile({...previousMedia,...preservedVisibility},{...paidTemplate,logo_allowed:false,banner_allowed:false},'pro').card;
assert.equal(profileOnly.company_logo_url,'logo');assert.equal(profileOnly.company_banner_url,'banner');
assert.equal(profileOnly.field_visibility.company_logo_url,false);assert.equal(profileOnly.field_visibility.company_banner_url,true);
console.log('PASS: template switching preserves card media and user visibility separately from display capability.');

for(const mode of ['preview','public']) {
  const stored={...previousMedia,profile_image_url:'https://example.invalid/profile',company_logo_url:'https://example.invalid/logo',company_banner_url:'https://example.invalid/banner',action_config:{actions:[]},field_visibility:{profile_image_url:true,company_logo_url:true,company_banner_url:true}};
  for(const layout_type of ['modern_minimal','executive_paid']) {
    const target={...paidTemplate,layout_type,profile_image_allowed:true,logo_allowed:false,banner_allowed:false};
    const suppressed=renderer.default({template:target,cardData:stored,mode});
    assert.equal(suppressed.props.requiresProfileImage,true);
    assert.equal(suppressed.props.requiresLogo,false);assert.equal(Boolean(suppressed.props.requiresBanner),false);
  }
  const restored=renderer.default({template:{...paidTemplate,layout_type:'modern_minimal',profile_image_allowed:true,logo_allowed:true,banner_allowed:true},cardData:stored,mode});
  assert.equal(restored.props.requiresLogo,true);assert.equal(restored.props.requiresBanner,true);
}
console.log('PASS: real preview/public renderer suppresses unsupported retained media and restores it on supporting templates.');
