/** Pure offline SQL Editor export adapter. No filesystem, connection or provider capability. */
import {assertLegacySubscription} from "./backfill";
import {createHash} from "node:crypto";
import {captureAccessSnapshot,prepareAccessSeed,seedDigest,SEED_PROJECT,SEED_SCOPE} from "./staging-seed";
import type {RecordValue} from "../domain/types";

const datasets={
 billing_accounts:["stripe_scope","user_id","stripe_customer_id","verified_at","generation","updated_at"],
 billing_approved_prices:["stripe_scope","stripe_price_id","entitlement_enabled","checkout_enabled","approved_at"],
 billing_subscriptions:["stripe_scope","user_id","stripe_customer_id","stripe_subscription_id","stripe_subscription_status","stripe_price_id","dmi_plan","current_period_start","current_period_end","trial_end","ended_at","cancel_at_period_end","latest_invoice_id","terminal","revision","last_event_created","last_event_id","verified_at","created_at","updated_at","sync_snapshot"],
 billing_stripe_resource_ownership:["stripe_scope","resource_type","stripe_resource_id","application_key","ownership_basis","revision","state","updated_at"],
 billing_stripe_applications:["application_key","state"],
 price_items:["stripe_price_id","stripe_product_id","recurring_interval","interval_count","verified_at"],
} as const;
const screening=["unverified_accounts","unverified_or_missing_snapshot","inconsistent_subscription_bindings","missing_active_price_ownership","missing_or_ambiguous_product_interval"];
const snapshotKeys=["subscription_id","customer_id","status","price_id","plan","period_start","period_end","trial_end","ended_at","cancel_at_period_end","invoice_id","terminal"];
const target={environment:"staging",project:"prj_FPTsXDokhm5uSDMaxieuo5Cmp0Rn",scope:SEED_SCOPE,databaseProject:SEED_PROJECT,capability:"seed_only" as const};
function requireFact(ok:unknown,code:string):asserts ok {if(!ok)throw Error("V2_EXPORT_"+code);}
function record(v:unknown):RecordValue {requireFact(v!==null&&typeof v==="object"&&!Array.isArray(v),"SHAPE");return v as RecordValue;}
function exact(v:unknown,keys:readonly string[]):RecordValue {const r=record(v);requireFact(Object.keys(r).length===keys.length&&keys.every(k=>Object.hasOwn(r,k)),"FIELDS");return r;}
function identifier(v:unknown,prefix:string){requireFact(typeof v==="string"&&new RegExp("^"+prefix+"_[A-Za-z0-9]+$").test(v),"IDENTITY");}
function uuid(v:unknown){requireFact(typeof v==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v),"IDENTITY");}
function integer(v:unknown,min=0){requireFact(typeof v==="string"&&/^(0|[1-9][0-9]*)$/.test(v)&&BigInt(v)>=BigInt(min)&&BigInt(v)<=BigInt("9223372036854775807"),"REVISION");}
function timestamp(v:unknown){requireFact(typeof v==="string"&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(v)&&Number.isFinite(Date.parse(v)),"TIMESTAMP");const [y,m,d]=v.slice(0,10).split("-").map(Number);requireFact(Number(v.slice(11,13))<24&&Number(v.slice(14,16))<60&&Number(v.slice(17,19))<60,"TIMESTAMP");requireFact(m>=1&&m<=12&&d>=1&&d<=new Date(Date.UTC(y,m,0)).getUTCDate(),"TIMESTAMP");}
function unique(rows:RecordValue[],key:string){requireFact(new Set(rows.map(r=>r[key])).size===rows.length,"DUPLICATE");}

/** Native JSON semantics plus explicit duplicate-key, depth, size and number checks. */
function strictJson(text:string):unknown {
 requireFact(text.length<=20*1024*1024,"SIZE");let offset=0,nodes=0;
 const ws=()=>{while(/\s/.test(text[offset]||"X"))offset++;};
 const string=()=>{const start=offset++;while(offset<text.length){const c=text[offset++];if(c==="\\"){offset++;continue;}if(c==='"')return JSON.parse(text.slice(start,offset)) as string;}throw Error("V2_EXPORT_JSON");};
 const value=(depth:number):void=>{requireFact(depth<=32&&++nodes<=1000000,"SIZE");ws();const c=text[offset];
  if(c==="{"||c==="["){offset++;ws();const end=c==="{"?"}":"]",seen=new Set<string>();if(text[offset]===end){offset++;return;}
   while(offset<text.length){if(c==="{"){ws();requireFact(text[offset]==='"',"JSON");const key=string();requireFact(!seen.has(key),"DUPLICATE_KEY");seen.add(key);ws();requireFact(text[offset++]===':',"JSON");}value(depth+1);ws();if(text[offset]===end){offset++;return;}requireFact(text[offset++]===',',"JSON");}throw Error("V2_EXPORT_JSON");
  }else if(c==='"'){string();}else {const token=/^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(text.slice(offset));requireFact(token,"JSON");offset+=token[0].length;if(!["true","false","null"].includes(token[0]))requireFact(Number.isSafeInteger(Number(token[0])),"NUMBER");}
 };
 try{value(0);ws();requireFact(offset===text.length,"JSON");return JSON.parse(text);}catch(e){if(e instanceof Error&&/^V2_EXPORT_/.test(e.message))throw e;throw Error("V2_EXPORT_JSON");}
}

