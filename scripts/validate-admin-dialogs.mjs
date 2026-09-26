// Isolated DOM-model tests. No browser, API, credentials or database access.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const listeners = new Map();
const frames = [];
class Element {
  constructor(name, parent = null) {
    this.name = name; this.parentElement = parent; this.children = [];
    this.inert = false; this.disabled = false; this.hidden = false;
    this.tabIndex = name === 'button' ? 0 : -1; this.attributes = {}; this.id = '';
    parent?.children.push(this);
  }
  get isConnected() { return this === document.body || Boolean(this.parentElement?.isConnected); }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  closest(selector) { return ((selector.includes('inert') && this.inert) || (selector.includes('hidden') && this.hidden)) ? this : this.parentElement?.closest(selector); }
  matches() { return this.disabled; }
  hasAttribute(key) { return key in this.attributes; }
  setAttribute(key, value) { this.attributes[key] = value; }
  getClientRects() { return this.hidden ? [] : [{}]; }
  querySelector(selector) { return this.children.find(child => selector.includes('role=') ? child.attributes.role === 'dialog' : child.name === 'h2'); }
  querySelectorAll() { return this.children.flatMap(child => [child, ...child.querySelectorAll()]); }
  focus() {
    if (this.disabled || this.closest('[inert]')) return;
    document.activeElement = this;
    for (const listener of listeners.get('focusin') || []) listener({target:this});
  }
}
const document = {
  body: new Element('body'), activeElement: null,
  addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type,new Set()); listeners.get(type).add(fn); },
  removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
};
let refs, refIndex, effects, id=0;
const exports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/hooks/useAdminDialog.ts','utf8'), {
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},
}).outputText, {exports, document, HTMLElement:Element, requestAnimationFrame:fn=>frames.push(fn), getComputedStyle:()=>({visibility:'visible'}), require(name) {
  assert.equal(name,'react');
  return {useId:()=>`dialog-${id}`,useRef(value){const i=refIndex++;return refs[i] ||= {current:value};},useLayoutEffect(fn){effects.push(fn);}};
}});
const background=new Element('main',document.body), opener=new Element('button',background);
const preInert=new Element('aside',document.body);preInert.inert=true;
function mount(close, canEscape=true, nested=false) {
  id++; refs=[];refIndex=0;effects=[];
  const props=exports.useAdminDialog(close,canEscape,nested);
  assert.equal(props.role,'dialog');assert.equal(props['aria-modal'],true);
  const root=nested?new Element('wrapper',document.body):null;
  const panel=new Element('div',root||document.body);panel.setAttribute('role','dialog');const title=new Element('h2',panel);
  const unsafe=new Element('button',panel),safe=new Element('button',panel),last=new Element('button',panel);
  safe.setAttribute('data-dialog-initial-focus','');props.ref.current=root||panel;
  const optionEffect=effects[0];optionEffect();const cleanup=effects[1]();
  return {panel,title,safe,last,unsafe,options:refs[1],close(){cleanup();panel.parentElement.children=panel.parentElement.children.filter(x=>x!==panel);panel.parentElement=null;if(root){root.parentElement.children=root.parentElement.children.filter(x=>x!==root);root.parentElement=null;}frames.splice(0).forEach(fn=>fn());}};
}
function key(key,shiftKey=false){const event={key,shiftKey,preventDefault(){},stopPropagation(){}};for(const fn of [...listeners.get('keydown')||[]])fn(event);}
opener.focus();let cancelled=0;const first=mount(()=>cancelled++);
assert.equal(document.activeElement,first.safe);assert.equal(first.panel.attributes['aria-labelledby'],first.title.id);assert.ok(first.title.id);
assert.equal(background.inert,true);opener.focus();assert.equal(document.activeElement,first.safe);
first.last.focus();key('Tab');assert.equal(document.activeElement,first.unsafe);
first.unsafe.focus();key('Tab',true);assert.equal(document.activeElement,first.last);
key('Escape');assert.equal(cancelled,1);
first.options.current.canEscape=false;key('Escape');assert.equal(cancelled,1);
first.options.current.canEscape=true;
first.safe.focus();let childCancel=0;const second=mount(()=>childCancel++);
assert.equal(first.panel.inert,true);key('Escape');assert.equal(childCancel,1);assert.equal(cancelled,1);
second.close();assert.equal(document.activeElement,first.safe);assert.equal(background.inert,true);
first.close();assert.equal(document.activeElement,opener);assert.equal(background.inert,false);assert.equal(preInert.inert,true);
opener.focus();let previewClosed=0;const preview=mount(()=>previewClosed++,true,true);
assert.equal(document.activeElement,preview.safe);assert.equal(background.inert,true);
preview.last.focus();key('Tab');assert.equal(document.activeElement,preview.unsafe);
key('Escape');assert.equal(previewClosed,1);preview.close();assert.equal(document.activeElement,opener);assert.equal(background.inert,false);
const integrations={templates:['LiveTemplateUpdateModal','TemplateSaveResultModal']};
for(const [page,names] of Object.entries(integrations)) {
 const source=fs.readFileSync(`src/app/${page}/page.tsx`,'utf8');
 for(const name of names){const start=source.indexOf(`function ${name}(`),end=source.indexOf('\nfunction ',start+1);const component=source.slice(start,end<0?undefined:end);assert.match(component,/useAdminDialog\(/);assert.match(component,/\.\.\.dialog/);assert.match(component,/data-dialog-initial-focus/);}
}
const builder=fs.readFileSync('src/app/templates/page.tsx','utf8');
assert.match(builder,/useAdminDialog\(onCancel, !saving\)/);
assert.match(builder,/useAdminDialog\(result.published \? undefined : onNotNow, !result.published && !publishing\)/);
console.log('PASS: all scoped dialog integrations; safe initial focus; title association; Tab/Shift+Tab wrapping; background exclusion; Escape enabled/disabled; stacked overlays; opener restoration; prior inert-state restoration. DOM-model verification only.');
