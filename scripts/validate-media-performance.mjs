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
