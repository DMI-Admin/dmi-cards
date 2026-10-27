// Offline Phase-1 contract checks. Invoke from repository root.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {probeCurrent} from './current-system.mjs';
import {validateFixture, compareObservation, permittedTransition, matchingFence, shadowOutcomes} from './comparison.mjs';
const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../../..');
assert.equal(fs.realpathSync(process.cwd()), fs.realpathSync(root), 'Run from repository root');
const read = name => JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
const schema = read('schema.json'), behavior = read('behavior.json'), fixtures = read('fixtures.json').fixtures, baseline = read('baseline.json');
let count = 0;
async function test(name, fn) { await fn(); count++; console.log('PASS ' + name); }
function files(dir) { return fs.readdirSync(dir, {withFileTypes: true}).flatMap(e => e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]); }
await test('Exactly 15 proposed tables; no browser authority', () => {
  const names = ['billing_accounts', 'billing_checkout_attempts', 'billing_price_catalog', 'billing_subscriptions', 'billing_event_inbox', 'billing_authority', 'billing_operations', 'billing_finance_subscriptions', 'billing_finance_subscription_items', 'billing_invoices', 'billing_payments', 'billing_invoice_payments', 'billing_refunds', 'billing_payment_attempts', 'billing_finance_activity'];
  assert.deepEqual(schema.tables.map(t => t.name), names);
  for (const t of schema.tables) {
    assert.equal(t.browser_access, false);
    for (const key of ['authoritative_writer', 'allowed_readers', 'business_identity', 'retention']) assert.ok(t[key], `${t.name}: ${key}`);
    assert.ok(t.columns.created_at && t.columns.updated_at);
    for (const k of t.primary_key) assert.ok(t.columns[k]);
    for (const c of Object.values(t.columns)) {
      assert.equal(typeof c.nullable, 'boolean'); assert.equal(typeof c.immutable, 'boolean'); assert.ok(c.type);
    }
    assert.deepEqual([...t.immutable_fields, ...t.mutable_fields].sort(), Object.keys(t.columns).sort());
    for (const fk of t.foreign_keys) {
      const target = schema.tables.find(s => s.name === fk.table);
      assert.ok(target); assert.equal(fk.columns.length, fk.references.length);
      for (const k of fk.columns) assert.ok(t.columns[k], t.name + ':' + k);
      for (const k of fk.references) assert.ok(target.columns[k], target.name + ':' + k);
      assert.equal(fk.columns[0], 'stripe_scope'); assert.equal(fk.references[0], 'stripe_scope');
    }
  }
});
await test('Finance fields and normative current constraints retained', () => {
  const store = fs.readFileSync('src/lib/stripe/finance-store.ts', 'utf8');
  const resources = ['subscriptions', 'items', 'invoices', 'payments', 'allocations', 'refunds', 'attempts', 'activity'];
  for (const [index, t] of schema.tables.slice(7).entries()) {
    const fields = store.match(new RegExp('\\b' + resources[index] + ':"([^\"]+)"'))[1].split(',').map(f => f.split('::')[0]);
    for (const field of fields) assert.ok(t.columns[field], t.name + ':' + field);
    assert.ok(t.retained_base_table_contract.includes('PRIMARY KEY'));
    assert.ok(t.required_source_contracts.length >= 4);
  }
  assert.equal(schema.tables.find(t => t.name === 'billing_invoices').columns.tax_minor.nullable, true);
});
await test('Current source/migration manifest exact and complete', () => {
  const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim(), baseline.head);
  for (const [file, expected] of Object.entries(baseline.sha256)) assert.equal(hash(file), expected, 'Runtime changed: ' + file);
  for (const file of [...files('src'), ...files('supabase/migrations')]) assert.ok(Object.hasOwn(baseline.sha256, file), 'Unexpected runtime/schema file ' + file);
  const changed = execFileSync('git', ['diff', '--name-only', 'HEAD'], {encoding: 'utf8'}).trim().split('\n').filter(Boolean);
  const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], {encoding: 'utf8'}).trim().split('\n').filter(Boolean);
  const phase2DesignFiles = new Set(["specs/billing-simplification/phase2/README.md", "specs/billing-simplification/phase2/schema.json", "specs/billing-simplification/phase2/rpc.json", "specs/billing-simplification/phase2/plan.json", "specs/billing-simplification/phase2/interfaces.d.ts", "specs/billing-simplification/phase2/validate.mjs", "specs/billing-simplification/phase2/baseline.json"]);
  for (const file of [...changed, ...untracked]) assert.ok(file.startsWith('specs/billing-simplification/phase1/') || phase2DesignFiles.has(file), 'Outside reviewed specification boundary: ' + file);
});
await test('Runtime cannot import Phase 1 artifacts', () => {
  for (const file of files('src')) {
    if (!/\.[cm]?[jt]sx?$/.test(file)) continue;
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /billing-simplification|specs\/.*phase1/);
  }
});
await test('Every fixture has explicit outcomes; minimum scenario coverage', () => {
  assert.ok(fixtures.length >= 20);
  assert.equal(new Set(fixtures.map(f => f.id)).size, fixtures.length);
  for (const f of fixtures) { validateFixture(f); assert.ok(fs.existsSync(f.current_evidence.suite)); }
  for (const id of ['monthly', 'annual', 'duplicate', 'stale', 'lost_checkout', 'lost_commit', 'provider_transient', 'database_transient', 'crash_before', 'crash_after', 'canceled', 'payment_failed', 'trialing', 'refund', 'wrong_scope', 'mode_staging', 'mode_production', 'reconciliation', 'finance_failure', 'handover']) assert.ok(fixtures.some(f => f.id === id));
  const inconsistent = structuredClone(fixtures.find(f => f.id === 'monthly'));
  inconsistent.expected.canonical.terminal = true;
  assert.throws(() => validateFixture(inconsistent));
});
await test('Closed states, terminality and permitted actors', () => {
  assert.deepEqual(behavior.states, ['queued', 'processing', 'retry_wait', 'dependency_wait', 'completed', 'needs_attention']);
  assert.deepEqual(Object.keys(behavior.transitions), behavior.states);
  for (const next of Object.values(behavior.transitions)) for (const state of next) assert.ok(behavior.states.includes(state));
  assert.equal(permittedTransition(behavior, 'queued', 'processing', 'claim'), true);
  assert.equal(permittedTransition(behavior, 'processing', 'completed', 'holder'), true);
  assert.equal(permittedTransition(behavior, 'dependency_wait', 'retry_wait', 'dependency_coordinator'), true);
  for (const state of ['completed', 'needs_attention']) assert.deepEqual(behavior.transitions[state], []);
  assert.equal(permittedTransition(behavior, 'dependency_wait', 'processing', 'claim'), false);
  assert.equal(permittedTransition(behavior, 'processing', 'completed', 'claim'), false);
});
await test('Fence specification rejects every stale identity/generation/token/expiry', () => {
  const p = {state: 'processing', leaseUntil: 200, scope: 'scope', account: 'account', engine: 'simplified', authorityGeneration: 2, claimGeneration: 4, token: 'token', operation: 'task'};
  assert.equal(matchingFence(p, p, 100), true);
  for (const key of ['scope', 'account', 'engine', 'authorityGeneration', 'claimGeneration', 'token', 'operation']) assert.equal(matchingFence({...p, [key]: 'stale'}, p, 100), false, key);
  assert.equal(matchingFence(p, p, 200), false);
  assert.equal(matchingFence(p, {...p, state: 'completed'}, 100), false);
});
await test('Shadow comparison closed outcomes, no missing/effect/policy exemptions', () => {
  assert.deepEqual(shadowOutcomes, behavior.shadow_outcomes);
  const e = {status: 'active', plan: 'pro', entitlement: 'pro', owner_verified: true, order_decision: 'accepted', finance: [], terminal: false};
  const a = {...e, unexpectedBusinessEffects: 0, providerMutations: 0};
  assert.equal(compareObservation(e, a), 'equivalent');
  assert.equal(compareObservation(e, a, {representationOnly: true}), 'expected_representation_difference');
  assert.equal(compareObservation(e, null), 'missing_projection');
  assert.equal(compareObservation(e, {...a, owner_verified: false}), 'ownership_mismatch');
  assert.equal(compareObservation(e, {...a, plan: 'free'}, {representationOnly: true}), 'policy_mismatch');
  assert.equal(compareObservation(e, {...a, providerMutations: 1}), 'unexpected_business_effect');
  assert.equal(compareObservation(e, {...a, unexpectedBusinessEffects: 1}), 'unexpected_business_effect');
  assert.equal(compareObservation(e, {providerMutations: 0, unexpectedBusinessEffects: 0}), 'missing_projection');
});
await test('Proposed budgets bounded, contention excluded, cutover gates explicit', () => {
  assert.equal(behavior.retry_proposal.implemented, false);
  assert.equal(behavior.retry_proposal.contention_counts_as_failure, false);
  assert.equal(behavior.retry_proposal.backoff_seconds.length, behavior.retry_proposal.transient_failure_limit - 1);
  assert.equal(behavior.lease_proposal.implemented, false);
  for (const name of ['phase2_design', 'phase3_shadow', 'staging_cutover', 'production_cutover']) assert.ok(behavior.gates[name].length >= 5);
});
for (const fixture of fixtures.filter(f => f.current_evidence.probe)) await test('Current system: ' + fixture.id, async () => { await probeCurrent(fixture); });
console.log(`Phase 1: ${count}/${count} checks; ${fixtures.length} fixture definitions. Future-only atomicity/handover/shadow requirements remain unimplemented.`);
