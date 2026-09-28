// Offline behavioral checks only. No credentials, network, or database access.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const environment = { VERCEL_ENV: 'preview', STRIPE_SECRET_KEY: 'offline-fixture' };
let identity = { userId: 'approved-admin' };
let live = false;
let fail = false;
let accountReads = 0;
let balanceReads = 0;
class FakeStripe {
  accounts = { retrieve: async () => {
    accountReads++;
    if (fail) throw new Error('provider-detail-must-not-leak');
    return { id: 'acct_fixture', privateFixture: 'must-not-leak' };
  } };
  balance = { retrieve: async () => {
    balanceReads++;
    return { livemode: live, privateFixture: 'must-not-leak' };
  } };
}
function load(file, dependencies) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, {
    exports, Response, process: { env: environment },
    require(name) { assert.ok(name in dependencies, `Unexpected dependency ${name}`); return dependencies[name]; },
    console: { log() { assert.fail('Unexpected log'); }, error() { assert.fail('Unexpected error log'); } },
  });
  return exports;
}
const config = load('src/lib/stripe/config.ts', {
  'server-only': {}, stripe: { default: FakeStripe },
});
const admin = load('src/lib/admin-auth.ts', {});
environment.DMI_ADMIN_CLERK_USER_IDS = 'approved-admin';
const route = load('src/app/api/internal/stripe-runtime-check/route.ts', {
  'server-only': {},
  '@clerk/nextjs/server': { auth: async () => identity },
  'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
  '@/lib/admin-auth': admin,
  '@/lib/stripe/config': config,
});
for (const mode of ['production', 'development', undefined]) {
  environment.VERCEL_ENV = mode;
  assert.equal((await route.GET()).status, 404);
}
assert.equal(accountReads + balanceReads, 0);
environment.VERCEL_ENV = 'preview';
for (const userId of [null, 'unapproved-user']) {
  identity = { userId };
  assert.equal((await route.GET()).status, 403);
}
assert.equal(accountReads + balanceReads, 0);
identity = { userId: 'approved-admin' };
for (const mode of [false, true]) {
  live = mode;
  const response = await route.GET();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(await response.json(), {
    accountId: 'acct_fixture', livemode: mode,
    stripeScope: `acct_fixture:${mode ? 'live' : 'test'}`,
  });
}
assert.equal(accountReads, 2);
assert.equal(balanceReads, 2);
fail = true;
const failure = await route.GET();
assert.equal(failure.status, 503);
assert.equal(await failure.text(), '');
assert.equal(failure.headers.get('cache-control'), 'private, no-store');
const reliability = fs.readFileSync('src/lib/stripe/reliability.ts', 'utf8');
assert.ok(reliability.includes('scopePromise ||= resolveStripeAccountScope()'));
console.log('PASS: Preview-only guard; real Admin allowlist; unauthorized requests make no Stripe reads; shared test/live scope; exactly three response fields; private/no-store; sanitized failures; no network/database dependency.');
