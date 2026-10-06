// Called only by the disposable Unix-socket runner. Synthetic local records only.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
export async function validateV1Reporting(db){
 const migration='supabase/migrations/20261004120000_admin_finance_v1_reporting.sql';
 await db.query(await fs.readFile(migration,'utf8'));
 await db.query('GRANT SELECT ON billing_subscriptions TO service_role');
 const signature='public.admin_finance_v1_report(text,timestamp with time zone,jsonb,text,text,integer)';
 const def=(await db.query('SELECT prosecdef,provolatile,proconfig FROM pg_proc WHERE oid=$1::regprocedure',[signature])).rows[0];assert.equal(def.prosecdef,false);assert.equal(def.provolatile,'s');assert.deepEqual(def.proconfig,['search_path=pg_catalog']);
 const scope='acct_v1:test',now='2026-10-15T12:00:00Z';
 const oct=[{label:'2026-10',start_at:'2026-09-30T23:00:00Z',end_at:'2026-11-01T00:00:00Z'}];
 const nov=[{label:'2026-11',start_at:'2026-11-01T00:00:00Z',end_at:'2026-12-01T00:00:00Z'}];
 const report=async(list='invoices',periods=oct,after=null,limit=25,s=scope)=>(await db.query('SELECT public.admin_finance_v1_report($1,$2,$3::jsonb,$4,$5,$6) r',[s,now,JSON.stringify(periods),list,after,limit])).rows[0].r;
 for(const role of ['anon','authenticated']){await db.query('SET ROLE '+role);await assert.rejects(report(),/permission denied/);await db.query('RESET ROLE');}
 const user=(await db.query('SELECT id FROM auth.users LIMIT 1')).rows[0].id;
 const insert=async(table,row)=>{const keys=Object.keys(row);await db.query(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map((_,i)=>'$'+(i+1)).join(',')})`,Object.values(row).map(v=>v&&typeof v==='object'?JSON.stringify(v):v));};
 const base={stripe_scope:scope,stripe_created_at:'2026-10-02',stripe_api_version:'fixture',normalizer_version:2,verified_at:'2026-10-03'};
 await insert('billing_accounts',{stripe_scope:scope,user_id:user,stripe_customer_id:'cus_vone',verified_at:'2026-10-01'});
 await insert('billing_approved_prices',{stripe_scope:scope,stripe_price_id:'price_vone',plan:'pro',entitlement_enabled:true,checkout_enabled:true,approved_by:'offline-fixture',approval_reason:'Synthetic local fixture'});
 const sub={...base,stripe_object_id:'sub_vone',user_id:user,stripe_customer_id:'cus_vone',status:'active',cancel_at_period_end:false,collection_paused:false,linkage_status:'verified',valuation_status:'unsupported',valuation_reason:'tax_basis_unresolved',items_complete:true};
 await insert('billing_finance_subscriptions',sub);
 const item={...base,stripe_object_id:'si_vone',stripe_subscription_id:'sub_vone',stripe_price_id:'price_vone',stripe_product_id:'prod_vone',currency:'gbp',quantity:1,unit_amount_minor:599,unit_amount_decimal_minor:'599',recurring_interval:'month',interval_count:1,usage_type:'licensed',billing_scheme:'per_unit',tax_behavior:'inclusive',period_start:'2026-10-02',period_end:'2026-11-02',valuation_status:'unsupported',valuation_reason:'tax_basis_unresolved'};
 await insert('billing_finance_subscription_items',item);
 const tax={version:1,status:'verified',reason:'verified_invoice_totals',basis:'finalized_invoice',grossMinor:'599',taxMinor:'100',vatMinor:'100',netMinor:'499',automaticTaxEnabled:true,automaticTaxStatus:'complete',breakdownComplete:true,linesComplete:true,lineCount:1,breakdown:[{amountMinor:'100',taxableAmountMinor:'499',behavior:'inclusive',taxRateId:'txr_fixture',ratePercent:'20',taxType:'vat',country:'GB',reason:'standard_rated'}]};
 const inv={...base,stripe_object_id:'in_vone',stripe_customer_id:'cus_vone',stripe_subscription_id:'sub_vone',number:'TEST-01',status:'paid',collection_method:'charge_automatically',currency:'gbp',subtotal_minor:599,discount_minor:0,tax_minor:100,total_minor:599,amount_due_minor:599,amount_paid_minor:599,amount_remaining_minor:0,attempt_count:1,finalized_at:'2026-10-02',paid_at:'2026-10-02',payments_complete:true,tax_evidence:tax};
 await insert('billing_invoices',inv);
 const payment={...base,stripe_object_id:'ch_vone',stripe_customer_id:'cus_vone',currency:'gbp',status:'succeeded',amount_minor:599,amount_captured_minor:599,amount_refunded_minor:0,paid:true,captured:true,collected_at:'2026-10-02',collection_time_basis:'verified_event',attribution_status:'verified'};
 await insert('billing_payments',payment);
 const allocation={...base,stripe_object_id:'inpay_vone',stripe_invoice_id:'in_vone',stripe_charge_id:'ch_vone',payment_type:'charge',currency:'gbp',status:'paid',amount_requested_minor:599,amount_paid_minor:599,paid_at:'2026-10-02'};
 await insert('billing_invoice_payments',allocation);
 // Same object IDs in another account/mode must never contaminate this scope.
 await insert('billing_finance_subscriptions',{...sub,stripe_scope:'acct_v1:live'});
 await insert('billing_invoices',{...inv,stripe_scope:'acct_v1:live'});
 await db.query('BEGIN READ ONLY');
 await db.query('SET LOCAL ROLE service_role');
 assert.equal((await report()).items.length,1);
 await db.query('ROLLBACK');
 await db.query('SET ROLE service_role');
 let r=await report();assert.equal(r.items.length,1);assert.equal(r.months[0].gross,'599');assert.equal(r.months[0].vat,'100');assert.equal(r.months[0].net,'499');
 assert.equal((await report('new_customers')).items[0].id,'in_vone');
 assert.equal((await report('upcoming')).items[0].status,'upcoming');
 assert.equal((await report('invoices',oct,null,25,'acct_v1:live')).items.length,1);assert.equal((await report('invoices',oct,null,25,'acct_other:test')).items.length,0);
 await db.query('RESET ROLE');
 await insert('billing_invoices',{...inv,stripe_object_id:'in_vtwo',stripe_created_at:'2026-11-02',finalized_at:'2026-11-02',paid_at:'2026-11-02'});
 await insert('billing_invoice_payments',{...allocation,stripe_object_id:'inpay_vtwo',stripe_invoice_id:'in_vtwo'});
 assert.equal((await report('new_customers',nov)).items.length,0);assert.equal((await report('invoices',nov)).items.length,1);
 // Multiple records: filtering before bounded deterministic pagination.
 await insert('billing_invoices',{...inv,stripe_object_id:'in_vthree'});
 r=await report('invoices',oct,null,1);assert.equal(r.items.length,1);assert.ok(r.nextAfter);const next=await report('invoices',oct,r.nextAfter,1);assert.equal(next.items.length,1);assert.notEqual(r.items[0].id,next.items[0].id);assert.equal(next.nextAfter,null);
 // Unknown never contributes numeric VAT/net; verified zero remains zero.
 await db.query("UPDATE billing_invoices SET tax_minor=NULL,tax_evidence=DEFAULT WHERE stripe_scope=$1 AND stripe_object_id='in_vthree'",[scope]);
 r=await report();assert.equal(r.months[0].vat,null);assert.equal(r.months[0].net,null);assert.equal(r.months[0].gross,'1198');
 const zero={...tax,taxMinor:'0',vatMinor:'0',netMinor:'599',breakdown:[]};
 await db.query("UPDATE billing_invoices SET tax_minor=0,tax_evidence=$2 WHERE stripe_scope=$1 AND stripe_object_id='in_vthree'",[scope,zero]);
 assert.equal((await report()).months[0].vat,'100');
 await db.query("UPDATE billing_finance_subscriptions SET cancel_at_period_end=true WHERE stripe_scope=$1",[scope]);
 assert.equal((await report('upcoming')).items[0].status,'cancelling');assert.equal((await report('cancelled')).items.length,0);
 await db.query("UPDATE billing_finance_subscriptions SET status='canceled',ended_at='2026-10-10' WHERE stripe_scope=$1",[scope]);
 assert.equal((await report('upcoming')).items.length,0);assert.equal((await report('cancelled')).items.length,1);assert.equal((await report()).items.length,2);
 // Recovery population is current; old failed attempts alone do not qualify.
 await insert('billing_payments',{...payment,stripe_object_id:'ch_vfailed',status:'failed',paid:false,captured:false,amount_captured_minor:0,collected_at:null,collection_time_basis:'unknown'});
 await insert('billing_payment_attempts',{stripe_scope:scope,attempt_key:'charge:ch_vfailed',stripe_customer_id:'cus_vone',stripe_invoice_id:'in_vone',stripe_charge_id:'ch_vfailed',currency:'gbp',amount_minor:599,occurred_at:'2026-10-02',evidence_type:'failed_charge',stripe_api_version:'fixture',normalizer_version:2,verified_at:'2026-10-03'});
 assert.equal((await report('failed')).items.length,0);
 await db.query("UPDATE billing_finance_subscriptions SET status='past_due',ended_at=NULL WHERE stripe_scope=$1",[scope]);assert.equal((await report('failed')).items.length,1);
 await db.query("UPDATE billing_finance_subscriptions SET status='active',cancel_at_period_end=false WHERE stripe_scope=$1",[scope]);assert.equal((await report('failed')).items.length,0);
 const refund={...base,stripe_object_id:'re_vone',stripe_charge_id:'ch_vone',currency:'gbp',amount_minor:100,status:'pending',success_time_basis:'unknown'};
 await insert('billing_refunds',refund);assert.equal((await report('refunds')).items.length,0);
 await db.query("UPDATE billing_refunds SET status='succeeded',succeeded_at='2026-10-04',success_time_basis='verified_event' WHERE stripe_scope=$1",[scope]);r=await report('refunds');assert.equal(r.items.length,1);assert.equal(r.items[0].vat,undefined);
 const year=Array.from({length:12},(_,i)=>{const month=i+1;return {label:`2026-${String(month).padStart(2,'0')}`,start_at:`2026-${String(month).padStart(2,'0')}-01`,end_at:month===12?'2027-01-01':`2026-${String(month+1).padStart(2,'0')}-01`};});
 assert.equal((await report('invoices',year)).months.length,12);
 assert.equal(await report('invoices',oct,null,51),null);
 console.log('PASS V1 PostgreSQL: invoker/grants, scoped reads, observed first before period, renewal exclusion, paid invoice retained, exact tax/unknown/zero, bounded pages, cancelling/ended/recovery distinctions, succeeded refunds, yearly rows.');
}
