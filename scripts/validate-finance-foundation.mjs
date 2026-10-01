import Stripe from "stripe";
// Offline Phase 1 contracts. No network, database or environment credentials.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
const load=(file,deps={})=>{const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports,Date,Intl,BigInt,require:name=>{if(name==='server-only')return {};if(name==='stripe')return {default:Stripe};assert.ok(name in deps,name);return deps[name];}});return exports;};
const m=load('src/lib/stripe/finance-metrics.ts');
const n=load('src/lib/stripe/finance-normalize.ts',{'./finance-metrics':m});
const scope='acct_fixture:test',now='2026-09-15T00:00:00.000Z',seconds=s=>Date.parse(s)/1000;
const ctx={scope,verifiedAt:now,apiVersion:'fixture'};
const item={id:'si_one',created:seconds('2026-09-01'),quantity:1,current_period_start:seconds('2026-09-01'),current_period_end:seconds('2026-10-01'),discounts:[],price:{id:'price_month',product:'prod_pro',unit_amount:599,unit_amount_decimal:'599',currency:'gbp',billing_scheme:'per_unit',tax_behavior:'exclusive',recurring:{interval:'month',interval_count:1,usage_type:'licensed'}}};
const raw={id:'sub_one',created:seconds('2026-09-01'),livemode:false,customer:'cus_one',metadata:{dmi_app:'dmi_cards_v2'},status:'active',cancel_at_period_end:false,cancel_at:null,canceled_at:null,ended_at:null,trial_end:null,pause_collection:null,discounts:[],items:{has_more:false,data:[item]}};
const user='11111111-1111-4111-8111-111111111111';
const norm=(s=raw,c=ctx)=>n.normalizeSubscription(s,c,user);
const contribution=s=>{const v=norm(s);return m.mrrContribution(v.subscription,v.items[0],scope,now);};
let v=norm();assert.equal(contribution(raw).value.numerator,599n);
const annual=structuredClone(raw);annual.items.data[0].price.unit_amount=5999;annual.items.data[0].price.unit_amount_decimal='5999';annual.items.data[0].price.recurring.interval='year';
let r=contribution(annual);assert.equal(r.value.numerator,5999n);assert.equal(r.value.denominator,12n);assert.equal(m.arr(r.value).numerator,5999n);
const qty=structuredClone(raw);qty.items.data[0].quantity=3;assert.equal(contribution(qty).value.numerator,1797n);
const coupon={id:'di_coupon',start:seconds('2026-09-01'),end:null,source:{coupon:{id:'coupon_fixture',duration:'forever',percent_off:10,amount_off:null,currency:null}}};
const discounted=structuredClone(raw);discounted.discounts=[coupon];assert.equal(contribution(discounted).value.numerator,539n);
discounted.discounts[0].source.coupon={id:'coupon_fixed',duration:'forever',percent_off:null,amount_off:100,currency:'gbp'};assert.equal(contribution(discounted).value.numerator,499n);
const mixed=structuredClone(raw);mixed.items.data.push({...annual.items.data[0],id:'si_two'});assert.equal(contribution(mixed).status,'incomplete');
const ambiguous=structuredClone(discounted);ambiguous.items.data.push({...item,id:'si_two'});assert.equal(contribution(ambiguous).status,'incomplete');
for(const status of ['trialing','past_due','unpaid','canceled','incomplete'])assert.equal(contribution({...raw,status}).value.numerator,0n);
v=norm({...raw,cancel_at_period_end:true});assert.equal(m.mrrContribution(v.subscription,v.items[0],scope,now).value.numerator,599n);assert.equal(m.expectedRenewalEligibility(v.subscription,v.items[0],scope,now).value,false);
for(const other of ['acct_fixture:live','acct_other:test'])assert.equal(m.mrrContribution(v.subscription,v.items[0],other,now).status,'incomplete');
assert.throws(()=>norm(raw,{...ctx,scope:'acct_fixture:live'}),/SCOPE/);
const eur=structuredClone(raw);eur.items.data[0].price.currency='eur';assert.equal(contribution(eur).status,'incomplete');
const dec=structuredClone(raw);dec.items.data[0].price.unit_amount=null;dec.items.data[0].price.unit_amount_decimal='599.123456789012';assert.equal(norm(dec).items[0].unit_amount_decimal_minor,'599.123456789012');
assert.throws(()=>n.minor(Number.MAX_SAFE_INTEGER+1));assert.equal(n.minor('9007199254740993'),'9007199254740993');assert.throws(()=>n.minor('9223372036854775808'));assert.throws(()=>n.minor('NaN'));
assert.throws(()=>norm({...raw,items:{has_more:false,data:[{...item,quantity:-1}]}}));
assert.equal(contribution({...raw,items:{has_more:true,data:[item]}}).status,'incomplete');
assert.equal(m.mrrContribution(v.subscription,v.items[0],scope,'2026-10-01T00:00:00Z').value.numerator,0n);
const current=norm();assert.equal(m.mrrContribution(current.subscription,current.items[0],scope,'2026-10-01T00:00:00Z').status,'incomplete');
for(const [year,month,start,end] of [[2026,1,'2026-01-01T00:00:00.000Z','2026-02-01T00:00:00.000Z'],[2026,3,'2026-03-01T00:00:00.000Z','2026-03-31T23:00:00.000Z'],[2026,10,'2026-09-30T23:00:00.000Z','2026-11-01T00:00:00.000Z'],[2026,12,'2026-12-01T00:00:00.000Z','2027-01-01T00:00:00.000Z']]){const b=m.londonMonthBounds(year,month);assert.equal(b.start,start);assert.equal(b.end,end);}
const coverage={scope,currency:'gbp',quality:'complete',start:'2026-09-01',end:'2026-10-01'};
assert.equal(m.aggregateGbp([],scope,{...coverage,quality:'partial'}).status,'incomplete');
assert.equal(m.aggregateGbp([{scope,currency:'gbp',value:r.value},{scope,currency:'gbp',value:r.value}],scope,coverage).value.numerator,5999n);
assert.equal(m.roundMinor(m.aggregateGbp([{scope,currency:'gbp',value:r.value},{scope,currency:'gbp',value:r.value}],scope,coverage).value),'1000');
assert.equal(m.aggregateGbp([{scope:'acct_other:test',currency:'gbp',value:r.value}],scope,coverage).status,'incomplete');
assert.equal(m.aggregateGbp([{scope,currency:'eur',value:r.value}],scope,coverage).status,'incomplete');
const charge={id:'ch_one',created:seconds('2026-09-01'),livemode:false,customer:'cus_one',payment_intent:'pi_one',currency:'gbp',status:'succeeded',paid:true,captured:true,amount:599,amount_captured:599,amount_refunded:0,billing_details:{secret:'NEVER_PERSIST'},payment_method_details:{card:{number:'NEVER_PERSIST'}}};
const event={id:'evt_one',created:seconds('2026-09-02'),type:'charge.succeeded',subjectId:'ch_one',subjectStatus:'succeeded',subjectCaptured:true,capturedAmountMinor:'599'};
const payment=n.normalizeCharge(charge,{...ctx,event});assert.equal(payment.collected_at,'2026-09-02T00:00:00.000Z');assert.ok(!JSON.stringify(payment).includes('NEVER_PERSIST'));assert.equal(n.normalizeCharge(charge,ctx).collected_at,null);
assert.equal(n.normalizeCharge(charge,{...ctx,event:{...event,subjectCaptured:false}}).collected_at,null);
const failed={...charge,status:'failed',paid:false,captured:false,amount_captured:0,failure_code:'card_declined'};
const attempt=n.normalizeFailedCharge(failed,{...ctx,event:{...event,type:'charge.failed',subjectStatus:'failed'}});assert.equal(attempt.attempt_key,'charge:ch_one');assert.throws(()=>n.normalizeFailedCharge(failed,ctx),/MISSING_FAILURE_TIME/);
const refund={id:'re_one',created:seconds('2026-09-02'),livemode:false,charge:'ch_one',payment_intent:'pi_one',currency:'gbp',amount:100,status:'succeeded',reason:'requested_by_customer'};
assert.equal(n.normalizeRefund(refund,ctx).succeeded_at,null);assert.equal(n.normalizeRefund(refund,{...ctx,event:{...event,subjectId:'re_one',type:'refund.updated',previousStatus:'pending'}}).success_time_basis,'verified_event');
assert.equal(n.normalizeRefund({...refund,status:'pending'},{...ctx,event:{...event,subjectId:'re_one',type:'refund.created'}}).succeeded_at,null);
const invoice={id:'in_one',created:seconds('2026-09-01'),livemode:false,customer:'cus_one',parent:{type:'subscription_details',subscription_details:{subscription:'sub_one'}},number:'TEST-1',status:'paid',billing_reason:'subscription_cycle',collection_method:'charge_automatically',currency:'gbp',subtotal:599,total_discount_amounts:[],total_taxes:[],total:599,amount_due:599,amount_paid:599,amount_remaining:0,attempt_count:1,status_transitions:{finalized_at:seconds('2026-09-01'),paid_at:seconds('2026-09-02')}};
assert.equal(n.normalizeInvoice(invoice,ctx).payments_complete,false);assert.equal(n.normalizeInvoice(invoice,ctx).amount_paid_minor,'599');assert.throws(()=>n.normalizeInvoice({...invoice,amount_paid:undefined},ctx));
const allocation={id:'inpay_one',created:seconds('2026-09-01'),livemode:false,invoice:'in_one',payment:{type:'payment_intent',payment_intent:'pi_one'},currency:'gbp',status:'paid',amount_requested:599,amount_paid:599,status_transitions:{paid_at:seconds('2026-09-02')}};
assert.equal(n.normalizeInvoicePayment(allocation,ctx).stripe_charge_id,null);
// Follow local runtime imports from EVERY client entry. No service module may be reachable.
const files=[];function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,entry.name);if(entry.isDirectory())walk(p);else if(/\.tsx?$/.test(p))files.push(p);}}walk('src');
const sources=new Map(files.map(f=>[f,ts.createSourceFile(f,fs.readFileSync(f,'utf8'),ts.ScriptTarget.Latest,true)]));
function resolve(from,spec){if(!spec.startsWith('.')&&!spec.startsWith('@/'))return null;const p=spec.startsWith('@/')?'src/'+spec.slice(2):path.normalize(path.join(path.dirname(from),spec));return [p+'.ts',p+'.tsx',p+'/index.ts',p+'/index.tsx'].find(f=>sources.has(f));}
function dependencies(f){const deps=[];function visit(node){if(ts.isImportDeclaration(node)&&!node.importClause?.isTypeOnly||ts.isExportDeclaration(node)&&!node.isTypeOnly){const s=node.moduleSpecifier;if(s&&ts.isStringLiteral(s)){const resolved=resolve(f,s.text);if(resolved)deps.push(resolved);}}if(ts.isCallExpression(node)&&node.arguments.length&&ts.isStringLiteral(node.arguments[0])&&(node.expression.kind===ts.SyntaxKind.ImportKeyword||ts.isIdentifier(node.expression)&&node.expression.text==='require')){const resolved=resolve(f,node.arguments[0].text);if(resolved)deps.push(resolved);}ts.forEachChild(node,visit);}visit(sources.get(f));return deps;}
let clientEntries=0;for(const [file,s] of sources){if(!s.statements.some(n=>ts.isExpressionStatement(n)&&ts.isStringLiteral(n.expression)&&n.expression.text==='use client'))continue;clientEntries++;const seen=new Set();function check(f){if(seen.has(f))return;seen.add(f);assert.notEqual(f,'src/lib/supabase-admin.ts',`Client import path from ${file}`);for(const d of dependencies(f))check(d);}check(file);}
for(const file of ['finance-types','finance-metrics','finance-normalize']){const text=fs.readFileSync(`src/lib/stripe/${file}.ts`,'utf8');assert.ok(text.includes('import "server-only"'));assert.doesNotMatch(text,/billing_foundation_command|billing_subscriptions|\.rpc\(|\.from\(|fetch\(/);}
assert.ok(fs.readFileSync('src/lib/supabase-admin.ts','utf8').startsWith('import "server-only";'));
console.log(`PASS: Finance normalization/metrics, lossless money, discounts, scope/currency isolation, London/DST, incomplete coverage, evidence allowlists; ${clientEntries} client-entry import graphs exclude service-role module.`);

assert.equal(n.normalizeRefund(refund,{...ctx,event:{...event,subjectId:'re_one',type:'refund.updated'}}).succeeded_at,null);
assert.equal(n.normalizeInvoice({...invoice,total_discount_amounts:null,total_taxes:null},ctx).tax_minor,'0');
for (const field of ['total','amount_due','amount_remaining']) assert.throws(()=>n.normalizeInvoice({...invoice,[field]:Number.MAX_SAFE_INTEGER+1},ctx));
assert.equal(m.expectedRenewalEligibility(current.subscription,current.items[0],scope,now).value,true);

// Use real installed SDK Decimal instances, never a duck-typed stand-in.
const withDecimal=(value,integer=599)=>{const input=structuredClone(raw);input.items.data[0].price.unit_amount=integer;input.items.data[0].price.unit_amount_decimal=value;return input;};
const object599=norm(withDecimal(Stripe.Decimal.from('599')));
assert.equal(object599.items[0].unit_amount_minor,'599');assert.equal(object599.items[0].unit_amount_decimal_minor,'599');assert.equal(object599.items[0].effective_cycle_amount_minor,'599');
assert.equal(JSON.stringify(object599),JSON.stringify(norm(withDecimal('599'))));
for(const value of ['599.123456789012','9007199254740993','12345678901234567890123456.123456789012']){
 const left=withDecimal(value,null),right=withDecimal(Stripe.Decimal.from(value),null);left.items.data[0].price.tax_behavior='unspecified';right.items.data[0].price.tax_behavior='unspecified';const a=norm(left),b=norm(right);assert.equal(JSON.stringify(a),JSON.stringify(b));assert.equal(b.items[0].unit_amount_decimal_minor,value);
}
assert.equal(norm(withDecimal(Stripe.Decimal.from('9007199254740993'),'9007199254740993')).items[0].unit_amount_minor,'9007199254740993');
assert.throws(()=>norm(withDecimal(Stripe.Decimal.from('600'))),/FINANCE_MALFORMED_STRIPE_DATA/);
let coerced=false;
for(const value of [{},{_coefficient:599n,_exponent:0},Object.freeze({_coefficient:599n,_exponent:0}),{toString(){coerced=true;return '599';}},599,[],Object.freeze(Object.create(Object.getPrototypeOf(Stripe.Decimal.zero)))])assert.throws(()=>norm(withDecimal(value)),/FINANCE_MALFORMED_STRIPE_DATA/);
assert.equal(coerced,false);
for(const value of ['-1','0.0000000000001'])for(const shape of [value,Stripe.Decimal.from(value)])assert.throws(()=>norm(withDecimal(shape,null)),/FINANCE_INVALID_DECIMAL/);
console.log('PASS: real Stripe Decimal/string parity; exact 599p, fractional/large precision; malformed object rejection; unchanged integer agreement and decimal errors.');
