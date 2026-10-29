// Disposable PostgreSQL 17 Unix socket only. No hosted URLs or environment credentials.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const [bin,driver]=process.argv.slice(2);
if(!bin||!driver||!path.isAbsolute(bin)||!path.isAbsolute(driver))throw Error('Explicit local binary/driver paths required');
const {Client}=createRequire(import.meta.url)(driver);
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'dmi-v2-ownership-')),data=path.join(temp,'data'),socket=path.join(temp,'socket');
await fs.mkdir(socket);
const run=(file,args)=>new Promise((resolve,reject)=>{const p=spawn(file,args,{stdio:['ignore','pipe','pipe']});let text='';p.stdout.on('data',b=>text+=b);p.stderr.on('data',b=>text+=b);p.on('error',reject);p.on('exit',n=>n?reject(Error(text)):resolve());});
let server,db,operator,passed=0;
const test=async(name,fn)=>{await fn();passed++;console.log('PASS '+name);};
const file='supabase/migrations/20261027000100_billing_v2_shadow_schema.sql';
const old=execFileSync('git',['show','ea2950724b965a2199eb4127e298fcd295230a7f:'+file],{encoding:'utf8'});
assert.equal(createHash('sha256').update(old).digest('hex'),'081620bcf9cdd8481c24232805db633bcf50ee3295be66add117535727b9ff73');
const previous=execFileSync('git',['show','0fca999c5ce6fe54aebacf72a14b76f184983e08:'+file],{encoding:'utf8'});
assert.equal(createHash('sha256').update(previous).digest('hex'),'a518ef3c658f599f6afed6c66bd6f8b251c55ead166af4f75a77672bc340391d');
const sql=await fs.readFile(file,'utf8');
const query=async(text,client=db)=>(await client.query(text)).rows;
const absent=async()=>assert.equal((await query("SELECT count(*)::int n FROM pg_roles WHERE rolname LIKE 'billing_v2_%'"))[0].n,0);
async function fails(text,code,reason){await assert.rejects(operator.query(text),e=>e.code===code&&(!reason||e.message.includes(reason)));await operator.query('ROLLBACK');await absent();}
try{
 await run(path.join(bin,'initdb'),['-D',data,'--no-locale','-E','UTF8','-U','supabase_admin','--auth=trust']);
 server=spawn(path.join(bin,'postgres'),['-D',data,'-k',socket,'-h','','-p','5432'],{stdio:['ignore','ignore','ignore']});
 for(let n=0;n<100;n++){const c=new Client({host:socket,user:'supabase_admin',database:'postgres'});try{await c.connect();db=c;break;}catch{await c.end();await new Promise(r=>setTimeout(r,50));}}
 if(!db)throw Error('Local PostgreSQL did not start');
 assert.equal((await query('SHOW server_version_num'))[0].server_version_num.slice(0,2),'17');
 await query("CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE ROLE authenticator LOGIN;CREATE ROLE app_login LOGIN;CREATE ROLE postgres LOGIN CREATEROLE NOINHERIT NOSUPERUSER NOCREATEDB NOREPLICATION NOBYPASSRLS;GRANT CONNECT,CREATE ON DATABASE postgres TO postgres;CREATE TABLE public.legacy_sentinel(value text);INSERT INTO public.legacy_sentinel VALUES('unchanged');REVOKE ALL ON public.legacy_sentinel FROM PUBLIC");
 operator=new Client({host:socket,user:'postgres',database:'postgres'});await operator.connect();
 await test('restricted operator has no superuser, BYPASSRLS, inherited roles or self-grant setting',async()=>{assert.deepEqual((await query("SELECT rolsuper,rolbypassrls,rolinherit,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname='postgres'"))[0],{rolsuper:false,rolbypassrls:false,rolinherit:false,rolcreatedb:false,rolcreaterole:true});assert.equal((await query('SHOW createrole_self_grant',operator))[0].createrole_self_grant,'');});
 await test('old exact committed bytes fail 42501 and roll back all V2 roles/schema',async()=>{await assert.rejects(operator.query(old),e=>{assert.equal(e.code,'42501');assert.match(e.message,/must be able to SET ROLE/);console.log('OLD_MIGRATION SQLSTATE=42501 '+e.message);return true;});await operator.query('ROLLBACK');await absent();});
 await test('retaining temporary SET/INHERIT capability fails and rolls back',()=>fails(sql.replace('REVOKE billing_v2_owner FROM CURRENT_USER;','-- missing revoke'),'42501','V2_INSTALLER_MEMBERSHIP'));
 await test('extra runtime owner membership fails and rolls back',()=>fails(sql.replace('REVOKE billing_v2_owner FROM CURRENT_USER;','GRANT billing_v2_owner TO app_login WITH SET TRUE;\nREVOKE billing_v2_owner FROM CURRENT_USER;'),'42501','V2_INSTALLER_MEMBERSHIP'));
 await test('executor membership in owner fails and rolls back',()=>fails(sql.replace('REVOKE billing_v2_owner FROM CURRENT_USER;','GRANT billing_v2_owner TO billing_v2_executor WITH SET FALSE, INHERIT FALSE;\nREVOKE billing_v2_owner FROM CURRENT_USER;'),'42501','V2_INSTALLER_MEMBERSHIP'));
 await test('runtime membership in executor fails and rolls back',()=>fails(sql.replace('REVOKE billing_v2_owner FROM CURRENT_USER;','GRANT billing_v2_executor TO service_role WITH SET FALSE, INHERIT FALSE;\nREVOKE billing_v2_owner FROM CURRENT_USER;'),'42501','V2_INSTALLER_MEMBERSHIP'));
 await test('indirect application membership through installer fails',async()=>{await query('GRANT postgres TO app_login WITH INHERIT FALSE, SET FALSE');await fails(sql,'42501','V2_RUNTIME_MEMBERSHIP');await query('REVOKE postgres FROM app_login');});
 await test('unexpected installer default table ACL fails closed',()=>fails(sql.replace('BEGIN;','BEGIN;\nALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO app_login;'),'42501','V2_UNEXPECTED_ACL'));
 await query('CREATE ROLE cli_login_postgres LOGIN NOINHERIT;GRANT postgres TO cli_login_postgres WITH ADMIN FALSE, INHERIT FALSE, SET TRUE');
 const topology=()=>query("SELECT p.rolname granted_role,r.rolname member_role,g.rolname grantor,m.admin_option,m.inherit_option,m.set_option,r.rolcanlogin,r.rolsuper,r.rolcreaterole,r.rolbypassrls FROM pg_auth_members m JOIN pg_roles p ON p.oid=m.roleid JOIN pg_roles r ON r.oid=m.member JOIN pg_roles g ON g.oid=m.grantor WHERE m.roleid='postgres'::regrole");
 const expectedTopology=[{granted_role:'postgres',member_role:'cli_login_postgres',grantor:'supabase_admin',admin_option:false,inherit_option:false,set_option:true,rolcanlogin:true,rolsuper:false,rolcreaterole:false,rolbypassrls:false}];
 await test('exact operator-collected hosted topology is reproduced',async()=>assert.deepEqual(await topology(),expectedTopology));
 await test('previous exact migration rejects the verified hosted topology',()=>fails(previous,'42501','V2_RUNTIME_MEMBERSHIP'));
 for(const role of ['anon','authenticated','service_role','authenticator','app_login']){
  await test(role+' cannot enter through the trusted CLI principal',async()=>{await query('GRANT cli_login_postgres TO '+role+' WITH ADMIN FALSE, INHERIT FALSE, SET TRUE');await fails(sql,'42501','V2_RUNTIME_MEMBERSHIP');await query('REVOKE cli_login_postgres FROM '+role);});
 }
 for(const role of ['anon','authenticated','service_role','authenticator','app_login']){
  await test(role+' cannot enter the installer directly',async()=>{await query('GRANT postgres TO '+role+' WITH ADMIN FALSE, INHERIT FALSE, SET TRUE');await fails(sql,'42501','V2_RUNTIME_MEMBERSHIP');await query('REVOKE postgres FROM '+role);});
 }
 await test('multi-hop application path through CLI is rejected',async()=>{await query('CREATE ROLE runtime_bridge NOLOGIN;GRANT cli_login_postgres TO runtime_bridge WITH SET TRUE;GRANT runtime_bridge TO app_login WITH SET TRUE');await fails(sql,'42501','V2_RUNTIME_MEMBERSHIP');await query('REVOKE runtime_bridge FROM app_login;REVOKE cli_login_postgres FROM runtime_bridge');});
 await test('CLI name alone is insufficient: wrong membership flags fail',async()=>{await query('GRANT postgres TO cli_login_postgres WITH INHERIT TRUE');await fails(sql,'42501','V2_RUNTIME_MEMBERSHIP');await query('GRANT postgres TO cli_login_postgres WITH INHERIT FALSE');});
 await test('additional unverified administrative grantor path fails',async()=>{await query('CREATE ROLE other_admin NOLOGIN;GRANT postgres TO other_admin WITH ADMIN TRUE, INHERIT FALSE, SET FALSE;GRANT postgres TO cli_login_postgres WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY other_admin');await fails(sql,'42501','V2_RUNTIME_MEMBERSHIP');await query('REVOKE postgres FROM cli_login_postgres GRANTED BY other_admin;REVOKE postgres FROM other_admin');});
 await test('arbitrary cli-prefixed login is not exempted',async()=>{await query('CREATE ROLE cli_other LOGIN;GRANT postgres TO cli_other WITH ADMIN FALSE, INHERIT FALSE, SET TRUE');await fails(sql,'42501','V2_RUNTIME_MEMBERSHIP');await query('REVOKE postgres FROM cli_other');});
 await test('privileged CLI principal differs from the verified evidence and fails',async()=>{await query('ALTER ROLE cli_login_postgres CREATEROLE');await fails(sql,'42501','V2_RUNTIME_MEMBERSHIP');await query('ALTER ROLE cli_login_postgres NOCREATEROLE');});
 await test('corrected exact file accepts verified hosted topology with restricted operator',()=>operator.query(sql));
 await test('verified hosted administrative relationship is unchanged',async()=>assert.deepEqual(await topology(),expectedTopology));
 await test('trusted CLI can assume installer but has no direct V2 role capability',async()=>{const r=(await query("SELECT pg_has_role('cli_login_postgres','postgres','SET') installer_set,pg_has_role('cli_login_postgres','postgres','USAGE') installer_inherit,pg_has_role('cli_login_postgres','billing_v2_owner','SET') owner_set,pg_has_role('cli_login_postgres','billing_v2_owner','USAGE') owner_inherit,pg_has_role('cli_login_postgres','billing_v2_executor','SET') executor_set"))[0];assert.deepEqual(r,{installer_set:true,installer_inherit:false,owner_set:false,owner_inherit:false,executor_set:false});});
 await test('only original bootstrap ADMIN memberships remain; SET/INHERIT false',async()=>{const rows=await query("SELECT r.rolname,m.admin_option,m.inherit_option,m.set_option,g.rolname grantor FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid JOIN pg_roles g ON g.oid=m.grantor WHERE r.rolname LIKE 'billing_v2_%' ORDER BY r.rolname");assert.deepEqual(rows,['billing_v2_executor','billing_v2_owner'].map(rolname=>({rolname,admin_option:true,inherit_option:false,set_option:false,grantor:'supabase_admin'})));});
 await test('installer cannot SET ROLE or directly use V2 objects after COMMIT',async()=>{for(const stmt of ['SET ROLE billing_v2_owner','SET ROLE billing_v2_executor','SELECT * FROM billing_v2.accounts'])await assert.rejects(operator.query(stmt),e=>e.code==='42501');});
 await test('ADMIN remains administrative control: deliberate regrant works but is rolled back',async()=>{await operator.query('BEGIN');await operator.query('GRANT billing_v2_owner TO CURRENT_USER WITH SET TRUE, INHERIT FALSE');await operator.query('SET LOCAL ROLE billing_v2_owner');assert.equal((await query('SELECT current_user',operator))[0].current_user,'billing_v2_owner');await operator.query('ROLLBACK');await assert.rejects(operator.query('SET ROLE billing_v2_owner'),e=>e.code==='42501');});
 await test('two nonprivileged NOLOGIN roles and no seed role',async()=>{const rows=await query("SELECT rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname LIKE 'billing_v2_%'");assert.equal(rows.length,2);for(const r of rows)assert.ok(Object.values(r).every(x=>x===false));});
 await test('owner owns schema, all tables/indexes, functions and identity sequence',async()=>{assert.equal((await query("SELECT count(*)::int n FROM (SELECT nspowner owner FROM pg_namespace WHERE nspname='billing_v2' UNION ALL SELECT relowner FROM pg_class WHERE relnamespace='billing_v2'::regnamespace UNION ALL SELECT proowner FROM pg_proc WHERE pronamespace='billing_v2'::regnamespace) o WHERE owner<>'billing_v2_owner'::regrole"))[0].n,0);});
 await test('15 tables, 3 functions, 15 policies, one sequence and zero user triggers',async()=>{assert.deepEqual((await query("SELECT (SELECT count(*)::int FROM pg_tables WHERE schemaname='billing_v2') tables,(SELECT count(*)::int FROM pg_proc WHERE pronamespace='billing_v2'::regnamespace) functions,(SELECT count(*)::int FROM pg_policies WHERE schemaname='billing_v2') policies,(SELECT count(*)::int FROM pg_sequences WHERE schemaname='billing_v2') sequences,(SELECT count(*)::int FROM pg_trigger WHERE tgrelid IN (SELECT oid FROM pg_class WHERE relnamespace='billing_v2'::regnamespace) AND NOT tgisinternal) triggers"))[0],{tables:15,functions:3,policies:15,sequences:1,triggers:0});});
 await test('all tables forced RLS and empty; no execution gate/task/authority published',async()=>{const tables=await query("SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relnamespace='billing_v2'::regnamespace AND relkind='r'");for(const t of tables){assert.ok(t.relrowsecurity&&t.relforcerowsecurity);assert.equal((await query('SELECT count(*)::int n FROM billing_v2.'+t.relname))[0].n,0);}});
 await test('PUBLIC and application roles have no effective V2 schema/table/function/sequence privileges',async()=>{for(const role of ['anon','authenticated','service_role','authenticator','app_login','billing_v2_executor']){const r=(await db.query("SELECT has_schema_privilege($1,'billing_v2','USAGE') OR has_schema_privilege($1,'billing_v2','CREATE') bad UNION ALL SELECT has_table_privilege($1,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') FROM pg_class c WHERE relnamespace='billing_v2'::regnamespace AND relkind='r' UNION ALL SELECT has_function_privilege($1,p.oid,'EXECUTE') FROM pg_proc p WHERE pronamespace='billing_v2'::regnamespace UNION ALL SELECT has_sequence_privilege($1,c.oid,'USAGE,SELECT,UPDATE') FROM pg_class c WHERE relnamespace='billing_v2'::regnamespace AND relkind='S'",[role])).rows;assert.ok(r.every(x=>!x.bad),role);}});
 await test('V1 sentinel unchanged and no execution/seed/provider entry points added',async()=>{assert.equal((await query('SELECT value FROM public.legacy_sentinel'))[0].value,'unchanged');assert.doesNotMatch(sql,/INSERT INTO|UPDATE public\.|DELETE FROM|CREATE EXTENSION|http_request|net\.http/i);});
 console.log(`Hosted ownership PostgreSQL ${passed}/${passed}`);
}finally{
 await operator?.end();await db?.end();
 if(server){await run(path.join(bin,'pg_ctl'),['-D',data,'-m','immediate','-w','stop']).catch(()=>{});}
 await fs.rm(temp,{recursive:true,force:true});
}
