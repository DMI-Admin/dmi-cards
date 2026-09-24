// Fixture-only browser regression: no real auth, database or application mutations.
// Run after npm run build; browser tooling is supplied externally, not added to app dependencies.
// node scripts/validate-admin-clients-responsive.mjs --esbuild-module=/path/to/esbuild --playwright-module=/path/to/playwright
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
const esbuild=require(esbuildPath), {chromium}=require(playwrightPath);
const root=process.cwd(), tmp=fs.mkdtempSync(path.join(os.tmpdir(),'dmi-admin-responsive-'));
const mocks={
'@clerk/nextjs':"export const useAuth=()=>({getToken:async()=>{window.events.push('token');return 'fixture-token';}});export const useClerk=()=>({signOut:async()=>{}});",
'next/navigation':"export const usePathname=()=>location.pathname;export const useRouter=()=>({});",
'next/link':"import React from 'react';export default function Link(p){return React.createElement('a',p,p.children)}",
'next/image':"import React from 'react';export default function Image({fill,priority,...p}){return React.createElement('img',p)}",
'@/components/CardRenderer':"export default function CardRenderer(){return null;}",
'@/lib/templates':"export const getAdminTemplates=async()=>[];",
'@/lib/admin-card-mutations':"export const mutateAdminCard=async()=>{};",
'@/lib/admin-inventory':"export const getAdminInventory=async type=>{await new Promise(r=>setTimeout(r,10));return type==='clients'?window.records:[]};",
'@/lib/admin-client-contract':`
export async function getAdminClientCounts(){return {summary:{},areas:{individualCards:0,businessCards:0,businessPeople:0,businessActivatedUsers:0},staffCards:{},cardCounts:{}}}
export async function mutateAdminClient(url,method,body,token){
 window.events.push({url,method,body,token}); await new Promise(r=>setTimeout(r,180));
 if(window.failNext){window.failNext=false;throw new Error('Fixture request failed');}
 if(method==='POST' && url==='/api/admin/clients'){const id=crypto.randomUUID();window.records.unshift({...body,id,created_at:new Date().toISOString(),subscription_plan:'free',billing_status:'free'});return {id};}
 if(url.endsWith('/status')){window.records.find(r=>r.id===url.split('/')[4]).status=body.status;return {};}
 if(method==='PATCH'){Object.assign(window.records.find(r=>r.id===url.split('/').pop()),body);return {};}
 return {};
}`
};
fs.writeFileSync(path.join(tmp,'entry.jsx'),`
import React from 'react';import {createRoot} from 'react-dom/client';
import Page from '${root}/src/components/admin/AdminClientsPage.tsx';
window.events=[];window.records=Array.from({length:30},(_,i)=>({id:'fixture-'+i,full_name:'Alex Customer '+i,company_name:i>=15?'Company '+i:null,email:'alex'+i+'@example.invalid',account_type:i>=15?'business':'individual',status:i%5===0?'suspended':'active',subscription_plan:'free',created_at:new Date(2026,0,i+1).toISOString()}));
createRoot(document.getElementById('root')).render(<Page area={location.pathname.includes('business')?'business':'individual'}/>);
`);
await esbuild.build({entryPoints:[path.join(tmp,'entry.jsx')],bundle:true,outfile:path.join(tmp,'app.js'),nodePaths:[root+'/node_modules'],jsx:'automatic',loader:{'.css':'local-css'},plugins:[{name:'fixture',setup(build){
build.onResolve({filter:/.*/},args=>{
if(mocks[args.path])return {path:args.path,namespace:'fixture'};
if(args.path.startsWith('@/'))return {path:path.join(root,'src',args.path.slice(2)+(args.path.endsWith('Sidebar')?'.tsx':'.ts'))};
});
build.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks[args.path],loader:'jsx',resolveDir:root}));
}}]});

