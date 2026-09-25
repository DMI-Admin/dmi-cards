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
window.events=[];window.tokens=0;window.saved=null;window.entitlement=null;window.historyEvents=[];
window.fetch=async(url,options={})=>{
 window.events.push({url,method:options.method||'GET',body:options.body,headers:options.headers});
 await new Promise(r=>setTimeout(r,80));
 const respond=(data,status=200)=>new Response(JSON.stringify(data),{status});
 if(url.includes('/entitlement?'))return respond({workspace:window.entitlement?{id:'20000000-0000-4000-8000-000000000001',client_id:null}:null,entitlement:window.entitlement,effective_status:window.entitlement?.status||'absent',effective_seat_allowance:window.entitlement?.status==='active'?window.entitlement.seat_limit:0,evaluated_at:new Date().toISOString(),history:window.historyEvents,history_total:window.historyEvents.length,page:1,page_size:25});
 if(options.method==='POST'&&(url.endsWith('/activate')||url.endsWith('/actions'))){
  const b=JSON.parse(options.body);
  if(b.expected_onboarding_revision!==window.saved.revision||b.expected_entitlement_revision!==(window.entitlement?.revision||0))return respond({error:'Fixture stale commercial review'},409);
  if(window.failCommercial){window.failCommercial=false;return respond({error:'Fixture command failure'},503)}
  window.entitlement=window.entitlement?{...window.entitlement,...('seat_limit' in b?{seat_limit:b.seat_limit}:{}),...('ends_at' in b?{ends_at:b.ends_at}:{}),...('contract_reference' in b?{contract_reference:b.contract_reference}:{}),status:b.action==='suspend'?'suspended':b.action==='reactivate'?'active':b.action==='revoke'?'revoked':window.entitlement.status,revision:window.entitlement.revision+1}:{id:'30000000-0000-4000-8000-000000000001',workspace_id:'20000000-0000-4000-8000-000000000001',source:window.saved.access_type,status:'active',seat_limit:window.saved.requested_seats,starts_at:window.saved.contract_start+'T00:00:00Z',ends_at:window.saved.contract_end+'T00:00:00Z',invoice_reference:window.saved.invoice_reference,billing_frequency:window.saved.billing_frequency,contract_reference:b.contract_reference||null,revision:1};
  window.saved={...window.saved,status:'ready_to_activate',revision:window.saved.revision+1};
  window.historyEvents.unshift({...window.entitlement,id:b.operation_id,event_type:b.action,reason:b.reason,actor_clerk_user_id:'user_fixture',created_at:new Date().toISOString()});
  return respond({result:{entitlement_id:window.entitlement.id}});
 }
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
 const page=await browser.newPage({locale:"en-GB"});const errors=[];page.on('pageerror',e=>errors.push(e.message));
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


 // Actual native controls -> React state -> POST/PATCH -> saved response -> reload.
 // Chromium auto-advances date segments; WebKit uses Tab between UK date segments.
 async function keyboardDate(input,year){
  await input.fill('');await input.click({position:{x:18,y:20}});
  const segments=['25','09',String(year)];
  for(let i=0;i<segments.length;i++){for(const digit of segments[i])await page.keyboard.press(digit);if(engine==='webkit'&&i<2)await page.keyboard.press('Tab');}
  await page.getByLabel('Company / Trading Name',{exact:true}).click();
  assert.equal(await input.inputValue(),year+'-09-25');
 }
 for(const source of ['trial','complimentary','invoice']){
  await page.goto(origin+'/business-onboarding');await page.getByRole('button',{name:'+ New Business Onboarding',exact:true}).click();
  await page.getByLabel('Company / Trading Name',{exact:true}).fill('Date persistence '+source);
  await page.getByLabel('Website',{exact:true}).fill('test.co.uk');
  await page.getByLabel('Requested Seats',{exact:true}).fill('25');await page.getByLabel('Access Type').first().selectOption(source);
  if(source==='invoice'){await page.getByLabel('Billing Frequency').first().selectOption('quarterly');await page.getByLabel('Invoice Reference',{exact:true}).fill('INV-DATE');}
  const start=page.getByLabel('Contract Start',{exact:true}),end=page.getByLabel('Contract End / Expiry',{exact:true});
  const save=page.getByRole('button',{name:'Save Onboarding',exact:true}),reload=page.getByRole('button',{name:'Reload saved version',exact:true});
  const activation=page.getByRole('button',{name:source==='invoice'?'Mark Payment Received':source==='trial'?'Activate Trial':'Activate Complimentary Access',exact:true});
  assert.equal(await start.inputValue(),'');assert.equal(await page.getByText('No date selected',{exact:true}).count(),2);
  await start.fill('2026-09-25');await end.fill('2027-09-25');await end.press('Tab');
  await save.click();await page.getByText('Onboarding saved successfully.',{exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(()=>[window.saved.contract_start,window.saved.contract_end,window.saved.website]),['2026-09-25','2027-09-25','https://test.co.uk']);
  await reload.click();await page.waitForFunction(()=>!document.querySelector('input[name="contract_start"]').matches(':disabled'));
  assert.equal(await start.inputValue(),'2026-09-25');assert.equal(await end.inputValue(),'2027-09-25');
  await keyboardDate(start,2026);await keyboardDate(end,2027);await save.click();await page.getByText('Onboarding saved successfully.',{exact:true}).waitFor();
  await reload.click();await page.waitForFunction(()=>!document.querySelector('input[name="contract_start"]').matches(':disabled'));
  assert.equal(await start.inputValue(),'2026-09-25');assert.equal(await end.inputValue(),'2027-09-25');
  await start.fill('2026-09-26');await page.getByText('Save your commercial changes before activating the entitlement.',{exact:true}).waitFor();assert.equal(await activation.isDisabled(),true);
  assert.equal(await page.getByRole('form',{name:'Confirm commercial action'}).count(),0);
  await save.click();await page.getByText('Onboarding saved successfully.',{exact:true}).waitFor();await activation.click();
  const confirm=page.getByRole('form',{name:'Confirm commercial action'});await confirm.waitFor();await confirm.getByText('2026-09-26 00:00 UTC',{exact:true}).waitFor();await confirm.getByRole('button',{name:'Cancel',exact:true}).click();
  await start.fill('');await save.click();await page.getByText('Onboarding saved successfully.',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.saved.contract_start),null);
  await activation.click();await page.getByText('Save a Contract Start date before activating this Business entitlement.',{exact:true}).waitFor();assert.equal(await confirm.count(),0);
  // Native value present but no input/change event: blur/save must not silently send NULL.
  await start.evaluate(input=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'2026-09-25');});
  await save.click();await page.getByText('Onboarding saved successfully.',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.saved.contract_start),'2026-09-25');
  await reload.click();await page.waitForFunction(()=>!document.querySelector('input[name="contract_start"]').matches(':disabled'));assert.equal(await start.inputValue(),'2026-09-25');
  await activation.click();await confirm.waitFor();await confirm.getByRole('button',{name:'Cancel',exact:true}).click();
  assert.equal(await page.evaluate(()=>events.filter(e=>e.url.endsWith('/activate')).length),0,'readiness tests never activate');
  const saves=await page.evaluate(()=>events.filter(e=>e.method==='POST'||e.method==='PATCH').map(e=>JSON.parse(e.body)));assert.ok(saves.some(v=>v.revision),'PATCH covered');assert.ok(saves.some(v=>v.create_request_id),'POST covered');
 }
 // Commercial confirmation against the actual embedded panel; mock persistence only.
 for(const source of ['invoice','trial','complimentary']){
  await page.goto(origin+'/business-onboarding');await page.getByRole('button',{name:'Manage',exact:true}).waitFor();
  await page.evaluate(source=>{window.saved={id:'10000000-0000-4000-8000-000000000001',company_name:'Commercial fixture',contact_name:null,contact_email:null,contact_phone:null,company_website:null,country:null,company_address:null,invoice_reference:source==='invoice'?'INV-TEST':null,po_reference:null,requested_seats:100,contract_start:'2026-01-01',contract_end:'2027-01-01',billing_frequency:source==='invoice'?'quarterly':null,access_type:source,status:'draft',revision:1,notes:null,onboarding_method:'dmi_managed',created_at:new Date().toISOString(),updated_at:new Date().toISOString()};},source);
  await page.getByRole('button',{name:'Manage',exact:true}).click();
  const action=source==='invoice'?'Mark Payment Received':source==='trial'?'Activate Trial':'Activate Complimentary Access';
  await page.getByRole('button',{name:action,exact:true}).click();
  const form=page.getByRole('form',{name:'Confirm commercial action'});await form.waitFor();
  await form.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(await page.evaluate(()=>events.filter(e=>e.url.endsWith('/activate')).length),0);
  await page.getByRole('button',{name:action,exact:true}).click();
  await page.getByLabel('Admin reason / confirmation reference').fill('Reviewed fixture');
  await page.evaluate(()=>window.noToken=true);await form.getByRole('button',{name:'Confirm '+action,exact:true}).click();await page.getByText('Please sign in again. No commercial command was sent.').waitFor();
  assert.equal(await page.evaluate(()=>events.filter(e=>e.url.endsWith('/activate')).length),0);
  await page.evaluate(()=>{window.noToken=false;window.failCommercial=true;});await form.getByRole('button',{name:'Confirm '+action,exact:true}).click();await page.getByText('Fixture command failure').waitFor();
  await form.getByRole('button',{name:'Confirm '+action,exact:true}).dblclick();await page.getByText('Commercial approval recorded. No portal, staff, cards or employee seats were created.',{exact:true}).waitFor();
  const commands=await page.evaluate(()=>events.filter(e=>e.url.endsWith('/activate')));assert.equal(commands.length,2);assert.equal(JSON.parse(commands[0].body).operation_id,JSON.parse(commands[1].body).operation_id);assert.equal(commands[1].headers.Authorization,'Bearer fixture-token');
  assert.equal(await page.getByLabel('Requested Seats',{exact:true}).isDisabled(),true);
  await page.getByText('Confirmed Seat Allowance',{exact:true}).waitFor();
  for(const width of [1440,1024,768,540,390,320])for(const scheme of ['light','dark']){
   await page.setViewportSize({width,height:width<600?640:800});await page.evaluate(m=>{document.documentElement.dataset.adminAppearance=m},scheme);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,source+' commercial overflow '+width);
   if(source==='invoice'&&width===320&&scheme==='dark')await page.screenshot({path:tmp+'/commercial-mobile-dark.png',fullPage:true});
  }
  await page.setViewportSize({width:1280,height:720});
  await page.getByRole('button',{name:'Amend Commercial Terms',exact:true}).click();await page.getByLabel('Confirmed seat allowance',{exact:true}).fill('120');await page.getByLabel('Admin reason / confirmation reference').fill('Seat correction');
  await form.getByRole('button',{name:'Confirm Amend Commercial Terms',exact:true}).click();await form.waitFor({state:'hidden'});
  const amendment=await page.evaluate(()=>JSON.parse(events.filter(e=>e.url.endsWith('/actions')).at(-1).body));assert.equal(amendment.seat_limit,120);assert.equal('ends_at' in amendment,false,'unchanged timestamp not rewritten');
  await page.getByRole('button',{name:'Suspend Entitlement',exact:true}).click();await page.getByLabel('Admin reason / confirmation reference').fill('Suspend reviewed revision');
  await page.evaluate(()=>{window.saved.revision++;window.entitlement.revision++;});await page.getByRole('button',{name:'Refresh status',exact:true}).click();await page.waitForTimeout(150);
  await form.getByRole('button',{name:'Confirm Suspend Entitlement',exact:true}).click();await page.getByText('Fixture stale commercial review',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.entitlement.status),'active','stale review did not mutate');
 }

 assert.deepEqual(errors,[]);console.log('PASS '+engine+': native date control and keyboard POST/PATCH/reload, cleared start and dirty readiness for all three sources, website normalization; 32 viewport/theme cases, embedded workspace, no overflow, token failure, duplicate-save lock, save stays open, conflict preserves data, unsaved warning, search; three commercial sources, confirmation/cancel, retry UUID, fresh-token and duplicate protection, stale reviewed revisions, lossless amendments, commercial responsive light/dark. Screenshots: '+tmp);
}finally{await browser.close();await new Promise(r=>server.close(r));}
