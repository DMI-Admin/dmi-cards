// Offline execution of the real server boundary, route, poller and page.
// No credentials, network, database, worker or billing mutations.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as crypto from 'node:crypto';
import * as childProcess from 'node:child_process';
import * as claimContract from './billing-claim-diagnostic-contract.mjs';
import * as automaticContract from './billing-work-auto-contract.mjs';
import * as embeddedContract from './billing-embedded-checkout-contract.mjs';
import * as latencyContract from './billing-latency-contract.mjs';

function load(path, deps, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, URL, URLSearchParams, AbortController, setTimeout, clearTimeout, performance,
    require(name) { assert.ok(name in deps, `Unexpected dependency: ${name}`); return deps[name]; }, ...globals });
  return exports;
}
let count = 0;
async function test(name, run) { await run(); count++; console.log(`PASS ${name}`); }
class ApiRouteError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
const signal = new AbortController().signal;
const sessionId = 'cs_test_owned';
let session, account, mirrors, prices, storeError, providerCalls, calls;
function reset() {
  session = { client_reference_id: 'owner', metadata: { dmi_user_id: 'owner', dmi_app: 'dmi_cards_v2' },
    livemode: false, mode: 'subscription', status: 'complete', payment_status: 'paid', customer: 'cus_owned' };
  account = { stripe_customer_id: 'cus_owned', verified_at: 'verified' };
  mirrors = [{ stripe_price_id: 'price_approved' }]; prices = [{ stripe_price_id: 'price_approved' }];
  storeError = null; providerCalls = 0; calls = [];
}
reset();
const db = { from(table) {
  assert.ok(['billing_accounts', 'billing_subscriptions', 'billing_approved_prices'].includes(table));
  const ops = []; calls.push([table, ops]);
  const result = () => ({ data: table === 'billing_accounts' ? account : table === 'billing_subscriptions' ? mirrors : prices, error: storeError });
  const q = { then(resolve) { return Promise.resolve(result()).then(resolve); }, async maybeSingle() { return result(); } };
  for (const method of ['select', 'eq', 'not', 'in', 'limit', 'abortSignal']) q[method] = (...args) => { ops.push([method, ...args]); return q; };
  return q;
} };
const activation = load('src/lib/stripe/checkout-activation.ts', {
  'server-only': {}, '@/lib/api/responses': { ApiRouteError },
  '@/lib/stripe/app-namespace': { hasDmiStripeAppNamespace: metadata => metadata?.dmi_app === 'dmi_cards_v2' },
  '@/lib/stripe/billing-state': { dmiPlanForStripePrice: price => price === 'price_approved' ? 'pro' : 'free' },
  '@/lib/stripe/reliability': { objectId: value => typeof value === 'string' ? value : value?.id || '',
    billingRuntime: async () => ({ db, scope: 'scope:test', live: false, stripe: { checkout: { sessions: {
      async retrieve(id, params, options) { providerCalls++; assert.equal(id, sessionId); assert.equal(params, undefined);
        assert.equal(options.timeout, 8000); assert.equal(options.maxNetworkRetries, 0); return session; },
    } } } }),
  },
});
await test('owned, paid checkout acknowledged without entitlement or mutations', async () => {
  assert.equal((await activation.acknowledgeCheckout('owner', sessionId, signal)).paymentReceived, true);
  assert.equal(calls.length, 1); assert.equal(providerCalls, 1);
  assert.ok(calls[0][1].some(op => op[0] === 'eq' && op[1] === 'user_id' && op[2] === 'owner'));
});
await test('malformed IDs rejected before provider or database access', async () => {
  for (const id of ['', '../other', 'cs_test_' + 'a'.repeat(241), 'not-a-session']) {
    reset(); await assert.rejects(activation.acknowledgeCheckout('owner', id, signal), e => e.status === 400);
    assert.equal(providerCalls, 0); assert.equal(calls.length, 0);
  }
});
await test('foreign identity, namespace, mode and customer rejected', async () => {
  for (const update of [s => s.client_reference_id = 'foreign', s => s.metadata.dmi_user_id = 'foreign',
    s => s.metadata.dmi_app = 'other', s => s.livemode = true, s => s.mode = 'payment', s => s.customer = 'cus_foreign']) {
    reset(); update(session); await assert.rejects(activation.acknowledgeCheckout('owner', sessionId, signal), e => e.status === 404);
  }
});
await test('unverified account rejected; incomplete or unpaid checkout never acknowledged', async () => {
  reset(); account.verified_at = null;
  await assert.rejects(activation.acknowledgeCheckout('owner', sessionId, signal), e => e.status === 404);
  for (const update of [s => s.status = 'open', s => s.payment_status = 'unpaid']) {
    reset(); update(session); assert.equal((await activation.acknowledgeCheckout('owner', sessionId, signal)).paymentReceived, false);
  }
});
await test('Pro needs existing authority plus verified current-scope mirror and approved price', async () => {
  reset(); assert.equal(await activation.verifiedProReady('owner', false, signal), false); assert.equal(calls.length, 0);
  assert.equal(await activation.verifiedProReady('owner', true, signal), true);
  const ops = calls[0][1];
  for (const [key, value] of [['user_id', 'owner'], ['stripe_scope', 'scope:test'], ['terminal', false]]) {
    assert.ok(ops.some(op => op[0] === 'eq' && op[1] === key && op[2] === value));
  }
  assert.ok(ops.some(op => op[0] === 'not' && op[1] === 'verified_at' && op[2] === 'is' && op[3] === null));
  assert.deepEqual(Array.from(ops.find(op => op[0] === 'in')[2]), ['active', 'trialing']);
  assert.equal(providerCalls, 0);
  reset(); mirrors = []; assert.equal(await activation.verifiedProReady('owner', true, signal), false);
  reset(); mirrors = [{ stripe_price_id: 'unapproved' }]; assert.equal(await activation.verifiedProReady('owner', true, signal), false);
  reset(); prices = []; assert.equal(await activation.verifiedProReady('owner', true, signal), false);
  reset(); storeError = {}; await assert.rejects(activation.verifiedProReady('owner', true, signal), e => e.status === 503);
});

