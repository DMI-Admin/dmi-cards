// Fixture-only browser regression: no real auth, database or application mutations.
// Run after npm run build; browser tooling is supplied externally, not added to app dependencies.
// node scripts/validate-admin-clients-responsive.mjs --esbuild-module=/path/to/esbuild --playwright-module=/path/to/playwright
import {runAdminThemeChecks, adminAppearanceBootstrap} from './validate-admin-appearance.mjs';
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
'@clerk/nextjs':"export const useAuth=()=>({getToken:async()=>{window.events.push('token');return 'fixture-token';}});export const useClerk=()=>({signOut:async()=>{}});",
'next/navigation':"export const usePathname=()=>location.pathname;export const useRouter=()=>({});",
'next/link':"import React from 'react';export default function Link(p){return React.createElement('a',p,p.children)}",
'next/image':"import React from 'react';export default function Image({fill,priority,...p}){return React.createElement('img',p)}",
'@/components/CardRenderer':"export default function CardRenderer(){return null;}",
'@/lib/templates':"export const getAdminTemplates=async()=>[];",
'@/lib/admin-card-mutations':"export const mutateAdminCard=async()=>{};",
'@/lib/admin-inventory':"export const getAdminInventory=async type=>{await new Promise(r=>setTimeout(r,location.search.includes('loading')?800:10));if(location.search.includes('empty'))return [];return type==='clients'?window.records:type==='client-users'?window.people:[]};",
'@/lib/admin-client-contract':`
export async function getAdminClientCounts(){return {summary:{},areas:{individualCards:0,businessCards:0,businessPeople:0,businessActivatedUsers:0},staffCards:{},cardCounts:{},staffActivated:Object.fromEntries(window.people.map(p=>[p.id,p.id==='linked-person']))}}
export async function mutateAdminClient(url,method,body,token){
 window.events.push({url,method,body,token}); await new Promise(r=>setTimeout(r,180));
 if(window.failNext){window.failNext=false;throw new Error('Fixture request failed');}
 if(method==='POST' && url==='/api/admin/clients'){const id=crypto.randomUUID();window.records.unshift({...body,id,created_at:new Date().toISOString(),subscription_plan:'free',billing_status:'free'});return {id};}
 if(method==='POST' && url==='/api/admin/client-users'){const id=crypto.randomUUID();window.people.unshift({...body,id,created_at:new Date().toISOString()});return {id};}
 if(url.endsWith('/status')){window.records.find(r=>r.id===url.split('/')[4]).status=body.status;return {};}
 if(method==='PATCH'){Object.assign(window.records.find(r=>r.id===url.split('/').pop()),body);return {};}
 return {};
}`
};
fs.writeFileSync(path.join(tmp,'entry.jsx'),`
import React from 'react';import {createRoot} from 'react-dom/client';
import Page from '${root}/src/components/admin/AdminClientsPage.tsx';
import Settings from '${root}/src/app/settings/page.tsx';
import {AdminAppearanceInitializer} from '${root}/src/components/admin/AdminAppearance.tsx';
import ThemeInitializer from '${root}/src/components/ThemeInitializer.tsx';
window.people=[{id:'linked-person',client_id:'fixture-29',full_name:'Linked Person',email:'linked@example.invalid'},{id:'unlinked-person',client_id:'fixture-29',full_name:'Unlinked Person',email:'unlinked@example.invalid'}];window.events=[];window.records=Array.from({length:30},(_,i)=>({id:'fixture-'+i,full_name:'Alex Customer '+i,company_name:i>=15?'Company '+i:null,email:'alex'+i+'@example.invalid',account_type:i>=15?'business':'individual',status:i%5===0?'suspended':'active',subscription_plan:'free',created_at:new Date(2026,0,i+1).toISOString()}));
createRoot(document.getElementById('root')).render(<><ThemeInitializer/><AdminAppearanceInitializer/>{location.pathname==='/settings'?<Settings/>:<Page area={location.pathname.includes('business')?'business':'individual'}/>}</>);
`);
await esbuild.build({entryPoints:[path.join(tmp,'entry.jsx')],bundle:true,outfile:path.join(tmp,'app.js'),nodePaths:[root+'/node_modules'],jsx:'automatic',loader:{'.css':'local-css'},plugins:[{name:'fixture',setup(build){
build.onResolve({filter:/.*/},args=>{
if(mocks[args.path])return {path:args.path,namespace:'fixture'};
if(args.path.startsWith('@/'))return {path:path.join(root,'src',args.path.slice(2)+((args.path.endsWith('Sidebar')||args.path.endsWith('AdminAppearance'))?'.tsx':'.ts'))};
});
build.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks[args.path],loader:'jsx',resolveDir:root}));
}}]});

