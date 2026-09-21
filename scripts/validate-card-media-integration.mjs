// LOCAL ONLY: real application modules + Sharp; in-memory API/DB/Storage boundaries.
// No network, SQL, Supabase, Stripe, filesystem image uploads, or production writes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createHash, webcrypto, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import forge from 'node-forge';
import { getSortedRoutes } from 'next/dist/shared/lib/router/utils/sorted-routes.js';

// Use Next's own route-tree validation: different parameter names at one
// dynamic segment conflict even when their child segments differ.
const publicCardRoutes = fs.readdirSync('src/app/api/public/cards', { recursive: true })
  .filter(path => /(?:^|\/)route\.tsx?$/.test(path))
  .map(path => '/api/public/cards/' + path.replace(/\/route\.tsx?$/, ''));
assert.ok(publicCardRoutes.includes('/api/public/cards/[slug]/leads'));
assert.ok(publicCardRoutes.includes('/api/public/cards/[slug]/media/[kind]'));
assert.doesNotThrow(() => getSortedRoutes(publicCardRoutes));
assert.throws(() => getSortedRoutes([
  '/api/public/cards/[slug]/leads', '/api/public/cards/[cardId]/media/[kind]',
]), /different slug names/, 'regression reproducer must catch the original conflict');
console.log('PASS: public Cards dynamic segment names match; Next route sorter rejects the original conflict.');
class ApiRouteError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
const json = x => JSON.parse(JSON.stringify(x));
const responses = { ApiRouteError, apiSuccess: data => Response.json({ data }), apiErrorFromUnknown: e => Response.json({ error: { message: e.message } }, { status: e.status || 500 }) };
function loader(overrides = {}, globals = {}) {
  const cache = new Map();
  function load(path) {
    if (cache.has(path)) return cache.get(path);
    const exports = {}; cache.set(path, exports);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText,
      { exports, Buffer, URL, Request, Response, File, Blob, FormData, Headers, TextEncoder, AbortController, Uint8Array, crypto: webcrypto, process: { env: { NODE_ENV: 'test' } }, ...globals,
        require(name) { if (name in overrides) return overrides[name]; if (name === 'server-only') return {}; if (name === 'sharp') return sharp; if (name === 'node-forge') return forge; if (name === 'node:crypto') return { createHash }; if (name === '@/lib/api/responses') return responses; if (name.startsWith('@/')) return load(name.replace('@/', 'src/') + '.ts'); throw Error('Unexpected dependency ' + name); } });
    return exports;
  }
  return load;
}
const owner = randomUUID(), other = randomUUID(), templateId = randomUUID(), cardId = randomUUID(), sessionId = randomUUID();
let identity = { userId: owner, plan: 'pro' };
const template = { id: templateId, name: 'Test', access_level: 'paid', layout_type: 'brand_paid', status: 'published', is_published: true,
  profile_image_allowed: true, logo_allowed: true, banner_allowed: true, primary_color: '#FFFFFF', free_colour_palette: ['#FFFFFF'], text_colours: ['#111111'],
  allowed_fields: ['full_name', 'email'], field_config: { allowed_fields: ['full_name','email'], sections: { personal: ['full_name'], contact: ['email'] } },
  allowed_actions: { actions: [{ id: 'save_contact', type: 'save_contact', enabled: true, default_visible: true }] } };
let tables = {}, rpcCalls = [], rpcHandler, uploadFails = false, downloadCorrupt = false;
const objects = new Map();
const db = { from(table) {
  let filters = [], inserted;
  const q = { select() { return q; }, eq(key, value) { filters.push(r => r[key] === value); return q; }, or() { filters.push(r => r.status === 'published' || r.is_published === true); return q; },
    insert(data) { inserted = data; return q; }, async single() { const row = { ...inserted, id: randomUUID(), state: 'pending', expires_at: new Date(Date.now()+86400000).toISOString() }; (tables[table] ||= []).push(row); return { data: row }; },
    async maybeSingle() { return { data: (tables[table] || []).find(r => filters.every(f => f(r))) || null }; } }; return q;
  }, async rpc(name,args) { rpcCalls.push({ name, args: json(args) }); return rpcHandler(name,args); },
  storage: { from(bucket) { assert.equal(bucket,'card-media'); return { async upload(path, bytes, options) { assert.equal(options.upsert,false); if (uploadFails) return { error: { statusCode: '503' } }; if (objects.has(path)) return { error: { statusCode: '409' } }; objects.set(path,new Blob([bytes], { type: options.contentType })); return {}; }, async download(path) { return { data: downloadCorrupt ? new Blob(['bad']) : objects.get(path), error: objects.has(path) ? null : {} }; } }; } } };
