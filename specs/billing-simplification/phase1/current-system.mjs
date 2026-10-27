// Specification-only adapter to the existing real-module offline harness.
// No network, environment secrets, target writer or SQL implementation.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {randomUUID} from 'node:crypto';
import {webhookModeGuard, modeStagingEnvironment, modeProductionEnvironment} from '../../../scripts/lib/stripe-webhook-mode.mjs';

// The harness export prefix is already reused by validate-embedded-checkout.mjs.
function harness() {
  const source = fs.readFileSync('scripts/validate-stripe-reliability.mjs', 'utf8');
  const marker = 'let f=fixture();';
  assert.equal(source.split(marker).length, 2, 'Existing fixture boundary changed; review adapter');
  const exports = {};
  const extra = '\nexports.fixture=fixture;exports.webhook=webhook;exports.rel=rel;exports.checkout=checkout;exports.reconcile=reconcile;exports.event=event;exports.setNow=v=>{now=v;};';
  vm.runInNewContext(ts.transpileModule(source.split(marker)[0] + extra, {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
  }).outputText, {exports, URL, Buffer, console, performance, AbortController, setTimeout, clearTimeout, require: name => {
    const dependencies = {'node:assert/strict': {default: assert}, 'node:fs': {default: fs}, 'node:vm': {default: vm}, typescript: {default: ts}, 'node:crypto': {randomUUID}};
    assert.ok(Object.hasOwn(dependencies, name), 'Unexpected fixture dependency');
    return dependencies[name];
  }});
  exports.setNow(Date.parse('2026-10-01T00:00:00Z'));
  return exports;
}
const user = '11111111-1111-4111-8111-111111111111';
const input = {userId: user, email: null, plan: 'pro', billingInterval: 'monthly', priceId: 'price_current', successUrl: 'https://local.invalid/client/billing/activating', cancelUrl: 'https://local.invalid/client/billing'};