const css=fs.readdirSync(root+'/.next/static/chunks').filter(f=>f.endsWith('.css')).map(f=>fs.readFileSync(root+'/.next/static/chunks/'+f,'utf8')).join('\n');
const server=http.createServer((req,res)=>{
 const files={'/app.js':[tmp+'/app.js','text/javascript'],'/app.css':[tmp+'/app.css','text/css'],'/dmi-cards-logo.svg':[root+'/public/dmi-cards-logo.svg','image/svg+xml']};
 if(req.url==='/base.css'){res.setHeader('Content-Type','text/css');res.end(css);return;}
 if(files[req.url]){res.setHeader('Content-Type',files[req.url][1]);res.end(fs.readFileSync(files[req.url][0]));return;}
 res.setHeader('Content-Type','text/html');res.end('<!doctype html><html data-theme="system"><head><script>'+adminAppearanceBootstrap+'</script><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/base.css"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
});
async function checkInventoryDensity(table,width){
 const clip=await table.evaluate(n=>{const s=getComputedStyle(n.parentElement);return {overflow:s.overflow,bottom:s.borderBottomLeftRadius};});
 assert.equal(clip.overflow,'clip');assert.ok(parseFloat(clip.bottom)>0);

 const m=await table.evaluate(table=>{
  const row=table.querySelector('tbody tr'),cells=[...row.cells],heads=[...table.querySelectorAll('thead th')];
  return {height:row.getBoundingClientRect().height,display:getComputedStyle(row).display,headDisplay:getComputedStyle(table.querySelector('thead')).display,
   widths:heads.map(n=>n.getBoundingClientRect().width),font:cells.map(n=>getComputedStyle(n).fontSize),padding:getComputedStyle(cells[0]).paddingTop,
   weight:getComputedStyle(cells[0]).fontWeight,headerFont:getComputedStyle(heads[0]).fontSize,
   controls:[...row.querySelectorAll('button')].map(n=>({height:n.getBoundingClientRect().height,font:getComputedStyle(n).fontSize})),
   spans:[...row.querySelectorAll('span')].map(n=>getComputedStyle(n).fontSize),
   lines:cells.slice(0,2).map(n=>{const range=document.createRange();range.selectNodeContents(n);return range.getBoundingClientRect().height/parseFloat(getComputedStyle(n).lineHeight)}),
   contained:[...table.querySelectorAll('td[data-label="Status"] > span, td[data-label="Manage"] button')].every(n=>{const cell=n.closest('td'),c=cell.getBoundingClientRect(),r=n.getBoundingClientRect(),style=getComputedStyle(cell);return r.left>=c.left+parseFloat(style.paddingLeft)-1&&r.right<=c.right-parseFloat(style.paddingRight)+1&&n.getClientRects().length===1;}),
   overflow:table.scrollWidth>table.clientWidth+1};
 });
 assert.equal(m.overflow,false,'inventory overflow');
 if(width>=1024){
  assert.equal(m.contained,true,'status/actions stay on one line within cells');
  assert.ok(m.height<=58&&m.height>=44,'compact row '+JSON.stringify(m));assert.equal(m.padding,'6px');
  assert.ok(m.font.every(f=>f==='13px'));assert.ok(m.spans.every(f=>f==='13px'));assert.ok(Number(m.weight)>=600);assert.equal(m.headerFont,'11px');
  assert.ok(m.controls.every(c=>c.height>=44&&c.font==='13px'));assert.ok(m.widths[3]<=57);
  assert.ok(m.widths[0]>m.widths[2]*2&&m.widths[1]>m.widths[2]*2);
  assert.ok(m.widths[4]<=105&&m.widths[5]<=101);assert.ok(m.lines.every(n=>n<1.3),'ordinary contact text fits one line');
 }else if(width<640){assert.equal(m.display,'grid');assert.equal(m.headDisplay,'none');assert.equal(m.padding,'0px');}
}
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin='http://127.0.0.1:'+server.address().port;
 const browser=await engines[engine].launch({headless:true});
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
 for(const area of ['individual','business'])for(const width of [1920,1440,1280,1200,1024,768,540,390,320]){
  await page.setViewportSize({width,height:900});
  await page.goto(origin+'/clients/'+area);
  await page.getByRole('button',{name:area==='individual'?'Manage Alex Customer 14':'Manage',exact:area==='business'}).first().waitFor();
  await checkInventoryDensity(page.locator('table[class*="compactInventory"]').first(),width);
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
  // WebKit on macOS uses Option-Tab to include buttons/links in keyboard navigation.
  for(let i=0;i<8;i++){await page.keyboard.press(engine==='webkit'?'Alt+Tab':'Tab');assert.equal(await page.evaluate(()=>Boolean(document.activeElement.closest('dialog[open]'))),true);}
  await page.keyboard.press('Escape');assert.equal(await page.locator('dialog[open]').count(),0);
  if(area==='individual'){
   await page.getByRole('button',{name:'Manage Alex Customer 14',exact:true}).click();
   const detailRows=page.locator('dialog[open] [class*="detailStack"] > div');
   assert.deepEqual(await detailRows.locator('> p:first-child').allTextContents(),['Full Name','Email','Phone Number']);
   const bounds=await detailRows.evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,border:getComputedStyle(n).borderWidth};}));
   for(let i=1;i<bounds.length;i++){assert.equal(bounds[i].x,bounds[0].x);assert.ok(bounds[i].y>bounds[i-1].y);}
   assert.ok(bounds.every(b=>b.border==='0px'));
   const actions=await page.getByRole('region',{name:'Account Actions'}).boundingBox();
   assert.ok(actions.y>bounds.at(-1).y);
   await page.getByRole('button',{name:'Edit details',exact:true}).click();
   assert.equal(await page.getByRole('button',{name:'Save Changes',exact:true}).evaluate(node=>getComputedStyle(node).color),'rgb(255, 255, 255)');
   const editBounds=await Promise.all(['Full Name','Email','Phone Number'].map(name=>page.getByLabel(name,{exact:true}).boundingBox()));
   for(let i=1;i<editBounds.length;i++){assert.equal(editBounds[i].x,editBounds[0].x);assert.ok(editBounds[i].y>editBounds[i-1].y);}
   await page.getByRole('button',{name:'Cancel',exact:true}).click();
   await page.keyboard.press('Escape');
  }

 }
 for(const {width,height} of [{width:1440,height:740},{width:1280,height:720},{width:768,height:600},{width:390,height:667},{width:320,height:568}]){
  await page.setViewportSize({width,height});await page.goto(origin+'/clients/individual');
  await page.getByRole('button',{name:'Manage Alex Customer 14',exact:true}).click();
  assert.deepEqual(await page.locator('dialog[open] dt').allTextContents(),['Plan','Cards','Status']);
  for(const editing of [false,true]){
   if(editing)await page.getByRole('button',{name:'Edit details',exact:true}).click();
   assert.equal(await page.getByLabel('Company Name',{exact:true}).count(),0);
   assert.equal(await page.getByLabel('Account Type',{exact:true}).count(),0);
   const body=page.locator('dialog[open] [class*="sheetBody"]');
   const metrics=await body.evaluate(n=>({overflow:n.scrollHeight-n.clientHeight,height:n.clientHeight}));
   assert.ok(metrics.overflow<= (width>=1280?0:metrics.height*0.75),'bounded drawer scroll '+width+'x'+height+' edit='+editing);
   const action=page.getByRole('button',{name:'Suspend Client',exact:true});
   await action.scrollIntoViewIfNeeded();const box=await action.boundingBox();
   assert.ok(box.y>=0&&box.y+box.height<=height,'Account Actions reachable');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  }
  await page.keyboard.press('Escape');
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
 await page.evaluate(()=>{window.failNext=true;});
 await page.getByRole('button',{name:'Create Business',exact:true}).click();
 await page.getByRole('alert').waitFor();
 assert.equal(await page.getByLabel('Company Name',{exact:true}).inputValue(),'New Fixture Company');
 await page.getByRole('button',{name:'Create Business',exact:true}).evaluate(button=>{button.click();button.click();});
 await page.getByRole('heading',{name:'Company created',exact:true}).last().waitFor();
 assert.equal(await page.locator('dialog[open]').count(),1);
 const companyId=await page.evaluate(()=>window.records.find(r=>r.company_name==='New Fixture Company').id);
 assert.equal(await page.evaluate(()=>window.events.filter(e=>e.url==='/api/admin/clients'&&e.body.company_name==='New Fixture Company').length),2); // one failure, one durable create
 await page.getByRole('button',{name:'Add Person',exact:true}).click();
 const addPerson=page.getByRole('dialog',{name:'Add Person',exact:true});
 await addPerson.getByLabel('First Name',{exact:true}).fill('Sam');await addPerson.getByLabel('Last Name',{exact:true}).fill('Staff');
 await addPerson.getByLabel('Email',{exact:true}).fill('sam@example.invalid');
 await addPerson.getByRole('button',{name:'Add Person',exact:true}).evaluate(button=>{button.click();button.click();});
 await page.getByRole('dialog',{name:'New Fixture Company',exact:true}).waitFor();
 const staffWrite=await page.evaluate(()=>window.events.filter(e=>e.url==='/api/admin/client-users'));
 assert.equal(staffWrite.length,1);assert.equal(staffWrite[0].body.client_id,companyId);
 assert.equal(staffWrite[0].body.full_name,'Sam Staff');assert.ok(!('user_id' in staffWrite[0].body));assert.ok(!('profile_id' in staffWrite[0].body));
 const companyDrawer=page.getByRole('dialog',{name:'New Fixture Company',exact:true});
 await companyDrawer.getByText('Unlinked',{exact:true}).waitFor();
 await companyDrawer.getByRole('button',{name:'View All People',exact:true}).click();
 await page.getByRole('dialog',{name:'All People',exact:true}).getByText('Sam Staff',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Back to Company',exact:true}).click();
 await companyDrawer.getByRole('button',{name:'Edit Company',exact:true}).click();
 const editCompany=page.getByRole('dialog',{name:'Edit Company',exact:true});
 await editCompany.getByLabel('Company Name',{exact:true}).fill('Edited Fixture Company');
 await editCompany.getByRole('button',{name:'Save Changes',exact:true}).click();
 const edited=page.getByRole('dialog',{name:'Edited Fixture Company',exact:true});await edited.waitFor();
 const companyEdit=await page.evaluate(id=>window.events.find(e=>e.url==='/api/admin/clients/'+id),companyId);
 assert.deepEqual(Object.keys(companyEdit.body).sort(),['company_name','email','full_name','phone']);
 for(const action of ['Suspend Company','Reactivate Company']){
  await edited.getByRole('button',{name:action,exact:true}).click();
  const confirmation=page.getByRole('dialog',{name:action,exact:true});
  await confirmation.getByRole('button',{name:action,exact:true}).click();await confirmation.waitFor({state:'hidden'});
 }
 assert.equal(await page.evaluate(id=>window.events.filter(e=>e.url==='/api/admin/clients/'+id+'/status'&&e.method==='PATCH'&&e.token==='fixture-token').length,companyId),2);
 await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'Manage',exact:true}).first().click();
 await page.getByRole('dialog',{name:'Edited Fixture Company',exact:true}).waitFor();
 await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'Open Admin navigation',exact:true}).click();
 await page.getByRole('dialog',{name:'DMI Cards Admin',exact:true}).waitFor();
 await page.keyboard.press('Escape');
 assert.equal(await page.locator('dialog[open]').count(),0);
 // Company-specific widths AND short heights; no live API/data calls.
 for(const [width,height] of [[1440,740],[1280,600],[768,600],[540,500],[320,568]]){
  await page.setViewportSize({width,height});await page.goto(origin+'/clients/business');
  await page.getByRole('button',{name:'Manage',exact:true}).first().click();
  const company=page.getByRole('dialog',{name:'Company 29',exact:true});
  await company.getByText('Activated',{exact:true}).waitFor();await company.getByText('Unlinked',{exact:true}).waitFor();
  await company.getByRole('button',{name:'Suspend Company',exact:true}).scrollIntoViewIfNeeded();
  const actionBox=await company.getByRole('button',{name:'Suspend Company',exact:true}).boundingBox();assert.ok(actionBox.y>=0 && actionBox.y+actionBox.height<=height);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:tmp+`/company-manage-${width}-${height}.png`,fullPage:true});
  await company.getByRole('button',{name:'Edit Company',exact:true}).click();
  const edit=page.getByRole('dialog',{name:'Edit Company',exact:true});
  assert.equal(await edit.locator('input').count(),4);
  await edit.getByRole('button',{name:'Cancel',exact:true}).click();
  await company.getByRole('button',{name:'+ Add Person',exact:true}).click();
  const person=page.getByRole('dialog',{name:'Add Person',exact:true});
  await person.getByLabel('First Name',{exact:true}).fill('Keep');await person.getByLabel('Last Name',{exact:true}).fill('Values');await person.getByLabel('Email',{exact:true}).fill('keep@example.invalid');
  await page.evaluate(()=>{window.failNext=true;});await person.getByRole('button',{name:'Add Person',exact:true}).click();
  await person.getByRole('alert').waitFor();assert.equal(await person.getByLabel('First Name',{exact:true}).inputValue(),'Keep');
  await person.getByRole('button',{name:'Add Person',exact:true}).scrollIntoViewIfNeeded();
  assert.equal(await person.evaluate(n=>n.scrollWidth>n.clientWidth),false);
  await page.screenshot({path:tmp+`/company-add-person-${width}-${height}.png`,fullPage:true});
  await person.getByRole('button',{name:'Cancel',exact:true}).click();await page.keyboard.press('Escape');
 }
 console.log('PASS: Business creation failure/duplicate lock, exact UUID staff creation, no identity fabrication, edit allowlist, company status with fresh token, People and short-height responsive access.');
 if(process.argv.includes('--theme')){await runAdminThemeChecks(page,origin,tmp,checkInventoryDensity);await page.goto(origin+'/clients/business');}
 await page.emulateMedia({reducedMotion:'reduce'});
 assert.equal(await page.getByRole('button',{name:'+ Add Business',exact:true}).evaluate(node=>getComputedStyle(node).animationName),'none');
 assert.equal(errors.length,0,errors.join('\n'));
 console.log('PASS: 18 responsive viewports, no page overflow, drawer width/Escape, create → success → exact-ID manage, cancelled status sends nothing, failure stays open, fresh-token retry after explicit action, successful suspend.');
 console.log('Screenshots:',tmp);
 await browser.close();server.close();
})().catch(e=>{console.error(e);process.exitCode=1;server.close();process.exit(1)});
