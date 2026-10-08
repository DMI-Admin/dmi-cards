import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';

const theme = fs.readFileSync('src/app/admin-theme.css', 'utf8');
const css = fs.readFileSync('src/components/admin/AdminUI.module.css', 'utf8');
const source = fs.readFileSync('src/components/admin/AdminUI.tsx', 'utf8');
const base = 'fa86e0e4228732ac716cc661fee27cfaf6b73213';
const original = (file) => execFileSync('git', ['show', `${base}:${file}`], { encoding: 'utf8' });
function load(code) {
 const record = { exports: {} };
 vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
  exports: record.exports, module: record,
  require(name) {
   if (name === 'react/jsx-runtime') return jsxRuntime;
   assert.equal(name, './AdminUI.module.css');
   return { default: new Proxy({}, { get: (_, key) => key }) };
  },
  fetch: () => { throw Error('No network allowed'); },
 });
 return record.exports;
}
const ui = load(source), oldUi = load(original('src/components/admin/AdminUI.tsx'));
const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));
const labels = { Active: 'success', Cancelling: 'warning', 'Past Due': 'danger', Failed: 'danger', Trialling: 'trial', Paid: 'neutral', Unknown: 'neutral' };
for (const [label, tone] of Object.entries(labels)) {
 assert.equal(render(ui.AdminStatusBadge, { label }), render(oldUi.AdminStatusBadge, { label }), `${label} default markup unchanged`);
 assert.equal(ui.AdminStatusBadge({ label }).props['data-tone'], tone);
}
for (const [name, props] of [['AdminPageHeader', { title: 'Finance', subtitle: 'Recorded revenue' }], ['AdminKpiCard', { label: 'Active', value: '6' }]]) assert.equal(render(ui[name], props), render(oldUi[name], props));
const tones = ['success', 'completion', 'coverage', 'attention', 'critical', 'neutral'];
for (const tone of tones) {
 const badge = ui.AdminStatusBadge({ label: 'Visible status label', tone, indicator: true });
 assert.equal(badge.props['data-tone'], tone);
 const html = renderToStaticMarkup(badge);
 assert.match(html, /Visible status label/);
 assert.match(html, /class="statusDot" aria-hidden="true"/);
}
assert.equal(ui.AdminStatusBadge({ label: 'Active', tone: 'critical' }).props['data-tone'], 'critical');
const button = ui.AdminButton({ children: 'Action', disabled: true, 'aria-label': 'Safe action' });
assert.equal(button.props.type, 'button'); assert.equal(button.props.disabled, true); assert.equal(button.props['aria-label'], 'Safe action');
for (const variant of ['primary', 'secondary', 'danger']) assert.equal(ui.AdminButton({ variant }).props['data-variant'], variant);
assert.equal(ui.AdminButton({ type: 'submit' }).props.type, 'submit');
const handler = () => {};
assert.equal(ui.AdminInput({ onChange: handler }).props.onChange, handler);
assert.equal(ui.AdminSelect({ children: 'Options', disabled: true }).props.disabled, true);
assert.match(render(ui.AdminSurface, { className: 'custom', children: 'Readable card' }), /class="surface custom"/);
const region = ui.AdminTableWrapper({ label: 'Offline table', children: 'Rows' });
assert.equal(region.props.role, 'region'); assert.equal(region.props.tabIndex, 0); assert.equal(region.props['aria-label'], 'Offline table');

