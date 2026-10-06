// Offline operational read-model contracts. No network or database writes.
// KPI rules: count subscription rows, never customers. Paying = active + dmi_plan
// pro; trials/past_due/unpaid/incomplete/canceled excluded. Cancelling counts only
// paying rows with cancel_at_period_end, strictly before a verified period end.
// Active excludes cancelling. Past Due counts raw past_due. Monthly/Annual count
// paying rows with verified intervals (Finance or Stripe); never env ID guesses.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const now=Date.parse('2026-10-02T12:00:00Z');
class Clock extends Date {static now(){return now;}}
function load(path,deps){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,URL,Intl,Date:Clock,Map,Set,WeakMap,process:{env:{}},require:n=>{assert.ok(n in deps,n);return deps[n];}});return exports;}
const helpers=load('src/lib/admin-subscriptions.ts',{});
let runtimeScope='acct_fixture:test',scopeFails=false,authorized=false,dbReads=0,financeError=false;
const priceCalls=[],queries=[];
const stripe={prices:{retrieve:async id=>{priceCalls.push(id);if(id.includes('missing'))throw Error('private');return {id,livemode:false,unit_amount:id==='price_year'?5999:599,unit_amount_decimal:id==='price_year'?'5999':'599',currency:'gbp',billing_scheme:'per_unit',recurring:{interval:id==='price_year'?'year':'month',interval_count:1,usage_type:'licensed'}};}}};
const base={stripe_scope:'acct_fixture:test',user_id:'user1',profile_id:'profile1',dmi_plan:'pro',stripe_price_id:'price_month',stripe_subscription_status:'active',current_period_start:'2026-09-28T20:08:42Z',current_period_end:'2026-10-28T20:08:42Z',cancel_at_period_end:false,created_at:'2026-09-01'};
const row=(id,patch={})=>({...base,id,stripe_subscription_id:'sub_'+id,...patch});
const tables={billing_subscriptions:[
 row('monthly'),row('annual',{stripe_price_id:'price_year'}),row('historical',{stripe_price_id:'price_old'}),row('cancelling',{cancel_at_period_end:true}),
 row('trial',{stripe_subscription_status:'trialing',cancel_at_period_end:true}),row('past',{stripe_subscription_status:'past_due'}),row('canceled',{stripe_subscription_status:'canceled'}),
 row('unpaid',{stripe_subscription_status:'unpaid'}),row('incomplete',{stripe_subscription_status:'incomplete'}),row('expired',{cancel_at_period_end:true,current_period_end:'2026-10-01'}),
 row('unknownEnd',{cancel_at_period_end:true,current_period_end:null}),row('unavailable',{stripe_price_id:'price_missing'}),row('financeIncomplete',{stripe_price_id:'price_incomplete'}),
 row('foreign',{stripe_scope:'acct_other:test'}),row('live',{stripe_scope:'acct_fixture:live'}),row('unscoped',{stripe_scope:null})],
 profiles:[{id:'profile1',full_name:'Test Person',email:'test@example.invalid'}],clients:[{id:'client1',user_id:'user1',profile_id:'profile1',account_type:'individual'}],
 cards:[{id:'card1',user_id:'user1'},{id:'card2',user_id:'user1'},{id:'profileCard',user_id:'profile1'}],billing_finance_subscriptions:[],billing_finance_subscription_items:[]};
