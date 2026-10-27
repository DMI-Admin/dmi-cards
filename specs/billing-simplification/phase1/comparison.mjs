// Pure specification helper. No persistence, provider calls or runtime imports.
import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
export const shadowOutcomes = ['equivalent', 'expected_representation_difference', 'policy_mismatch', 'missing_projection', 'ownership_mismatch', 'unexpected_business_effect'];
export const normalizedFields = ['status', 'plan', 'entitlement', 'owner_verified', 'order_decision', 'finance', 'terminal'];

export function compareObservation(expected, actual, {representationOnly = false} = {}) {
  if (!actual) return 'missing_projection';
  if (actual.unexpectedBusinessEffects !== 0 || actual.providerMutations !== 0) return 'unexpected_business_effect';
  if (!expected || !normalizedFields.every(k => Object.hasOwn(actual, k) && Object.hasOwn(expected, k))) return 'missing_projection';
  if (actual.owner_verified !== expected.owner_verified) return 'ownership_mismatch';
  if (!normalizedFields.every(k => isDeepStrictEqual(actual[k], expected[k]))) return 'policy_mismatch';
  return representationOnly ? 'expected_representation_difference' : 'equivalent';
}

export function validateFixture(f) {
  assert.match(f.id, /^[a-z_]+$/);
  assert.ok(f.input.scenario && f.current_evidence.suite);
  const e = f.expected;
  for (const key of ['canonical', 'entitlement', 'finance', 'task', 'audit', 'external_stripe_effects', 'zero_writes']) assert.ok(Object.hasOwn(e, key), `${f.id}: ${key}`);
  assert.ok(['free', 'pro'].includes(e.entitlement));
  if (e.entitlement === 'pro') {
    assert.equal(e.canonical.presence, 'present');
    assert.ok(['active', 'trialing'].includes(e.canonical.status));
    assert.equal(e.canonical.terminal, false);
    assert.equal(e.canonical.plan, 'pro');
  }
  assert.equal(e.finance.access_dependency, false);
  for (const n of Object.values(e.external_stripe_effects)) assert.ok(Number.isSafeInteger(n) && n >= 0);
  if (e.zero_writes.includes('all_database')) {
    assert.equal(e.task.state, 'not_admitted');
    assert.equal(e.audit.record, 'none');
    assert.equal(e.external_stripe_effects.new_sessions, 0);
  }
  assert.equal(e.audit.append_only, true);
}

export function permittedTransition(contract, from, to, actor) {
  return Boolean(contract.transitions[from]?.includes(to) && contract.transition_actors[actor]?.includes(`${from}->${to}`));
}

// Predicate fixture for the future commit guard; not a new lock implementation.
export function matchingFence(holder, persisted, now) {
  return persisted.state === 'processing' && persisted.leaseUntil > now &&
    ['scope', 'account', 'engine', 'authorityGeneration', 'claimGeneration', 'token', 'operation'].every(k => holder[k] === persisted[k]);
}