const css=fs.readdirSync(root+'/.next/static/chunks').filter(f=>f.endsWith('.css')).map(f=>fs.readFileSync(root+'/.next/static/chunks/'+f,'utf8')).join('\n');
const server=http.createServer((req,res)=>{
 const files={'/app.js':[tmp+'/app.js','text/javascript'],'/app.css':[tmp+'/app.css','text/css'],'/dmi-cards-logo.svg':[root+'/public/dmi-cards-logo.svg','image/svg+xml']};
 if(req.url==='/base.css'){res.setHeader('Content-Type','text/css');res.end(css);return;}
 if(files[req.url]){res.setHeader('Content-Type',files[req.url][1]);res.end(fs.readFileSync(files[req.url][0]));return;}
 res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/base.css"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true});
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
 for(const area of ['individual','business'])for(const width of [1920,1440,1024,768,540,390,320]){
  await page.setViewportSize({width,height:900});
  await page.goto(origin+'/clients/'+area);
  await page.getByRole('button',{name:area==='individual'?'Manage Alex Customer 14':'Manage',exact:area==='business'}).first().waitFor();
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
  assert.equal(overflow,false,area+' overflow '+width);
  if(width===390||width===1440)await page.screenshot({path:tmp+'/'+area+'-'+width+'.png',fullPage:true});
  await page.getByRole('button',{name:area==='individual'?'+ Add Individual Client':'+ Add Business',exact:true}).click();
  if(area==='individual'){
   const bounds=await Promise.all(['Full Name','Email','Phone Number','Plan'].map(name=>page.getByLabel(name,{exact:true}).boundingBox()));
   for(let i=1;i<bounds.length;i++){assert.equal(bounds[i].x,bounds[0].x);assert.equal(bounds[i].width,bounds[0].width);assert.ok(bounds[i].y>bounds[i-1].y+bounds[i-1].height);}
   assert.equal(await page.getByRole('button',{name:'Create Account',exact:true}).evaluate(node=>getComputedStyle(node).color),'rgb(255, 255, 255)');
  }
  const box=await page.locator('dialog[open]').boundingBox();
  assert.ok(box.width<=width,area+' dialog fits '+width);
  if(width<640)assert.equal(Math.round(box.width),width);
  for(let i=0;i<8;i++){await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>Boolean(document.activeElement.closest('dialog[open]'))),true);}
  await page.keyboard.press('Escape');assert.equal(await page.locator('dialog[open]').count(),0);
  if(area==='individual'){
   await page.getByRole('button',{name:'Manage Alex Customer 14',exact:true}).click();
   const detailRows=page.locator('dialog[open] [class*="detailStack"] > div');
   assert.deepEqual(await detailRows.locator('> p:first-child').allTextContents(),['Full Name','Email','Phone Number','Company Name','Account Type','Subscription','Billing Status','Status','Cards']);
   const bounds=await detailRows.evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,border:getComputedStyle(n).borderWidth};}));
   for(let i=1;i<bounds.length;i++){assert.equal(bounds[i].x,bounds[0].x);assert.ok(bounds[i].y>bounds[i-1].y);}
   assert.ok(bounds.every(b=>b.border==='0px'));
   const actions=await page.getByRole('region',{name:'Account Actions'}).boundingBox();
   assert.ok(actions.y>bounds.at(-1).y);
   await page.getByRole('button',{name:'Edit details',exact:true}).click();
   assert.equal(await page.getByRole('button',{name:'Save Changes',exact:true}).evaluate(node=>getComputedStyle(node).color),'rgb(255, 255, 255)');
   const editBounds=await Promise.all(['Full Name','Email','Phone Number','Company Name','Account Type'].map(name=>page.getByLabel(name,{exact:true}).boundingBox()));
   for(let i=1;i<editBounds.length;i++){assert.equal(editBounds[i].x,editBounds[0].x);assert.ok(editBounds[i].y>editBounds[i-1].y);}
   await page.getByRole('button',{name:'Cancel',exact:true}).click();
   await page.keyboard.press('Escape');
  }

 }
 await page.setViewportSize({width:390,height:844});await page.goto(origin+'/clients/individual');
 await page.getByRole('button',{name:'+ Add Individual Client',exact:true}).click();
 await page.getByLabel('Full Name',{exact:true}).fill('New Test Person');
 await page.getByLabel('Email',{exact:true}).fill('new@example.invalid');
 await page.evaluate(()=>{window.failNext=true;});
 await page.getByRole('button',{name:'Create Account',exact:true}).click();
 await page.getByRole('alert').waitFor();
 assert.equal(await page.getByLabel('Full Name',{exact:true}).inputValue(),'New Test Person');
 await page.getByRole('button',{name:'Create Account',exact:true}).click();
 await page.getByRole('heading',{name:'Account created',exact:true}).last().waitFor();
 assert.equal(await page.evaluate(()=>events.filter(e=>e?.method==='POST').length),2);
 await page.screenshot({path:tmp+'/onboarding-390.png',fullPage:true});
 await page.getByRole('button',{name:'View / Manage Client',exact:true}).click();
 await page.getByRole('heading',{name:'Manage Client',exact:true}).waitFor();
 await page.getByRole('button',{name:'Suspend Client',exact:true}).click();
 const confirmation=page.getByRole('dialog',{name:'Suspend Client',exact:true});
 await confirmation.getByRole('button',{name:'Cancel',exact:true}).click();
 assert.equal(await page.evaluate(()=>events.filter(e=>e?.url?.endsWith('/status')).length),0);
 await page.getByRole('button',{name:'Suspend Client',exact:true}).click();
 await page.evaluate(()=>{window.failNext=true;});
 await page.getByRole('dialog',{name:'Suspend Client',exact:true}).getByRole('button',{name:'Suspend Client',exact:true}).click();
 await page.getByRole('dialog',{name:'Suspend Client',exact:true}).getByRole('alert').waitFor();
 await page.screenshot({path:tmp+'/suspend-error-390.png',fullPage:true});
 await page.getByRole('dialog',{name:'Suspend Client',exact:true}).getByRole('button',{name:'Suspend Client',exact:true}).click();
 await page.getByRole('button',{name:'Reactivate Client',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>events.filter(e=>e==='token').length),2);

 await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'View All Clients',exact:true}).first().click();
 assert.equal(await page.getByLabel('Search people, company or email').getAttribute('placeholder'),'Search');
 for(const name of ['Previous','Next']){
  const button=page.getByRole('button',{name,exact:true});
  const pill=await button.evaluate(node=>({radius:getComputedStyle(node).borderRadius,background:getComputedStyle(node).backgroundColor,height:node.getBoundingClientRect().height}));
  assert.equal(pill.radius,'999px');assert.ok(pill.height>=44);assert.notEqual(pill.background,'rgba(0, 0, 0, 0)');
 }
 await page.getByLabel('Search people, company or email').fill('no matching account');
 await page.getByText('No matching individual clients found.',{exact:true}).waitFor();
 await page.keyboard.press('Escape');
 await page.goto(origin+'/clients/business');
 await page.getByRole('button',{name:'Manage',exact:true}).first().click();
 await page.getByRole('dialog',{name:'Company 29',exact:true}).waitFor();
 await page.screenshot({path:tmp+'/company-manage-390.png',fullPage:true});
 assert.equal(await page.evaluate(()=>document.querySelector('dialog[open]').scrollWidth>innerWidth),false);
 await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'+ Add Business',exact:true}).click();
 await page.getByLabel('Company Name',{exact:true}).fill('New Fixture Company');
 await page.getByLabel('Primary Contact Name',{exact:true}).fill('Pat Owner');
 await page.getByLabel('Primary Contact Email',{exact:true}).fill('pat@example.invalid');
 await page.getByRole('button',{name:'Create Account',exact:true}).click();
 await page.getByRole('heading',{name:'Account created',exact:true}).last().waitFor();
 await page.getByRole('button',{name:'Manage Company / Add Staff',exact:true}).click();
 await page.getByRole('dialog',{name:'New Fixture Company',exact:true}).waitFor();
 await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'Open Admin navigation',exact:true}).click();
 await page.getByRole('dialog',{name:'DMI Cards Admin',exact:true}).waitFor();
 await page.keyboard.press('Escape');
 assert.equal(await page.locator('dialog[open]').count(),0);
 await page.emulateMedia({reducedMotion:'reduce'});
 assert.equal(await page.getByRole('button',{name:'+ Add Business',exact:true}).evaluate(node=>getComputedStyle(node).animationName),'none');
 assert.equal(errors.length,0,errors.join('\n'));
 console.log('PASS: 14 responsive viewports, no page overflow, drawer width/Escape, create → success → exact-ID manage, cancelled status sends nothing, failure stays open, fresh-token retry after explicit action, successful suspend.');
 console.log('Screenshots:',tmp);
 await browser.close();server.close();
})().catch(e=>{console.error(e);process.exitCode=1;server.close();process.exit(1)});