function finance(id,price='price_month',patch={}){
 tables.billing_finance_subscriptions.push({stripe_scope:base.stripe_scope,stripe_object_id:'sub_'+id,items_complete:true,valuation_status:'complete',...patch});
 tables.billing_finance_subscription_items.push({stripe_scope:base.stripe_scope,stripe_object_id:'si_'+id,stripe_subscription_id:'sub_'+id,stripe_price_id:price,recurring_interval:'month',interval_count:1,currency:'gbp',quantity:'2',unit_amount_minor:'599',unit_amount_decimal_minor:'599.000000000000',billing_scheme:'per_unit',usage_type:'licensed',removed_at:null,valuation_status:'complete',...patch});
}
finance('monthly');finance('financeIncomplete','price_incomplete',{valuation_status:'incomplete'});
// Same subscription identifier in another account/mode must never enrich this row.
finance('historical','price_old',{stripe_scope:'acct_other:test',unit_amount_decimal_minor:'99999'});
const db={from:table=>{dbReads++;let ids,field,scopeFilter,start=0,end=499;const q={select:columns=>{queries.push({table,columns});return q;},order:column=>{assert.equal(column,table.startsWith('billing_finance_')?'stripe_object_id':'id');return q;},in:(f,v)=>{field=f;ids=v;return q;},range:(a,b)=>{start=a;end=b;return q;},eq:(f,v)=>{assert.equal(f,'stripe_scope');scopeFilter=v;return q;},then:resolve=>{if(table.startsWith('billing_'))assert.equal(scopeFilter,runtimeScope);resolve({data:financeError&&table.startsWith('billing_finance_')?null:tables[table].filter(r=>(!ids||ids.includes(r[field]))&&(!table.startsWith('billing_')||r.stripe_scope===scopeFilter)).slice(start,end+1),error:financeError&&table.startsWith('billing_finance_')?{}:null});}};return q;}};
const server=load('src/lib/admin-subscriptions-server.ts',{'server-only':{},'@clerk/nextjs/server':{auth:async()=>({})},'next/server':{NextResponse:{json:Response.json}},'@/lib/admin-auth':{requireAdminAccess:async()=>({authorized})},'@/lib/supabase-admin':{createSupabaseAdminClient:()=>db},'@/lib/stripe/config':{getStripeServerClient:()=>stripe,resolveStripeAccountScope:async()=>{if(scopeFails)throw Error('scope unavailable');return {stripeScope:runtimeScope};}},'@/lib/admin-subscriptions':helpers});
const get=query=>server.readAdminSubscriptions(new Request('https://staging.invalid/api/admin/subscriptions'+query));
assert.equal((await get('')).status,403);assert.equal(dbReads,0);assert.equal(priceCalls.length,0);
authorized=true;assert.equal((await get('?page=-1')).status,400);
let res=await get('');assert.equal(res.status,200);assert.equal(res.headers.get('cache-control'),'private, no-store');let body=await res.json();
const find=id=>body.items.find(x=>x.id===id);
assert.deepEqual(body.summary,{paying:6,active:5,cancelling:1,pastDue:1,monthly:4,annual:1,trialling:1});
assert.equal(find('historical').paying,true);assert.equal(find('historical').price,'£5.99');assert.equal(find('historical').priceSource,'stripe');
assert.equal(find('monthly').price,'£5.99');assert.equal(find('monthly').priceSource,'finance');assert.equal(find('monthly').quantity,'2');
assert.equal(find('annual').price,'£59.99');assert.equal(find('annual').interval,'Annual');
assert.equal(find('financeIncomplete').price,'Unavailable');assert.equal(find('financeIncomplete').coverage,'incomplete');assert.equal(find('financeIncomplete').interval,'Monthly');assert.ok(!priceCalls.includes('price_incomplete'));
assert.equal(find('unavailable').price,'Unavailable');assert.equal(find('unavailable').interval,'Unavailable');
assert.equal(find('monthly').cards,2);assert.equal(find('monthly').clientLinked,true);assert.equal(find('monthly').email,'test@example.invalid');
assert.equal(find('cancelling').renewal,'ending');assert.equal(helpers.subscriptionEndLabel(find('cancelling')),'Ends 28 Oct 2026');assert.equal(find('monthly').renewal,'renewal');assert.equal(find('past').renewal,'period');assert.equal(find('trial').status,'Trialling');
assert.equal(find('expired').paying,false);assert.equal(find('unknownEnd').paying,false);
assert.equal(helpers.subscriptionDate('2026-09-30T23:30:00Z'),'1 Oct 2026');assert.equal(helpers.subscriptionDate('2026-10-25T23:30:00Z'),'25 Oct 2026');
assert.equal(helpers.subscriptionRenewal('active',false,'2026-10-01',now),'period');
assert.equal(helpers.configuredUnitPrice('9007199254740993.123456789012','gbp'),'£90,071,992,547,409.93123456789012');
assert.equal(helpers.configuredUnitPrice(599,'gbp'),'Unavailable');
assert.ok(queries.some(x=>x.columns.includes('unit_amount_decimal_minor::text')&&x.columns.includes('quantity::text')));
const calls=priceCalls.length;body=await (await get('?search=TEST%40example.invalid&status=Active')).json();assert.equal(body.total,5);assert.equal(priceCalls.length,calls);assert.equal(body.summary.paying,6);
body=await (await get('?interval=Annual')).json();assert.equal(body.total,1);assert.ok(!JSON.stringify(body).includes('stripe_customer_id'));
tables.clients.push({...tables.clients[0],id:'ambiguous'});body=await (await get('')).json();assert.equal(find('monthly').clientLinked,false);
tables.clients=[];tables.profiles=[];body=await (await get('')).json();assert.equal(find('monthly').name,'Unresolved client');assert.equal(find('monthly').clientLinked,false);
// Existing unsupported valuations must not be replaced by a plausible price lookup.
const parent=tables.billing_finance_subscriptions.find(x=>x.stripe_object_id==='sub_financeIncomplete');
parent.valuation_status='unsupported';body=await (await get('')).json();assert.equal(find('financeIncomplete').coverage,'unsupported');assert.equal(find('financeIncomplete').price,'Unavailable');
parent.items_complete=false;body=await (await get('')).json();assert.equal(find('financeIncomplete').interval,'Unavailable');parent.items_complete=true;
const monthlyItem=tables.billing_finance_subscription_items.find(x=>x.stripe_subscription_id==='sub_monthly');
monthlyItem.stripe_price_id='price_stale';body=await (await get('')).json();assert.equal(find('monthly').interval,'Unavailable');assert.equal(find('monthly').price,'Unavailable');monthlyItem.stripe_price_id='price_month';
// Unit-price evidence is independent from effective valuation; never calculate a total.
const incompleteItem=tables.billing_finance_subscription_items.find(x=>x.stripe_subscription_id==='sub_financeIncomplete');
Object.assign(parent,{valuation_status:'unsupported',valuation_reason:'tax_basis_unresolved'});
Object.assign(incompleteItem,{valuation_status:'unsupported',valuation_reason:'tax_basis_unresolved',quantity:'1'});
const preserved=JSON.stringify([parent,incompleteItem]);const lookupCount=priceCalls.length;
body=await (await get('')).json();const kpis=JSON.stringify(body.summary);
assert.equal(find('financeIncomplete').price,'£5.99');assert.equal(find('financeIncomplete').coverage,'unsupported');assert.equal(JSON.stringify([parent,incompleteItem]),preserved);assert.equal(priceCalls.length,lookupCount);
incompleteItem.quantity='7';incompleteItem.discount_context=[{percent_off:'50'}];
parent.valuation_reason='unsupported_discount_context';incompleteItem.valuation_reason='unsupported_discount_context';
body=await (await get('')).json();assert.equal(find('financeIncomplete').price,'£5.99');assert.equal(find('financeIncomplete').quantity,'7');assert.equal(JSON.stringify(body.summary),kpis);
parent.valuation_status='incomplete';incompleteItem.valuation_status='incomplete';body=await (await get('')).json();assert.equal(find('financeIncomplete').price,'£5.99');assert.equal(find('financeIncomplete').coverage,'incomplete');
const validItem=structuredClone(incompleteItem);
for(const [amount,expected] of [['599.123456789012','£5.99123456789012'],['9007199254740993.123456789012','£90,071,992,547,409.93123456789012']]){
 incompleteItem.unit_amount_minor=null;incompleteItem.unit_amount_decimal_minor=amount;body=await (await get('')).json();assert.equal(find('financeIncomplete').price,expected);
}
Object.assign(incompleteItem,validItem);
for(const patch of [
 {unit_amount_minor:null,unit_amount_decimal_minor:null},
 {unit_amount_decimal_minor:'not-decimal'}, {unit_amount_decimal_minor:'6e2'}, {unit_amount_decimal_minor:599},
 {unit_amount_minor:'600'}, {unit_amount_minor:'9223372036854775808'},
 {currency:'INVALID'}, {stripe_price_id:'price_mismatch'}, {billing_scheme:'tiered'}, {usage_type:'metered'},
 {recurring_interval:null}, {interval_count:0}, {valuation_reason:'missing_period'},
]){
 Object.assign(incompleteItem,patch);body=await (await get('')).json();assert.equal(find('financeIncomplete').price,'Unavailable',JSON.stringify(patch));Object.assign(incompleteItem,validItem);
}
parent.items_complete=false;body=await (await get('')).json();assert.equal(find('financeIncomplete').price,'Unavailable');parent.items_complete=true;
tables.billing_finance_subscription_items.push({...incompleteItem,stripe_object_id:'si_conflicting'});body=await (await get('')).json();assert.equal(find('financeIncomplete').price,'Unavailable');tables.billing_finance_subscription_items.pop();
body=await (await get('')).json();assert.equal(JSON.stringify(body.summary),kpis);
console.log('PASS: tax/discount valuation remains unsupported/incomplete while exact unit price displays; no quantity/discount total; malformed/missing/mismatched/multi-item rejection; KPI parity.');
financeError=true;body=await (await get('')).json();assert.equal(body.total,13);assert.equal(find('monthly').priceSource,'stripe');financeError=false;
for(const [scope,expected] of [['acct_fixture:live','live'],['acct_other:test','foreign']]){runtimeScope=scope;body=await (await get('')).json();assert.deepEqual(body.items.map(x=>x.id),[expected]);}
runtimeScope=base.stripe_scope;
for(let i=0;i<30;i++)tables.billing_subscriptions.push(row('page'+i));
body=await (await get('?page=2')).json();assert.equal(body.pageSize,25);assert.equal(body.page,2);assert.equal(body.items.length,18);
scopeFails=true;assert.equal((await get('')).status,503);
console.log('PASS: exact KPI rules; historical Pro, trials/statuses/cancellation expiry; optional scoped Finance, exact amounts, Stripe fallback; London dates; renewal labels; UUID joins/cards/ambiguity; filters/pagination/auth.');

