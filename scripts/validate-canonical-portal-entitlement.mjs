// Real resolver/route/provider code with in-memory auth, DB, HTTP and hook harnesses.
// No network, Stripe requests, SQL, or real profile/account ensure calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(path, deps, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, console, URL, process: { env: { STRIPE_PRICE_PRO_MONTHLY: 'pro-price' } },
    require(name) { assert.ok(name in deps, name); return deps[name]; }, ...globals });
  return exports;
}
const ent = load('src/lib/entitlements/index.ts', {});
const billing = load('src/lib/stripe/billing-state.ts', { 'server-only': {}, '@/lib/entitlements': ent });
const context = load('src/lib/api/client-context.ts', {
  'server-only': {}, '@supabase/supabase-js': {}, '@/lib/entitlements': ent,
  '@/lib/api/responses': { ApiRouteError: Error }, '@/lib/stripe/billing-state': billing,
});
let rows = [], session = { access_token: 'test-only-token', user: { id: 'user' } }, legacyPlan = 'pro';
let fail = false, httpCalls = 0, stripeCalls = 0;
const db = { from(table) { assert.equal(table, 'billing_subscriptions');
  const q = { select() { return q; }, eq() { return q; }, order() { return q; }, async limit() { return { data: rows, error: null }; } }; return q;
} };
const route = load('src/app/api/v1/billing/subscription/route.ts', {
  '@/lib/api/client-context': { async requireApiClient() {
    const state = await context.resolveTrustedApiBillingState(db, 'user');
    return { plan: state.plan, planSource: state.source, profile: { plan: legacyPlan },
      billing: { status: state.subscriptionStatus, cancelAtPeriodEnd: state.cancelAtPeriodEnd, currentPeriodEnd: state.currentPeriodEnd } };
  } },
  '@/lib/api/responses': { apiSuccess: (data, options) => ({ data, options }), apiErrorFromUnknown: e => { throw e; } },
  '@/lib/stripe/billing-summary': { getBillingSummaryForUser() { stripeCalls++; throw Error('No Stripe allowed'); } },
});
let authCallback;
const auth = { async getSession() { return { data: { session }, error: null }; },
  onAuthStateChange(callback) { authCallback = callback; return { data: { subscription: { unsubscribe() {} } } }; } };