const overrides = {
  '@/lib/api/client-context': { async requireApiClient() { if (!identity) throw new ApiRouteError(401,'UNAUTHENTICATED','Sign in'); return identity; } },
  '@/lib/supabase-admin': { createSupabaseAdminClient: () => db }, '@/lib/supabase': { supabase: {} },
  '@/components/CardRenderer': { displayName: c => c.full_name }, '@/lib/public-url': { buildPublicCardUrl: s => '/u/'+s },
  '@/lib/services/card-write-server': { ensureUniqueCardSlug: async () => 'test-slug' },
};
const load = loader(overrides);
const media = load('src/lib/card-media.ts');
const staging = load('src/lib/card-media-staging-server.ts');
const server = load('src/lib/card-media-server.ts');
const writer = load('src/lib/client-card-write-server.ts');
const view=load('src/lib/client-template-view.ts');
const card = { id: 'card-temp', template_id: templateId, card_name: 'Mine', full_name: 'Tester', email: 'test@example.invalid', status: 'published', selected_colour: '#FFFFFF', selected_text_colour: '#111111', action_config: { actions: [{ id:'save_contact',type:'save_contact',visible:true,order:0 }] } };
assert.equal(view.reconcileClientCard({...card,edit_revision:'a'.repeat(64)},template,'pro').card.edit_revision,'a'.repeat(64),'explicit-save cleanup must preserve opening revision');
function reset() { tables = { templates: [json(template)], cards: [], card_media_sessions: [{ id:sessionId, owner_user_id:owner,template_id:templateId,card_id:null,state:'pending',expires_at:new Date(Date.now()+86400000).toISOString() }], card_media_assets: [] }; rpcCalls=[]; objects.clear(); identity={userId:owner,plan:'pro'}; uploadFails=false;downloadCorrupt=false; }
reset();
rpcHandler = async (name,args) => {
  if (name==='reserve_card_media_asset') {
    let a=tables.card_media_assets.find(a=>a.session_id===args.p_session&&a.kind===args.p_kind&&a.sha256===args.p_sha256);
    if (!a) { a={id:randomUUID(),session_id:args.p_session,kind:args.p_kind,sha256:args.p_sha256,mime_type:args.p_mime,size_bytes:args.p_size,state:'reserved'}; tables.card_media_assets.push(a); }
    return {data:{asset_id:a.id,object_path:server.mediaObjectPath(tables.card_media_sessions[0],a)}};
  }
  if(name==='mark_card_media_ready'){tables.card_media_assets.find(a=>a.id===args.p_asset).state='ready';return{data:'ready'};}
  throw Error(name);
};
const request = new Request('http://local.invalid');
const png=await sharp({create:{width:380,height:81,channels:4,background:{r:30,g:40,b:50,alpha:0.2}}}).png().toBuffer();
const formats={png,jpeg:await sharp(png).jpeg().toBuffer(),webp:await sharp(png).webp().toBuffer()};
for(const kind of ['profile','logo','banner']) for(const bytes of Object.values(formats)) {
  const result=await server.uploadCardMedia(request,sessionId,kind,bytes);
  assert.match(result.reference,/^card-media:/);assert.equal(Object.keys(result).sort().join(),'assetId,reference');
  const a=tables.card_media_assets.find(a=>a.id===result.assetId);assert.equal(a.state,'ready');
  const normalized=Buffer.from(await objects.get(server.mediaObjectPath(tables.card_media_sessions[0],a)).arrayBuffer());
  const meta=await sharp(normalized).metadata();assert.equal(meta.format,'webp');assert.equal(meta.exif,undefined);assert.ok(normalized.length<=2097152);
  if(bytes===png){assert.equal(meta.hasAlpha,true);const raw=await sharp(normalized).raw().toBuffer();assert.ok(raw[3]<255,'transparent alpha retained');}
  assert.equal((await server.uploadCardMedia(request,sessionId,kind,bytes)).assetId,result.assetId,'retry reuses reservation/object');
}
for(const bad of [Buffer.from('bad'),Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'),Buffer.alloc(2097153)]) await assert.rejects(server.uploadCardMedia(request,sessionId,'logo',bad),e=>e.status===400);
// Real animated WebP (two pages), decoded by installed Sharp.
const frames=Buffer.concat([Buffer.alloc(4*4*4,120),Buffer.alloc(4*4*4,240)]);
const animated=await sharp(frames,{raw:{width:4,height:8,channels:4,pageHeight:4}}).webp({loop:0,delay:[50,50]}).toBuffer();
assert.equal((await sharp(animated).metadata()).pages,2);
await assert.rejects(server.uploadCardMedia(request,sessionId,'logo',animated),e=>e.status===400);
const before=JSON.stringify(tables.cards);uploadFails=true;
await assert.rejects(server.uploadCardMedia(request,sessionId,'logo',png),e=>e.status===503);assert.equal(JSON.stringify(tables.cards),before);uploadFails=false;
downloadCorrupt=true;await assert.rejects(server.uploadCardMedia(request,sessionId,'logo',png),e=>e.status===503);downloadCorrupt=false;
identity={userId:other,plan:'pro'};await assert.rejects(server.uploadCardMedia(request,sessionId,'logo',png),e=>e.status===404);
identity={userId:owner,plan:'free'};await assert.rejects(server.uploadCardMedia(request,sessionId,'logo',png),e=>e.status===403);
tables.templates[0]={...template,access_level:'free',layout_type:'profile_free',logo_allowed:false};await assert.rejects(server.uploadCardMedia(request,sessionId,'logo',png),e=>e.status===403);
await server.uploadCardMedia(request,sessionId,'profile',png);
identity=null;await assert.rejects(server.uploadCardMedia(request,sessionId,'profile',png),e=>e.status===401);
// Exercise the actual protected multipart route, not only its upload helper.
identity={userId:owner,plan:'free'};
const uploadRoute=load('src/app/api/client/media/upload/route.ts');
const multipart=new FormData();multipart.set('sessionId',sessionId);multipart.set('kind','profile');multipart.set('file',new Blob([png],{type:'image/png'}),'wide.png');
const timedUpload=await uploadRoute.POST(new Request('http://local.invalid/upload',{method:'POST',body:multipart}));
assert.equal(timedUpload.status,200);
for(const phase of ['auth','template','normalization','reservation','storage_upload','verification','ready','total']) assert.match(timedUpload.headers.get('server-timing'),new RegExp(phase+';dur=\\d+'));
assert.ok(!timedUpload.headers.get('server-timing').includes(owner));
const oversized=Buffer.alloc(2097152+20000);
assert.equal((await uploadRoute.POST(new Request('http://local.invalid/upload',{method:'POST',body:oversized}))).status,400);
const newSession=await staging.beginCardMediaSession(request,templateId);
assert.equal(tables.card_media_sessions.find(s=>s.id===newSession.id).owner_user_id,owner);
await assert.rejects(staging.beginCardMediaSession(request,templateId,cardId),e=>e.status===404);
console.log('PASS: real JPEG/PNG/WebP normalization, wide alpha PNG, animations/SVG/invalid/oversize rejected; verified immutable upload/retry; owner/entitlement/capability checks; failures do not write cards.');

// Real writer/validator. The tested SQL is mocked only at the transaction boundary.
reset();const revision='a'.repeat(64), allRemove=Object.fromEntries(Object.keys(media.mediaFields).map(k=>[k,{operation:'remove'}]));
let failFinalization=null;
rpcHandler=async(name,args)=>{
 if(name==='get_client_card_edit_snapshot') {const row=tables.cards.find(c=>c.id===args.p_card_id&&c.user_id===args.p_owner);return{data:row?{card:json(row),revision}:null};}
 assert.equal(name,'finalize_client_card_media');if(failFinalization)return{error:{message:failFinalization}};
 const saved={...args.p_validated_payload,id:args.p_card_id||cardId,user_id:args.p_owner,card_slot:1};tables.cards=[saved];return{data:{card_id:saved.id}};
};
const save=(over={})=>writer.writeValidatedClientCard({database:db,card,userId:owner,mode:'create',plan:'pro',template:tables.templates[0],media:{sessionId,revision:null,intents:allRemove},...over});
for(const plan of ['free','pro']) {
 tables.templates[0]={...template,access_level:'free',layout_type:'profile_free'};
 const result=await save({plan,mode:'edit',card:{...card,user_id:other,card_slot:3}});assert.equal(result.id,cardId);assert.equal(result.edit_revision,revision);
 const call=rpcCalls.filter(c=>c.name==='finalize_client_card_media').at(-1);assert.equal(call.args.p_owner,owner);assert.equal(call.args.p_allowance,plan==='free'?1:3);assert.equal(call.args.p_operation,'create');
 for(const key of ['user_id','card_slot','profile_id','profile_image_url','company_logo_url'])assert.ok(!(key in call.args.p_validated_payload));assert.ok(!('company_banner_url' in call.args.p_validated_payload.custom_fields));
}
failFinalization='CARD_ALLOWANCE_EXHAUSTED';await assert.rejects(save({plan:'free'}),e=>e.status===403);failFinalization=null;
const existing={...card,id:cardId,user_id:owner,profile_image_url:'data:image/png;base64,'+'a'.repeat(20000),company_logo_url:'https://example.invalid/old.png',custom_fields:{company_banner_url:'https://example.invalid/banner.png'}};
tables.cards=[existing];tables.card_media_sessions[0].card_id=cardId;
const editMedia={sessionId,revision,intents:Object.fromEntries(Object.keys(media.mediaFields).map(k=>[k,{operation:'retain'}]))};
const editCard={...card,id:cardId,field_visibility:{profile_image_url:false,company_logo_url:false,company_banner_url:false}};
await save({card:editCard,mode:'edit',media:editMedia});
let call=rpcCalls.filter(c=>c.name==='finalize_client_card_media').at(-1);assert.equal(call.args.p_expected_card_revision,revision);assert.equal(call.args.p_operation,'edit');assert.ok(!('slug'in call.args.p_validated_payload));assert.equal(call.args.p_validated_payload.field_visibility.profile_image_url,false);
for(const kind of Object.keys(media.mediaFields)) {
 const asset={id:randomUUID(),kind,session_id:sessionId,state:'ready'};tables.card_media_assets.push(asset);
 await save({card:editCard,mode:'edit',media:{...editMedia,intents:{...editMedia.intents,[kind]:{operation:'replace',asset_id:asset.id}}}});
 await save({card:editCard,mode:'edit',media:{...editMedia,intents:{...editMedia.intents,[kind]:{operation:'remove'}}}});
}
const stored=JSON.stringify(tables.cards);for(const failure of ['CARD_REVISION_CONFLICT','MEDIA_IDEMPOTENCY_CONFLICT','MEDIA_RECEIPT_UNAVAILABLE']) {failFinalization=failure;await assert.rejects(save({card:editCard,mode:'edit',media:editMedia}),e=>e.status===409);assert.equal(JSON.stringify(tables.cards),stored);}failFinalization=null;
await assert.rejects(save({userId:other}),e=>e.status===404);
await assert.rejects(save({mode:'edit',media:editMedia,card:{...editCard,company_banner_url:'data:image/png;base64,xxx'}}),e=>e.status===400);
console.log('PASS: real validator before finalization; trusted Free1/Pro3 and temporary-ID creation; all3 intents; media stripped; opening revision passed unchanged; retain/hide supports large legacy media; errors preserve old state.');

// Protected preview and anonymous published-card delivery, no external requests.
reset();const assetId=randomUUID();tables.cards=[{id:cardId,user_id:owner,template_id:templateId,status:'published',is_published:true,profile_image_url:`card-media:${assetId}`,field_visibility:{profile_image_url:true}}];
tables.card_media_sessions[0].card_id=cardId;tables.card_media_sessions[0].state='attached';
tables.card_media_assets=[{id:assetId,session_id:sessionId,kind:'profile',state:'attached',mime_type:'image/webp'}];objects.set(server.mediaObjectPath(tables.card_media_sessions[0],tables.card_media_assets[0]),new Blob([formats.webp],{type:'image/webp'}));
const privateRoute=load('src/app/api/client/media/[assetId]/route.ts'), publicRoute=load('src/app/api/public/cards/[slug]/media/[kind]/route.ts');
const privateGet=()=>privateRoute.GET(request,{params:Promise.resolve({assetId})});const publicGet=()=>publicRoute.GET(request,{params:Promise.resolve({slug:cardId,kind:'profile'})});
assert.equal((await privateGet()).status,200);assert.equal((await publicGet()).status,200);
const timedPublic = await publicGet();
for (const phase of ['card_lookup','template','asset_lookup','session_lookup','storage_download','total']) assert.match(timedPublic.headers.get('server-timing'),new RegExp(phase+';dur=\\d+'));
assert.equal(timedPublic.headers.get('cache-control'),'private, no-store');
assert.ok(!timedPublic.headers.get('server-timing').includes(owner));
// Prove the real route starts both independent reads before either resolves.
const originalFrom = db.from;
const startedReads = new Set(); let releaseReads;
const readsGate = new Promise(resolve => { releaseReads = resolve; });
db.from = function(table) {
  const q = originalFrom.call(this,table), read = q.maybeSingle;
  q.maybeSingle = async () => {
    if (['templates','card_media_assets'].includes(table)) { startedReads.add(table); await readsGate; }
    return read();
  };
  return q;
};
const pendingPublic = publicGet();
for(let i=0;i<30;i++) await Promise.resolve();
assert.equal(startedReads.size,2,'template and exact referenced asset reads overlap');
releaseReads(); assert.equal((await pendingPublic).status,200); db.from=originalFrom;
console.log('PASS: real public delivery overlaps independent checks; phase-only Server-Timing; no-store preserved.');

identity={userId:other,plan:'pro'};assert.equal((await privateGet()).status,404);identity=null;assert.equal((await privateGet()).status,401);
for(const [key,value] of [['field_visibility',{profile_image_url:false}],['hidden_fields',['profile_image_url']],['user_id',other]]) {const old=tables.cards[0][key];tables.cards[0][key]=value;assert.equal((await publicGet()).status,404);tables.cards[0][key]=old;}
tables.cards[0].status='draft';tables.cards[0].is_published=false;assert.equal((await publicGet()).status,404);tables.cards[0].is_published=true;assert.equal((await publicGet()).status,200,'preserve OR publication contract');
tables.templates[0].profile_image_allowed=false;assert.equal((await publicGet()).status,404);
assert.equal(media.resolveCardMedia('data:image/png;base64,YQ=='),'data:image/png;base64,YQ==');assert.equal(media.resolveCardMedia('https://example.invalid/image'),'https://example.invalid/image');assert.equal(media.resolveCardMedia('javascript:alert(1)'),'');
assert.equal(media.resolveCardMedia(`card-media:${assetId}`),`/api/client/media/${assetId}`);assert.equal(media.resolveCardMedia(`card-media:${assetId}`,{id:cardId,kind:'profile'}),`/api/public/cards/${cardId}/media/profile?v=${assetId}`);
// Exercise public-card mapping: Storage refs become checked public delivery paths.
tables.templates[0].profile_image_allowed=true;tables.cards[0].slug='public-card';
const publicService=loader({...overrides,'@/lib/supabase':{supabase:db}})('src/lib/services/public-card-service.ts');
const resolved=await publicService.getPublishedPublicCardBySlug('public-card');
assert.equal(resolved.status,'ok');assert.equal(resolved.card.profile_image_url,`/api/public/cards/${cardId}/media/profile?v=${assetId}`);
tables.cards[0].profile_image_url='data:image/png;base64,YQ==';
assert.equal((await publicService.getPublishedPublicCardBySlug('public-card')).card.profile_image_url,'data:image/png;base64,YQ==');
console.log('PASS: private owner preview, anonymous publication OR contract, visibility/capability/card-binding denial; legacy/new references resolve without signed URL persistence.');

// Model browser memory reuse by full rendered URL; execute the real public route
// with in-memory database/Storage for each newly encountered image URL.
const imageMemory = new Map();
let mediaRequests = 0;
for (const kind of Object.keys(media.mediaFields)) {
  const urls = [];
  for (let replacement = 0; replacement < 3; replacement++) {
    const id = randomUUID();
    const asset = { id, session_id: sessionId, kind, state: 'attached', mime_type: 'image/webp' };
    tables.card_media_assets.push(asset);
    const bytes = await sharp({create:{width:8,height:8,channels:4,background:{r:replacement*90,g:50,b:120,alpha:1}}}).webp().toBuffer();
    objects.set(server.mediaObjectPath(tables.card_media_sessions[0],asset),new Blob([bytes],{type:'image/webp'}));
    if (kind === 'banner') tables.cards[0].custom_fields = { company_banner_url: `card-media:${id}` };
    else tables.cards[0][media.mediaFields[kind]] = `card-media:${id}`;
    const mapped = await publicService.getPublishedPublicCardBySlug('public-card');
    // CardMediaImage resolves the public-service output a second time.
    const url = media.resolveCardMedia(mapped.card[media.mediaFields[kind]]);
    assert.equal(url, `/api/public/cards/${cardId}/media/${kind}?v=${id}`);
    assert.equal(media.resolveCardMedia(`card-media:${id}`, {id:cardId,kind}),url,'unchanged asset has stable URL');
    urls.push(url);
    if (!imageMemory.has(url)) {
      mediaRequests++;
      const response = await publicRoute.GET(new Request('http://local.invalid'+url),{params:Promise.resolve({slug:cardId,kind})});
      assert.equal(response.status,200);
      assert.equal(response.headers.get('cache-control'),'private, no-store');
      imageMemory.set(url,Buffer.from(await response.arrayBuffer()));
    }
    assert.deepEqual(imageMemory.get(url),bytes,'rendered URL fetches current replacement bytes');
  }
  assert.equal(new Set(urls).size,3,'initial asset and two replacements have distinct rendered URLs');
}
assert.equal(mediaRequests,9);
assert.equal(media.resolveCardMedia(`/api/public/cards/${cardId}/media/logo`),`/api/public/cards/${cardId}/media/logo`);
assert.equal(media.resolveCardMedia(`/api/public/cards/${cardId}/media/logo?v=invalid`),'');
console.log('PASS: profile/logo/banner consecutive replacements change rendered URL and fetch latest bytes; unchanged assets stable; cache headers unchanged.');

// Real browser SHA-256 bundle, without Node globals or secure-context Web Crypto.
const insecureBrowser={crypto:{},isSecureContext:false,setTimeout,clearTimeout};
insecureBrowser.window=insecureBrowser;insecureBrowser.self=insecureBrowser;
vm.runInNewContext(fs.readFileSync('node_modules/node-forge/dist/forge.min.js','utf8'),insecureBrowser);
const unicodeMedia=JSON.stringify({card:{full_name:'José 東京 📷',profile_image_url:'data:image/png;base64,'+'YQ=='.repeat(10000)},mode:'create'});
assert.equal(insecureBrowser.forge.md.sha256.create().update(unicodeMedia,'utf8').digest().toHex(),createHash('sha256').update(unicodeMedia).digest('hex'));
console.log('PASS: browser SHA-256 works without crypto.subtle and matches UTF-8 server hashing.');

// Actual browser coordinator with in-memory HTTP/storage; failed response and retry.
const localStorage=new Map(), http=[], savedRows=new Map(), receipts=new Map();let loseResponse=false, failUpload=false, nextAsset=0;
const storage={getItem:k=>localStorage.get(k)||null,setItem:(k,v)=>localStorage.set(k,v),removeItem:k=>localStorage.delete(k)};
const fakeFetch=async(url,options={})=>{
 if(String(url).startsWith('data:'))return new Response(png,{headers:{'Content-Type':'image/png'}});
 http.push({url,options});assert.equal(new Headers(options.headers).get('Authorization'),'Bearer local-only');
 if(url==='/api/client/media/sessions')return Response.json({data:{id:randomUUID()}});
 if(url==='/api/client/media/upload'){if(failUpload)return Response.json({error:{message:'Upload failed'}},{status:503});assert.ok(options.body.get('file') instanceof Blob);return Response.json({data:{assetId:`00000000-0000-0000-0000-${String(++nextAsset).padStart(12,'0')}`}});}
 if(url==='/api/client/cards'){
  const input=JSON.parse(options.body), digest=JSON.stringify(input), previous=receipts.get(input.media.sessionId);
  if(previous){assert.equal(previous.digest,digest,'retry must preserve session/revision/payload');return Response.json({data:{card:previous.row}});}
  const id=input.mode==='edit'&&!input.card.id.startsWith('card-')?input.card.id:randomUUID();
  const row={...input.card,id,custom_fields:{...input.card.custom_fields},edit_revision:'b'.repeat(64)};
  for(const [kind,field]of Object.entries(media.mediaFields)){const i=input.media.intents[kind];let value=i.operation==='replace'?`card-media:${i.asset_id}`:i.operation==='retain'?media.mediaValue(savedRows.get(id)||{},kind):'';if(kind==='banner')row.custom_fields[field]=value;else row[field]=value;}
  receipts.set(input.media.sessionId,{digest,row});savedRows.set(id,row);if(loseResponse){loseResponse=false;throw Error('Lost response');}return Response.json({data:{card:row}});
 }
 if(url.startsWith('/api/client/cards/'))return Response.json({data:{card:savedRows.get(url.split('/').at(-1)),revision:'b'.repeat(64)}});
 throw Error('Unexpected network path '+url);
};
const browserLoad=loader({'@/lib/supabase':{supabase:{auth:{getSession:async()=>({data:{session:{user:{id:owner},access_token:'local-only'}}})}}}},{sessionStorage:storage,fetch:fakeFetch,crypto:{},isSecureContext:false});
const browser=browserLoad('src/lib/client-card-media.ts');
const newCard={...card,full_name:'Staging José 東京 📷',custom_fields:{},profile_image_url:'data:image/png;base64,YQ==',company_logo_url:'data:image/png;base64,YQ==',company_banner_url:'data:image/png;base64,YQ=='};
loseResponse=true;await assert.rejects(browser.saveCardWithMedia(newCard,'create'),/Lost response/);
const retryState=JSON.parse([...localStorage.values()][0]);
const encoded=JSON.stringify({card:newCard,mode:'create'});
assert.equal(retryState.hash,createHash('sha256').update(encoded,'utf8').digest('hex'));
const oldBrowserHash=Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(encoded))).toString('hex');
assert.equal(retryState.hash,oldBrowserHash,'existing Web Crypto retry fingerprints remain compatible');
assert.equal(savedRows.size,1,'HTTP-origin coordinator reaches finalization without crypto.subtle');
const firstSession=http.find(h=>h.url==='/api/client/cards');const sent=JSON.parse(firstSession.options.body);assert.equal(sent.media.revision,null);
for(const f of Object.values(media.mediaFields)){assert.ok(!(f in sent.card));assert.ok(!(f in sent.card.custom_fields));}
await assert.rejects(browser.saveCardWithMedia({...newCard,card_name:'Changed'},'create'),/previous save/);
const saved=await browser.saveCardWithMedia(newCard,'create');assert.equal(savedRows.size,1);assert.equal(http.filter(h=>h.url==='/api/client/media/sessions').length,1);assert.equal(nextAsset,3);
const opened=await browser.loadEditableCard(saved.id);let edit={...newCard,...opened.card,company_banner_url:opened.card.custom_fields.company_banner_url,edit_revision:opened.revision};
for(const [kind,field]of Object.entries(media.mediaFields)){
 edit={...edit,field_visibility:{...edit.field_visibility,[field]:false}};const hidden=await browser.saveCardWithMedia(edit,'edit');assert.equal(media.mediaValue(hidden,kind),media.mediaValue(saved,kind),'hide retains image');
 edit={...edit,...hidden,company_banner_url:hidden.custom_fields.company_banner_url,field_visibility:{[field]:true}};await browser.saveCardWithMedia(edit,'edit');
 edit={...edit,[field]:'data:image/png;base64,YQ=='};failUpload=true;const old=JSON.stringify(savedRows.get(edit.id));await assert.rejects(browser.saveCardWithMedia(edit,'edit'),/Upload failed/);assert.equal(JSON.stringify(savedRows.get(edit.id)),old);failUpload=false;
 const replaced=await browser.saveCardWithMedia(edit,'edit');assert.notEqual(media.mediaValue(replaced,kind),media.mediaValue(saved,kind));
 edit={...edit,...replaced,company_banner_url:replaced.custom_fields.company_banner_url,[field]:'',media_edits:{[field]:'remove'}};loseResponse=true;await assert.rejects(browser.saveCardWithMedia(edit,'edit'),/Lost response/);const removed=await browser.saveCardWithMedia(edit,'edit');assert.equal(media.mediaValue(removed,kind),'');edit={...edit,...removed,media_edits:undefined,company_banner_url:removed.custom_fields.company_banner_url};
}
// Regression: incomplete/missing form state must never retire existing assets.
const regressionSaved=await browser.saveCardWithMedia({...newCard,id:'card-regression'},'create');
const regressionSnapshot=await browser.loadEditableCard(regressionSaved.id);
const regressionCard={...regressionSnapshot.card,company_banner_url:regressionSnapshot.card.custom_fields.company_banner_url,edit_revision:regressionSnapshot.revision};
for(const [kind,field] of Object.entries(media.mediaFields)) {
 for(const empty of ['',null,undefined]) {
  const broken={...regressionCard,[field]:empty,custom_fields:{...regressionCard.custom_fields}};
  if(kind==='banner')delete broken.custom_fields.company_banner_url;
  const count=http.length;
  await assert.rejects(browser.saveCardWithMedia(broken,'edit'),/disappeared unexpectedly/);
  assert.equal(http.length,count,'unexpected empty must block even session creation');
  assert.equal(media.mediaValue(savedRows.get(regressionCard.id),kind),media.mediaValue(regressionSaved,kind));
 }
}
const regressionView=view;
const nestedOnly={...regressionCard,company_banner_url:''};
const normalized=regressionView.reconcileClientCard(nestedOnly,template,'pro').card;
assert.equal(normalized.company_banner_url,regressionCard.company_banner_url,'nested saved banner survives empty top-level');
await browser.saveCardWithMedia({...regressionCard,company_banner_url:''},'edit');
for(const flag of ['profile_image_allowed','logo_allowed','banner_allowed']) {
 const denied=regressionView.reconcileClientCard(regressionCard,{...template,[flag]:false},'pro').card;
 const count=http.length;
 await assert.rejects(browser.saveCardWithMedia(denied,'edit'),/disappeared unexpectedly/);
 assert.equal(http.length,count,'capability normalization must not silently remove');
}
assert.ok(!JSON.parse(http.filter(h=>h.url==='/api/client/cards').at(-1).options.body).card.media_edits);
console.log('PASS: unexpected empty/null/undefined blocked before session/upload/finalization; capability removal blocked; nested banner retained.');
// Lost EDIT response reuses the opening revision; no refresh-before-save.
const editReads=http.filter(h=>h.url.startsWith('/api/client/cards/')).length;
const unchangedEdit={...edit,card_name:'Lost edit response'};loseResponse=true;
await assert.rejects(browser.saveCardWithMedia(unchangedEdit,'edit'),/Lost response/);
const firstEdit=JSON.parse(http.filter(h=>h.url==='/api/client/cards').at(-1).options.body);
await browser.saveCardWithMedia(unchangedEdit,'edit');
const retryEdit=JSON.parse(http.filter(h=>h.url==='/api/client/cards').at(-1).options.body);
assert.deepEqual(firstEdit,retryEdit);assert.equal(firstEdit.media.revision,edit.edit_revision);
assert.equal(http.filter(h=>h.url.startsWith('/api/client/cards/')).length,editReads);
await browser.saveCardWithMedia({...card,id:'card-empty'},'create');
const three=[];for(let i=0;i<3;i++)three.push(await browser.saveCardWithMedia({...newCard,id:`card-pro-${i}`},'create'));
assert.equal(new Set(three.flatMap(c=>Object.keys(media.mediaFields).map(k=>media.mediaValue(c,k)))).size,9);
const beforeOther=JSON.stringify(three.slice(1));const first=await browser.loadEditableCard(three[0].id);await browser.saveCardWithMedia({...first.card,company_banner_url:'',edit_revision:first.revision},'edit');assert.equal(JSON.stringify(three.slice(1)),beforeOther);
assert.ok(http.every(h=>!h.url.includes('storage')));assert.equal(localStorage.size,0);
console.log('PASS: actual browser coordinator: no-media/all-media create, retain/hide/show/replace/remove all3, save/reopen, lost-response same-session replay, changed-request block, failed upload, 9 independent receipts, API-only requests.');

