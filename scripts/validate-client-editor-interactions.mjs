import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const path = 'src/components/card-builder/ClientCardEditor.tsx';
const source = fs.readFileSync(path, 'utf8');
const exports = {};
let slots = [], cursor = 0, emitted;
let effects = [];
const listeners = new Map();
const allowed = [
  { id: 'first', type: 'custom_link', enabled: true, custom_action: true },
  { id: 'second', type: 'custom_link', enabled: true, custom_action: true },
  { id: 'email', type: 'email', enabled: true, default_visible: false },
];
let context = { actions: allowed };
const jsx = (type, props) => ({ type, props });
const react = {
  createContext: () => ({}), useContext: () => context,
  useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
    return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
  useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
  useCallback: fn => fn, useEffect(fn) { effects.push(fn); }, useLayoutEffect() {},
};
const actions = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/card-actions.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: actions });
const mediaSlots = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/media-slots.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: mediaSlots });
const readerInstances = [];
class TestFileReader {
  readAsDataURL(file) { this.file = file; readerInstances.push(this); }
}
const deps = {
  react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'fragment' },
  'react-dom': { createPortal: x => x },
  'lucide-react': new Proxy({}, { get: (_, key) => key }),
  '@/lib/card-actions': actions,
  '@/lib/media-slots': mediaSlots,
  '@/lib/services/card-payload': {
    selectedColourForTemplate: (t, v) => v || '#000000', selectedTextColourForTemplate: (t, v) => v || '#FFFFFF',
    templateTextColourPalette: () => ['#FFFFFF','#CCCCCC'], templateColourPalette: () => ['#000000'],
    canSelectTemplate: (t, plan) => plan !== 'free' || t.access_level === 'free', isPaidTemplate: t => t.access_level === 'paid',
    readableTextForColour: () => '#FFFFFF', isFieldVisible: () => true,
  },
};
vm.runInNewContext(ts.transpileModule(source + '\nexport { ActionsStep, ActionConfigRow, VisibilitySwitch, MediaImageControl, MediaCropEditor, BuilderSection, CustomiseStep, DesignControlPanel, TemplateColourSwatches };', {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText, {
  FileReader: TestFileReader,
  window: { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) },
  exports, require: key => deps[key] || new Proxy({}, { get: (_, name) => name === 'default' ? 'stub' : () => undefined }),
});
const card = { action_config: { actions: [
  { id: 'first', type: 'custom_link', visible: true, order: 0 },
  { id: 'second', type: 'custom_link', visible: true, order: 1 },
  { id: 'forbidden', type: 'website', visible: true, order: 2 },
] } };
const original = JSON.stringify(card);
const props = { template: {}, draftCard: card, onUpdate() {}, onActionConfigChange: value => { emitted = value; } };
function nodes(node) {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== 'object') return [];
  return [node, ...nodes(node.props?.children)];
}
function render() { cursor = 0; effects = []; const tree = nodes(exports.ActionsStep(props)); listeners.clear(); effects.forEach(fn => fn()); return tree; }
let tree = render();
let rows = tree.filter(n => n.type === exports.ActionConfigRow);
assert.equal(rows.length, 2, 'forbidden action cannot appear');
rows[0].props.registerRow('first', { getBoundingClientRect: () => ({ top: 0, height: 50 }) });
rows[1].props.registerRow('second', { getBoundingClientRect: () => ({ top: 60, height: 50 }) });
rows[0].props.onDragStart('first', { pointerId: 1, currentY: 10, grabOffsetY: 0, left: 0, width: 100, height: 50 });
rows = render().filter(n => n.type === exports.ActionConfigRow);
rows[0].props.onDragMove('first', { pointerId: 1, clientY: 120 });
assert.equal(emitted.actions[0].id, 'second');
assert.equal(emitted.actions[1].id, 'first');
assert.equal(emitted.actions.length, 2, 'drag cannot restore stale forbidden actions');
assert.ok(listeners.has('pointermove'));
listeners.get('pointermove')({ pointerId: 1, clientY: 2000 });
rows = render().filter(n => n.type === exports.ActionConfigRow);
assert.ok(rows[0].props.dragState, 'drag remains active outside list');
listeners.get('pointermove')({ pointerId: 1, clientY: 0 });
assert.equal(emitted.actions[0].id, 'first', 're-entry continues reordering');
listeners.get('pointerup')({ pointerId: 1, clientY: 0 });
rows = render().filter(n => n.type === exports.ActionConfigRow);
assert.equal(rows[0].props.dragState, null);
rows[0].props.onUpdateAction('first', { visible: false });
assert.equal(emitted.actions.find(a => a.id === 'first').visible, false);
assert.equal(emitted.actions.find(a => a.id === 'second').visible, true);
const addButton = tree.find(n => n.type === 'button' && n.props.disabled === false && nodes(n).some(x => x.type === 'span' && x.props.children === 'Add action'));
assert.ok(addButton);
addButton.props.onClick();
tree = render();
const email = tree.find(n => n.type === 'button' && nodes(n).some(x => x.type === 'span' && x.props.children === 'Email'));
assert.ok(email, 'established Add action panel opens');
email.props.onClick();
assert.ok(emitted.actions.some(a => a.type === 'email' && a.visible === true), 'explicit add is visible despite Admin default hidden');
assert.equal(JSON.stringify(card), original, 'opening and interaction do not mutate saved source object');
assert.doesNotMatch(source, /ContractActionsStep|ContractDesignControls|Move up|Move down/);
const rowSource = source.slice(source.indexOf('function ActionConfigRow('), source.indexOf('function actionDestinationLabel('));
assert.match(rowSource, /onPointerMove/);
assert.match(rowSource, /aria-expanded/);
assert.match(rowSource, /<VisibilitySwitch/);
assert.doesNotMatch(rowSource, /type="checkbox"/);
assert.match(source, /onDragMoveField/);
assert.match(source, /disabled=\{mode === "gradient" && !gradientAllowed\}/);
assert.match(source, /contract \? contract.customColour/);
assert.match(source, /contract \? contract.customTextColour/);
console.log('PASS: real action handlers reorder duplicate-type IDs, toggle independently, open Add action, filter forbidden actions, preserve input; restored component/entitlement guards verified.');


