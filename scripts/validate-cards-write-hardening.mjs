// Static/logical by default; optional in-memory PostgreSQL regression below.
// Never connects to Supabase or any external database.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const migration=fs.readFileSync('supabase/migrations/20260922120000_harden_authenticated_cards_writes.sql','utf8');
const rollback=fs.readFileSync('docs/review/cards-write-hardening-rollback-generator.sql','utf8');
assert.match(migration,/begin;[\s\S]*commit;/);
// PostgreSQL treats a bare whole-row alias as ambiguous if it is also a
// PL/pgSQL variable. Check every FROM/JOIN alias in this DO block, not just
// the two policy snapshots that previously raised SQLSTATE 42702.
function assertNoVariableAliasCollision(sql){
 const declaration=sql.match(/\bdeclare\b([\s\S]*?)\bbegin\b/i)?.[1] || '';
 const variables=new Set([...declaration.matchAll(/(?:^|;)\s*([a-z_][a-z0-9_]*)\s+/gim)].map(m=>m[1].toLowerCase()));
 const aliases=[...sql.matchAll(/\b(?:from|join)\s+(?:[a-z_][a-z0-9_]*\.)?[a-z_][a-z0-9_]*\s+(?:as\s+)?([a-z_][a-z0-9_]*)/gi)];
 for(const alias of aliases)assert.ok(!variables.has(alias[1].toLowerCase()),'PL/pgSQL variable/table alias collision: '+alias[1]);
}
assertNoVariableAliasCollision(migration);
const brokenPolicyAlias=migration.replaceAll('policy_row','p');
assert.throws(()=>assertNoVariableAliasCollision(brokenPolicyAlias),/collision: p/);
assert.equal((migration.match(/to_jsonb\(policy_row\)/g)||[]).length,2,'both policy snapshots use an unambiguous whole-row alias');

