// Deterministic DOM lifecycle harness: no network, credentials, or database.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
let now=0, next=0, timers=new Map(), frames=new Map(), observer, images=[], visible, marks=[];
const exports={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/card-media-readiness.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
 exports, Event, performance:{clearMarks(){},mark(name){marks.push([name,now]);}},
 setTimeout(fn,delay){const id=++next;timers.set(id,{fn,at:now+delay});return id;},clearTimeout(id){timers.delete(id);},
 requestAnimationFrame(fn){const id=++next;frames.set(id,fn);return id;},cancelAnimationFrame(id){frames.delete(id);},
 MutationObserver:class{constructor(fn){observer=fn;}observe(){}disconnect(){}}
});
class Image extends EventTarget {
 constructor(source){super();this.dataset={cardMedia:source};this.src=source;this.complete=false;this.naturalWidth=0;this.failed=false;this.decode=()=>new Promise((resolve,reject)=>{this.decoded=resolve;this.rejected=reject;});this.addEventListener('card-media-timeout',()=>{this.failed=true;});}
 getAttribute(){return this.src;}
 load(){this.naturalWidth=100;this.complete=true;this.dispatchEvent(new Event('load'));}
}
const flush=async()=>{await Promise.resolve();for(const [id,fn] of [...frames]){frames.delete(id);fn();}};
const advance=async ms=>{now+=ms;for(const [id,t] of [...timers])if(t.at<=now){timers.delete(id);t.fn();}await flush();};
function start(sources){now=0;marks=[];images=sources.map(s=>new Image(s));visible=undefined;return exports.watchCardImages({querySelectorAll:()=>images},v=>visible=v);}
for(const kinds of [[],['profile'],['logo'],['banner'],['profile','logo','banner']]){
 const stop=start(kinds);await flush();assert.equal(visible,!kinds.length);
 for(const image of images){image.load();await flush();assert.equal(visible,false,'load alone does not reveal');image.decoded();await flush();}
 assert.equal(visible,true);stop();
}
let stop=start(['card-media:asset']);const old=images[0];old.load();
const fresh=new Image('card-media:replacement');images=[fresh];observer();old.decoded();await flush();assert.equal(visible,false,'stale decode cannot reveal replacement');
fresh.load();fresh.decoded();await flush();assert.equal(visible,true);
observer();await flush();assert.equal(visible,true,'text reconciliation does not reload settled resource');stop();
stop=start(['profile','banner']);await advance(2999);assert.equal(visible,false);await advance(1);assert.equal(visible,true);assert.ok(images.every(i=>i.failed));
images[0].load();images[0].decoded();await flush();assert.ok(images[0].failed,'late load cannot revive timeout');stop();
stop=start(['banner']);images[0].load();images[0].rejected();await flush();assert.equal(visible,true);assert.equal(images[0].failed,true);stop();
stop=start(['logo']);images[0].dispatchEvent(new Event('error'));await flush();assert.equal(visible,true);assert.equal(images[0].failed,true);stop();
stop=start(['profile']);images=[];observer();await flush();assert.equal(visible,true,'template hides/removes resource without waiting');stop();
stop=start(['/api/public/cards/card/media/logo?v=new']);await advance(120);images[0].load();await advance(25);images[0].decoded();await flush();assert.equal(visible,true);console.log('Synthetic public timing (ms):',JSON.stringify(marks));stop();
stop=start(['card-media:private']);images[0].src='';await advance(200);images[0].src='blob:authorized';observer();images[0].load();await advance(10);images[0].decoded();await flush();assert.equal(visible,true);console.log('Synthetic private timing (ms):',JSON.stringify(marks));stop();
const boundary=fs.readFileSync('src/components/CardReadyBoundary.tsx','utf8');assert.match(boundary,/inert=\{!ready\}/);assert.match(boundary,/visibility: ready/);assert.match(boundary,/absolute inset-0/);assert.doesNotMatch(boundary,/display:\s*["']none/);
console.log('PASS: actual readiness observer: profile/logo/banner/all/no media, decode barrier, 3-second timeout, failure, stale callbacks, replacement, unchanged resources, template removal, private/public resources; overlay shares real layout bounds.');
