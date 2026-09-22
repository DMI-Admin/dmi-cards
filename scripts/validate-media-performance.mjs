// Local only: real timing helpers and SSR image component, no API/DB requests.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import { renderToString } from 'react-dom/server';
const cache = new Map(); let authCalls = 0;
function load(file, globals = {}) {
  if(cache.has(file)) return cache.get(file);
  const exports={};cache.set(file,exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{
    exports,URL,Response,...globals,require(name){
      if(name==='react')return React;if(name==='react/jsx-runtime')return jsx;
      if(name==='@/lib/supabase')return{supabase:{auth:{getSession(){authCalls++;throw Error('Unexpected SSR auth');}}}};
      if(name.startsWith('@/'))return load(name.replace('@/','src/')+'.ts');throw Error(name);
    }
  });return exports;
}
const {MediaRequestTiming}=load('src/lib/media-request-timing.ts');
const timer=new MediaRequestTiming();
assert.equal(await timer.measure('auth',async()=>42),42);
await assert.rejects(timer.measure('finalization',async()=>{throw Error('synthetic');}));
const response=timer.response(new Response('unchanged',{headers:{'Cache-Control':'private, no-store'}}));
assert.match(response.headers.get('Server-Timing'),/^auth;dur=\d+, finalization;dur=\d+, total;dur=\d+$/);
assert.equal(await response.text(),'unchanged');assert.equal(response.headers.get('Cache-Control'),'private, no-store');
const entries=new Map();let now=0;
const {startClientMediaTiming}=load('src/lib/client-media-timing.ts',{performance:{now:()=>++now,clearMeasures:name=>entries.delete(name),measure:(name,range)=>entries.set(name,range)}});
for(let i=0;i<100;i++)startClientMediaTiming('publish')();
assert.equal(entries.size,1);assert.ok(entries.has('dmi-media:publish'));
const Image=load('src/components/CardMediaImage.tsx').default;
const url='/api/public/cards/11111111-1111-4111-8111-111111111111/media/logo?v=22222222-2222-4222-8222-222222222222';
const html=renderToString(React.createElement(Image,{src:url,alt:'Logo'}));
assert.ok(html.includes(`src="${url}"`),'public image src exists before hydration');
assert.match(html,/loading="eager"/);assert.match(html,/fetchPriority="high"/);
assert.match(html,/<link rel="preload" as="image"/,'React emits early matching preload');
assert.equal(authCalls,0,'public SSR never waits for private auth/blob effect');
const privateHtml=renderToString(React.createElement(Image,{src:'card-media:22222222-2222-4222-8222-222222222222',alt:'Logo'}));
assert.ok(!privateHtml.includes('/api/public/cards/'));assert.ok(!privateHtml.includes('rel="preload"'));
const empty=renderToString(React.createElement(Image,{src:'',alt:'Logo'}));assert.match(empty,/display:none/);
console.log('PASS: timing values only, bounded client entries, real public SSR img/preload before hydration, private path unchanged and empty media hidden.');

// Exercise the actual shared downloader: simultaneous renders share bytes, never
// completed responses or authorization across users. No network/DB involved.
const {createPrivateMediaLoader}=load('src/lib/client-media-request.ts');
const ref='card-media:22222222-2222-4222-8222-222222222222';
let token='owner-a', downloads=0; const releases=[]; const requests=[];
const loader=createPrivateMediaLoader(async()=>token,async(path,options)=>{
  downloads++; requests.push({path,options});
  await new Promise(resolve=>releases.push(resolve));
  return new Response('synthetic image bytes');
});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const a=loader(ref), b=loader(ref), c=loader(ref);
await tick();assert.equal(downloads,1,'three simultaneous instances share one GET');
releases.shift()(); const blobs=await Promise.all([a,b,c]);
assert.equal(blobs[0],blobs[1]);assert.equal(blobs[1],blobs[2]);
assert.equal(requests[0].options.cache,'no-store');
assert.equal(requests[0].options.headers.Authorization,'Bearer owner-a');
const again=loader(ref);await tick();assert.equal(downloads,2,'later mount reauthorizes rather than caching');
releases.shift()();await again;
const firstOwner=loader(ref);await tick();token='owner-b';const secondOwner=loader(ref);
await tick();assert.equal(downloads,4,'different authorization never shares request');
releases.splice(0).forEach(resolve=>resolve());await Promise.all([firstOwner,secondOwner]);
token=null;await assert.rejects(loader(ref));assert.equal(downloads,4,'no session means no GET');
let failures=0;
const failing=createPrivateMediaLoader(async()=> 'owner',async()=>{failures++;return new Response('',{status:404});});
await assert.rejects(failing(ref));await assert.rejects(failing(ref));assert.equal(failures,2,'failures never poison retries');
const {resolveCardMedia}=load('src/lib/card-media.ts');
for(const kind of ['profile','logo','banner']){
  const context={id:'11111111-1111-4111-8111-111111111111',kind};
  const original=resolveCardMedia(ref,context);
  assert.equal(original,resolveCardMedia(ref,context),'unchanged asset has stable URL');
  assert.notEqual(original,resolveCardMedia('card-media:33333333-3333-4333-8333-333333333333',context),'replacement changes URL');
  const rendered=renderToString(React.createElement(Image,{src:original,alt:kind}));
  assert.ok(rendered.includes(`src="${original}"`),'all public media have SSR src');
}
console.log('PASS: private in-flight deduplication, authorization isolation, no completed cache, failed retry, stable/versioned URLs and all media SSR.');

// The real boundary preserves SSR image/preload discovery while concealing card content.
const Boundary=load('src/components/CardReadyBoundary.tsx').default;
const gated=renderToString(React.createElement(Boundary,{hasMedia:true},React.createElement(Image,{src:url,alt:'Logo'})));
assert.match(gated,/visibility:hidden/);
assert.match(gated,/inert=""/);
assert.match(gated,/aria-busy="true"/);
assert.ok(gated.includes(`src="${url}"`));
assert.match(gated,/rel="preload"/);
const noMedia=renderToString(React.createElement(Boundary,{hasMedia:false},'Card text'));
assert.match(noMedia,/visibility:visible/);
assert.doesNotMatch(noMedia,/absolute inset-0/);
console.log('PASS: actual readiness boundary SSR retains img/preload, conceals and locks real content; no-media SSR is immediately visible.');