function tokens(block) { return Object.fromEntries([...block.matchAll(/(--admin-[a-z-]+):\s*([^;]+);/g)].map(([,key,value]) => [key, value.trim()])); }
const light = tokens(theme.split(':root[data-admin-appearance] {')[1].split('}')[0]);
const darkOverrides = tokens(theme.split(':root[data-admin-appearance="dark"] {')[1].split('}')[0]);
const systemOverrides = tokens(theme.split(':root[data-admin-appearance="system"] {')[1].split('}')[0]);
assert.deepEqual(darkOverrides, systemOverrides);
assert.equal(light['--admin-disabled-opacity'], '1');
assert.match(theme, /--disabled-opacity:\s*var\(--admin-disabled-opacity\)/);
function resolveToken(map, key) {
 const value = map[`--admin-${key}`]; assert.ok(value, key);
 return value.startsWith('var(') ? resolveToken(map, value.slice(12, -1)) : value;
}
function luminance(hex) { return hex.slice(1).match(/../g).map(v => parseInt(v,16)/255).map(v => v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0); }
function contrast(a,b) { const x=luminance(a),y=luminance(b); return (Math.max(x,y)+.05)/(Math.min(x,y)+.05); }
const results=[];
for (const [mode,map] of [['light',light],['dark',{...light,...darkOverrides}]]) {
 for (const tone of tones) {
  const background=resolveToken(map,`${tone}-bg`), text=resolveToken(map,`${tone}-text`), dot=resolveToken(map,`${tone}-dot`);
  const textRatio=contrast(text,background), dotRatio=contrast(dot,background);
  assert.ok(textRatio>=4.5, `${mode} ${tone} text ${textRatio}`);
  assert.ok(dotRatio>=3, `${mode} ${tone} dot ${dotRatio}`);
  results.push({mode,tone,text:textRatio.toFixed(2),dot:dotRatio.toFixed(2)});
 }
 for (const [text,background] of [['text','surface'],['text-secondary','surface'],['muted','surface-secondary'],['text','input'],['disabled-text','disabled-bg'],['on-primary','danger-solid']]) assert.ok(contrast(resolveToken(map,text),resolveToken(map,background))>=4.5,`${mode} ${text}/${background}`);
 assert.notEqual(resolveToken(map,'coverage-bg'), resolveToken(map,'accent-soft'));
 assert.notEqual(resolveToken(map,'completion-bg'), resolveToken(map,'attention-bg'));
 assert.notEqual(resolveToken(map,'completion-dot'), resolveToken(map,'attention-dot'));
 // Coverage has a blue-dominant indicator rather than the purple accent.
 const blue=resolveToken(map,'coverage-dot').slice(1).match(/../g).map(v=>parseInt(v,16));
 assert.ok(blue[2]>blue[0] && blue[1]>blue[0]);
}
assert.doesNotMatch(source+css, /text-white|bg-\[#|#[a-f0-9]{3,8}\b|!important|opacity:\s*0?\.[0-9]/i);
assert.doesNotMatch(source, /fetch\(|process\.env|useEffect|stripe|supabase|OPENAI_API_KEY|next\/navigation/);
assert.equal((theme.match(/!important/g)||[]).length,(original('src/app/admin-theme.css').match(/!important/g)||[]).length);
assert.match(css,/border-radius:50%/);
assert.match(css,/color-scheme:inherit/);
assert.match(css,/min-height:44px/);
assert.match(css,/focus-visible/);
assert.match(css,/overflow-x:auto/);
for (const file of ['src/app/subscriptions/page.tsx','src/app/subscriptions/subscriptions.module.css','src/app/finance/page.tsx','src/components/admin/AdminShell.tsx','src/components/admin/AdminShell.module.css','src/components/Sidebar.tsx','src/components/Sidebar.module.css','src/app/globals.css','src/app/theme.css']) assert.equal(fs.readFileSync(file,'utf8'),original(file),`${file} remains unchanged`);
// Density refinements may append phone-only rules; all existing CSS stays byte-for-byte intact.
const densityBase = '9953dfa783f5ace8d26ba599787bea23e50e6847';
const marker = '\n/* Phone density: retain the established tablet and desktop presentation. */';
const postcss = (await import('postcss')).default;
for (const file of ['src/components/admin/AdminUI.module.css','src/components/admin/AdminSimplePages.module.css','src/app/finance/finance.module.css','src/app/system-health/system-health.module.css']) {
 const current = fs.readFileSync(file,'utf8');
 const before = execFileSync('git',['show',`${densityBase}:${file}`],{encoding:'utf8'});
 assert.ok(current.startsWith(before + marker), `${file} preserves all existing rules`);
 const addition = postcss.parse(current.slice(before.length));
 addition.each(node => {
  if (node.type === 'comment') return;
  assert.equal(node.type, 'atrule'); assert.equal(node.name, 'media'); assert.equal(node.params, '(max-width:480px)');
  node.walkAtRules(() => assert.fail('No nested breakpoint or global rule'));
  node.walkDecls(decl => assert.equal(decl.important, undefined, 'No important overrides'));
 });
}
const phoneKpi = css.slice(css.indexOf(marker));
assert.match(phoneKpi,/grid-template-columns:minmax\(0,1fr\) auto/);
assert.match(phoneKpi,/align-items:center/);
assert.match(phoneKpi,/min-height:56px/);
assert.match(phoneKpi,/overflow-wrap:anywhere/);
assert.match(phoneKpi,/text-align:right/);
const financePhone = fs.readFileSync('src/app/finance/finance.module.css','utf8').split(marker)[1];
assert.match(financePhone,/grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
assert.match(financePhone,/align-items:stretch/);
assert.match(financePhone,/min-height:88px/);
assert.match(financePhone,/text-align:left/);
console.log(JSON.stringify(results));
console.log('PASS: offline six semantic states, light/dark/System parity, AA text/3:1 dots, explicit/default tones, native props, shared surfaces/buttons/controls/table region, unchanged reference pages/shell and no new global workaround or network.');
