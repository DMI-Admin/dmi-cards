/** Operator-only, injected connections; never imported by application runtime. */
import {createHash} from "node:crypto";
import {planBackfill} from "./backfill";
import type {Snapshot} from "./backfill";
import type {RecordValue} from "../domain/types";
export const SEED_PROJECT="uohdkewufeivdpaljnng";
export const SEED_SCOPE="acct_1OoTzlG71GpCYtA4:test";
export interface SeedTarget {environment:string;project:string;scope:string;databaseProject:string;capability:"seed_only"}
export function assertSeedTarget(t:SeedTarget){if(t.environment!=="staging"||t.project!=="prj_FPTsXDokhm5uSDMaxieuo5Cmp0Rn"||t.scope!==SEED_SCOPE||t.databaseProject!==SEED_PROJECT||t.capability!=="seed_only")throw Error("V2_SEED_TARGET");}
export function seedCanonical(v:unknown):string {if(v===null||typeof v!=="object")return JSON.stringify(v);if(Array.isArray(v))return "["+v.map(seedCanonical).join(",")+"]";return "{"+Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+seedCanonical((v as Record<string,unknown>)[k])).join(",")+"}";}
export function seedDigest(v:unknown){return createHash("sha256").update(seedCanonical(v)).digest("hex");}
export interface SeedPage {index:number;rows:{table:string;key:string;row:RecordValue}[]}
export function prepareAccessSeed(target:SeedTarget,snapshot:Snapshot){
 assertSeedTarget(target);if(snapshot.scope!==SEED_SCOPE||!/^\d{4}-\d\d-\d\dT/.test(snapshot.checkpoint))throw Error("V2_SEED_SNAPSHOT");
 // Source export must be access-only: no frozen provider intent or Finance history import.
 const allowed=new Set(["accounts","price_catalog","subscriptions","billing_accounts","billing_approved_prices","billing_subscriptions","billing_stripe_resource_ownership","billing_stripe_applications"]);
 if(Object.keys(snapshot.rows).some(k=>!allowed.has(k)))throw Error("V2_SEED_SOURCE_TABLE");
 const source=structuredClone(snapshot);
 if((source.rows.billing_accounts||[]).some(a=>!a.verified_at))throw Error("V2_SEED_UNVERIFIED_BINDING");
 for(const row of source.rows.billing_accounts||[])if(Object.keys(row).some(k=>/attempt|lease|parameters|session/.test(k)))throw Error("V2_SEED_SOURCE_FIELDS");
 const plan=planBackfill(source,null,100),all=[...plan.rows];let cursor=plan.next;
 while(cursor){const page=planBackfill(source,cursor,100);all.push(...page.rows);cursor=page.next;}
 if(all.some(r=>!["accounts","price_catalog","subscriptions"].includes(r.table)||r.table==="accounts"&&(r.row.binding_state!=="verified"||r.row.principal_kind!=="individual")))throw Error("V2_SEED_OWNERSHIP");
 for(const entry of all){if(entry.table==="accounts"&&source.rows.billing_accounts){const a=source.rows.billing_accounts.find(a=>a.user_id===entry.row.id)!;entry.row.verified_at=a.verified_at;entry.row.binding_revision="0";}if(entry.table==="subscriptions"&&source.rows.billing_subscriptions){const sub=source.rows.billing_subscriptions.find(s=>s.stripe_subscription_id===entry.row.stripe_subscription_id)!;entry.row.last_event_id=sub.last_event_id??null;entry.row.verified_at=sub.verified_at??sub.updated_at;}}
 const counts={accounts:0,price_catalog:0,subscriptions:0};for(const r of all)counts[r.table as keyof typeof counts]++;
 if(!counts.price_catalog)throw Error("V2_SEED_CATALOG");
 const checkpoint={snapshot:(snapshot as Snapshot & {sourceSnapshot?:string}).sourceSnapshot||plan.generation,captured_at:snapshot.checkpoint,source_digest:seedDigest({digests:snapshot.digests,priceEvidence:snapshot.priceEvidence??null})};
 const hash=seedDigest({scope:SEED_SCOPE,checkpoint,rows:all});const generation=hash.slice(0,8)+"-"+hash.slice(8,12)+"-5"+hash.slice(13,16)+"-a"+hash.slice(17,20)+"-"+hash.slice(20,32);
 const pages:SeedPage[]=[];for(let n=0;n<all.length;n+=100)pages.push({index:pages.length,rows:all.slice(n,n+100)});
 const base={version:1,generation,scope:SEED_SCOPE,checkpoint,counts,pages:pages.map(p=>({index:p.index,first:p.rows[0].key,last:p.rows.at(-1)!.key,count:p.rows.length,digest:seedDigest(p.rows)}))};
 return {manifest:{...base,digest:seedDigest(base)},pages};
}
export interface SeedConnection {project:string;capability:"seed_only";query(sql:string,values:unknown[]):Promise<{rows:Record<string,unknown>[]}>}
export async function importAccessSeed(target:SeedTarget,db:SeedConnection,prepared:ReturnType<typeof prepareAccessSeed>,dryRun=true){
 assertSeedTarget(target);if(db.project!==SEED_PROJECT||db.capability!=="seed_only"||prepared.manifest.scope!==SEED_SCOPE||prepared.manifest.digest!==seedDigest(Object.fromEntries(Object.entries(prepared.manifest).filter(([k])=>k!=="digest"))))throw Error("V2_SEED_CONNECTION");
 if(dryRun)return {dryRun:true,counts:prepared.manifest.counts,pages:prepared.pages.length,manifestDigest:prepared.manifest.digest,executionEnabled:false};
 const call=async(name:"seed_privileges"|"seed_begin"|"seed_page"|"seed_finalize",args:unknown[])=>{try{const r=await db.query("SELECT billing_v2."+name+"("+args.map((_,i)=>"$"+(i+1)).join(",")+") AS result",args);return r.rows[0].result;}catch{throw Error("V2_SEED_STORE_UNCONFIRMED");}};
 try{const identity=await db.query("SELECT current_user AS actor",[]);if(identity.rows[0].actor!=="billing_v2_seed")throw Error("V2_SEED_ROLE");}catch{throw Error("V2_SEED_CONNECTION_ROLE");}
 await call("seed_privileges",[]);await call("seed_begin",[prepared.manifest]);
 for(const p of prepared.pages)await call("seed_page",[prepared.manifest.generation,p.index,prepared.manifest.checkpoint,JSON.stringify(p.rows)]);
 return call("seed_finalize",[prepared.manifest.generation]);
}

