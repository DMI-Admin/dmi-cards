import assert from 'node:assert/strict';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {loadStagingSchema, stagingSchema} from './lib/admin-clients-staging-fixture.mjs';
const migration=fs.readFileSync('supabase/migrations/20260924090000_add_admin_clients_prerequisites.sql','utf8');
const rollback=fs.readFileSync('docs/review/admin-clients-prerequisites-rollback.sql','utf8');
const expected={clients:['job_title'],client_users:['website','address','whatsapp','linkedin','instagram','facebook','youtube','booking_link','custom_url'],cards:['client_id']};
assert.match(migration,/on delete restrict/);
assert.doesNotMatch(migration.replace(/--[^\n]*/g,''),/\b(?:grant|revoke|create policy|drop policy|update public\.|insert into public\.|delete from public\.)/i);
assert.match(migration,/010d4e08fb0a67dd5ee0808a7101c8ee/);
for(const [table,fields] of Object.entries(expected))for(const field of fields)assert.ok(!stagingSchema.columns.some(c=>c.table===table&&c.column===field),'fixture must start with the actual missing field: '+table+'.'+field);
const modulePath=process.argv.find(arg=>arg.startsWith('--postgres-module='))?.split('=').slice(1).join('=');
if(!modulePath){console.log('PASS: prerequisite static scope, staging-shaped fixture and guarded rollback. Use --postgres-module for actual SQL execution.');process.exit(0);}
const {PGlite}=await import(pathToFileURL(modulePath).href);
const pg=new PGlite();
const owner='11111111-1111-4111-a111-111111111111';
const card='22222222-2222-4222-a222-222222222222';
const company='33333333-3333-4333-a333-333333333333';
const protectedState=async()=> (await pg.query(`select
 (select jsonb_agg(jsonb_build_object('name',p.proname,'def',pg_get_functiondef(p.oid),'acl',p.proacl::text) order by p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f' and p.proname<>'ensure_client_records_for_profile') functions,
 (select jsonb_agg(jsonb_build_object('table',c.relname,'rls',c.relrowsecurity,'force',c.relforcerowsecurity,'acl',c.relacl::text) order by c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r') tables,
 (select jsonb_agg(to_jsonb(p) order by p.tablename,p.policyname) from pg_policies p where p.schemaname='public') policies,
 (select jsonb_agg(jsonb_build_object('table',c.relname,'column',a.attname,'acl',a.attacl::text) order by c.relname,a.attname) from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and a.attnum>0 and not a.attisdropped and a.attacl is not null) column_grants`)).rows;
const rows=async()=> (await pg.query(`select
 (select jsonb_agg(to_jsonb(c)-'job_title' order by id) from clients c) clients,
 (select jsonb_agg(to_jsonb(s)-array['website','address','whatsapp','linkedin','instagram','facebook','youtube','booking_link','custom_url'] order by id) from client_users s) staff,
 (select jsonb_agg(to_jsonb(c)-'client_id' order by id) from cards c) cards`)).rows;
