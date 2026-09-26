// Real route/helper execution with an in-memory database only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const plain = x => JSON.parse(JSON.stringify(x));
function load(path, deps = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, require(name) { assert.ok(name in deps, name); return deps[name]; } });
  return exports;
}
const registry = load('src/lib/template-layouts.ts');
const write = load('src/lib/admin-template-write.ts', { '@/lib/template-layouts': registry });
const actions = load('src/lib/card-actions.ts');
const id = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const other = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const original = { id, name: 'Custom historical name', slug: 'custom-slug', layout_type: 'premium_classic', access_level: 'paid',
  allowed_fonts: ['Inter'], custom_colour_allowed: false, logo_allowed: null, banner_allowed: false,
  field_config: { sections: { personal: ['full_name'], special: ['custom'] }, section_labels: { special: 'Keep' } } };
let rows, writes, failWrite, authorized = true;
function reset() { rows = [{ ...plain(original) }, { ...plain(original), id: other }]; writes = []; failWrite = false; }
const db = { from(table) {
  assert.equal(table, 'templates');
  const filters = {}; let update, insert;
  const query = {
    select() { return query; }, eq(key, value) { filters[key] = value; return query; },
    update(value) { update = plain(value); return query; }, insert(value) { insert = plain(value[0]); return query; },
    async maybeSingle() { return { data: rows.find(row => Object.entries(filters).every(([k, v]) => row[k] === v)) || null }; },
    async single() {
      writes.push({ filters: { ...filters }, payload: update || insert });
      if (failWrite) return { error: { message: "Could not find the 'logo_allowed' column of 'templates' in the schema cache" } };
      if (insert) { const row = { id: other, ...insert }; rows.push(row); return { data: row }; }
      const row = rows.find(row => row.id === filters.id); Object.assign(row, update); return { data: row };
    },
  }; return query;
} };
const deps = {
  '@/lib/admin-template-write': write, '@/lib/card-actions': actions,
  'next/server': { NextResponse: { json: (body, options = {}) => ({ body: plain(body), status: options.status || 200 }) } },
  '@clerk/nextjs/server': { auth: async () => ({ userId: 'admin' }) },
  '@/lib/admin-auth': { requireAdminAccess: async () => ({ authorized, error: 'Denied', status: 403 }) },
  '@/lib/supabase-admin': { createSupabaseAdminClient: () => db },
};
const detail = load('src/app/api/admin/templates/[templateId]/route.ts', deps);
const collection = load('src/app/api/admin/templates/route.ts', deps);
const patch = (body, target = id) => detail.PATCH({ json: async () => body }, { params: Promise.resolve({ templateId: target }) });
reset();
const result = await patch({ name: 'Explicit rename' });
assert.equal(result.status, 200);
assert.deepEqual(writes[0], { filters: { id }, payload: { name: 'Explicit rename' } });
assert.equal(rows[0].slug, original.slug);
assert.equal(rows[0].layout_type, original.layout_type);
assert.equal(rows[1].name, original.name, 'same-layout sibling is untouched');
for (const key of ['allowed_fonts', 'custom_colour_allowed', 'logo_allowed', 'banner_allowed']) assert.deepEqual(rows[0][key], original[key]);
assert.equal((await patch({ slug: 'explicit-slug' })).status, 200);
assert.equal(rows[0].slug, 'explicit-slug');
assert.equal((await patch({ logo_allowed: true })).status, 200);
assert.equal(rows[0].logo_allowed, true);
assert.equal(rows[0].banner_allowed, false);
for (const legacy of ['premium_classic', 'glassmorphism', 'banner_card', 'split_card', 'monogram_card', 'unknown', null]) {
  reset(); rows[0].layout_type = legacy;
  assert.equal((await patch({ layout_type: registry.resolveRenderingLayout(legacy, 'paid') })).status, 400);
  assert.equal(writes.length, 0);
  assert.equal((await patch({ name: 'Safe edit', layout_type: legacy })).status, 200);
  assert.equal(rows[0].layout_type, legacy);
  assert.ok(!('layout_type' in writes[0].payload));
}
reset();
for (const [body, target] of [[{ id: other, name: 'Wrong ID' }, id], [{ access_level: 'free' }, id], [{ name: 'Bad ID' }, 'not-a-uuid'], [{ supports_gradient: true }, id]]) {
  assert.equal((await patch(body, target)).status, 400);
}
assert.equal(writes.length, 0);
assert.equal((await patch({}, 'cccccccc-cccc-4ccc-cccc-cccccccccccc')).status, 404);
assert.equal((await patch({})).status, 200);
assert.equal(writes.length, 0);
authorized = false; assert.equal((await patch({ name: 'Denied' })).status, 403); authorized = true;
failWrite = true;
assert.equal((await patch({ logo_allowed: true })).status, 500);
assert.equal(writes.length, 1, 'explicit fields are never silently stripped and retried');
reset();
for (const layout of registry.templateLayouts) {
  assert.equal((await collection.POST({ json: async () => ({ name: layout.displayName, layout_type: layout.id, access_level: layout.accessLevel }) })).status, 200);
}
for (const bad of [ { layout_type: 'premium_classic', access_level: 'paid' }, { layout_type: 'brand_paid', access_level: 'free' }, { layout_type: 'unknown', access_level: 'free' }, { layout_type: null, access_level: 'free' } ]) {
  const before = writes.length;
  assert.equal((await collection.POST({ json: async () => ({ name: 'Bad', ...bad }) })).status, 400);
  assert.equal(writes.length, before);
}
const baseline = { name: original.name, logo_allowed: true, allowed_fonts: ['Inter'], field_config: { sections: { personal: ['full_name'] } } };
assert.deepEqual(plain(write.templateEditPatch({ ...baseline, name: 'Renamed' }, baseline, original)), { name: 'Renamed' }, 'hydrated default true never overwrites stored null');
assert.deepEqual(plain(write.templateEditPatch({ ...baseline, logo_allowed: false }, baseline, original)), { logo_allowed: false });
const changed = plain(write.templateEditPatch({ ...baseline, field_config: { sections: { personal: ['first_name'] } } }, baseline, original));
assert.deepEqual(changed.field_config, { sections: { personal: ['first_name'], special: ['custom'] }, section_labels: { special: 'Keep' } });
console.log('PASS: real Admin POST/PATCH; exact UUID; sparse identity/permission preservation; legacy/null fallback rejection; explicit rename; schema failure without data loss; nested contract preservation.');
