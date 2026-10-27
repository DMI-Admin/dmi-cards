import {createHash} from "node:crypto";
import type {Evidence,SubscriptionInput,SubscriptionDecision,Canonical} from "./types";
export function stable(value:unknown):string {if(value===null||typeof value!=="object")return JSON.stringify(value);if(Array.isArray(value))return "["+value.map(stable).join(",")+"]";return "{"+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+":"+stable(v)).join(",")+"}";}
export function digest(value:unknown):string{return createHash("sha256").update(stable(value)).digest("hex");}
export function canonicalDigest(value:Record<string,unknown>):string {const keys=["stripe_subscription_id","stripe_customer_id","stripe_price_id","status","plan","cancel_at_period_end","period_start","period_end","trial_end","ended_at","latest_invoice_id","terminal"];return digest(Object.fromEntries(keys.map(k=>[k,value[k]??null])));}
export function trustedEvidence(e:Evidence,requireNamespace=true):boolean {return /^acct_[A-Za-z0-9]+:(test|live)$/.test(e.scope)&&e.runtime!=="unknown"&&(e.runtime==="production")===e.livemode&&e.scope.endsWith(e.livemode?":live":":test")&&(!e.eventAccount||e.scope.split(":")[0]===e.eventAccount)&&(!requireNamespace||e.namespaceVerified)&&(e.eventCreated===null||/^\d+$/.test(e.eventCreated));}
export function decideSubscription(i:SubscriptionInput):SubscriptionDecision {
 const {task:t,binding:b,provider:p,before,price}=i;
 if(!trustedEvidence(t)||p.scope!==t.scope||p.livemode!==t.livemode)return {kind:"reject",reason:"invalid_evidence",businessWrites:0};
 if(!b.verified||!b.principalId||b.scope!==t.scope||b.customer!==p.customer||b.principalId!==p.owner||(before&&(before.stripe_scope!==t.scope||before.stripe_customer_id!==b.customer||before.billing_account_id!==b.accountId)))return {kind:"attention",reason:"ownership_conflict",businessWrites:0};
 const expectedRevision=before?.revision||"0",bindingRevision=b.revision,priceRevision=price?.revision||null;
 if(before?.last_event_created!==null&&before?.last_event_created!==undefined&&t.eventCreated!==null&&BigInt(t.eventCreated)<BigInt(before.last_event_created))return {kind:"no_change",canonical:before,entitlement:before.plan,order:"stale_ignored",expectedRevision,bindingRevision,priceRevision};
 if(!p.itemsComplete||p.approvedItemCount>1)return {kind:"attention",reason:"invalid_evidence",businessWrites:0};
 const paid=p.status==="active"||p.status==="trialing";
 const approved=price&&price.scope===t.scope&&price.id===p.price&&price.entitlementEnabled;
 // Access approval and application ownership are separate current contracts.
 if(paid&&!approved)return {kind:"attention",reason:"unknown_price",businessWrites:0};
 const terminal=p.status==="canceled";
 if(before?.terminal&&!terminal)return {kind:"no_change",canonical:before,entitlement:before.plan,order:"terminal_ignored",expectedRevision,bindingRevision,priceRevision};
 const facts={stripe_subscription_id:p.id,stripe_customer_id:p.customer,stripe_price_id:p.price,status:p.status,plan:paid&&approved?"pro" as const:"free" as const,cancel_at_period_end:p.cancelAtPeriodEnd,period_start:p.periodStart,period_end:p.periodEnd,trial_end:p.trialEnd,ended_at:p.endedAt,latest_invoice_id:p.latestInvoice,terminal};
 const snapshot_digest=canonicalDigest(facts),unchanged=before?.snapshot_digest===snapshot_digest;
 const canonical:Canonical={...facts,stripe_scope:t.scope,billing_account_id:b.accountId,revision:String(BigInt(expectedRevision)+(unchanged?BigInt(0):BigInt(1))),verified_at:p.verifiedAt,last_event_created:t.eventCreated===null?before?.last_event_created||null:before?.last_event_created&&BigInt(before.last_event_created)>BigInt(t.eventCreated)?before.last_event_created:t.eventCreated,last_event_id:t.sourceKind==="webhook"?t.sourceId:before?.last_event_id||null,snapshot_digest};
 return {kind:unchanged?"no_change":"commit",canonical,entitlement:canonical.plan,order:unchanged?"unchanged":"accepted",expectedRevision,bindingRevision,priceRevision};
}