let authenticated = true, authority = true, acknowledgements = 0, stateReads = 0;
const route = load('src/app/api/v1/billing/activation/route.ts', {
  '@/lib/stripe/billing-latency-diagnostics': { createBillingLatencyObserver: () => undefined },
  '@/lib/stripe/client-identity': { requireBillingIdentity: async () => { if (!authenticated) throw new ApiRouteError(401, 'UNAUTHENTICATED', 'Sign in'); return { userId: 'owner' }; } },
  '@/lib/api/client-context': { requireApiClient: async () => ({ userId: 'owner', plan: authority ? 'pro' : 'free', planSource: authority ? 'stripe_billing' : 'temporary_free_cap' }) },
  '@/lib/api/responses': { ApiRouteError, apiSuccess: (data, init) => Response.json({ data }, init), apiError: (status, code, message) => Response.json({ error: { code, message } }, { status }) },
  '@/lib/stripe/checkout-activation': {
    acknowledgeCheckout: async (...args) => { acknowledgements++; return activation.acknowledgeCheckout(...args); },
    verifiedProReady: async (...args) => { stateReads++; return activation.verifiedProReady(...args); },
  },
}, { Response });
const get = query => route.GET(new Request(`https://offline.invalid/api/v1/billing/activation${query}`));
await test('authentication precedes any checkout lookup; malformed query fails closed', async () => {
  reset(); authenticated = false;
  assert.equal((await get('?session_id=cs_test_owned')).status, 401); assert.equal(acknowledgements, 0);
  authenticated = true;
  for (const query of ['?session_id=a&session_id=b', '?user_id=foreign', '?session_id=a&extra=b']) assert.equal((await get(query)).status, 400);
  assert.equal(acknowledgements, 0); assert.equal(stateReads, 0);
});
await test('route returns booleans only, no-store and no provider calls during polling', async () => {
  reset(); const confirmed = await get('?session_id=cs_test_owned');
  assert.deepEqual(await confirmed.json(), { data: { paymentReceived: true } });
  const state = await get(''); assert.deepEqual(await state.json(), { data: { proReady: true } });
  assert.equal(state.headers.get('Cache-Control'), 'private, no-store'); assert.equal(providerCalls, 1);
  authority = false; assert.deepEqual(await (await get('')).json(), { data: { proReady: false } }); authority = true;
});

