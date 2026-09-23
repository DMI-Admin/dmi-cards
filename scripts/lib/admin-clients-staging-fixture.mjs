// Reconstruct captured PUBLIC schema only. No staging/customer rows or network access.
import fs from 'node:fs';
export const stagingSchema = JSON.parse(fs.readFileSync(new URL('../fixtures/admin-clients-staging-schema.json', import.meta.url),'utf8'));
const ident = value => '"'+value.replaceAll('"','""')+'"';
const privileges = {r:'SELECT',a:'INSERT',w:'UPDATE',d:'DELETE',D:'TRUNCATE',x:'REFERENCES',t:'TRIGGER',m:'MAINTAIN',X:'EXECUTE'};
function restoreAcl(kind, target, acl) {
  if (acl === null) return '';
  let sql = `revoke all on ${kind} ${target} from public,anon,authenticated,service_role,postgres;`;
  for(const entry of acl.slice(1,-1).split(',')) {
    const match=entry.match(/^([^=]*)=([^/]*)\/(.*)$/);
    if(!match) throw new Error('Unexpected fixture ACL');
    const grantee=match[1] ? ident(match[1]) : 'public';
    for(const privilege of match[2].matchAll(/([rawdxDtXm])(\*)?/g)) {
      sql+=`grant ${privileges[privilege[1]]} on ${kind} ${target} to ${grantee}${privilege[2]?' with grant option':''};`;
    }
  }
  return sql;
}
export async function loadStagingSchema(pg) {
  // Auth is a minimal test adapter. Public table columns/defaults/constraints,
  // indexes, functions, policies and triggers below are the actual capture.
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.user',true),'')::uuid$$;
    create function auth.role() returns text language sql as $$select coalesce(nullif(current_setting('test.role',true),''),current_user::text)$$;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');`);
  for(const table of stagingSchema.tables) {
    const columns=stagingSchema.columns.filter(column=>column.table===table.name);
    await pg.exec(`create table public.${ident(table.name)} (${columns.map(c=>`${ident(c.column)} ${c.type}${c.default!==null?' default '+c.default:''}${c.not_null?' not null':''}`).join(',')});`);
  }
  // Keys/checks before foreign keys; tables exist before any relationship is added.
  for(const constraint of [...stagingSchema.constraints].sort((a,b)=>(a.type==='f')-(b.type==='f'))) {
    await pg.exec(`alter table public.${ident(constraint.table.replace(/^public\./,''))} add constraint ${ident(constraint.name)} ${constraint.definition};`);
  }
  const constraintNames=new Set(stagingSchema.constraints.map(c=>c.name));
  for(const index of stagingSchema.indexes) if(!constraintNames.has(index.indexname)) await pg.exec(index.indexdef+';');
  for(const routine of stagingSchema.functions) await pg.exec(routine.definition+';');
  for(const trigger of stagingSchema.triggers) await pg.exec(trigger.definition+';');
  for(const policy of stagingSchema.policies) {
    await pg.exec(`create policy ${ident(policy.policyname)} on public.${ident(policy.tablename)} as ${policy.permissive} for ${policy.cmd} to ${policy.roles.map(role=>role==='public'?'public':ident(role)).join(',')}${policy.qual?' using ('+policy.qual+')':''}${policy.with_check?' with check ('+policy.with_check+')':''};`);
  }
  for(const table of stagingSchema.tables) {
    if(table.rls) await pg.exec(`alter table public.${ident(table.name)} enable row level security;`);
    if(table.forced) await pg.exec(`alter table public.${ident(table.name)} force row level security;`);
    await pg.exec(restoreAcl('table','public.'+ident(table.name),table.acl));
  }
  for(const routine of stagingSchema.functions) await pg.exec(restoreAcl('function','public.'+routine.signature,routine.acl));
}
