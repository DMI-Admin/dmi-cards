// Executes the real upload route and sharp normalization with in-memory DB/Storage.
// Measures local processing only: hosted DB/Auth/Storage latency is NOT simulated.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import ts from 'typescript';
import sharp from 'sharp';
import { createHash, randomUUID } from 'node:crypto';
const owner=randomUUID(),sessionId=randomUUID(),templateId=randomUUID(),cardId=randomUUID();
const objects=new Map();let authCalls=0;const durations={};
async function timed(name,fn){const t=performance.now();try{return await fn();}finally{(durations[name]??=[]).push(performance.now()-t);}}
class ApiRouteError extends Error{constructor(status,code,message){super(message);this.status=status;}}
const db={from(table){const q={select(){return q},eq(){return q},or(){return q},async maybeSingle(){return timed('db_read',async()=>({data:table==='templates'?{id:templateId,profile_image_allowed:true,logo_allowed:true,banner_allowed:true}:table==='cards'?{id:cardId}:{template_id:templateId,card_id:cardId}}));}};return q;},
 async rpc(name,args){return timed(name,async()=>({data:name==='reserve_card_media_asset'?{asset_id:randomUUID(),object_path:'synthetic/'+args.p_kind}:true}));},
 storage:{from(){return{upload:async(path,bytes,options)=>timed('storage_upload',async()=>{objects.set(path,new Blob([bytes],{type:options.contentType}));return{};}),download:async path=>timed('storage_verify_download',async()=>({data:objects.get(path)}))};}}};
function measuredSharp(...args){const image=sharp(...args);const metadata=image.metadata.bind(image),toBuffer=image.toBuffer.bind(image);image.metadata=(...a)=>timed('image_metadata',()=>metadata(...a));image.toBuffer=(...a)=>timed('image_normalization',()=>toBuffer(...a));return image;}
const cache=new Map();function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{exports,Buffer,File,FormData,Request,Response,URL,require(name){
 const overrides={'server-only':{},'node:crypto':{createHash},sharp:measuredSharp,
 '@/lib/api/client-context':{requireApiClient:async()=>{authCalls++;return{userId:owner,plan:'pro'};}},
 '@/lib/supabase-admin':{createSupabaseAdminClient:()=>db},'@/lib/templates':{normalizeTemplate:x=>x},'@/lib/services/card-payload':{canSelectTemplate:()=>true},
 '@/lib/api/responses':{ApiRouteError,apiSuccess:data=>Response.json({data}),apiErrorFromUnknown:e=>Response.json({error:e.message},{status:e.status||500})}};
 if(name in overrides)return overrides[name];if(name.startsWith('@/'))return load(name.replace('@/','src/')+'.ts');throw Error(name);
 }});return exports;}
const route=load('src/app/api/client/media/upload/route.ts');
for(const kind of ['profile','logo','banner']){
 const times=[];let count;for(const key of Object.keys(durations))delete durations[key];
 for(let run=0;run<5;run++){
 const bytes=await sharp({create:{width:kind==='banner'?1500:512,height:kind==='banner'?500:512,channels:4,background:{r:30,g:60,b:140,alpha:0.4}}}).png().toBuffer();
 const form=new FormData();form.set('sessionId',sessionId);form.set('kind',kind);form.set('file',new File([bytes],'synthetic.png',{type:'image/png'}));
 authCalls=0;const start=performance.now();const response=await route.POST(new Request('http://local.invalid/api/client/media/upload',{method:'POST',body:form}));
 assert.equal(response.status,200,await response.clone().text());times.push(performance.now()-start);count=authCalls;
 }
 assert.equal(count,1,'one server-verified auth/entitlement resolution per upload');
 const phase_ms=Object.fromEntries(Object.entries(durations).map(([key,values])=>[key,Number(values.sort((a,b)=>a-b)[Math.floor(values.length/2)].toFixed(3))]));
 console.log(JSON.stringify({kind,auth_resolutions_per_upload:count,local_route_median_ms:times.sort((a,b)=>a-b)[2].toFixed(2),phase_ms}));
}
console.log('In-memory DB/Storage, real multipart/sharp/hash/upload verification route; no network, SQL or credentials.');