const { startActivationPolling } = load('src/lib/billing-activation-poller.ts', {});
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function clock() {
  let time = 0, id = 0; const timers = new Map();
  return { schedule(fn, delay) { timers.set(++id, { fn, at: time + delay }); return id; }, cancel(id) { timers.delete(id); },
    async advance(ms) {
      const end = time + ms;
      for (;;) {
        const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        time = next[1].at; timers.delete(next[0]); next[1].fn(); await flush();
      }
      time = end; await flush();
    }, get size() { return timers.size; }, get now() { return time; },
  };
}
function polling(overrides = {}) {
  const timer = clock(), states = []; let redirects = 0, reads = 0;
  const stop = startActivationPolling({ schedule: timer.schedule, cancel: timer.cancel,
    acknowledge: async () => true, readReady: async () => { reads++; return false; },
    onState: state => states.push(state), onReady: () => redirects++, ...overrides });
  return { timer, states, stop, get redirects() { return redirects; }, get reads() { return reads; } };
}
await test('already active -> success -> 250ms redirect, no later polls', async () => {
  const f = polling({ readReady: async () => true }); await flush();
  assert.deepEqual(f.states, ['checking', 'activating', 'ready']); assert.equal(f.redirects, 0);
  await f.timer.advance(249); assert.equal(f.redirects, 0); await f.timer.advance(1); assert.equal(f.redirects, 1); assert.equal(f.timer.size, 0);
});
await test('pending -> later verified Pro -> success', async () => {
  let reads = 0; const f = polling({ readReady: async () => ++reads === 3 }); await flush();
  await f.timer.advance(1999); assert.equal(reads, 2); await f.timer.advance(1); assert.equal(f.states.at(-1), 'ready');
  await f.timer.advance(1000); assert.equal(f.redirects, 1); assert.equal(reads, 3);
});
await test('20 seconds switches to delayed automatic four-second observation; only 90 seconds stops', async () => {
  const f = polling(); await flush(); await f.timer.advance(20000);
  assert.equal(f.states.at(-1), 'delayed'); assert.equal(f.redirects, 0); assert.equal(f.timer.size, 2);
  assert.equal(f.reads, 20); assert.ok(!f.states.includes('free'));
  await f.timer.advance(3999); assert.equal(f.reads, 20);
  await f.timer.advance(1); assert.equal(f.reads, 21);
  await f.timer.advance(65999); assert.equal(f.states.at(-1), 'delayed');
  await f.timer.advance(1); assert.equal(f.states.at(-1), 'waiting');assert.equal(f.timer.size, 0);assert.equal(f.reads,37);
  await f.timer.advance(90000);assert.equal(f.reads,37);
  const retry = polling({ readReady: async () => true }); await flush(); assert.equal(retry.states.at(-1), 'ready'); retry.stop();
});
await test('20-second transition never overlaps or aborts a slow read; final deadline aborts it', async () => {
  let resolveRead, activeSignal, reads = 0;
  const f = polling({ readReady: signal => { activeSignal = signal; reads++; return new Promise(resolve => { resolveRead = resolve; }); } });
  await flush(); await f.timer.advance(19000); assert.equal(reads, 1);
  await f.timer.advance(1000); assert.equal(activeSignal.aborted, false);assert.equal(f.states.at(-1),'delayed');
  await f.timer.advance(69999);assert.equal(reads,1);assert.equal(activeSignal.aborted,false);
  await f.timer.advance(1);assert.equal(activeSignal.aborted, true); resolveRead(true); await flush();
  assert.equal(f.states.at(-1), 'waiting'); assert.equal(f.redirects, 0);
});
await test('unmount aborts pending acknowledgement/read and cancels success redirect', async () => {
  for (const phase of ['ack', 'read', 'ready']) {
    let resolve, activeSignal;
    const wait = signal => { activeSignal = signal; return new Promise(done => { resolve = done; }); };
    const f = polling(phase === 'ack' ? { acknowledge: wait } : phase === 'read' ? { readReady: wait } : { readReady: async () => true });
    await flush(); f.stop(); const states = [...f.states];
    if (resolve) { assert.equal(activeSignal.aborted, true); resolve(true); }
    await flush(); await f.timer.advance(30000); assert.deepEqual(f.states, states); assert.equal(f.redirects, 0); assert.equal(f.timer.size, 0);
  }
});
await test('unpaid/foreign/unavailable acknowledgement never starts entitlement polling', async () => {
  for (const acknowledge of [async () => false, async () => { throw Error('private'); }]) {
    const f = polling({ acknowledge }); await flush(); assert.equal(f.states.at(-1), 'unavailable'); assert.equal(f.reads, 0); assert.equal(f.timer.size, 0);
  }
});
await test('transient polling failure stays calm and bounded', async () => {
  const f = polling({ readReady: async () => { throw Error('offline'); } }); await flush();
  await f.timer.advance(20000); assert.equal(f.states.at(-1), 'delayed');
  await f.timer.advance(70000);assert.equal(f.states.at(-1), 'waiting'); assert.equal(f.redirects, 0);assert.equal(f.timer.size,0);
});