const editorSource=fs.readFileSync('src/components/card-builder/ClientCardEditor.tsx','utf8');
assert.equal((editorSource.match(/onClick=\{\(\) => onChange\("", "remove"\)\}/g)||[]).length,2);
assert.equal((editorSource.match(/onChange\(image, "replace"\)/g)||[]).length,2);
assert.doesNotMatch(editorSource,/onClick=\{\(\) => onChange\(""\)\}/);
console.log('PASS: both media controls explicitly signal remove/replace; removal retries preserve intent.');

// Repeated replacements and remove/re-add through the real browser coordinator.
const cyclingSaved=await browser.saveCardWithMedia({...newCard,id:'card-cycle'},'create');
let cycling={...cyclingSaved,edit_revision:cyclingSaved.edit_revision,company_banner_url:cyclingSaved.custom_fields.company_banner_url};
for(const [kind,field] of Object.entries(media.mediaFields)) {
  for(let cycle=0;cycle<2;cycle++) {
    const previous={...cycling,custom_fields:{...cycling.custom_fields}};
    const replacement=await browser.saveCardWithMedia({...cycling,[field]:'data:image/png;base64,YQ==',media_edits:{[field]:'replace'}},'edit');
    assert.notEqual(media.mediaValue(replacement,kind),media.mediaValue(previous,kind));
    for(const otherKind of Object.keys(media.mediaFields).filter(k=>k!==kind))assert.equal(media.mediaValue(replacement,otherKind),media.mediaValue(previous,otherKind));
    const removedAgain=await browser.saveCardWithMedia({...replacement,company_banner_url:replacement.custom_fields.company_banner_url,[field]:'',media_edits:{[field]:'remove'}},'edit');
    assert.equal(media.mediaValue(removedAgain,kind),'');
    const addedAgain=await browser.saveCardWithMedia({...removedAgain,company_banner_url:removedAgain.custom_fields.company_banner_url,[field]:'data:image/png;base64,YQ==',media_edits:{[field]:'replace'}},'edit');
    assert.notEqual(media.mediaValue(addedAgain,kind),media.mediaValue(replacement,kind));
    const reopened=await browser.loadEditableCard(addedAgain.id);
    cycling={...reopened.card,company_banner_url:reopened.card.custom_fields.company_banner_url,edit_revision:reopened.revision};
    const retained=await browser.saveCardWithMedia({...cycling,card_name:'Text-only edit'},'edit');
    for(const k of Object.keys(media.mediaFields))assert.equal(media.mediaValue(retained,k),media.mediaValue(addedAgain,k));
    cycling={...retained,company_banner_url:retained.custom_fields.company_banner_url};
  }
}
console.log('PASS: all three kinds repeatedly replace/remove/re-add/reopen/text-only publish without changing the other two references.');
