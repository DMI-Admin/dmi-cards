import assert from 'node:assert/strict';
import fs from 'node:fs';
const sql = fs.readFileSync('supabase/migrations/20260919120000_add_card_media_finalization.sql', 'utf8');
const stage = fs.readFileSync('supabase/migrations/20260918160000_prepare_card_media_staging.sql', 'utf8');
const atomic = fs.readFileSync('supabase/migrations/20260917210000_add_atomic_client_card_creation.sql', 'utf8');
assert.match(sql, /begin;[\s\S]*commit;\s*$/);
assert.match(sql, /security invoker set search_path = pg_catalog/);
assert.match(sql, /from public,anon,authenticated;/);
assert.match(sql, /to service_role;/);
assert.doesNotMatch(sql, /create or replace function|alter table public\.cards|grant .*auth\.users|create policy|storage\.objects/i);
assert.match(sql, /public\.card_media_owner_exists\(p_owner\)/);
assert.match(sql, /public\.create_client_card_atomic\(p_owner,p_allowance,payload\)/);
assert.match(sql, /hashtextextended\('public.cards.card_slot:' \|\| p_owner::text,0\)/);
assert.match(atomic, /'public.cards.card_slot:'/);
assert.match(sql, /order by id for update/);
assert(sql.indexOf('if s.finalization_digest is not null') < sql.indexOf("if s.state<>'pending'"));
assert(sql.indexOf('if s.finalization_digest is not null') < sql.indexOf('result := public.create_client_card_atomic'));
assert.match(sql, /'card_missing',[\s\S]*not exists/);
assert.match(sql, /payload-'slug'/);
assert.match(sql, /MEDIA_IDEMPOTENCY_CONFLICT/);
assert.match(sql, /revision <> p_expected_card_revision/);
assert.match(sql, /a.session_id<>p_session or a.kind<>v_kind or a.state<>'ready'/);
assert.match(sql, /ms\.owner_user_id=p_owner and ms\.card_id=p_card_id/);
assert.match(sql, /if new_count>0 then/);
assert(sql.indexOf('perform public.retire_card_media_asset(aid)') > sql.indexOf('returning c.* into saved'));
const update = sql.split('update public.cards c set')[1].split('from jsonb_to_record')[0];
assert.doesNotMatch(update, /\b(id|user_id|slug|card_slot)\s*=/);
// Bounded update fields exactly match atomic creation content, minus immutable slug.
const expected = atomic.split('as v(')[1].split(')\n  returning')[0].split(',').map(x => x.trim().split(' ')[0]).filter(x => x !== 'slug').sort();
assert.deepEqual([...update.matchAll(/\b(\w+)=v\.\w+/g)].map(m => m[1]).sort(), expected);
assert.match(stage, /unique \(session_id, kind, sha256\)/); // NOT owner/kind uniqueness.
assert.doesNotMatch(sql, /unique\s*\(\s*owner_user_id/i);
// Catch the undeclared p_owner class of defect before staging SQL execution.
const declared = new Set([...sql.split(') returns jsonb')[0].matchAll(/\bp_\w+\b/g)].map(m => m[0]));
for (const [parameter] of sql.matchAll(/\bp_\w+\b/g)) assert(declared.has(parameter), `Undeclared ${parameter}`);
console.log('PASS: media finalization static contract/permissions/lock order/payload checks; runtime rollback/concurrency tests are maintained separately. SQL NOT executed.');