const resolver = load('src/lib/entitlements/plan-resolver.ts', { '@/lib/supabase': { supabase: { auth } } }, {
  async fetch(url, options) {
    httpCalls++; assert.equal(options.cache, 'no-store'); assert.ok(options.headers.Authorization);
    if (fail) throw Error('Offline');
    const result = await route.GET({ url: 'https://local.test' + url });
    assert.equal(result.options.headers['Cache-Control'], 'private, no-store');
    return { ok: true, async json() { return { data: result.data }; } };
  },
});
for (const [status, price, expected] of [
  [null, null, 'free'], ['active', 'pro-price', 'pro'], ['trialing', 'pro-price', 'pro'],
  ['canceled', 'pro-price', 'free'], ['past_due', 'pro-price', 'free'], ['unpaid', 'pro-price', 'free'],
  ['active', 'unknown', 'free'], ['incomplete', 'pro-price', 'free'],
]) {
  rows = status ? [{ stripe_subscription_status: status, stripe_price_id: price }] : [];
  for (legacyPlan of ['free', 'pro']) assert.equal((await resolver.resolveEffectiveClientPlan({ id: 'user' })).plan, expected);
}
assert.equal(stripeCalls, 0);
fail = true; await assert.rejects(resolver.resolveEffectiveClientPlan()); fail = false;
session = null; await assert.rejects(resolver.resolveEffectiveClientPlan());
session = { access_token: 'new-session', user: { id: 'user' } };
// Minimal React lifecycle harness: runs the actual provider callbacks/effects.
let slots = [], index = 0, effects = [], pathname = '/client/dashboard';
const listeners = {}, timers = new Map(); let timerId = 0;
const setTimer = (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; };
const clearTimer = id => timers.delete(id);
const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => v === b[i]);
const react = {
  createContext: () => ({ Provider: 'provider' }), createElement: (_, props) => props.value,
  useState(init) { const i = index++; if (!(i in slots)) slots[i] = typeof init === 'function' ? init() : init;
    return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
  useRef(init) { const i = index++; return slots[i] ||= { current: init }; },
  useMemo(fn, deps) { const i = index++; if (!same(slots[i]?.deps, deps)) slots[i] = { deps, value: fn() }; return slots[i].value; },
  useCallback(fn, deps) { return react.useMemo(() => fn, deps); },
  useEffect(fn, deps) { const i = index++; if (!same(slots[i]?.deps, deps)) effects.push(() => {
    slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; }); },
};
const globals = { setTimeout: setTimer, clearTimeout: clearTimer,
  window: { setTimeout: setTimer, clearTimeout: clearTimer, addEventListener: (k, fn) => { listeners[k] = fn; }, removeEventListener() {} },
  document: { visibilityState: 'visible', addEventListener: (k, fn) => { listeners[k] = fn; }, removeEventListener() {} },
};
const provider = load('src/lib/use-client-plan.ts', {
  react, 'next/navigation': { usePathname: () => pathname }, '@/lib/entitlements': ent,
  '@/lib/entitlements/plan-resolver': resolver, '@/lib/supabase': { supabase: { auth } },
}, globals);
function render() { index = 0; const value = provider.ClientPlanProvider({ children: null }); const queued = effects; effects = []; queued.forEach(fn => fn()); return value; }
async function flush() { for (const [id, timer] of [...timers]) { if (timer.ms <= 100) { timers.delete(id); timer.fn(); } }
  for (let i = 0; i < 30; i++) await Promise.resolve(); }
rows = [{ stripe_subscription_status: 'active', stripe_price_id: 'pro-price' }];
render(); await flush(); assert.equal(render().plan, 'pro');
const backgroundRefresh = render().refreshPlan();
assert.equal(render().plan, 'pro', 'focus refresh keeps resolved plan while pending');
assert.equal(render().loading, false, 'pending background refresh must not reload/unmount the card editor');
await backgroundRefresh;
assert.equal(render().plan, 'pro');
authCallback('INITIAL_SESSION', session);
const beforeFocusVersion = render().refreshVersion;
for (const event of ['SIGNED_IN', 'TOKEN_REFRESHED']) {
  authCallback(event, session);
  assert.equal(render().plan, 'pro', 'same identity notification keeps canonical entitlement');
  assert.equal(render().loading, false);
  await flush();
}
assert.ok(render().refreshVersion > beforeFocusVersion, 'successful background refresh signals fresh inventory reads');


rows = [{ stripe_subscription_status: 'canceled', stripe_price_id: 'pro-price' }];
listeners.focus(); await flush(); assert.equal(render().isPaid, false);
rows = [{ stripe_subscription_status: 'trialing', stripe_price_id: 'pro-price' }];
pathname = '/client/cards'; render(); await flush(); assert.equal(render().isPaid, true);
fail = true; await render().refreshPlan(); assert.equal(render().isPaid, false); assert.equal(render().status, 'error'); fail = false;
authCallback('SIGNED_OUT'); assert.equal(render().isPaid, false);
rows = []; authCallback('SIGNED_IN'); await flush(); assert.equal(render().plan, 'free');
const callsBeforeReload = httpCalls;
for (const slot of slots) slot?.cleanup?.(); slots = []; render(); await flush();
assert.ok(httpCalls > callsBeforeReload); assert.equal(render().plan, 'free');
// Static wiring checks for billing action success and external return handling.
const page = fs.readFileSync('src/app/client/billing/page.tsx', 'utf8');
assert.match(page, /params.get\("checkout"\) === "success".*params.get\("portal"\) === "return"/);
assert.match(page, /setSubscriptionPanelOpen\(false\);\s*refreshAfterBillingChange\(\)/);
assert.match(page, /subscription\/cancel/); assert.match(page, /subscription\/resume/);
assert.match(page, /Effective feature access:/); assert.match(page, /subscription product/);
const browserSource = fs.readFileSync('src/lib/entitlements/plan-resolver.ts', 'utf8');
assert.doesNotMatch(browserSource, /\.from\(|subscription_plan|billing_status|resolvePlanFromProfile/);
console.log('PASS: canonical server/Portal status matrix; legacy profile disagreement eliminated; no Stripe calls; provider mount/focus/navigation/error/sign-out/sign-in/reload; static checkout/cancel/resume/portal-return wiring; subscription label separation.');

// Actual requireApiClient: verify identity first, then overlap independent reads.
let verified=false, rejectAuth=false, profileFailure=false, billingFailure=false;
let releaseProfile, releaseBilling; const started=new Set();
const parallelDb={auth:{async getUser(){return {data:{user:rejectAuth?null:{id:'owner',email:null}},error:null};}},from(table){
  assert.ok(['profiles','billing_subscriptions'].includes(table));
  assert.equal(verified,true,'queries only after verified getUser');
  const q={select(){return q;},eq(key,value){assert.equal(value,'owner');return q;},order(){return q;},
    async maybeSingle(){started.add('profile');await new Promise(r=>releaseProfile=r);return {data:null,error:profileFailure?{code:'test'}:null};},
    async limit(){started.add('billing');await new Promise(r=>releaseBilling=r);return {data:[],error:billingFailure?{code:'test'}:null};}};
  return q;
}};
parallelDb.auth.getUser=async()=>{verified=!rejectAuth;return {data:{user:verified?{id:'owner',email:null}:null},error:null};};
const parallelContext=load('src/lib/api/client-context.ts',{
  'server-only':{},'@supabase/supabase-js':{createClient:()=>parallelDb},'@/lib/entitlements':ent,
  '@/lib/api/responses':{ApiRouteError:Error},'@/lib/stripe/billing-state':billing,
},{process:{env:{NEXT_PUBLIC_SUPABASE_URL:'https://local.invalid',NEXT_PUBLIC_SUPABASE_ANON_KEY:'test'}},console:{error(){},warn(){}}});
const authorizedRequest=new Request('https://local.invalid',{headers:{Authorization:'Bearer test-only'}});
for(const failure of ['none','profile','billing']){
  started.clear();profileFailure=failure==='profile';billingFailure=failure==='billing';
  const pending=parallelContext.requireApiClient(authorizedRequest);
  for(let i=0;i<12;i++)await Promise.resolve();
  assert.equal(started.size,2,'both reads start before either finishes');
  releaseProfile();releaseBilling();
  if(failure==='none')assert.equal((await pending).plan,'free');else await assert.rejects(pending);
}
started.clear();rejectAuth=true;await assert.rejects(parallelContext.requireApiClient(authorizedRequest));assert.equal(started.size,0);
console.log('PASS: real context verifies Auth before concurrent profile/billing; either read failure rejects; canonical Free fallback preserved.');