await test('authoritative Pro at 60–65 seconds redirects automatically with no manual restart', async () => {
  for (const readyAt of [60000,63514,65000]) {
    const timer=clock(),states=[];let redirects=0,acks=0;
    startActivationPolling({schedule:timer.schedule,cancel:timer.cancel,
      acknowledge:async()=>{acks++;return true;},readReady:async()=>timer.now>=readyAt,
      onState:state=>states.push(state),onReady:()=>redirects++});
    await flush();await timer.advance(readyAt+4250);
    assert.ok(states.includes('delayed'));assert.equal(states.at(-1),'ready');
    assert.ok(!states.includes('waiting'));assert.equal(redirects,1);assert.equal(acks,1);assert.equal(timer.size,0);
  }
});
await test('slow phase waits four seconds after completion, never stacks calls behind a slow response', async () => {
  let complete,reads=0;
  const f=polling({readReady:()=>{reads++;return new Promise(resolve=>complete=resolve);}});
  await flush();await f.timer.advance(30000);assert.equal(reads,1);
  complete(false);await flush();await f.timer.advance(3999);assert.equal(reads,1);
  await f.timer.advance(1);assert.equal(reads,2);
  await f.timer.advance(30000);assert.equal(reads,2);f.stop();complete(true);await flush();
  assert.equal(f.redirects,0);assert.equal(f.timer.size,0);
});
await test('unmount cancels slow-phase timer and active slow request, ignoring late readiness',async()=>{
  for(const inflight of [false,true]){
    let complete,activeSignal;
    const f=polling({readReady:signal=>{
      if(!inflight||f.timer.now<24000)return Promise.resolve(false);
      activeSignal=signal;return new Promise(resolve=>complete=resolve);
    }});
    await flush();await f.timer.advance(inflight?24000:20000);
    f.stop();const states=[...f.states];if(complete){assert.equal(activeSignal.aborted,true);complete(true);}
    await flush();await f.timer.advance(90000);assert.deepEqual(f.states,states);assert.equal(f.redirects,0);assert.equal(f.timer.size,0);
  }
});
await test('acknowledgement delay consumes the same total deadline and never claims paid before confirmation',async()=>{
  let confirm,activeSignal;
  const f=polling({acknowledge:signal=>{activeSignal=signal;return new Promise(resolve=>confirm=resolve);}});
  await flush();await f.timer.advance(25000);assert.deepEqual(f.states,['checking']);
  confirm(true);await flush();assert.equal(f.states.at(-1),'delayed');
  await f.timer.advance(65000);assert.equal(activeSignal.aborted,true);assert.equal(f.states.at(-1),'waiting');assert.equal(f.timer.size,0);
});

