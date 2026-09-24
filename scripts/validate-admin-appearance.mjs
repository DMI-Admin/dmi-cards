import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=fs.readFileSync('src/lib/admin-appearance.ts','utf8');
const exports={};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports});
export const adminAppearanceBootstrap=exports.adminAppearanceBootstrap;
for(const mode of ['light','dark','system',null,'unexpected']){
 const document={documentElement:{dataset:{theme:'dark'}}};
 vm.runInNewContext(adminAppearanceBootstrap,{document,location:{pathname:'/clients/individual'},localStorage:{getItem:key=>{assert.equal(key,'dmi-admin-appearance');return mode;}}});
 assert.equal(document.documentElement.dataset.adminAppearance,['light','dark'].includes(mode)?mode:'system');
 assert.equal(document.documentElement.dataset.theme,'dark');
}
for(const path of ['/client/cards','/client/settings','/u/test','/login','/clients-other']){
 assert.equal(exports.isAdminAppearancePath(path),false);
 const document={documentElement:{dataset:{theme:'light'}}};
 vm.runInNewContext(adminAppearanceBootstrap,{document,location:{pathname:path},localStorage:{getItem:()=>{throw Error('must not read Client preference')}}});
 assert.equal(document.documentElement.dataset.adminAppearance,undefined);
}
const document={documentElement:{dataset:{}}};
vm.runInNewContext(adminAppearanceBootstrap,{document,location:{pathname:'/admin'},localStorage:{getItem:()=>{throw Error('blocked')}}});
assert.equal(document.documentElement.dataset.adminAppearance,'system');
const css=fs.readFileSync('src/app/admin-theme.css','utf8');
for(const token of ['page','sidebar','surface','surface-secondary','card','border','text','muted','input','table-header','table-row','drawer','dialog','overlay','disabled-bg','success-text','danger-text','gradient'])assert.ok(css.includes('--admin-'+token+':'));
assert.match(css,/prefers-color-scheme: dark/);
const control=fs.readFileSync('src/components/admin/AdminAppearance.tsx','utf8');
assert.doesNotMatch(control,/dataset\.theme|["']dmi-theme["']/);
assert.match(control,/delete document.documentElement.dataset.adminAppearance/);
assert.match(fs.readFileSync('src/app/settings/page.tsx','utf8'),/AdminAppearanceControl/);
assert.match(fs.readFileSync('src/app/client/settings/page.tsx','utf8'),/ThemeSelector/);
// Check brand button gradient endpoints/intermediate colors against white text.
function luminance(rgb){return rgb.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);}
for(let i=0;i<=20;i++){const t=i/20;const color=[191,34,111].map((v,j)=>v*(1-t)+[119,33,184][j]*t);assert.ok(1.05/(luminance(color)+.05)>=4.5);}
console.log('PASS: Admin-only storage/routing, pre-paint bootstrap, blocked-storage fallback, semantic tokens and independent Client settings.');

export async function runAdminThemeChecks(page,origin,tmp,checkDensity=async()=>{}){
 const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 async function contrast(locator){
  const results=await locator.evaluateAll(nodes=>nodes.filter(n=>n.getBoundingClientRect().width&&n.getBoundingClientRect().height).map(node=>{
   function rgb(s){return s.match(/[\d.]+/g)?.slice(0,3).map(Number);}
   function lum(c){return c.map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4}).reduce((a,x,i)=>a+x*[.2126,.7152,.0722][i],0);}
   let parent=node,bg;while(parent){const s=getComputedStyle(parent);if(s.backgroundImage!=='none')return null;if(s.backgroundColor!=='rgba(0, 0, 0, 0)'){bg=rgb(s.backgroundColor);break;}parent=parent.parentElement;}
   if(!bg)return null;const fg=rgb(getComputedStyle(node).color);const a=lum(fg),b=lum(bg);return {text:node.textContent.slice(0,50),fg,bg,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
  }).filter(Boolean));
  for(const result of results)assert.ok(result.ratio>=4.5,JSON.stringify(result));
 }
 for(const [mode,os,dark] of [['system','light',false],['system','dark',true],['light','dark',false],['dark','light',true]]){
  await page.setViewportSize({width:1440,height:740});await page.emulateMedia({colorScheme:os});await page.goto(origin+'/clients/individual');
  await page.getByLabel('Admin appearance',{exact:true}).first().selectOption(mode);await page.reload();
  assert.equal(await page.getByLabel('Admin appearance',{exact:true}).first().inputValue(),mode);
  assert.equal(await page.evaluate(()=>localStorage.getItem('dmi-admin-appearance')),mode);
  assert.equal(await page.evaluate(()=>localStorage.getItem('dmi-theme')),null);
  for(const area of ['individual','business'])for(const width of [1920,1440,1280,1200,1024,768,540,390,320]){
   await page.setViewportSize({width,height:width<640?667:740});await page.goto(origin+'/clients/'+area);
   await page.getByRole('button',{name:area==='individual'?'Manage Alex Customer 14':'Manage',exact:true}).first().waitFor();await settle();
   await checkDensity(page.locator('table[class*="compactInventory"]').first(),width);
   const colors=await page.locator('main').evaluate(n=>({bg:getComputedStyle(n).backgroundColor,scheme:getComputedStyle(n).colorScheme}));
   assert.equal(colors.bg,dark?'rgb(17, 19, 32)':'rgb(245, 244, 249)');assert.equal(colors.scheme,dark?'dark':'light');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await contrast(page.locator('main h1, main h2, main .admin-muted, main .admin-secondary, main td, main [class*="stat"] small, main [class*="admin-status"], .admin-sidebar label, .admin-sidebar nav a'));
   if(width===1440||width===390){
    await page.screenshot({path:tmp+`/theme-${mode}-${os}-${area}-${width}.png`,fullPage:true});
    await page.getByRole('button',{name:area==='individual'?'+ Add Individual Client':'+ Add Business',exact:true}).click();
    assert.equal(await page.locator('dialog[open]').evaluate(n=>getComputedStyle(n).backgroundColor),dark?'rgb(30, 34, 53)':'rgb(255, 255, 255)');
    await contrast(page.locator('dialog[open] label, dialog[open] input, dialog[open] select, dialog[open] p'));
    await page.screenshot({path:tmp+`/theme-add-${mode}-${os}-${area}-${width}.png`,fullPage:true});
    await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>Boolean(document.activeElement.closest('dialog[open]'))),true);await page.keyboard.press('Escape');
    await page.getByRole('button',{name:area==='individual'?'View All Clients':'View All Companies',exact:true}).first().click();
    await checkDensity(page.locator('dialog[open] table[class*="compactInventory"]'),width);
    await contrast(page.locator('dialog[open] h2, dialog[open] td, dialog[open] select, dialog[open] input'));
    await page.getByLabel(area==='individual'?'Search people, company or email':'Search company, contact or email').fill('no-such-record');
    await contrast(page.locator('dialog[open] td'));await page.keyboard.press('Escape');
    if(area==='individual'){
     await page.getByRole('button',{name:'Manage Alex Customer 14',exact:true}).click();await contrast(page.locator('dialog[open] p, dialog[open] dt, dialog[open] dd'));
     await page.getByRole('button',{name:'Edit details',exact:true}).click();await contrast(page.locator('dialog[open] input'));await page.getByRole('button',{name:'Cancel',exact:true}).click();
     await page.getByRole('button',{name:'Suspend Client',exact:true}).click();
     const confirm=page.getByRole('dialog',{name:'Suspend Client',exact:true});await contrast(confirm.locator('p, h2, h3'));
     await page.evaluate(()=>{window.failNext=true;});await confirm.getByRole('button',{name:'Suspend Client',exact:true}).click();await confirm.getByRole('alert').waitFor();await contrast(confirm.getByRole('alert'));
     await page.screenshot({path:tmp+`/theme-error-${mode}-${os}-${width}.png`,fullPage:true});
     await confirm.getByRole('button',{name:'Cancel',exact:true}).click();await page.keyboard.press('Escape');
     await page.getByRole('button',{name:'Manage Alex Customer 10',exact:true}).click();await page.getByRole('button',{name:'Reactivate Client',exact:true}).click();
     const reactivate=page.getByRole('dialog',{name:'Reactivate Client',exact:true});await contrast(reactivate.locator('p, h2, h3'));
     await reactivate.getByRole('button',{name:'Cancel',exact:true}).click();await page.keyboard.press('Escape');
    }else{
     await page.getByRole('button',{name:'Manage',exact:true}).first().click();
     const company=page.getByRole('dialog',{name:'Company 29',exact:true});await contrast(company.locator('p,h2,h3'));
     await company.getByRole('button',{name:'Edit Admin Contact',exact:true}).click();
     const detail=page.getByRole('dialog',{name:'Manage Client',exact:true});await contrast(detail.locator('p,h2'));
     await detail.getByRole('button',{name:'Edit details',exact:true}).click();await contrast(detail.locator('input'));
     await page.keyboard.press('Escape');await page.keyboard.press('Escape');
    }
   }
  }
 }
 // System reacts without reload; explicit mode wins against live OS changes.
 await page.setViewportSize({width:1440,height:740});await page.goto(origin+'/clients/individual');
 await page.getByLabel('Admin appearance',{exact:true}).first().selectOption('system');
 for(const os of ['light','dark']){await page.emulateMedia({colorScheme:os});await settle();assert.equal(await page.locator('main').evaluate(n=>getComputedStyle(n).colorScheme),os);}
 await page.getByLabel('Admin appearance',{exact:true}).first().selectOption('light');await page.emulateMedia({colorScheme:'dark'});await settle();assert.equal(await page.locator('main').evaluate(n=>getComputedStyle(n).colorScheme),'light');
 // A pre-existing Client dark preference cannot override Admin Light, or be overwritten.
 await page.evaluate(()=>{localStorage.setItem('dmi-theme','dark');});await page.reload();await settle();
 assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'dark');
 assert.equal(await page.locator('main').evaluate(n=>getComputedStyle(n).colorScheme),'light');
 await contrast(page.locator('main h1, main .admin-muted, .admin-sidebar nav a'));
 assert.equal(await page.evaluate(()=>localStorage.getItem('dmi-theme')),'dark');
 // Initial loading/empty rows and mobile navigation use the same theme.
 await page.getByLabel('Admin appearance',{exact:true}).first().selectOption('dark');
 for(const query of ['loading','empty']){await page.goto(origin+'/clients/individual?'+query);await page.getByText(query==='loading'?'Loading individual clients...':'No matching individual clients found.',{exact:true}).waitFor();await contrast(page.locator('main td'));}
 await page.setViewportSize({width:320,height:568});await page.getByRole('button',{name:'Open Admin navigation',exact:true}).focus();await page.keyboard.press('Enter');
 const nav=page.getByRole('dialog',{name:'DMI Cards Admin',exact:true});await nav.getByLabel('Admin appearance',{exact:true}).selectOption('light');
 await contrast(nav.locator('label, nav p, nav a'));await page.keyboard.press('Escape');
 assert.equal(await page.getByRole('button',{name:'Open Admin navigation',exact:true}).evaluate(n=>n===document.activeElement),true);
 console.log('PASS: 72 theme/area/viewport combinations; OS tracking, overrides, persistence, contrast ≥4.5, dialogs, errors, empty/loading, mobile navigation/focus and Client preference isolation.');
}