slots = []; cursor = 0;
const mediaProps = { title: 'Company banner', value: '', disabled: false, visible: true, aspect: 'banner', buttonLabel: 'Add banner', onChange() {} };
function renderMedia() { cursor = 0; return nodes(exports.MediaImageControl(mediaProps)); }
const file = { name: 'Devmaster Inc F-03.png', type: 'image/png', size: 18459 };
const input = { files: [file], value: 'selected.png' };
let mediaTree = renderMedia();
const selectFile = () => renderMedia().find(n => n.type === 'input' && n.props.type === 'file').props.onChange({ currentTarget: input, target: input });
assert.equal(mediaTree.find(n => n.type === 'input').props.accept, 'image/*');
let reading = selectFile();
assert.equal(input.value, 'selected.png', 'selected file stays attached during FileReader');
assert.equal(readerInstances.at(-1).file, file);
readerInstances.at(-1).result = 'data:image/png;base64,fixture'; readerInstances.at(-1).onload(); await reading;
assert.equal(input.value, '', 'reset only after completed read');
mediaTree = renderMedia();
const crop = mediaTree.find(n => n.type === exports.MediaCropEditor);
assert.equal(crop.props.source, 'data:image/png;base64,fixture', 'read completion opens crop');
crop.props.onCancel();
input.value = 'selected.png'; reading = selectFile(); readerInstances.at(-1).onerror(); await reading;
assert.equal(input.value, '');
assert.ok(renderMedia().some(n => n.props.role === 'alert'), 'read error is visible');
input.value = 'selected.png'; reading = selectFile(); readerInstances.at(-1).onabort(); await reading;
assert.equal(input.value, '');
assert.ok(renderMedia().some(n => n.props.role === 'alert'), 'aborted read is visible and retryable');
console.log('PASS: banner file selection/read/open flow, deferred input reset, same-file retry, visible read/abort failures.');