for(const value of ['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'])assert.ok(migration.includes(`'${value}'`));
for(const guard of ['relrowsecurity','has_table_privilege','has_column_privilege','pg_has_role','MEMBER','rolsuper','rolcreaterole','has_function_privilege','RESTRICT','lock_timeout','UNEXPECTED_ACL_GRANTOR'])assert.ok(migration.includes(guard));
assert.match(migration,/server_version_num[\s\S]*170000/);
assert.match(migration,/attnum>0 and not attisdropped/);
assert.match(migration,/phase in 0\.\.1/,'prerequisites rechecked after revocation');
assert.doesNotMatch(migration,/\b(drop|create|alter)\s+(policy|table|function)|\b(update|delete from|insert into)\s+public\./i);
assert.doesNotMatch(migration,/grant\s+.*\s+to\s+authenticated/i,'SELECT is preserved, not broadened');
assert.match(rollback,/aclexplode\(t\.relacl\)/);assert.match(rollback,/aclexplode\(a\.attacl\)/);
assert.match(rollback,/WITH GRANT OPTION/);assert.match(rollback,/grantor<>t\.relowner/);
// Every direct chained cards mutation must remain in these reviewed server files.
const allowed=new Set(['src/lib/admin-card-mutations-server.ts','src/lib/services/card-write-server.ts','src/app/api/client/cards/[cardId]/route.ts']);
const writes=new Set();
for(const file of fs.readdirSync('src',{recursive:true}).filter(f=>/\.tsx?$/.test(f))){
 const path='src/'+file,source=fs.readFileSync(path,'utf8');
 const tree=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true);
 function visit(node){
  if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&['insert','upsert','update','delete'].includes(node.expression.name.text)){
   const receiver=node.expression.expression.getText(tree);
   if(/\.from\(["']cards["']\)/.test(receiver)){
    assert.ok(allowed.has(path),'Unreviewed direct cards mutation: '+path);
    assert.ok(!/^\s*["']use client["']/.test(source));writes.add(path);
   }
  }
  ts.forEachChild(node,visit);
 }
 visit(tree);
}
assert.equal(writes.size,3);
const browser=fs.readFileSync('src/lib/services/card-service.ts','utf8');
assert.doesNotMatch(browser,/\.(insert|update|delete|upsert)\(/);
assert.match(browser,/\.select\(/);
assert.match(browser,/method: ["']DELETE["']/);
// Conservative failure model includes direct/column/PUBLIC/inherited/switch roles.
function allowedAfterRevoke(roles){return roles.every(r=>!r.owner&&!r.superuser&&!r.createrole&&!r.tableWrite&&!r.columnWrite&&!r.rpcExecute);}
assert.equal(allowedAfterRevoke([{}]),true);
for(const key of ['owner','superuser','createrole','tableWrite','columnWrite','rpcExecute'])assert.equal(allowedAfterRevoke([{}, {[key]:true}]),false);
console.log('PASS: transactional Cards-only revokes, effective table/column/role/RPC guards, ACL-derived rollback; source-wide chained writes confined to reviewed server boundaries. No SQL executed.');

// Optional isolated PostgreSQL execution. Install PGlite outside the application
// tree, then pass --pglite-module /absolute/path/to/pglite/dist/index.js.
// This creates an in-memory test database only; it never connects to Supabase.
const runtimeFlag=process.argv.indexOf('--pglite-module');
if(runtimeFlag!==-1){
 const {pathToFileURL}=await import('node:url');
 const {PGlite}=await import(pathToFileURL(process.argv[runtimeFlag+1]).href);
 const db=new PGlite();
 try{
  await db.exec(`
   create role anon;
   create role authenticated;
   create role service_role bypassrls;
   create table public.cards(id uuid primary key,user_id uuid,full_name text,profile_image_url text,company_logo_url text,custom_fields jsonb);
   alter table public.cards enable row level security;
   create policy own_cards on public.cards for all to authenticated using(user_id=nullif(current_setting('request.jwt.claim.sub',true),'')::uuid);
   create policy published_cards on public.cards for select to anon using(false);
   grant usage on schema public to anon,authenticated,service_role;
   grant select on public.cards to anon;
   grant all on public.cards to authenticated,service_role;
   grant update(full_name),insert(full_name),references(full_name) on public.cards to authenticated;
   create function public.assign_card_slot() returns trigger language plpgsql as $$begin return new;end$$;
  `);
  const signatures=[...new Set([...migration.matchAll(/'(public\.[a-z_]+\([^']*\))'/g)].map(m=>m[1]))].filter(s=>!s.includes('assign_card_slot'));
  // Catalog stand-ins isolate ACL/DO-block behavior. No media behavior is mocked
  // as proof of correctness: those RPC implementations have separate suites.
  for(const signature of signatures)await db.exec(`create function ${signature} returns jsonb language sql as $$select '{}'::jsonb$$;revoke all on function ${signature} from public,anon,authenticated;grant execute on function ${signature} to service_role;`);
  const snapshot=async()=> (await db.query(`select jsonb_build_object(
   'acl',(select relacl::text from pg_class where oid='public.cards'::regclass),
   'columns',(select jsonb_agg(jsonb_build_array(attname,attacl::text) order by attnum) from pg_attribute where attrelid='public.cards'::regclass and attnum>0 and not attisdropped),
   'policies',(select jsonb_agg(to_jsonb(policy_row) order by policy_row.oid) from pg_policy policy_row where polrelid='public.cards'::regclass),
   'functions',(select jsonb_agg(jsonb_build_array(oid::regprocedure::text,pg_get_functiondef(oid),proacl::text) order by oid) from pg_proc where pronamespace='public'::regnamespace),
   'rls',(select relrowsecurity from pg_class where oid='public.cards'::regclass)
  ) as value`)).rows[0].value;
  const before=await snapshot();
  let reproduced=false;
  try{await db.exec(brokenPolicyAlias);}catch(error){assert.equal(error.code,'42702');reproduced=true;}
  assert.ok(reproduced,'original policy alias must reproduce SQLSTATE 42702');
  await db.exec('rollback');
  assert.deepEqual(await snapshot(),before,'failed original migration must roll back completely');
  await db.exec(migration); // Includes the original BEGIN and final COMMIT.
  const after=await snapshot();
  assert.deepEqual(after.policies,before.policies);
  assert.deepEqual(after.functions,before.functions);
  assert.equal(after.rls,true);
  const privilegeRows=(await db.query(`select privilege,has_table_privilege('authenticated','public.cards',privilege) as allowed from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) as privileges(privilege)`)).rows;
  for(const row of privilegeRows)assert.equal(row.allowed,row.privilege==='SELECT');
  assert.equal((await db.query(`select has_any_column_privilege('authenticated','public.cards','INSERT,UPDATE,REFERENCES') as allowed`)).rows[0].allowed,false);
  assert.equal((await db.query(`select has_table_privilege('anon','public.cards','SELECT') as allowed`)).rows[0].allowed,true);
  for(const privilege of ['SELECT','INSERT','UPDATE','DELETE'])assert.equal((await db.query(`select has_table_privilege('service_role','public.cards',$1) as allowed`,[privilege])).rows[0].allowed,true);
  await db.exec(migration);
  assert.deepEqual(await snapshot(),after,'a second committed execution must be idempotent');
  // Use a new transaction to prove the denial survives the migration COMMIT.
  await db.exec('begin;set local role authenticated');
  for(const query of ['insert into public.cards(id) select null::uuid where false','update public.cards set full_name=full_name where false','delete from public.cards where false']){
   await db.exec('savepoint denied_probe');
   let denied=false;try{await db.exec(query);}catch(error){assert.equal(error.code,'42501');denied=true;}
   assert.ok(denied,'direct authenticated mutation must fail');
   await db.exec('rollback to savepoint denied_probe');
  }
  await db.exec('rollback');
  console.log('PASS: isolated PostgreSQL '+(await db.query('show server_version')).rows[0].server_version+'; original 42702 reproduced/rolled back; corrected migration COMMIT and idempotent COMMIT; table/column denial; read/service privileges and policies/RPCs preserved. No Supabase connection.');
 }finally{await db.close();}
}