export interface CompanionFile {text:string;sha256:string}
const companionKeys=["version","source_type","source_version","frozen_export_sha256","stripe_scope","application_key","application_ownership_revision","price_ownership_revision","application_state_digest","price_id","product_id","billing_interval","retrieved_at","request","provider_response","checksum"];
export const CATALOG_EVIDENCE_MAX_AGE_MS=24*60*60*1000;
export async function prepareFrozenExport(text:string,expectedSha256:string,companions:readonly CompanionFile[]=[],validationTime=new Date().toISOString()){
 requireFact(typeof expectedSha256==="string"&&/^[a-f0-9]{64}$/i.test(expectedSha256),"CHECKSUM_REQUIRED");
 const rawSha256=createHash("sha256").update(text,"utf8").digest("hex");requireFact(rawSha256===expectedSha256.toLowerCase(),"CHECKSUM_MISMATCH");
 const parsed=strictJson(text);requireFact(Array.isArray(parsed)&&parsed.length===1,"ONE_ROW");const row=exact(parsed[0],["frozen_access_source"]);
 const raw=typeof row.frozen_access_source==="string"?strictJson(row.frozen_access_source):row.frozen_access_source;
 const e=exact(raw,["scope","source_snapshot","captured_at","checks",...Object.keys(datasets)]);
 requireFact(e.scope===SEED_SCOPE,"SCOPE");timestamp(e.captured_at);requireFact(typeof e.source_snapshot==="string"&&/^\d+:\d+:(?:\d+(?:,\d+)*)?$/.test(e.source_snapshot)&&e.source_snapshot.length<=255,"CHECKPOINT");
 const checks=exact(e.checks,screening);requireFact(screening.every(k=>typeof checks[k]==="number"&&Number.isSafeInteger(checks[k])&&Number(checks[k])>=0&&(k==="missing_or_ambiguous_product_interval"||checks[k]===0)),"SCREENING");
 const rows:Record<string,RecordValue[]>={};
 for(const [name,keys]of Object.entries(datasets)){const values=e[name];requireFact(Array.isArray(values)&&values.length<=100000,"DATASET");rows[name]=values.map(v=>exact(v,keys));}
 const a=rows.billing_accounts,p=rows.billing_approved_prices,s=rows.billing_subscriptions,o=rows.billing_stripe_resource_ownership,d=rows.billing_stripe_applications,i=rows.price_items;
 requireFact(p.length>0&&d.length===1&&d[0].application_key==="dmi_cards"&&d[0].state==="active","APPLICATION");
 for(const name of ["billing_accounts","billing_approved_prices","billing_subscriptions","billing_stripe_resource_ownership"])for(const r of rows[name])requireFact(r.stripe_scope===SEED_SCOPE,"SCOPE");
 unique(a,"user_id");unique(a,"stripe_customer_id");unique(p,"stripe_price_id");unique(s,"stripe_subscription_id");unique(o,"stripe_resource_id");
 for(const r of a){uuid(r.user_id);identifier(r.stripe_customer_id,"cus");timestamp(r.verified_at);timestamp(r.updated_at);integer(r.generation);}
 for(const r of p){identifier(r.stripe_price_id,"price");timestamp(r.approved_at);requireFact(typeof r.entitlement_enabled==="boolean"&&typeof r.checkout_enabled==="boolean","PRICE");
  const ownership=o.filter(v=>v.stripe_resource_id===r.stripe_price_id);requireFact(ownership.length===1,"OWNERSHIP");const owner=ownership[0];requireFact(owner.resource_type==="price"&&owner.application_key==="dmi_cards"&&owner.ownership_basis==="price_owner"&&owner.state==="active","OWNERSHIP");integer(owner.revision,1);timestamp(owner.updated_at);
  const items=i.filter(v=>v.stripe_price_id===r.stripe_price_id);requireFact(new Set(items.map(v=>JSON.stringify([v.stripe_product_id,v.recurring_interval,v.interval_count]))).size<=1,"INTERVAL");
 }
 requireFact(o.length===p.length,"OWNERSHIP");
 for(const r of i){identifier(r.stripe_price_id,"price");identifier(r.stripe_product_id,"prod");requireFact(r.interval_count===1&&["month","year"].includes(String(r.recurring_interval)),"INTERVAL");timestamp(r.verified_at);}
 // A companion is a separate observation. It never becomes a fabricated Finance item.
 const financeMissing=p.filter(r=>!i.some(v=>v.stripe_price_id===r.stripe_price_id)).length;
 requireFact(checks.missing_or_ambiguous_product_interval===financeMissing,"SCREENING_MISMATCH");
 requireFact(Array.isArray(companions)&&companions.length<=p.length,"COMPANION_COUNT");timestamp(validationTime);
 const supplements:Record<string,{interval:"monthly"|"annual";product:string;verifiedAt:string}>={};
 const seen=new Set<string>(),companionDigests:string[]=[];let confirmations=0,annualResolutions=0,monthlyResolutions=0;
 for(const file of companions){
  requireFact(file&&typeof file.text==="string"&&typeof file.sha256==="string"&&/^[a-f0-9]{64}$/.test(file.sha256),"COMPANION_CHECKSUM");
  requireFact(createHash("sha256").update(file.text).digest("hex")===file.sha256,"COMPANION_CHECKSUM");
  const c=exact(strictJson(file.text),companionKeys);
  requireFact(c.version===1&&c.source_type==="stripe_test_price_retrieve"&&c.source_version===1,"COMPANION_VERSION");
  requireFact(c.frozen_export_sha256===rawSha256&&c.stripe_scope===SEED_SCOPE&&c.application_key==="dmi_cards","COMPANION_BINDING");
  const body=Object.fromEntries(Object.entries(c).filter(([k])=>k!=="checksum"));requireFact(c.checksum===seedDigest(body),"COMPANION_CHECKSUM");
  identifier(c.price_id,"price");identifier(c.product_id,"prod");const priceId=String(c.price_id);
  requireFact(!seen.has(priceId),"COMPANION_DUPLICATE");seen.add(priceId);
  requireFact(p.some(r=>r.stripe_price_id===priceId),"COMPANION_BINDING");const owner=o.find(r=>r.stripe_resource_id===priceId)!;
  integer(c.application_ownership_revision,1);integer(c.price_ownership_revision,1);
  requireFact(c.application_ownership_revision===owner.revision&&c.price_ownership_revision===owner.revision&&c.application_state_digest===seedDigest(d[0]),"COMPANION_OWNERSHIP");
  const request=exact(c.request,["method","account_id","price_id","request_id"]);
  requireFact(request.method==="GET"&&request.account_id===SEED_SCOPE.split(":")[0]&&request.price_id===priceId,"COMPANION_REQUEST");identifier(request.request_id,"req");
  const provider=exact(c.provider_response,["object","id","product","livemode","active","recurring"]),recurring=exact(provider.recurring,["interval","interval_count"]);
  requireFact(provider.object==="price"&&provider.id===priceId&&provider.product===c.product_id&&provider.livemode===false&&provider.active===true,"COMPANION_PROVIDER");
  requireFact(["month","year"].includes(String(recurring.interval))&&recurring.interval_count===1&&c.billing_interval===(recurring.interval==="year"?"annual":"monthly"),"COMPANION_INTERVAL");
  timestamp(c.retrieved_at);const retrieved=Date.parse(String(c.retrieved_at)),now=Date.parse(validationTime);
  requireFact(retrieved>=Date.parse(String(e.captured_at))&&retrieved<=now&&now-retrieved<=CATALOG_EVIDENCE_MAX_AGE_MS,"COMPANION_STALE");
  const persisted=i.filter(r=>r.stripe_price_id===priceId);
  requireFact(persisted.every(r=>r.stripe_product_id===c.product_id&&r.recurring_interval===recurring.interval&&r.interval_count===1),"COMPANION_CONFLICT");
  if(persisted.length)confirmations++;else{supplements[priceId]={interval:c.billing_interval as "monthly"|"annual",product:String(c.product_id),verifiedAt:String(c.retrieved_at)};if(c.billing_interval==="annual")annualResolutions++;else monthlyResolutions++;}
  companionDigests.push(file.sha256);
 }
 const resolved=Object.keys(supplements).length;requireFact(financeMissing===resolved,"SCREENING");
 const catalogResolution={originalScreening:structuredClone(checks),financeEvidenceMissing:financeMissing,companionsSupplied:companions.length,companionResolved:resolved,companionConfirmations:confirmations,persistedResolved:p.length-financeMissing,unresolved:financeMissing-resolved,annualResolutions,monthlyResolutions,companionDigests:companionDigests.sort()};
 const live=new Set<unknown>();
 for(const r of s){uuid(r.user_id);identifier(r.stripe_subscription_id,"sub");identifier(r.stripe_customer_id,"cus");requireFact(typeof r.terminal==="boolean","SUBSCRIPTION");integer(r.revision,1);for(const k of ["verified_at","created_at","updated_at"])timestamp(r[k]);if(r.last_event_created!==null)integer(r.last_event_created);if(r.last_event_id!==null)identifier(r.last_event_id,"evt");
  requireFact(a.some(v=>v.user_id===r.user_id&&v.stripe_customer_id===r.stripe_customer_id),"BINDING");try{assertLegacySubscription(r);}catch{throw Error("V2_EXPORT_SUBSCRIPTION");}const snap=exact(r.sync_snapshot,snapshotKeys);
  requireFact(snap.subscription_id===r.stripe_subscription_id&&snap.customer_id===r.stripe_customer_id,"SNAPSHOT_IDENTITY");requireFact(["active","trialing","past_due","unpaid","canceled","incomplete","incomplete_expired","paused"].includes(String(snap.status)),"SNAPSHOT");
  const paid=["active","trialing"].includes(String(snap.status));requireFact(snap.plan===(paid?"pro":"free")&&snap.terminal===(snap.status==="canceled")&&r.terminal===snap.terminal&&typeof snap.cancel_at_period_end==="boolean","SNAPSHOT_POLICY");
  for(const k of ["period_start","period_end","trial_end","ended_at"])if(snap[k]!==null)timestamp(snap[k]);if(snap.invoice_id!==null)identifier(snap.invoice_id,"in");
  if(snap.price_id!==null){identifier(snap.price_id,"price");requireFact(p.some(v=>v.stripe_price_id===snap.price_id),"PRICE");}if(paid)requireFact(p.some(v=>v.stripe_price_id===snap.price_id&&v.entitlement_enabled===true),"PRICE");
  if(!r.terminal){requireFact(!live.has(r.user_id),"AMBIGUOUS_SUBSCRIPTION");live.add(r.user_id);}
 }
 // Frozen read adapter: only the exact existing source capture SELECTs/transaction protocol.
 // No database connection is created or accepted by this adapter.
 let step=0;
 const order=["billing_accounts","billing_approved_prices","billing_subscriptions","billing_stripe_resource_ownership","billing_stripe_applications","price_items"];
 const tables=[...order.slice(0,5),"billing_finance_subscription_items"];
 const source={project:SEED_PROJECT,query:async(sql:string,values?:unknown[])=>{
  if(sql==="BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"&&step===0){step++;return {rows:[]};}
  if(sql==="SELECT current_setting('transaction_read_only') AS read_only, pg_current_snapshot()::text AS snapshot, transaction_timestamp() AS captured_at"&&step===1){step++;return {rows:[{read_only:"on",snapshot:e.source_snapshot,captured_at:e.captured_at}]};}
  if(step>=2&&step<=7){const index=step-2;requireFact(sql.startsWith("SELECT ")&&sql.includes(" FROM public."+tables[index]+" ")&&(index===4?values===undefined:values?.length===1&&values[0]===SEED_SCOPE),"CAPTURE_PROTOCOL");step++;
   // Stabilize tied Finance item timestamps before the existing first-item evidence selection.
   const selected=structuredClone(rows[order[index]]);if(index===5)selected.sort((x,y)=>String(x.stripe_price_id).localeCompare(String(y.stripe_price_id))||String(x.verified_at).localeCompare(String(y.verified_at)));return {rows:selected};
  }
  requireFact(sql==="COMMIT"&&step===8,"CAPTURE_PROTOCOL");step++;return {rows:[]};
 }};
 const snapshot=await captureAccessSnapshot(target,source,supplements);requireFact(step===9,"CAPTURE_PROTOCOL");if(companions.length)snapshot.catalogEvidenceDigest=seedDigest({version:1,exportSha256:rawSha256,catalogResolution});const prepared=prepareAccessSeed(target,snapshot);
 return {target,snapshot,prepared,rawSha256,catalogResolution};
}