export interface ReadOnlySource {project:string;query(sql:string,values?:unknown[]):Promise<{rows:Record<string,unknown>[]}>}
/** Caller supplies a separate SELECT-only source connection, never a service role. */
export async function captureAccessSnapshot(target:SeedTarget,source:ReadOnlySource):Promise<Snapshot>{
 assertSeedTarget(target);if(source.project!==SEED_PROJECT)throw Error("V2_SEED_SOURCE_TARGET");
 await source.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
 try{
  const checked=(await source.query("SELECT current_setting('transaction_read_only') AS read_only, pg_current_snapshot()::text AS snapshot, transaction_timestamp() AS captured_at")).rows[0];
  if(checked.read_only!=="on")throw Error("V2_SEED_SOURCE_NOT_READ_ONLY");
  const accounts=(await source.query("SELECT stripe_scope,user_id,stripe_customer_id,verified_at,generation::text,updated_at FROM public.billing_accounts WHERE stripe_scope=$1 AND stripe_customer_id IS NOT NULL ORDER BY user_id",[SEED_SCOPE])).rows;
  const prices=(await source.query("SELECT stripe_scope,stripe_price_id,entitlement_enabled,checkout_enabled,approved_at FROM public.billing_approved_prices WHERE stripe_scope=$1 ORDER BY stripe_price_id COLLATE \"C\"",[SEED_SCOPE])).rows;
  const subscriptions=(await source.query("SELECT stripe_scope,user_id,stripe_customer_id,stripe_subscription_id,verified,terminal,revision::text,last_event_created::text,last_event_id,verified_at,created_at,updated_at,sync_snapshot FROM public.billing_subscriptions WHERE stripe_scope=$1 ORDER BY stripe_subscription_id COLLATE \"C\"",[SEED_SCOPE])).rows;
  const ownership=(await source.query("SELECT stripe_scope,resource_type,stripe_resource_id,application_key,ownership_basis,revision::text,state,updated_at FROM public.billing_stripe_resource_ownership WHERE stripe_scope=$1 AND resource_type='price' ORDER BY stripe_resource_id COLLATE \"C\"",[SEED_SCOPE])).rows;
  const applications=(await source.query("SELECT application_key,state FROM public.billing_stripe_applications WHERE application_key='dmi_cards'")).rows;
  const items=(await source.query("SELECT stripe_price_id,stripe_product_id,recurring_interval,interval_count,verified_at FROM public.billing_finance_subscription_items WHERE stripe_scope=$1 AND removed_at IS NULL ORDER BY stripe_price_id COLLATE \"C\"",[SEED_SCOPE])).rows;
  const priceEvidence:NonNullable<Snapshot["priceEvidence"]>={};
  for(const price of prices){const matching=items.filter(i=>i.stripe_price_id===price.stripe_price_id);const keys=new Set(matching.map(i=>JSON.stringify([i.stripe_product_id,i.recurring_interval,i.interval_count])));if(keys.size!==1||!matching.length||matching[0].interval_count!==1||!["month","year"].includes(String(matching[0].recurring_interval)))throw Error("V2_SEED_PRICE_EVIDENCE");const i=matching[0];priceEvidence[String(price.stripe_price_id)]={interval:i.recurring_interval==="month"?"monthly":"annual",product:String(i.stripe_product_id),verifiedAt:new Date(i.verified_at as string).toISOString()};}
  if(accounts.some(a=>!a.verified_at))throw Error("V2_SEED_UNVERIFIED_BINDING");
  const capturedAt=new Date(checked.captured_at as string).toISOString();
  // Read-only normalization has no provider fallback and refuses absent historical facts.
  const toJson=(v:unknown):RecordValue=>JSON.parse(JSON.stringify(v)) as RecordValue;
  const rows:Snapshot["rows"]={billing_accounts:accounts.map(a=>toJson({...a,created_at:a.verified_at})),billing_approved_prices:prices.map(toJson),billing_subscriptions:subscriptions.map(toJson),billing_stripe_resource_ownership:ownership.filter(o=>prices.some(p=>p.stripe_price_id===o.stripe_resource_id)).map(toJson),billing_stripe_applications:applications.map(toJson)};
  const result:Snapshot={scope:SEED_SCOPE,checkpoint:capturedAt,complete:true,priceEvidence,rows,digests:Object.fromEntries(Object.entries(rows).map(([k,v])=>[k,createHash("sha256").update(stableSource(v)).digest("hex")]))};
  // Include the MVCC identity in the checkpoint digest without exposing it in diagnostics.
  Object.defineProperty(result,"sourceSnapshot",{value:String(checked.snapshot),enumerable:true});
  await source.query("COMMIT");return result;
 }catch{try{await source.query("ROLLBACK");}catch{/* Preserve fixed privacy-safe failure. */}throw Error("V2_SEED_SOURCE_REJECTED");}
}
function stableSource(v:unknown):string {if(v===null||typeof v!=="object")return JSON.stringify(v);if(Array.isArray(v))return "["+v.map(stableSource).join(",")+"]";return "{"+Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>JSON.stringify(k)+":"+stableSource(x)).join(",")+"}";}