export async function probeCurrent(fixture) {
  const name = fixture.current_evidence.probe;
  if (!name) return {coverage: 'existing_suite_only'};
  if (name.startsWith('mode_') || name === 'unknown_runtime') {
    const env = name === 'mode_production' ? modeProductionEnvironment : name === 'unknown_runtime' ? {} : modeStagingEnvironment;
    const live = name !== 'mode_production';
    const decision = webhookModeGuard(env).stripeWebhookModeDecision(live);
    assert.equal(decision, name === 'unknown_runtime' ? 'untrusted_runtime' : 'mode_mismatch');
    // Real route zero-DB/admission/kick ordering is separately exercised by
    // validate-stripe-webhook-mode.mjs, not inferred from this pure decision.
    return {coverage: 'current_policy_probe', decision};
  }
  const h = harness(), f = h.fixture();
  const send = (id = 'evt_spec', time = 100, type = 'customer.subscription.updated', object = f.sub) => h.webhook.handleStripeWebhookEvent(h.event(f, id, time, type, object), f.r);
  if (name === 'free') {
    assert.equal(f.mirrors.length, 0);
  } else if (name === 'lost_checkout') {
    f.subscriptions.clear();
    f.loseCheckout = true;
    await assert.rejects(h.checkout.createStripeCheckoutSession(input, f.r));
    const key = f.accounts.get(user).checkout_attempt;
    await h.checkout.createStripeCheckoutSession(input, f.r);
    assert.equal(f.accounts.get(user).checkout_attempt, key);
    assert.equal(f.createdSessions, 1);
    // Fixture starts without a bound account, so customer creation is separate
    // from the Session idempotency claim; preserve exact observed count below.
  } else if (name === 'crash_before') {
    const first = await h.rel.command(f.r, 'event_claim', null, null, {id: 'evt_spec', type: 'customer.subscription.updated', created: 100});
    h.setNow(Date.parse('2026-10-01T00:00:00Z') + 90_001);
    await send();
    await assert.rejects(h.rel.command(f.r, 'event_finish', null, first.token, {id: 'evt_spec', outcome: 'ignored'}), /BILLING_FENCE/);
    assert.equal(f.events.get('evt_spec').attempts, 2);
  } else if (name === 'reconciliation') {
    await h.rel.synchronizeSubscription(f.r, 'sub_owned');
    f.mirrors.length = 0;
    await h.reconcile.reconcileBilling({mode: 'repair', userId: user}, 'synthetic_admin', f.r);
    assert.equal(f.audits.length, 1);
  } else if (name === 'wrong_scope') {
    f.mirrors.push({stripe_scope: 'acct_other:test', stripe_subscription_id: 'sub_owned', stripe_customer_id: 'cus_owned', user_id: user, revision: 1, terminal: false, last_event_created: 90, sync_snapshot: {status: 'active', plan: 'pro', terminal: false}});
    const prior = JSON.stringify(f.mirrors);
    await assert.rejects(send());
    assert.equal(JSON.stringify(f.mirrors), prior);
  } else if (name === 'unknown_price' || name === 'wrong_owner') {
    if (name === 'unknown_price') f.sub.items.data[0].price.id = 'price_unknown';
    else f.customers.get('cus_owned').metadata.dmi_user_id = '22222222-2222-4222-8222-222222222222';
    await assert.rejects(send());
  } else {
    if (name === 'annual') {
      f.prices.push({stripe_scope: f.r.scope, stripe_price_id: 'price_annual', entitlement_enabled: true, checkout_enabled: true});
      f.sub.items.data[0].price.id = 'price_annual';
    }
    if (name === 'trialing') f.sub.status = 'trialing';
    if (name === 'cancel_scheduled') f.sub.cancel_at_period_end = true;
    if (name === 'canceled') f.sub.status = 'canceled';
    if (name === 'payment_failed') f.sub.status = 'past_due';
    if (name === 'provider_transient' || name === 'database_transient') {
      if (name === 'provider_transient') f.failStripe = true;
      else f.failCommit = true;
      await assert.rejects(send());
      assert.equal(f.mirrors.length, 0);
      assert.equal(f.events.get('evt_spec').state, 'failed');
      f.failStripe = false;
    }
    if (name === 'lost_commit') {
      const rpc = f.r.db.rpc;
      let lose = true;
      f.r.db.rpc = async (...args) => {
        const response = await rpc(...args);
        if (args[1].p_action === 'commit' && !response.error && lose) {
          lose = false;
          throw Error('synthetic lost commit response');
        }
        return response;
      };
      await assert.rejects(send());
      assert.equal(f.events.get('evt_spec').state, 'processed');
      const revision = f.mirrors[0].revision;
      await send();
      assert.equal(f.mirrors[0].revision, revision);
    } else {
      await send();
    }
    if (name === 'duplicate') {
      const revision = f.mirrors[0].revision, reads = f.retrieves;
      const result = await send();
      assert.equal(result.reason, 'duplicate_event');
      assert.equal(f.mirrors[0].revision, revision);
      assert.equal(f.retrieves, reads);
    }
    if (name === 'stale' || name === 'equal_timestamp') {
      f.sub.cancel_at_period_end = true;
      const result = await send('evt_followup', name === 'stale' ? 99 : 100);
      assert.equal(f.mirrors[0].sync_snapshot.cancel_at_period_end, name !== 'stale');
      if (name === 'stale') assert.equal(result.reason, 'stale_ignored');
    }
    if (name === 'terminal_late') {
      f.sub.status = 'canceled';
      await send('evt_terminal', 101);
      f.sub.status = 'active';
      const result = await send('evt_late', 102);
      assert.equal(result.reason, 'terminal_ignored');
    }
    if (name === 'resumption') {
      f.sub.cancel_at_period_end = true;
      await send('evt_scheduled', 101);
      f.sub.cancel_at_period_end = false;
      await send('evt_resume', 102);
      assert.equal(f.mirrors[0].sync_snapshot.cancel_at_period_end, false);
    }
    if (name === 'unsupported_change') {
      const revision = f.mirrors[0].revision;
      f.sub.items.data[0].price.id = 'price_unknown';
      await assert.rejects(send('evt_unknown', 102), /UNKNOWN_PRICE/);
      assert.equal(f.mirrors[0].revision, revision);
    }
  }
  const snapshot = f.mirrors[0]?.sync_snapshot;
  const expected = fixture.expected.canonical;
  assert.equal(snapshot ? 'present' : 'absent', expected.presence, fixture.id);
  assert.equal(snapshot?.status ?? null, expected.status, fixture.id);
  assert.equal(snapshot?.plan ?? 'free', fixture.expected.entitlement, fixture.id);
  if (snapshot) assert.equal(snapshot.terminal, expected.terminal, fixture.id);
  assert.equal(f.createdSessions, fixture.expected.external_stripe_effects.new_sessions);
  assert.equal(f.createdCustomers, fixture.expected.external_stripe_effects.new_customers);
  return {coverage: 'current_real_module_probe', canonical: snapshot ? {status: snapshot.status, plan: snapshot.plan, terminal: snapshot.terminal} : null};
}
