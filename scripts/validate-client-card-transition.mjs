import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(path, deps, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, ...globals, require(name) { assert.ok(name in deps, name); return deps[name]; } });
  return exports;
}
class ApiRouteError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
let user = 'owner', row = { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', user_id: 'owner' }, touched = 0;
const filters = {};
const query = {
  delete() { touched++; return query; }, eq(k, v) { filters[k] = v; return query; },
  select() { return query; },
  async maybeSingle() { return { data: row && row.id === filters.id && row.user_id === filters.user_id ? { id: row.id } : null }; },
};
const route = load('src/app/api/client/cards/[cardId]/route.ts', {
  '@/lib/card-media-server': { cardEditSnapshot: async () => ({ card: row, revision: 'a'.repeat(64) }) },
  '@/lib/api/client-context': { async requireApiClient() { if (!user) throw new ApiRouteError(401, 'UNAUTHENTICATED', 'Sign in'); return { userId: user }; } },
  '@/lib/api/responses': { ApiRouteError, apiSuccess: data => ({ status: 200, data }), apiErrorFromUnknown: e => ({ status: e.status, message: e.message }) },
  '@/lib/supabase-admin': { createSupabaseAdminClient: () => ({ from: table => { assert.equal(table, 'cards'); return query; } }) },
});
const id = row.id, context = { params: Promise.resolve({ cardId: id }) };
assert.equal((await route.DELETE({}, context)).status, 200);
assert.equal(filters.user_id, 'owner');
user = 'other';
const foreign = await route.DELETE({}, context);
row = null;
assert.deepEqual(await route.DELETE({}, context), foreign);
assert.equal(foreign.status, 404);
user = null;
const before = touched;
assert.equal((await route.DELETE({}, context)).status, 401);
assert.equal(touched, before);
let requests = [], reads = 0;
const readQuery = {
  select() { reads++; return readQuery; }, eq() { return readQuery; }, order() { return readQuery; },
  or() { return readQuery; }, limit() { return readQuery; }, async maybeSingle() { return { data: { id } }; },
  insert() { throw Error('Browser insert'); }, update() { throw Error('Browser update'); }, delete() { throw Error('Browser delete'); },
};
const browser = load('src/lib/services/card-service.ts', {
  '@/lib/client-card-media': { async saveCardWithMedia(card, mode) { requests.push({ url: '/api/client/cards', options: { method: 'POST', headers: { Authorization: 'Bearer test' }, body: JSON.stringify({ card, mode }) } }); return { id }; } },
  '@/lib/supabase': { supabase: { from: () => readQuery, auth: { getSession: async () => ({ data: { session: { access_token: 'test' } } }) } } },
}, { async fetch(url, options) {
  requests.push({ url, options });
  return { ok: true, json: async () => ({ data: { card: { id }, deleted: { id } } }) };
} });
const card = { id, status: 'unpublished' };
await browser.createCard({ card, userId: 'ignored' });
await browser.updateCard({ card, userId: 'ignored' });
await browser.publishCard({ card, userId: 'ignored', mode: 'edit' });
await browser.unpublishCard({ card, userId: 'ignored', mode: 'edit' });
await browser.deleteCardForUser(id, 'ignored');
assert.equal(requests.length, 5);
assert.equal(requests[4].options.method, 'DELETE');
assert.equal(requests[4].options.body, undefined);
assert.equal(JSON.parse(requests[2].options.body).card.status, 'published');
assert.equal(JSON.parse(requests[3].options.body).card.status, 'unpublished');
for (const request of requests) assert.ok(request.options.headers.Authorization);
await browser.listCardsForUser('owner'); await browser.getCardForUser(id, 'owner'); await browser.getPublishedCardForUser('owner');
assert.equal(reads, 3);
const source = fs.readFileSync('src/lib/services/card-service.ts', 'utf8');
assert.doesNotMatch(source, /\.(insert|update|delete|upsert)\(/);
const server = fs.readFileSync('src/lib/services/card-write-server.ts', 'utf8');
assert.match(server, /import "server-only"/);
assert.doesNotMatch(server, /database\s*=\s*supabase|database\?:/);
console.log('PASS: protected owner deletion, indistinguishable foreign/missing cards, unauthenticated rejection, all browser mutation wrappers use APIs, browser reads retained.');
