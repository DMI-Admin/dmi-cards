// Real signed route + real policy/configuration. Strict offline boundaries only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import Stripe from 'stripe';
import {execFileSync as nativeExecFileSync} from 'node:child_process';
import {claimDiagnosticGitDiff} from './billing-claim-diagnostic-contract.mjs';
const execFileSync=(file,args,options)=>file==='git'&&args[0]==='diff'?claimDiagnosticGitDiff(args,options):nativeExecFileSync(file,args,options);
import {loadModeModule, webhookModeGuard, modeStagingEnvironment, modeProductionEnvironment} from './lib/stripe-webhook-mode.mjs';

const secret = 'whsec_offline_mode_guard_fixture';
const signedConfig = loadModeModule('src/lib/stripe/config.ts', {stripe: {default: Stripe}}, {
  STRIPE_SECRET_KEY: 'sk_test_offline_fixture', STRIPE_WEBHOOK_SECRET: secret,
});
function fixture(env, {handoff = false, badSignature = false, handlerFailure = false} = {}) {
  const order = [], writes = {receipts: 0, jobs: 0}, logs = [];
  let clients = 0, kicks = 0, verified = 0, decisions = 0;
  const policy = webhookModeGuard(env);
  const database = () => {clients++; order.push('database'); return {};};
  const deps = {
    'next/server': {after: () => assert.fail('NO_BACKGROUND_CALLBACK'), NextResponse: Response},
    '@/lib/stripe/config': {constructStripeWebhookEvent: args => {
      order.push('signature');
      const event = signedConfig.constructStripeWebhookEvent(args); verified++; return event;
    }},
    '@/lib/stripe/webhook-mode-guard': {stripeWebhookModeDecision: value => {
      order.push('mode'); decisions++; return policy.stripeWebhookModeDecision(value);
    }},
    '@/lib/stripe/billing-work-config': {billingWorkConfiguration: () => {
      order.push('handoff_config'); return {state: handoff ? 'enabled' : 'disabled'};
    }},
    '@/lib/supabase-admin': {createSupabaseAdminClient: database},
    '@/lib/stripe/billing-work-handoff': {handoffBillingWork: async (_event, _config, createDb) => {
      order.push('admission'); createDb(); writes.jobs++;
      return {state: 'unfinished', applicable: 1, terminal: 0};
    }},
    '@/lib/stripe/billing-work-auto-kick': {registerAutomaticBillingKick: () => {kicks++; order.push('kick');}},
    '@/lib/stripe/finance-invoice-proof-config': {invoiceProofProductionOptions: () => {order.push('proof_config');}},
    '@/lib/stripe/webhook-consumers': {handleStripeWebhookConsumers: async () => {
      order.push('inline'); database(); writes.receipts++;
      if (handlerFailure) throw Error('PRIVATE_CONSUMER_FAILURE');
      return {handled: true};
    }},
    '@/lib/observability/logger': {logInfo: x => logs.push(x), logError: x => logs.push(x), safeErrorMetadata: () => ({})},
    '@/lib/observability/request': {requestIdFromRequest: () => 'offline-request', withRequestIdHeader: r => r},
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/app/api/stripe/webhook/route.ts', 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
  }).outputText, {exports, performance, Error, process: {env}, require: name => {
    assert.ok(Object.hasOwn(deps, name), 'UNEXPECTED_ROUTE_IMPORT ' + name); return deps[name];
  }});
  return {order, writes, logs, counts: () => ({clients, kicks, verified, decisions}), send: async (livemode, url = 'https://untrusted.invalid/api/stripe/webhook') => {
    const payload = JSON.stringify({id: 'evt_private_mode_fixture', object: 'event', type: 'customer.subscription.created',
      created: 1700000000, livemode, data: {object: {id: 'sub_private', customer: 'cus_private', metadata: {private: 'PRIVATE_PAYLOAD'}}}});
    const signature = badSignature ? 'invalid' : Stripe.webhooks.generateTestHeaderString({payload, secret});
    return exports.POST(new Request(url, {method: 'POST', body: payload, headers: {'stripe-signature': signature, 'x-vercel-env': 'production'}}));
  }};
}
let n = 0;
async function test(name, fn) {await fn(); n++; console.log('PASS webhook mode ' + name);}
for (const [name, env, mode] of [['Production LIVE', modeProductionEnvironment, true], ['Staging TEST', modeStagingEnvironment, false]]) {
  for (const handoff of [false, true]) await test(name + ' passes before existing ' + (handoff ? 'admission/kick' : 'inline') + ' path', async () => {
    const f = fixture(env, {handoff}); const r = await f.send(mode);
    assert.equal(r.status, handoff ? 500 : 200);
    assert.deepEqual(f.order.slice(0, 3), ['signature', 'mode', 'handoff_config']);
    assert.equal(f.counts().clients, 1); assert.equal(f.counts().verified, 1);
    assert.equal(f.writes[handoff ? 'jobs' : 'receipts'], 1); assert.equal(f.counts().kicks, handoff ? 1 : 0);
  });
}
for (const [name, env, mode] of [['Production TEST', modeProductionEnvironment, false], ['Staging LIVE', modeStagingEnvironment, true]]) {
  for (const handoff of [false, true]) await test(name + ' acknowledged without any billing/config/client/kick call', async () => {
    const f = fixture(env, {handoff}); const r = await f.send(mode);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), {received: true, handled: false, skipped: true, reason: 'stripe_livemode_mismatch'});
    assert.deepEqual(f.order, ['signature', 'mode']);
    assert.deepEqual(f.writes, {receipts: 0, jobs: 0});
    assert.deepEqual(f.counts(), {clients: 0, kicks: 0, verified: 1, decisions: 1});
    assert.deepEqual(f.logs, []);
  });
}
await test('unknown missing inconsistent and foreign deployment identities fail closed', async () => {
  const invalid = [{}, ...Object.keys(modeStagingEnvironment).map(key => ({...modeStagingEnvironment, [key]: undefined})),
    ...Object.keys(modeProductionEnvironment).map(key => ({...modeProductionEnvironment, [key]: undefined})),
    {...modeStagingEnvironment, VERCEL_ENV: 'production'}, {...modeProductionEnvironment, VERCEL_TARGET_ENV: 'staging'},
    {...modeStagingEnvironment, VERCEL_TARGET_ENV: 'preview'}, {...modeStagingEnvironment, VERCEL_ENV: 'development'},
    {...modeStagingEnvironment, VERCEL_PROJECT_ID: 'prj_other'}, {...modeProductionEnvironment, VERCEL_PROJECT_ID: 'prj_other'},
    {...modeStagingEnvironment, VERCEL_TARGET_ENV: 'Staging'}];
  for (const env of invalid) for (const mode of [false, true]) {
    const f = fixture({...env, BILLING_WORK_HANDOFF_ENABLED: 'true', BILLING_WORK_AUTOMATIC_RUN_ENABLED: 'true', BILLING_WORK_POST_ADMISSION_KICK_ENABLED: 'true'}, {handoff: true});
    const r = await f.send(mode); assert.equal(r.status, 503);
    assert.equal((await r.json()).error.code, 'STRIPE_WEBHOOK_ENVIRONMENT_UNTRUSTED');
    assert.deepEqual(f.order, ['signature', 'mode']); assert.deepEqual(f.writes, {receipts: 0, jobs: 0});
    assert.equal(f.counts().clients + f.counts().kicks, 0);
  }
});
await test('signature failure precedes guard even for wrong mode or unknown environment', async () => {
  for (const env of [modeProductionEnvironment, modeStagingEnvironment, {}]) {
    const f = fixture(env, {badSignature: true, handoff: true}); const r = await f.send(false);
    assert.equal(r.status, 400); assert.equal((await r.json()).error.code, 'INVALID_STRIPE_SIGNATURE');
    assert.deepEqual(f.order, ['signature']); assert.deepEqual(f.counts(), {clients: 0, kicks: 0, verified: 0, decisions: 0});
  }
});
await test('hostname and request headers cannot override trusted deployment policy', async () => {
  for (const host of ['app.dmicards.com', 'staging.dmicards.com', 'attacker.invalid']) {
    const f = fixture(modeProductionEnvironment, {handoff: true});
    assert.equal((await f.send(false, 'https://' + host + '/api/stripe/webhook')).status, 200);
    assert.deepEqual(f.order, ['signature', 'mode']); assert.equal(f.counts().clients, 0);
    const s = fixture(modeStagingEnvironment); assert.equal((await s.send(false, 'https://' + host + '/api/stripe/webhook')).status, 200);
    assert.equal(s.writes.receipts, 1);
  }
});
await test('ordinary platform events do not need event.account', () => {
  assert.equal(webhookModeGuard(modeProductionEnvironment).stripeWebhookModeDecision(true), 'accepted');
  assert.equal(webhookModeGuard(modeStagingEnvironment).stripeWebhookModeDecision(false), 'accepted');
  assert.doesNotMatch(fs.readFileSync('src/lib/stripe/webhook-mode-guard.ts', 'utf8'), /event\.account|request\.|headers|hostname/);
});
await test('missing and nonboolean livemode are never accepted', async () => {
  for (const env of [modeProductionEnvironment, modeStagingEnvironment]) for (const mode of [undefined, null, 'true', 'false', 0, 1, {}]) {
    const f = fixture(env, {handoff: true}); assert.equal((await f.send(mode)).status, 200);
    assert.deepEqual(f.order, ['signature', 'mode']); assert.equal(f.counts().clients, 0);
  }
});
await test('rejection logs and response contain no payloads identities or credentials', async () => {
  const f = fixture(modeProductionEnvironment); const body = await (await f.send(false)).text();
  assert.doesNotMatch(body + JSON.stringify(f.logs), /evt_private|sub_private|cus_private|PRIVATE_PAYLOAD|whsec|sk_test|metadata/);
});
await test('accepted consumer failure preserves existing generic HTTP failure', async () => {
  const f = fixture(modeStagingEnvironment, {handlerFailure: true}); const r = await f.send(false);
  assert.equal(r.status, 500); assert.equal((await r.json()).error.code, 'STRIPE_WEBHOOK_FAILED');
});
await test('guard has no I/O or feature flag fallback; existing authority modules unchanged', () => {
  const s = fs.readFileSync('src/lib/stripe/webhook-mode-guard.ts', 'utf8');
  assert.doesNotMatch(s, /createClient|createSupabase|fetch\(|\.rpc\(|console\.|logInfo|STRIPE_SECRET_KEY|BILLING_WORK_HANDOFF_ENABLED/);
  for (const file of ['config.ts', 'billing-work-config.ts', 'webhook.ts', 'webhook-consumers.ts', 'finance-invoice-proof-config.ts',
    'billing-work-worker.ts', 'billing-work-routing.ts', 'billing-work-store.ts', 'finance-customer-webhook.ts', 'finance-dmi-charge-integration.ts']) {
    assert.equal(fs.readFileSync('src/lib/stripe/' + file, 'utf8'), execFileSync('git', ['show', '4eea7645d94afb3af47a55809b407da3f0657515:src/lib/stripe/' + file], {encoding: 'utf8'}));
  }
  assert.equal(execFileSync('git', ['diff', '--name-only', 'HEAD', '--', 'supabase/migrations', 'vercel.json'], {encoding: 'utf8'}), '');
});
console.log(`PASS Stripe webhook mode: ${n}/${n}`);
