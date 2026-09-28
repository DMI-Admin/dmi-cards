// Disposable local PostgreSQL ONLY. No DATABASE_URL or hosted connection accepted.
// Usage: node scripts/validate-stripe-reliability-postgres.mjs <native-bin-dir> <absolute-pg-module>
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const [bin,pgModule]=process.argv.slice(2);
if(!bin||!pgModule||!path.isAbsolute(bin)||!path.isAbsolute(pgModule))throw Error('Supply local PostgreSQL binary directory and absolute pg module path. No connection URL is accepted.');
const {Client}=createRequire(import.meta.url)(pgModule);
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'dmi-stripe-pg-'));
const data=path.join(temp,'data'),socket=path.join(temp,'socket');await fs.mkdir(socket);
function execute(file,args){return new Promise((resolve,reject)=>{const child=spawn(file,args,{stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error(output)));});}
let server,client,second;
try{
 await execute(path.join(bin,'initdb'),['-D',data,'--no-locale','-E','UTF8','-U','fixture','--auth=trust']);
 server=spawn(path.join(bin,'postgres'),['-D',data,'-k',socket,'-h','','-p','5432'],{stdio:['ignore','pipe','pipe']});
 let logs='';server.stderr.on('data',b=>logs+=b);server.stdout.resume();
 const config={host:socket,port:5432,user:'fixture',database:'postgres',connectionTimeoutMillis:1000};
 for(let n=0;n<100;n++){
  const candidate=new Client(config);try{await candidate.connect();client=candidate;break;}catch{await candidate.end().catch(()=>{});await new Promise(resolve=>setTimeout(resolve,100));}
 }
 if(!client)throw Error('Local PostgreSQL failed to start: '+logs);
 second=new Client(config);await second.connect();
 await client.query(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY); CREATE TABLE public.profiles(id uuid PRIMARY KEY REFERENCES auth.users(id)); CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; GRANT USAGE ON SCHEMA auth TO authenticated;`);
 for(const migration of ['20260807143000_create_stripe_billing_state.sql','20260810100000_update_billing_plan_constraint.sql'])await client.query(await fs.readFile(path.join('supabase/migrations',migration),'utf8'));
 const foundation=await fs.readFile('supabase/migrations/20260927010000_stripe_reliability_foundation.sql','utf8');
 // Actual staging baseline: only the existing 14-column subscription table.
 await client.query('DROP TABLE stripe_webhook_events; GRANT SELECT ON billing_subscriptions TO authenticated');
 const subscriptionAclBefore=(await client.query("SELECT relacl FROM pg_class WHERE oid='billing_subscriptions'::regclass")).rows;
 const policyBefore=(await client.query("SELECT polname,polcmd,polroles,pg_get_expr(polqual,polrelid) AS qual FROM pg_policy WHERE polrelid='billing_subscriptions'::regclass")).rows;
 assert.equal((await client.query("SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema='public' AND table_name='billing_subscriptions'")).rows[0].n,14);
 await client.query(foundation);
 for(const table of ['stripe_webhook_events','billing_accounts','billing_approved_prices','billing_sync_runs'])assert.equal((await client.query('SELECT count(*)::int AS n FROM '+table)).rows[0].n,0);
 await client.query(foundation); // Identical migration is safe to reapply.
 assert.deepEqual((await client.query("SELECT polname,polcmd,polroles,pg_get_expr(polqual,polrelid) AS qual FROM pg_policy WHERE polrelid='billing_subscriptions'::regclass")).rows,policyBefore);
 assert.deepEqual((await client.query("SELECT relacl FROM pg_class WHERE oid='billing_subscriptions'::regclass")).rows,subscriptionAclBefore);
 // Matching partial addition is completed, and residual column ACLs removed.
 await client.query('ALTER TABLE billing_subscriptions DROP COLUMN verified_at; GRANT SELECT(stripe_event_id),UPDATE(event_type) ON stripe_webhook_events TO authenticated');
 await client.query(foundation);
 assert.equal((await client.query("SELECT has_column_privilege('authenticated','stripe_webhook_events','stripe_event_id','SELECT') AS allowed")).rows[0].allowed,false);
 const rejectDrift=async(setup,restore)=>{await client.query(setup);await assert.rejects(client.query(foundation),/BILLING_SCHEMA_DRIFT/);await client.query('ROLLBACK');await client.query(restore);};
 await rejectDrift('ALTER TABLE billing_subscriptions ALTER COLUMN revision TYPE text USING revision::text','ALTER TABLE billing_subscriptions ALTER COLUMN revision TYPE bigint USING revision::bigint; ALTER TABLE billing_subscriptions ALTER COLUMN revision SET DEFAULT 0');
 await rejectDrift('ALTER TABLE billing_accounts ALTER COLUMN generation SET DEFAULT 99','ALTER TABLE billing_accounts ALTER COLUMN generation SET DEFAULT 0');
 await rejectDrift("ALTER TABLE billing_approved_prices ADD CONSTRAINT drift CHECK(checkout_enabled=false)",'ALTER TABLE billing_approved_prices DROP CONSTRAINT drift');
 await rejectDrift("CREATE POLICY drift ON billing_accounts FOR SELECT TO authenticated USING(true)",'DROP POLICY drift ON billing_accounts');
 await rejectDrift('ALTER FUNCTION billing_foundation_command(text,text,uuid,uuid,jsonb) SECURITY INVOKER','ALTER FUNCTION billing_foundation_command(text,text,uuid,uuid,jsonb) SECURITY DEFINER');
 await rejectDrift('ALTER TABLE billing_sync_runs DROP COLUMN outcome','ALTER TABLE billing_sync_runs ADD COLUMN outcome text NOT NULL');
 await rejectDrift("ALTER TABLE billing_subscriptions ADD CONSTRAINT drift CHECK(dmi_plan='free')",'ALTER TABLE billing_subscriptions DROP CONSTRAINT drift');
 await rejectDrift('DROP INDEX billing_subscriptions_subscription_id_unique_idx','CREATE UNIQUE INDEX billing_subscriptions_subscription_id_unique_idx ON billing_subscriptions(stripe_subscription_id)');
 await client.query('CREATE ROLE inherited_browser; GRANT inherited_browser TO authenticated');
 await rejectDrift('GRANT SELECT ON billing_accounts TO inherited_browser','REVOKE SELECT ON billing_accounts FROM inherited_browser');
 await client.query('REVOKE inherited_browser FROM authenticated; DROP ROLE inherited_browser');
 // A pre-existing historical webhook table is also supported; never rewrite
 // foundation event diagnostics on subsequent application.
 await client.query(`DROP TABLE stripe_webhook_events; CREATE TABLE stripe_webhook_events(stripe_event_id text PRIMARY KEY,event_type text NOT NULL,processed_at timestamptz,created_at timestamptz NOT NULL DEFAULT now()); INSERT INTO stripe_webhook_events VALUES('evt_legacy_done','x',now(),now()),('evt_legacy_pending','x',NULL,now())`);
 await client.query(foundation);
 assert.equal((await client.query("SELECT state FROM stripe_webhook_events WHERE stripe_event_id='evt_legacy_done'")).rows[0].state,'processed');
 assert.equal((await client.query("SELECT state FROM stripe_webhook_events WHERE stripe_event_id='evt_legacy_pending'")).rows[0].state,'received');
 await client.query("UPDATE stripe_webhook_events SET outcome='preserve_me' WHERE stripe_event_id='evt_legacy_done'");
 await client.query(foundation);
 assert.equal((await client.query("SELECT outcome FROM stripe_webhook_events WHERE stripe_event_id='evt_legacy_done'")).rows[0].outcome,'preserve_me');
 console.log('PASS: subscription-only staging baseline, matching reapplication/partial columns, legacy webhook baseline, no seeds, unchanged owner policy, column ACL hardening, incompatible column/default/constraint/policy/RPC rejection.');
 const user='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',scope='acct_fixture:test';
 await client.query('INSERT INTO auth.users VALUES($1),($2)',[user,other]);await client.query('INSERT INTO profiles VALUES($1),($2)',[user,other]);
 await client.query(`INSERT INTO billing_approved_prices(stripe_scope,stripe_price_id,approved_by,approval_reason,checkout_enabled) VALUES($1,'price_pro','local-fixture','local-test-only',true)`,[scope]);
 const rpc=async(connection,action,u=null,token=null,input={})=>(await connection.query('SELECT public.billing_foundation_command($1,$2,$3,$4,$5) AS result',[action,scope,u,token,input])).rows[0].result;
 let first=await rpc(client,'event_claim',null,null,{id:'evt_retry',type:'customer.subscription.updated',created:100});
 await rpc(client,'event_fail',null,first.token,{id:'evt_retry',error:'TEST_FAILURE',outcome:'retryable_failure'});
 let claim=await rpc(client,'event_claim',null,null,{id:'evt_retry',type:'customer.subscription.updated',created:100});
 assert.notEqual(first.token,claim.token);
 const account=await rpc(client,'claim',user);
 await rpc(client,'bind',user,account.lease_token,{customer:'cus_owned'});
 const snapshot={subscription_id:'sub_owned',customer_id:'cus_owned',status:'active',price_id:'price_pro',plan:'pro',period_start:null,period_end:null,trial_end:null,ended_at:null,cancel_at_period_end:false,invoice_id:null,terminal:false};
 const payload={snapshot,expected_revision:0,event_id:'evt_retry',event_created:100,event_token:claim.token};
 // A failed transaction cannot mark an event processed or change the mirror.
 await assert.rejects(rpc(client,'commit',user,account.lease_token,{...payload,expected_revision:99}),/BILLING_REVISION/);
 assert.equal((await client.query("SELECT state FROM stripe_webhook_events WHERE stripe_event_id='evt_retry'")).rows[0].state,'processing');
 assert.equal((await client.query('SELECT count(*)::int AS n FROM billing_subscriptions')).rows[0].n,0);
 let result=await rpc(client,'commit',user,account.lease_token,payload);assert.equal(result.outcome,'repaired');assert.equal(result.revision,1);
 assert.equal((await rpc(client,'event_claim',null,null,{id:'evt_retry',type:'customer.subscription.updated',created:100})).duplicate,true);
 result=await rpc(client,'commit',user,account.lease_token,{snapshot,expected_revision:1});assert.equal(result.outcome,'unchanged');assert.equal(result.revision,1);
 // Force failure AFTER mirror insert, during event completion, to verify atomic rollback.
 await client.query(`CREATE FUNCTION fail_atomic_test() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.stripe_event_id='evt_atomic' AND NEW.state='processed' THEN RAISE EXCEPTION 'TEST_COMPLETION_FAILURE'; END IF; RETURN NEW; END$$; CREATE TRIGGER fail_atomic_test BEFORE UPDATE ON stripe_webhook_events FOR EACH ROW EXECUTE FUNCTION fail_atomic_test();`);
 const atomic=await rpc(client,'event_claim',null,null,{id:'evt_atomic',type:'x',created:100});
 const atomicInput={snapshot:{...snapshot,subscription_id:'sub_atomic'},expected_revision:0,event_id:'evt_atomic',event_created:100,event_token:atomic.token};
 await assert.rejects(rpc(client,'commit',user,account.lease_token,atomicInput),/TEST_COMPLETION_FAILURE/);
 assert.equal((await client.query("SELECT count(*)::int AS n FROM billing_subscriptions WHERE stripe_subscription_id='sub_atomic'")).rows[0].n,0);
 assert.equal((await client.query("SELECT state FROM stripe_webhook_events WHERE stripe_event_id='evt_atomic'")).rows[0].state,'processing');
 await client.query('DROP TRIGGER fail_atomic_test ON stripe_webhook_events; DROP FUNCTION fail_atomic_test()');
 await rpc(client,'event_fail',null,atomic.token,{id:'evt_atomic',outcome:'retryable_failure'});
 const retryAtomic=await rpc(client,'event_claim',null,null,{id:'evt_atomic',type:'x',created:100});
 assert.equal((await rpc(client,'commit',user,account.lease_token,{...atomicInput,event_token:retryAtomic.token})).outcome,'repaired');
 const old=await rpc(client,'event_claim',null,null,{id:'evt_old',type:'customer.subscription.updated',created:99});
 result=await rpc(client,'commit',user,account.lease_token,{snapshot:{...snapshot,status:'past_due',plan:'free'},expected_revision:1,event_id:'evt_old',event_created:99,event_token:old.token});assert.equal(result.outcome,'stale_ignored');assert.equal(result.revision,1);
 const same=await rpc(client,'event_claim',null,null,{id:'evt_same',type:'customer.subscription.updated',created:100});
 result=await rpc(client,'commit',user,account.lease_token,{snapshot:{...snapshot,cancel_at_period_end:true},expected_revision:1,event_id:'evt_same',event_created:100,event_token:same.token});assert.equal(result.revision,2);
 result=await rpc(client,'commit',user,account.lease_token,{snapshot:{...snapshot,status:'canceled',plan:'free',terminal:true},expected_revision:2});assert.equal(result.revision,3);
 result=await rpc(client,'commit',user,account.lease_token,{snapshot,expected_revision:3});assert.equal(result.outcome,'terminal_ignored');
 await rpc(client,'release',user,account.lease_token);
 // Separate database connections contend on the same real row lock.
 await client.query('BEGIN');const held=await rpc(client,'claim',user);
 let settled=false;const competing=rpc(second,'claim',user).then(()=>{settled=true;throw Error('must not acquire live lease');},error=>{settled=true;assert.match(error.message,/BILLING_BUSY/);});
 await new Promise(resolve=>setTimeout(resolve,100));assert.equal(settled,false);await client.query('COMMIT');await competing;
 await client.query("UPDATE billing_accounts SET lease_until=clock_timestamp()-interval '1 second' WHERE user_id=$1",[user]);const newer=await rpc(second,'claim',user);
 await assert.rejects(rpc(client,'commit',user,held.lease_token,{snapshot,expected_revision:3}),/BILLING_FENCE/);
 await rpc(second,'release',user,newer.lease_token);
 // Identical event delivery races; only one worker receives a processing token.
 await client.query('BEGIN');await rpc(client,'event_claim',null,null,{id:'evt_concurrent',type:'x',created:1});
 const duplicate=rpc(second,'event_claim',null,null,{id:'evt_concurrent',type:'x',created:1});const rejected=assert.rejects(duplicate,/BILLING_BUSY/);await client.query('COMMIT');await rejected;
 const expired=await rpc(client,'event_claim',null,null,{id:'evt_expired',type:'x',created:1});await client.query("UPDATE stripe_webhook_events SET lease_until=clock_timestamp()-interval '1 second' WHERE stripe_event_id='evt_expired'");
 const recovered=await rpc(second,'event_claim',null,null,{id:'evt_expired',type:'x',created:1});await assert.rejects(rpc(client,'event_finish',null,expired.token,{id:'evt_expired'}),/BILLING_FENCE/);await rpc(second,'event_finish',null,recovered.token,{id:'evt_expired',outcome:'ignored'});
 // Ownership uniqueness and approved-price check cannot be bypassed by the writer.
 const foreign=await rpc(client,'claim',other);await assert.rejects(rpc(client,'bind',other,foreign.lease_token,{customer:'cus_owned'}),/BILLING_IDENTITY|unique constraint/);await rpc(client,'bind',other,foreign.lease_token,{customer:'cus_other'});
 await assert.rejects(rpc(client,'commit',other,foreign.lease_token,{snapshot:{...snapshot,subscription_id:'sub_other',customer_id:'cus_other',price_id:'price_unapproved'},expected_revision:0}),/BILLING_UNKNOWN_PRICE/);
 // Runtime privileges: only RPC writes accounts; browser sees only own projection.
 await client.query('GRANT SELECT ON billing_subscriptions TO authenticated');
 await client.query("SET ROLE authenticated");await client.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[user]);
 assert.equal((await client.query('SELECT count(*)::int AS n FROM billing_subscriptions')).rows[0].n,2);
 await assert.rejects(rpc(client,'claim',user),/permission denied/);await assert.rejects(client.query('SELECT * FROM billing_accounts'),/permission denied/);await assert.rejects(client.query('UPDATE billing_subscriptions SET dmi_plan=\'pro\''),/permission denied/);
 await client.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[other]);assert.equal((await client.query('SELECT count(*)::int AS n FROM billing_subscriptions')).rows[0].n,0);
 await client.query('RESET ROLE; SET ROLE anon');
 for(const table of ['stripe_webhook_events','billing_accounts','billing_approved_prices','billing_sync_runs'])await assert.rejects(client.query('SELECT * FROM '+table),/permission denied/);
 await assert.rejects(rpc(client,'claim',user),/permission denied/);
 await client.query('RESET ROLE; SET ROLE service_role');
 const serviceClaim=await rpc(client,'claim',user);await rpc(client,'release',user,serviceClaim.lease_token);
 await assert.rejects(client.query("INSERT INTO stripe_webhook_events(stripe_event_id,event_type) VALUES('evt_bypass','x')"),/permission denied/);
 await assert.rejects(client.query("UPDATE billing_accounts SET stripe_customer_id='injected'"),/permission denied/);await client.query('RESET ROLE');
 const persisted=async()=>{const result={};for(const table of ['billing_subscriptions','stripe_webhook_events','billing_accounts','billing_approved_prices','billing_sync_runs'])result[table]=(await client.query('SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) AS rows FROM '+table+' t')).rows;return result;};
 const persistedBefore=await persisted();await client.query(foundation);assert.deepEqual(await persisted(),persistedBefore);
 await client.query(await fs.readFile('docs/review/stripe-reliability-review.sql','utf8'));
 await client.query(await fs.readFile('docs/review/stripe-reliability-rollback.sql','utf8'));
 await client.query('SET ROLE service_role');await assert.rejects(rpc(client,'claim',user),/permission denied/);await client.query('RESET ROLE');
 assert.equal((await client.query('SELECT count(*)::int AS n FROM billing_subscriptions')).rows[0].n,2);
 console.log('PASS: prepared migration in disposable PostgreSQL; real row-lock concurrency, event retry/duplicate/expiry, atomic mirror+processed commit, revision/stale/same-second/terminal guards, ownership/price guards, RPC-only writes and preserved owner RLS.');
}finally{
 await second?.end().catch(()=>{});await client?.end().catch(()=>{});
 if(server&&server.exitCode===null){await new Promise(resolve=>{server.once('exit',resolve);server.kill('SIGTERM');});}
 await fs.rm(temp,{recursive:true,force:true});
}