// Presentation primitives keep unknown states visible and preserve accessible text.
const uiExports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/components/admin/AdminUI.tsx','utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
}).outputText, { exports: uiExports, require: name => {
  if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({type, props}), jsxs: (type, props) => ({type, props}) };
  assert.equal(name, './AdminUI.module.css'); return {default:{badge:'badge',header:'header',kpi:'kpi'}};
}});
for (const [label,tone] of [['Active','success'],['Cancelling','warning'],['Past Due','danger'],['Failed','danger'],['Trialling','trial'],['Cancelled','neutral'],['Unrecognized','neutral']]) {
  const badge = uiExports.AdminStatusBadge({label});
  assert.equal(badge.props['data-tone'],tone); assert.equal(badge.props.children,label);
}
assert.equal(uiExports.AdminKpiCard({label:'Total Paying',value:0}).props.children[1].props.children,0);
const page = fs.readFileSync('src/app/subscriptions/page.tsx','utf8');
for (const field of ['Client','Email','Plan','Status','Billing','Configured recurring unit price','Current period started','Next renewal / Current period end','Cards','Actions']) assert.ok(page.includes(`data-label="${field}"`),field);
for (const metric of ['paying','active','cancelling','pastDue','monthly','annual']) assert.ok(page.includes(`'${metric}'`),metric);
assert.ok(page.includes('href="/clients/individual"'));
assert.ok(page.includes('aria-label="Subscriptions pagination"'));
assert.ok(page.includes('scope="col"'));
assert.ok(page.includes('role="alert"') && page.includes('role="status"'));
console.log('PASS: semantic status tones, unknown labels, zero KPI values, all inventory fields/metrics and existing navigation/accessibility hooks.');

assert.ok(page.includes('<AdminShell>'));
assert.doesNotMatch(page, /<main|<Sidebar|<details/);
