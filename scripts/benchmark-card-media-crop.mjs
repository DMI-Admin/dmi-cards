// Local synthetic images only. No app/API/database/network requests.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import ts from 'typescript';
const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dmi-crop-benchmark-'));
const source=fs.readFileSync('src/components/card-builder/ClientCardEditor.tsx','utf8');
const ast=ts.createSourceFile('editor.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let crop;
function visit(n){if(ts.isFunctionDeclaration(n)&&n.name?.text==='exportCroppedImage')crop=n.getText(ast);ts.forEachChild(n,visit);}visit(ast);
const before=execFileSync('git',['show','HEAD:src/components/card-builder/ClientCardEditor.tsx'],{encoding:'utf8'});
const beforeCrop=before.slice(before.indexOf('function exportCroppedImage('),before.indexOf('\nfunction device(',before.indexOf('function exportCroppedImage('))).replace('function exportCroppedImage(', 'function exportCroppedImageBefore(');
const cropJs=ts.transpileModule(beforeCrop+'\n'+crop,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const samples=[];
for(const format of ['jpeg','png','webp']) {
 const width=format==='png'?380:2400,height=format==='png'?81:1600;
 const bytes=await sharp(randomBytes(width*height*4),{raw:{width,height,channels:4}})[format]().toBuffer();
 samples.push({format,width,height,base64:bytes.toString('base64'),size:bytes.length});
}
const html=`<pre id="result">pending</pre><script>${cropJs}
const samples=${JSON.stringify(samples)};
(async()=>{const rows=[];const expected=new Map();
for(const sample of samples){const bytes=Uint8Array.from(atob(sample.base64),c=>c.charCodeAt(0));const file=new File([bytes],'synthetic.'+sample.format,{type:'image/'+sample.format});
for(const mode of ['FileReader','objectURL']) for(let run=0;run<3;run++){
 const t=performance.now();const source=mode==='FileReader'?await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file);}):URL.createObjectURL(file);
 const ready=performance.now();const image=new Image();image.style.width="300px";image.src=source;document.body.appendChild(image);await image.decode();await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);const decoded=performance.now();
 const output=await (mode==='FileReader'?exportCroppedImageBefore:exportCroppedImage)({source,imageElement:mode==='objectURL'?image:undefined,imageWidth:sample.width,imageHeight:sample.height,position:{x:0,y:0},zoom:1,previewWidth:300,previewHeight:300,outputWidth:512,outputHeight:512,fitMode:'contain',maxLength:2700000});
 const end=performance.now();image.remove();if(mode==='objectURL')URL.revokeObjectURL(source);if(mode==='FileReader')expected.set(sample.format,output);else if(expected.get(sample.format)!==output)throw Error('Crop output changed: '+sample.format);
 rows.push({format:sample.format,size:sample.size,mode,source_ready_ms:ready-t,decode_ms:decoded-ready,crop_export_ms:end-decoded,output_length:output.length});
}}
document.getElementById('result').textContent=JSON.stringify(rows);
})().catch(e=>document.getElementById('result').textContent=JSON.stringify({error:e.message}));</script>`;
fs.writeFileSync(path.join(dir,'test.html'),html);
const child=spawn(chrome,['--headless','--disable-gpu','--no-first-run','--disable-background-networking','--host-resolver-rules=MAP * ~NOTFOUND','--user-data-dir='+path.join(dir,'profile'),'--remote-debugging-port=0','about:blank'],{stdio:'ignore'});
let socket;
let result;
try {
 const portFile=path.join(dir,'profile','DevToolsActivePort');
 for(let i=0;i<100&&!fs.existsSync(portFile);i++)await new Promise(r=>setTimeout(r,100));
 if(!fs.existsSync(portFile))throw Error('Isolated Chrome did not expose local test connection');
 const [port,wsPath]=fs.readFileSync(portFile,'utf8').trim().split('\n');
 socket=new WebSocket('ws://127.0.0.1:'+port+wsPath);
 await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
 let onLoaded;let next=0;const pending=new Map();socket.onmessage=event=>{const m=JSON.parse(event.data);if(m.method==='Page.loadEventFired')onLoaded?.();if(pending.has(m.id)){const {resolve,reject,timer}=pending.get(m.id);pending.delete(m.id);clearTimeout(timer);if(m.error)reject(Error(m.error.message));else resolve(m.result);}};
 const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++next;const timer=setTimeout(()=>{pending.delete(id);reject(Error('Local browser timed out: '+method));},30000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params,sessionId}));});
 const {targetId}=await send('Target.createTarget',{url:'about:blank'});
 const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
 await send('Page.enable',{},sessionId);
 const loaded=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Local page load timed out')),15000);onLoaded=()=>{clearTimeout(timer);resolve();};});
 await send('Page.navigate',{url:'file://'+path.join(dir,'test.html')},sessionId);await loaded;
 const response=await send('Runtime.evaluate',{expression:`new Promise(resolve=>{const poll=()=>{const text=document.getElementById('result')?.textContent;if(text&&text!=='pending')resolve(text);else setTimeout(poll,50)};poll()})`,awaitPromise:true,returnByValue:true},sessionId);
 result=response.result.value;
 await send('Browser.close');
} finally {socket?.close();child.kill('SIGTERM');}
if(!result||result==='pending')throw Error('Browser benchmark did not finish');
const rows=JSON.parse(result.replaceAll('&quot;','"').replaceAll('&amp;','&'));
if(!Array.isArray(rows))throw Error(JSON.stringify(rows));
for(const sample of samples)for(const mode of ['FileReader','objectURL']){
 const set=rows.filter(r=>r.format===sample.format&&r.mode===mode);
 const median=key=>set.map(r=>r[key]).sort((a,b)=>a-b)[1].toFixed(2);
 console.log(JSON.stringify({format:sample.format,input_bytes:sample.size,mode,source_ready_ms:median('source_ready_ms'),decode_ms:median('decode_ms'),crop_export_ms:median('crop_export_ms'),first_decode_ms:set[0].decode_ms.toFixed(2),first_crop_ms:set[0].crop_export_ms.toFixed(2)}));
}
console.log('Local Chrome, synthetic files, 3 runs/median; source-ready is not React mount time. No network requests. Temporary artifacts: '+dir);