const expectSqlFailure=async(sql,args)=>{await assert.rejects(pg.query(sql,args));await pg.exec('rollback;');};
try {
 await loadStagingSchema(pg);
 console.log('Engine:',(await pg.query('select version()')).rows[0].version);
 assert.equal((await pg.query("select md5(pg_get_functiondef('ensure_client_records_for_profile(uuid)'::regprocedure)) hash")).rows[0].hash,'010d4e08fb0a67dd5ee0808a7101c8ee');
 const actualColumns=(await pg.query("select c.relname as table,a.attname as column,format_type(a.atttypid,a.atttypmod) as type,a.attnotnull as not_null,pg_get_expr(d.adbin,d.adrelid) as default from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum where n.nspname='public' and c.relkind='r' and a.attnum>0 and not a.attisdropped order by c.relname,a.attnum")).rows;
 assert.deepEqual(actualColumns,stagingSchema.columns);
 await pg.query('insert into auth.users(id,email) values ($1,$2)',[owner,'fixture@example.test']);
 await pg.query("select set_config('test.user',$1,false)",[owner]);
 await pg.exec('select * from ensure_current_client_account();');
 await pg.query("insert into cards(id,user_id,slug,profile_image_url,company_logo_url,custom_fields) values($1,$2,'prerequisite-fixture','https://example.test/profile.webp','https://example.test/logo.webp','{\"company_banner_url\":\"https://example.test/banner.webp\"}')",[card,owner]);
 const beforeRows=await rows(),beforeSecurity=await protectedState();
 const beforeRevision=(await pg.query('select get_client_card_edit_snapshot($1,$2) snapshot',[owner,card])).rows[0].snapshot.revision;
 const beforeAcl=(await pg.query("select proacl::text acl from pg_proc where oid='ensure_client_records_for_profile(uuid)'::regprocedure")).rows[0].acl;
 await pg.exec(migration);
 assert.deepEqual(await rows(),beforeRows,'pre-existing fields/rows/media values untouched');
 assert.deepEqual(await protectedState(),beforeSecurity,'all other functions, table/column grants and RLS/policies unchanged');
 assert.equal((await pg.query("select proacl::text acl from pg_proc where oid='ensure_client_records_for_profile(uuid)'::regprocedure")).rows[0].acl,beforeAcl);
 for(const [table,fields] of Object.entries(expected))for(const field of fields){
  const c=(await pg.query("select is_nullable,column_default,data_type from information_schema.columns where table_schema='public' and table_name=$1 and column_name=$2",[table,field])).rows[0];
  assert.deepEqual(c,{is_nullable:'YES',column_default:null,data_type:field==='client_id'?'uuid':'text'});
  assert.equal((await pg.query(`select count(*)::int n from ${table} where ${field} is not null`)).rows[0].n,0);
 }
 const fk=(await pg.query("select confdeltype,convalidated,confrelid::regclass::text target from pg_constraint where conname='cards_client_id_fkey'")).rows[0];
 assert.deepEqual(fk,{confdeltype:'r',convalidated:true,target:'clients'});
 const snapshot=(await pg.query('select get_client_card_edit_snapshot($1,$2) snapshot',[owner,card])).rows[0].snapshot;
 assert.notEqual(snapshot.revision,beforeRevision,'new NULL key changes full-row revision; old editors must refresh');
 assert.equal(snapshot.card.client_id,null);
 await pg.query("insert into clients(id,full_name,email,account_type) values($1,'Fixture Company','company@example.test','business')",[company]);
 await expectSqlFailure('update cards set client_id=$1 where id=$2',['44444444-4444-4444-a444-444444444444',card]);
 await pg.query('update cards set client_id=$1 where id=$2',[company,card]);
 await expectSqlFailure('delete from clients where id=$1',[company]);
 assert.equal((await pg.query('select user_id,client_id from cards where id=$1',[card])).rows[0].user_id,owner);
 await expectSqlFailure(rollback); // Refuse to drop a populated relationship.
 assert.equal((await pg.query('select client_id from cards where id=$1',[card])).rows[0].client_id,company);
 await pg.query('update cards set client_id=null where id=$1',[card]);
 await pg.query("update clients set job_title='Value to protect' where id=$1",[company]);
 await expectSqlFailure(rollback);
 await pg.query('update clients set job_title=null where id=$1',[company]);
 const beforeRollback=await rows();
 await pg.exec(rollback);
 assert.deepEqual(await rows(),beforeRollback);
 assert.deepEqual(await protectedState(),beforeSecurity);
 assert.equal((await pg.query("select md5(pg_get_functiondef('ensure_client_records_for_profile(uuid)'::regprocedure)) hash")).rows[0].hash,'010d4e08fb0a67dd5ee0808a7101c8ee');
 // Drift guard proves an incompatible definition leaves every column absent.
 await pg.exec("alter function ensure_client_records_for_profile(uuid) set search_path=public,pg_catalog;");
 await expectSqlFailure(migration);
 assert.equal((await pg.query("select count(*)::int n from information_schema.columns where table_schema='public' and table_name='cards' and column_name='client_id'")).rows[0].n,0);
 await pg.exec("alter function ensure_client_records_for_profile(uuid) set search_path=public;");
 await pg.exec(migration);
 await pg.exec(fs.readFileSync('supabase/migrations/20260924100000_admin_clients_foundation.sql','utf8'));
 await expectSqlFailure(rollback); // Cannot remove prerequisite beneath installed foundation.
 for(const accountType of ['individual','business','enterprise']){
  await pg.query("update clients set account_type=$1,subscription_plan='paid',billing_status='overdue' where user_id=$2",[accountType,owner]);
  await pg.exec("update profiles set subscription_plan='paid',plan='paid'; select * from ensure_current_client_account(); select * from ensure_current_client_account();");
  assert.deepEqual((await pg.query('select account_type,subscription_plan,billing_status from clients where user_id=$1',[owner])).rows[0],{account_type:accountType,subscription_plan:'paid',billing_status:'overdue'});
 }
 console.log('PASS: actual 161-column staging schema; prerequisite + original foundation COMMIT; nullable/no-backfill additions; valid restrictive FK; old rows/media/grants/RLS/other functions preserved; revision refresh documented; rollback restoration/data guards/dependency guard; drift rollback; provisioning retention.');
} finally {await pg.close();}
