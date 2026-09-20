// Executes the Cards page's actual loading effect with bounded in-memory reads.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source = fs.readFileSync('src/app/client/cards/page.tsx', 'utf8');
const ast = ts.createSourceFile('cards.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let effect;
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect' && node.arguments[0]?.getText(ast).includes('async function loadSavedCards')) effect = node.arguments[0].getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(effect);
let templates = [{ id: 'template-1' }], rows = [{ id: 'card-1' }];
let templateError = false, cardsError = false, release;
let gate = new Promise(resolve => { release = resolve; });
const state = { loadingCards: true, refreshingCards: false, inventoryError: '', adminTemplates: [], cards: [], selectedCardId: '', draft: 'unsaved editor data' };
const globals = {
  currentPlan: 'pro', plan: 'pro', planLoading: false, planError: '',
  inventoryLoaded: { current: false }, console: { error() {} },
  loadPublishedTemplates: async () => { await gate; if (templateError) throw Error('Template refresh failed'); return templates; },
  getCurrentUser: async () => ({ id: 'owner' }), ClientAuthRequiredError: class extends Error {},
  listCardsForUser: async () => ({ data: rows, error: cardsError ? Error('Card refresh failed') : null }),
  mapSupabaseCard: row => row, sortCardsBySlotOrder: cards => cards,
  describeCardsDatabaseError: error => error.message, router: { replace() {} },
};
for (const key of ['loadingCards','refreshingCards','inventoryError','adminTemplates','cards','selectedCardId','saveError','templateError','databaseReady','databaseNotice']) {
  globals['set' + key[0].toUpperCase() + key.slice(1)] = value => { state[key] = typeof value === 'function' ? value(state[key]) : value; };
}
const run = vm.runInNewContext(ts.transpileModule('(' + effect + ')', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, globals);
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
let cleanup = run();
assert.equal(state.loadingCards, true, 'first visit waits for inventory');
release(); await flush();
assert.equal(state.loadingCards, false);
assert.equal(state.cards[0].id, 'card-1');
cleanup();
rows = [{ id: 'card-2' }]; templates = [{ id: 'template-2' }];
cleanup = run();
assert.equal(state.loadingCards, false, 'background read cannot replace loaded UI');
assert.equal(state.refreshingCards, true);
assert.equal(state.cards[0].id, 'card-1', 'keep old snapshot until new snapshot completes');
await flush();
assert.equal(state.cards[0].id, 'card-2');
assert.equal(state.adminTemplates[0].id, 'template-2');
assert.equal(state.draft, 'unsaved editor data');
cleanup();
for (const failure of ['template', 'cards']) {
  templateError = failure === 'template'; cardsError = failure === 'cards';
  templates = [{ id: 'partial-template' }];
  cleanup = run(); await flush();
  assert.equal(state.loadingCards, false);
  assert.equal(state.refreshingCards, false);
  assert.equal(state.cards[0].id, 'card-2');
  assert.equal(state.adminTemplates[0].id, 'template-2', 'failed join cannot replace good template snapshot');
  assert.ok(state.inventoryError);
  cleanup();
}
templateError = false; cardsError = false;
run(); await flush(); assert.equal(state.inventoryError, '');
// A superseded request must not overwrite the latest successful inventory.
gate = new Promise(resolve => { release = resolve; });
cleanup = run(); cleanup();
gate = Promise.resolve(); rows = [{ id: 'latest' }]; run(); await flush();
rows = [{ id: 'obsolete' }]; release(); await flush();
assert.equal(state.cards[0].id, 'latest');
console.log('PASS: actual Cards effect initial/background loading, atomic snapshot replacement, refresh errors preserve inventory/draft, recovery and stale-response guard.');
