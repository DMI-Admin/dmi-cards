// Preserve the central plan/feature contract with the new protected access mirror.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(file,deps={}){
 const loaded={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:loaded,exports:loaded.exports,require:name=>deps[name]||{},console,process:{env:{}}});return loaded.exports;
}
const ent=load('src/lib/entitlements/index.ts'),context=load('src/lib/api/client-context.ts',{'@/lib/entitlements':ent,'@/lib/api/responses':{ApiRouteError:Error}});
let row=null,error=null,n=0;
const db={from(table){assert.equal(table,'account_billing');const q={select(){return q;},eq(key,user){assert.equal(key,'account_id');assert.equal(user,'fixture-user');return q;},async maybeSingle(){return{data:row,error};}};return q;}};
for(const [plan,status,expected]of [['free','free','free'],['pro','active','pro'],['pro','trialing','pro'],['pro','past_due','pro'],['pro','canceled','free'],['pro','unpaid','free'],['pro','paused','free'],['pro','incomplete','free'],['enterprise','active','enterprise'],['enterprise','past_due','enterprise'],['pro','unknown','free']]){
 row={plan,status,stripe_customer_id:'cus_fixture',stripe_subscription_id:'sub_fixture',cancel_at_period_end:true,current_period_end:'2027-01-01T00:00:00Z',seat_quantity:4};
 const result=await context.resolveTrustedApiBillingState(db,'fixture-user');assert.equal(result.plan,expected);assert.equal(result.entitlements.contacts.allowed,expected!=='free');assert.equal(result.cancelAtPeriodEnd,true);n++;
}
row=null;assert.equal((await context.resolveTrustedApiBillingState(db,'fixture-user')).plan,'free');n++;
row={plan:'pro',status:'active'};assert.equal((await context.resolveTrustedApiBillingState(db,'fixture-user')).plan,'free');n++;
error={code:'fixture'};await assert.rejects(context.resolveTrustedApiBillingState(db,'fixture-user'));n++;
assert.doesNotMatch(fs.readFileSync('src/lib/api/client-context.ts','utf8'),/billing_subscriptions|entitlementsForTrustedBillingState/);
assert.ok(ent.featureAccessByPlan.enterprise.has('contacts'));
console.log(`Canonical client entitlement ${n}/${n}`);
