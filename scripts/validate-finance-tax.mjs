// Offline only: synthetic tax evidence, no credentials/network/database.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {loadFinance,memoryHarness,consumerScenarios} from './validate-finance-consumer.mjs';
const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/stripe/finance-tax.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:n=>{assert.equal(n,'server-only');return {};}});
const {invoiceTaxEvidence:normalize}=exports;
const tax={amount:100,taxable_amount:499,tax_behavior:'inclusive',type:'tax_rate_details',tax_rate_details:{tax_rate:'txr_vat'},taxability_reason:'standard_rated'};
const raw={id:'in_tax',livemode:false,currency:'gbp',status:'paid',total:599,total_excluding_tax:499,automatic_tax:{enabled:true,status:'complete'},status_transitions:{finalized_at:1800000000},total_taxes:[tax],lines:{has_more:false,data:[{id:'il_one',currency:'gbp',invoice:'in_tax',livemode:false,quantity:1,parent:{type:'subscription_item_details'}}]},_finance_tax_rates:{txr_vat:{id:'txr_vat',livemode:false,percentage:20,tax_type:'vat',country:'GB',private:'NEVER_PERSIST'}}};
let e=normalize(raw);assert.equal(e.status,'verified');assert.equal(e.taxMinor,'100');assert.equal(e.vatMinor,'100');assert.equal(e.netMinor,'499');assert.equal(e.breakdown[0].ratePercent,'20');assert.ok(!JSON.stringify(e).includes('NEVER_PERSIST'));
e=normalize({...raw,total:600,total_excluding_tax:500,total_taxes:[{...tax,tax_behavior:'exclusive'}]});assert.equal(e.status,'verified');assert.equal(e.netMinor,'500');
e=normalize({...raw,total:0,total_excluding_tax:0,total_taxes:[]});assert.equal(e.taxMinor,'0');assert.equal(e.vatMinor,'0');assert.equal(e.netMinor,'0');
for(const change of [{total_taxes:null},{total_taxes:undefined},{total_excluding_tax:null},{automatic_tax:{enabled:true,status:'requires_location_inputs'}},{automatic_tax:{enabled:true,status:'failed'}},{automatic_tax:undefined},{lines:{has_more:true,data:[]}},{lines:undefined},{status:'draft'},{total:600}]){e=normalize({...raw,...change});assert.equal(e.status,'unknown',JSON.stringify(change));assert.equal(e.taxMinor,null);assert.equal(e.netMinor,null);}
assert.equal(normalize({}).taxMinor,null);
e=normalize({...raw,_finance_tax_rates:{}});assert.equal(e.taxMinor,'100');assert.equal(e.vatMinor,null);assert.equal(e.breakdown[0].ratePercent,null);
e=normalize({...raw,total:649,total_taxes:[tax,{...tax,amount:50,tax_rate_details:{tax_rate:'txr_other'}}],_finance_tax_rates:{...raw._finance_tax_rates,txr_other:{id:'txr_other',livemode:false,percentage:10,tax_type:'sales_tax',country:'US'}}});assert.equal(e.taxMinor,'150');assert.equal(e.vatMinor,'100');assert.equal(e.breakdown.length,2);
// Invoice pennies are canonical, regardless of discounts, quantity, annual periods,
// proration or one-off/mixed lines. None of these is used to extrapolate forecasts.
for(const line of [{quantity:3},{discount_amounts:[{amount:50}]},{period:{start:1800000000,end:1831536000}},{parent:{type:'subscription_item_details',subscription_item_details:{proration:true}}},{parent:{type:'invoice_item_details'}}]){
 e=normalize({...raw,lines:{has_more:false,data:[{id:'il_one',currency:'gbp',invoice:'in_tax',livemode:false,...line},{id:'il_two',currency:'gbp',invoice:'in_tax',livemode:false}]}});assert.equal(e.taxMinor,'100');assert.equal(e.netMinor,'499');assert.equal(e.lineCount,2);
}
e=normalize({...raw,total:'9007199254740993',total_excluding_tax:'9007199254740893'});assert.equal(e.grossMinor,'9007199254740993');assert.equal(e.netMinor,'9007199254740893');
assert.equal(normalize({...raw,total:Number.MAX_SAFE_INTEGER+1}).status,'unknown');
assert.equal(normalize({...raw,total_taxes:[{...tax,amount:{value:100}}]}).status,'unknown');
const f=exports.forecastTaxEvidence({stripe_scope:'acct_tax:test',stripe_subscription_id:'sub_one',stripe_object_id:'si_one',stripe_price_id:'price_one',currency:'gbp',quantity:'3',recurring_interval:'year',interval_count:1,tax_behavior:'inclusive',discount_context:[]},[]);
assert.equal(f.status,'unknown');assert.equal(f.taxMinor,null);assert.equal(f.netMinor,null);assert.equal(f.sourceRef,null);assert.equal(f.configuration.scope,'acct_tax:test');
// Existing observer/consumer path still rejects cross-scope objects and deduplicates.
assert.ok(loadFinance().consumer);await consumerScenarios(memoryHarness('acct_consumer:test'),'acct_consumer:test');
console.log('PASS tax evidence: inclusive/exclusive, verified zero vs null, incomplete automatic tax, missing/old evidence, multiple components, exact pennies, discounts/quantity/annual/proration/mixed lines, unknown forecasts, scope/idempotency.');
