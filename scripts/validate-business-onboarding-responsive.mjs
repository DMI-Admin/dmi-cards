// Fixture-only browser regression: no real auth, database or application mutations.
// Run after npm run build; browser tooling is supplied externally, not added to app dependencies.
// node scripts/validate-admin-clients-responsive.mjs --esbuild-module=/path/to/esbuild --playwright-module=/path/to/playwright
import {adminAppearanceBootstrap} from './validate-admin-appearance.mjs';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const option=name=>process.argv.find(arg=>arg.startsWith(name+'='))?.slice(name.length+1);
const esbuildPath=option('--esbuild-module'), playwrightPath=option('--playwright-module');
assert.ok(esbuildPath && playwrightPath,'Supply external esbuild and playwright module paths; no app dependencies are changed.');
const esbuild=require(esbuildPath), engines=require(playwrightPath);
const engine=option('--browser') || 'chromium';
const root=process.cwd(), tmp=fs.mkdtempSync(path.join(os.tmpdir(),'dmi-admin-responsive-'));
const mocks={
 '@clerk/nextjs':"export const useAuth=()=>({getToken:async()=>{window.tokens++;if(window.noToken)return null;return 'fixture-token'}});export const useClerk=()=>({signOut:async()=>{}})",
 'next/navigation':"export const usePathname=()=>location.pathname;export const useRouter=()=>({})",
 'next/link':"import React from 'react';export default function Link(p){return React.createElement('a',p,p.children)}",
 'next/image':"import React from 'react';export default function Image({fill,priority,...p}){return React.createElement('img',p)}"
};
fs.writeFileSync(path.join(tmp,'entry.jsx'),`
import React from 'react';import {createRoot} from 'react-dom/client';
import Page from '${root}/src/components/admin/BusinessOnboardingPage.tsx';
import {AdminAppearanceInitializer} from '${root}/src/components/admin/AdminAppearance.tsx';
window.events=[];window.tokens=0;window.saved=null;
window.fetch=async(url,options={})=>{
 window.events.push({url,method:options.method||'GET',body:options.body,headers:options.headers});
 await new Promise(r=>setTimeout(r,80));
 const respond=(data,status=200)=>new Response(JSON.stringify(data),{status});
 if(options.method){if(window.failNext){window.failNext=false;return respond({error:'Fixture conflict: reload saved version'},409)}const body=JSON.parse(options.body);window.saved={...body,id:'10000000-0000-4000-8000-000000000001',revision:(body.revision||0)+1,created_at:new Date().toISOString(),updated_at:new Date().toISOString(),onboarding_method:'dmi_managed'};return respond({record:window.saved})}
 if(url.endsWith('/summary'))return respond({summary:{inProgress:30,awaitingInformation:1,awaitingPayment:2,trialComplimentary:3,readyToActivate:4}});
 if(url.includes('?'))return respond({items:[window.saved||{id:'10000000-0000-4000-8000-000000000001',company_name:'Prospective company with longer trading name',contact_email:'contact@example.invalid',requested_seats:200,status:'draft',access_type:'invoice',updated_at:new Date().toISOString()}],total:30});
 return respond({record:window.saved});
};
createRoot(document.getElementById('root')).render(<><AdminAppearanceInitializer/><Page/></>);
`);
await esbuild.build({entryPoints:[path.join(tmp,'entry.jsx')],bundle:true,outfile:path.join(tmp,'app.js'),nodePaths:[root+'/node_modules'],jsx:'automatic',loader:{'.css':'local-css'},plugins:[{name:'fixture',setup(build){
 build.onResolve({filter:/.*/},args=>{if(mocks[args.path])return {path:args.path,namespace:'fixture'};if(args.path.startsWith('@/'))return {path:path.join(root,'src',args.path.slice(2)+(args.path.endsWith('Sidebar')?'.tsx':'.ts'))}});
 build.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks[args.path],loader:'jsx',resolveDir:root}));
}}]});
const css=fs.readdirSync(root+'/.next/static/chunks').filter(f=>f.endsWith('.css')).map(f=>fs.readFileSync(root+'/.next/static/chunks/'+f,'utf8')).join('\n');
const server=http.createServer((req,res)=>{
 const files={'/app.js':[tmp+'/app.js','text/javascript'],'/app.css':[tmp+'/app.css','text/css'],'/dmi-cards-logo.svg':[root+'/public/dmi-cards-logo.svg','image/svg+xml']};
 if(req.url==='/base.css'){res.setHeader('Content-Type','text/css');res.end(css);return;}
 if(files[req.url]){res.setHeader('Content-Type',files[req.url][1]);res.end(fs.readFileSync(files[req.url][0]));return;}
 res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><script>'+adminAppearanceBootstrap+'</script><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/base.css"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await engines[engine].launch({headless:true});
try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
 for(const width of [1920,1440,1280,1024,768,540,390,320])for(const [mode,osMode] of [['system','light'],['system','dark'],['light','dark'],['dark','light']]){
  await page.setViewportSize({width,height:width<600?640:800});await page.emulateMedia({colorScheme:osMode});
  await page.goto(origin+'/business-onboarding');await page.evaluate(m=>localStorage.setItem('dmi-admin-appearance',m),mode);await page.reload();
  await page.getByRole('button',{name:'Manage',exact:true}).waitFor();
  await page.getByRole('button',{name:'+ New Business Onboarding',exact:true}).click();
  await page.getByLabel('Company / Trading Name', {exact:true}).fill('Fixture company');
  assert.equal(await page.locator('[role="dialog"]').count(),0);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${width} ${mode} overflow`);
  const appearance=await page.evaluate(()=>({mode:document.documentElement.dataset.adminAppearance,bg:getComputedStyle(document.documentElement).getPropertyValue('--admin-page').trim()}));
  assert.equal(appearance.mode,mode);assert.equal(appearance.bg,(mode==='dark'||mode==='system'&&osMode==='dark')?'#111320':'#f5f4f9');
  assert.equal(await page.getByRole('button',{name:'Save Onboarding',exact:true}).isEnabled(),true);
  if(width===1440&&mode==='light')await page.screenshot({path:tmp+'/desktop.png',fullPage:true});
  if(width===320&&mode==='dark')await page.screenshot({path:tmp+'/mobile-dark.png',fullPage:true});
 }
 // Actual page interactions against fixture APIs only.
 await page.setViewportSize({width:1280,height:720});await page.goto(origin+'/business-onboarding');
 await page.getByRole('button',{name:'+ New Business Onboarding',exact:true}).click();
 await page.getByLabel('Company / Trading Name',{exact:true}).fill('Saved company');
 await page.evaluate(()=>window.noToken=true);await page.getByRole('button',{name:'Save Onboarding',exact:true}).click();
 await page.getByRole('alert').waitFor();assert.equal(await page.evaluate(()=>events.filter(e=>e.method==='POST').length),0);
 await page.evaluate(()=>window.noToken=false);await page.getByRole('button',{name:'Save Onboarding',exact:true}).dblclick();
 await page.getByText('Onboarding saved successfully.',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>events.filter(e=>e.method==='POST').length),1);
 assert.equal(await page.getByRole('region',{name:'Onboarding workspace'}).count(),1);
 await page.getByLabel('Company / Trading Name',{exact:true}).fill('Unsaved company');
 page.once('dialog',d=>d.dismiss());await page.evaluate(()=>{history.replaceState({},'', '/business-onboarding?back');dispatchEvent(new PopStateEvent('popstate'))});assert.ok(page.url().endsWith('/business-onboarding'));
 page.once('dialog',d=>d.dismiss());await page.getByRole('button',{name:'Close workspace',exact:true}).click();assert.equal(await page.getByLabel('Company / Trading Name',{exact:true}).inputValue(),'Unsaved company');
 await page.evaluate(()=>window.failNext=true);await page.getByRole('button',{name:'Save Onboarding',exact:true}).click();await page.getByText('Fixture conflict: reload saved version',{exact:true}).waitFor();assert.equal(await page.getByLabel('Company / Trading Name',{exact:true}).inputValue(),'Unsaved company');
 await page.getByRole('button',{name:'Save Onboarding',exact:true}).click();await page.getByText('Onboarding saved successfully.',{exact:true}).waitFor();
 const mutations=await page.evaluate(()=>events.filter(e=>e.method==='PATCH'));assert.ok(mutations.every(e=>e.url.endsWith('/10000000-0000-4000-8000-000000000001')&&e.headers.Authorization==='Bearer fixture-token'));
 await page.getByLabel('Search',{exact:true}).fill('needle');await page.waitForTimeout(350);assert.ok(await page.evaluate(()=>events.some(e=>e.url.includes('search=needle'))));
 assert.deepEqual(errors,[]);console.log('PASS '+engine+': 32 viewport/theme cases, embedded workspace, no overflow, token failure, duplicate-save lock, save stays open, conflict preserves data, unsaved warning, search. Screenshots: '+tmp);
}finally{await browser.close();await new Promise(r=>server.close(r));}