slots = []; cursor = 0;
let accordionToggles = 0, sectionToggle;
const sectionCard = { field_visibility: { email: false, phone: true } };
const sectionOriginal = JSON.stringify(sectionCard);
const sectionTree = exports.BuilderSection({ section: { key: 'contact', label: 'Contact', enabled: true, fields: [] }, draftCard: sectionCard, expanded: true, onToggleExpanded() { accordionToggles++; }, onToggleFieldVisibility(key) { sectionToggle = key; } });
const header = sectionTree.props.children[0];
const toggle = nodes(header).find(n => n.props.ariaLabel === 'Contact visibility');
assert.ok(toggle, 'section visibility is inside accordion header');
assert.ok(!nodes(header).filter(n => n.type === 'button').some(n => nodes(n).includes(toggle)), 'switch is not nested inside accordion buttons');
toggle.props.onToggle();
assert.equal(sectionToggle, 'section:contact');
assert.equal(accordionToggles, 0, 'visibility does not toggle accordion');
const chevron = nodes(header).find(n => n.props['aria-label'] === 'Collapse Contact');
chevron.props.onClick();
assert.equal(accordionToggles, 1);
assert.equal(JSON.stringify(sectionCard), sectionOriginal, 'field-level visibility remains untouched');
console.log('PASS: section switch inside header, independent chevron, unchanged field visibility.');



for (const layout_type of ['classic_free','profile_free','modern_minimal','executive_paid','brand_paid']) {
  const free = layout_type.endsWith('_free');
  context = { palette: ['#000000'], fonts: ['Inter','Poppins'], customColour: !free, customTextColour: !free, gradient: !free, typographyEditable: !free };
  let update;
  const design = nodes(exports.CustomiseStep({ template: { id:'t', name:'Test', layout_type, access_level: free ? 'free':'paid', default_font:'Inter', allowed_fonts:['Inter','Poppins'] }, templates: [], draftCard: { card_name:'Test', selected_colour:'#000000', selected_text_colour:'#FFFFFF', custom_fields:{} }, currentPlan:free?'free':'pro', isPaid:!free, onUpdate:(key,value)=>{update={key,value}}, onSelectFont:font=>{update={font}}, onSelectTemplate(){} }));
  const panels = design.filter(n=>n.type===exports.DesignControlPanel);
  assert.deepEqual(panels.map(p=>p.props.title), ['Background','Text colour','Typography'], 'same real panel hierarchy: '+layout_type);
  const gradient = design.find(n=>n.type==='button'&&Array.isArray(n.props.children)&&n.props.children[0]==='gradient');
  assert.equal(gradient.props.disabled, free);
  gradient.props.onClick();
  if (free) assert.equal(update, undefined);
  const textPanel = panels.find(p=>p.props.title==='Text colour');
  if(free){const swatches=nodes(textPanel).find(n=>n.type===exports.TemplateColourSwatches);swatches.props.onChange('#CCCCCC');assert.deepEqual(update,{key:'selected_text_colour',value:'#CCCCCC'});}
  assert.equal(design.filter(n=>n.type==='button'&&n.props['aria-pressed']!==undefined&&nodes(n).some(child=>child.props?.children==='Poppins')).length, free?0:1);
}
assert.doesNotMatch(source.slice(source.indexOf('function CustomiseStep'),source.indexOf('function BuildStep')), /\{isPaid \? \(/);
for(const component of ['CustomiseStep','BuildStep','ActionsStep','SetUpStep']) assert.equal((source.match(new RegExp('<'+component+'\\s','g'))||[]).length,1);
console.log('PASS: shared four-step components and actual design-panel hierarchy for all five layouts; Free restrictions and paid typography controls.');
