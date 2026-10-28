// Structural design checks only; no SQL installation or target implementation.
import assert from 'node:assert/strict';
import {verifyBoundary} from '../local/boundary.mjs';
const implementation=verifyBoundary();
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, '../../..');
assert.equal(fs.realpathSync(root), fs.realpathSync(process.cwd()), 'Run from repository root');
const read = name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
const schema = read('schema.json'), rpc = read('rpc.json'), plan = read('plan.json'), baseline = read('baseline.json');
const logical = JSON.parse(fs.readFileSync('specs/billing-simplification/phase1/schema.json', 'utf8'));
const behavior = JSON.parse(fs.readFileSync('specs/billing-simplification/phase1/behavior.json', 'utf8'));
const fixtures = JSON.parse(fs.readFileSync('specs/billing-simplification/phase1/fixtures.json', 'utf8')).fixtures;
const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
let count = 0;
function test(name, run) { run(); count++; console.log('PASS ' + name); }
function validateSchema(s) {
  assert.equal(s.namespace, 'billing_v2'); assert.equal(s.postgrest_exposed, false);
  assert.equal(s.phase2_mode, 'shadow_only'); assert.equal(s.live_authority_enabled, false);
  assert.equal(s.tables.length, 15);
  const names = new Set(s.tables.map(t => t.name)); assert.equal(names.size, 15);
  for (const table of s.tables) {
    assert.ok(table.name.startsWith('billing_v2.'));
    assert.ok(table.security.rls_enabled && table.security.rls_forced);
    assert.equal(table.browser_access, false);
    assert.ok(table.primary_key.length && table.sql_checks.length && table.indexes.length);
    for (const key of table.primary_key) assert.ok(table.columns[key]);
    for (const c of Object.values(table.columns)) { assert.ok(c.type); assert.equal(typeof c.nullable, 'boolean'); assert.ok(Object.hasOwn(c, 'default_sql')); }
    for (const fk of table.foreign_keys) {
      assert.ok(names.has(fk.table)); assert.equal(fk.columns[0], 'stripe_scope'); assert.equal(fk.references[0], 'stripe_scope');
      const parent = s.tables.find(t => t.name === fk.table);
      assert.equal(fk.columns.length, fk.references.length);
      fk.columns.forEach((c, i) => { assert.ok(table.columns[c] && parent.columns[fk.references[i]]); assert.equal(table.columns[c].type, parent.columns[fk.references[i]].type); });
      assert.equal(fk.on_delete, 'RESTRICT');
    }
    for (const index of table.indexes) {
      assert.equal(index.method, 'btree'); assert.ok(!index.where || !/now\(|clock_timestamp/.test(index.where));
      for (const c of index.columns) assert.ok(table.columns[c.replace(/ DESC$/, '')]);
    }
  }
  const authority = s.tables.find(t => t.name === 'billing_v2.authority');
  assert.deepEqual(authority.columns.writer_engine.enum, ['shadow']); assert.deepEqual(authority.columns.mode.enum, ['shadow_only']);
  assert.ok(!authority.columns.lease_token && !authority.columns.lease_until);
}
test('Physical schema is private, shadow-only, complete and scoped', () => validateSchema(schema));
test('All logical columns and eight Finance projections survive', () => {
  for (const t of logical.tables) {
    const physical = schema.tables.find(p => p.logical_name === t.name); assert.ok(physical);
    assert.deepEqual(Object.keys(physical.columns).sort(), Object.keys(t.columns).sort());
    for (const [key, c] of Object.entries(t.columns)) { assert.equal(physical.columns[key].type, c.type); assert.equal(physical.columns[key].nullable, c.nullable); }
  }
  assert.equal(schema.tables.slice(7).length, 8);
});
test('Negative: exposed schema or live engine cannot pass design validator', () => {
  const exposed = structuredClone(schema); exposed.postgrest_exposed = true; assert.throws(() => validateSchema(exposed));
  const active = structuredClone(schema); active.tables.find(t => t.name === 'billing_v2.authority').columns.writer_engine.enum.push('simplified'); assert.throws(() => validateSchema(active));
});
test('Negative: cross-schema/cross-scope foreign keys cannot pass', () => {
  const bad = structuredClone(schema); bad.tables[1].foreign_keys[0].table = 'public.billing_accounts'; assert.throws(() => validateSchema(bad));
  const unscoped = structuredClone(schema); unscoped.tables[1].foreign_keys[0].columns.shift(); assert.throws(() => validateSchema(unscoped));
});
test('No separate receipt/routing tables or nested authoritative lifecycle columns', () => {
  assert.ok(!schema.tables.some(t => /receipt|routing/.test(t.name)));
  const inbox = schema.tables.find(t => t.name === 'billing_v2.event_inbox');
  assert.deepEqual(inbox.columns.state.enum, behavior.states);
  assert.ok(inbox.sql_checks.some(c => c.includes("state='processing'")));
  assert.ok(inbox.sql_checks.some(c => c.includes("state='completed'")));
});
test('Explicit SQL contract includes exact current Finance foreign keys', () => {
  const expected = [['billing_v2.invoice_payments', 'stripe_charge_id', 'billing_v2.payments'], ['billing_v2.payment_attempts', 'stripe_charge_id', 'billing_v2.payments'], ['billing_v2.invoices', 'stripe_subscription_id', 'billing_v2.finance_subscriptions'], ['billing_v2.finance_activity', 'stripe_subscription_id', 'billing_v2.finance_subscriptions']];
  for (const [table, col, parent] of expected) assert.ok(schema.tables.find(t => t.name === table).foreign_keys.some(f => f.columns.includes(col) && f.table === parent));
});
test('RPC inventory is unique, fully described, and matches function estimate', () => {
  assert.equal(new Set(rpc.functions.map(f => f.name)).size, rpc.functions.length);
  assert.equal(rpc.functions.length, plan.estimates.target.sql_functions);
  for (const f of rpc.functions) for (const key of ['arguments', 'returns', 'preconditions', 'atomic_writes', 'replay_and_failure', 'grant', 'security']) assert.ok(Object.hasOwn(f, key), f.name + ':' + key);
  assert.ok(rpc.functions.every(f => f.name.startsWith('billing_v2.')));
});
test('Required task and authority APIs exist; ordinary claims have no event target', () => {
  for (const name of ['admit', 'claim', 'reclaim_expired', 'wait_dependency', 'wait_retry', 'complete_subscription', 'complete_finance', 'mark_attention', 'diagnose', 'acquire_authority', 'touch', 'release', 'assert_fence', 'handover']) assert.ok(rpc.functions.some(f => f.name === 'billing_v2.' + name));
  for (const name of ['claim', 'reclaim_expired']) assert.deepEqual(rpc.functions.find(f => f.name === 'billing_v2.' + name).arguments, ['scope text', 'task_kind text']);
});
test('Provider mutations and live handover explicitly blocked in Phase 2', () => {
  for (const name of ['prepare_checkout', 'record_checkout', 'handover']) {
    const f = rpc.functions.find(f => f.name === 'billing_v2.' + name);
    assert.match(f.returns, /blocked_phase2/); assert.match(f.atomic_writes, /none/);
  }
  assert.equal(plan.module_rules.provider_mutations, false);
  assert.equal(plan.module_rules.current_app_imports_v2, false);
  assert.equal(plan.module_rules.v2_imports_current_writers, false);
});
test('Service role is not a candidate writer; owner/executor capabilities explicit', () => {
  assert.match(schema.security.service_role, /no mutation RPC/);
  assert.match(schema.security.executor, /no direct table privileges/);
  assert.match(schema.security.owner, /no current public billing writes/);
  assert.match(schema.security.connection, /no broad Supabase service-role/);
  for (const f of rpc.functions.filter(f => /service_role/.test(f.grant))) assert.equal(f.name, 'billing_v2.diagnose');
});
test('Pure interface draft has declarations only; no runtime imports/provider writes', () => {
  const types = fs.readFileSync(path.join(dir, 'interfaces.d.ts'), 'utf8');
  assert.doesNotMatch(types, /\bimport\s|\bfetch\s*\(|\bcreateSupabase|\bprocess\.env|\bsetTimeout\s*\(/);
  for (const required of ['SubscriptionInput', 'SubscriptionPolicy', 'SubscriptionPersistence', 'FinancePolicy', 'FinancePersistence', 'ProviderReadPort', 'ShadowPersistence']) assert.ok(types.includes('interface ' + required));
});
test('Every Phase 1 fixture is represented in the implementation acceptance plan', () => {
  const covered = new Set(plan.implementation_sequence.flatMap(s => s.phase1_fixtures));
  for (const f of fixtures) assert.ok(covered.has(f.id), f.id);
  for (const id of covered) assert.ok(fixtures.some(f => f.id === id), id);
  assert.equal(plan.implementation_sequence.length, 10);
});
test('Migration list is additive, ordered and installs each function exactly once', () => {
  assert.equal(plan.migration_plan.length, 3);
  const names = new Set(); const functions = [];
  for (const m of plan.migration_plan) {
    assert.equal(m.additive_only, true); assert.ok(m.rollback && m.dependencies.length);
    for (const dep of m.dependencies.filter(d => d.endsWith('.sql'))) assert.ok(names.has(dep));
    assert.ok(Object.hasOwn(implementation.sha256,'supabase/migrations/' + m.file)); names.add(m.file); functions.push(...m.functions);
  }
  assert.equal(new Set(functions).size, functions.length);
  assert.deepEqual(functions.sort(), rpc.functions.map(f => f.name.split('.')[1]).sort());
});
test('Complexity counts derive from actual proposed inventory, not live removals', () => {
  assert.equal(plan.estimates.target.core_tables, schema.tables.length);
  assert.equal(plan.estimates.target.runtime_modules, plan.modules.length);
  assert.equal(plan.estimates.target.runtime_loc_estimate, plan.modules.reduce((n, m) => n + m.estimated_loc, 0));
  assert.equal(plan.estimates.target.phase2_live_table_reduction, 0);
  assert.equal(plan.estimates.target.phase2_temporary_tables_with_legacy, 39);
  assert.deepEqual(plan.cutover_gates, behavior.gates);
});
test('Phase 1 artifacts unchanged except the pinned design-boundary allowlist', () => {
  for (const [file, hash] of Object.entries(baseline.phase1_sha256)) {if(file.endsWith('/validate.mjs')){assert.equal(sha(file),implementation.specification_guard_hashes[file]);}else assert.equal(sha(file), hash, file);}
});
test('Exact design-file allowlist; runtime/migrations/config unchanged', () => {
  const current = fs.readdirSync(dir).sort(); assert.deepEqual(current, [...baseline.allowed_phase2_files].sort());
  const runtime = JSON.parse(fs.readFileSync('specs/billing-simplification/phase1/baseline.json', 'utf8'));
  execFileSync('git', ['merge-base', '--is-ancestor', runtime.head, 'HEAD']);
  for (const [file, hash] of Object.entries(runtime.sha256)) assert.equal(sha(file), hash, file);
  const diff = execFileSync('git', ['diff', '--name-only', 'HEAD'], {encoding: 'utf8'}).trim();
  for(const f of diff.split('\n').filter(Boolean))assert.ok(implementation.specification_edits.includes(f)||Object.hasOwn(implementation.sha256,f)||implementation.local_files.includes(f),'Unapproved tracked change');
});
test('No runtime source imports either specification or proposed implementation', () => {
  function scan(folder) { for (const e of fs.readdirSync(folder, {withFileTypes: true})) { const file = path.join(folder, e.name); if (e.isDirectory()) scan(file); else if (/\.[cm]?[jt]sx?$/.test(file)) assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /billing-simplification|experiments\/billing-v2/); } }
  scan('src'); assert.equal(fs.existsSync('experiments/billing-v2'), false);
});
console.log(`Phase 2 design: ${count}/${count}; structural/negative checks only. No target runtime or SQL executed.`);