const pageSource = fs.readFileSync('src/app/client/billing/activating/page.tsx', 'utf8');
function pageFixture(state, search = '?session_id=cs_test_owned') {
  let effect, options; const requests = [], navigation = [];
  let identity = 'owner',authCallback,stops=0,unsubscribed=false;const updates=[];
  const jsx = (type, props) => ({ type, props }); let hook = 0;
  const page = load('src/app/client/billing/activating/page.tsx', {
    'react/jsx-runtime': { jsx, jsxs: jsx }, react: {
      useState: initial => {const i=hook++;return [i===0?state:initial,value=>updates.push([i,value])];}, useEffect: fn => { effect = fn; },
    }, 'next/image': { default: 'image' }, 'next/link': { default: 'link' },
    'lucide-react': { Check: 'check', LoaderCircle: 'loader', ShieldCheck: 'shield' },
    '@/lib/supabase': { supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'offline-token', user: { id: identity } } } }),onAuthStateChange:fn=>{authCallback=fn;return {data:{subscription:{unsubscribe(){unsubscribed=true;}}}};} } } },
    '@/lib/billing-activation-poller': { startActivationPolling: value => { options = value; return () => {stops++;}; } },
  }, { window: { location: { search, replace: path => navigation.push(path) } },
    fetch: async (url, init) => { requests.push([url, init]); return { ok: true, json: async () => ({ data: { paymentReceived: true, proReady: true } }) }; },
  });
  const tree = page.default(); const cleanup = effect();
  function text(node) { if (node == null || typeof node === 'boolean') return ''; if (typeof node !== 'object') return String(node);
    if (Array.isArray(node)) return node.map(text).join(' '); return text(node.props?.children); }
  return { text: text(tree), tree,updates,options, requests, navigation, cleanup,get stops(){return stops;},get unsubscribed(){return unsubscribed;},changeIdentity() { identity = 'another-user';authCallback('SIGNED_IN',{user:{id:identity}}); } };
}
await test('branded accessible pending/timeout/success page never displays Free or asks for payment', () => {
  for (const state of ['checking', 'activating', 'delayed', 'waiting', 'unavailable', 'ready']) {
    const f = pageFixture(state); assert.match(f.text, /DMI Cards/); assert.doesNotMatch(f.text, /\bFree\b|pay again|Upgrade to Pro/);
    if (state === 'waiting') assert.match(f.text, /still finishing.*Check again/);
    if(state==='delayed'){assert.match(f.text,/Payment successful/);assert.match(f.text,/keep checking automatically/);assert.doesNotMatch(f.text,/Check again/);}
    if (state === 'ready') assert.match(f.text, /You're Pro/);
    f.cleanup();
  }
  assert.match(pageSource, /aria-live="polite"/); assert.match(pageSource, /motion-safe:animate-spin/);
});
await test('page uses authenticated GET-only reads, stops via effect cleanup, reloads fresh Billing on success', async () => {
  const f = pageFixture('activating'); assert.equal(typeof f.cleanup, 'function');
  assert.equal(await f.options.acknowledge(signal), true); assert.equal(await f.options.readReady(signal), true);
  for (const [url, init] of f.requests) {
    assert.match(url, /^\/api\/v1\/billing\/activation(?:\?session_id=cs_test_owned)?$/);
    assert.equal(init.method, 'GET'); assert.equal(init.cache, 'no-store'); assert.equal(init.signal, signal);
    assert.equal(init.referrerPolicy, 'no-referrer'); assert.equal(init.headers.Authorization, 'Bearer offline-token');
  }
  f.options.onReady(); assert.deepEqual(f.navigation, ['/client/billing']);
});
await test('changing account after checkout acknowledgement stops further reads', async () => {
  const f = pageFixture('activating'); await f.options.acknowledge(signal); f.changeIdentity();
  assert.equal(f.stops,1);assert.equal(f.updates.at(-1)[1],'unavailable');
  await assert.rejects(f.options.readReady(signal)); assert.equal(f.requests.length, 1);
  f.cleanup();assert.equal(f.unsubscribed,true);
});
await test('only final waiting state exposes manual fallback and cleanup unsubscribes auth listener',()=>{
  function nodes(node){if(!node||typeof node!=='object')return [];return [node,...[node.props?.children].flat(Infinity).flatMap(nodes)];}
  for(const state of ['checking','activating','delayed','ready','unavailable','waiting']){
    const f=pageFixture(state),buttons=nodes(f.tree).filter(n=>n.type==='button');
    assert.equal(buttons.length,state==='waiting'?1:0);
    if(buttons[0]){buttons[0].props.onClick();assert.equal(f.updates.at(-1)[0],1);}
    f.cleanup();assert.equal(f.stops,1);assert.equal(f.unsubscribed,true);
  }
});
await test('cancelled or missing/duplicate session query never enters activation polling', async () => {
  for (const query of ['?checkout=cancelled', '?checkout=cancelled&session_id=cs_test_owned', '', '?session_id=a&session_id=b']) {
    const f = pageFixture('checking', query); assert.equal(await f.options.acknowledge(signal), false); assert.equal(f.requests.length, 0);
  }
  for (const path of ['src/app/api/stripe/checkout/route.ts', 'src/app/api/v1/billing/checkout/route.ts']) {
    const source = fs.readFileSync(path, 'utf8');
    assert.match(source, /successUrl: `\$\{origin\}\/client\/billing\/activating\?session_id=\{CHECKOUT_SESSION_ID\}`/);
    assert.match(source, /cancelUrl: `\$\{origin\}\/client\/billing\?checkout=cancelled`/);
  }
});
await test('regression diff exception permits only exact reviewed checkout presentation; unrelated edits still reject', () => {
  const checkoutPath = 'src/app/api/stripe/checkout/route.ts';
  for (const tamper of [false, true]) {
    const contract = load('scripts/billing-recovery-diagnostic-contract.mjs', {
      './billing-work-auto-contract.mjs': automaticContract,
      './billing-claim-diagnostic-contract.mjs': claimContract,
      './billing-embedded-checkout-contract.mjs': embeddedContract,
      './billing-latency-contract.mjs': latencyContract,
      'node:assert/strict': { default: assert }, 'node:crypto': crypto, 'node:child_process': childProcess,
      'node:fs': { default: { ...fs, readFileSync(file, encoding) {
        const source = fs.readFileSync(file, encoding);
        return tamper && file === checkoutPath ? source.replace('checkout=cancelled', 'checkout=success') : source;
      } } },
    });
    const run = () => contract.recoveryDiagnosticGitDiff(['diff', '--name-only', 'HEAD', '--', 'src', 'supabase/migrations'], { encoding: 'utf8' });
    if (tamper) assert.throws(run, /Unexpected checkout change/); else assert.equal(run(), '');
  }
});
console.log(`Billing activation: ${count}/${count} passed (offline).`);
