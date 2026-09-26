// Local VM checks only. No network, credentials, files written or database calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source = path => fs.readFileSync(path, 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
function load(path, deps = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, ...globals, require(name) { assert.ok(name in deps, name); return deps[name]; } });
  return exports;
}
const registry = load('src/lib/template-layouts.ts');
const expected = ['classic_free', 'profile_free', 'modern_minimal', 'executive_paid', 'brand_paid'];
assert.deepEqual(plain(registry.templateLayouts.map(x => x.id)), expected);
assert.doesNotMatch(source('src/lib/template-layouts.ts'), /^import /m);
assert.equal(new Set(registry.templateLayouts.map(x => x.currentTemplatesOrder)).size, 5);
const actions = load('src/lib/card-actions.ts');
const typography = load('src/lib/card-typography.ts');
const payload = load('src/lib/services/card-payload.ts', {
  '@/lib/template-layouts': registry, '@/lib/card-typography': typography,
  '@/components/CardRenderer': { displayName: c => c.full_name || '' },
  '@/lib/card-actions': actions, '@/lib/public-url': { buildPublicCardUrl: s => '/u/' + s },
  '@/lib/templates': { normalizeColourPalette: x => Array.isArray(x) ? x : [] },
});
for (const layout of registry.templateLayouts) {
  const template = { id: layout.id, name: layout.displayName, layout_type: layout.id, access_level: layout.accessLevel, status: 'published' };
  assert.equal(registry.canCreateTemplateLayout(template), true);
  assert.equal(registry.resolveRenderingLayout(layout.id, layout.accessLevel), layout.id);
  for (const plan of ['free', 'pro', 'enterprise']) {
    const eligible = layout.accessLevel === 'free' || plan !== 'free';
    assert.equal(registry.canSelectTemplateLayout(template, plan), eligible);
    assert.equal(payload.canSelectTemplate(template, plan), eligible);
    assert.equal(payload.visibleTemplatesForPlan([template], plan).length, eligible ? 1 : 0);
    assert.equal(Boolean(payload.defaultTemplateForPlan([template], plan)), eligible);
  }
  const mismatch = { ...template, access_level: layout.accessLevel === 'free' ? 'paid' : 'free' };
  assert.equal(registry.canCreateTemplateLayout(mismatch), false);
  for (const plan of ['free', 'pro', 'enterprise']) assert.equal(payload.canSelectTemplate(mismatch, plan), false);
}
for (const id of ['premium_classic', 'glassmorphism', 'banner_card', 'split_card', 'monogram_card', 'unknown', null]) {
  const template = { id: 'saved', name: 'Legacy', layout_type: id, access_level: 'paid', status: 'published' };
  assert.equal(registry.canCreateTemplateLayout(template), false);
  assert.equal(payload.canSelectTemplate(template, 'pro'), false);
  assert.equal(payload.visibleTemplatesForPlan([template], 'pro').length, 0);
  assert.equal(payload.templateForCard({ template_id: 'saved' }, [template], 'pro').id, 'saved');
  assert.equal(payload.templateForCard({ template_id: 'different' }, [template], 'pro'), null);
  assert.equal(registry.resolveRenderingLayout(id, 'paid'), 'modern_minimal');
  assert.equal(template.layout_type, id);
}
assert.equal(registry.canSelectTemplateLayout({ layout_type: 'classic', access_level: 'free' }, 'free'), false);
assert.equal(registry.resolveRenderingLayout('classic', 'free'), 'classic_free');
const renderer = source('src/components/CardRenderer.tsx');
const map = renderer.slice(renderer.indexOf('const layouts = {'), renderer.indexOf('satisfies Record<LayoutId'));
assert.deepEqual([...map.matchAll(/^    (\w+): \(/gm)].map(x => x[1]), expected);
assert.match(renderer, /resolveRenderingLayout\(template.layout_type, template.access_level\)/);
assert.doesNotMatch(renderer, /const (?:paidLayouts|freeLayouts) =/);
const builder = source('src/app/templates/page.tsx');
assert.match(builder, /builderLayouts\(accessLevel\)/);
assert.doesNotMatch(builder, /const (?:paidLayouts|freeLayouts) =|normalizeTemplateLayout|supports_gradient:/);
assert.match(builder, /getAdminTemplates\(\{ raw: true \}\)/);
assert.match(builder, /templateEditPatch\(payload, baseline.payload, baseline.stored\)/);
assert.match(builder, /delete patch.slug/);
const current = source('src/app/templates/current/page.tsx');
assert.match(current, /sort\(compareTemplateLayouts\)/);
assert.match(current, /getTemplateLayout\(template.layout_type\)/);
assert.doesNotMatch(current, /catalogueLayoutOrder|classic_free|profile_free|modern_minimal|executive_paid|brand_paid/);
assert.match(source('src/app/api/client/cards/route.ts'), /if \(!canSelectTemplate\(template, plan\)\)/);
assert.match(source('src/lib/card-media-staging-server.ts'), /if \(!canSelectTemplate\(template, client.plan\)\)/);
assert.match(source('src/lib/admin-card-mutations-server.ts'), /canSelectTemplateLayout\(template.data, "enterprise"\)/);
assert.match(source('src/app/api/client/templates/route.ts'), /canResolveExistingTemplate\(template, client.plan\)/);

// Real transport helper must send only explicit fields, never read defaults.
const requests = [];
const templates = load('src/lib/templates.ts', { '@/lib/supabase': {}, '@/lib/card-actions': actions }, {
  fetch: async (url, init) => {
    requests.push({ url, payload: JSON.parse(init.body) });
    return { ok: true, json: async () => ({ template: { id: 'exact-id', name: 'Saved', layout_type: 'premium_classic', access_level: 'paid' } }) };
  },
});
await templates.saveAdminTemplate({ name: 'Explicit rename' }, 'exact-id');
assert.deepEqual(requests[0], { url: '/api/admin/templates/exact-id', payload: { name: 'Explicit rename' } });
await templates.publishAdminTemplate({ id: 'exact-id', name: 'Old', layout_type: 'premium_classic' }, true);
assert.deepEqual(requests[1].payload, { is_published: true, status: 'published' });
assert.equal(templates.normalizeTemplate({ name: 'Null layout', layout_type: null, slug: null }).layout_type, null);
assert.equal(templates.normalizeTemplate({ name: 'Null layout', layout_type: null, slug: null }).slug, null);
console.log('PASS: exact V1 registry; typed renderer coverage; plan/access parity; separate existing resolution; shared consumers; sparse transport; no write fallback.');

// Execute the real card route with the real registry selector across all plans.
let selectedTemplate, plan, writes = 0;
class ApiRouteError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
const cardRoute = load('src/app/api/client/cards/route.ts', {
  '@/lib/media-request-timing': { MediaRequestTiming: class { measure(_label, fn) { return fn(); } response(value) { return value; } } },
  '@/lib/api/responses': { ApiRouteError, apiSuccess: data => ({ status: 200, data }), apiErrorFromUnknown: error => ({ status: error.status || 500 }) },
  '@/lib/api/client-context': { requireApiClient: async () => ({ plan, userId: 'owner' }) },
  '@/lib/services/card-payload': payload,
  '@/lib/services/card-write-server': { saveClientCardRecord: async () => { writes++; return { data: { id: 'card' } }; } },
  '@/lib/client-card-write-server': { writeValidatedClientCard: async () => { writes++; return { id: 'card' }; } },
  '@/lib/templates': templates,
  '@/lib/supabase-admin': { createSupabaseAdminClient: () => ({ from: () => { const q = { select: () => q, eq: () => q, or: () => q, maybeSingle: async () => ({ data: selectedTemplate }) }; return q; } }) },
});
for (const candidate of [...registry.templateLayouts.map(layout => ({ id: layout.id, name: layout.displayName, layout_type: layout.id, access_level: layout.accessLevel })),
  { id: 'legacy', name: 'Legacy', layout_type: 'premium_classic', access_level: 'paid' },
  { id: 'mismatch', name: 'Mismatch', layout_type: 'brand_paid', access_level: 'free' },
  { id: 'missing', name: 'Missing', layout_type: null, access_level: 'free' }]) {
  selectedTemplate = candidate;
  for (plan of ['free', 'pro', 'enterprise']) {
    const before = writes;
    const result = await cardRoute.POST({ json: async () => ({ mode: 'create', card: { template_id: candidate.id } }) });
    const eligible = registry.canSelectTemplateLayout(candidate, plan);
    assert.equal(result.status, eligible ? 200 : 403);
    assert.equal(writes - before, eligible ? 1 : 0);
  }
}
assert.match(source('src/app/client/cards/page.tsx'), /!currentDefaultTemplate && cards.length === 0/);
console.log('PASS: real card API parity for all plans, legacy/missing/mismatched layouts denied before writes; existing inventory independent of creation availability.');
